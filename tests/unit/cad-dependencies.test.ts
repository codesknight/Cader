import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadConfig } from '@cader/config';
import { ExecutionSession, runTask } from '@cader/profile';
import { createToolRuntime, invokeTool, createLiveRuntime, LlmError } from '@cader/dsh-adapter';
import type { createMcpClient, ToolDefinition, StreamChunk } from '@cader/dsh-adapter';

async function fixture() {
  await mkdir('.cader/tests', { recursive: true });
  const root=await mkdtemp(resolve('.cader/tests/dependencies-'));
  const calls:string[]=[],layers=['0']; let readFails=false;
  const definitions:ToolDefinition[]=['new_drawing','draw_polyline','create_layer','list_layers','get_backend_status','query_entities','get_entity'].map(name=>({
    name:`mcp__autocad__${name}`,description:'Synthetic dependency fixture; no CAD',parameters:{type:'object'},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},execute:async()=>{throw new Error('owner required');}
  }));
  const factory:typeof createMcpClient=async()=>({definitions:()=>definitions,toolNames:()=>definitions.map(t=>t.name.split('__').at(-1)!),
    async call(name,args){calls.push(name);
      if(name==='list_layers'){if(readFails)throw new Error('dependency observation lost');return [...layers];}
      if(name==='create_layer'){layers.push(String(args.name));return 'created';}
      if(name==='new_drawing')return 'Synthetic.dwg';
      if(name==='draw_polyline'){
        if(!layers.includes(String(args.layer)))throw new Error('mock partial native mutation MUST NOT be reached');
        return 'draw_polyline ok, object_id=42';
      }
      if(name==='query_entities')return [];
      return {};
    },async dispose(){}
  });
  const owner=new ExecutionSession(root,join(root,'.cader/runs/fixture'),undefined,factory); owner.mode='workspace-write';
  await owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
  const ctx=await createToolRuntime(); for(const tool of owner.definitions())ctx.tools.register(tool);
  await invokeTool(ctx,'mcp__autocad__new_drawing',{}); calls.length=0;
  return {root,owner,ctx,calls,layers,setReadFails(){readFails=true;},async cleanup(){await owner.dispose();await ctx.fiber.dispose();await rm(root,{recursive:true});}};
}
const args={points:[[0,0,0],[10,0,0],[10,5,0]],closed:true,layer:'HOUSE'};

test('missing layer and failed dependency read stop before CAD mutation without freezing',async()=>{
  const f=await fixture();try{
    const rejected=await invokeTool(f.ctx,'mcp__autocad__draw_polyline',args);
    assert.equal(rejected.isError,true);assert.match(JSON.stringify(rejected),/CAD_LAYER_NOT_FOUND/);
    assert.deepEqual(f.calls,['list_layers']);assert.equal(f.owner.facts().frozen,false);
    assert.equal(f.owner.facts().operations.at(-1)?.dispatched,false);
    await invokeTool(f.ctx,'mcp__autocad__create_layer',{name:'HOUSE'});
    assert.equal((await invokeTool(f.ctx,'mcp__autocad__draw_polyline',args)).isError,false);
    assert.equal(f.calls.filter(n=>n==='draw_polyline').length,1);
    f.setReadFails();const failed=await invokeTool(f.ctx,'mcp__autocad__draw_polyline',args);
    assert.equal(failed.isError,true);assert.equal(f.owner.facts().frozen,false);
    assert.equal(f.calls.filter(n=>n==='draw_polyline').length,1);
  }finally{await f.cleanup();}
});

test('real DSH loop can correct a missing layer then draw once, without automatic hidden writes',async()=>{
  const f=await fixture();process.env.CADER_DEPENDENCY_FIXTURE='offline-only';let step=0;
  const config=await loadConfig(process.cwd());
  const runtime=await createLiveRuntime({root:process.cwd(),workspaceRoot:f.root,runDirectory:join(f.root,'.cader/runs/dsh'),...config,
    profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_DEPENDENCY_FIXTURE'})),executionTools:f.owner.definitions(),permissionMode:'workspace-write'});
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    const next=step++;
    if(next<3){
      if(next===1)assert.match(JSON.stringify(request.messages),/CAD_LAYER_NOT_FOUND/);
      const name=next===1?'create_layer':'draw_polyline',payload=next===1?{name:'HOUSE'}:args;
      const id=`dependency-${next}` as Extract<StreamChunk,{type:'tool-call-delta'}>['id'];
      const text=JSON.stringify(payload);
      yield {type:'block-start',index:0,blockType:'tool-call'};
      yield {type:'tool-call-delta',index:0,id,name:`mcp__autocad__${name}`,argumentsDelta:text};
      yield {type:'block-end',index:0,block:{type:'tool-call',id,name:`mcp__autocad__${name}`,arguments:text}};
      yield {type:'finish',reason:{kind:'tool-calls'}};return;
    }
    yield {type:'block-start',index:0,blockType:'text'};
    yield {type:'block-end',index:0,block:{type:'text',text:'Synthetic corrected call; no real CAD acceptance'}};
    yield {type:'finish',reason:{kind:'stop'}};
  });
  try{
    await runtime.run('MainAgent','Run synthetic dependency correction');
    assert.equal(step,4);assert.equal(f.calls.filter(n=>n==='draw_polyline').length,1);
    assert.equal(f.calls.filter(n=>n==='create_layer').length,1);assert.equal(f.owner.facts().frozen,false);
  }finally{await runtime.dispose();delete process.env.CADER_DEPENDENCY_FIXTURE;await f.cleanup();}
});

test('planning QUOTA and missing plan remain explicit failures before drawing or vision',async()=>{
  const f=await fixture();process.env.CADER_DEPENDENCY_FIXTURE='offline-only';
  try{
    for(const quota of [true,false]){
      const phases:unknown[]=[];
      const report=await runTask(process.cwd(),{task:'绘制一个房子',workspaceRoot:f.root,permissionMode:'ask',
        executionTools:[],executionOwner:f.owner,executionState:()=>f.owner.facts(),onEvent:e=>{if(e.type==='task.phase')phases.push(e.phase);}},async options=>{
        const runtime=await createLiveRuntime({...options,profiles:options.profiles.map(p=>({...p,api_key_env:'CADER_DEPENDENCY_FIXTURE'}))});
        runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{
          if(quota)throw new LlmError('synthetic quota','QUOTA');
          yield {type:'block-start',index:0,blockType:'text'};
          yield {type:'block-end',index:0,block:{type:'text',text:'No plan submitted'}};
          yield {type:'finish',reason:{kind:'stop'}};
        });return runtime;
      });
      assert.equal(report.errorCode,quota?'QUOTA':'ACCEPTANCE_PLAN_MISSING');
      assert.deepEqual(report.blocked_reasons,[report.errorCode]);assert.equal(report.quality?.phase,'blocked');
      assert.equal(report.quality?.model_runs.length,1);assert.equal(report.quality?.visual,null);
      assert.match(report.text,/规划.*失败/);assert.doesNotMatch(report.text,/质量验证待通过/);
      assert.deepEqual(phases,['planning','blocked']);assert.deepEqual(f.calls,[]);
    }
  }finally{delete process.env.CADER_DEPENDENCY_FIXTURE;await f.cleanup();}
});
