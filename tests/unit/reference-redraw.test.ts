import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { InteractiveSession, ExecutionSession, runTask, runQualityTask, requiresQuality, referencedPaths,referenceLayoutHints } from '@cader/profile';
import { createLiveRuntime, prepareImageView, createToolRuntime, invokeTool } from '@cader/dsh-adapter';
import type { ToolDefinition, createMcpClient, StreamChunk, PublicEvent } from '@cader/dsh-adapter';
import {readReferenceImage,parseReferenceObservation} from '@cader/config';

const observation={version:1,drawing_kind:'other',summary:'Synthetic source fixture',coordinate_system:'normalized-image-top-left-y-down',content_bounds:[[0,0],[1,1]],objects:[{id:'object',kind:'fixture',bounds:[[0.2,0.2],[0.8,0.8]],terminals:[],certainty:'clear'}],visible_text:[],connections:[],unknowns:[]};

test('source layout hints invert image Y while preserving rectangular pixel aspect ratio',()=>{
  const source=parseReferenceObservation({...observation,objects:[{...observation.objects[0],terminals:[[0.5,0.2],[0.5,0.8]]}]});
  const hints=referenceLayoutHints(source,{width:100,height:200});
  assert.deepEqual(hints.objects[0]!.bounds,[[200,400],[800,1600]]);
  assert.deepEqual(hints.objects[0]!.terminals,[[500,1600],[500,400]]);
});

async function setup(){
  await mkdir('.cader/tests',{recursive:true});
  const root=await mkdtemp(resolve('.cader/tests/redraw-'));
  await cp('configs',join(root,'configs'),{recursive:true,filter:path=>! /\.local\.(yaml|json)$/.test(path)});
  await cp('benchmark/fixtures/vision-calibration.png',join(root,'reference.png'));
  return {root,async cleanup(){await rm(root,{recursive:true});}};
}

test('explicit external image is imported as pixels without extending workspace scope; pending request survives selection',async()=>{
  const f=await setup();await mkdir(join(f.root,'work'));
  let input:Parameters<typeof runTask>[1]|undefined;
  const chat=await InteractiveSession.create(f.root,join(f.root,'work'),async(_root,task)=>{input=task;throw new Error('STOP_BEFORE_MODEL');});
  try{
    const request=`新建一个图层，帮我复现这张图：${join(f.root,'reference.png')} 保存为 result.dwg`;
    await assert.rejects(chat.execute(request),/STOP_BEFORE_MODEL/);
    assert.ok(input?.image?.startsWith(join(f.root,'work','.cader','references')));
    assert.equal(input?.referenceTask?.request,request);
    assert.equal(input?.referenceTask?.outputPath,join(f.root,'work','result.dwg'));
    const selected=await readFile(input!.image!);await writeFile(join(f.root,'reference.png'),'changed original');
    assert.deepEqual(await readFile(input!.image!),selected,'selected snapshot is immutable even when the source changes');
    assert.equal(chat.state.workspace,join(f.root,'work'));
    await chat.execute('/clear');
    assert.equal((await chat.execute('根据手稿复现成DWG')).error,true);
    assert.equal(chat.state.pendingRedrawRequest,'根据手稿复现成DWG');
    await cp('benchmark/fixtures/vision-calibration.png',join(f.root,'work','next.png'));
    await chat.execute('/open next.png');
    await assert.rejects(chat.execute('继续'),/STOP_BEFORE_MODEL/);
    assert.equal(input!.originalTask,'根据手稿复现成DWG');
    assert.ok(input!.image);assert.equal(requiresQuality('新建一个图层，帮我复现这张图'),true);
  }finally{await chat.dispose();await f.cleanup();}
});

test('Windows quoted and plain reference paths are extracted without turning the whole request into a file name',()=>{
  assert.deepEqual(referencedPaths('帮我复现这张图：D:\\photos\\draft.jpg'),['D:\\photos\\draft.jpg']);
  assert.deepEqual(referencedPaths('根据 "D:\\my photos\\draft.jpg" 画图'),['D:\\my photos\\draft.jpg']);
  assert.deepEqual(referencedPaths('根据 @"drawing with space.png" 重绘'),['drawing with space.png']);
});

test('a successful model answer with no new drawing or geometry cannot inspect or accept the old drawing',async()=>{
  const f=await setup();let drawingAttempts=0,queries=0;
  const client:typeof createMcpClient=async()=>({definitions:()=>[],toolNames:()=>[],async dispose(){},async call(name){if(name!=='get_backend_status')queries++;return {};}});
  const owner=new ExecutionSession(f.root,join(f.root,'.cader/runs/noop'),undefined,client);owner.mode='full-access';
  await owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
  const image=await readFile(join(f.root,'reference.png'));
  const runtime={async inspectReference(path:string){const pixels=await readReferenceImage(f.root,path);return {valid:true,structured:observation,evidence:{path,sha256:createHash('sha256').update(pixels.data).digest('hex'),width:pixels.width,height:pixels.height}};},async run(_profile:string,_instruction:string,request?:{extraTools?:ToolDefinition[]}){
    if(request?.extraTools)await request.extraTools[0]!.execute({version:1,domain:'generic',requirements:[{id:'v',source_quote:'复现',description:'source appearance',check:'visual'}],components:[],visual_required:true},{concludeTurn(){}} as never);
    else drawingAttempts++;
    return {status:'succeeded',text:'Model claims it drew; fixture has no operations',tools:[]};
  },async reviewCadView(){throw new Error('MUST_NOT_REVIEW_OLD_DRAWING');}};
  try{
    const q=await runQualityTask({runtime:runtime as never,owner,task:'复现参考图',profile:'fixture',emit(){},persist:async()=>{},referenceTask:{request:'复现参考图',image:{path:join(f.root,'reference.png'),sha256:createHash('sha256').update(image).digest('hex'),width:640,height:480},outputPath:join(f.root,'no.dwg'),freshDrawing:true}});
    assert.equal(q.phase,'blocked');assert.equal(q.failure?.code,'TASK_EXECUTION_REQUIRED');
    assert.equal(queries,0);assert.equal(drawingAttempts,2);assert.equal(q.artifact,null);
    assert.equal(owner.facts().frozen,false);
  }finally{await owner.dispose();await f.cleanup();}
});

test('Agent open_image emits pixels and enables crop tools without a prior CLI image reference',async()=>{
  const f=await setup();process.env.CADER_OPEN_IMAGE_FIXTURE='offline-image-only';let steps=0,sawPixels=false;
  const config=await import('@cader/config').then(m=>m.loadConfig(f.root));
  const runtime=await createLiveRuntime({root:f.root,workspaceRoot:f.root,runDirectory:join(f.root,'.cader/runs/open'),...config,
    profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_OPEN_IMAGE_FIXTURE'}))});
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    if(steps++===0){yield* call('cader_open_image',{path:'reference.png'},'open');return;}
    const blocks=JSON.parse(JSON.stringify(request.messages)).flatMap((m:{content:unknown[]})=>m.content);
    sawPixels=blocks.some((b:{type:string})=>b.type==='image');
    assert.ok(request.tools?.some(t=>t.name==='cader_view_image'));
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'Image pixels received'};
    yield {type:'block-end',index:0,block:{type:'text',text:'Image pixels received'}};yield {type:'finish',reason:{kind:'stop'}};
  });
  try{const result=await runtime.run('MainAgent','Inspect workspace reference.png');assert.equal(result.status,'succeeded');assert.equal(sawPixels,true);}
  finally{await runtime.dispose();delete process.env.CADER_OPEN_IMAGE_FIXTURE;await f.cleanup();}
});

function* call(name:string,args:unknown,id:string):Generator<StreamChunk>{
  const typed=id as Extract<StreamChunk,{type:'tool-call-delta'}>['id']; const json=JSON.stringify(args);
  yield {type:'block-start',index:0,blockType:'tool-call'};
  yield {type:'tool-call-delta',index:0,id:typed,name,argumentsDelta:json};
  yield {type:'block-end',index:0,block:{type:'tool-call',id:typed,name,arguments:json}};
  yield {type:'finish',reason:{kind:'tool-calls'}};
}

for(const kind of ['complete','pending','quota'])test(`actual DSH reference task binds fresh CAD and verified DWG: ${kind}`,async()=>{
  const initiallyPending=kind==='pending';
  const f=await setup(); const previous=process.env.CADER_REDRAW_FIXTURE;process.env.CADER_REDRAW_FIXTURE='offline-redraw-only';
  const events:PublicEvent[]=[],calls:string[]=[];let target='Old.dwg',steps=0,planningImages=0,reviewImages=0,reviewCalls=0,reportAttempts=0;
  const old=[{object_id:7,type:'AcDbCircle',layer:'0'}];let entities:Record<string,unknown>[]=old;
  const snapshot=Buffer.from((await prepareImageView(f.root,'reference.png',{rotation:90})).data);
  const defs:ToolDefinition[]=['new_drawing','draw_line','save_drawing','list_layers','query_entities','get_entity','get_backend_status','export_current_view'].map(name=>({
    name:`mcp__autocad__${name}`,description:'Synthetic MCP; no real CAD',parameters:{type:'object'},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},execute:async()=>{throw new Error('owner required');}
  }));
  const client:typeof createMcpClient=async()=>({definitions:()=>defs,toolNames:()=>defs.map(t=>t.name.split('__').at(-1)!),async dispose(){},
    async call(name,args){calls.push(name);
      if(name==='new_drawing'){target='Fresh.dwg';entities=[];return target;}
      if(name==='draw_line'){entities.push({object_id:42,type:'AcDbLine',layer:'0',start_point:[0,0,0],end_point:[10,0,0]});return 'draw_line ok, object_id=42';}
      if(name==='list_layers')return ['0'];
      if(name==='query_entities')return structuredClone(entities);
      if(name==='get_entity')return structuredClone(entities.find(e=>e.object_id===args.object_id));
      if(name==='save_drawing'){await writeFile(String(args.file_path),'AC1032 synthetic test only, not a usable DWG');return 'saved fixture';}
      if(name==='export_current_view'){await writeFile(String(args.file_path),snapshot);return args.file_path;}
      return {backend:'com'};
    }});
  const factory:typeof createLiveRuntime=async options=>{
    const runtime=await createLiveRuntime({...options,profiles:options.profiles.map(p=>({...p,api_key_env:'CADER_REDRAW_FIXTURE'}))});
    runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
      const images=JSON.parse(JSON.stringify(request.messages)).flatMap((m:{content:unknown[]})=>m.content).filter((b:{type:string})=>b.type==='image');
      if(request.tools?.some(t=>t.name==='cader_submit_reference_observation')){
        assert.ok(images.length);yield* call('cader_submit_reference_observation',observation,'observation');return;
      }
      if(request.tools?.some(t=>t.name==='cader_submit_acceptance_plan')){
        planningImages=images.length;assert.ok(planningImages>=1);
        yield* call('cader_submit_acceptance_plan',{version:1,domain:'generic',requirements:[{id:'appearance',source_quote:'复现',description:'Match the supplied synthetic source',check:'visual'},{id:'new',source_quote:'新建空白图纸',description:'New task drawing',check:'new_document'},{id:'saved',source_quote:'result.dwg',description:'Requested file',check:'saved_dwg'}],components:[],visual_required:true},'plan');return;
      }
      if(request.tools?.some(t=>t.name==='cader_submit_visual_report')){
        reviewImages=images.length;assert.equal(reviewImages,2);assert.match(JSON.stringify(request.messages),/ORIGINAL USER REFERENCE/);
        if(reportAttempts++===0){yield* call('cader_submit_visual_report',{verdict:'fail',defects:[{type:'fixture',severity:'major',location:'unknown',evidence:'Synthetic nonexistent ID',suggestion:'Query actual IDs',entity_ids:[9999]}],uncertainties:[],checklist:[]},'bad-id');return;}
        if(reportAttempts===2)assert.match(JSON.stringify(request.messages),/UNKNOWN_REVIEW_ENTITY_ID/);
        const pending=initiallyPending&&reviewCalls++===0;
        yield* call('cader_submit_visual_report',{verdict:pending?'uncertain':'pass',defects:[],uncertainties:pending?['Synthetic unresolved appearance']:[],checklist:[{requirement_id:'appearance',status:pending?'uncertain':'pass',evidence:'Synthetic report only, not a real visual judgement'}]},'review');return;
      }
      assert.ok(!request.tools?.some(t=>t.name.endsWith('__save_drawing')),'model cannot choose another output path');
      const n=steps++;
      if(n===0){yield* call('mcp__autocad__draw_line',{start_x:0,start_y:0,start_z:0,end_x:10,end_y:0,end_z:0},'old-write');return;}
      if(n===1){assert.match(JSON.stringify(request.messages),/NEW_TASK_DRAWING_REQUIRED/);yield* call('mcp__autocad__new_drawing',{},'new');return;}
      if(n===2){yield* call('mcp__autocad__draw_line',{start_x:0,start_y:0,start_z:0,end_x:10,end_y:0,end_z:0},'line');return;}
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'Synthetic geometry ready'};
      yield {type:'block-end',index:0,block:{type:'text',text:'Synthetic geometry ready'}};yield {type:'finish',reason:{kind:'stop'}};
    });
    if(kind==='quota'){
      const run=runtime.run;
      runtime.run=async(...args)=>{const result=await run(...args);if(!args[2]?.onlyTools&&calls.includes('draw_line'))Object.assign(result,{status:'failed',errorCode:'QUOTA'});return result;};
    }
    return runtime;
  };
  const chat=await InteractiveSession.create(f.root,f.root,(root,input)=>runTask(root,input,factory));
  await chat.execution.dispose();chat.execution=new ExecutionSession(f.root,join(f.root,'.cader/runs/owner'),undefined,client);
  await chat.execution.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
  chat.state.mcp=join(f.root,'configs/mcp/AutoCAD.example.yaml');
  let approvals=0;
  try{
    const callbacks={confirm:async()=>{approvals++;return true;},onEvent:(e:PublicEvent)=>events.push(e)};
    let result=await chat.execute('根据 reference.png 复现图形，新建空白图纸并保存为 result.dwg',callbacks);
    if(kind==='quota'){
      const interrupted=JSON.parse(await readFile(chat.state.qualityRun!,'utf8'));
      assert.equal(result.error,true);assert.match(result.text,/QUOTA/);assert.match(result.text,/待验稿/);
      assert.equal(interrupted.phase,'blocked');assert.equal(interrupted.failure.code,'QUOTA');assert.equal(interrupted.quality_accepted,false);
      assert.ok(interrupted.artifact);assert.equal(calls.filter(n=>n==='save_drawing').length,1);assert.equal(interrupted.execution.frozen,false);return;
    }
    if(initiallyPending){
      const pending=JSON.parse(await readFile(chat.state.qualityRun!,'utf8'));
      assert.equal(result.error,true);assert.equal(pending.phase,'pending_verification');assert.equal(pending.quality_accepted,false);assert.ok(pending.artifact);
      result=await chat.execute('继续',callbacks);
    }
    const manifest=JSON.parse(await readFile(chat.state.qualityRun!,'utf8'));
    assert.equal(result.error,false,result.text+'\n'+JSON.stringify(manifest.visual));assert.match(result.text,/DWG已生成并校验/);
    assert.ok(planningImages);assert.equal(reviewImages,2);assert.equal(approvals,initiallyPending?2:1);
    assert.equal(calls.filter(n=>n==='draw_line').length,1);assert.equal(calls.filter(n=>n==='new_drawing').length,1);
    assert.deepEqual(old,[{object_id:7,type:'AcDbCircle',layer:'0'}]);
    assert.equal(manifest.phase,'complete');assert.equal(manifest.execution.frozen,false);
    assert.equal(manifest.reviews[0].source_bound,true);assert.equal(manifest.artifact.path,join(f.root,'result.dwg'));
    assert.equal(manifest.artifact.sha256,createHash('sha256').update(await readFile(join(f.root,'result.dwg'))).digest('hex'));
    const mark=calls.length;await chat.execute('继续');assert.equal(calls.length,mark,'completed task must not replay');
    await writeFile(join(f.root,'replacement.png'),snapshot);await chat.execute('/open replacement.png');
    const switched=await chat.execute('继续');assert.equal(switched.error,true);assert.match(switched.text,/参考图已更换/);assert.equal(calls.length,mark,'a source change must not become an untracked CAD continuation');
  }finally{await chat.dispose();if(previous===undefined)delete process.env.CADER_REDRAW_FIXTURE;else process.env.CADER_REDRAW_FIXTURE=previous;await f.cleanup();}
});

test('frozen-plan wire intersections are rejected before native dispatch without a write barrier',async()=>{
  const f=await setup();let lines=0;
  const names=['new_drawing','draw_line','list_layers'];
  const client:typeof createMcpClient=async()=>({definitions:()=>names.map(name=>({name:`mcp__autocad__${name}`,description:'Synthetic only',parameters:{type:'object'},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},execute:async()=>''})),toolNames:()=>names,async dispose(){},async call(name){if(name==='new_drawing')return 'Fresh.dwg';if(name==='draw_line'){lines++;return 'object_id=42';}if(name==='list_layers')return ['0','WIRE'];return [];}});
  const owner=new ExecutionSession(f.root,join(f.root,'.cader/runs/wire'),undefined,client);owner.mode='full-access';
  const ctx=await createToolRuntime();
  try{
    await owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
    await owner.authorizeTask('wire-test',{version:1,domain:'generic',wire_layer:'WIRE',requirements:[{id:'through',source_quote:'wires',description:'No crossing',check:'no_wire_through_component'}],components:[{id:'component',kind:'generic',ports:[[0,1],[2,1]],bounds:[[0,0],[2,2]]}],visual_required:false});
    for(const tool of owner.definitions())ctx.tools.register(tool);
    assert.equal((await invokeTool(ctx,'mcp__autocad__new_drawing',{})).isError,false);
    const mark=owner.mark();
    assert.equal((await invokeTool(ctx,'mcp__autocad__draw_line',{layer:'WIRE',start_x:-1,start_y:1,start_z:0,end_x:3,end_y:1,end_z:0})).isError,true);
    assert.equal(lines,0);assert.equal(owner.facts().frozen,false);assert.equal(owner.facts(mark).operations[0]?.dispatched,false);
    assert.equal((await invokeTool(ctx,'mcp__autocad__draw_line',{layer:'WIRE',start_x:-1,start_y:1,start_z:0,end_x:0,end_y:1,end_z:0})).isError,false);assert.equal(lines,1);
  }finally{await ctx.fiber.dispose();await owner.dispose();await f.cleanup();}
});
