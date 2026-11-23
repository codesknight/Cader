import { createHash, randomUUID } from 'node:crypto';
import { acceptancePlanSchema, parseAcceptancePlan, loadSkills, readReferenceImage } from '@cader/config';
import type { QualityPlan } from '@cader/config';
import type { createLiveRuntime, ToolDefinition, PublicEvent, ImageView } from '@cader/dsh-adapter';
import type { ExecutionSession, Approval } from './execution.js';
import type { ReferenceTask } from './reference-input.js';
import { referenceLayoutHints } from './reference-input.js';
import {crossesInterior} from './cad-arguments.js';
import { taskIntent } from './task-intent.js';
export type QualityPhase = 'reference' | 'planning' | 'drawing' | 'geometry' | 'topology' | 'vision' | 'correcting' | 'saving' | 'complete' | 'pending_verification' | 'blocked';
export interface CheckResult {
  id: string;
  status: 'pass' | 'fail' | 'not_run';
  evidence: string;
  details?:unknown;
}
export interface QualityResume {
  task_id: string;
  original_request: string;
  request_sha256: string;
  plan: QualityPlan;
  round: number;
  visual_calls?: VisualCall[];
  reviews?: unknown[];
  visual_attempt_count?: number;
  reference_task?:ReferenceTask|null;
  execution: {
    local_connection_id: string | null;
    scratch: string | null;
  };
}
export function requiresQuality(task: string) {
  if (taskIntent(task) !== 'drawing') return false;
  if(/有什么功能|能画什么|如何|怎么|已经.*验证.*吗/.test(task))return false;
  if(/^(?:请)?(?:移动|平移|旋转|move|rotate)/i.test(task))return false;
  return /画|绘制|重绘|复现|临摹|描绘|布局|添加.*(?:文字|标注)|(?:创建|设计|生成|制作|搭建|做).*(?:电路|图|符号|组件)|\bdraw\b|\bredraw\b|\btrace\b|\breproduce\b|\brecreate\b|\bdiagram\b|\bschematic\b/i.test(task);
}
type VisualResult = Awaited<ReturnType<Awaited<ReturnType<typeof createLiveRuntime>>['reviewCadView']>>;
type VisualCall = { source: 'agent' | 'harness'; observed_state_hash: string; review: VisualResult };

/** Compact evidence for model steps and status queries. Saved evidence is
 * historical, never a fresh native revision or authority to resume writes. */
export function qualityTaskContext(saved: { task_id: string; phase: string; original_request: string; round: number;
  checks: CheckResult[]; visual_calls?: VisualCall[]; reviews?: unknown[]; plan?: QualityPlan; visual_attempt_count?: number; visual_error?: string | null }) {
  const legacy = saved.reviews?.at(-1) as { image_evidence?: unknown; visual_report?: unknown } | undefined;
  const last = saved.visual_calls?.at(-1)?.review;
  const clipped=Boolean((last?.evidence as {image_bounds?:{possible_clipping?:boolean}}|undefined)?.image_bounds?.possible_clipping);
  return { task_id: saved.task_id, phase: saved.phase, original_request: saved.original_request,
    correction_round: saved.round, visual_call_count: saved.visual_attempt_count ?? Math.max(saved.visual_calls?.length ?? 0, saved.reviews?.filter(r => Boolean((r as { image_evidence?: unknown }).image_evidence)).length ?? 0),
    visual_error: saved.visual_error ?? null,
    pending_reasons: [...new Set([...saved.checks.filter(c=>c.status!=='pass').map(c=>c.id),
      ...(clipped?['capture_bounds']:[]),...(saved.visual_error?[saved.visual_error]:[]),...(last&&!last.review_valid?['visual_report_invalid']:[])])],
    last_visual: last ? { review_valid: last.review_valid, result: last.structured, image_evidence: last.evidence, image_ref: last.image_ref } : legacy ? { result: legacy.visual_report, image_evidence: legacy.image_evidence } : null,
    checks: saved.checks, unmet_conditions: saved.checks.filter(c => c.status !== 'pass'),
    verification: {
      geometry: saved.checks.filter(c => !['visual','series_cycle'].includes(saved.plan?.requirements?.find(r=>r.id===c.id)?.check??'')),
      topology: saved.checks.filter(c => saved.plan?.requirements?.find(r=>r.id===c.id)?.check==='series_cycle'),
      vision: last ? {valid:last.review_valid,verdict:last.structured?.verdict??null} : legacy?.visual_report??null,
    },
    acceptance: saved.phase === 'complete' ? 'passed' : 'pending',
    evidence_scope: 'Task evidence; no authoritative native revision. Re-query before further edits or acceptance.' };
}
type Entity = Record<string, any>;
type P = number[];
const distance = (a: P, b: P) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
// Normalize typographic variants, retaining case-sensitive SI prefixes and values.
const labelText=(text:string)=>text.normalize('NFKC').replaceAll('\u2212','-').replace(/\s+/g,'');
const pointOn = (p: P, a: P, b: P, tol = 1e-5) => {
  const length = distance(a, b);
  if(length < tol)
    return distance(a, p) < tol;
  return Math.abs((b[0]! - a[0]!) * (p[1]! - a[1]!) - (b[1]! - a[1]!) * (p[0]! - a[0]!)) / length <= tol &&
    (p[0]! - a[0]!) * (p[0]! - b[0]!) + (p[1]! - a[1]!) * (p[1]! - b[1]!) <= tol;
};
function intersection(a: P, b: P, c: P, d: P): P | undefined {
  const x = b[0]! - a[0]!, y = b[1]! - a[1]!, u = d[0]! - c[0]!, v = d[1]! - c[1]!;
  const cross = x * v - y * u;
  if(Math.abs(cross) < 1e-10)
    return;
  const dx = c[0]! - a[0]!, dy = c[1]! - a[1]!, t = (dx * v - dy * u) / cross, s = (dx * y - dy * x) / cross;
  if(t >= -1e-8 && t <= 1 + 1e-8 && s >= -1e-8 && s <= 1 + 1e-8)
    return [a[0]! + t * x, a[1]! + t * y];
}
/** Domain-neutral port graph: actual CAD wires + declared component port pairs.
 * Component semantics are selected by the acceptance plan, never a fixed drawing sequence. */
export function verifyQuality(plan: QualityPlan, entities: Entity[], context:{new_document?:boolean;saved_dwg?:boolean}={}): CheckResult[] {
  const wires = entities.filter(e => e.type === 'AcDbLine' && e.layer === plan.wire_layer && Array.isArray(e.start_point) && Array.isArray(e.end_point));
  const points: P[] = [];
  const key = (p: P) => {
    let i = points.findIndex(v => distance(v, p) < 1e-5); if(i < 0) {
      i = points.length;
      points.push(p);
    } return i;
  };
  const edges: [
    number,
    number
  ][] = [];
  // Split at all endpoints and declared ports; this catches T branches instead of hiding them.
  wires.forEach(e => { key(e.start_point); key(e.end_point); });
  plan.components.forEach(c => c.ports.forEach(key));
  for(let i = 0;i < wires.length;i++)
    for(let j = i + 1;j < wires.length;j++) {
      const a = wires[i]!, b = wires[j]!, p = intersection(a.start_point, a.end_point, b.start_point, b.end_point);
      if(p)
        key(p);
    }
  for(const e of wires) {
    const nodes = points.map((p, i) => ({ p, i })).filter(v => pointOn(v.p, e.start_point, e.end_point)).sort((a, b) => distance(a.p, e.start_point) - distance(b.p, e.start_point));
    for(let i = 1;i < nodes.length;i++)
      edges.push([nodes[i - 1]!.i, nodes[i]!.i]);
  }
  for(const c of plan.components)
    edges.push([key(c.ports[0]), key(c.ports[1])]);
  const degrees = points.map(() => 0);
  edges.forEach(([a, b]) => { degrees[a]!++; degrees[b]!++; });
  const seen = new Set<number>();
  const walk = (i: number) => {
    if(seen.has(i))
      return; seen.add(i); for(const [a, b] of edges) {
        if(a === i)
          walk(b);
        if(b === i)
          walk(a);
      }
  };
  if(points.length)
    walk(0);
  const missingComponents = plan.components.filter(c => !entities.some(e => !['AcDbText', 'AcDbMText'].includes(e.type) && e.layer !== plan.wire_layer && e.bounding_box &&
    e.bounding_box.min[0] >= c.bounds[0][0] - 1e-5 && e.bounding_box.max[0] <= c.bounds[1][0] + 1e-5 &&
    e.bounding_box.min[1] >= c.bounds[0][1] - 1e-5 && e.bounding_box.max[1] <= c.bounds[1][1] + 1e-5));
  const componentEvidence=missingComponents.length===0;
  const plane = wires[0]?.start_point[2] ?? 0;
  const planar = wires.every(w => Math.abs((w.start_point[2] ?? 0) - plane) < 1e-5 && Math.abs((w.end_point[2] ?? 0) - plane) < 1e-5);
  const supported = entities.filter(e => e.layer === plan.wire_layer).every(e => e.type === 'AcDbLine');
  const cycle = planar && supported && plan.components.length >= 2 && wires.length > 0 && componentEvidence && points.length > 0 && degrees.every(d => d === 2) && seen.size === points.length;
  const through = wires.some(e => plan.components.some(c => crossesInterior(e.start_point, e.end_point, c.bounds)));
  const labels = entities.filter(e => typeof e.text_string === 'string' && e.bounding_box);
  const textOverlap = labels.some(e => wires.some(w => crossesInterior(w.start_point, w.end_point, [e.bounding_box.min, e.bounding_box.max])));
  return plan.requirements.map(r => {
    let pass = false;
    let evidence = '';
    if(r.check==='new_document')return {id:r.id,status:context.new_document?'pass':'not_run',evidence:context.new_document?'本任务new_drawing已确认':'本任务新建图纸未确认'};
    if(r.check==='saved_dwg')return {id:r.id,status:context.saved_dwg?'pass':'not_run',evidence:context.saved_dwg?'本任务DWG保存、文件头及hash已校验':'等待程序保存/文件校验，不能从截图判断'};
    if(r.check === 'visual')
      return { id: r.id, status: 'not_run', evidence: 'Requires validated image review' };
    if(r.check === 'entity_count') {
      const actual = entities.filter(e => !r.entity_type || e.type === r.entity_type).length;
      pass = actual >= (r.min ?? 1) && actual <= (r.max ?? Number.MAX_SAFE_INTEGER);
      evidence = `actual=${actual}, expected=${r.min ?? 1}..${r.max ?? 'unbounded'}`;
    }
    if(r.check === 'text') {
      const found = labels.filter(e => r.text && labelText(e.text_string)===labelText(r.text));
      const c = plan.components.find(c => c.id === r.component);
      const nearby=found.filter(e => !c || distance([(e.bounding_box.min[0] + e.bounding_box.max[0]) / 2, (e.bounding_box.min[1] + e.bounding_box.max[1]) / 2], [(c.bounds[0][0] + c.bounds[1][0]) / 2, (c.bounds[0][1] + c.bounds[1][1]) / 2]) <= 3 * Math.max(c.bounds[1][0] - c.bounds[0][0], c.bounds[1][1] - c.bounds[0][1]));
      pass=nearby.length>=(r.min??1)&&nearby.length<=(r.max??Number.MAX_SAFE_INTEGER);
      evidence = `matching text entities=${nearby.map(e => e.object_id).join(',') || 'none'}; proximity=${r.component ?? 'not requested'}; literal=${r.text}; SI case preserved`;
    }
    if(r.check === 'series_cycle') {
      pass = cycle;
      evidence = `connected=${seen.size === points.length}, degrees=${degrees.join(',')}, component evidence=${componentEvidence}, planar=${planar}, supported wire types=${supported}`;
      if(!cycle)return {id:r.id,status:'fail',evidence,details:{
        tolerance:1e-5,
        invalid_nodes:points.map((position,i)=>({position,degree:degrees[i],wire_ids:wires.filter(w=>pointOn(position,w.start_point,w.end_point)).map(w=>w.object_id)})).filter(n=>n.degree!==2).slice(0,24),
        unconnected_ports:plan.components.flatMap(c=>c.ports.map(position=>({component:c.id,position}))).filter(p=>!wires.some(w=>pointOn(p.position,w.start_point,w.end_point))).map(p=>({...p,nearest_endpoints:wires.flatMap(w=>[w.start_point,w.end_point].map(position=>({object_id:w.object_id,position,gap:distance(p.position,position)}))).sort((a,b)=>a.gap-b.gap).slice(0,2)})),
        missing_component_evidence:missingComponents.map(c=>({component:c.id,bounds:c.bounds,nearby_entities:entities.filter(e=>e.layer!==plan.wire_layer&&e.bounding_box&&e.bounding_box.max[0]>=c.bounds[0][0]&&e.bounding_box.min[0]<=c.bounds[1][0]&&e.bounding_box.max[1]>=c.bounds[0][1]&&e.bounding_box.min[1]<=c.bounds[1][1]).slice(0,4).map(e=>({object_id:e.object_id,type:e.type,bounding_box:e.bounding_box}))})),
        unsupported_wire_entities:entities.filter(e=>e.layer===plan.wire_layer&&e.type!=='AcDbLine').map(e=>({object_id:e.object_id,type:e.type,layer:e.layer})),
        rule:'Use observed CAD coordinates. Restore geometry/lead endpoints to frozen ports and bounds; do not change the plan or add overlapping shortcut wires.'
      }};
    }
    if(r.check === 'no_wire_through_component') {
      pass = !through;
      evidence = `wire crosses component interior=${through}`;
    }
    if(r.check === 'text_clearance') {
      pass = !textOverlap;
      evidence = `wire intersects text bounding box=${textOverlap}`;
    }
    return { id: r.id, status: pass ? 'pass' : 'fail', evidence };
  });
}
export async function runQualityTask(options: {
  runtime?: Awaited<ReturnType<typeof createLiveRuntime>>;
  profile: string;
  task: string;
  root?: string;
  owner: ExecutionSession;
  signal?: AbortSignal;
  confirm?: Approval;
  emit: (event: PublicEvent) => void;
  resume?: QualityResume;
  persist: (state: unknown) => Promise<void>;
  request?: Parameters<Awaited<ReturnType<typeof createLiveRuntime>>['run']>[2];
  referenceTask?:ReferenceTask;
  alwaysVisual?: boolean;
  onState?: (state: ReturnType<typeof qualityTaskContext>) => void;
}) {
  const { runtime, owner, task, signal } = options;
  let phase: QualityPhase = 'planning', plan: QualityPlan | undefined, round = 0, checks: CheckResult[] = [], visual: unknown = null;
  const modelRuns: {
    phase: QualityPhase;
    status: string;
    text: string;
    tools: string[];
  }[] = [];
  const reviews: unknown[] = [...options.resume?.reviews ?? []];
  const visualCalls: VisualCall[] = [...options.resume?.visual_calls ?? []];
  let visualAttempts=options.resume?.visual_attempt_count??qualityTaskContext({task_id:'',phase:'',original_request:'',round:0,checks:[],visual_calls:visualCalls,reviews}).visual_call_count;
  let visualError:string|null=null;
  let cachedReview: { key: string; review: VisualResult } | undefined;
  let reviewedWrites: string | undefined;
  let reviewFlight: Promise<VisualResult> | undefined;
  let guidance = '';
  const referenceTask=options.referenceTask??options.resume?.reference_task??undefined;
  let artifact:Awaited<ReturnType<ExecutionSession['saveTaskArtifact']>>|null=null;
  let accepted=false;
  let referenceObservation:Awaited<ReturnType<NonNullable<typeof runtime>['inspectReference']>>|null=null;
  let referenceView:ImageView|undefined;
  const sourceUnchanged=async()=>{
    if(!referenceTask)return;
    const image=await readReferenceImage(owner.workspace,referenceTask.image.path);
    if(createHash('sha256').update(image.data).digest('hex')!==referenceTask.image.sha256)throw new Error('REFERENCE_CHANGED_RESELECT_REQUIRED');
  };
  let failure: {stage:QualityPhase;code:string;source:'model'|'verification'}|null=null;
  const transitions: {
    phase: QualityPhase;
    at: string;
  }[] = [];
  const hash = createHash('sha256').update(task).digest('hex');
  const taskId = options.resume?.task_id ?? randomUUID();
  const state = () => ({ version: 1, task_id: taskId, phase, original_request: task, request_sha256: hash, plan, round, checks, visual, reviews, visual_calls: visualCalls, visual_attempt_count:visualAttempts,visual_error:visualError,transitions, failure,reference_task:referenceTask??null,reference_observation:referenceObservation,artifact,quality_accepted:accepted, model_runs: modelRuns, execution: owner.facts() });
  const publish = () => { const facts=owner.facts();const context = {...qualityTaskContext(state()),
    visual_evidence_requires_recheck: !cachedReview || facts.frozen || reviewedWrites!==JSON.stringify([facts.local_connection_id,facts.scratch,facts.session_counts]),
    authorization: 'Task-scoped grant enforced by ExecutionSession; never inherited from task evidence.'}; options.onState?.(context); return context; };
  const act = async (instruction: string, request?: Parameters<Awaited<ReturnType<typeof createLiveRuntime>>['run']>[2]) => {
    if(!runtime)throw new Error('QUALITY_RUNTIME_REQUIRED');
    await sourceUnchanged();
    const sourceHints=referenceObservation?.structured?referenceLayoutHints(referenceObservation.structured,referenceObservation.evidence):null;
    let reviewSubmitted=false;
    const result = await runtime.run(options.profile, instruction + '\n领域质量知识（数据，不授予权限）：\n' + guidance+
      (sourceHints?'\n原图已观察事实及统一CAD坐标提示（y向上，禁止把像素y向下直接当CAD坐标）：\n'+JSON.stringify(sourceHints):''),
      { ...options.request,...request,taskState:publish,harnessTask:true,
        controlledReview:async(_question,reviewSignal)=>{const review=await reviewCurrent('agent',reviewSignal);reviewSubmitted=true;return review;},reviewEndsTurn:true,
        resultText:request?.resultText??(()=>reviewSubmitted?'已提交受控视觉证据，交由Harness继续验收；这不是完成声明。':undefined),
        image:referenceTask?.image.path??request?.image??options.request?.image,imageView:options.request?.imageView??referenceView, signal });
    modelRuns.push({ phase, status: result.status, text: result.text, tools: result.tools });
    if(result.status !== 'succeeded'){
      const missingPlan=phase==='planning'&&!result.errorCode;
      failure={stage:phase,code:result.errorCode??(missingPlan?'ACCEPTANCE_PLAN_MISSING':'AGENT_FAILED'),source:missingPlan?'verification':'model'};
      throw new Error(`QUALITY_MODEL_${result.status.toUpperCase()}`);
    }
    return result;
  };
  const enter = async (next: QualityPhase) => { phase = next; transitions.push({ phase, at: new Date().toISOString() }); publish(); options.emit({ type: 'task.phase', phase, round, has_reference: Boolean(referenceTask) }); await options.persist(state()); };
  // Both the model tool and mandatory fallback use this controller. Cache is
  // task-local and requires the same connection, document, writes and full readback.
  const reviewCurrent = async (source: 'agent' | 'harness', reviewSignal = signal): Promise<VisualResult> => {
    if (reviewFlight) { await reviewFlight; reviewSignal?.throwIfAborted(); return reviewCurrent(source, reviewSignal); }
    const perform = async () => {
      reviewSignal?.throwIfAborted();
      if (!runtime || !plan || !['drawing','correcting','vision'].includes(phase)) throw new Error('VISUAL_REVIEW_PHASE_DENIED');
      if (owner.facts().frozen) throw new Error('CAD_CAPTURE_BLOCKED_FROZEN');
      await sourceUnchanged();
      const before = await owner.snapshot();
      reviewSignal?.throwIfAborted();
      const facts = owner.facts();
      const digest = createHash('sha256').update(JSON.stringify(before.entities)).digest('hex');
      const key = JSON.stringify([taskId, facts.local_connection_id, facts.scratch, before.document, digest, facts.session_counts, plan, referenceTask?.image.sha256]);
      if (cachedReview?.key === key) {
        options.emit({type:'task.visual',source,reused:true,review_valid:cachedReview.review.review_valid,verdict:cachedReview.review.structured?.verdict??null});
        return cachedReview.review;
      }
      const geometry = verifyQuality(plan, before.entities, {new_document:owner.taskScope?.(taskId).new_drawing_confirmed,saved_dwg:Boolean(artifact)});
      checks=geometry;publish();
      visualAttempts++;visualError=null;publish();
      const review = await runtime.reviewCadView(JSON.stringify({ original_request: task,
        requirements: plan.requirements.filter(r => r.check === 'visual'), geometry, domain_guidance: guidance,
        entity_snapshot: before.entities, observed_state_hash: digest, document_revision: null,
        note: 'Image evidence checks appearance. Queried coordinates/IDs are authoritative; ambiguous pixels remain uncertain.',reference:referenceTask?.image??null }),reviewSignal,referenceTask?.image.path);
      visual = review;
      visualCalls.push({source,observed_state_hash:digest,review});
      const after = await owner.snapshot();
      reviewSignal?.throwIfAborted();
      await sourceUnchanged();
      const afterFacts=owner.facts();
      const stable = !afterFacts.frozen && before.document===after.document && facts.local_connection_id===afterFacts.local_connection_id && facts.scratch===afterFacts.scratch &&
        digest===createHash('sha256').update(JSON.stringify(after.entities)).digest('hex') && JSON.stringify(facts.session_counts)===JSON.stringify(afterFacts.session_counts);
      // Invalid or stale results are retained as evidence, never reusable acceptance.
      if(stable && review.review_valid) {cachedReview={key,review};reviewedWrites=JSON.stringify([afterFacts.local_connection_id,afterFacts.scratch,afterFacts.session_counts]);}
      else cachedReview=undefined;
      publish(); await options.persist(state());
      options.emit({type:'task.visual',source,reused:false,call_count:visualCalls.length,review_valid:review.review_valid,verdict:review.structured?.verdict??null,observation_unchanged:stable});
      if(!stable) throw new Error('VISUAL_OBSERVATION_CHANGED');
      return review;
    };
    reviewFlight=perform();
    try { return await reviewFlight; }
    catch(error){visualError=error instanceof Error?error.message:'VISUAL_REVIEW_FAILED';publish();await options.persist(state());throw error;}
    finally {reviewFlight=undefined;}
  };
  const saveReferenceArtifact=async()=>{
    if(!referenceTask)return;
    await sourceUnchanged();await enter('saving');
    artifact=await owner.saveTaskArtifact(taskId,referenceTask.outputPath,options.confirm,signal);
    checks=checks.map(check=>plan!.requirements.find(r=>r.id===check.id)?.check==='saved_dwg'?{id:check.id,status:'pass',evidence:'本任务DWG保存、文件头、hash和保存后CAD查询已验证'}:check);
    options.emit({type:'artifact.verified',artifact,quality:accepted?'accepted':'pending'});
  };
  const tool: ToolDefinition = {
    name: 'cader_submit_acceptance_plan', description: 'Submit requirements quoted from the original request and independently testable checks. Components have planned bounds and two actual connection ports. Wire layer is explicit. Do not submit CAD operation sequences.', parameters: acceptancePlanSchema,
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] }, async execute(args, exec) {
      const parsed = parseAcceptancePlan(args);
      if(parsed.requirements.some(r => !task.toLowerCase().includes(r.source_quote.toLowerCase())))
        throw new Error('SOURCE_QUOTE_MUST_BE_FROM_ORIGINAL_REQUEST');
      if(!referenceTask&&parsed.requirements.some(r=>r.check==='saved_dwg')&&!/保存|另存|导出|\bsave\b|\bexport\b|\.dwg\b/i.test(task))throw new Error('UNREQUESTED_FILE_ACCEPTANCE: no DWG save was requested; remove saved_dwg rather than inventing a delivery condition');
      if(!referenceTask&&parsed.domain==='electrical-schematic'&&parsed.requirements.some(r=>r.check==='entity_count'&&r.entity_type==='AcDbLine'&&r.max!==undefined)&&!/线段|直线|最多.*线|\blines?\b/i.test(task))throw new Error('UNREQUESTED_PRIMITIVE_LIMIT: the user specified components, not a maximum number of AcDbLine entities; use symbol/topology checks, without an invented line-count ceiling');
      if(!referenceTask&&parsed.requirements.some(r=>r.check==='entity_count'&&r.max!==undefined)&&!/直线|线段|多段线|圆|圆弧|矩形|文字|文本|\b(?:lines?|circles?|arcs?|polylines?|rectangles?|texts?)\b/i.test(task))throw new Error('UNREQUESTED_PRIMITIVE_LIMIT: no primitive counts were specified; use visual component/layout conditions without invented entity-count ceilings');
      if(/电路|circuit/i.test(task) && parsed.domain !== 'electrical-schematic')
        throw new Error('SCHEMATIC_TOPOLOGY_REQUIRED');
      if(/并联|\bparallel\b/i.test(task) && parsed.domain === 'electrical-schematic') throw new Error('PARALLEL_TOPOLOGY_VERIFIER_UNAVAILABLE: cannot substitute a series-cycle check');
      if(/图|diagram|文字|text|电路|circuit/i.test(task))
        parsed.visual_required = true;
      if(options.alwaysVisual||requiresQuality(task)||parsed.requirements.some(r=>r.check==='visual')) parsed.visual_required = true;
      if(parsed.visual_required&&!parsed.requirements.some(r=>r.check==='visual'))throw new Error('VISUAL_ACCEPTANCE_REQUIRED: include an independently reviewable visual condition quoted from the original request');
      if(referenceTask){
        parsed.visual_required=true;
        if(!parsed.requirements.some(r=>r.check==='visual'))throw new Error('REFERENCE_APPEARANCE_CHECK_REQUIRED');
        const labels=referenceObservation?.structured?.visible_text.filter(t=>t.certainty==='clear'&&/[\p{L}\p{N}]/u.test(t.text))??[];
        const missing=labels.filter(t=>!parsed.requirements.some(r=>r.check==='text'&&r.text&&labelText(r.text)===labelText(t.text)));
        if(missing.length)throw new Error('SOURCE_LABEL_ACCEPTANCE_REQUIRED: preserve exact verified source labels and SI case in text checks: '+JSON.stringify(missing.map(t=>t.text)));
      }
      plan = parsed;
      exec.concludeTurn();
      return JSON.stringify(plan);
    }
  };
  try {
    if(owner.facts().frozen){await enter('blocked');return state();}
    if(!runtime)throw new Error('QUALITY_RUNTIME_REQUIRED');
    await sourceUnchanged();
    if(referenceTask){
      await enter('reference');
      referenceObservation=await runtime.inspectReference(referenceTask.image.path,task,signal);
      if(!referenceObservation.valid||referenceObservation.evidence.sha256!==referenceTask.image.sha256||!referenceObservation.structured?.objects.length){
        failure={stage:'reference',code:'REFERENCE_INSPECTION_FAILED',source:'verification'};await enter('blocked');return state();
      }
      const [a,b]=referenceObservation.structured.content_bounds,w=referenceObservation.evidence.width,h=referenceObservation.evidence.height;
      const margin=Math.max(b[0]-a[0],b[1]-a[1])*0.03;
      const left=Math.max(0,Math.floor((a[0]-margin)*w)),top=Math.max(0,Math.floor((a[1]-margin)*h));
      referenceView={crop:{left,top,width:Math.min(w,Math.ceil((b[0]+margin)*w))-left,height:Math.min(h,Math.ceil((b[1]+margin)*h))-top}};
    }
    await enter('planning');
    if(options.resume) {
      plan = parseAcceptancePlan(options.resume.plan);
      round = options.resume.round;
      if(hash !== options.resume.request_sha256 || !Number.isInteger(options.resume.round) || options.resume.round < 0 || options.resume.round > 3 || !owner.facts().local_connection_id || owner.facts().local_connection_id !== options.resume.execution.local_connection_id || owner.facts().scratch !== options.resume.execution.scratch) {
        await enter('blocked');
        return state();
      }
    }
    else {
      const planningRequest={ signal, onlyTools: [tool.name,'cader_view_image'], extraTools: [tool], resultText: () => plan ? JSON.stringify(plan) : undefined };
      try {
      await act('用中文规划以下绘图任务。必须调用cader_submit_acceptance_plan，只提交紧凑需求验收清单；普通插画的components可为空，勿虚构连接端口。仅拓扑任务需要组件布局/端口；此阶段不能绘图。若有参考图片，必须先观察实际像素；可用cader_view_image裁看原图。识别可读符号、文字与连接，示意图使用布局坐标，不因缺少物理比例尺全局拒绝；不可读的值单独标未知。source_quote必须原样引用用户请求，图片中数值可在description/text写出并用“参考图”等请求原文作source_quote。独立列出数量、文字、布局及源图外观匹配条件。新建文档与保存由程序验证，不能用任意实体数代替。entity_count必须是可测的实际AcDb类型；COM draw_polyline/rectangle生成AcDb2dPolyline，不是AcDbPolyline。组件语义使用visual检查。电路使用真实组件边界端口和适合的拓扑检查，不强加电路条件到普通图。标注以text检查，禁止导线穿组件或短接其端口。不得把本阶段的“只做规划”误写为整任务不准绘图。\n' + task,
        planningRequest);
      } catch(error) {
        const failed=runtime.completed().filter(run=>run.profile===options.profile).at(-1);
        if(plan||signal?.aborted||failed?.errorCode!=='OUTPUT_TRUNCATED')throw error;
        failure=null;
        options.emit({type:'task.planning_retry',reason:'OUTPUT_TRUNCATED',attempt:1});
        await act('上次规划被截断。仅调用cader_submit_acceptance_plan提交紧凑计划，不输出长文；保持原始需求不变、逐项引用原文。普通插画components可为空；不加入未请求的保存或图元数量上限。必要语义/颜色/布局/风格用visual，新图用new_document。电路仍必须满足端口和拓扑schema。\n'+task,planningRequest);
        const recovered=runtime.completed().filter(run=>run.profile===options.profile).at(-1);
        if(recovered?.status==='succeeded')failed.recovered_by=recovered.id;
      }
    }
    if(!plan) {
      failure={stage:'planning',code:'ACCEPTANCE_PLAN_MISSING',source:'verification'};
      await enter('blocked');
      return state();
    }
    if(options.root && plan.domain === 'electrical-schematic')
      guidance = await (await loadSkills(options.root)).read('electrical-quality', 'main');
    if(!await owner.authorizeTask(taskId, plan, options.confirm,referenceTask)) {
      await enter('blocked');
      return state();
    }
    await enter('drawing');
    if(!options.resume)
      await act((referenceTask?'根据当前实际附带的原图重绘。本任务必须先调用new_drawing新建空白图，不允许复用上一任务图。图层先创建再使用；不要只写分析或要求GUI上传。程序会将结果保存到约定DWG，模型阶段不要保存。':'按原始请求及已封存验收计划自主绘图，不要重建已存在的合适工作图。')+'所有点必须XYZ，按验收计划绝对坐标与端口位置执行。WIRE只用于组件外部连接，不得跨过组件本体或短接同一组件两端。所有文本应按原图可读标注绘制，不虚构尺寸。绘制后主动调用cader_review_cad_view检查实际结果；该入口由程序绑定本任务需求和实体证据，已有有效检查会复用。若未调用，调度器仍会补验；不要向用户宣称完成。\n' + JSON.stringify({ task, plan }), options.request);
    if(referenceTask&&!owner.facts().frozen){
      let scope=owner.taskScope(taskId);
      if(!scope.new_drawing_confirmed||!scope.geometry_confirmed){
        await act('本任务尚缺实际执行证据。只补齐未执行的步骤，不得重放已确认几何。先新建本任务图纸，再实际绘图；不要只描述计划。\n'+JSON.stringify({task,plan,scope}));
        scope=owner.taskScope(taskId);
      }
      if(!scope.owned||!scope.new_drawing_confirmed||!scope.geometry_confirmed){
        failure={stage:'drawing',code:'TASK_EXECUTION_REQUIRED',source:'verification'};await enter('blocked');return state();
      }
    }
    for(round = options.resume?.round ?? 0;round <= 3;round++) {
      signal?.throwIfAborted();
      if(owner.facts().frozen) {
        await enter('blocked');
        break;
      }
      await enter('geometry');
      const snapshot = await owner.snapshot();
      await sourceUnchanged();
      if(referenceTask&&snapshot.document!==owner.taskScope(taskId).target)throw new Error('TASK_DOCUMENT_MISMATCH');
      if(referenceTask&&!snapshot.entities.some(e=>owner.taskScope(taskId).entity_ids.includes(e.object_id))){
        failure={stage:'geometry',code:'TASK_EXECUTION_REQUIRED',source:'verification'};await enter('blocked');break;
      }
      checks = verifyQuality(plan, snapshot.entities,{new_document:owner.taskScope?.(taskId).new_drawing_confirmed,saved_dwg:Boolean(artifact??owner.taskArtifact?.(taskId))});
      await enter('topology');
      const snapshotHash = createHash('sha256').update(JSON.stringify(snapshot.entities)).digest('hex');
      if(plan.visual_required) {
        await enter('vision');
        visual = await reviewCurrent('harness');
      }
      const review = visual as Awaited<ReturnType<typeof runtime.reviewCadView>> | null;
      const knownIds = new Set(snapshot.entities.map(e => e.object_id));
      const referencesValid = review?.structured?.defects.every(d => d.entity_ids.every(id => knownIds.has(id))) ?? false;
      const clipped = Boolean((review?.evidence as {
        image_bounds?: {
          possible_clipping?: boolean;
        };
      } | undefined)?.image_bounds?.possible_clipping);
      const sourceBound=!referenceTask||Boolean((review?.evidence as {reference?:{sha256?:string};document?:string}|undefined)?.reference?.sha256===referenceTask.image.sha256&&
        (review?.evidence as {document?:string})?.document===owner.taskScope(taskId).target);
      const valid = !plan.visual_required || Boolean(review?.review_valid && referencesValid && sourceBound && !clipped && review.structured?.verdict === 'pass');
      const sourceLabelsUncertain=referenceObservation?.structured?.visible_text.some(t=>t.certainty==='uncertain'&&/[\p{L}\p{N}]/u.test(t.text))??false;
      const visualChecks = plan.requirements.filter(r => r.check === 'visual').map(r => {
        const item = review?.structured?.checklist.find(c => c.requirement_id === r.id);
        return { id: r.id, status: item?.status === 'pass' && referencesValid ? 'pass' : item?.status === 'fail' ? 'fail' : 'not_run', evidence: item?.evidence ?? 'Missing validated visual checklist' } as CheckResult;
      });
      checks = checks.map(c => c.status === 'not_run' ? (visualChecks.find(v => v.id === c.id) ?? c) as CheckResult : c);
      const after = await owner.snapshot();
      const unchanged = snapshotHash === createHash('sha256').update(JSON.stringify(after.entities)).digest('hex');
      reviews.push({
        round, original_request: task, requirements: plan.requirements, checks, observed_state_hash: snapshotHash,
        document_revision: null, image_evidence: review?.evidence ?? null, visual_report: review?.structured ?? null,
        references_valid: referencesValid, source_bound:sourceBound,possible_clipping: clipped, observation_unchanged: unchanged,
        disagreements: checks.filter(c => c.status === 'pass' && review?.structured?.checklist.some(v => v.requirement_id === c.id && v.status !== 'pass')).map(c => c.id),
        entity_mapping: 'queried ObjectIDs; pixel-to-CAD transform unavailable; visual suggestions require coordinate reconciliation'
      });
      const beforeSave=checks.filter(c=>!referenceTask||plan!.requirements.find(r=>r.id===c.id)?.check!=='saved_dwg');
      signal?.throwIfAborted();
      if(valid && unchanged && !sourceLabelsUncertain && beforeSave.every(c => c.status === 'pass')) {
        // Only a fully accepted, current review can supersede older failed
        // vision attempts. Preserve failures and their evidence in the journal.
        const replacement=review?.attempts.filter(attempt=>attempt.valid&&attempt.status==='succeeded').at(-1)?.id;
        if(replacement)for(const attempt of visualCalls.flatMap(call=>call.review.attempts)){
          const failed=runtime.completed?.().find(run=>run.id===attempt.id&&run.status!=='succeeded'&&!run.recovered_by);
          if(failed&&failed.id!==replacement){failed.recovered_by=replacement;options.emit({type:'task.visual_recovered',failed_agent_id:failed.id,replacement_agent_id:replacement});}
        }
        accepted=true;
        if(!referenceTask)await enter('complete');
        break;
      }
      if(clipped)
        checks.push({ id: 'capture_bounds', status: 'not_run', evidence: '视图边缘出现图形，可能被裁切；不得依据不完整图片修改几何。检查MCP打印范围及缩放。' });
      const nonActionableUncertainty = review?.structured?.verdict === 'uncertain' && !review.structured.defects.length && !checks.some(c => c.status === 'fail' && plan!.requirements.find(r => r.id === c.id)?.check !== 'visual');
      if(nonActionableUncertainty) checks.push({ id: 'visual_uncertainty', status: 'not_run', evidence: '必要视觉结论仍不确定；没有可定位缺陷，不做推测性修改，保留证据以便安全重验。' });
      if(sourceLabelsUncertain)checks.push({id:'source_labels_uncertain',status:'not_run',evidence:'原图局部复核后仍有必要文字不确定；已绘制结果只能保存为待验稿，不猜测SI单位或标注'});
      if(sourceLabelsUncertain || nonActionableUncertainty || clipped || !sourceBound || !unchanged || round === 3 || (plan.visual_required && (!review?.review_valid || !referencesValid))) {
        await enter('pending_verification');
        break;
      }
      await enter('correcting');
      await act('使用中文。程序已附实际读回实体和定位到坐标/ID的拓扑缺陷，修改前核对目标实体，再调用cader_apply_cad_patch或CAD修改工具提交实际局部修改。优先修复程序明确指出的断点、分支、组件越界与文字，不重复增加已存在的线段；错误导线应替换，不能叠加捷径。组件必须容纳于封存bounds且符号引线到达封存ports，物理圆不能画成超出盒的椭圆近似。不要只描述计划，不输出长篇思考，不整图重建；删除仅限本任务实体，由执行层检查。以坐标核对视觉分歧，不能凭像素编辑。验收计划不能更改。不要宣称完成，修正后主动调用cader_review_cad_view；程序仍会重新核验。\n' + JSON.stringify({ original_request: task, plan, checks, entity_snapshot:after.entities,visual: review?.structured }));
    }
    if(referenceTask&&!owner.facts().frozen&&(phase as QualityPhase)!=='blocked'){
      await saveReferenceArtifact();
      await enter(accepted?'complete':'pending_verification');
    }
  }
  catch(error) {
    if((phase as QualityPhase)==='saving')failure={stage:phase,code:'DWG_SAVE_FAILED',source:'verification'};
    if(!failure)visual = { previous: visual, error: (error as Error).message };
    if(referenceTask&&failure?.source==='model'&&!signal?.aborted&&!owner.facts().frozen&&owner.taskScope(taskId).new_drawing_confirmed&&owner.taskScope(taskId).geometry_confirmed){
      accepted=false;
      checks.push({id:'model_interrupted',status:'not_run',evidence:'模型中断后的当前图形尚未重新完成质量验收；仅保存待验稿'});
      try{await saveReferenceArtifact();}catch(saveError){visual={previous:visual,save_error:(saveError as Error).message};}
    }
    await enter(failure||owner.facts().frozen ? 'blocked' : 'pending_verification');
  }
  finally {
    owner.endTask();
  }
  await options.persist(state());
  return state();
}
