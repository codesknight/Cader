import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {loadConfig} from '@cader/config';
import {createLiveRuntime,defineTool} from '@cader/dsh-adapter';
import type {StreamChunk,PublicEvent} from '@cader/dsh-adapter';

async function* call(name:string,args:unknown,n:number):AsyncGenerator<StreamChunk>{
 const id=('retry-fixture-'+n) as Extract<StreamChunk,{type:'tool-call-delta'}>['id'],text=JSON.stringify(args);
 yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:text};yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:text}};
}

for(const scenario of [{code:'TRANSPORT',recover:true},{code:'TRANSPORT',recover:false},{code:'QUOTA',recover:false},{code:'AUTH',recover:false}])test(`DSH request retry preserves confirmed tools and discards failed-stream calls: ${scenario.code}, recovery=${scenario.recover}`,async()=>{
 const config=await loadConfig(process.cwd());process.env.CADER_REQUEST_RETRY_FIXTURE='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_REQUEST_RETRY_FIXTURE'}));
 let requests=0,writes=0;const events:PublicEvent[]=[];
 const write=defineTool({name:'mcp__autocad__draw_circle',description:'Deterministic fixture, no native CAD',parameters:{radius:{type:'number',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args){assert.equal(args.radius,1);writes++;return 'CONFIRMED_PREFIX_ACK';}});
 const finish=defineTool({name:'cader_finish_fixture',description:'Read-only fixture completion',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(_args,exec){exec.concludeTurn();return 'Fixture complete';}});
 const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests',`model-request-retry-${scenario.code}-${scenario.recover}`),executionTools:[write],onEvent:e=>events.push(e)});
 runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
  requests++;
  if(requests===1){yield* call(write.name,{radius:1},requests);yield {type:'finish',reason:{kind:'tool-calls'}};return;}
  assert.match(JSON.stringify(request.messages),/CONFIRMED_PREFIX_ACK/);assert.equal(writes,1);
  if(scenario.recover&&requests>2){yield* call(finish.name,{},requests);yield {type:'finish',reason:{kind:'tool-calls'}};return;}
  // Even a syntactically complete call in a FAILED response must not execute.
  yield* call(write.name,{radius:999},requests);
  yield {type:'finish',reason:{kind:'error',failure:{code:scenario.code,message:'Synthetic provider failure; no network request'}}};
 });
 try{
  const result=await runtime.run('MainAgent','Offline request-recovery boundary only',{harnessTask:true,cadAction:true,onlyTools:[write.name,finish.name],extraTools:[finish],maxModelSteps:10,resultText:()=>writes?'Confirmed prefix remains recorded':''});
  assert.equal(writes,1);assert.equal(result.status,scenario.recover?'succeeded':'failed');assert.equal(result.errorCode,scenario.recover?undefined:scenario.code);
  assert.equal(requests,scenario.recover?3:scenario.code==='TRANSPORT'?4:2);
  assert.equal(events.filter(e=>e.type==='model.request_retry').length,scenario.recover?1:scenario.code==='TRANSPORT'?2:0);
  assert.equal(events.filter(e=>e.type==='tool.dispatch'&&e.tool===write.name).length,1);
 }finally{await runtime.dispose();}
});
