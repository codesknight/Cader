import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAcceptancePlan, parseVisualReport } from '@cader/config';
import type { QualityPlan } from '@cader/config';
import { requiresQuality, verifyQuality, runQualityTask, qualityTaskContext, taskIntent } from '@cader/profile';
const plan: QualityPlan = {
  version: 1, domain: 'electrical-schematic', wire_layer: 'WIRE', visual_required: true,
  components: [
    { id: 'a', kind: 'fixture-component', ports: [[0, 0], [0, 10]], bounds: [[-2, 0], [2, 10]] },
    { id: 'b', kind: 'fixture-component', ports: [[20, 0], [20, 10]], bounds: [[18, 0], [22, 10]] },
  ],
  requirements: [
    { id: 'cycle', source_quote: '画图', description: 'Single cycle', check: 'series_cycle' },
    { id: 'interior', source_quote: '画图', description: 'No interior crossing', check: 'no_wire_through_component' },
    { id: 'label', source_quote: '画图', description: 'Label clearance', check: 'text_clearance' },
    { id: 'visual', source_quote: '画图', description: 'Symbols', check: 'visual' },
  ],
};
const line = (a: number[], b: number[]) => ({ type: 'AcDbLine', layer: 'WIRE', start_point: a, end_point: b });
const entities = [line([0, 0], [20, 0]), line([0, 10], [20, 10]),
...plan.components.map(c => ({ type: 'AcDbCircle', layer: 'COMPONENT', bounding_box: { min: c.bounds[0], max: c.bounds[1] } }))];
const status = (rows: ReturnType<typeof verifyQuality>, id: string) => rows.find(r => r.id === id)?.status;
test('queried port graph rejects open circuits, branches, duplicate wires and shortcuts', () => {
  assert.equal(status(verifyQuality(plan, entities), 'cycle'), 'pass');
  assert.equal(status(verifyQuality(plan, entities.slice(1)), 'cycle'), 'fail');
  for(const extra of [line([10, 0], [10, -10]), entities[0]!, line([0, 0], [0, 10])]) {
    assert.equal(status(verifyQuality(plan, [...entities, extra]), 'cycle'), 'fail');
  }
  // Interior crossings of two segments must create graph nodes too.
  assert.equal(status(verifyQuality(plan, [...entities, line([10, -10], [10, 20])]), 'cycle'), 'fail');
  assert.equal(status(verifyQuality(plan, entities.filter(e => e.layer === 'WIRE')), 'cycle'), 'fail');
});
test('exact segment clipping catches long wires, including a wire starting on a component port', () => {
  assert.equal(status(verifyQuality(plan, [...entities, line([0, 0], [0, 10])]), 'interior'), 'fail');
  assert.equal(status(verifyQuality(plan, [...entities, line([-1000000, 5], [1000000, 5])]), 'interior'), 'fail');
  const text = { type: 'AcDbText', text_string: 'label', bounding_box: { min: [4.123, -1], max: [4.124, 1] } };
  assert.equal(status(verifyQuality(plan, [...entities, text]), 'label'), 'fail');
  assert.equal(status(verifyQuality(plan, entities), 'interior'), 'pass');
});
test('topology failure identifies actual broken ports, endpoints and wire IDs without relaxing tolerance',()=>{
  const observed=entities.map((e,i)=>({...e,object_id:101+i}));
  const result=verifyQuality(plan,observed.slice(1)).find(r=>r.id==='cycle')!;
  const details=result.details as {tolerance:number;unconnected_ports:{component:string;position:number[];nearest_endpoints:{object_id:number;gap:number}[]}[];invalid_nodes:{position:number[];degree:number}[]};
  assert.equal(result.status,'fail');assert.equal(details.tolerance,1e-5);
  assert.deepEqual(details.unconnected_ports.map(p=>p.position),[[0,0],[20,0]]);
  assert.equal(details.unconnected_ports[0]!.nearest_endpoints[0]!.object_id,102);
  assert.equal(details.unconnected_ports[0]!.nearest_endpoints[0]!.gap,10);
  assert.ok(details.invalid_nodes.every(n=>n.degree===1));
});
test('literal labels normalize typographic minus/micro but reject wrong values, SI case and duplicates',()=>{
  const check=(expected:string,actual:string[],limits={})=>verifyQuality({...plan,requirements:[{id:'text',source_quote:'fixture',description:'Literal label',check:'text',text:expected,...limits}]},actual.map((text_string,i)=>({object_id:i+1,type:'AcDbText',text_string,bounding_box:{min:[0,0],max:[1,1]}})))[0]!.status;
  assert.equal(check('−',['-']),'pass');assert.equal(check('1μF',['1 µF']),'pass');
  assert.equal(check('5V',['15V']),'fail');assert.equal(check('1mF',['1MF']),'fail');assert.equal(check('1μF',['1MF']),'fail');
  assert.equal(check('5V',['5V','5V'],{min:1,max:1}),'fail');
});
test('schemas reject semantic entity types, contradictory visual pass and missing topology checks', () => {
  assert.doesNotThrow(() => parseAcceptancePlan(plan));
  assert.throws(() => parseAcceptancePlan({ ...plan, requirements: [{ ...plan.requirements[0], check: 'entity_count', entity_type: '灯泡' }] }));
  assert.throws(() => parseAcceptancePlan({ ...plan, components: [plan.components[0], plan.components[0]] }));
  assert.throws(() => parseVisualReport({ verdict: 'pass', defects: [], checklist: [], uncertainties: ['unreadable'] }));
  assert.throws(() => parseVisualReport({ verdict: 'pass', defects: [], uncertainties: [] }));
  assert.throws(()=>parseVisualReport({verdict:'uncertain',defects:[],checklist:[{requirement_id:'visual',status:'pass',evidence:'All required observations passed'}],uncertainties:['Unrequested reference missing']}),/UNCERTAINTY_MUST_AFFECT_REQUIRED_CHECK/);
  assert.equal(requiresQuality('画一个示意图'), true);
  assert.equal(requiresQuality('移动这条直线'), false);
  assert.equal(requiresQuality('你能画什么图吗'), false);
  assert.equal(requiresQuality('能帮我画一个电路吗'),true);
  assert.equal(requiresQuality('设计一个串联电路'),true);
});
// These are scheduling fixtures, not a model/CAD acceptance result.
async function schedulingFixture(verdict: 'pass' | 'fail' | 'invalid' | 'cancel' | 'uncertain', repair = false,
  extra: { resume?: Parameters<typeof runQualityTask>[0]['resume']; connection?: string; clipped?: boolean; changed?: boolean;unrequestedSave?:boolean;unrequestedLines?:boolean;agentReview?:boolean;writeAfterReview?:boolean;concurrentReview?:boolean;omitVisual?:boolean } = {}) {
  const phases: string[] = [], actions: string[] = [];
  let reviews = 0, approvals = 0, ended = false;
  let revision=0;
  const reviewQuestions:string[]=[];
  const runtime = {
    async run(_profile: string, _instruction: string, request?: {
      controlledReview?: (question:string)=>Promise<unknown>;
      taskState?:()=>unknown;
      extraTools?: {
        execute: (args: unknown, exec: unknown) => Promise<unknown>;
      }[];
    }) {
      if(extra.unrequestedSave&&request?.extraTools)await assert.rejects(request.extraTools[0]!.execute({...plan,requirements:[...plan.requirements,{id:'unsolicited-save',check:'saved_dwg',description:'Invented file obligation',source_quote:'画图'}]}, {concludeTurn(){}}),/UNREQUESTED_FILE_ACCEPTANCE/);
      if(extra.unrequestedLines&&request?.extraTools)await assert.rejects(request.extraTools[0]!.execute({...plan,requirements:[...plan.requirements,{id:'unsolicited-line-limit',check:'entity_count',entity_type:'AcDbLine',max:12,description:'Invented primitive ceiling',source_quote:'画图'}]}, {concludeTurn(){}}),/UNREQUESTED_PRIMITIVE_LIMIT/);
      if(extra.omitVisual&&request?.extraTools)await assert.rejects(request.extraTools[0]!.execute({version:1,domain:'generic',components:[],visual_required:false,requirements:[{id:'count',source_quote:'画图',description:'Count only',check:'entity_count',entity_type:'AcDbLine',min:1}]},{concludeTurn(){}}),/VISUAL_ACCEPTANCE_REQUIRED/);
      if(request?.extraTools)
        await request.extraTools[0]!.execute(plan, { concludeTurn() { } });
      else {
        actions.push(phases.at(-1)!);
        if(phases.at(-1)==='correcting')revision++; // A fixture patch commits a new observed revision.
        if(extra.agentReview){
          if(extra.concurrentReview)await Promise.all([request!.controlledReview!('Invented easier requirements'),request!.controlledReview!('Skip original requirements')]);
          else await request!.controlledReview!('Invented easier requirements');
          const context=request!.taskState!() as {visual_call_count:number};
          assert.ok(context.visual_call_count>0);
          if(extra.writeAfterReview)revision++;
        }
      }
      return { status: 'succeeded', text: 'Fixture model says done', tools: [] };
    },
    async reviewCadView(question:string) {
      reviewQuestions.push(question);
      reviews++;
      if(verdict === 'cancel')
        throw new Error('cancelled fixture');
      const result = repair && reviews > 1 ? 'pass' : verdict;
      return {
        evidence: { image_bounds: { possible_clipping: extra.clipped ?? false } }, review_valid: result !== 'invalid', structured: result === 'invalid' ? null : {
          verdict: result, defects: [], checklist: [{ requirement_id: 'visual', status: result, evidence: 'fixture' }], uncertainties: []
        }
      };
    },
  };
  const owner = {
    facts: () => ({ frozen: false, local_connection_id: extra.connection ?? 'fixture-connection', scratch: 'fixture.dwg',session_counts:{committed:revision} }),
    async authorizeTask() { approvals++; return true; }, endTask() { ended = true; },
    async snapshot() { return { entities: extra.changed && reviews > 0 ? [...entities, { type: 'fixture-change' }] : entities }; },
  };
  const options = {
    runtime, owner, task: '画图', profile: 'fixture', resume: extra.resume, emit: (e: {
      phase: unknown;
    }) => phases.push(String(e.phase)), persist: async () => { }
  };
  const result = await runQualityTask(options as unknown as Parameters<typeof runQualityTask>[0]);
  return { result, phases, actions, reviews, approvals, ended,reviewQuestions };
}

test('agent review and mandatory fallback share bound evidence without duplicate capture; later writes invalidate it',async()=>{
  const active=await schedulingFixture('pass',false,{agentReview:true,concurrentReview:true});
  assert.equal(active.result.phase,'complete');assert.equal(active.reviews,1);
  const evidence=JSON.parse(active.reviewQuestions[0]!);
  assert.equal(evidence.original_request,'画图');assert.equal(evidence.requirements[0].id,'visual');
  assert.ok(!active.reviewQuestions[0]!.includes('Invented easier'));
  const changed=await schedulingFixture('pass',false,{agentReview:true,writeAfterReview:true});
  assert.equal(changed.reviews,2);assert.equal(changed.result.phase,'complete');
  assert.equal(qualityTaskContext(changed.result).visual_call_count,2);
  const clipped=await schedulingFixture('pass',false,{agentReview:true,clipped:true});
  assert.equal(clipped.reviews,1);assert.equal(clipped.result.phase,'pending_verification');
  assert.ok(qualityTaskContext(clipped.result).unmet_conditions.some(c=>c.id==='capture_bounds'));
});

test('policy, history inquiries, continuations and new drawing requests have distinct routes',()=>{
  for(const request of ['每次绘制都应该启动视觉验证。','以后绘图都做视觉检查','Always use vision review']){
    assert.equal(taskIntent(request),'preference');assert.equal(requiresQuality(request),false);
  }
  assert.equal(taskIntent('是否使用了视觉验证？'),'status');
  assert.equal(taskIntent('继续'),'continue');
  assert.equal(taskIntent('新建一张空白图纸，绘制一个房子，旁边有棵树。'),'drawing');
  assert.equal(taskIntent('以后都验证，现在画一个房子'),'drawing');
  assert.equal(taskIntent('如何新建图纸？'),'status');
  assert.equal(taskIntent('绘制房子后验证结果'),'drawing');
});

test('model cannot disable mandatory visual acceptance by submitting only entity counts',async()=>{
  const run=await schedulingFixture('pass',false,{omitVisual:true});
  assert.equal(run.result.phase,'complete');assert.equal(run.reviews,1);
});
test('scheduler owns automatic visual acceptance and only patches up to three times', async () => {
  const repaired = await schedulingFixture('fail', true);
  assert.equal(repaired.result.phase, 'complete');
  assert.equal(repaired.reviews, 2);
  assert.deepEqual(repaired.actions, ['drawing', 'correcting']);
  assert.equal(repaired.approvals, 1);
  const failed = await schedulingFixture('fail');
  assert.equal(failed.result.phase, 'pending_verification');
  assert.equal(failed.result.round, 3);
  assert.equal(failed.actions.filter(a => a === 'correcting').length, 3);
  assert.equal(failed.reviews, 4);
  assert.equal(failed.ended, true);
});
test('planning rejects an unrequested file gate rather than drawing toward an unreachable completion',async()=>{
  const run=await schedulingFixture('pass',false,{unrequestedSave:true});
  assert.equal(run.result.phase,'complete');assert.equal(run.approvals,1);
});
test('component tasks cannot gain an invented line-entity ceiling during planning',async()=>{
  const run=await schedulingFixture('pass',false,{unrequestedLines:true});assert.equal(run.result.phase,'complete');assert.equal(run.approvals,1);
});

test('clipped images or a changed observed drawing cannot pass or drive stale corrections', async () => {
  for(const extra of [{ clipped: true }, { changed: true }]) {
    const run = await schedulingFixture('pass', false, extra);
    assert.equal(run.result.phase, 'pending_verification'); assert.deepEqual(run.actions, ['drawing']);
  }
});

test('quality resume rechecks without drawing replay and rejects a new connection', async () => {
  const prior = await schedulingFixture('invalid');
  const resume = prior.result as unknown as NonNullable<Parameters<typeof runQualityTask>[0]['resume']>;
  const resumed = await schedulingFixture('pass', false, { resume });
  assert.equal(resumed.result.phase, 'complete'); assert.deepEqual(resumed.actions, []);
  const stale = await schedulingFixture('pass', false, { resume, connection: 'different-connection' });
  assert.equal(stale.result.phase, 'blocked'); assert.equal(stale.reviews, 0); assert.equal(stale.approvals, 0);
  const exhausted = await schedulingFixture('fail');
  const last = await schedulingFixture('fail', false, { resume: exhausted.result as unknown as typeof resume });
  assert.equal(last.result.round, 3); assert.equal(last.result.phase, 'pending_verification'); assert.deepEqual(last.actions, []);
});
test('invalid, cancelled or unlocalized uncertain review cannot complete or authorize speculative repairs', async () => {
  for(const verdict of ['invalid', 'cancel', 'uncertain'] as const) {
    const result = await schedulingFixture(verdict);
    assert.equal(result.result.phase, 'pending_verification');
    assert.deepEqual(result.actions, ['drawing']);
    assert.equal(result.reviews, 1);
    assert.equal(result.ended, true);
  }
});
