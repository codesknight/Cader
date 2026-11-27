import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadConfig,readReferenceImage} from '@cader/config';
import {createLiveRuntime,defineTool,ExecutionBudget} from '@cader/dsh-adapter';
import type {StreamChunk,PublicEvent} from '@cader/dsh-adapter';

test('source-ID alias uses original Patch admission and queues IDs for fresh compilation instead of replaying compiled leaves',async()=>{
 const config=await loadConfig(process.cwd());process.env.CADER_INDEXED_FIXTURE='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_INDEXED_FIXTURE'}));config.runtime={...config.runtime,max_tool_calls:8,validation_tool_reserve:1,max_cad_operations_per_round:4,max_task_tool_calls:40,max_cad_operations:30};
 const writes:number[]=[],compilations:string[][]=[],events:PublicEvent[]=[];let step=0,settled=0;
 const tool=defineTool({name:'mcp__autocad__draw_circle',description:'Fixture only',parameters:{radius:{type:'number',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args){assert.ok(!writes.includes(args.radius));writes.push(args.radius);return 'fixture native ACK';}});
 const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/indexed-source-budget'),executionTools:[tool],onEvent:e=>events.push(e)});
 runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{step++;if(step<=2){yield* call('cader_apply_source_batch',{ids:(step===1?[1,2,3]:[4,5,6]).map(String)},step);return;}yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'Fixture complete, independent acceptance remains'};yield {type:'block-end',index:0,block:{type:'text',text:'Fixture complete'}};yield {type:'finish',reason:{kind:'stop'}};});
 const request={harnessTask:true,onlyTools:[tool.name,'cader_apply_cad_patch'],sourceBatch:{async compile(ids:string[]){compilations.push(ids);assert.ok(ids.every(id=>!writes.includes(Number(id))));return {operations:ids.map(id=>({tool:tool.name,arguments:{radius:Number(id)}}))};},async settled(){settled++;}}};
 try{
  const first=await runtime.run('MainAgent','Fixture only',request);assert.equal(first.handoff?.code,'EXECUTION_ROUND_EXHAUSTED');assert.deepEqual(writes,[1,2,3]);
  assert.equal(runtime.budgetState().pending[0]!.tool,'cader_apply_source_batch');assert.deepEqual(runtime.budgetState().pending[0]!.arguments,{ids:['4','5','6']});
  const next=await runtime.run('MainAgent','Continue fixture',{...request,continuePending:true});assert.equal(next.status,'succeeded');assert.deepEqual(writes,[1,2,3,4,5,6]);assert.equal(compilations.length,3);assert.equal(settled,3);assert.equal(events.filter(e=>e.type==='budget.continue_dispatch').length,1);
 }finally{await runtime.dispose();}
});

test('source alias retains compact authoritative progress instead of recirculating native receipts into model history',async()=>{
 const config=await loadConfig(process.cwd());process.env.CADER_COMPACT_SOURCE='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_COMPACT_SOURCE'}));let steps=0;
 const marker='PRIVATE_NATIVE_RECEIPT_'.repeat(2000),tool=defineTool({name:'mcp__autocad__draw_circle',description:'Fixture only',parameters:{radius:{type:'number',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){return marker;}});
 const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/source-compact-history'),executionTools:[tool]});
 runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{if(++steps===1){yield* call('cader_apply_source_batch',{ids:['source_a']});return;}const messages=JSON.stringify(request.messages);assert.ok(!messages.includes('PRIVATE_NATIVE_RECEIPT_'));assert.match(messages,/source_a/);assert.match(messages,/committed/);yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'Fixture only'};yield {type:'block-end',index:0,block:{type:'text',text:'Fixture only'}};yield {type:'finish',reason:{kind:'stop'}};});
 try{const result=await runtime.run('MainAgent','Fixture only',{harnessTask:true,onlyTools:[tool.name,'cader_apply_cad_patch'],sourceBatch:{async compile(){return {operations:[{tool:tool.name,arguments:{radius:1}}]};},async settled(){},summary:ids=>({items:ids.map(id=>({id,status:'committed',operation_ids:['fixture-op']}))})}});assert.equal(result.status,'succeeded');assert.equal(steps,2);}finally{await runtime.dispose();}
});
async function* call(name:string,args:unknown,index?:number):AsyncGenerator<StreamChunk>{
  const id=('progressive-fixture-call'+(index??'')) as Extract<StreamChunk,{type:'tool-call-delta'}>['id'],argumentsText=JSON.stringify(args);
  yield {type:'block-start',index:0,blockType:'tool-call'};
  yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:argumentsText};
  yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:argumentsText}};
  yield {type:'finish',reason:{kind:'tool-calls'}};
}
test('indexed name-only layer creation uses fresh lookup, while explicit color changes still dispatch and verify',async()=>{
 const config=await loadConfig(process.cwd());process.env.CADER_LAYER_REUSE='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_LAYER_REUSE'}));let steps=0,writes=0,lookups=0,reviews=0;
 const layer=defineTool({name:'mcp__autocad__create_layer',description:'Offline fixture',parameters:{name:{type:'string',required:true},color:{type:'number'}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args){writes++;assert.equal(args.color,1);return 'fixture explicit color acknowledged';}});
 const read=defineTool({name:'mcp__autocad__list_layers',description:'Offline fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){lookups++;return JSON.stringify(['CADER_SOURCE_GEOMETRY']);}});
 const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/layer-reuse-native-not-dispatched'),executionTools:[layer,read]});
 runtime.ctx.on('llm/stream',async function*(req):AsyncGenerator<StreamChunk>{steps++;if(steps===1){yield* call(layer.name,{name:'CADER_SOURCE_GEOMETRY'},steps);return;}assert.match(JSON.stringify(req.messages),/native_creation_dispatched/);if(steps===2){assert.equal(writes,0);assert.equal(reviews,0);yield* call(layer.name,{name:'CADER_SOURCE_GEOMETRY',color:1},steps);return;}yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'Fixture only'};yield {type:'block-end',index:0,block:{type:'text',text:'Fixture only'}};yield {type:'finish',reason:{kind:'stop'}};});
 try{const result=await runtime.run('MainAgent','Fixture only',{harnessTask:true,onlyTools:[layer.name,read.name,'cader_apply_cad_patch'],sourceBatch:{async compile(){throw Error('Not called');},async settled(){}},afterCadBatch:async()=>{reviews++;}});assert.equal(result.status,'succeeded');assert.equal(writes,1);assert.equal(lookups,1);assert.equal(reviews,1);}finally{await runtime.dispose();}
});
test('indexed direct layer writes do not inject full-document postflight into DSH history; explicit reads remain available',async()=>{
 const config=await loadConfig(process.cwd());process.env.CADER_DIRECT_INDEXED='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_DIRECT_INDEXED'}));
 const marker='FULL_NATIVE_POSTFLIGHT_'.repeat(20000),full=JSON.stringify({operation:{operation_id:'fixture-layer-operation',tool:'create_layer',stage:'confirmed',outcome:'committed',dispatched:true,native_dispatched:true,created_entity_ids:[]},result:'fixture existing layer',observed:[{object_id:1,coordinates:marker}],observation_scope:'full_document',verification:'queried-after-write'});
 let steps=0,checks=0,writes=0;
 const write=defineTool({name:'mcp__autocad__create_layer',description:'Offline full postflight fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){writes++;return full;}});
 const read=defineTool({name:'mcp__autocad__get_entity',description:'Offline explicit native read fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){return 'EXPLICIT_NATIVE_READ';}});
 const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/indexed-direct-mutation-projection'),executionTools:[write,read]});
 runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{const messages=JSON.stringify(request.messages);steps++;
  if(steps===1){yield* call(write.name,{});return;}
  assert.equal(checks,1);assert.equal(writes,1);assert.ok(!messages.includes('FULL_NATIVE_POSTFLIGHT_'));assert.match(messages,/fixture-layer-operation/);assert.match(messages,/full_document/);assert.match(messages,/sha256/);assert.ok(messages.length<100000,'model history must remain bounded despite 440KB native postflight');
  if(steps===2){yield* call(read.name,{});return;}
  assert.match(messages,/EXPLICIT_NATIVE_READ/);yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'Fixture projection checked'};yield {type:'block-end',index:0,block:{type:'text',text:'Fixture projection checked'}};yield {type:'finish',reason:{kind:'stop'}};
 });
 try{const result=await runtime.run('MainAgent','Offline indexed projection fixture',{harnessTask:true,onlyTools:[write.name,read.name,'cader_apply_cad_patch'],sourceBatch:{async compile(){throw new Error('No source patch in this fixture');},async settled(){}},afterCadBatch:async()=>{checks++;assert.equal(JSON.parse(full).observed[0].coordinates,marker);}});assert.equal(result.status,'succeeded');assert.equal(steps,3);assert.equal(checks,1);}finally{await runtime.dispose();}
});
for(const patch of [false,true])for(const failure of [false,true])test(`actual DSH controlled batch callback serializes readback/vision before more writes: patch=${patch}, failure=${failure}`,async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_PROGRESSIVE_OFFLINE='offline-fixture';
  config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_PROGRESSIVE_OFFLINE',generation:{...p.generation,progressive_reasoning_effort:'off'}}));
  const events:PublicEvent[]=[];let writes=0,reviews=0,steps=0,checked=0;
  const tool=defineTool({name:'mcp__autocad__draw_circle',description:'Offline fixture only',parameters:{radius:{type:'number',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){writes++;return 'fixture ACK only';}});
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests',`progressive-batch-${patch}-${failure}`),executionTools:[tool],onEvent:e=>events.push(e)});
  runtime.ctx.on('llm/stream',async function*(req):AsyncGenerator<StreamChunk>{steps++;assert.match(JSON.stringify(req.messages),/Progressive Drawing/);assert.match(JSON.stringify(req.messages),/Verification and repair/);
    assert.ok(!req.tools?.some(t=>t.name==='cader_delegate'));
    if(patch)yield* call('cader_apply_cad_patch',{operations:[{tool:tool.name,arguments:{radius:1}},{tool:tool.name,arguments:{radius:2}}],unit_complete:true});else yield* call(tool.name,{radius:1});
  });
  try{
    const result=await runtime.run('MainAgent','Offline Harness integration only',{harnessTask:true,cadAction:true,progressiveStep:true,skill:'progressive-drawing',skillResource:'verification-and-repair',onlyTools:[tool.name,'cader_apply_cad_patch'],beforeCadOperation:async()=>{},afterCadBatch:async()=>{reviews++;assert.equal(writes,patch?2:1);if(failure)throw new Error('VISUAL_REPORT_INVALID');},completeDrawingUnit:async()=>{checked++;},schedulerStepSlice:1,resultText:()=> 'Returned to Scheduler, not accepted'});
    assert.equal(steps,1);assert.equal(writes,patch?2:1);assert.equal(reviews,1);assert.equal(checked,patch&&!failure?1:0);
    if(failure)assert.equal(result.handoff?.code,'BATCH_VERIFICATION_PENDING');
    assert.ok(events.some(e=>e.type==='skill.loaded'&&e.resource==='verification-and-repair'));
    assert.ok(events.some(e=>e.type==='model.route'&&e.role==='main'&&e.cad_action===true&&e.reasoning_effort==='off'));
    const body=await readFile('configs/skills/progressive-drawing/SKILL.md','utf8');assert.ok(events.some(e=>e.type==='skill.loaded'&&e.mode==='selected'&&e.sha256===createHash('sha256').update(body).digest('hex')&&e.context_sha256!==e.sha256));
  }finally{await runtime.dispose();}
});
test('resumption restores cumulative task reservations, tokens and limits rather than resetting them',async()=>{
  const {runtime:config}=await loadConfig(process.cwd());const prior=new ExecutionBudget(config);prior.beginRound();prior.admit(10,3);prior.recordTokens(1234);
  const resumed=new ExecutionBudget(config);const saved=prior.snapshot();resumed.restore(saved);assert.equal(resumed.snapshot().reported_tokens,1234);assert.equal(resumed.snapshot().cad_reservations,3);assert.equal(resumed.snapshot().tool_reservations,10);
  assert.equal(resumed.snapshot().round_tool_reservations,10);assert.equal(resumed.snapshot().round_cad_reservations,3);
  assert.throws(()=>resumed.restore(saved),/ALREADY_STARTED/);
  assert.throws(()=>new ExecutionBudget(config).restore({...saved,reported_tokens:NaN}),/INVALID/);
  resumed.beginRound();assert.equal(resumed.snapshot().execution_round,2);assert.equal(resumed.snapshot().cad_reservations,3);
  const legacy=new ExecutionBudget(config);legacy.restore({execution_round:1,tool_reservations:10,cad_reservations:3,reported_tokens:1234});assert.equal(legacy.admit(1,1),'EXECUTION_ROUND_EXHAUSTED');assert.equal(legacy.beginRound(),undefined);assert.equal(legacy.admit(1,1),undefined);assert.equal(legacy.snapshot().execution_round,2);assert.equal(legacy.snapshot().tool_reservations,11);
});

test('actual DSH new-document ACK concludes the stage before another model step',async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_PROGRESSIVE_ACK='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_PROGRESSIVE_ACK'}));
  let steps=0,acks=0,readbacks=0;const routes:PublicEvent[]=[];
  const tool=defineTool({name:'mcp__autocad__new_drawing',description:'Offline document ACK fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){acks++;return 'native ACK fixture';}});
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/progressive-new-document-ack'),executionTools:[tool],onEvent:e=>routes.push(e)});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{steps++;yield* call(tool.name,{});});
  try{const result=await runtime.run('MainAgent','Create offline fixture document',{harnessTask:true,onlyTools:[tool.name],maxModelSteps:1,completeNewDrawing:async()=>{assert.equal(acks,1);readbacks++;},resultText:()=>readbacks?'Document confirmed, not task acceptance':undefined});
    assert.equal(result.status,'succeeded');assert.equal(steps,1);assert.equal(readbacks,1);assert.ok(routes.some(e=>e.type==='model.route'&&e.progressive_step===false&&e.reasoning_effort==='low'));
  }finally{await runtime.dispose();}
});

test('runtime resume retains per-scope vision caps and the original task clock',async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_PROGRESSIVE_CAPS='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_PROGRESSIVE_CAPS'}));let captures=0;
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/progressive-resume-caps'),captureCadView:async()=>{captures++;throw new Error('Must not capture after restored scope exhaustion');}});
  try{runtime.enableTaskBudget();const started_at=new Date(Date.now()-1000).toISOString();runtime.restoreTaskBudget({...runtime.budgetState(),model_steps:12,reported_tokens:4567,started_at,source_review_reservations:4,verification_scopes:{source:[['region:A',4]],visual:[['region:A',config.runtime.max_visual_reviews_per_turn]]}});runtime.setVerificationScope('region:A');
    await assert.rejects(runtime.reviewCadView('Offline cap fixture'),/VISUAL_REVIEW_BUDGET_EXCEEDED/);assert.equal(captures,0);assert.equal(runtime.budgetState().started_at,started_at);assert.equal(runtime.budgetState().model_steps,12);assert.equal(runtime.budgetState().reported_tokens,4567);assert.equal(runtime.reviewStats().source_review_reservations,4);
  }finally{await runtime.dispose();}
});

test('one DSH regional turn retains query/write results while independently checking each committed batch',async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_PROGRESSIVE_CONTEXT='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_PROGRESSIVE_CONTEXT'}));
  let steps=0,writes=0,reviews=0;const events:PublicEvent[]=[];
  const read=defineTool({name:'mcp__autocad__list_layers',description:'Offline context fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){return 'fixture-layer-list';}});
  const write=defineTool({name:'mcp__autocad__draw_circle',description:'Offline ACK fixture',parameters:{radius:{type:'number',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){return 'fixture-ACK-'+(++writes);}});
  const finish=defineTool({name:'cader_finish_drawing_unit',description:'Offline checked unit only',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(_a,ctx){ctx.concludeTurn();return 'fixture readback completed';}});
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/progressive-regional-context'),executionTools:[read,write],onEvent:e=>events.push(e)});
  runtime.ctx.on('llm/stream',async function*(req):AsyncGenerator<StreamChunk>{steps++;const context=JSON.stringify(req.messages);if(steps>1)assert.match(context,/fixture-layer-list/);if(steps>2)assert.match(context,/fixture-ACK-1/);
    yield* call(steps===5?finish.name:steps%2?read.name:write.name,steps%2?{}:{radius:steps},steps);
  });
  try{const result=await runtime.run('MainAgent','Offline multi-step integration',{harnessTask:true,progressiveStep:true,cadAction:true,onlyTools:[read.name,write.name,finish.name],extraTools:[finish],schedulerStepSlice:8,afterCadBatch:async()=>{reviews++;assert.equal(reviews,writes);},maxModelSteps:16,resultText:()=> 'Offline verified unit fixture'});
    assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(steps,5);assert.equal(writes,2);assert.equal(reviews,2);assert.equal(events.filter(e=>e.type==='agent.started'&&e.role==='main').length,1);
  }finally{await runtime.dispose();}
});

test('cached CAD review requires its registered actual image bytes, not a matching report label',async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_PROGRESSIVE_CACHE='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_PROGRESSIVE_CACHE'}));
  const path='benchmark/fixtures/vision-calibration.png',pixels=await readReferenceImage(process.cwd(),path),sha256=createHash('sha256').update(pixels.data).digest('hex');let captures=0;
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/progressive-review-cache'),captureCadView:async()=>{captures++;return {path,evidence:{document:'fixture.dwg',sha256}};}});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{yield* call('cader_submit_visual_report',{verdict:'pass',defects:[],uncertainties:[],checklist:[{requirement_id:'current',status:'pass',evidence:'Offline image fixture only'}]});});
  try{const review=await runtime.reviewCadView(JSON.stringify({original_request:'Offline fixture',requirements:[{id:'current',description:'Current fixture only'}],entity_snapshot:[]}));
    assert.equal(review.review_valid,true);assert.equal(await runtime.isCadReviewCurrent(review),true);assert.equal(await runtime.isCadReviewCurrent({...review,image_ref:'unregistered'}),false);assert.equal(await runtime.isCadReviewCurrent({...review,evidence:{sha256:'changed'}}),false);assert.equal(captures,1);
  }finally{await runtime.dispose();}
});

for(const firstFails of [false,true])test(`stopped patch verifies only its acknowledged prefix and ends the model turn: firstFails=${firstFails}`,async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_PROGRESSIVE_PREFIX='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_PROGRESSIVE_PREFIX'}));
  let writes=0,reviews=0,steps=0;
  const tool=defineTool({name:'mcp__autocad__draw_circle',description:'Offline partial-patch fixture',parameters:{radius:{type:'number',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){writes++;if(firstFails||writes===2)throw new Error('Fixture native failure, not real CAD evidence');return 'ACK';}});
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests',`progressive-prefix-${firstFails}`),executionTools:[tool]});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{steps++;yield* call('cader_apply_cad_patch',{operations:[1,2,3].map(radius=>({tool:tool.name,arguments:{radius}}))});});
  try{const result=await runtime.run('MainAgent','Offline prefix fixture',{harnessTask:true,onlyTools:[tool.name,'cader_apply_cad_patch'],afterCadBatch:async()=>{reviews++;},maxModelSteps:3,resultText:()=> 'Stopped, not task acceptance'});
    assert.equal(steps,1);assert.equal(writes,firstFails?1:2);assert.equal(reviews,firstFails?0:1);assert.equal(result.handoff?.code,'CAD_PATCH_STOPPED');
  }finally{await runtime.dispose();}
});

for(const disagree of [false,true])test(`independent local draft readings retain source evidence and never certify complete coverage: disagree=${disagree}`,async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_PROGRESSIVE_DRAFT='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_PROGRESSIVE_DRAFT'}));
  let steps=0;const events:PublicEvent[]=[];
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests',`progressive-independent-draft-${disagree}`),onEvent:e=>events.push(e)});
  runtime.ctx.on('llm/stream',async function*(req):AsyncGenerator<StreamChunk>{steps++;assert.ok(JSON.stringify(req.messages).includes('BASE'));yield* call('cader_submit_verified_draft_observation',{coordinate_system:'normalized-crop-top-left-y-down',coverage:'partial',traces:[{id:'edge',kind:'path',points:[[0.1,0.2],[disagree&&steps===2?0.8:0.6,0.2]],closed:false,certainty:'clear',evidence:'Fixture pixels'}],omitted:['Other source information remains unresolved']});});
  try{runtime.enableTaskBudget();runtime.setVerificationScope('draft:left');const evidence=await runtime.inspectProgressiveDraft('benchmark/fixtures/vision-calibration.png',{id:'left',bounds:[[0,0],[0.5,1]]},'Offline draft evidence');
    assert.equal(steps,2);assert.equal(evidence.valid,!disagree);assert.equal(evidence.coverage,'partial');assert.equal(evidence.readings.length,2);assert.equal(evidence.source_sha256.length,64);assert.equal(evidence.readings[0]!.traces[0]!.kind,'path');
    const trace=evidence.readings[0]!.traces[0]!;if(trace.kind==='path')assert.equal(trace.points[1]![0],0.3);
    assert.equal(events.filter(e=>e.type==='image.attached').length,2);assert.match(evidence.completion,/complete source reconstruction/);
  }finally{await runtime.dispose();}
});
for(const outside of [false,true])test(`scoped Reference Gate receives actual cropped pixels and rejects foreign-region facts: ${outside}`,async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_PROGRESSIVE_SCOPE='offline-scope-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_PROGRESSIVE_SCOPE'}));
  const events:PublicEvent[]=[];const messages:string[]=[];
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests',`progressive-source-${outside}`),onEvent:e=>events.push(e)});
  runtime.ctx.on('llm/stream',async function*(req):AsyncGenerator<StreamChunk>{
    messages.push(JSON.stringify(req.messages));assert.ok(!req.tools?.some(t=>t.name.startsWith('mcp__')));
    if(req.tools?.some(t=>t.name==='cader_submit_reference_observation'))yield* call('cader_submit_reference_observation',{version:1,drawing_kind:'layout',summary:'Fixture partial frame only',coordinate_system:outside?'normalized-image-top-left-y-down':'normalized-crop-top-left-y-down',content_bounds:[[0,0],[0.5,1]],objects:[{id:'frame',kind:'frame segment',category:'wire',certainty:'clear',bounds:outside?[[0.6,0.1],[0.9,0.8]]:[[0.1,0.1],[0.4,0.8]],terminals:[]}],visible_text:[],connections:[],unknowns:[]});
    else yield* call('cader_submit_reference_label_inventory',{coordinate_system:'normalized-crop-top-left-y-down',visible_text:[]});
  });
  try{
    runtime.enableTaskBudget();runtime.setVerificationScope('source:left');
    const observation=await runtime.inspectReference('benchmark/fixtures/vision-calibration.png','Fixture scope only',undefined,{id:'left',bounds:[[0,0],[0.5,1]]});
    assert.equal(observation.valid,!outside);assert.ok(messages.every(m=>m.includes('当前仅核实区域 left')));
    assert.ok(events.some(e=>e.type==='image.attached'&&(e.crop as {width:number}).width<(e.source_width as number)));
    assert.ok(events.some(e=>e.type==='skill.loaded'&&e.name==='progressive-drawing'&&e.resource==='source-observation'));
  }finally{await runtime.dispose();}
});
