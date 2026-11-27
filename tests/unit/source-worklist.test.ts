import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReferenceIndex, sourceItemView, observedArguments } from '@cader/dsh-adapter';
import type { ReferenceIndex, SourceItem } from '@cader/dsh-adapter';
import { createSourceWorklist, assertSourceWorklist, sourceSelection, sourceItemOperation, reconcileSourceBatch, verifySourceItem, sourceWorklistPage, sourceDigest, cadRequestDigest, sourceBatchReviewAccepted,bindSourceReview,verifySourceGraph,sourceGroupReviewScope,sourceBatchSelection,sourceWindowReviewScope,scopedNativeWindowContainsTargets,runIndexedRegions,sourcePrimitiveCoverage } from '@cader/profile';
const path: SourceItem = { id: 'path_a', kind: 'path', status: 'proposal', bounds: [10, 20, 70, 60], points: [[10, 20], [70, 20], [70, 60]], closed: false, pixel_length: 100, stroke_width: 2 };
const text: SourceItem = { id: 'text_b', kind: 'text', status: 'proposal', bounds: [25, 70, 55, 80], text: '10kΩ', quad: [[25, 70], [55, 70], [55, 80], [25, 80]], score: .9, alternatives: [] };
test('full source window uses exact paired pixel edges; primitive passes cannot release full fidelity',()=>{
 const v=index(),crossing={object_id:7,type:'AcDbPolyline',bounding_box:{min:[0,300,0],max:[900,900,0]}};
 const scoped=sourceWindowReviewScope(v,0,[crossing],'owned','state');
 assert.deepEqual(scoped.view.world_window,[0,0,600,1000]);assert.deepEqual(scoped.view.sourceView.crop,{left:0,top:0,width:60,height:100});
 const evidence={document:'owned',reference:{sha256:v.source.sha256},review_scope:scoped.binding,view_request:scoped.view,view_evidence:{configuration_verified:true,projection:'WCS_XY_TOP',world_window:scoped.view.world_window},image_bounds:{possible_clipping:true}};
 assert.ok(scopedNativeWindowContainsTargets(evidence));assert.ok(!scopedNativeWindowContainsTargets({...evidence,view_evidence:{...evidence.view_evidence,world_window:[0,0,601,1000]}}));
 const report={review_valid:true,evidence,structured:{verdict:'pass',checklist:[{requirement_id:'indexed_region_fidelity',status:'pass'}]}};
 assert.ok(sourceBatchReviewAccepted(report,v.source.sha256,'owned','state','state','indexed_region_fidelity'));
 assert.ok(!sourceBatchReviewAccepted({...report,evidence:{...evidence,review_scope:{...scoped.binding,geometry_only:true}}},v.source.sha256,'owned','state','state','indexed_region_fidelity'));
 assert.ok(!sourceBatchReviewAccepted({...report,structured:{verdict:'pass',checklist:[{requirement_id:'indexed_batch_fidelity',status:'pass'}]}},v.source.sha256,'owned','state','state','indexed_region_fidelity'));
});
test('partial native dispatch includes acknowledged group prefix without replay and exposes pending siblings',()=>{
 const v=index();v.items=[{...path,id:'prefix',group_id:'unit'},{...text,id:'suffix',group_id:'unit'}];const w=createSourceWorklist(v,'fixture');w.items.prefix!.status='committed';w.items.prefix!.entity_ids=[1];
 assert.deepEqual(sourceBatchSelection(v.items,w,['prefix']).pending_ids,['suffix']);
 assert.deepEqual(sourceSelection(v,w,['suffix']).map(i=>i.id),['suffix']);w.items.prefix!.status='verified';w.items.suffix!.status='committed';w.items.suffix!.entity_ids=[2];
 const scope=sourceBatchSelection(v.items,w,['suffix']);assert.deepEqual(scope.items.map(i=>i.id),['prefix','suffix']);assert.deepEqual(scope.pending_ids,[]);assert.throws(()=>sourceSelection(v,w,['prefix']),/NOT_REPLAYABLE/);
});
test('source review binds actual entity IDs and attached crop coordinates, never offsets from a different view',()=>{
 const v=index(),work=createSourceWorklist(v,'fixture');work.items[path.id]!.entity_ids=[123];
 const scope:any={view:{sourceView:{crop:{left:0,top:10,width:100,height:80}}},binding:{id:'old',targets:[{entity_id:123,source_trace_ids:[]}],entity_ids:[123]}};
 const bound=bindSourceReview(scope,[path],work);assert.deepEqual(bound.binding.targets[0]!.source_trace_ids,[path.id]);assert.deepEqual((bound.binding.source_bindings[0]!.geometry as any).points[0],[.1,.125]);assert.notEqual(bound.binding.id,'old');
 assert.throws(()=>bindSourceReview({...scope,binding:{...scope.binding,targets:[{entity_id:456}]}},[path],work),/ENTITY_BINDING_INVALID/);
 assert.throws(()=>bindSourceReview({...scope,view:{}},[path],work),/CROP_BINDING_REQUIRED/);
});
test('trusted source groups larger than 32 stay whole within 64-leaf round capacity; native closeups include the full annotation unit',()=>{
 const v=index();v.items=Array.from({length:40},(_,i)=>({...path,id:'part_'+i,group_id:'unit',owner_point:[25,50] as [number,number]}));const w=createSourceWorklist(v,'fixture');assert.equal(sourceWorklistPage(v,w,0).recommended_ids.length,40);assert.equal(sourceSelection(v,w,v.items.map(i=>i.id)).length,40);assert.throws(()=>sourceSelection(v,w,Array.from({length:65},(_,i)=>'p'+i)),/BATCH_IDS/);
 const items=v.items.slice(0,2);w.items[items[0]!.id]!.entity_ids=[1];w.items[items[1]!.id]!.entity_ids=[2];
 const entities=[{object_id:1,type:'AcDb2dPolyline',bounding_box:{min:[100,400,0],max:[700,800,0]}},{object_id:2,type:'AcDbText',text_string:'fixture',bounding_box:{min:[250,200,0],max:[550,300,0]}}];
 const scoped=sourceGroupReviewScope({region:'fixture',mode:'affected-batch',document:'owned',snapshot_hash:'state',source_sha256:v.source.sha256,entities,bounds:[[0,0],[1000,1000]],image:v.source,source_bounds:[[0,0],[1,1]],toSource:p=>[p[0]!/1000,1-p[1]!/1000]},items,w);
 assert.deepEqual(scoped.view.details![0]!.entity_ids,[1,2]);assert.ok(scoped.view.details![0]!.sourceView);assert.ok(scoped.view.details![0]!.request.world_window![1]<200);
});
function index(): ReferenceIndex { return { version: 1, source: { sha256: 'a'.repeat(64), width: 100, height: 100 }, engine: { coordinate_system: 'original-pixels-top-left-y-down' }, tiles: [{ owner: [0, 0, 50, 100], view: [0, 0, 60, 100] }, { owner: [50, 0, 100, 100], view: [40, 0, 100, 100] }], items: [structuredClone(path), structuredClone(text)], coverage: { status: 'not_verified' }, semantics: 'not_verified', quality_accepted: false }; }
test('source ownership covers the original once while perception can overlap; corrupt source/tiles/width fail closed', () => {
    const v = index();
    assert.equal(parseReferenceIndex(v, v.source).items.length, 2);
    assert.throws(() => parseReferenceIndex({ ...v, source: { ...v.source, sha256: 'b'.repeat(64) } }, v.source), /INVALID/);
    assert.throws(() => parseReferenceIndex({ ...v, tiles: [v.tiles[0], v.tiles[0]] }, v.source), /OWNERSHIP/);
    assert.throws(() => parseReferenceIndex({ ...v, tiles: [v.tiles[0], { owner: [60, 0, 100, 100], view: [40, 0, 100, 100] }] }, v.source), /COVERAGE/);
    const bad = index();
    (bad.items[0] as any).stroke_width = -1;
    assert.throws(() => parseReferenceIndex(bad, bad.source), /PATH/);
    assert.throws(() => parseReferenceIndex({ ...v, items: [path, path] }, v.source), /ITEM/);
    assert.throws(()=>parseReferenceIndex({...v,engine:{...v.engine,annotation_blocks:[{bounds:[0,0,101,50]}]}},v.source),/ANNOTATION_BOUNDS/);
});
test('source groups stay in one owner and reject partial visual release; independent evidence must bind current source/document/state', () => {
    const v = index();
    v.items = [{ ...path, id: 'part_1', group_id: 'glyph', owner_point: [25, 50] }, { ...path, id: 'part_2', bounds: [60, 20, 80, 60], group_id: 'glyph', owner_point: [25, 50] }];
    const work = createSourceWorklist(v, 'fixture');
    assert.throws(() => sourceSelection(v, work, ['part_1']), /GROUP_INCOMPLETE/);
    assert.equal(sourceSelection(v, work, ['part_1', 'part_2']).length, 2);
    assert.deepEqual(sourceWorklistPage(v, work, 0).recommended_ids, ['part_1', 'part_2']);
    const report = { review_valid: true, evidence: { reference: { sha256: v.source.sha256 }, document: 'owned' }, structured: { verdict: 'pass', checklist: [{ requirement_id: 'indexed_batch_fidelity', status: 'pass' }] } };
    assert.ok(sourceBatchReviewAccepted(report, v.source.sha256, 'owned', 'state', 'state'));
    assert.ok(!sourceBatchReviewAccepted(report, 'wrong-source', 'owned', 'state', 'state'));
    assert.ok(!sourceBatchReviewAccepted(report, v.source.sha256, 'other-document', 'state', 'state'));
    assert.ok(!sourceBatchReviewAccepted(report, v.source.sha256, 'owned', 'old', 'new'));
    assert.ok(!sourceBatchReviewAccepted({ ...report, structured: { verdict: 'pass', checklist: [] } }, v.source.sha256, 'owned', 'state', 'state'));
});
test('source compilation retains exact original placement, axis direction, width and literal case', () => {
    const v = index(), work = createSourceWorklist(v, 'fixture-index');
    const operation = sourceItemOperation(v, path, work.items[path.id]!);
    assert.deepEqual(operation.arguments, { points: [[100, 800, 0], [700, 800, 0], [700, 400, 0]], closed: false, layer: 'CADER_SOURCE_GEOMETRY', width: 20 });
    const label = sourceItemOperation(v, text, { ...work.items[text.id]!, text: '10KΩ', rotation: 90 });
    assert.equal((label.arguments as any).text, '10KΩ');
    assert.deepEqual((label.arguments as any).fit_box, [250, 200, 550, 300]);
    assert.deepEqual(sourceItemView(v, [path]).crop, { left: 0, top: 0, width: 95, height: 85 });
    const changed = structuredClone(v);
    changed.items[0]!.bounds[0] = 11;
    assert.throws(() => assertSourceWorklist(changed, work), /INDEX_CHANGED/);
    assert.notEqual(cadRequestDigest(operation.tool, operation.arguments), sourceDigest(operation.arguments));
    assert.equal(cadRequestDigest(operation.tool, operation.arguments), cadRequestDigest('draw_polyline', { ...operation.arguments }));
});
test('exact acknowledged prefix is bound to IDs; unknowns never become retryable or verified', () => {
    const v = index(), work = createSourceWorklist(v, 'fixture-index'), op = sourceItemOperation(v, path, work.items[path.id]!);
    work.active_batch = { root_call_id: 'call', ids: [path.id, text.id], operation_mark: 0, arguments_sha256: [cadRequestDigest(op.tool, op.arguments), 'literal-hash'] };
    const first: any = { tool_call_id: 'call:patch:0', operation_id: 'ack1', tool: 'draw_polyline', request_arguments_sha256: work.active_batch.arguments_sha256[0], outcome: 'committed', created_entity_ids: [123] };
    const second: any = { tool_call_id: 'call:patch:1', operation_id: 'unknown2', tool: 'draw_text', request_arguments_sha256: 'literal-hash', outcome: 'unknown' };
    reconcileSourceBatch(work, [first, second]);
    reconcileSourceBatch(work, [first, second]);
    assert.deepEqual(work.items[path.id]!.operation_ids, ['ack1']);
    assert.equal(work.items[text.id]!.status, 'unknown');
    assert.throws(() => sourceSelection(v, work, [path.id]), /NOT_REPLAYABLE/);
    assert.throws(() => sourceSelection(v, work, [text.id]), /NOT_REPLAYABLE/);
    const tampered = createSourceWorklist(v, 'fixture-index');
    tampered.active_batch = work.active_batch;
    assert.throws(() => reconcileSourceBatch(tampered, [{ ...first, request_arguments_sha256: 'wrong' }]), /BINDING_MISMATCH/);
});
test('native acceptance checks vertices/OCS/width/text bbox rather than a successful tool or plausible bounds', () => {
    const v = index(), work = createSourceWorklist(v, 'fixture-index'), state = { ...work.items[path.id]!, entity_ids: [123] };
    const entity = { object_id: 123, type: 'AcDb2dPolyline', closed: false, coordinates: [100, 800, 0, 700, 800, 0, 700, 400, 0], coordinate_dimension: 3, normal: [0, 0, 1], elevation: 0, constant_width: 20, bulges: [0, 0, 0] };
    assert.equal(verifySourceItem(v, path, state, [entity])[0]!.status, 'pass');
    for (const patch of [{ coordinates: [100, 800, 0, 650, 800, 0, 700, 400, 0] }, { normal: [0, 1, 0] }, { constant_width: 0 }, { closed: true }, { bulges: [0, .1, 0] }])
        assert.equal(verifySourceItem(v, path, state, [{ ...entity, ...patch }])[0]!.status, 'fail');
    assert.equal(verifySourceItem(v, text, { ...work.items[text.id]!, entity_ids: [456] }, [{ object_id: 456, type: 'AcDbText', text_string: '10KΩ', bounding_box: { min: [250, 200, 0], max: [550, 300, 0] } }])[0]!.status, 'fail');
    work.items[path.id]!.status = 'uncertain';
    assert.equal(sourceWorklistPage(v, work, 0).items[0]!.id, text.id);
    const req = observedArguments('draw_polyline', { points: [[0, 0, 0], [1, 1, 0]], closed: false, layer: '0', width: .2 });
    assert.ok(req);
    assert.equal(req!.operation, 'draw_polyline');
});
test('graphical source connectivity rejects a detached bridge, invented entity or native arc',()=>{
 const v=index();v.items=[path];const w=createSourceWorklist(v,'fixture');w.items[path.id]!.entity_ids=[1];const entity={object_id:1,type:'AcDb2dPolyline',coordinates:[100,800,0,700,800,0,700,400,0],coordinate_dimension:3,closed:false,bulges:[0,0,0],normal:[0,0,1],elevation:0};
 assert.equal(verifySourceGraph(v,w,[entity]).status,'pass');
 assert.equal(verifySourceGraph(v,w,[{...entity,coordinates:[100,800,0,600,800,0,700,400,0]}]).status,'fail');
 assert.equal(verifySourceGraph(v,w,[entity,{object_id:2,type:'AcDbLine'}]).status,'fail');
 assert.equal(verifySourceGraph(v,w,[{...entity,bulges:[.1,0,0]}]).status,'fail');
});

// Deterministic Scheduler fixture, no real model/CAD result is claimed here.
test('Scheduler cannot promote primitive checkpoints without every full source-window review',async()=>{
 const v=index(),work=createSourceWorklist(v,'fixture');for(const state of Object.values(work.items))state.status='verified';
 const entities=[{object_id:1,type:'AcDbText',text_string:'fixture',bounding_box:{min:[250,200,0],max:[550,300,0]}}];
 const regions=v.tiles.map((_,i)=>({id:'source_tile_'+i,status:'partial_verified',failure:null,entity_ids:[1],batches:[],repairs:0}));
 const p:any={document:'owned',source_worklist:work,regions,plan:{regions:regions.map(r=>({id:r.id}))}};const questions:any[]=[];let modelCalls=0;
 const runtime:any={executionStop:()=>null,setVerificationScope:()=>{},async reviewCadView(question:string){const q=JSON.parse(question);questions.push(q);return {review_valid:true,image_ref:'fixture',evidence:{reference:{sha256:v.source.sha256},document:'owned',review_scope:q.review_scope},structured:{verdict:questions.length===1?'uncertain':'pass',checklist:[{requirement_id:'indexed_region_fidelity',status:questions.length===1?'uncertain':'pass'}]}};}};
 await runIndexedRegions({runtime,owner:{definitions:()=>[],facts:()=>({native_target:{document_id:'identity'}})} as any,progressive:p,index:v,sourcePath:'fixture',task:'fixture',model:async()=>{modelCalls++;throw new Error('Unexpected model');},enter:async()=>{},persist:async()=>{},checkpoint:async()=>{},assertSource:async()=>{},observe:async()=>({entities,document:'owned',document_revision:null,observed_at:'fixture'}),emit:()=>{},onEvidenceError:()=>{},onVisual:()=>{}});
 assert.equal(questions.length,2);assert.equal(modelCalls,0);assert.equal(regions[0]!.status,'blocked');assert.equal(regions[1]!.status,'verified');assert.equal(regions[0]!.failure,'SOURCE_FULL_REGION_VISUAL_PENDING');assert.ok(questions.every(q=>q.review_scope.mode==='source-window'&&!q.review_scope.geometry_only));assert.ok(!regions.every(r=>r.status==='verified'));
});

test('per-target visual re-observation combines real rows only; one close-up cannot pass unobserved neighbors',()=>{
 const entities=[{object_id:1,type:'AcDbPolyline'},{object_id:2,type:'AcDbText',text_string:'A'}];
 const report=(ids:number[],failed:number[]=[])=>({review_valid:true,structured:{verdict:failed.length?'fail':'pass',checklist:[{requirement_id:'indexed_batch_fidelity',status:failed.length?'fail':'pass'}]},evidence:{reference:{sha256:'source'},document:'owned',review_scope:{id:'scope'+ids.join('-'),entity_ids:ids,geometry_only:true,source_sha256:'source',snapshot_hash:'state'}},scope_report:{scope_id:'scope'+ids.join('-'),checked_entity_ids:ids,geometry_checks:ids.flatMap(id=>[{entity_id:id,check:'primitive_visibility',status:failed.includes(id)?'uncertain':'pass'},...id===2?[{entity_id:id,check:'text_readability',status:'pass'}]:[]])}});
 const broad=report([1,2],[2]),close=report([2]);
 assert.equal(sourcePrimitiveCoverage([broad],entities,'source','owned','state','state').complete,false);
 assert.equal(sourcePrimitiveCoverage([close],entities,'source','owned','state','state').complete,false);
 assert.equal(sourcePrimitiveCoverage([broad,close],entities,'source','owned','state','state').complete,true);
 assert.equal(sourcePrimitiveCoverage([close,broad],entities,'source','owned','state','state').complete,false);
 assert.equal(sourcePrimitiveCoverage([broad,close],entities,'source','owned','state','changed').complete,false);
 assert.equal(sourcePrimitiveCoverage([broad,close],entities,'wrong-source','owned','state','state').complete,false);
 assert.equal(sourcePrimitiveCoverage([broad,{...close,scope_report:{...close.scope_report,geometry_checks:[]}}],entities,'source','owned','state','state').complete,false);
 assert.equal(broad.structured.verdict,'fail'); // Never rewrite the old model report.
});
test('Scheduler blocks geometry edits when native source coordinates already match despite a visual complaint',async()=>{
 const v=index();v.items=[path];const w=createSourceWorklist(v,'fixture');w.items[path.id]!.status='committed';w.items[path.id]!.entity_ids=[1];
 const entity={object_id:1,type:'AcDb2dPolyline',closed:false,coordinates:[100,800,0,700,800,0,700,400,0],coordinate_dimension:3,normal:[0,0,1],elevation:0,constant_width:20,bulges:[0,0,0]};
 let calls=0;const p:any={document:'owned',source_worklist:w,regions:[{id:'source_tile_0',status:'drawing',failure:null,entity_ids:[1],batches:[],repairs:0}],plan:{regions:[{id:'source_tile_0'}]}};
 await runIndexedRegions({runtime:{executionStop:()=>null} as any,owner:{definitions:()=>[],facts:()=>({operations:[]})} as any,progressive:p,index:v,sourcePath:'fixture',task:'fixture',model:async(_task,request)=>{calls++;await assert.rejects(request!.beforeCadOperation!('mcp__autocad__move_entity',{object_id:1}),/SOURCE_NATIVE_GEOMETRY_MATCHES/);return {} as any;},enter:async()=>{},persist:async()=>{},checkpoint:async()=>{},assertSource:async()=>{},observe:async()=>({entities:[entity],document:'owned',document_revision:null,observed_at:'fixture'}),emit:()=>{},onEvidenceError:()=>{},onVisual:()=>{}});
 assert.equal(calls,3);assert.equal(w.items[path.id]!.status,'committed');assert.equal(p.regions[0].status,'blocked');assert.equal(entity.coordinates[0],100);
});
