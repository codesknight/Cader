import test from 'node:test';
import assert from 'node:assert/strict';
import {runQualityTask} from '@cader/profile';
import {createLiveRuntime} from '@cader/dsh-adapter';
import {loadConfig} from '@cader/config';
import type {StreamChunk} from '@cader/dsh-adapter';
import {resolve} from 'node:path';
const plan={version:1,domain:'generic',components:[],visual_required:true,requirements:[{id:'appearance',source_quote:'画图',description:'fixture',check:'visual'}]};
for(const scenario of ['no-dispatch','committed','unknown','connection-change','read-failed','exhausted','response-timeout','malformed-committed','malformed-unknown','malformed-exhausted'] as const)test(`truncation recovery preserves ledger and fails closed: ${scenario}`,async()=>{
  let drawingRuns=0,committed=0,frozen=false,connection='original',approvals=0;
  const complete:any[]=[],saved:any[]=[];
  const runtime={completed:()=>complete,async run(_profile:string,instruction:string,request:any){
    if(request.onlyTools){await request.extraTools[0].execute(plan,{concludeTurn(){}});return {status:'succeeded',tools:[],text:'plan'};}
    drawingRuns++;
    if(drawingRuns===1||['exhausted','malformed-exhausted'].includes(scenario)){
      if(['committed','malformed-committed'].includes(scenario))committed=1;
      if(['unknown','malformed-unknown'].includes(scenario))frozen=true;
      if(scenario==='connection-change')connection='foreign';
      const result={id:`truncated-${drawingRuns}`,status:'failed',errorCode:scenario.startsWith('malformed')?'MALFORMED_RESPONSE':scenario==='response-timeout'?'TIMEOUT':'OUTPUT_TRUNCATED',text:'',tools:[]};complete.push(result);return result;
    }
    assert.match(instruction,/Scheduler响应恢复/);assert.equal(request.continuePending,false);
    assert.equal(committed,['committed','malformed-committed'].includes(scenario)?1:0); // no replay of acknowledged operation
    committed=1;const result={id:'recovery',status:'succeeded',text:'draft',tools:[]};complete.push(result);return result;
  },async reviewCadView(){return {review_valid:true,attempts:[],structured:{verdict:'pass',defects:[],uncertainties:[],checklist:[{requirement_id:'appearance',status:'pass',evidence:'fixture'}]},evidence:{}};}};
  const owner={workspace:process.cwd(),facts:()=>({frozen,local_connection_id:connection,scratch:'fixture.dwg',session_counts:{committed,unknown:frozen?1:0},operations:committed?[{operation_id:'keep',outcome:'committed'}]:[]}),
    taskScope:()=>({owned:true,new_drawing_confirmed:true,geometry_confirmed:committed,entity_ids:[1]}),
    async authorizeTask(){approvals++;return true;},endTask(){},async snapshot(){if(scenario==='read-failed')throw new Error('read failed');return {document:'fixture.dwg',entities:committed?[{object_id:1,type:'AcDbCircle'}]:[]};}};
  const result=await runQualityTask({runtime,owner,task:'画图',profile:'fixture',emit(){},persist:async (state:unknown)=>{saved.push(structuredClone(state));}} as unknown as Parameters<typeof runQualityTask>[0]);
  assert.equal(approvals,1);
  if(['no-dispatch','committed','response-timeout','malformed-committed'].includes(scenario)){
    assert.equal(result.phase,'complete');assert.equal(drawingRuns,2);assert.equal(result.checkpoints.length,1);assert.equal(complete[0].status,'failed');assert.equal(complete[0].recovered_by,'recovery');
    assert.ok(saved.some(s=>s.checkpoints.length&&s.phase==='drawing'));
  }else{
    assert.equal(result.quality_accepted,false);assert.equal(drawingRuns,['exhausted','malformed-exhausted'].includes(scenario)?3:1);
    if(['exhausted','malformed-exhausted'].includes(scenario))assert.equal(result.failure?.code,scenario==='malformed-exhausted'?'MALFORMED_RESPONSE':'OUTPUT_TRUNCATED');
    if(scenario==='read-failed')assert.equal((result.checkpoints[0] as any).observation_error,'CHECKPOINT_READBACK_FAILED');
  }
});
test('real DSH adapter yields on max-tokens before another provider step, without inventing a tool result',async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_TRUNCATION_FIXTURE='offline-truncation';let steps=0;
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/truncated-output'),profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_TRUNCATION_FIXTURE'}))});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{steps++;yield {type:'finish',reason:{kind:'max-tokens'}};});
  try{const result=await runtime.run('MainAgent','fixture',{harnessTask:true});assert.equal(result.errorCode,'OUTPUT_TRUNCATED');assert.equal(result.status,'failed');assert.equal(steps,1);assert.deepEqual(result.tools,[]);}
  finally{await runtime.dispose();delete process.env.CADER_TRUNCATION_FIXTURE;}
});
