import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAcceptancePlan, parseVisualReport } from '@cader/config';
import type { QualityPlan } from '@cader/config';
import { requiresQuality, verifyQuality, runQualityTask } from '@cader/profile';
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
  extra: { resume?: Parameters<typeof runQualityTask>[0]['resume']; connection?: string; clipped?: boolean; changed?: boolean;unrequestedSave?:boolean;unrequestedLines?:boolean } = {}) {
  const phases: string[] = [], actions: string[] = [];
  let reviews = 0, approvals = 0, ended = false;
  const runtime = {
    async run(_profile: string, _instruction: string, request?: {
      extraTools?: {
        execute: (args: unknown, exec: unknown) => Promise<unknown>;
      }[];
    }) {
      if(extra.unrequestedSave&&request?.extraTools)await assert.rejects(request.extraTools[0]!.execute({...plan,requirements:[...plan.requirements,{id:'unsolicited-save',check:'saved_dwg',description:'Invented file obligation',source_quote:'画图'}]}, {concludeTurn(){}}),/UNREQUESTED_FILE_ACCEPTANCE/);
      if(extra.unrequestedLines&&request?.extraTools)await assert.rejects(request.extraTools[0]!.execute({...plan,requirements:[...plan.requirements,{id:'unsolicited-line-limit',check:'entity_count',entity_type:'AcDbLine',max:12,description:'Invented primitive ceiling',source_quote:'画图'}]}, {concludeTurn(){}}),/UNREQUESTED_PRIMITIVE_LIMIT/);
      if(request?.extraTools)
        await request.extraTools[0]!.execute(plan, { concludeTurn() { } });
      else
        actions.push(phases.at(-1)!);
      return { status: 'succeeded', text: 'Fixture model says done', tools: [] };
    },
    async reviewCadView() {
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
    facts: () => ({ frozen: false, local_connection_id: extra.connection ?? 'fixture-connection', scratch: 'fixture.dwg' }),
    async authorizeTask() { approvals++; return true; }, endTask() { ended = true; },
    async snapshot() { return { entities: extra.changed && reviews > 0 ? [...entities, { type: 'fixture-change' }] : entities }; },
  };
  const options = {
    runtime, owner, task: '画图', profile: 'fixture', resume: extra.resume, emit: (e: {
      phase: unknown;
    }) => phases.push(String(e.phase)), persist: async () => { }
  };
  const result = await runQualityTask(options as unknown as Parameters<typeof runQualityTask>[0]);
  return { result, phases, actions, reviews, approvals, ended };
}
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
