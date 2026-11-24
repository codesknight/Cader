import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadConfig } from '@cader/config';
import { createLiveRuntime, defineTool, ExecutionBudget } from '@cader/dsh-adapter';
import type { StreamChunk, PublicEvent } from '@cader/dsh-adapter';
import { runQualityTask } from '@cader/profile';
import type { ExecutionSession } from '@cader/profile';

async function config() {
  const loaded=await loadConfig(process.cwd());
  process.env.CADER_BUDGET_FIXTURE='offline-budget-fixture';
  loaded.profiles=loaded.profiles.map(p=>({...p,api_key_env:'CADER_BUDGET_FIXTURE'}));
  return loaded;
}
async function* call(name:string,args:unknown,id:string):AsyncGenerator<StreamChunk>{
  const callId=id as Extract<StreamChunk,{type:'tool-call-delta'}>['id'],argumentsText=JSON.stringify(args);
  yield {type:'block-start',index:0,blockType:'tool-call'};
  yield {type:'tool-call-delta',index:0,id:callId,name,argumentsDelta:argumentsText};
  yield {type:'block-end',index:0,block:{type:'tool-call',id:callId,name,arguments:argumentsText}};
  yield {type:'finish',reason:{kind:'tool-calls'}};
}
const finish=async function*():AsyncGenerator<StreamChunk>{
  yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text:'Fixture draft; requires independent acceptance'};
  yield {type:'block-end',index:0,block:{type:'text',text:'Fixture draft; requires independent acceptance'}};
  yield {type:'finish',reason:{kind:'stop'}};
};

test('semantic work units share a round and cannot reset task or round allowances',async()=>{
  const c=await config();c.runtime.max_execution_rounds=1;let steps=0;
  const runtime=await createLiveRuntime({...c,root:process.cwd(),runDirectory:resolve('.cader/tests/unit-budget-shared')});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{steps++;yield* finish();});
  try{
    assert.equal((await runtime.run('MainAgent','unit one',{harnessTask:true})).status,'succeeded');
    assert.equal((await runtime.run('MainAgent','unit two',{harnessTask:true,keepExecutionRound:true})).status,'succeeded');
    assert.equal(runtime.budgetState().execution_round,1);assert.equal(steps,2);
    assert.equal((await runtime.run('MainAgent','forbidden reset',{harnessTask:true})).handoff?.code,'EXECUTION_ROUND_LIMIT');assert.equal(steps,2);
  }finally{await runtime.dispose();}
});

for(const readFailed of [false,true])test(`final scoped Patch checks in without an extra model request: ${readFailed}`,async()=>{
  const c=await config();let steps=0,writes=0,checked=0;const events:PublicEvent[]=[];
  const runtime=await createLiveRuntime({...c,root:process.cwd(),runDirectory:resolve(`.cader/tests/final-unit-patch-${readFailed}`),onEvent:e=>events.push(e),executionTools:['draw_circle','draw_line'].map(name=>defineTool({name:`mcp__autocad__${name}`,description:'Offline unit fixture',parameters:{radius:{type:'number',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){writes++;return 'acknowledged fixture only';}}))});
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{steps++;assert.ok(!request.tools?.some(t=>t.name==='mcp__autocad__draw_line'));yield* call('cader_apply_cad_patch',{operations:[{tool:'mcp__autocad__draw_circle',arguments:{radius:7}}],unit_complete:true},'unit-last');});
  try{
    const result=await runtime.run('MainAgent','Complete one fixture unit',{harnessTask:true,onlyTools:['mcp__autocad__draw_circle','cader_apply_cad_patch'],completeDrawingUnit:async()=>{if(readFailed)throw new Error('read failed');checked++;},resultText:()=>checked?'Unit check-in only; not acceptance':undefined});
    assert.equal(result.status,'succeeded');assert.equal(steps,1);assert.equal(writes,1);assert.equal(checked,readFailed?0:1);
    assert.equal(events.find(e=>e.type==='tool.result'&&e.tool==='cader_apply_cad_patch')?.isError,readFailed);
    if(readFailed)assert.equal(result.handoff?.code,'DRAWING_UNIT_READBACK_FAILED');
  }finally{await runtime.dispose();}
});

test('incomplete symbol contact returns real patch results without replay or premature check-in',async()=>{
  const c=await config();let steps=0,writes=0,checks=0,checked=false;
  const runtime=await createLiveRuntime({...c,root:process.cwd(),runDirectory:resolve('.cader/tests/incomplete-unit'),executionTools:[defineTool({name:'mcp__autocad__draw_circle',description:'Offline symbol fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){writes++;return 'acknowledged fixture';}})]});
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    if(++steps===1){yield* call('cader_apply_cad_patch',{operations:[{tool:'mcp__autocad__draw_circle',arguments:{}}],unit_complete:true},'incomplete');return;}
    assert.equal(writes,1);assert.match(JSON.stringify(request.messages),/DRAWING_UNIT_INCOMPLETE/);yield* call('fixture_finish',{},'finish');
  });
  try{
    const result=await runtime.run('MainAgent','Fixture only',{harnessTask:true,onlyTools:['mcp__autocad__draw_circle','cader_apply_cad_patch','fixture_finish'],completeDrawingUnit:async()=>{checks++;throw Object.assign(new Error('DRAWING_UNIT_INCOMPLETE: missing observed symbol contact'),{code:'DRAWING_UNIT_INCOMPLETE'});},extraTools:[defineTool({name:'fixture_finish',description:'Fixture retry of check-in without a mutation',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(_a,exec){checked=true;exec.concludeTurn();return 'fixture checkpoint';}})],resultText:()=>checked?'Unit checked in, not accepted':undefined});
    assert.equal(result.status,'succeeded');assert.equal(writes,1);assert.equal(steps,2);assert.equal(checks,1);
  }finally{await runtime.dispose();}
});

test('layered reservations protect validation, atomic patches and cumulative limits across rounds',async()=>{
  const c=await config();Object.assign(c.runtime,{max_tool_calls:10,validation_tool_reserve:2,max_task_tool_calls:20,max_cad_operations_per_round:6,max_cad_operations:8,max_execution_rounds:3,max_task_tokens:50});
  const b=new ExecutionBudget(c.runtime);
  assert.equal(b.beginRound(),undefined);
  assert.equal(b.admit(7,4),undefined);
  const before=b.snapshot();
  assert.equal(b.admit(3,3),'EXECUTION_ROUND_EXHAUSTED');
  assert.deepEqual(b.snapshot(),before); // No partial reservation.
  assert.equal(b.admit(1,0),undefined);
  assert.equal(b.admit(1,0),'EXECUTION_ROUND_EXHAUSTED');
  assert.equal(b.admit(2,0,true),undefined); // Reserved validation allowance.
  b.beginRound();assert.equal(b.admit(5,4),undefined);
  assert.equal(b.admit(1,1),'TASK_CAD_BUDGET_EXCEEDED');
  b.beginRound();assert.equal(b.admit(4,0),'TASK_TOOL_BUDGET_EXCEEDED');
  assert.equal(b.beginRound(),'EXECUTION_ROUND_LIMIT');
  b.recordTokens(50);assert.equal(b.taskStop(),'TASK_TOKEN_BUDGET_EXCEEDED');
});

test('actual DSH hands off an untouched whole patch, drains it once before fresh model work, and shares task limits',async()=>{
  const c=await config();Object.assign(c.runtime,{max_cad_operations_per_round:4,max_cad_operations:7});
  const writes:number[]=[],events:PublicEvent[]=[];let step=0;
  const runtime=await createLiveRuntime({...c,root:process.cwd(),runDirectory:resolve('.cader/tests/budget-rollover'),onEvent:e=>events.push(e),
    executionTools:[defineTool({name:'mcp__autocad__draw_circle',description:'Fixture only, no real CAD',parameters:{radius:{type:'number',required:true}},
      output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(a){writes.push(a.radius);return JSON.stringify({fixture:true,radius:a.radius});}})]});
  runtime.ctx.on('llm/stream',async function*(options):AsyncGenerator<StreamChunk>{
    step++;
    if(step<=2){yield* call('cader_apply_cad_patch',{operations:[1,2,3].map(n=>({tool:'mcp__autocad__draw_circle',arguments:{radius:n+(step-1)*3}}))},`patch-${step}`);return;}
    assert.deepEqual(writes,[1,2,3,4,5,6]);
    assert.ok(JSON.stringify(options.messages).includes('continuation_results'));
    yield* finish();
  });
  try{
    const first=await runtime.run('MainAgent','Fixture drawing',{harnessTask:true});
    assert.equal(first.handoff?.code,'EXECUTION_ROUND_EXHAUSTED');
    assert.deepEqual(writes,[1,2,3]);assert.equal(step,2);
    assert.equal(runtime.budgetState().pending.length,1);
    assert.equal((await runtime.run('MainAgent','Continue fixture',{harnessTask:true,continuePending:true})).status,'succeeded');
    assert.deepEqual(writes,[1,2,3,4,5,6]);assert.equal(runtime.budgetState().pending.length,0);
    assert.equal(events.filter(e=>e.type==='budget.continue_dispatch').length,1);
    assert.equal(runtime.budgetState().cad_reservations,6);
  }finally{await runtime.dispose();}
});

for(const scenario of ['preflight','unknown','changed-binding','no-ledger'] as const)test(`queued Patch failure resumes only with proven pre-dispatch rejection: ${scenario}`,async()=>{
  const c=await config();c.runtime.max_cad_operations_per_round=4;
  const writes:number[]=[],operations:{operation_id:string;outcome:string;dispatched:boolean}[]=[],events:PublicEvent[]=[];
  let step=0,frozen=false,connection='original';
  const runtime=await createLiveRuntime({...c,root:process.cwd(),runDirectory:resolve(`.cader/tests/queued-rejection-${scenario}`),onEvent:e=>events.push(e),
    executionState:scenario==='no-ledger'?undefined:()=>({frozen,local_connection_id:connection,scratch:'owned.dwg',operations}),
    executionTools:[defineTool({name:'mcp__autocad__draw_circle',description:'Synthetic ledger only; no real CAD',parameters:{radius:{type:'number',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(a){
      if(a.radius===99){
        if(scenario==='unknown')frozen=true;
        if(scenario==='changed-binding')connection='other';
        operations.push({operation_id:`op-${operations.length}`,outcome:frozen?'unknown':'failed_before_dispatch',dispatched:frozen});
        throw new Error('Synthetic rejected proposal; original Patch must not be replayed');
      }
      writes.push(a.radius);operations.push({operation_id:`op-${operations.length}`,outcome:'committed',dispatched:true});return 'fixture acknowledged';
    }})]});
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    step++;
    if(step<=2){yield* call('cader_apply_cad_patch',{operations:(step===1?[1,2,3]:[4,99,6]).map(radius=>({tool:'mcp__autocad__draw_circle',arguments:{radius}}))},`queued-${step}`);return;}
    assert.equal(scenario,'preflight');assert.match(JSON.stringify(request.messages),/returned_for_replanning/);
    assert.deepEqual(writes,[1,2,3,4]);
    yield* call('cader_apply_cad_patch',{operations:[5,6].map(radius=>({tool:'mcp__autocad__draw_circle',arguments:{radius}})),unit_complete:true},'corrected-missing-only');
    // End after the corrected Patch to avoid an unrelated model step.
  });
  try{
    assert.equal((await runtime.run('MainAgent','Fixture',{harnessTask:true})).handoff?.code,'EXECUTION_ROUND_EXHAUSTED');
    let checked=false;
    const continuation={harnessTask:true,continuePending:true,completeDrawingUnit:async()=>{checked=true;},resultText:()=>checked?'fixture unit checked':undefined};
    let result=await runtime.run('MainAgent','Continue without replay',continuation);
    if(scenario==='preflight'){
      // Failed leaf reservations remain spent. Corrected operations may need
      // another round; this must not replay the earlier committed leaves.
      assert.equal(result.handoff?.code,'EXECUTION_ROUND_EXHAUSTED');
      result=await runtime.run('MainAgent','Continue corrected missing operations',continuation);
      assert.equal(result.status,'succeeded');assert.deepEqual(writes,[1,2,3,4,5,6]);assert.equal(step,3);
      assert.equal(events.filter(e=>e.type==='budget.continuation_replan').length,1);
    }else{
      assert.equal(result.errorCode,'CONTINUATION_OPERATION_FAILED');assert.equal(result.status,'failed');assert.equal(step,2);assert.deepEqual(writes,[1,2,3,4]);
    }
    assert.equal(operations.filter(op=>op.outcome==='failed_before_dispatch'||op.outcome==='unknown').length,1);
    assert.equal(runtime.budgetState().pending.length,0);
  }finally{await runtime.dispose();}
});

test('Scheduler rollover keeps task authorization, connection and document, then independently accepts',async()=>{
  const c=await config();Object.assign(c.runtime,{max_cad_operations_per_round:3,max_cad_operations:10});
  let created=0,approvals=0,ended=0,step=0,visualCalls=0,failedPostRead=false;
  const writes:number[]=[],saved:unknown[]=[],events:PublicEvent[]=[];
  const task='画四个圆';
  const plan={version:1,domain:'generic',wire_layer:'NONE',components:[],visual_required:false,
    requirements:[{id:'count',source_quote:task,description:'Four circles',check:'entity_count',entity_type:'AcDbCircle',min:4}]};
  const runtime=await createLiveRuntime({...c,root:process.cwd(),runDirectory:resolve('.cader/tests/budget-scheduler'),captureCadView:async()=>{throw new Error('Use controlled fixture review');},executionTools:[
    defineTool({name:'mcp__autocad__draw_circle',description:'Fixture',parameters:{radius:{type:'number',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(a){writes.push(a.radius);return 'fixture';}})]});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{
    step++;
    if(step===1){yield* call('cader_submit_acceptance_plan',plan,'plan');return;}
    if(step<=3){yield* call('cader_apply_cad_patch',{operations:[1,2].map(radius=>({tool:'mcp__autocad__draw_circle',arguments:{radius:radius+(step-2)*2}}))},`patch-${step}`);return;}
    if(step===4){yield* call('cader_review_cad_view',{question:'Review actual fixture geometry'},'review');return;}
    throw new Error('Must hand off instead of spending another model step');
  });
  // The plan controller requires visual checks for all drawings. Use a strict
  // visual fixture so the Scheduler must still perform independent acceptance.
  (plan as any).visual_required=true;(plan.requirements as any[]).push({id:'appearance',source_quote:task,description:'Recognizable circles',check:'visual'});
  const facts=()=>({frozen:false,local_connection_id:'same-connection',scratch:'fixture.dwg',session_counts:{committed:writes.length,unknown:0}});
  const owner={facts,workspace:process.cwd(),async authorizeTask(){approvals++;return true;},endTask(){ended++;},
    taskScope:()=>({owned:true,new_drawing_confirmed:true,geometry_confirmed:writes.length,entity_ids:writes.map((_,i)=>i+1)}),
    async snapshot(){created++;if(visualCalls&&!failedPostRead){failedPostRead=true;throw new Error('post-review read failure');}return {document:'fixture.dwg',entities:writes.map((_,i)=>({object_id:i+1,type:'AcDbCircle'}))};}} as unknown as ExecutionSession;
  const visual={review_valid:true,structured:{verdict:'pass',defects:[],checklist:[{requirement_id:'appearance',status:'pass',evidence:'Fixture appearance checked'}],uncertainties:[]},evidence:{},attempts:[]};
  runtime.reviewCadView=async()=>{visualCalls++;return visual as any;};
  try{
    const result=await runQualityTask({runtime,owner,profile:'MainAgent',task,emit:e=>events.push(e),persist:async state=>{saved.push(structuredClone(state));}});
    assert.equal(result.phase,'complete');assert.equal(approvals,1);assert.equal(ended,1);
    assert.deepEqual(writes,[1,2,3,4]);assert.ok(created>=4);
    assert.equal(result.checkpoints.length,1);assert.equal(events.filter(e=>e.type==='task.checkpoint').length,1);
    assert.ok(saved.some((s:any)=>s.checkpoints?.length&&s.budget.pending.length===1));
    assert.equal(visualCalls,1);assert.equal(failedPostRead,true);assert.equal(step,4);
  }finally{await runtime.dispose();}
});

test('failed controlled review yields immediately instead of allowing more drawing',async()=>{
  const c=await config();let steps=0;
  const runtime=await createLiveRuntime({...c,root:process.cwd(),runDirectory:resolve('.cader/tests/review-failed-handoff'),captureCadView:async()=>{throw new Error('raw capture forbidden');}});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{steps++;yield* call('cader_review_cad_view',{question:'Fixture'},'failed-review');});
  try{
    const result=await runtime.run('MainAgent','Review',{harnessTask:true,reviewEndsTurn:true,controlledReview:async()=>{throw new Error('postflight read failed');}});
    assert.equal(result.handoff?.code,'VISUAL_REVIEW_FAILED');assert.equal(result.status,'succeeded');assert.equal(steps,1);
    assert.match(result.text,/task_complete.*false/);
  }finally{await runtime.dispose();}
});

test('exact round exhaustion yields before the next paid request, even without a rejected operation',async()=>{
  const c=await config();c.runtime.max_cad_operations_per_round=1;
  let steps=0,writes=0;
  const runtime=await createLiveRuntime({...c,root:process.cwd(),runDirectory:resolve('.cader/tests/budget-exact'),executionTools:[
    defineTool({name:'mcp__autocad__draw_circle',description:'Fixture',parameters:{radius:{type:'number',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(){writes++;return 'fixture';}})]});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{
    if(++steps===1)yield* call('mcp__autocad__draw_circle',{radius:1},'exact');else yield* finish();
  });
  try{
    const first=await runtime.run('MainAgent','Draw',{harnessTask:true});
    assert.equal(first.handoff?.code,'EXECUTION_ROUND_EXHAUSTED');assert.equal(steps,1);assert.equal(writes,1);
    assert.equal(runtime.budgetState().pending.length,0);
    assert.equal((await runtime.run('MainAgent','Continue',{harnessTask:true,continuePending:true})).status,'succeeded');
    assert.equal(writes,1);assert.equal(steps,2);
  }finally{await runtime.dispose();}
});

for(const scenario of ['total-limit','unknown-write','connection-change','read-failed'] as const){
  test(`Scheduler never renews unsafely: ${scenario}`,async()=>{
    let calls=0,approvals=0,connection='original',frozen=false,ended=0;
    const saved:any[]=[];
    const task='画一个圆';
    const plan={version:1,domain:'generic',wire_layer:'NONE',components:[],visual_required:true,
      requirements:[{id:'appearance',source_quote:task,description:'A circle',check:'visual'}]};
    const runtime={
      async run(_profile:string,_instruction:string,request:any){
        calls++;
        if(calls===1){await request.extraTools[0].execute(plan,{concludeTurn(){}});return {status:'succeeded',text:'fixture plan',tools:[]};}
        if(calls>2)throw new Error('Must not start a continuation');
        if(scenario==='unknown-write')frozen=true;
        return {status:'succeeded',text:'handoff',tools:[],handoff:{kind:'budget',code:scenario==='total-limit'?'TASK_CAD_BUDGET_EXCEEDED':'EXECUTION_ROUND_EXHAUSTED',renewable:scenario!=='total-limit'}};
      },
      budgetState:()=>({execution_round:1,pending:[{tool:'fixture-never-dispatched'}]}),
    };
    const owner={workspace:process.cwd(),facts:()=>({frozen,local_connection_id:connection,scratch:'original.dwg',operations:[{operation_id:'confirmed',outcome:'committed'}]}),
      async authorizeTask(){approvals++;return true;},endTask(){ended++;},
      async snapshot(){if(scenario==='read-failed')throw new Error('native read unavailable');return {document:'original.dwg',entities:[]};}};
    const result=await runQualityTask({runtime,owner,task,profile:'MainAgent',emit(){},persist:async(state:any)=>{
      saved.push(structuredClone(state));
      if(scenario==='connection-change'&&state.checkpoints.length)connection='different';
    }} as unknown as Parameters<typeof runQualityTask>[0]);
    assert.equal(calls,2);assert.equal(approvals,1);assert.equal(ended,1);
    assert.equal(result.quality_accepted,false);
    if(scenario==='total-limit'){
      assert.equal(result.phase,'pending_verification');assert.equal(result.failure?.code,'TASK_CAD_BUDGET_EXCEEDED');
      assert.ok(saved.some(s=>s.checkpoints.length&&s.execution.operations[0].operation_id==='confirmed'));
    }
    if(scenario==='unknown-write')assert.equal(result.phase,'blocked');
    if(scenario==='read-failed')assert.equal((result.checkpoints[0] as any).observation_error,'CHECKPOINT_READBACK_FAILED');
  });
}

for(const scenario of ['task-cad-limit','model-step-limit'] as const){
  test(`actual DSH keeps pending CAD untouched at total task stop: ${scenario}`,async()=>{
    const c=await config();c.runtime.max_cad_operations_per_round=4;
    if(scenario==='task-cad-limit')c.runtime.max_cad_operations=4;
    else c.runtime.max_model_steps=2;
    const writes:number[]=[];let step=0;
    const runtime=await createLiveRuntime({...c,root:process.cwd(),runDirectory:resolve(`.cader/tests/${scenario}`),executionTools:[
      defineTool({name:'mcp__autocad__draw_circle',description:'Fixture',parameters:{radius:{type:'number',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(a){writes.push(a.radius);return 'fixture';}})]});
    runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{
      step++;
      yield* call('cader_apply_cad_patch',{operations:[1,2,3].map(radius=>({tool:'mcp__autocad__draw_circle',arguments:{radius:radius+(step-1)*3}}))},`stop-${step}`);
    });
    try{
      let result=await runtime.run('MainAgent','Fixture',{harnessTask:true});
      assert.deepEqual(writes,[1,2,3]);
      if(scenario==='model-step-limit'){
        assert.equal(result.handoff?.renewable,true);
        result=await runtime.run('MainAgent','Continue',{harnessTask:true,continuePending:true});
      }
      assert.equal(result.handoff?.renewable,false);
      assert.equal(result.handoff?.code,scenario==='task-cad-limit'?'TASK_CAD_BUDGET_EXCEEDED':'MODEL_STEP_BUDGET_EXCEEDED');
      assert.deepEqual(writes,[1,2,3]);assert.equal(step,2);assert.equal(runtime.budgetState().pending.length,1);
    }finally{await runtime.dispose();}
  });
}
