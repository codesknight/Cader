import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '@cader/config';
import { createLiveRuntime, defineTool, LlmError } from '@cader/dsh-adapter';
import type { StreamChunk, PublicEvent } from '@cader/dsh-adapter';
import { runTask, validateCadArguments } from '@cader/profile';
import type { ExecutionSession } from '@cader/profile';

test('actual DSH composite patch validates nested schemas, executes serially and stops at first failure', async () => {
  process.env.CADER_PATCH_FIXTURE='offline-patch-fixture';
  const config=await loadConfig(process.cwd());const calls:number[]=[];let steps=0;
  const runtime=await createLiveRuntime({root:process.cwd(),runDirectory:resolve('.cader/tests/patch'),...config,
    profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_PATCH_FIXTURE'})),
    executionTools:[defineTool({name:'mcp__autocad__draw_circle',description:'Fixture, no CAD',parameters:{radius:{type:'number',required:true}},
      output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args){calls.push(args.radius);if(args.radius===2)throw new Error('fixture failure');return 'fixture only';}})]});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{
    if(steps++===0){
      const id='fixture-patch' as Extract<StreamChunk,{type:'tool-call-delta'}>['id'];
      const args=JSON.stringify({operations:[1,2,3].map(radius=>({tool:'mcp__autocad__draw_circle',arguments:{radius}}))});
      yield {type:'block-start',index:0,blockType:'tool-call'};
      yield {type:'tool-call-delta',index:0,id,name:'cader_apply_cad_patch',argumentsDelta:args};
      yield {type:'block-end',index:0,block:{type:'tool-call',id,name:'cader_apply_cad_patch',arguments:args}};
      yield {type:'finish',reason:{kind:'tool-calls'}};return;
    }
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'Fixture incomplete'};
    yield {type:'block-end',index:0,block:{type:'text',text:'Fixture incomplete'}};yield {type:'finish',reason:{kind:'stop'}};
  });
  try{await runtime.run('MainAgent','Apply fixture patch');assert.deepEqual(calls,[1,2]);}
  finally{await runtime.dispose();delete process.env.CADER_PATCH_FIXTURE;}
});

test('visual format repair uses the same captured image and accepts only the strict report', async()=>{
  process.env.CADER_REPAIR_FIXTURE='offline-repair-fixture';
  const config=await loadConfig(process.cwd());let captures=0,steps=0;
  const runtime=await createLiveRuntime({root:process.cwd(),workspaceRoot:process.cwd(),runDirectory:resolve('.cader/tests/visual-repair'),...config,
    profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_REPAIR_FIXTURE'})),
    captureCadView:async()=>{captures++;return {path:resolve('benchmark/fixtures/vision-calibration.png'),evidence:{source:'fixture',sha256:'fixture-hash',document_revision:null}};}});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{
    const truncated=steps++===0;
    const text=truncated?'{"verdict":"pass",':'{"verdict":"pass","defects":[],"checklist":[],"uncertainties":[]}';
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};
    yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:truncated?'max-tokens':'stop'}};
  });
  try{const report=await runtime.reviewCadView('Fixture requirements');assert.equal(captures,1);assert.equal(steps,2);
    assert.equal(report.review_valid,true);assert.deepEqual(report.attempts.map(a=>a.valid),[false,true]);
    assert.equal(runtime.completed()[0]?.errorCode,'OUTPUT_TRUNCATED');assert.equal(runtime.completed()[0]?.recovered_by,runtime.completed()[1]?.id);}
  finally{await runtime.dispose();delete process.env.CADER_REPAIR_FIXTURE;}
});

test('malformed visual provider output gets one same-image repair and a linked recovered attempt',async()=>{
  const prior=process.env.CADER_REPAIR_FIXTURE;process.env.CADER_REPAIR_FIXTURE='offline-repair-fixture';
  const config=await loadConfig(process.cwd());let captures=0,steps=0;
  const runtime=await createLiveRuntime({root:process.cwd(),runDirectory:resolve('.cader/tests/malformed-review'),...config,
    profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_REPAIR_FIXTURE'})),
    captureCadView:async()=>{captures++;return {path:resolve('benchmark/fixtures/vision-calibration.png'),evidence:{source:'fixture'}};}});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{
    if(++steps===1)throw new LlmError('fixture malformed response','MALFORMED_RESPONSE');
    const text=JSON.stringify({verdict:'pass',defects:[],checklist:[],uncertainties:[]});
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};
    yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
  });
  try{
    const report=await runtime.reviewCadView('Fixture only');assert.equal(report.review_valid,true);assert.equal(captures,1);assert.equal(steps,2);
    assert.equal(runtime.completed()[0]?.recovered_by,runtime.completed()[1]?.id);
  }finally{await runtime.dispose();if(prior===undefined)delete process.env.CADER_REPAIR_FIXTURE;else process.env.CADER_REPAIR_FIXTURE=prior;}
});

test('legacy CAD coordinate constraints reject malformed XYZ before any side effects', () => {
  assert.throws(() => validateCadArguments('draw_polyline', { points: [[-40,14],[-24,14],[-18,20]] }), /XYZ/);
  assert.throws(() => validateCadArguments('draw_line', { start_x: 0,start_y: 0,start_z: 0,end_x: 0,end_y: 0,end_z: 0 }), /ZERO_LENGTH/);
  assert.throws(() => validateCadArguments('draw_circle', { radius: Infinity }), /NONFINITE/);
  validateCadArguments('draw_polyline', { points: [[-40,14,0],[-24,14,0],[-18,20,0]] });
});

test('visual progress events cannot lift the correction phase ban on new drawings',async()=>{
  await mkdir('.cader/tests',{recursive:true});const directory=await mkdtemp(resolve('.cader/tests/phase-'));
  let revision=0,reviewCount=0,guardObserved=false;
  const owner={facts:()=>({frozen:false,local_connection_id:'fixture',scratch:'fixture.dwg',session_counts:{committed:revision}}),
    authorizeTask:async()=>true,endTask(){},snapshot:async()=>({document:'fixture.dwg',entities:[]})} as unknown as ExecutionSession;
  const factory:typeof createLiveRuntime=async options=>({
    async run(_profile:string,_instruction:string,request?:Parameters<Awaited<ReturnType<typeof createLiveRuntime>>['run']>[2]){
      const state=request?.taskState?.() as {phase:string};
      if(request?.extraTools){await request.extraTools[0]!.execute({version:1,domain:'generic',components:[],visual_required:true,requirements:[{id:'look',source_quote:'画图',description:'Fixture appearance',check:'visual'}]},{concludeTurn(){}} as never);}
      else if(state.phase==='correcting'){
        revision++;
        assert.equal(options.toolAvailable?.('mcp__autocad__new_drawing'),false);
        await request!.controlledReview!('Review fixture only');
        assert.equal(options.toolAvailable?.('mcp__autocad__new_drawing'),false);
        guardObserved=true;
      }
      return {id:'fixture-main',profile:'MainAgent',status:'succeeded',text:'Fixture',tools:[],modelSteps:1};
    },
    async reviewCadView(){reviewCount++;return {review_valid:true,structured:{verdict:reviewCount===1?'fail':'pass',defects:[],checklist:[{requirement_id:'look',status:reviewCount===1?'fail':'pass',evidence:'fixture'}],uncertainties:[]},evidence:{},image_ref:'fixture',requirements:'fixture',attempts:[]};},
    completed:()=>[{id:'fixture-main',profile:'MainAgent',status:'succeeded',text:'Fixture',tools:[],modelSteps:1}],dispose:async()=>{},
  } as unknown as Awaited<ReturnType<typeof createLiveRuntime>>);
  try{
    const report=await runTask(process.cwd(),{task:'画图',workspaceRoot:directory,executionOwner:owner,executionTools:[],executionState:()=>owner.facts(),permissionMode:'ask'},factory);
    assert.equal(guardObserved,true);assert.equal(report.quality?.phase,'complete');
  }finally{await rm(directory,{recursive:true});}
});

test('actual DSH routes a generated image attachment to vision automatically and enforces review budget', async () => {
  const previous = process.env.CADER_FEEDBACK_FIXTURE; process.env.CADER_FEEDBACK_FIXTURE = 'sk-offline-feedback';
  await mkdir('.cader/tests', { recursive: true }); const root = await mkdtemp(resolve('.cader/tests/feedback-'));
  const config = await loadConfig(process.cwd()); const events: PublicEvent[] = [];
  let captures = 0, imageRequests = 0, mainSteps = 0, visionSteps = 0;
  const runtime = await createLiveRuntime({ root: process.cwd(), workspaceRoot: process.cwd(), runDirectory: root,
    ...config, runtime: { ...config.runtime, max_visual_reviews_per_turn: 1 },
    profiles: config.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_FEEDBACK_FIXTURE' })),
    captureCadView: async () => { captures++; return { path: resolve('benchmark/fixtures/vision-calibration.png'), evidence: { source: 'synthetic capture fixture; not real CAD' } }; },
    onEvent: event => events.push(event) });
  runtime.ctx.on('llm/stream', async function* (request): AsyncGenerator<StreamChunk> {
    const messages = JSON.parse(JSON.stringify(request.messages)) as { content: { type: string; attachment: Parameters<typeof runtime.ctx.attachments.readImageRequest>[0] }[] }[];
    const images = messages.flatMap(message => message.content).filter(block => block.type === 'image');
    if (images.length) {
      visionSteps++;
      assert.ok(request.tools?.every(tool => !tool.name.startsWith('mcp__') && !['cader_delegate','cader_review_cad_view'].includes(tool.name)));
      for (const block of images) { await runtime.ctx.attachments.readImageRequest(block.attachment, { width: 48, height: 48, maxBytes: 100000 }); imageRequests++; }
      const text = JSON.stringify({ defects: [], checklist: [], uncertainties: [], verdict: 'pass' });
      yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } }; return;
    }
    mainSteps++;
    if (mainSteps <= 2) {
      const id = `review-${mainSteps}` as Extract<StreamChunk, { type: 'tool-call-delta' }>['id'];
      const args = JSON.stringify({ question: 'Review this fixture' });
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id, name: 'cader_review_cad_view', argumentsDelta: args };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'cader_review_cad_view', arguments: args } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
    }
    const text = 'Fixture complete, not real CAD acceptance';
    yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } };
  });
  try {
    const result = await runtime.run(config.runtime.main_profile, 'Review generated view');
    assert.equal(result.status, 'succeeded'); assert.equal(captures, 1); assert.equal(visionSteps, 1, JSON.stringify(events.filter(e=>e.type==='tool.result'||e.type==='agent.error'))); assert.equal(imageRequests, 1);
    assert.ok(events.some(event => event.type === 'cad.review' && event.review_valid === true));
    assert.ok(events.some(event => event.type === 'tool.result' && event.isError === true));
  } finally { await runtime.dispose(); await rm(root, { recursive: true }); if (previous === undefined) delete process.env.CADER_FEEDBACK_FIXTURE; else process.env.CADER_FEEDBACK_FIXTURE = previous; }
});

test('a successful model answer cannot hide an authoritative frozen CAD task', async () => {
  const previous = process.env.CADER_REPORT_FIXTURE; process.env.CADER_REPORT_FIXTURE = 'sk-offline-report';
  const factory: typeof createLiveRuntime = async options => {
    const runtime = await createLiveRuntime({ ...options, profiles: options.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_REPORT_FIXTURE' })) });
    runtime.ctx.on('llm/stream', async function* (): AsyncGenerator<StreamChunk> {
      const text = 'Everything succeeded (deliberately false fixture prose)';
      yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } };
    }); return runtime;
  };
  try {
    const report = await runTask(process.cwd(), { task: 'Report', executionState: () => ({ frozen: true, local_connection_id:null, write_state: 'frozen', freeze: null,
      transport: 'connected', scratch: 'Scratch', artifact: null, operations: [], counts: { unknown: 1 },
      counts_scope:'fixture',operation_mark:0,session_counts:{unknown:1},freeze_operation:null,freeze_evidence:null,barrier_resolution:null,recovery:{eligible:false,reason:'FIXTURE',guidance:'fixture'},
      cad_observation: { source: 'fixture', observed_at: null, entity_count: null, native_identity: 'unavailable', cached: true,scope:'full_document',stale_due_to_mutations:true,interpretation:'fixture' } }) }, factory);
    assert.equal(report.run_status, 'succeeded'); assert.equal(report.ok, false); assert.equal(report.task_status, 'blocked');
    assert.deepEqual(report.blocked_reasons, ['CAD_WRITE_FROZEN']);
    assert.equal(JSON.parse(await readFile(resolve(report.runDirectory,'verification.json'),'utf8')).ok, false);
  } finally { if (previous === undefined) delete process.env.CADER_REPORT_FIXTURE; else process.env.CADER_REPORT_FIXTURE = previous; }
});

for(const repaired of [true,false])test(`minor visual advice cannot hide an all-pass uncertain verdict; same-image repair=${repaired}`,async()=>{
  const prior=process.env.CADER_VERDICT_FIXTURE;process.env.CADER_VERDICT_FIXTURE='offline-verdict-fixture';
  const config=await loadConfig(process.cwd());let captures=0,steps=0;
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve(`.cader/tests/verdict-${repaired}`),profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_VERDICT_FIXTURE'})),captureCadView:async()=>{captures++;return {path:resolve('benchmark/fixtures/vision-calibration.png'),evidence:{source:'fixture'}};}});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{
    steps++;const text=JSON.stringify({verdict:repaired&&steps===2?'pass':'uncertain',defects:[{type:'Optional spacing',severity:'minor',location:'Fixture',evidence:'Required conditions passed',suggestion:'Optional',entity_ids:[]}],checklist:[{requirement_id:'look',status:'pass',evidence:'Fixture only'}],uncertainties:repaired&&steps===2?[]:['Already resolved observation']});
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
  });
  try{const report=await runtime.reviewCadView(JSON.stringify({requirements:[{id:'look'}],entity_snapshot:[]}));assert.equal(captures,1);assert.equal(steps,2);assert.equal(report.review_valid,repaired);assert.equal(report.attempts[0]!.valid,false);if(repaired){assert.equal(report.structured!.verdict,'pass');assert.equal(report.structured!.defects.length,1);}else assert.equal(report.structured,null);}
  finally{await runtime.dispose();if(prior===undefined)delete process.env.CADER_VERDICT_FIXTURE;else process.env.CADER_VERDICT_FIXTURE=prior;}
});
