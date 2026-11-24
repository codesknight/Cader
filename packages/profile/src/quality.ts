import { createHash, randomUUID } from 'node:crypto';
import { acceptancePlanSchema, parseAcceptancePlan, loadSkills, readReferenceImage } from '@cader/config';
import type { QualityPlan } from '@cader/config';
import type { createLiveRuntime, ToolDefinition, PublicEvent, ImageView } from '@cader/dsh-adapter';
import type { ExecutionSession, Approval } from './execution.js';
import type { ReferenceTask } from './reference-input.js';
import { referenceLayoutHints } from './reference-input.js';
import {crossesInterior} from './cad-arguments.js';
import { taskIntent } from './task-intent.js';
import {verifyNetlist,missingSymbolPorts} from './netlist.js';
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
  visual_model_call_count?:number;
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
  checks: CheckResult[]; visual_calls?: VisualCall[]; reviews?: unknown[]; plan?: QualityPlan; visual_attempt_count?: number;visual_model_call_count?:number;visual_error?: string | null }) {
  const legacy = saved.reviews?.at(-1) as { image_evidence?: unknown; visual_report?: unknown } | undefined;
  const last = saved.visual_calls?.at(-1)?.review;
  const clipped=Boolean((last?.evidence as {image_bounds?:{possible_clipping?:boolean}}|undefined)?.image_bounds?.possible_clipping);
  return { task_id: saved.task_id, phase: saved.phase, original_request: saved.original_request,
    correction_round: saved.round, visual_call_count:saved.visual_model_call_count??Math.max(saved.visual_calls?.reduce((sum,call)=>sum+(call.review.attempts?.length??1),0)??0,saved.reviews?.filter(r=>Boolean((r as {image_evidence?:unknown}).image_evidence)).length??0),
    capture_attempt_count:saved.visual_attempt_count??Math.max(saved.visual_calls?.length??0,saved.reviews?.filter(r=>Boolean((r as {image_evidence?:unknown}).image_evidence)).length??0),
    visual_error: saved.visual_error ?? null,
    pending_reasons: [...new Set([...saved.checks.filter(c=>c.status!=='pass').map(c=>c.id),
      ...(clipped?['capture_bounds']:[]),...(saved.visual_error?[saved.visual_error]:[]),...(last&&!last.review_valid?['visual_report_invalid']:[])])],
    last_visual: last ? { review_valid: last.review_valid, result: last.structured, image_evidence: last.evidence, image_ref: last.image_ref } : legacy ? { result: legacy.visual_report, image_evidence: legacy.image_evidence } : null,
    checks: saved.checks, unmet_conditions: saved.checks.filter(c => c.status !== 'pass'),
    verification: {
      geometry: saved.checks.filter(c => !['visual','series_cycle','netlist'].includes(saved.plan?.requirements?.find(r=>r.id===c.id)?.check??'')),
      topology: saved.checks.filter(c => ['series_cycle','netlist'].includes(saved.plan?.requirements?.find(r=>r.id===c.id)?.check??'')),
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
    if(c.ports.length===2)edges.push([key(c.ports[0]!), key(c.ports[1]!)]);
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
  const cycle = planar && supported && plan.components.every(c=>c.ports.length===2) && plan.components.length >= 2 && wires.length > 0 && componentEvidence && points.length > 0 && degrees.every(d => d === 2) && seen.size === points.length;
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
    if(r.check==='netlist'){
      const result=verifyNetlist(plan,entities);
      return {id:r.id,status:result.pass&&componentEvidence?'pass':'fail',evidence:result.evidence+`; component evidence=${componentEvidence}`,details:result.details};
    }
    if(r.check === 'entity_count') {
      const actual = entities.filter(e => (!r.entity_type || e.type === r.entity_type)&&(!r.layer||e.layer===r.layer)).length;
      pass = actual >= (r.min ?? 1) && actual <= (r.max ?? Number.MAX_SAFE_INTEGER);
      evidence = `actual=${actual}, expected=${r.min ?? 1}..${r.max ?? 'unbounded'}`;
    }
    if(r.check === 'text') {
      const found = labels.filter(e => r.text && labelText(e.text_string)===labelText(r.text)&&(!r.layer||e.layer===r.layer));
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
  runtime?.enableTaskBudget?.();
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
  const priorModelCalls=options.resume?.visual_model_call_count??qualityTaskContext({task_id:'',phase:'',original_request:'',round:0,checks:[],visual_calls:visualCalls,reviews}).visual_call_count;
  let visualError:string|null=null;
  let cachedReview: { key: string; review: VisualResult } | undefined;
  let candidateReview: { key: string; review: VisualResult } | undefined;
  const checkpoints: unknown[] = [];
  const drawingUnits:{id:string;status:'active'|'checked_in';snapshot_sha256?:string}[]=[];
  let activeUnit:string|null=null;
  let budgetPaused=false;
  let outputRecoveries=0;
  let reviewedWrites: string | undefined;
  let reviewFlight: Promise<VisualResult> | undefined;
  let guidance = '';
  const referenceTask=options.referenceTask??options.resume?.reference_task??undefined;
  const sourceStrokeRequested=/手绘风格|手写风格|手写字体|铅笔效果|(?:保留|保持|模仿|照搬).{0,8}(?:笔触|笔迹)|sketch[- ]style|hand[- ]drawn style|handwritten font|preserve.{0,16}strokes?/i.test(task);
  const renderingContract=()=>referenceObservation?.structured?.drawing_kind!=='schematic'?{output:'editable CAD',requirements:'Follow the original requested visual features; do not invent output-style requirements.'}:({output:'editable CAD',source_is_not_output_style:true,preserve_stroke_texture:sourceStrokeRequested,preserve_source_font:sourceStrokeRequested,
    requirements:'Preserve symbols, literal labels, connections and relative layout. Hand-drawn describes the input medium; do not require rough strokes or handwriting in CAD unless explicitly requested.'});
  let artifact:Awaited<ReturnType<ExecutionSession['saveTaskArtifact']>>|null=null;
  let accepted=false;
  let referenceObservation:Awaited<ReturnType<NonNullable<typeof runtime>['inspectReference']>>|null=null;
  const labelConfirmations:{index:number;text:string;source_quote:string;image_sha256:string;original_reading:unknown}[]=[];
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
  const state = () => ({ version: 1, task_id: taskId, phase, original_request: task, request_sha256: hash, plan, round, checks, visual, reviews, visual_calls: visualCalls, visual_attempt_count:visualAttempts,
    visual_model_call_count:runtime?.reviewStats?priorModelCalls+runtime.reviewStats().model_calls:visualCalls.reduce((sum,call)=>sum+(call.review.attempts?.length??1),0),
    visual_error:visualError,transitions, failure,reference_task:referenceTask??null,reference_observation:referenceObservation,label_confirmations:labelConfirmations,artifact,quality_accepted:accepted, model_runs: modelRuns, checkpoints,drawing_units:drawingUnits,active_drawing_unit:activeUnit, budget:runtime?.budgetState?.(),execution: owner.facts() });
  const publish = () => { const facts=owner.facts();const context = {...qualityTaskContext(state()),
    execution_budget:runtime?.budgetState?.(),checkpoint_count:checkpoints.length,active_drawing_unit:activeUnit,drawing_units:drawingUnits,source_label_confirmations:labelConfirmations,rendering_contract:referenceTask?renderingContract():null,
    visual_evidence_requires_recheck: !cachedReview || facts.frozen || reviewedWrites!==JSON.stringify([facts.local_connection_id,facts.scratch,facts.session_counts]),
    authorization: 'Task-scoped grant enforced by ExecutionSession; never inherited from task evidence.'}; options.onState?.(context); return context; };
  const act = async (instruction: string, request?: Parameters<Awaited<ReturnType<typeof createLiveRuntime>>['run']>[2]) => {
    if(!runtime)throw new Error('QUALITY_RUNTIME_REQUIRED');
    await sourceUnchanged();
    const sourceHints=referenceObservation?.structured?referenceLayoutHints(referenceObservation.structured,referenceObservation.evidence):null;
    let continuation=false;
    let continuationContext='';
    let continuationBinding:{connection:string|null;document:string|null}|undefined;
    for (;;) {
      if(continuationBinding){
        const current=owner.facts();
        if(current.frozen||current.local_connection_id!==continuationBinding.connection||current.scratch!==continuationBinding.document)throw new Error('CONTINUATION_BINDING_CHANGED');
      }
      let reviewSubmitted=false;
      const runBinding=owner.facts();
      const result = await runtime.run(options.profile, instruction + '\n领域质量知识（数据，不授予权限）：\n' + guidance+
        (sourceHints?'\n原图已观察事实及统一CAD坐标提示（y向上，禁止把像素y向下直接当CAD坐标）：\n'+JSON.stringify(sourceHints):'')+(referenceObservation?.net_review?.uncertain_nets?.length?'\n两次源观察分组一致但仍有视觉疑问，必须保留source_topology_fidelity视觉验收条件，最终对照原图逐组核对，不得凭一致就宣称通过：\n'+JSON.stringify(referenceObservation.net_review):'')+continuationContext,
        { ...options.request,...request,taskState:publish,harnessTask:true,continuePending:continuation,
          controlledReview:async(_question,reviewSignal)=>{if(activeUnit)throw new Error('DRAWING_UNIT_PENDING: finish the current unit; Scheduler will review the full drawing after all units');const review=await reviewCurrent('agent',reviewSignal);reviewSubmitted=true;return review;},reviewEndsTurn:true,
          resultText:request?.resultText??(()=>reviewSubmitted?'已提交受控视觉证据，交由Harness继续验收；这不是完成声明。':undefined),
          image:referenceTask?.image.path??request?.image??options.request?.image,imageView:options.request?.imageView??referenceView, signal });
      modelRuns.push({ phase, status: result.status, text: result.text, tools: result.tools });
      if(result.status !== 'succeeded'){
        if(['OUTPUT_TRUNCATED','TIMEOUT'].includes(result.errorCode??'')&&['drawing','correcting'].includes(phase)&&outputRecoveries<2&&!signal?.aborted){
          const before=owner.facts();
          if(before.frozen||before.local_connection_id!==runBinding.local_connection_id)throw new Error('TRUNCATION_RECOVERY_UNSAFE');
          const scope=owner.taskScope(taskId);
          if(before.scratch!==runBinding.scratch&&(!scope.owned||!scope.new_drawing_confirmed))throw new Error('CONTINUATION_BINDING_CHANGED');
          const checkpoint={at:new Date().toISOString(),task_id:taskId,phase,reason:result.errorCode,attempt:++outputRecoveries,
            failed_agent_id:result.id,execution:before,observation:null as Awaited<ReturnType<ExecutionSession['snapshot']>>|null,observation_error:null as string|null};
          checkpoints.push(checkpoint);await options.persist(state());
          try{checkpoint.observation=before.scratch?await owner.snapshot():null;}
          catch(error){checkpoint.observation_error='CHECKPOINT_READBACK_FAILED';failure={stage:phase,code:'CHECKPOINT_READBACK_FAILED',source:'verification'};await options.persist(state());throw error;}
          await sourceUnchanged();const after=owner.facts();
          if(after.frozen||before.local_connection_id!==after.local_connection_id||before.scratch!==after.scratch||JSON.stringify(before.session_counts)!==JSON.stringify(after.session_counts)||(checkpoint.observation&&checkpoint.observation.document!==after.scratch))throw new Error('CONTINUATION_BINDING_CHANGED');
          continuationBinding={connection:after.local_connection_id,document:after.scratch};
          await options.persist(state());options.emit({type:'task.output_retry',reason:result.errorCode,attempt:outputRecoveries,document:after.scratch});
          // Start a fresh response, never stitch/replay incomplete arguments. No
          // continuePending here: only the budget handoff can own pending calls.
          continuation=false;
          continuationContext='\nScheduler截断恢复：上次响应不完整，禁止拼接其JSON、重放整批或猜测成功。下面真实账本/读回是唯一执行依据；新图已确认则严禁再次new_drawing。一次只生成一个组件或最多8项小Patch，立即实际调用工具，不先推演整张图。按尚缺部分继续；完成后提交受控视觉检查。\n'+JSON.stringify({scope,execution:after,observation:checkpoint.observation});
          continue;
        }
        const missingPlan=phase==='planning'&&!result.errorCode;
        failure={stage:phase,code:result.errorCode??(missingPlan?'ACCEPTANCE_PLAN_MISSING':'AGENT_FAILED'),source:missingPlan?'verification':'model'};
        throw new Error(`QUALITY_MODEL_${result.status.toUpperCase()}`);
      }
      if(result.handoff?.kind==='budget'){
        // AgentLoop is idle here: no native writes can race this checkpoint.
        const before=owner.facts();
        if(before.frozen)throw new Error('CAD_WRITE_FROZEN');
        if(!result.handoff.renewable){budgetPaused=true;failure={stage:phase,code:result.handoff.code,source:'verification'};}
        const checkpoint={at:new Date().toISOString(),task_id:taskId,phase,correction_round:round,
          plan_sha256:createHash('sha256').update(JSON.stringify(plan??null)).digest('hex'),
          connection:before.local_connection_id,document:before.scratch,execution:before,
          observation:null as Awaited<ReturnType<ExecutionSession['snapshot']>>|null,
          observation_error:null as string|null,budget:runtime.budgetState(),reason:result.handoff.code};
        checkpoints.push(checkpoint);
        await options.persist(state());
        let observation:typeof checkpoint.observation=null;
        try{observation=before.scratch?await owner.snapshot():null;checkpoint.observation=observation;}
        catch(error){checkpoint.observation_error='CHECKPOINT_READBACK_FAILED';await options.persist(state());throw error;}
        await sourceUnchanged();
        const after=owner.facts();
        if(after.frozen||before.local_connection_id!==after.local_connection_id||before.scratch!==after.scratch||
          (observation&&observation.document!==after.scratch))throw new Error('CONTINUATION_BINDING_CHANGED');
        continuationBinding={connection:after.local_connection_id,document:after.scratch};
        await options.persist(state());
        options.emit({type:'task.checkpoint',reason:result.handoff.code,execution_round:checkpoint.budget.execution_round,
          document:after.scratch,continuing:Boolean(result.handoff.renewable)});
        if(!result.handoff.renewable)throw new Error(result.handoff.code);
        signal?.throwIfAborted();
        continuation=true;
        continuationContext='\n执行回合已续期，仍为同一任务、连接、图纸及授权。Scheduler会先派发上回合预算拒绝且从未派发的请求；Available.continuation_results是其真实结果。禁止重复已确认操作，禁止重建图纸。只继续尚未完成部分，然后调用受控视觉入口，交回独立验收。当前全图读回：\n'+JSON.stringify(observation);
        continue;
      }
      if(outputRecoveries&&result.status==='succeeded')for(const checkpoint of checkpoints as {failed_agent_id?:string}[]){
        const old=runtime.completed?.().find(r=>r.id===checkpoint.failed_agent_id);if(old&&!old.recovered_by)old.recovered_by=result.id;
      }
      return result;
    }
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
      // A post-review read may have failed. This fresh matching full readback
      // certifies that same candidate instead of capturing/paying for it again.
      if(candidateReview?.key===key&&candidateReview.review.review_valid){
        cachedReview=candidateReview;candidateReview=undefined;visualError=null;
        reviewedWrites=JSON.stringify([facts.local_connection_id,facts.scratch,facts.session_counts]);
      }
      if (cachedReview?.key === key) {
        options.emit({type:'task.visual',source,reused:true,review_valid:cachedReview.review.review_valid,verdict:cachedReview.review.structured?.verdict??null});
        return cachedReview.review;
      }
      const geometry = verifyQuality(plan, before.entities, {new_document:owner.taskScope?.(taskId).new_drawing_confirmed,saved_dwg:Boolean(artifact)});
      checks=geometry;publish();
      visualAttempts++;visualError=null;publish();
      const observedSource=referenceObservation?.structured,sourceImage=referenceObservation?.evidence;
      const sourceDetails=referenceTask&&observedSource&&sourceImage?referenceObservation?.net_review?.uncertain_nets?.slice(0,3).flatMap(net=>{
        const points=net.pins.flatMap(pin=>{const p=observedSource.objects.find(o=>o.id===pin.object)?.terminals[pin.terminal];return p?[p]:[];});if(!points.length)return [];
        const left=Math.max(0,Math.floor((Math.min(...points.map(p=>p[0]))-0.12)*sourceImage.width)),top=Math.max(0,Math.floor((Math.min(...points.map(p=>p[1]))-0.12)*sourceImage.height));
        const right=Math.min(sourceImage.width,Math.ceil((Math.max(...points.map(p=>p[0]))+0.12)*sourceImage.width)),bottom=Math.min(sourceImage.height,Math.ceil((Math.max(...points.map(p=>p[1]))+0.12)*sourceImage.height));
        return [{path:referenceTask.image.path,view:{crop:{left,top,width:right-left,height:bottom-top}},label:`ORIGINAL Image A detail for independent connection verification; NOT a CAD result. The following pins locate a region, not an assertion that they share a net: ${JSON.stringify(net.pins)}. Follow actual wire strokes; slight pen irregularity is not proof of disconnection.`}];
      }):undefined;
      const review = await runtime.reviewCadView(JSON.stringify({ original_request: task,
        requirements: plan.requirements.filter(r => r.check === 'visual'), geometry, domain_guidance: guidance,
        source_connection_review:{independent_check_required:Boolean(referenceTask),regions_to_inspect:referenceObservation?.net_review?.uncertain_nets?.map(n=>({pins:n.pins}))??[],
          note:'Preliminary model opinions are not authoritative and are deliberately withheld. Independently compare actual original pixels and CAD. The supplied region pins are locations, not a claim of connectivity.'},rendering_contract:referenceTask?renderingContract():null,
        entity_snapshot: before.entities, observed_state_hash: digest, document_revision: null,
        note: 'Image evidence checks appearance. Queried coordinates/IDs are authoritative; ambiguous pixels remain uncertain.',reference:referenceTask?.image??null }),reviewSignal,referenceTask?.image.path,sourceDetails);
      visual = review;
      visualCalls.push({source,observed_state_hash:digest,review});
      candidateReview={key,review};
      const after = await owner.snapshot();
      reviewSignal?.throwIfAborted();
      await sourceUnchanged();
      const afterFacts=owner.facts();
      const stable = !afterFacts.frozen && before.document===after.document && facts.local_connection_id===afterFacts.local_connection_id && facts.scratch===afterFacts.scratch &&
        digest===createHash('sha256').update(JSON.stringify(after.entities)).digest('hex') && JSON.stringify(facts.session_counts)===JSON.stringify(afterFacts.session_counts);
      // Invalid or stale results are retained as evidence, never reusable acceptance.
      if(stable && review.review_valid) {cachedReview={key,review};reviewedWrites=JSON.stringify([afterFacts.local_connection_id,afterFacts.scratch,afterFacts.session_counts]);}
      else cachedReview=undefined;
      candidateReview=undefined;
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
    name: 'cader_submit_acceptance_plan', description: 'Submit compact independent requirements. Components have 1..8 boundary ports with matching pin_names. Branched/multi-pin circuits use netlist and explicit junctions; series_cycle is only for a simple two-terminal series loop. Reference circuits preserve source_id and source_terminals in port order. Never submit operation sequences.', parameters: acceptancePlanSchema,
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] }, async execute(args, exec) {
      const parsed = parseAcceptancePlan(args);
      if(parsed.requirements.some(r => !task.toLowerCase().includes(r.source_quote.toLowerCase())))
        throw new Error('SOURCE_QUOTE_MUST_BE_FROM_ORIGINAL_REQUEST');
      if(!referenceTask&&parsed.requirements.some(r=>r.check==='saved_dwg')&&!/保存|另存|导出|\bsave\b|\bexport\b|\.dwg\b/i.test(task))throw new Error('UNREQUESTED_FILE_ACCEPTANCE: no DWG save was requested; remove saved_dwg rather than inventing a delivery condition');
      if(!referenceTask&&parsed.domain==='electrical-schematic'&&parsed.requirements.some(r=>r.check==='entity_count'&&r.entity_type==='AcDbLine'&&r.max!==undefined)&&!/线段|直线|最多.*线|\blines?\b/i.test(task))throw new Error('UNREQUESTED_PRIMITIVE_LIMIT: the user specified components, not a maximum number of AcDbLine entities; use symbol/topology checks, without an invented line-count ceiling');
      if(!referenceTask&&parsed.requirements.some(r=>r.check==='entity_count'&&r.max!==undefined)&&!/直线|线段|多段线|圆|圆弧|矩形|文字|文本|\b(?:lines?|circles?|arcs?|polylines?|rectangles?|texts?)\b/i.test(task))throw new Error('UNREQUESTED_PRIMITIVE_LIMIT: no primitive counts were specified; use visual component/layout conditions without invented entity-count ceilings');
      if(/电路|circuit/i.test(task) && parsed.domain !== 'electrical-schematic')
        throw new Error('SCHEMATIC_TOPOLOGY_REQUIRED');
      if(/并联|\bparallel\b/i.test(task) && parsed.domain === 'electrical-schematic'&&!parsed.requirements.some(r=>r.check==='netlist')) throw new Error('BRANCHED_TOPOLOGY_REQUIRES_NETLIST');
      if(/图|diagram|文字|text|电路|circuit/i.test(task))
        parsed.visual_required = true;
      if(options.alwaysVisual||requiresQuality(task)||parsed.requirements.some(r=>r.check==='visual')) parsed.visual_required = true;
      if(parsed.visual_required&&!parsed.requirements.some(r=>r.check==='visual'))throw new Error('VISUAL_ACCEPTANCE_REQUIRED: include an independently reviewable visual condition quoted from the original request');
      if(referenceTask){
        if(referenceObservation?.structured?.drawing_kind==='schematic'&&!sourceStrokeRequested&&parsed.requirements.some(r=>/手绘风格|手写(?:风格|字体)|手绘笔触|铅笔(?:效果|纹理)|(?:原稿|原图).*笔触|sketch[- ]style|hand[- ]drawn style|handwritten font|pencil texture/i.test(r.description)))throw new Error('UNREQUESTED_SOURCE_STYLE: hand-drawn is the INPUT medium, not a request for rough CAD strokes or handwriting. Preserve component symbols, labels, topology and layout; remove invented stroke/font style gates unless the user explicitly requested them');
        parsed.visual_required=true;
        if(!parsed.requirements.some(r=>r.check==='visual'))throw new Error('REFERENCE_APPEARANCE_CHECK_REQUIRED');
        if(referenceObservation?.net_review?.uncertain_nets?.length&&!parsed.requirements.some(r=>r.id==='source_topology_fidelity'&&r.check==='visual'))throw new Error('SOURCE_TOPOLOGY_VISUAL_RESOLUTION_REQUIRED: add visual condition id=source_topology_fidelity to independently verify ALL pending source nets against original pixels; agreement between preliminary observations is not final acceptance');
        const labels=referenceObservation?.structured?.visible_text.filter(t=>t.certainty==='clear'&&/[\p{L}\p{N}]/u.test(t.text))??[];
        const missing=labels.filter(t=>!parsed.requirements.some(r=>r.check==='text'&&r.text&&labelText(r.text)===labelText(t.text)));
        if(missing.length)throw new Error('SOURCE_LABEL_ACCEPTANCE_REQUIRED: preserve exact verified source labels and SI case in text checks: '+JSON.stringify(missing.map(t=>t.text)));
        const counts=new Map<string,number>();for(const label of labels)counts.set(labelText(label.text),(counts.get(labelText(label.text))??0)+1);
        const missingCounts=[...counts].filter(([text,count])=>!parsed.requirements.some(r=>r.check==='text'&&!r.component&&r.text&&labelText(r.text)===text&&(r.min??1)>=count));
        if(missingCounts.length)throw new Error('SOURCE_LABEL_MULTIPLICITY_REQUIRED: add global literal text checks with min counts for ALL verified occurrences: '+JSON.stringify(missingCounts));
        if(referenceObservation?.structured?.drawing_kind==='schematic'){
          const source=referenceObservation.structured;
          if(parsed.domain!=='electrical-schematic'||!parsed.requirements.some(r=>r.check==='netlist')||!source.nets?.length)throw new Error('SOURCE_NETLIST_REQUIRED: preserve branched circuit, never substitute series_cycle');
          const mapped=parsed.components.filter(c=>c.source_id);
          if(new Set(mapped.map(c=>c.source_id)).size!==mapped.length||source.objects.filter(o=>o.terminals.length).some(o=>!mapped.some(c=>c.source_id===o.id&&c.ports.length===o.terminals.length&&c.source_terminals?.length===o.terminals.length&&c.source_terminals.every(t=>t<o.terminals.length)))||parsed.components.some(c=>!source.objects.some(o=>o.id===c.source_id&&o.terminals.length)))throw new Error('SOURCE_TERMINALS_MUST_BE_PRESERVED: map each source object and ALL terminal indices to named ports, no invented devices');
          const canonical=(nets:string[][])=>nets.map(pins=>pins.sort().join('|')).sort().join(';');
          const expected=source.nets.map(n=>n.pins.map(p=>`${p.object}:${p.terminal}`));
          const actual=parsed.nets!.map(n=>n.pins.map(p=>{const c=mapped.find(c=>c.id===p.component)!;return `${c.source_id}:${c.source_terminals![c.pin_names!.indexOf(p.pin)]}`;}));
          if(canonical(expected)!==canonical(actual))throw new Error('SOURCE_NETLIST_MISMATCH: planned external nets must preserve observed source terminal partition');
        }
      }
      plan = parsed;
      exec.concludeTurn();
      return JSON.stringify(plan);
    }
  };
  const confirmLabels:ToolDefinition={name:'cader_confirm_source_labels',description:'Bind an explicit USER-provided label clarification to source-image indices. Preserve the original uncertain reading. source_quote must quote a confirmation from the actual user request and contain the confirmed literal value; never invent a confirmation or resolve uncertainty by inference.',parameters:{type:'object',properties:{labels:{type:'array',minItems:1,maxItems:32,items:{type:'object',properties:{index:{type:'integer',minimum:0},text:{type:'string',minLength:1,maxLength:80},source_quote:{type:'string',minLength:1,maxLength:800}},required:['index','text','source_quote'],additionalProperties:false}}},required:['labels'],additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args){
    await sourceUnchanged();const labels=(args as {labels:{index:number;text:string;source_quote:string}[]}).labels;
    if(!referenceTask||!referenceObservation?.structured||new Set(labels.map(l=>l.index)).size!==labels.length)throw new Error('SOURCE_CONFIRMATION_INVALID');
    for(const label of labels){
      const observed=referenceObservation.structured.visible_text[label.index];
      if(!observed||labelConfirmations.some(c=>c.index===label.index)||!task.includes(label.source_quote)||/\.(?:png|jpe?g|dwg)\b/i.test(label.source_quote)||!/确认|clarification|confirm/i.test(label.source_quote)||!labelText(label.source_quote).includes(labelText(label.text)))throw new Error('EXPLICIT_USER_CONFIRMATION_REQUIRED: source indices not previously confirmed, exact user quote and confirmed literal value');
    }
    for(const label of labels){const observed=referenceObservation.structured.visible_text[label.index]!;labelConfirmations.push({...label,image_sha256:referenceTask.image.sha256,original_reading:structuredClone(observed)});observed.text=label.text;observed.certainty='clear';}
    await options.persist(state());options.emit({type:'reference.labels_confirmed',count:labels.length,image_sha256:referenceTask.image.sha256,source:'explicit_user_quote'});return JSON.stringify({confirmed:labels,source:'user_confirmation',not_ocr_success:true});
  }};
  try {
    if(owner.facts().frozen){await enter('blocked');return state();}
    if(!runtime)throw new Error('QUALITY_RUNTIME_REQUIRED');
    await sourceUnchanged();
    if(referenceTask){
      await enter('reference');
      referenceObservation=await runtime.inspectReference(referenceTask.image.path,task,signal);
      if(!referenceObservation.valid||referenceObservation.evidence.sha256!==referenceTask.image.sha256||!referenceObservation.structured?.objects.length){
        failure={stage:'reference',code:referenceObservation.net_review&&!referenceObservation.net_review.valid?(referenceObservation.net_review.report_valid===false?'SOURCE_NET_REPORT_INVALID':'SOURCE_TOPOLOGY_UNCERTAIN'):referenceObservation.label_inventory&&!referenceObservation.label_inventory.valid?'SOURCE_LABEL_INVENTORY_FAILED':'REFERENCE_INSPECTION_FAILED',source:'verification'};await enter('blocked');return state();
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
      const canConfirm=Boolean(referenceTask&&referenceObservation?.structured?.visible_text.length&&/确认|clarification|confirm/i.test(task));
      const planningRequest={ signal, onlyTools: [tool.name,'cader_view_image',...(canConfirm?[confirmLabels.name]:[])], extraTools: [tool,...(canConfirm?[confirmLabels]:[])], resultText: () => plan ? JSON.stringify(plan) : undefined };
      try {
      await act('用中文规划以下绘图任务。'+(referenceObservation?.structured?.drawing_kind==='schematic'?'参考手绘电路是输入资料，目标是可编辑CAD；没有明确要求手绘/手写输出风格时，不增加笔触、手写字体或纸张纹理验收，只核对图形、标签、连接和相对布局。':'')+'若用户明确补充确认了仍不确定的标注，先调用cader_confirm_source_labels按位置绑定原文确认；不能从原图或常见值编造用户确认。必须调用cader_submit_acceptance_plan，只提交紧凑需求验收清单；普通插画的components可为空，勿虚构连接端口。仅拓扑任务需要组件布局/端口；参考电路必须用netlist，components带source_id、source_terminals（按ports顺序的原图端子索引）、pin_names及全部端口；nets必须保持观察的原图端子分组，不能把分支/三端器件改成series_cycle。组件bounds可包含引线，端口在边界；此阶段不能绘图。若有参考图片，必须先观察实际像素；可用cader_view_image裁看原图。识别可读符号、文字与连接，示意图使用布局坐标，不因缺少物理比例尺全局拒绝；不可读的值单独标未知。source_quote必须原样引用用户请求，图片中数值可在description/text写出并用“参考图”等请求原文作source_quote。独立列出数量、文字、布局及源图外观匹配条件。新建文档与保存由程序验证，不能用任意实体数代替。entity_count必须是可测的实际AcDb类型；COM draw_polyline/rectangle生成AcDb2dPolyline，不是AcDbPolyline。组件语义使用visual检查。参考图的符号数量不能随意变成全部圆/线实体的硬上限（还可能有接点小圆和符号内部线）；需要实体计数时可用layer限定其语义图层，或以visual验符号。电路使用真实组件边界端口和适合的拓扑检查，不强加电路条件到普通图。标注以text检查，禁止导线穿组件或短接其端口。不得把本阶段的“只做规划”误写为整任务不准绘图。\n' + task,
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
    if(!options.resume&&referenceTask&&plan.domain==='electrical-schematic'){
      // These units come from the model's accepted semantic plan, not a fixed
      // geometry/script. Every symbol and wire route is still generated by DSH.
      const labels=referenceObservation?.structured?referenceLayoutHints(referenceObservation.structured,referenceObservation.evidence).visible_text.filter(t=>t.certainty==='clear'):[];
      const units=[{id:'setup',kind:'setup',data:{wire_layer:plan.wire_layer}},
        ...plan.components.map(c=>({id:`component:${c.id}`,kind:'component',data:c})),
        ...(plan.nets??[]).map(n=>({id:`net:${n.id}`,kind:'net',data:{...n,pins:n.pins.map(p=>{const c=plan!.components.find(c=>c.id===p.component)!;return {...p,position:c.ports[c.pin_names!.indexOf(p.pin)]};}),junctions:plan!.junctions}})),
        ...Array.from({length:Math.ceil(labels.length/4)},(_,i)=>({id:`labels:${i}`,kind:'labels',data:labels.slice(i*4,i*4+4)}))];
      for(const unit of units){
        signal?.throwIfAborted();if(owner.facts().frozen)throw new Error('CAD_WRITE_FROZEN');
        activeUnit=unit.id;const progress:{id:string;status:'active'|'checked_in';snapshot_sha256?:string}={id:unit.id,status:'active'};drawingUnits.push(progress);
        await options.persist(state());let checkedIn=false;
        const checkIn=async()=>{
          const before=owner.facts(),scope=owner.taskScope(taskId);
          if(before.frozen||!scope.owned||!scope.new_drawing_confirmed)throw new Error('DRAWING_UNIT_UNBOUND');
          let snapshot:Awaited<ReturnType<ExecutionSession['snapshot']>>;try{snapshot=await owner.snapshot();}catch(error){failure={stage:'drawing',code:'CHECKPOINT_READBACK_FAILED',source:'verification'};throw error;}const after=owner.facts();
          if(after.frozen||before.local_connection_id!==after.local_connection_id||before.scratch!==after.scratch||snapshot.document!==after.scratch){failure={stage:'drawing',code:'CONTINUATION_BINDING_CHANGED',source:'verification'};throw new Error('CONTINUATION_BINDING_CHANGED');}
          if(unit.kind==='component'){
            const component=plan!.components.find(c=>`component:${c.id}`===unit.id)!,missing=missingSymbolPorts(component,snapshot.entities,plan!.wire_layer);
            if(missing.length)throw Object.assign(new Error(JSON.stringify({code:'DRAWING_UNIT_INCOMPLETE',component:component.id,missing_ports:missing,guidance:'Actual non-WIRE symbol endpoints must reach each port. A polyline bounding box is insufficient; use explicit symbol lead lines, not duplicate whole symbols.',no_replay:true})),{code:'DRAWING_UNIT_INCOMPLETE'});
          }
          progress.status='checked_in';progress.snapshot_sha256=createHash('sha256').update(JSON.stringify(snapshot.entities)).digest('hex');
          try{await options.persist(state());}catch(error){progress.status='active';failure={stage:'drawing',code:'CHECKPOINT_PERSIST_FAILED',source:'verification'};throw error;}
          checkedIn=true;options.emit({type:'task.drawing_unit',unit_id:unit.id,status:'checked_in',document:after.scratch});
        };
        const finish:ToolDefinition={name:'cader_finish_drawing_unit',description:'Check in ONLY the current drawing unit after its actual tools have completed. This is a progress checkpoint, never final acceptance.',parameters:{type:'object',properties:{unit_id:{type:'string',const:unit.id}},required:['unit_id'],additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args,exec){
          if((args as {unit_id:string}).unit_id!==unit.id)throw new Error('DRAWING_UNIT_MISMATCH');
          await checkIn();exec.concludeTurn();return JSON.stringify({unit_id:unit.id,checked_in:true,task_complete:false});
        }};
        const instruction='使用中文，立即执行当前一个调度单元，不推演整张图。setup仅新建一次工作图及所需图层（WIRE、SYMBOL、TEXT等）；配色匹配原图/用户要求，文字应与截图背景有足够对比，未请求彩色时优先ACI7，不用浅黄浅绿文字。component仅画指定符号和内部引线，严格在bounds内并接到全部ports，三端器件保留全部引脚。每个端口必须有实际SYMBOL层直线引线端点或圆周接触证据；多段线只画内部折线，端口引线另外画成直线，不能只凭bbox宣称到达端口；net仅画该组外部导线，核对已有线避免重叠，绕开所有组件内部，单pin网无需导线，同坐标相接且引线已证实的两端口直接接触，不要绘制零长度线。junctions只用于有明确内部交叉的实际接点；已有T接点通过端点证明，不重复画多余小圆；labels仅按原图位置绘制这批已确认文字（重复值按每个原图位置分别画）。不得操作其他单元，不保存，不提前视觉检查。每个Patch最多8项，可多次小Patch。优先在最后一个Patch设置unit_complete=true，由程序读回登记并结束当前回合，省去额外模型请求；无需再单独调用finish。没有Patch或分次单工具绘制时，完成后调用cader_finish_drawing_unit交回调度器；下一单元由程序提供，不宣称整图完成。所有坐标XYZ。\n'+JSON.stringify({task,unit,wire_layer:plan.wire_layer,component_bounds:plan.components.map(c=>({id:c.id,bounds:c.bounds,ports:c.ports})),scope:owner.taskScope(taskId)});
        const shared=['query_entities','get_entity','list_layers','create_layer'];
        const scoped=unit.kind==='setup'?['new_drawing','list_layers','create_layer','set_layer_properties','get_backend_status']:unit.kind==='component'?[...shared,'draw_line','draw_polyline','draw_circle','draw_arc','move_entity','delete_entity']:unit.kind==='net'?[...shared,'draw_line','draw_circle','delete_entity']:[...shared,'draw_text','draw_mtext','move_entity','delete_entity'];
        const onlyTools=owner.definitions(options.confirm).map(t=>t.name).filter(name=>scoped.includes(name.split('__').at(-1)!));
        const request={...options.request,onlyTools:[...onlyTools,'cader_apply_cad_patch',finish.name],keepExecutionRound:true,completeDrawingUnit:checkIn,extraTools:[finish],resultText:()=>checkedIn?'当前绘图单元已读回登记，等待后续单元与独立验收。':undefined};
        await act(instruction,request);
        if(failure)throw new Error('DRAWING_UNIT_READBACK_FAILED');
        if(!checkedIn)await act(instruction+'\n上一回合未登记检查点。先读回核对，仅补齐此单元未执行部分，不重放确认操作，然后调用cader_finish_drawing_unit。',request);
        if(!checkedIn){failure={stage:'drawing',code:'DRAWING_UNIT_NOT_CLOSED',source:'verification'};throw new Error('DRAWING_UNIT_NOT_CLOSED');}
      }
      activeUnit=null;await options.persist(state());
    }
    else if(!options.resume)
      await act((referenceTask?'根据当前实际附带的原图重绘。本任务必须先调用new_drawing新建空白图，不允许复用上一任务图。图层先创建再使用；不要只写分析或要求GUI上传。程序会将结果保存到约定DWG，模型阶段不要保存。':'按原始请求及已封存验收计划自主绘图，不要重建已存在的合适工作图。')+'立即实际调用工具，每批最多8个操作、逐组件推进，禁止先生成整图长计划。所有点必须XYZ，按验收计划绝对坐标与端口位置执行。WIRE只用于组件外部连接，不得跨过组件本体或短接同一组件端口。分支按具名端口netlist连接；无连接点的交叉不导通。所有文本应按原图可读标注绘制，不虚构尺寸。绘制后主动调用cader_review_cad_view检查实际结果；该入口由程序绑定本任务需求和实体证据，已有有效检查会复用。若未调用，调度器仍会补验；不要向用户宣称完成。\n' + JSON.stringify({ task, plan }), options.request);
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
        source_topology_resolution:referenceObservation?.net_review?.uncertain_nets?.length?{original_uncertainty:referenceObservation.net_review,visual_condition:review?.structured?.checklist.find(c=>c.requirement_id==='source_topology_fidelity')??null,source_hash:referenceTask?.image.sha256}:null,
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
      await act('使用中文。程序已附实际读回实体和定位到坐标/ID的拓扑缺陷，修改前核对目标实体，再调用cader_apply_cad_patch或CAD修改工具提交实际局部修改。优先修复程序明确指出的断点、分支、组件越界与文字，不重复增加已存在的线段；错误导线应替换，不能叠加捷径。组件必须容纳于封存bounds且符号引线到达封存ports，物理圆不能画成超出盒的椭圆近似。不要只描述计划，不输出长篇思考，不整图重建；删除仅限本任务实体，由执行层检查。以坐标核对视觉分歧，不能凭像素编辑。视觉建议不能改变封存的源图net分组；例如独立接地符号不能凭常见电路假设接入另一回线，应以原图与程序证据核对。验收计划不能更改。不要宣称完成，修正后主动调用cader_review_cad_view；程序仍会重新核验。\n' + JSON.stringify({ original_request: task, plan, checks, entity_snapshot:after.entities,visual: review?.structured }));
    }
    if(referenceTask&&!owner.facts().frozen&&(phase as QualityPhase)!=='blocked'){
      await saveReferenceArtifact();
      await enter(accepted?'complete':'pending_verification');
    }
  }
  catch(error) {
    if(!failure&&['CONTINUATION_BINDING_CHANGED','TRUNCATION_RECOVERY_UNSAFE','DRAWING_UNIT_NOT_CLOSED'].includes((error as Error).message))failure={stage:phase,code:(error as Error).message,source:'verification'};
    if((phase as QualityPhase)==='saving')failure={stage:phase,code:'DWG_SAVE_FAILED',source:'verification'};
    if(!failure)visual = { previous: visual, error: (error as Error).message };
    if(referenceTask&&(failure?.source==='model'||budgetPaused)&&!signal?.aborted&&!owner.facts().frozen&&owner.taskScope(taskId).new_drawing_confirmed&&owner.taskScope(taskId).geometry_confirmed){
      accepted=false;
      checks.push({id:'model_interrupted',status:'not_run',evidence:'执行因模型或任务总预算中断，当前图形尚未完成质量验收；仅保存待验稿'});
      try{await saveReferenceArtifact();}catch(saveError){visual={previous:visual,save_error:(saveError as Error).message};}
    }
    await enter(owner.facts().frozen||failure&&!budgetPaused ? 'blocked' : 'pending_verification');
  }
  finally {
    owner.endTask();
  }
  await options.persist(state());
  return state();
}
