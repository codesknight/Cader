import { createHash } from 'node:crypto';
import {sourceItemView,sourceLiteralKey}from'@cader/dsh-adapter';
import type { ReferenceIndex, SourceItem,reviewIndexedSource } from '@cader/dsh-adapter';
import type { CadOperationRecord } from './execution.js';
import type { CheckResult } from './quality.js';
import { cadRequestDigest } from './cad-arguments.js';
import { scopedNativeWindowContainsTargets, progressiveReviewScope } from './cad-review-scope.js';
export { cadRequestDigest } from './cad-arguments.js';
type Entity = Record<string, any>;
export type SourceState = {
    status: 'pending' | 'accepted' | 'committed' | 'verified' | 'uncertain' | 'unknown';
    entity_ids: number[];
    operation_ids: string[];
    text?: string;
    rotation?: number;
    source_evidence?: unknown;
    native_checks?: CheckResult[];
    visual_evidence?: unknown;
    history?: unknown[];
};
export interface SourceWorklist {
    version: 1;
    index_path: string;
    index_sha256: string;
    source_sha256: string;
    items: Record<string, SourceState>;
    active_batch?: {
        root_call_id: string;
        ids: string[];
        operation_mark: number;
        arguments_sha256: string[];
    } | null;
    rounds: number;
    observation_rounds?: Record<string, number>;
    residual_reviews: unknown[];
}
export const sourceDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** New source-only evidence may resolve an unexecuted label. Never silently
 * revise a Native entity or turn a source reading into CAD/visual acceptance. */
export function refreshUnexecutedSourceReadings(index:ReferenceIndex,work:SourceWorklist,report:Awaited<ReturnType<typeof reviewIndexedSource>>,ids:string[]=report.items.map(r=>r.id)){
    assertSourceWorklist(index,work);
    if(report.source_sha256!==work.source_sha256||report.complete_source_accepted!==false||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!report.index_item_ids.includes(id)||report.items.filter(r=>r.id===id).length!==1))throw Error('SOURCE_REFRESH_BINDING_INVALID');
    const updates=ids.map(id=>{
        const item=index.items.find(i=>i.id===id),state=work.items[id],row=report.items.find(r=>r.id===id);
        if(!item||item.kind!=='text'||!state||!['pending','accepted','uncertain'].includes(state.status)||state.entity_ids.length||state.operation_ids.length)throw Error('SOURCE_REFRESH_ALREADY_EXECUTED_OR_UNSUPPORTED');
        if(!row||row.status!=='clear'||!row.text?.trim()||row.text.length>1024||row.rotation===null||![0,90,180,270].includes(row.rotation))throw Error('SOURCE_REFRESH_READING_UNCERTAIN');
        const crop=sourceItemView(index,[item],1).crop;
        const targets=report.attempts.filter(a=>a.items.length===1&&a.items[0]?.id===id&&Number.isSafeInteger(a.view.display_scale)&&(a.view.display_scale??0)>=1&&(a.view.display_scale??0)<=8&&sourceDigest(a.view.crop)===sourceDigest(crop)).slice(-2);
        if(targets.length!==2||targets[0]!.id===targets[1]!.id||targets.some(a=>a.items[0]!.status!=='clear'||sourceLiteralKey(a.items[0]!.text)!==sourceLiteralKey(row.text)||a.items[0]!.rotation!==row.rotation))throw Error('SOURCE_REFRESH_TARGET_PROOF_REQUIRED');
        return {id,state,row};
    });
    for(const {state,row}of updates){
        (state.history??=[]).push({source:state.source_evidence,status:state.status,reason:'independent-target-source-refresh'});
        state.source_evidence={source:'independent_target_reread',source_sha256:report.source_sha256,view:report.view,attempt_ids:report.attempts.map(a=>a.id),report_sha256:sourceDigest(report),reading:structuredClone(row),not_cad_acceptance:true};
        state.text=sourceLiteralKey(row.text)!;state.rotation=row.rotation!;state.status='accepted';
    }
    return {applied_ids:ids,source_sha256:report.source_sha256,report_sha256:sourceDigest(report),cad_operations:0,quality_accepted:false};
}
/** Reconcile a stale pause checkpoint only with an exact confirmed journal
 * extension and a complete fresh native read. Does not accept visual evidence
 * or acquire document authority; the caller retains its connection guards. */
export function reconcileKnownSourceCheckpoint(index:ReferenceIndex,work:SourceWorklist,previous:string[],operations:CadOperationRecord[],entities:Entity[]){
    assertSourceWorklist(index,work);
    if(operations.some(o=>!['committed','blocked_not_dispatched','failed_before_dispatch'].includes(o.outcome))||Object.values(work.items).some(i=>i.status==='unknown'))throw new Error('SOURCE_RESUME_UNKNOWN_OUTCOME');
    const confirmed=operations.filter(o=>o.outcome==='committed');
    if(new Set(confirmed.map(o=>o.operation_id)).size!==confirmed.length||new Set(previous).size!==previous.length||previous.length>=confirmed.length||!previous.every((id,i)=>confirmed[i]?.operation_id===id))throw new Error('SOURCE_RESUME_LEDGER_NOT_PREFIX');
    const suffix=confirmed.slice(previous.length);
    for(const op of suffix){
        const name=op.tool.split('__').at(-1);
        if(name==='save_drawing'&&!op.created_entity_ids?.length)continue;
        if(!['draw_polyline','draw_text'].includes(name??'')||op.created_entity_ids?.length!==1)throw new Error('SOURCE_RESUME_UNSUPPORTED_OPERATION');
        const candidates=index.items.filter(i=>work.items[i.id]!.operation_ids.includes(op.operation_id));
        if(candidates.length!==1)throw new Error('SOURCE_RESUME_OPERATION_UNBOUND');
        const item=candidates[0]!,state=work.items[item.id]!,expected=sourceItemOperation(index,item,state);
        if(!['committed','verified'].includes(state.status)||sourceDigest(state.entity_ids)!==sourceDigest(op.created_entity_ids)||op.request_arguments_sha256!==cadRequestDigest(expected.tool,expected.arguments))throw new Error('SOURCE_RESUME_ARGUMENTS_CHANGED');
    }
    const native=verifySourceCheckpoint(index,work,entities);
    if(new Set(entities.map(e=>e.object_id)).size!==entities.length||!native.ok)throw new Error('SOURCE_RESUME_NATIVE_MISMATCH');
    return {reason:'KNOWN_SOURCE_PREFIX_RECONCILED',observed_sha256:sourceDigest(entities),confirmed_operation_ids:confirmed.map(o=>o.operation_id),suffix_operation_ids:suffix.map(o=>o.operation_id),native,quality_accepted:false};
}
/** A full checkpoint verifies every known committed/verified source item,
 * including earlier batches; a targeted observation can never replace this. */
export function verifySourceCheckpoint(index:ReferenceIndex,work:SourceWorklist,entities:Entity[]){
    const known=index.items.filter(i=>['committed','verified'].includes(work.items[i.id]!.status)),byId=new Map(entities.map(e=>[e.object_id,e]));
    const ids=new Set(known.flatMap(i=>work.items[i.id]!.entity_ids)),unexpected=entities.filter(e=>!ids.has(e.object_id));
    const invalid=known.filter(i=>{const state=work.items[i.id]!;return verifySourceItem(index,i,state,state.entity_ids.flatMap(id=>byId.has(id)?[byId.get(id)!]:[])).some(c=>c.status!=='pass');});
    return {ok:!unexpected.length&&!invalid.length,checked_items:known.length,entity_count:entities.length,invalid_item_ids:invalid.slice(0,16).map(i=>i.id),unexpected_entity_ids:unexpected.slice(0,16).map(e=>e.object_id)};
}
/** Aggregate actual per-target observations, never synthesize a model verdict.
 * A closer view can supersede only the targets it really inspected. All raw
 * conflicting reports stay in the batch history and full fidelity stays pending. */
export function sourcePrimitiveCoverage(reviews: any[], entities: Entity[], source: string, document: string, before: string, after?: string, indexSha?: string) {
    const expected = new Map(entities.flatMap(e => [[`${e.object_id}:primitive_visibility`, e.object_id], ...typeof e.text_string === 'string' ? [[`${e.object_id}:text_readability`, e.object_id]] : []] as [
        string,
        number
    ][]));
    const statuses = new Map<string, string>(), ids = new Set(entities.map(e => e.object_id));
    let admitted = 0;
    for (const report of reviews) {
        const evidence = report?.evidence, scope = evidence?.review_scope, result = report?.scope_report, rows = result?.geometry_checks;
        const proof = scope?.source_verification;
        const sourceBound = evidence?.reference?.sha256 === source || Boolean(indexSha && scope?.evidence_mode === 'cad-render-only' && evidence?.reference === null && proof?.source_sha256 === source && proof.index_sha256 === indexSha && proof.snapshot_sha256 === before && /^[a-f0-9]{64}$/.test(proof.native_checks_sha256 ?? '') && Array.isArray(scope.targets) && scope.targets.every((t:any)=>{const actual=entities.find(e=>e.object_id===t.entity_id);return Boolean(actual&&t.native_geometry?.native_geometry_sha256===sourceDigest(actual));}));
        if (after !== undefined && before !== after || !report.review_valid || !report.structured?.checklist?.some((c: any) => c.requirement_id === 'indexed_batch_fidelity') || !sourceBound || evidence.document !== document || !scope?.geometry_only || scope.source_sha256 !== source || scope.snapshot_hash !== before || result?.scope_id !== scope.id || !Array.isArray(scope.entity_ids) || !scope.entity_ids.length || new Set(scope.entity_ids).size !== scope.entity_ids.length || scope.entity_ids.some((id: number) => !ids.has(id)) || !Array.isArray(result.checked_entity_ids) || sourceDigest([...result.checked_entity_ids].sort()) !== sourceDigest([...scope.entity_ids].sort()) || !Array.isArray(rows) || evidence.image_bounds?.possible_clipping && !scopedNativeWindowContainsTargets(evidence))
            continue;
        const keys = [...expected].filter(([, id]) => scope.entity_ids.includes(id)).map(([key]) => key), actual = rows.map((r: any) => `${r.entity_id}:${r.check}`);
        if (actual.length !== keys.length || new Set(actual).size !== keys.length || actual.some((key: string) => !keys.includes(key)) || rows.some((r: any) => !['pass', 'fail', 'uncertain'].includes(r.status)))
            continue;
        admitted++;
        for (const row of rows)
            statuses.set(`${row.entity_id}:${row.check}`, row.status);
    }
    const unresolved = [...new Set([...expected].filter(([key]) => statuses.get(key) !== 'pass').map(([, id]) => id))];
    // Without a fresh post-observation native hash these rows can ONLY choose
    // the next close-up. They cannot release source items or task acceptance.
    return { complete: entities.length > 0 && !unresolved.length && after !== undefined && before === after, observed_targets_complete: entities.length > 0 && !unresolved.length, pending_native_confirmation: after === undefined, unresolved_entity_ids: unresolved, admitted_reports: admitted, checks: [...expected].map(([key, id]) => ({ entity_id: id, check: key.split(':')[1], status: statuses.get(key) ?? 'not_run' })) };
}
/** Source/CAD coordinates were independently verified before this call. Do not
 * show unsubmitted source content to a primitive rendering worker. Full source
 * comparison remains mandatory in source-window and global verification. */
export function sourceRenderScope(scoped: ReturnType<typeof sourceGroupReviewScope>, indexSha: string, checks: CheckResult[]) {
    if (!checks.length || checks.some(c => c.status !== 'pass'))
        throw new Error('SOURCE_NATIVE_PROOF_REQUIRED_FOR_RENDER_SCOPE');
    const { sourceView: _sourceView, ...base } = scoped.view;
    const view = { ...base, details: base.details?.map(({ sourceView: _source, ...detail }) => detail) };
    const { id: _id, source_bindings: _bindings, source_coordinate_system: _coordinates, ...prior } = scoped.binding;
    const binding = { ...prior, view, evidence_mode: 'cad-render-only', source_verification: { source_sha256: prior.source_sha256, index_sha256: indexSha, snapshot_sha256: prior.snapshot_hash, native_checks_sha256: sourceDigest(checks), scope: 'Actual source pixel support and exact native geometry checked independently. Render visibility/Native TEXT readability only; full source fidelity still pending.' } };
    return { view, binding: { ...binding, id: sourceDigest(binding) } };
}
/** Full source coverage is reviewed only after all primitives exist. The crop
 * is an exact pixel-edge window shared by source and native plotting; crossing
 * entities are intentionally cropped on BOTH sides, never silently omitted. */
export function sourceWindowReviewScope(index: ReferenceIndex, tile: number, entities: Entity[], document: unknown, snapshot: string) {
    const [x, y, a, b] = index.tiles[tile]!.view, s = 1000 / index.source.width, h = index.source.height;
    const window: [
        number,
        number,
        number,
        number
    ] = [x * s, (h - b) * s, a * s, (h - y) * s];
    const targets = entities.filter(e => e.bounding_box && e.bounding_box.max[0] >= window[0] && e.bounding_box.min[0] <= window[2] && e.bounding_box.max[1] >= window[1] && e.bounding_box.min[1] <= window[3]).map(e => ({ object_id: e.object_id, type: e.type, bounding_box: e.bounding_box, ...typeof e.text_string === 'string' ? { text_string: e.text_string } : {} }));
    const base = progressiveReviewScope({ region: 'source_tile_' + tile, mode: 'source-window', document, snapshot_hash: snapshot, source_sha256: index.source.sha256, entities: targets, bounds: [[window[0], window[1]], [window[2], window[3]]], image: index.source, source_bounds: [[0, 0], [1, 1]], toSource: p => [p[0]! / 1000, 1 - p[1]! / s / h] });
    const view = { world_window: window, min_long_edge: 2048, sourceView: { crop: { left: x, top: y, width: a - x, height: b - y } } };
    const { id: _old, ...binding } = base.binding;
    const bound = { ...binding, view, source_window: { image: { width: index.source.width, height: h }, scope: 'All source content within paired pixel-edge window; crossing entities intentionally cropped. Global boundaries remain separately mandatory.' } };
    return { view, binding: { ...bound, id: sourceDigest(bound) }, entities: targets };
}
export function sourceGroupReviewScope(input: Parameters<typeof progressiveReviewScope>[0], items: SourceItem[], work: SourceWorklist) {
    const pixelScale=Math.max(Math.abs(input.bounds[1][0]-input.bounds[0][0])/(input.image.width*(input.source_bounds[1][0]-input.source_bounds[0][0])),Math.abs(input.bounds[1][1]-input.bounds[0][1])/(input.image.height*(input.source_bounds[1][1]-input.source_bounds[0][1])));
    // Tiny residual strokes need context, not a viewport filled entirely by
    // stroke ink. Preserve ten original pixels on each side; never edit CAD
    // geometry to compensate for an over-magnified observation.
    const scopedInput={...input,minimum_context_margin:Math.max(input.minimum_context_margin??0.1,Number.isFinite(pixelScale)&&pixelScale>0?pixelScale*10:0.1)};
    const summaries = input.entities.map(e => ({ object_id: e.object_id, type: e.type, bounding_box: e.bounding_box, layer: e.layer, height: e.height, constant_width:e.constant_width, ...typeof e.text_string === 'string' ? { text_string: e.text_string } : {}, native_geometry_sha256: sourceDigest(e) }));
    const scope = progressiveReviewScope({ ...scopedInput, entities: summaries }), groups = new Map<string, SourceItem[]>();
    for (const item of items) {
        const key = item.group_id ?? item.id;
        groups.set(key, [...groups.get(key) ?? [], item]);
    }
    const meaningful = [...groups.values()].filter(group => group.length > 1 || group[0]!.kind === 'text');
    if (meaningful.length)
        scope.view.details = meaningful.slice(0, 3).map(group => {
            const ids = group.flatMap(i => work.items[i.id]!.entity_ids), entities = input.entities.filter(e => ids.includes(e.object_id));
            const detail = progressiveReviewScope({ ...scopedInput, entities }).view;
            return { request: { world_window: detail.world_window!, min_long_edge: 2048 }, entity_ids: ids, sourceView: detail.sourceView };
        });
    return bindSourceReview(scope, items, work);
}
export function bindSourceReview(scope: ReturnType<typeof progressiveReviewScope>, items: SourceItem[], work: SourceWorklist) {
    const crop = scope.view.sourceView?.crop;
    if (!crop)
        throw new Error('SOURCE_REVIEW_CROP_BINDING_REQUIRED');
    const local = ([x, y]: number[]) => [Number(((x! - crop.left) / crop.width).toFixed(7)), Number(((y! - crop.top) / crop.height).toFixed(7))];
    const source_bindings = items.map(item => ({ source_id: item.id, group_id: item.group_id ?? null, entity_ids: work.items[item.id]!.entity_ids, geometry: item.kind === 'path' ? { kind: 'path', bounds: [local(item.bounds.slice(0, 2)), local(item.bounds.slice(2))], vertex_count: item.points.length, source_path_sha256: sourceDigest(item.points), closed: item.closed } : { kind: 'text', text: work.items[item.id]!.text ?? item.text, bounds: [local(item.bounds.slice(0, 2)), local(item.bounds.slice(2))] } }));
    const targets = scope.binding.targets.map(target => {
        const members = source_bindings.filter(b => b.entity_ids.includes(target.entity_id));
        if (members.length !== 1)
            throw new Error('SOURCE_REVIEW_ENTITY_BINDING_INVALID');
        return { ...target, source_trace_ids: [members[0]!.source_id] };
    });
    const { id: _id, ...previous } = scope.binding;
    const binding = { ...previous, targets, source_coordinate_system: 'normalized-attached-reference-crop-top-left-y-down', source_bindings };
    return { ...scope, binding: { ...binding, id: sourceDigest(binding) } };
}
export function sourceBatchReviewAccepted(review: {
    review_valid?: boolean;
    evidence: unknown;
    structured: {
        verdict: string;
        checklist: {
            requirement_id: string;
            status: string;
        }[];
    } | null;
}, source: string, document: string, before: string, after: string, requirement = 'indexed_batch_fidelity') {
    const evidence = review.evidence as any;
    if (requirement === 'indexed_region_fidelity' && (evidence?.review_scope?.mode !== 'source-window' || evidence.review_scope.geometry_only || evidence.review_scope.snapshot_hash !== before || evidence.review_scope.source_sha256 !== source || evidence.review_scope.document !== document))
        return false;
    return review.review_valid === true && evidence?.reference?.sha256 === source && evidence.document === document && before === after && review.structured?.verdict === 'pass' && review.structured.checklist.some(c => c.requirement_id === requirement && c.status === 'pass') && (!evidence.image_bounds?.possible_clipping || scopedNativeWindowContainsTargets(evidence));
}
export function sourceBatchSelection(items: SourceItem[], work: SourceWorklist, active?: string[]) {
    const chosen = new Set(active ?? items.filter(i => work.items[i.id]!.status === 'committed').map(i => i.id));
    const groups = new Set(items.filter(i => chosen.has(i.id) && i.group_id).map(i => i.group_id!));
    const selected = items.filter(i => chosen.has(i.id) && work.items[i.id]!.entity_ids.length && work.items[i.id]!.status === 'committed').slice(0, 64);
    const pending = items.filter(i => i.group_id && groups.has(i.group_id) && !['committed', 'verified'].includes(work.items[i.id]!.status));
    return { items: selected, pending_ids: pending.map(i => i.id) };
}
export function createSourceWorklist(index: ReferenceIndex, path: string): SourceWorklist {
    return { version: 1, index_path: path, index_sha256: sourceDigest(index), source_sha256: index.source.sha256, items: Object.fromEntries(index.items.map(i => [i.id, { status: 'pending' as const, entity_ids: [], operation_ids: [] }])), rounds: 0, residual_reviews: [] };
}
export function assertSourceWorklist(index: ReferenceIndex, work: SourceWorklist) {
    if (work.source_sha256 !== index.source.sha256 || work.index_sha256 !== sourceDigest(index) || Object.keys(work.items).length !== index.items.length || index.items.some(i => !Object.hasOwn(work.items, i.id)))
        throw new Error('SOURCE_WORKLIST_INDEX_CHANGED');
}
export function sourceItemOwner(index: ReferenceIndex, item: SourceItem) {
    const [x, y] = item.owner_point ?? [(item.bounds[0] + item.bounds[2]) / 2, (item.bounds[1] + item.bounds[3]) / 2];
    const found = index.tiles.findIndex(({ owner: [a, b, c, d] }) => x >= a && x < c && y >= b && y < d);
    if (found < 0)
        throw new Error('SOURCE_ITEM_OWNER_MISSING');
    return found;
}
export function sourceSelection(index: ReferenceIndex, work: SourceWorklist, ids: string[], allowPartialGroups = false) {
    assertSourceWorklist(index, work);
    if (!ids.length || ids.length > 64 || new Set(ids).size !== ids.length)
        throw new Error('SOURCE_BATCH_IDS_INVALID');
    const selected = ids.map(id => {
        const item = index.items.find(i => i.id === id);
        if (!item)
            throw new Error('SOURCE_ITEM_UNKNOWN');
        const state = work.items[id]!;
        if (['committed', 'verified', 'unknown'].includes(state.status))
            throw new Error('SOURCE_ITEM_NOT_REPLAYABLE: ' + id);
        return item;
    });
    for (const item of selected)
        if (item.group_id && !allowPartialGroups) {
            const missing = index.items.filter(i => i.group_id === item.group_id && !ids.includes(i.id) && ['pending', 'accepted', 'uncertain', 'unknown'].includes(work.items[i.id]!.status));
            if (missing.length)
                throw new Error('SOURCE_GROUP_INCOMPLETE: ' + JSON.stringify({ group: item.group_id, include_ids: missing.map(i => i.id), reason: 'Meaningful glyph/shape groups must not be split across visual acceptance batches.' }));
        }
    return selected;
}
/** Normalize selected groups in Harness rather than making the model manually
 * splice pages of dependent glyph IDs. Nothing dispatches unless the complete
 * normalized set fits the existing whole-Patch schema/budget/permission gate. */
export function expandSourceIds(index: ReferenceIndex, work: SourceWorklist, requested: string[], limit = 64) {
    assertSourceWorklist(index, work);
    if (!requested.length || requested.length > limit || new Set(requested).size !== requested.length)
        throw new Error('SOURCE_BATCH_IDS_INVALID');
    const chosen = requested.map(id => {
        const item = index.items.find(i => i.id === id);
        if (!item)
            throw new Error('SOURCE_ITEM_UNKNOWN');
        if (['committed', 'verified', 'unknown'].includes(work.items[id]!.status))
            throw new Error('SOURCE_ITEM_NOT_REPLAYABLE: ' + id);
        return item;
    });
    const groups = new Set(chosen.flatMap(i => i.group_id ? [i.group_id] : []));
    if (index.items.some(i => i.group_id && groups.has(i.group_id) && work.items[i.id]!.status === 'unknown'))
        throw new Error('SOURCE_ITEM_NOT_REPLAYABLE: unknown group outcome');
    const ids = [...new Set([...requested, ...index.items.filter(i => i.group_id && groups.has(i.group_id) && ['pending', 'accepted'].includes(work.items[i.id]!.status)).map(i => i.id)])].slice(0, limit);
    sourceSelection(index, work, ids, true);
    return ids;
}
export function sourceItemOperation(index: ReferenceIndex, item: SourceItem, state: SourceState) {
    const scale = 1000 / index.source.width, point = ([x, y]: number[]) => [Number((x! * scale).toFixed(6)), Number(((index.source.height - y!) * scale).toFixed(6)), 0];
    if (item.kind === 'path')
        return { tool: 'mcp__autocad__draw_polyline', arguments: { points: item.points.map(point), closed: item.closed, layer: 'CADER_SOURCE_GEOMETRY', width: Number(((item.stroke_width ?? 1) * scale).toFixed(6)) } };
    const [x, y, a, b] = item.bounds, rotation = state.rotation ?? (a - x >= b - y ? 0 : 90), box = [x * scale, (index.source.height - b) * scale, a * scale, (index.source.height - y) * scale].map(v => Number(v.toFixed(6)));
    return { tool: 'mcp__autocad__draw_text', arguments: { position_x: box[0], position_y: box[1], position_z: 0, text: state.text ?? item.text, height: Math.max(.001, Math.min(a - x, b - y) * scale), rotation, layer: 'CADER_SOURCE_TEXT', fit_box: box } };
}
/** Bind exact acknowledged leaves to source IDs. No missing/failed native result
 * becomes a completed feature; only explicit undispatched outcomes may retry. */
export function reconcileSourceBatch(work: SourceWorklist, operations: CadOperationRecord[]) {
    const batch = work.active_batch;
    if (!batch)
        return;
    for (const [i, id] of batch.ids.entries()) {
        const state = work.items[id]!, op = operations.find(o => o.tool_call_id === `${batch.root_call_id}:patch:${i}`);
        if (!op)
            continue;
        if (op.request_arguments_sha256 !== batch.arguments_sha256[i])
            throw new Error('SOURCE_BATCH_ARGUMENT_BINDING_MISMATCH');
        if (state.operation_ids.includes(op.operation_id))
            continue;
        state.operation_ids.push(op.operation_id);
        if (op.outcome === 'committed' && op.created_entity_ids?.length) {
            state.entity_ids = [...new Set(op.created_entity_ids)];
            state.status = 'committed';
        }
        else if (['unknown', 'committed_observation_failed'].includes(op.outcome))
            state.status = 'unknown';
    }
}
export function verifySourceItem(index: ReferenceIndex, item: SourceItem, state: SourceState, entities: Entity[]): CheckResult[] {
    const owned = entities.filter(e => state.entity_ids.includes(e.object_id)), operation = sourceItemOperation(index, item, state), a = operation.arguments as Record<string, any>;
    const near = (x: number[], y: number[]) => x.length === y.length && x.every((n, i) => Number.isFinite(y[i]) && Math.abs(n - y[i]!) <= 1e-5);
    let pass = false, actual: unknown = owned;
    if (item.kind === 'path') {
        pass = owned.length === 1 && ['AcDb2dPolyline', 'AcDbPolyline'].includes(owned[0]!.type) && owned[0]!.closed === a.closed && Array.isArray(owned[0]!.coordinates) && Array.isArray(owned[0]!.normal) && near(owned[0]!.normal, [0, 0, 1]) && Math.abs(owned[0]!.elevation ?? Infinity) <= 1e-7 && Math.abs(owned[0]!.constant_width - a.width) <= 1e-5;
        if (pass) {
            const stride = owned[0]!.coordinate_dimension, expected = a.points.flatMap((p: number[]) => stride === 2 ? p.slice(0, 2) : p);
            pass = [2, 3].includes(stride) && near(expected, owned[0]!.coordinates) && Array.isArray(owned[0]!.bulges) && owned[0]!.bulges.length === a.points.length && owned[0]!.bulges.every((v: number) => Number.isFinite(v) && Math.abs(v) < 1e-10);
        }
        actual = owned.map(e => ({ object_id: e.object_id, coordinates: e.coordinates, closed: e.closed, normal: e.normal, constant_width: e.constant_width }));
    }
    else {
        const box = a.fit_box;
        pass = owned.length === 1 && owned[0]!.type === 'AcDbText' && owned[0]!.text_string === a.text && owned[0]!.bounding_box && near([...owned[0]!.bounding_box.min.slice(0, 2), ...owned[0]!.bounding_box.max.slice(0, 2)], box);
        actual = owned.map(e => ({ object_id: e.object_id, text: e.text_string, bounds: e.bounding_box }));
    }
    return [{ id: 'source_' + item.id, status: pass ? 'pass' : 'fail', evidence: JSON.stringify({ source_sha256: index.source.sha256, item_id: item.id, expected: operation, actual, scope: 'native coordinates/literal text only; image and complete coverage remain separate' }) }];
}
/** Graphical connectivity, not an inferred functional netlist. Shared source
 * vertices and all actual native segments must agree, including cross-region
 * joins. Retracing an existing edge does not invent another connection. */
export function verifySourceGraph(index: ReferenceIndex, work: SourceWorklist, entities: Entity[]): CheckResult {
    const graph = (paths: {
        points: number[][];
        closed: boolean;
    }[]) => {
        const adjacency = new Map<string, Set<string>>(), edges = new Set<string>();
        const point = (p: number[]) => p.slice(0, 2).map(n => Number(n.toFixed(6))).join(',');
        for (const path of paths) {
            const points = path.closed ? [...path.points, path.points[0]!] : path.points;
            for (let i = 1; i < points.length; i++) {
                const a = point(points[i - 1]!), b = point(points[i]!);
                if (a === b)
                    continue;
                edges.add([a, b].sort().join('|'));
                if (!adjacency.has(a))
                    adjacency.set(a, new Set());
                if (!adjacency.has(b))
                    adjacency.set(b, new Set());
                adjacency.get(a)!.add(b);
                adjacency.get(b)!.add(a);
            }
        }
        const seen = new Set<string>();
        let components = 0;
        for (const node of adjacency.keys()) {
            if (seen.has(node))
                continue;
            components++;
            const queue = [node];
            while (queue.length) {
                const key = queue.pop()!;
                if (seen.has(key))
                    continue;
                seen.add(key);
                queue.push(...adjacency.get(key)!);
            }
        }
        return { nodes: adjacency.size, components, edges };
    };
    const expected = graph(index.items.filter(i => i.kind === 'path').map(item => sourceItemOperation(index, item, work.items[item.id]!).arguments as {
        points: number[][];
        closed: boolean;
    }));
    const native = entities.filter(e => ['AcDbPolyline', 'AcDb2dPolyline'].includes(e.type));
    const unsupported = native.filter(e => ![2, 3].includes(e.coordinate_dimension) || !Array.isArray(e.coordinates) || e.coordinates.length < e.coordinate_dimension * 2 || e.coordinates.length % e.coordinate_dimension !== 0 || !e.coordinates.every(Number.isFinite) || !Array.isArray(e.bulges) || e.bulges.some((n: number) => !Number.isFinite(n) || Math.abs(n) > 1e-10) || JSON.stringify(e.normal) !== '[0,0,1]' || e.elevation !== 0);
    if (unsupported.length)
        return { id: 'source_graph_connectivity', status: 'fail', evidence: JSON.stringify({ unsupported_native_entity_ids: unsupported.map(e => e.object_id), reason: 'Straight native WCS XY coordinates and explicit zero bulges required; no bbox substitute' }) };
    const actual = graph(native.map(e => ({ closed: e.closed, points: Array.from({ length: e.coordinates.length / e.coordinate_dimension }, (_, i) => e.coordinates.slice(i * e.coordinate_dimension, (i + 1) * e.coordinate_dimension)) })));
    const unexpected = entities.filter(e => !index.items.some(i => work.items[i.id]!.entity_ids.includes(e.object_id))).map(e => e.object_id);
    const missing = [...expected.edges].filter(e => !actual.edges.has(e)), extra = [...actual.edges].filter(e => !expected.edges.has(e));
    return { id: 'source_graph_connectivity', status: !missing.length && !extra.length && !unexpected.length && expected.components === actual.components ? 'pass' : 'fail', evidence: JSON.stringify({ source_nodes: expected.nodes, source_edges: expected.edges.size, source_components: expected.components, native_nodes: actual.nodes, native_edges: actual.edges.size, native_components: actual.components, missing: missing.slice(0, 32), extra: extra.slice(0, 32), unexpected_entity_ids: unexpected, scope: 'Observed source-path graphical connectivity, NOT certified functional engineering semantics' }) };
}
export function sourceWorklistSummary(index: ReferenceIndex, work: SourceWorklist) {
    const counts: Record<string, number> = {}, tiles = index.tiles.map((t, id) => ({ id: 'source_tile_' + id, bounds: t.owner, total: 0, pending: 0 }));
    for (const item of index.items) {
        const state = work.items[item.id]!;
        counts[state.status] = (counts[state.status] ?? 0) + 1;
        const tile = tiles[sourceItemOwner(index, item)]!;
        tile.total++;
        if (state.status !== 'verified')
            tile.pending++;
    }
    return { source_sha256: index.source.sha256, index_sha256: work.index_sha256, total: index.items.length, counts, all_verified: index.items.length > 0 && index.items.every(i => work.items[i.id]!.status === 'verified'), semantics: 'requires final independent source/CAD comparison', tiles };
}
export function sourceWorklistPage(index: ReferenceIndex, work: SourceWorklist, region: number, cursor = 0) {
    const held = (i: SourceItem) => ['uncertain', 'unknown'].includes(work.items[i.id]!.status);
    const rank = (i: SourceItem) => held(i) ? 3 : ['accepted', 'pending', 'committed', 'uncertain', 'unknown'].indexOf(work.items[i.id]!.status);
    const items = index.items.filter(i => sourceItemOwner(index, i) === region && work.items[i.id]!.status !== 'verified').sort((a, b) => rank(a) - rank(b) || a.kind.localeCompare(b.kind) || a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]);
    const page = items.slice(cursor, cursor + 32);
    const recommended: SourceItem[] = [];
    for (const item of items.slice(cursor).filter(i => !held(i) && ['accepted', 'pending'].includes(work.items[i.id]!.status))) {
        if (recommended.length >= 64) break;
        if (recommended.some(i => i.id === item.id))
            continue;
        const group = item.group_id ? items.filter(i => i.group_id === item.group_id && ['accepted', 'pending'].includes(work.items[i.id]!.status)).slice(0, 64 - recommended.length) : [item];
        if (recommended.length + group.length > 64)
            continue;
        if (!recommended.length) {
            recommended.push(...group);
            continue;
        }
        if (item.kind !== recommended[0]!.kind)
            continue;
        const all = [...recommended, ...group], width = Math.max(...all.map(i => i.bounds[2])) - Math.min(...all.map(i => i.bounds[0])), height = Math.max(...all.map(i => i.bounds[3])) - Math.min(...all.map(i => i.bounds[1]));
        if (width <= 800 && height <= 800)
            recommended.push(...group);
    }
    return { summary: sourceWorklistSummary(index, work), region: 'source_tile_' + region, cursor, next_cursor: cursor + page.length < items.length ? cursor + page.length : null, recommended_ids: recommended.map(i => i.id), recommendation: 'Spatially bounded proposal, Agent may choose a different subset/order; no geometry has been dispatched.', items: page.map(i => ({ id: i.id, kind: i.kind, bounds: i.bounds, group_id: i.group_id ?? null, status: work.items[i.id]!.status, entity_ids: work.items[i.id]!.entity_ids, ...(i.kind === 'text' ? { text: i.text, score: i.score, alternatives: i.alternatives } : { vertices: i.points.length, pixel_length: i.pixel_length }) })), notice: 'Stable source hypotheses, not completed CAD. Agent selects IDs. Confirmed and unknown items must never be replayed.' };
}
