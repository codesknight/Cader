import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadConfig} from '@cader/config';
import {createLiveRuntime,defineTool,ExecutionBudget} from '@cader/dsh-adapter';
import type {StreamChunk,PublicEvent} from '@cader/dsh-adapter';
async function* call(name:string,args:unknown):AsyncGenerator<StreamChunk>{
  const id='progressive-fixture-call' as Extract<StreamChunk,{type:'tool-call-delta'}>['id'],argumentsText=JSON.stringify(args);
  yield {type:'block-start',index:0,blockType:'tool-call'};
  yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:argumentsText};
  yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:argumentsText}};
  yield {type:'finish',reason:{kind:'tool-calls'}};
}
for(const patch of [false,true])for(const failure of [false,true])test(`actual DSH controlled batch callback serializes readback/vision before more writes: patch=${patch}, failure=${failure}`,async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_PROGRESSIVE_OFFLINE='offline-fixture';
  config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_PROGRESSIVE_OFFLINE'}));
  const events:PublicEvent[]=[];let writes=0,reviews=0,steps=0,checked=0;
  const tool=defineTool({name:'mcp__autocad__draw_circle',description:'Offline fixture only',parameters:{radius:{type:'number',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){writes++;return 'fixture ACK only';}});
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests',`progressive-batch-${patch}-${failure}`),executionTools:[tool],onEvent:e=>events.push(e)});
  runtime.ctx.on('llm/stream',async function*(req):AsyncGenerator<StreamChunk>{steps++;assert.match(JSON.stringify(req.messages),/Progressive Drawing/);assert.match(JSON.stringify(req.messages),/Verification and repair/);
    assert.ok(!req.tools?.some(t=>t.name==='cader_delegate'));
    if(patch)yield* call('cader_apply_cad_patch',{operations:[{tool:tool.name,arguments:{radius:1}},{tool:tool.name,arguments:{radius:2}}],unit_complete:true});else yield* call(tool.name,{radius:1});
  });
  try{
    const result=await runtime.run('MainAgent','Offline Harness integration only',{harnessTask:true,skill:'progressive-drawing',skillResource:'verification-and-repair',onlyTools:[tool.name,'cader_apply_cad_patch'],beforeCadOperation:async()=>{},afterCadBatch:async()=>{reviews++;assert.equal(writes,patch?2:1);if(failure)throw new Error('VISUAL_REPORT_INVALID');},completeDrawingUnit:async()=>{checked++;},schedulerStepSlice:1,resultText:()=> 'Returned to Scheduler, not accepted'});
    assert.equal(steps,1);assert.equal(writes,patch?2:1);assert.equal(reviews,1);assert.equal(checked,patch&&!failure?1:0);
    if(failure)assert.equal(result.handoff?.code,'BATCH_VERIFICATION_PENDING');
    assert.ok(events.some(e=>e.type==='skill.loaded'&&e.resource==='verification-and-repair'));
    const body=await readFile('configs/skills/progressive-drawing/SKILL.md','utf8');assert.ok(events.some(e=>e.type==='skill.loaded'&&e.mode==='selected'&&e.sha256===createHash('sha256').update(body).digest('hex')&&e.context_sha256!==e.sha256));
  }finally{await runtime.dispose();}
});
test('resumption restores cumulative task reservations, tokens and limits rather than resetting them',async()=>{
  const {runtime:config}=await loadConfig(process.cwd());const prior=new ExecutionBudget(config);prior.beginRound();prior.admit(10,3);prior.recordTokens(1234);
  const resumed=new ExecutionBudget(config);const saved=prior.snapshot();resumed.restore(saved);assert.equal(resumed.snapshot().reported_tokens,1234);assert.equal(resumed.snapshot().cad_reservations,3);assert.equal(resumed.snapshot().tool_reservations,10);
  assert.throws(()=>resumed.restore(saved),/ALREADY_STARTED/);
  assert.throws(()=>new ExecutionBudget(config).restore({...saved,reported_tokens:NaN}),/INVALID/);
  resumed.beginRound();assert.equal(resumed.snapshot().execution_round,2);assert.equal(resumed.snapshot().cad_reservations,3);
});

test('actual DSH new-document ACK concludes the stage before another model step',async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_PROGRESSIVE_ACK='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_PROGRESSIVE_ACK'}));
  let steps=0,acks=0,readbacks=0;
  const tool=defineTool({name:'mcp__autocad__new_drawing',description:'Offline document ACK fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){acks++;return 'native ACK fixture';}});
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/progressive-new-document-ack'),executionTools:[tool]});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{steps++;yield* call(tool.name,{});});
  try{const result=await runtime.run('MainAgent','Create offline fixture document',{harnessTask:true,onlyTools:[tool.name],maxModelSteps:1,completeNewDrawing:async()=>{assert.equal(acks,1);readbacks++;},resultText:()=>readbacks?'Document confirmed, not task acceptance':undefined});
    assert.equal(result.status,'succeeded');assert.equal(steps,1);assert.equal(readbacks,1);
  }finally{await runtime.dispose();}
});

test('runtime resume retains per-scope vision caps and the original task clock',async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_PROGRESSIVE_CAPS='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_PROGRESSIVE_CAPS'}));let captures=0;
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/progressive-resume-caps'),captureCadView:async()=>{captures++;throw new Error('Must not capture after restored scope exhaustion');}});
  try{runtime.enableTaskBudget();const started_at=new Date(Date.now()-1000).toISOString();runtime.restoreTaskBudget({...runtime.budgetState(),model_steps:12,reported_tokens:4567,started_at,source_review_reservations:4,verification_scopes:{source:[['region:A',4]],visual:[['region:A',config.runtime.max_visual_reviews_per_turn]]}});runtime.setVerificationScope('region:A');
    await assert.rejects(runtime.reviewCadView('Offline cap fixture'),/VISUAL_REVIEW_BUDGET_EXCEEDED/);assert.equal(captures,0);assert.equal(runtime.budgetState().started_at,started_at);assert.equal(runtime.budgetState().model_steps,12);assert.equal(runtime.budgetState().reported_tokens,4567);assert.equal(runtime.reviewStats().source_review_reservations,4);
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
    assert.ok(events.some(e=>e.type==='skill.loaded'&&e.name==='progressive-drawing'&&e.resource==='task-decomposition'));
  }finally{await runtime.dispose();}
});
