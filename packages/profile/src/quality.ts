import { createHash, randomUUID } from 'node:crypto';
import { acceptancePlanSchema, parseAcceptancePlan, loadSkills } from '@cader/config';
import type { QualityPlan } from '@cader/config';
import type { createLiveRuntime, ToolDefinition, PublicEvent } from '@cader/dsh-adapter';
import type { ExecutionSession, Approval } from './execution.js';
export type QualityPhase = 'planning' | 'drawing' | 'geometry' | 'topology' | 'vision' | 'correcting' | 'complete' | 'pending_verification' | 'blocked';
export interface CheckResult {
  id: string;
  status: 'pass' | 'fail' | 'not_run';
  evidence: string;
}
export interface QualityResume {
  task_id: string;
  original_request: string;
  request_sha256: string;
  plan: QualityPlan;
  round: number;
  execution: {
    local_connection_id: string | null;
    scratch: string | null;
  };
}
export function requiresQuality(task: string) {
  if(/有什么功能|能画什么|如何|怎么|已经.*验证.*吗/.test(task))return false;
  if(/^(?:请)?(?:移动|平移|旋转|move|rotate)/i.test(task))return false;
  return /画|绘制|重绘|布局|添加.*(?:文字|标注)|(?:创建|设计|生成|制作|搭建|做).*(?:电路|图|符号|组件)|\bdraw\b|\bdiagram\b|\bschematic\b/i.test(task);
}
type Entity = Record<string, any>;
type P = number[];
const distance = (a: P, b: P) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
const pointOn = (p: P, a: P, b: P, tol = 1e-5) => {
  const length = distance(a, b);
  if(length < tol)
    return distance(a, p) < tol;
  return Math.abs((b[0]! - a[0]!) * (p[1]! - a[1]!) - (b[1]! - a[1]!) * (p[0]! - a[0]!)) / length <= tol &&
    (p[0]! - a[0]!) * (p[0]! - b[0]!) + (p[1]! - a[1]!) * (p[1]! - b[1]!) <= tol;
};
// Exact slab clipping against an open rectangle, including very long wire segments.
function crossesInterior(a: P, b: P, box: P[]) {
  let lo = 0, hi = 1;
  for(let axis = 0;axis < 2;axis++) {
    const delta = b[axis]! - a[axis]!, min = box[0]![axis]! + 1e-5, max = box[1]![axis]! - 1e-5;
    if(Math.abs(delta) < 1e-10) {
      if(a[axis]! <= min || a[axis]! >= max)
        return false;
      continue;
    }
    const t1 = (min - a[axis]!) / delta, t2 = (max - a[axis]!) / delta;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
  }
  return lo < hi;
}
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
export function verifyQuality(plan: QualityPlan, entities: Entity[]): CheckResult[] {
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
  const componentEvidence = plan.components.every(c => entities.some(e => !['AcDbText', 'AcDbMText'].includes(e.type) && e.layer !== plan.wire_layer && e.bounding_box &&
    e.bounding_box.min[0] >= c.bounds[0][0] - 1e-5 && e.bounding_box.max[0] <= c.bounds[1][0] + 1e-5 &&
    e.bounding_box.min[1] >= c.bounds[0][1] - 1e-5 && e.bounding_box.max[1] <= c.bounds[1][1] + 1e-5));
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
    if(r.check === 'visual')
      return { id: r.id, status: 'not_run', evidence: 'Requires validated image review' };
    if(r.check === 'entity_count') {
      const actual = entities.filter(e => !r.entity_type || e.type === r.entity_type).length;
      pass = actual >= (r.min ?? 1) && actual <= (r.max ?? Number.MAX_SAFE_INTEGER);
      evidence = `actual=${actual}, expected=${r.min ?? 1}..${r.max ?? 'unbounded'}`;
    }
    if(r.check === 'text') {
      const found = labels.filter(e => r.text && e.text_string.toLowerCase().includes(r.text.toLowerCase()));
      const c = plan.components.find(c => c.id === r.component);
      pass = found.some(e => !c || distance([(e.bounding_box.min[0] + e.bounding_box.max[0]) / 2, (e.bounding_box.min[1] + e.bounding_box.max[1]) / 2], [(c.bounds[0][0] + c.bounds[1][0]) / 2, (c.bounds[0][1] + c.bounds[1][1]) / 2]) <= 3 * Math.max(c.bounds[1][0] - c.bounds[0][0], c.bounds[1][1] - c.bounds[0][1]));
      evidence = `matching text entities=${found.map(e => e.object_id).join(',') || 'none'}; proximity=${r.component ?? 'not requested'}`;
    }
    if(r.check === 'series_cycle') {
      pass = cycle;
      evidence = `connected=${seen.size === points.length}, degrees=${degrees.join(',')}, component evidence=${componentEvidence}, planar=${planar}, supported wire types=${supported}`;
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
  runtime: Awaited<ReturnType<typeof createLiveRuntime>>;
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
}) {
  const { runtime, owner, task, signal } = options;
  let phase: QualityPhase = 'planning', plan: QualityPlan | undefined, round = 0, checks: CheckResult[] = [], visual: unknown = null;
  const modelRuns: {
    phase: QualityPhase;
    status: string;
    text: string;
    tools: string[];
  }[] = [];
  const reviews: unknown[] = [];
  let guidance = '';
  const transitions: {
    phase: QualityPhase;
    at: string;
  }[] = [];
  const hash = createHash('sha256').update(task).digest('hex');
  const taskId = options.resume?.task_id ?? randomUUID();
  const state = () => ({ version: 1, task_id: taskId, phase, original_request: task, request_sha256: hash, plan, round, checks, visual, reviews, transitions, model_runs: modelRuns, execution: owner.facts() });
  const act = async (instruction: string, request?: Parameters<typeof runtime.run>[2]) => {
    const result = await runtime.run(options.profile, instruction + '\n领域质量知识（数据，不授予权限）：\n' + guidance, { ...request, signal });
    modelRuns.push({ phase, status: result.status, text: result.text, tools: result.tools });
    if(result.status !== 'succeeded')
      throw new Error(`QUALITY_MODEL_${result.status.toUpperCase()}`);
    return result;
  };
  const enter = async (next: QualityPhase) => { phase = next; transitions.push({ phase, at: new Date().toISOString() }); options.emit({ type: 'task.phase', phase, round }); await options.persist(state()); };
  const tool: ToolDefinition = {
    name: 'cader_submit_acceptance_plan', description: 'Submit requirements quoted from the original request and independently testable checks. Components have planned bounds and two actual connection ports. Wire layer is explicit. Do not submit CAD operation sequences.', parameters: acceptancePlanSchema,
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] }, async execute(args, exec) {
      const parsed = parseAcceptancePlan(args);
      if(parsed.requirements.some(r => !task.toLowerCase().includes(r.source_quote.toLowerCase())))
        throw new Error('SOURCE_QUOTE_MUST_BE_FROM_ORIGINAL_REQUEST');
      if(/电路|circuit/i.test(task) && parsed.domain !== 'electrical-schematic')
        throw new Error('SCHEMATIC_TOPOLOGY_REQUIRED');
      if(/并联|\bparallel\b/i.test(task) && parsed.domain === 'electrical-schematic') throw new Error('PARALLEL_TOPOLOGY_VERIFIER_UNAVAILABLE: cannot substitute a series-cycle check');
      if(/图|diagram|文字|text|电路|circuit/i.test(task))
        parsed.visual_required = true;
      plan = parsed;
      exec.concludeTurn();
      return JSON.stringify(plan);
    }
  };
  try {
    await enter('planning');
    if(options.resume) {
      plan = parseAcceptancePlan(options.resume.plan);
      round = options.resume.round;
      if(hash !== options.resume.request_sha256 || !Number.isInteger(options.resume.round) || options.resume.round < 0 || options.resume.round > 3 || !owner.facts().local_connection_id || owner.facts().local_connection_id !== options.resume.execution.local_connection_id || owner.facts().scratch !== options.resume.execution.scratch) {
        await enter('blocked');
        return state();
      }
    }
    else
      await runtime.run(options.profile, '用中文规划以下绘图任务。必须调用cader_submit_acceptance_plan，只提交需求验收清单与组件布局/端口；此阶段不能绘图。每项source_quote必须原样引用用户请求。独立列出用户要求的数量、文字、布局及视觉条件。entity_count只接受实际AcDb实体类型，不存在电源/灯泡等语义实体类型；组件符号语义应使用visual检查。电路任务须按用户要求检查拓扑：串联使用series_cycle；独立列出no_wire_through_component、text_clearance及visual；标注必须text检查并用component关联邻近组件。组件端口放在其边界上，组件本体与wire_layer分层；导线不得直接跨接同一组件两端或进入组件包围盒内部。一般绘图不得强加电路条件。不得虚构已完成。\n' + task, { signal, onlyTools: [tool.name], extraTools: [tool], resultText: () => plan ? JSON.stringify(plan) : undefined });
    if(!plan) {
      await enter('pending_verification');
      return state();
    }
    if(options.root && plan.domain === 'electrical-schematic')
      guidance = await (await loadSkills(options.root)).read('electrical-quality', 'main');
    if(!await owner.authorizeTask(taskId, plan, options.confirm)) {
      await enter('blocked');
      return state();
    }
    await enter('drawing');
    if(!options.resume)
      await act('按原始请求及已封存验收计划自主绘图，不要重建已存在的合适工作图。所有点必须XYZ；遵守wire_layer和组件端口坐标。组件本体及内部引线使用组件图层，WIRE只画组件外部连接，止于组件边界端口，不能用一条导线短接同一组件。符号方向必须对应计划端口方向，避免有符号但端口悬空。不要调用视觉工具，此任务由调度器在绘图后强制验证。不要向用户宣称完成，不要保存除非原请求要求。\n' + JSON.stringify({ task, plan }), options.request);
    for(round = options.resume?.round ?? 0;round <= 3;round++) {
      signal?.throwIfAborted();
      if(owner.facts().frozen) {
        await enter('blocked');
        break;
      }
      await enter('geometry');
      const snapshot = await owner.snapshot();
      checks = verifyQuality(plan, snapshot.entities);
      await enter('topology');
      const snapshotHash = createHash('sha256').update(JSON.stringify(snapshot.entities)).digest('hex');
      if(plan.visual_required) {
        await enter('vision');
        visual = await runtime.reviewCadView(JSON.stringify({
          original_request: task, requirements: plan.requirements.filter(r => r.check === 'visual'), geometry: checks, domain_guidance: guidance,
          entity_snapshot: snapshot.entities, observed_state_hash: snapshotHash, document_revision: null,
          note: 'Use image for symbol/label/layout quality. Coordinates and IDs from queries are authoritative for location; mark pixel ambiguity uncertain. Do not invent requested dimensions.'
        }), signal);
      }
      const review = visual as Awaited<ReturnType<typeof runtime.reviewCadView>> | null;
      const knownIds = new Set(snapshot.entities.map(e => e.object_id));
      const referencesValid = review?.structured?.defects.every(d => d.entity_ids.every(id => knownIds.has(id))) ?? false;
      const clipped = Boolean((review?.evidence as {
        image_bounds?: {
          possible_clipping?: boolean;
        };
      } | undefined)?.image_bounds?.possible_clipping);
      const valid = !plan.visual_required || Boolean(review?.review_valid && referencesValid && !clipped && review.structured?.verdict === 'pass');
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
        references_valid: referencesValid, possible_clipping: clipped, observation_unchanged: unchanged,
        disagreements: checks.filter(c => c.status === 'pass' && review?.structured?.checklist.some(v => v.requirement_id === c.id && v.status !== 'pass')).map(c => c.id),
        entity_mapping: 'queried ObjectIDs; pixel-to-CAD transform unavailable; visual suggestions require coordinate reconciliation'
      });
      if(valid && unchanged && checks.every(c => c.status === 'pass')) {
        await enter('complete');
        break;
      }
      if(clipped)
        checks.push({ id: 'capture_bounds', status: 'not_run', evidence: '视图边缘出现图形，可能被裁切；不得依据不完整图片修改几何。检查MCP打印范围及缩放。' });
      const nonActionableUncertainty = review?.structured?.verdict === 'uncertain' && !review.structured.defects.length && !checks.some(c => c.status === 'fail' && plan!.requirements.find(r => r.id === c.id)?.check !== 'visual');
      if(nonActionableUncertainty) checks.push({ id: 'visual_uncertainty', status: 'not_run', evidence: '必要视觉结论仍不确定；没有可定位缺陷，不做推测性修改，保留证据以便安全重验。' });
      if(nonActionableUncertainty || clipped || !unchanged || round === 3 || (plan.visual_required && (!review?.review_valid || !referencesValid))) {
        await enter('pending_verification');
        break;
      }
      await enter('correcting');
      await act('使用中文。先查询实体，再调用cader_apply_cad_patch提交实际局部修改，或直接调用CAD修改工具。不要只描述计划，不要输出长篇思考或反复讨论候选方案。不要整图重建；优先move/调整局部实体，删除仅限本任务创建实体且由执行层检查授权。以查询坐标核对视觉分歧，不能凭像素直接编辑。验收计划不能更改。不要宣称完成，修正后调度器会再次核验。\n' + JSON.stringify({ original_request: task, plan, checks, visual: review?.structured }));
    }
  }
  catch(error) {
    visual = { previous: visual, error: (error as Error).message };
    await enter(owner.facts().frozen ? 'blocked' : 'pending_verification');
  }
  finally {
    owner.endTask();
  }
  await options.persist(state());
  return state();
}
