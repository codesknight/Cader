import type { ReferenceIndex, SourceItem, ToolDefinition, createLiveRuntime } from '@cader/dsh-adapter';
import type { ProgressiveState, ProgressiveRegion } from './progressive.js';
import type { ExecutionSession } from './execution.js';
import type { QualityPhase } from './quality.js';
import { sourceDigest, sourceSelection, sourceItemOperation, reconcileSourceBatch, verifySourceItem, sourceItemOwner, sourceWorklistPage, sourceWorklistSummary, cadRequestDigest, sourceBatchReviewAccepted, sourceGroupReviewScope, sourceBatchSelection, sourceWindowReviewScope, sourcePrimitiveCoverage, expandSourceIds, sourceRenderScope } from './source-worklist.js';
type Runtime = Awaited<ReturnType<typeof createLiveRuntime>>;
type Model = (instruction: string, request?: Parameters<Runtime['run']>[2]) => Promise<Awaited<ReturnType<Runtime['run']>>>;
type Snapshot = Awaited<ReturnType<ExecutionSession['snapshot']>>;
type Review = Awaited<ReturnType<Runtime['reviewCadView']>>;
interface Context {
    runtime: Runtime;
    owner: ExecutionSession;
    progressive: ProgressiveState;
    index: ReferenceIndex;
    sourcePath: string;
    task: string;
    signal?: AbortSignal;
    model: Model;
    enter: (phase: QualityPhase) => Promise<void>;
    persist: () => Promise<void>;
    checkpoint: (reason: string, observation?: Snapshot) => Promise<void>;
    assertSource: () => Promise<void>;
    observe: () => Promise<Snapshot>;
    observeTargets?: (ids: number[]) => Promise<Snapshot>;
    observeRecentFull?: () => Promise<Snapshot>;
    emit: (event: {
        type: string;
        [key: string]: unknown;
    }) => void;
    onEvidenceError: (error: unknown) => void;
    onVisual: (review: Review, snapshot: string) => void;
    confirm?: Parameters<ExecutionSession['definitions']>[0];
}
/** A Scheduler mode using the same DSH loop/serial executor/permissions/recovery.
 * Model selects item IDs and local patches. Neither OCR nor a fixed drawing
 * sequence can bypass actual native and visual verification. */
export async function runIndexedRegions(c: Context) {
    const { index, progressive: p, runtime, owner } = c, work = p.source_worklist!;
    const itemMap = new Map(index.items.map(i => [i.id, i]));
    const frame = { point: ([x, y]: number[]) => [x! * 1000, (1 - y!) * 1000 * index.source.height / index.source.width], toSource: ([x, y]: number[]) => [x! / 1000, 1 - y! * index.source.width / (1000 * index.source.height)] };
    if (!p.document) {
        // The parent supplies the already approved task's new-document callback.
        throw new Error('SOURCE_WORKLIST_REQUIRES_CONFIRMED_DOCUMENT');
    }
    const definitions = owner.definitions(c.confirm), names = definitions.map(t => t.name);
    const readOnlyGuard = () => {
        const frontier = () => { const f = owner.facts(); return sourceDigest([f.local_connection_id, f.native_target, f.operations?.length ?? 0, f.scratch]); };
        const initial = frontier();
        return () => { if (owner.facts().frozen || frontier() !== initial) throw new Error('SOURCE_READONLY_FRONTIER_CHANGED'); };
    };
    for (const region of p.regions) {
        const stopped = runtime.executionStop();
        if (stopped)
            throw new Error(stopped);
        if (region.status === 'verified' || region.status === 'partial_verified')
            continue;
        p.active_region = region.id;
        region.status = 'drawing';
        region.failure = null;
        await c.persist();
        const tile = Number(region.id.replace('source_tile_', '')), local = index.items.filter(i => sourceItemOwner(index, i) === tile), localIds = new Set(local.map(i => i.id));
        let idle = 0;
        let compiledIds: string[] = [];
        const read = () => c.observe();
        const sync = async () => { reconcileSourceBatch(work, owner.facts().operations); await c.persist(); };
        const afterBatch = async () => {
            await sync();
            const active = work.active_batch;
            const scope = sourceBatchSelection(local, work, active?.ids), selected = scope.items;
            if (!selected.length)
                return;
            const selectedIds = selected.flatMap(i => work.items[i.id]!.entity_ids);
            const readTargets = () => c.observeTargets ? c.observeTargets(selectedIds) : read();
            const snapshot = await readTargets(), assertReadOnly = readOnlyGuard();
            const checks = selected.flatMap(i => verifySourceItem(index, i, work.items[i.id]!, snapshot.entities));
            region.checks = checks;
            c.emit({ type: 'source.native_checks', region: region.id, checks });
            if (checks.some(check => check.status !== 'pass')) {
                region.status = 'repairing';
                await c.checkpoint('source_native_geometry_pending');
                throw new Error('SOURCE_BATCH_NATIVE_CHECK_FAILED');
            }
            const entities = snapshot.entities.filter(e => selected.some(i => work.items[i.id]!.entity_ids.includes(e.object_id)));
            if (!entities.length)
                throw new Error('SOURCE_BATCH_NATIVE_ENTITIES_MISSING');
            const scoped = sourceRenderScope(sourceGroupReviewScope({ region: region.id, mode: 'affected-batch', primitiveOnly: true, document: owner.facts().native_target, snapshot_hash: sourceDigest(snapshot.entities), source_sha256: index.source.sha256, entities, bounds: [[0, 0], [1000, 1000 * index.source.height / index.source.width]], image: index.source, source_bounds: [[0, 0], [1, 1]], toSource: frame.toSource }, selected, work), work.index_sha256, checks);
            const requirements = [{ id: 'indexed_batch_fidelity', description: '仅核对本批已提交图元可见性、独立原生读回支持的轮廓位置及本批原生文字的字面可读性。路径可保留未识别字形，不对片段推断完整词语。线宽、填充、完整标注、邻件和完整关系仍待全部绘制后逐区域及全图验收；本批通过不能代表整图通过。' }];
            await c.enter('vision');
            runtime.setVerificationScope('source-batch:' + region.id + ':' + region.batches.length);
            const question = JSON.stringify({ review_scope: scoped.binding, original_request: '检查当前已提交图元的实际CAD渲染，不检查未提交内容或整体原图完整性。', requirements, entity_snapshot: entities.map(e => ({ object_id: e.object_id, type: e.type, ...typeof e.text_string === 'string' ? { text_string: e.text_string } : {} })), source_item_ids: selected.map(i => i.id), source_evidence: selected.filter(i => i.kind === 'text').map(i => ({ id: i.id, reading: work.items[i.id]!.source_evidence })), verification_scope: 'indexed-source-batch', note: 'Only an actual CAD rendering is supplied here. Actual source pixels and exact native geometry were independently checked by program; no source image or full-word completion comparison belongs to this stage. Native bounding boxes are WCS, not image pixels. Inspect only submitted primitive visibility and Native TEXT readability. Full original-image fidelity remains mandatory after all primitives exist.' });
            const previous = region.batches.at(-1), reuse = previous?.state_sha256 === sourceDigest(snapshot.entities) && sourceDigest(previous.entity_ids) === sourceDigest(entities.map(e => e.object_id)) && previous.review && await runtime.isCadReviewCurrent(previous.review);
            assertReadOnly();
            const review = reuse && previous.review?.structured?.verdict === 'pass' ? previous.review : reuse && previous.review && (!previous.review.review_valid || previous.review.structured?.verdict === 'uncertain') ? await runtime.reassessCadView(question, previous.review.image_ref, c.signal, undefined, undefined, scoped.view) : await runtime.reviewCadView(question, c.signal, undefined, undefined, scoped.view);
            assertReadOnly();
            c.onVisual(review, sourceDigest(snapshot.entities));
            const reviews = [review];
            let observations = sourcePrimitiveCoverage(reviews, entities, index.source.sha256, p.document!, sourceDigest(snapshot.entities), undefined, work.index_sha256);
            // Native geometry already matches the source. Missing pixels in a
            // broad plot require actual closer observations, never moving correct
            // CAD geometry to satisfy a visual model's unresolvable thumbnail.
            const unresolved = selected.filter(i => work.items[i.id]!.entity_ids.some(id => observations.unresolved_entity_ids.includes(id)));
            for (let offset = 0; !observations.observed_targets_complete && offset < Math.min(unresolved.length, 24); offset += 3) {
                await c.assertSource(); assertReadOnly();
                const subset = unresolved.slice(offset, offset + 3), native = entities.filter(e => subset.some(i => work.items[i.id]!.entity_ids.includes(e.object_id)));
                const close = sourceRenderScope(sourceGroupReviewScope({ region: region.id, mode: 'affected-batch', primitiveOnly: true, document: owner.facts().native_target, snapshot_hash: sourceDigest(snapshot.entities), source_sha256: index.source.sha256, entities: native, bounds: [[0, 0], [1000, 1000 * index.source.height / index.source.width]], image: index.source, source_bounds: [[0, 0], [1, 1]], toSource: frame.toSource }, subset, work), work.index_sha256, checks.filter(c => subset.some(i => c.id === 'source_' + i.id)));
                runtime.setVerificationScope('source-batch-close:' + region.id + ':' + region.batches.length + ':' + offset);
                const detail = await runtime.reviewCadView(JSON.stringify({ review_scope: close.binding, requirements, original_request: '只检查这些已提交图元的实际CAD渲染，不评价完整文字或完整源图。', entity_snapshot: native.map(e => ({ object_id: e.object_id, type: e.type, ...typeof e.text_string === 'string' ? { text_string: e.text_string } : {} })), verification_scope: 'primitive-target-reobservation', note: 'Fresh native close-up of ONLY these submitted targets. Inspect actual primitive visibility and native TEXT readability. Neighboring unsubmitted parts and full-word meaning of outline fragments remain outside this primitive scope. Do not move correct native coordinates.' }), c.signal, undefined, undefined, close.view);
                reviews.push(detail);
                c.onVisual(detail, sourceDigest(snapshot.entities));
                assertReadOnly();
                observations = sourcePrimitiveCoverage(reviews, entities, index.source.sha256, p.document!, sourceDigest(snapshot.entities), undefined, work.index_sha256);
            }
            // All workers in this bounded observation group are read-only.
            // Their reports only choose further views until this FRESH full
            // post-observation query confirms the original native snapshot.
            const after = await readTargets(); assertReadOnly();
            const coverage = sourcePrimitiveCoverage(reviews, entities, index.source.sha256, p.document!, sourceDigest(snapshot.entities), sourceDigest(after.entities), work.index_sha256);
            const batch: ProgressiveRegion['batches'][number] = { id: region.id + '-source-' + (region.batches.length + 1), operation_ids: selected.flatMap(i => work.items[i.id]!.operation_ids), entity_ids: entities.map(e => e.object_id), state_sha256: sourceDigest(snapshot.entities), checks: [...checks, { id: 'source_visual_target_coverage', status: coverage.complete ? 'pass' : 'not_run', evidence: JSON.stringify(coverage) }], status: 'pending', review, review_history: reviews.slice(1) };
            region.batches.push(batch);
            region.entity_ids = [...new Set(local.flatMap(i => work.items[i.id]!.entity_ids))];
            await c.checkpoint('indexed_batch_observed', after);
            const valid = coverage.complete;
            batch.status = valid ? 'pass' : 'fail';
            for (const item of selected) {
                const state = work.items[item.id]!;
                state.native_checks = checks.filter(v => v.id === 'source_' + item.id).map(v => ({ ...v, evidence: sourceDigest(v) }));
                state.visual_evidence = { scope: 'primitive-only; full region and global review still required', scope_id: scoped.binding.id, image_ref: review.image_ref, reports: reviews.map(r => ({ image_ref: r.image_ref, evidence_sha256: sourceDigest(r.evidence), report_sha256: sourceDigest(r.structured) })), target_coverage: { batch_complete: coverage.complete, checks: coverage.checks.filter(row => state.entity_ids.includes(row.entity_id)) } };
                if (!state.entity_ids.some(id => coverage.unresolved_entity_ids.includes(id)))
                    state.status = 'verified';
            }
            await c.persist();
            c.emit({ type: 'task.batch_verified', region: region.id, batch: batch.id, status: batch.status });
            if (!valid) {
                region.status = 'repairing';
                throw new Error('SOURCE_BATCH_VISUAL_PENDING');
            }
            region.status = 'drawing';
            await c.enter('drawing');
        };
        const finishRegion = async () => {
            const remaining = local.filter(i => work.items[i.id]!.status !== 'verified');
            if (remaining.length)
                throw new Error('SOURCE_REGION_HAS_PENDING_ITEMS: ' + JSON.stringify({ counts: sourceWorklistSummary(index, work).counts, remaining: remaining.slice(0, 32).map(i => ({ id: i.id, status: work.items[i.id]!.status, entity_ids: work.items[i.id]!.entity_ids })) }));
            const snapshot = c.observeRecentFull ? await c.observeRecentFull() : await read();
            region.entity_ids = [...new Set(local.flatMap(i => work.items[i.id]!.entity_ids))];
            const checks = local.flatMap(i => verifySourceItem(index, i, work.items[i.id]!, snapshot.entities));
            if (checks.some(v => v.status !== 'pass')) {
                region.checks = checks;
                throw new Error('SOURCE_REGION_NATIVE_CHANGED');
            }
            region.status = 'partial_verified';
            region.failure = null;
            region.final_sha256 = sourceDigest(snapshot.entities.filter(e => region.entity_ids.includes(e.object_id)));
            await c.checkpoint('indexed_region_primitives_verified', snapshot);
        };
        const pageTool: ToolDefinition = { name: 'cader_source_worklist', description: 'Read remaining stable source IDs in this region, with exact progress and existing native ownership. Optional cursor pages a frozen source list. This is not a whole-image recount.', parameters: { type: 'object', properties: { cursor: { type: 'integer', minimum: 0 } }, additionalProperties: false }, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] }, async execute(args) {
                return JSON.stringify(sourceWorklistPage(index, work, tile, (args as {
                    cursor?: number;
                }).cursor ?? 0));
            } };
        const finish: ToolDefinition = { name: 'cader_finish_drawing_unit', description: 'Request complete verification of all source IDs in the CURRENT region. Missing IDs cannot pass, and this cannot complete the entire drawing.', parameters: { type: 'object', properties: { unit_id: { const: region.id, type: 'string' } }, required: ['unit_id'], additionalProperties: false }, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] }, async execute(_args, exec) { await finishRegion(); exec.concludeTurn(); return JSON.stringify({ region: region.id, primitive_verified: true, full_region_review: 'pending until all source primitives exist', task_complete: false }); } };
        const sourceBatch = {
            async compile(ids: string[], callId: string, capacity = 64) {
                await c.assertSource();
                if (ids.some(id => !localIds.has(id)))
                    throw new Error('SOURCE_BATCH_REGION_OWNERSHIP_REQUIRED');
                if (local.some(i => work.items[i.id]!.status === 'committed'))
                    throw new Error('SOURCE_COMMITTED_REVIEW_REQUIRED: Verify the confirmed pending batch before dispatching new geometry; never replay it.');
                ids = expandSourceIds(index, work, ids, capacity);
                if (ids.some(id => !localIds.has(id)))
                    throw new Error('SOURCE_BATCH_REGION_OWNERSHIP_REQUIRED');
                compiledIds = ids;
                const items = sourceSelection(index, work, ids, true), unread = items.filter(i => work.items[i.id]!.status === 'pending');
                const pathItems = unread.filter(i => i.kind === 'path');
                for (let offset = 0; offset < pathItems.length; offset += 32) {
                    await c.enter('reference');
                    let proof:Awaited<ReturnType<Runtime['checkSourcePaths']>>;
                    try { proof = await runtime.checkSourcePaths(c.sourcePath, index, pathItems.slice(offset, offset + 32), c.signal); }
                    catch (error) { c.onEvidenceError(error); await c.persist(); throw error; }
                    for (const check of proof.report.checks) {
                        const state = work.items[check.id]!;
                        state.status = check.source_supported ? 'accepted' : 'uncertain';
                        state.source_evidence = { kind: 'independent-raster-source-support', source_sha256: index.source.sha256, proof_path: proof.path, input_sha256: proof.report.input_sha256, check, semantic_pending: true, scope: 'Only actual source strokes, not literal meaning or complete coverage' };
                    }
                    c.emit({ type: 'source.paths_verified', region: region.id, items: proof.report.checks.length, proof: proof.path, accepted: proof.report.checks.filter((v: any) => v.source_supported).length, semantics: 'not_verified' });
                    await c.persist();
                }
                const textItems = unread.filter(i => i.kind === 'text');
                for (let offset = 0; offset < textItems.length; offset += 32) {
                    await c.enter('reference');
                    runtime.setVerificationScope('source-read:' + region.id + ':' + work.rounds++);
                    let report: Awaited<ReturnType<Runtime['reviewIndexedSource']>>;
                    try {
                        report = await runtime.reviewIndexedSource(c.sourcePath, index, textItems.slice(offset, offset + 32), c.task, c.signal);
                    }
                    catch (error) {
                        c.onEvidenceError(error);
                        throw error;
                    }
                    c.emit({ type: 'source.items_reviewed', region: region.id, report });
                    for (const row of report.items) {
                        const state = work.items[row.id]!;
                        state.source_evidence = { source_sha256: report.source_sha256, view: report.view, attempt_ids: report.attempts.map(a => a.id), reading: row };
                        state.status = row.status === 'clear' ? 'accepted' : 'uncertain';
                        if (row.text !== null)
                            state.text = row.text;
                        if (row.rotation !== null)
                            state.rotation = row.rotation;
                    }
                    await c.persist();
                }
                const blocked = items.filter(i => work.items[i.id]!.status !== 'accepted');
                if (blocked.length)
                    throw new Error('SOURCE_BATCH_NOT_FULLY_ACCEPTED: ' + JSON.stringify({ accepted: items.filter(i => work.items[i.id]!.status === 'accepted').map(i => i.id), unresolved: blocked.map(i => ({ id: i.id, evidence: work.items[i.id]!.source_evidence })), next: 'Select accepted IDs; preserve unresolved facts for bounded clarification, never repeat the entire source inventory.' }));
                const operations = items.map(i => sourceItemOperation(index, i, work.items[i.id]!));
                work.active_batch = { root_call_id: callId, ids, operation_mark: owner.facts().operations.length, arguments_sha256: operations.map(o => cadRequestDigest(o.tool, o.arguments)) };
                await c.persist();
                await c.enter('drawing');
                return { operations };
            },
            async settled() { await sync(); work.active_batch = null; await c.persist(); },
            summary: (ids: string[]) => ({ requested_ids: ids, expanded_source_ids: compiledIds, items: compiledIds.map(id => ({ id, status: work.items[id]!.status, entity_ids: work.items[id]!.entity_ids, operation_ids: work.items[id]!.operation_ids })), native_checks: { passed: region.checks?.filter(c => c.status === 'pass').length ?? 0, failures: region.checks?.filter(c => c.status !== 'pass').slice(0, 8) }, visual: region.batches.at(-1)?.status ?? 'pending', full_evidence: 'Private execution journal, source worklist and bounded native/visual reports retained by Harness' })
        };
        const beforeCad = async (name: string, args: unknown) => {
            await c.assertSource();
            const tool = name.split('__').at(-1)!, a = args as Record<string, unknown>;
            if (tool === 'create_layer' && ['CADER_SOURCE_GEOMETRY', 'CADER_SOURCE_TEXT'].includes(String(a.name)))
                return;
            if (['draw_polyline', 'draw_text'].includes(tool)) {
                if (!work.active_batch || !work.active_batch.ids.some(id => sourceDigest(sourceItemOperation(index, itemMap.get(id)!, work.items[id]!).arguments) === sourceDigest(a)))
                    throw new Error('SOURCE_ITEM_ID_EXECUTION_REQUIRED');
                return;
            }
            if (['move_entity', 'rotate_entity', 'scale_entity'].includes(tool)) {
                const item = local.find(i => work.items[i.id]!.entity_ids.includes(Number(a.object_id)));
                if (item) {
                    const current = await read();
                    if (verifySourceItem(index, item, work.items[item.id]!, current.entities).every(check => check.status === 'pass'))
                        throw new Error('SOURCE_NATIVE_GEOMETRY_MATCHES_USE_VISUAL_REOBSERVATION');
                    const state = work.items[item.id]!;
                    if (state.status === 'verified') {
                        state.history = [...state.history ?? [], { visual: state.visual_evidence, native: state.native_checks }];
                        state.status = 'committed';
                        await c.persist();
                    }
                    return;
                }
            }
            throw new Error('SOURCE_REGION_WRITE_NOT_AUTHORIZED');
        };
        for (;;) {
            const stopped = runtime.executionStop();
            if (stopped)
                throw new Error(stopped);
            if (local.every(i => work.items[i.id]!.status === 'verified')) {
                await finishRegion();
                break;
            }
            if (local.every(i => ['verified', 'uncertain', 'unknown'].includes(work.items[i.id]!.status))) {
                region.status = 'blocked';
                region.failure = 'SOURCE_ITEMS_REQUIRE_CLARIFICATION';
                await c.persist();
                break;
            }
            const waiting = local.filter(i => work.items[i.id]!.status === 'committed');
            // Finish a bounded read-only observation before giving the Agent
            // another drawing turn. A missing closeup is not a CAD defect.
            if (waiting.length && region.checks?.length && region.checks.every(c => c.status === 'pass') && waiting.every(i => work.items[i.id]!.native_checks?.length && work.items[i.id]!.native_checks!.every(c => c.status === 'pass'))) {
                const key = region.id + ':' + owner.facts().operations.length;
                const rounds = work.observation_rounds ??= {}, used = rounds[key] ?? 0;
                if (!Number.isSafeInteger(used) || used < 0) throw new Error('SOURCE_OBSERVATION_CHECKPOINT_INVALID');
                if (used >= 2) {
                    region.status = 'blocked'; region.failure = 'SOURCE_VISUAL_REOBSERVATION_LIMIT';
                    await c.persist(); break;
                }
                rounds[key] = used + 1;
                c.emit({type:'task.source_observation_resume',region:region.id,round:used+1,pending_entities:waiting.flatMap(i=>work.items[i.id]!.entity_ids),cad_replayed:false});
                await c.persist();
                try { await afterBatch(); }
                catch (error) { if (!(error instanceof Error) || error.message !== 'SOURCE_BATCH_VISUAL_PENDING') throw error; region.status = 'repairing'; await c.persist(); }
                continue;
            }
            const mark = owner.facts().operations.length, progress = sourceDigest(Object.entries(work.items).map(([id, s]) => [id, s.status, s.entity_ids, s.text ?? null, s.rotation ?? null]));
            await c.enter(region.status === 'repairing' ? 'correcting' : 'drawing');
            const result = await c.model('使用中文。根据当前工作清单自主选择源图ID并实际绘制，不重新清点全图、不手抄坐标、不重放已确认项。先用list_layers核对CADER_SOURCE_GEOMETRY、CADER_SOURCE_TEXT，已有则复用，缺少时才create_layer；cader_apply_source_batch接受本区最多64个ID（仍受当前工具schema及单轮容量约束），程序复用原Patch预检/权限/预算和串行MCP，自动源复核、原生读回及视觉检查。若文字与路径跨度过大可拆批。源图不可辨项保持待确认，可继续其他accepted/pending项；不要重复提交同一uncertain集合。已提交但待验项用cader_review_cad_view交回受控检查；具体几何失败用本区局部移动/旋转/缩放patch，不删除重建全图。所有ID通过后调用cader_finish_drawing_unit；任务完整性由全图独立验收决定。' + JSON.stringify({ task: c.task, region: p.plan!.regions.find(r => r.id === region.id), worklist: sourceWorklistPage(index, work, tile), native_checks: { passed: region.checks?.filter(c => c.status === 'pass').length ?? 0, failures: region.checks?.filter(c => c.status !== 'pass').slice(0, 8) }, last_visual: { status: region.batches.at(-1)?.status, closeup_reports: region.batches.at(-1)?.review_history?.length ?? 0, scope: 'Primitive evidence only; full-region/global still pending' } }), { cadAction: true, image: c.sourcePath, imageView: { crop: { left: index.tiles[tile]!.view[0], top: index.tiles[tile]!.view[1], width: index.tiles[tile]!.view[2] - index.tiles[tile]!.view[0], height: index.tiles[tile]!.view[3] - index.tiles[tile]!.view[1] } }, maxImageViews: 2, onlyTools: [...names.filter(n => /__(?:draw_polyline|draw_text|create_layer|move_entity|rotate_entity|scale_entity|get_entity|list_layers)$/.test(n)), 'cader_apply_cad_patch', 'cader_review_cad_view', 'cader_view_image', pageTool.name, finish.name], extraTools: [pageTool, finish], sourceBatch, beforeCadOperation: beforeCad, afterCadBatch: afterBatch, controlledReview: async () => {
                    await afterBatch();
                    const latest = region.batches.at(-1);
                    const review = latest?.review_history?.at(-1) ?? latest?.review;
                    if (!review)
                        throw new Error('SOURCE_BATCH_VISUAL_EVIDENCE_MISSING');
                    return review;
                }, reviewEndsTurn: true, schedulerStepSlice: 12, completeDrawingUnit: finishRegion });
            if (owner.facts().frozen)
                throw new Error('CAD_WRITE_FROZEN');
            if (['verified', 'partial_verified'].includes((region as ProgressiveRegion).status))
                break;
            const now = sourceDigest(Object.entries(work.items).map(([id, s]) => [id, s.status, s.entity_ids, s.text ?? null, s.rotation ?? null]));
            if (mark === owner.facts().operations.length && now === progress) {
                if (++idle >= 3) {
                    region.status = 'blocked';
                    region.failure = 'SOURCE_REGION_NO_PROGRESS';
                    await c.persist();
                    break;
                }
            }
            else
                idle = 0;
            if (result.handoff?.kind === 'verification' && region.batches.at(-1)?.status === 'fail') {
                if (region.checks?.some(c => c.status !== 'pass') && ++region.repairs >= 3) {
                    region.status = 'blocked';
                    region.failure = 'REGION_REPAIR_LIMIT';
                    await c.persist();
                    break;
                }
                region.status = 'repairing';
            }
        }
        c.emit({ type: 'task.region', region: region.id, status: region.status, failure: region.failure, entities: region.entity_ids.length, batches: region.batches.length });
    }
    p.active_region = null;
    // No primitive-only checkpoint can release complete coverage. Every source
    // window is independently compared AFTER all source IDs have native proof.
    if (!index.items.every(item => work.items[item.id]!.status === 'verified'))
        return;
    const pendingRegions = p.regions.filter(r => r.status !== 'verified');
    // At most eight read-only full-window reviews share a real native bracket.
    // No region is accepted until a fresh full post-query confirms the bracket.
    for (let offset = 0; offset < pendingRegions.length; offset += 8) {
        await c.assertSource();
        const before = await readFull(), hash = sourceDigest(before.entities), assertReadOnly = readOnlyGuard();
        const observed: {region: ProgressiveRegion; review: Review}[] = [];
        for (const region of pendingRegions.slice(offset, offset + 8)) {
            await c.assertSource(); assertReadOnly(); p.active_region = region.id;
            const tile = Number(region.id.replace('source_tile_', ''));
            const scoped = sourceWindowReviewScope(index, tile, before.entities, p.document!, hash);
            const requirements = [{ id: 'indexed_region_fidelity', description: '完整核对原图A与CAD图B的配对区域：所有可见符号、线条、标注字形/文字及小数点、线宽、布局和窗口内连接一致，无遗漏或新增。两侧窗口具有同一原图像素边界，跨窗口实体在两侧同时截断是预期取景，不是缺陷；全图及跨区连接仍须单独验收。不得把先前图元通过当成本区域已经通过。' }];
            await c.enter('vision');
            runtime.setVerificationScope('source-region-full:' + region.id);
            const review = await runtime.reviewCadView(JSON.stringify({ review_scope: scoped.binding, requirements, original_request: c.task, entity_snapshot: scoped.entities, verification_scope: 'complete-source-window', note: 'All source items have now been drawn. Evaluate every visible source detail within the exact paired window, including source content with no matching native entity. This is full fidelity, not primitive-only acceptance.' }), c.signal, c.sourcePath, undefined, scoped.view);
            c.onVisual(review, hash);
            assertReadOnly(); observed.push({region, review});
            region.last_review = review; region.status = 'partial_verified';
            await c.persist();
        }
        const after = await readFull(); assertReadOnly();
        for (const {region, review} of observed) {
            const valid = sourceBatchReviewAccepted(review, index.source.sha256, p.document!, hash, sourceDigest(after.entities), 'indexed_region_fidelity');
            region.last_review = review;
            region.status = valid ? 'verified' : 'blocked';
            region.failure = valid ? null : 'SOURCE_FULL_REGION_VISUAL_PENDING';
            // Ownership checkpoints are independent of overlapping review windows.
            region.final_sha256 = sourceDigest(after.entities.filter(e => region.entity_ids.includes(e.object_id)));
            c.emit({ type: 'task.region', region: region.id, status: region.status, failure: region.failure });
        }
        await c.checkpoint('indexed_full_region_review_group', after);
    }
    p.active_region = null;
    async function readFull() { return c.observe(); }
}
