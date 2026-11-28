import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceWorklist,runIndexedRegions,sourceItemOperation,verifySourceCheckpoint} from '@cader/profile';

// Deterministic Scheduler fixtures only; no API, actual image or CAD result.
function fixture(tiles=2){
 const index:any={version:1,source:{path:'fixture',sha256:'a'.repeat(64),width:100,height:100},engine:{},tiles:Array.from({length:tiles},()=>({owner:[0,0,100,100],view:[0,0,100,100]})),items:[{id:'path_a',kind:'path',status:'proposal',bounds:[10,20,70,60],points:[[10,20],[70,20],[70,60]],closed:false,pixel_length:100,stroke_width:2}]};
 const work=createSourceWorklist(index,'fixture');work.items.path_a!.status='verified';work.items.path_a!.entity_ids=[1];
 const regions:any[]=index.tiles.map((_:unknown,i:number)=>({id:'source_tile_'+i,status:'partial_verified',failure:null,entity_ids:[1],batches:[],repairs:0}));
 const state:any={document:'owned',source_worklist:work,regions,plan:{regions:regions.map(r=>({id:r.id}))}};
 const facts:any={native_target:{document_id:'identity'},local_connection_id:'conn',operation_mark:1,scratch:'owned',frozen:false,operations:[]};
 const entities:any[]=[{object_id:1,type:'AcDbPolyline',bounding_box:{min:[100,400,0],max:[700,800,0]}}];
 return {index,work,regions,state,facts,entities};
}
function report(question:string,status='pass'){
 const q=JSON.parse(question),scope=q.review_scope,ids=scope.entity_ids;
 return {review_valid:true,image_ref:'fixture-view',evidence:{reference:scope.evidence_mode==='cad-render-only'?null:{sha256:scope.source_sha256},document:'owned',review_scope:scope},structured:{verdict:status,checklist:[{requirement_id:q.requirements[0].id,status}]},scope_report:{scope_id:scope.id,checked_entity_ids:ids,geometry_checks:ids.map((entity_id:number)=>({entity_id,check:'primitive_visibility',status,evidence:'fixture observation'}))}};
}
function context(f:ReturnType<typeof fixture>,observe:()=>Promise<any>,review:(q:string)=>Promise<any>){
 return {runtime:{executionStop:()=>null,setVerificationScope:()=>{},isCadReviewCurrent:async()=>false,reviewCadView:review} as any,owner:{definitions:()=>[],facts:()=>f.facts} as any,progressive:f.state,index:f.index,sourcePath:'fixture',task:'fixture',model:async():Promise<any>=>{throw Error('No writer is allowed in this fixture');},enter:async()=>{},persist:async()=>{},checkpoint:async()=>{},assertSource:async()=>{},observe,emit:()=>{},onEvidenceError:(_error:unknown)=>{},onVisual:()=>{}};
}
test('seventeen full-source windows require six fresh native reads and never accept before each bounded post-query',async()=>{
 const f=fixture(17);let reads=0,reviews=0,checkpoints=0;
 const c=context(f,async()=>{reads++;return {entities:structuredClone(f.entities),document:'owned'};},async q=>{
  reviews++;assert.equal(f.regions.filter(r=>r.status==='verified').length,Math.floor((reviews-1)/8)*8);
  return report(q);
 });c.checkpoint=async()=>{checkpoints++;};
 await runIndexedRegions(c);assert.equal(reviews,17);assert.equal(reads,6);assert.equal(checkpoints,3);assert.ok(f.regions.every(r=>r.status==='verified'));
});
for(const failure of ['native_change','post_read_failed','vision_cancelled','write','connection','document','target','frozen'])test('read-only review group cannot accept on '+failure,async()=>{
 const f=fixture();let reads=0,reviews=0;
 const c=context(f,async()=>{reads++;if(reads===2&&failure==='post_read_failed')throw Error('READ_FAILED');return {entities:reads===2&&failure==='native_change'?[...f.entities,{object_id:2,type:'AcDbLine'}]:structuredClone(f.entities),document:'owned'};},async q=>{
  reviews++;
  if(failure==='vision_cancelled'&&reviews===2)throw Error('CANCELLED');
  if(failure==='write')f.facts.operations.push({operation_id:'unexpected-write'});
  if(failure==='connection')f.facts.local_connection_id='foreign';
  if(failure==='document')f.facts.scratch='foreign';
  if(failure==='target')f.facts.native_target={document_id:'foreign'};
  if(failure==='frozen')f.facts.frozen=true;
  return report(q);
 });
 if(failure==='native_change')await runIndexedRegions(c);else await assert.rejects(runIndexedRegions(c));
 assert.ok(f.regions.every(r=>r.status!=='verified'));assert.ok(Object.values(f.work.items).every(s=>s.status==='verified'),'primitive evidence remains distinct from failed full coverage');
});
test('an empty source hook adds no second whole-document query after the executor already verified its layer write',async()=>{
 const f=fixture(1);f.work.items.path_a!.status='pending';f.work.items.path_a!.entity_ids=[];f.regions[0]!.status='pending';let reads=0;
 const c=context(f,async()=>{reads++;throw Error('No source targets to read');},async()=>{throw Error('No source targets to review');});
 c.model=async(_instruction?:string,request?:any)=>{await request.afterCadBatch();throw Error('FIXTURE_END');};
 await assert.rejects(runIndexedRegions(c),/FIXTURE_END/);assert.equal(reads,0);assert.equal(f.work.items.path_a!.status,'pending');
});
test('full source checkpoint revalidates earlier verified geometry, committed items, missing IDs and unexpected entities',()=>{
 const f=fixture(1),s=f.work.items.path_a!,op=sourceItemOperation(f.index,f.index.items[0],s),points=op.arguments.points as number[][];
 const entity={object_id:1,type:'AcDb2dPolyline',coordinates:points.flat(),coordinate_dimension:3,closed:false,constant_width:op.arguments.width,normal:[0,0,1],elevation:0,bulges:points.map(()=>0)};
 for(const status of ['committed','verified'] as const){s.status=status;assert.equal(verifySourceCheckpoint(f.index,f.work,[entity]).ok,true);const modified=structuredClone(entity);modified.coordinates[0]!++;assert.equal(verifySourceCheckpoint(f.index,f.work,[modified]).ok,false);assert.equal(verifySourceCheckpoint(f.index,f.work,[]).ok,false);}
 assert.equal(verifySourceCheckpoint(f.index,f.work,[entity,{...entity,object_id:2}]).ok,false);
});
test('primitive region completion may reuse a guarded full observation; full source windows still query fresh before and after',async()=>{
 const f=fixture(1),op=sourceItemOperation(f.index,f.index.items[0],f.work.items.path_a!),points=op.arguments.points as number[][];f.regions[0]!.status='drawing';
 f.entities=[{...f.entities[0],coordinates:points.flat(),coordinate_dimension:3,type:'AcDb2dPolyline',closed:false,constant_width:op.arguments.width,normal:[0,0,1],elevation:0,bulges:points.map(()=>0)}];
 let full=0,recent=0;const snapshot=()=>({entities:structuredClone(f.entities),document:'owned',scope:'full_document'});
 const c=context(f,async()=>{full++;return snapshot();},async q=>report(q));Object.assign(c,{observeRecentFull:async()=>{recent++;return snapshot();}});
 await runIndexedRegions(c);assert.equal(recent,1);assert.equal(full,2);assert.equal(f.regions[0]!.status,'verified');
});
for(const failure of ['none','target_changed','checkpoint_failed'])test('targeted re-observations still require a full checkpoint: '+failure,async()=>{
 const f=fixture(1);f.index.items=Array.from({length:7},(_,i)=>({...f.index.items[0],id:'path_'+i}));f.work=createSourceWorklist(f.index,'fixture');f.state.source_worklist=f.work;f.regions[0]!.status='pending';
 f.entities=f.index.items.map((item:any,i:number)=>{const s=f.work.items[item.id]!;s.status='committed';s.entity_ids=[i+1];const op=sourceItemOperation(f.index,item,s),points=op.arguments.points as number[][];return {object_id:i+1,type:'AcDb2dPolyline',coordinates:points.flat(),coordinate_dimension:3,closed:false,constant_width:op.arguments.width,normal:[0,0,1],elevation:0,bulges:points.map(()=>0),bounding_box:{min:[100,400,0],max:[700,800,0]}};});
 let reads=0,reviews=0,fullReads=0;const c=context(f,async()=>{fullReads++;return {entities:structuredClone(f.entities),document:'owned'};},async q=>report(q,++reviews===1?'uncertain':'pass'));
 Object.assign(c,{observeTargets:async(ids:number[])=>{assert.deepEqual(ids,[1,2,3,4,5,6,7]);reads++;const entities=structuredClone(f.entities);if(failure==='target_changed'&&reads===2)entities[0]!.coordinates[0]++;return {entities,document:'owned',scope:'entity_set'};}});
 c.checkpoint=async()=>{await c.observe();if(failure==='checkpoint_failed')throw Error('FULL_CHECKPOINT_FAILED');};
 c.model=async(_instruction?:string,request?:any)=>{await request.afterCadBatch();throw Error('FIXTURE_END');};
 await assert.rejects(runIndexedRegions(c),failure==='target_changed'?/SOURCE_BATCH_VISUAL_PENDING/:failure==='checkpoint_failed'?/FULL_CHECKPOINT_FAILED/:/FIXTURE_END/);
 assert.equal(reviews,4);assert.equal(reads,2);assert.equal(fullReads,1);assert.ok(Object.values(f.work.items).every(s=>s.status===(failure==='none'?'verified':'committed')));
});

test('Scheduler completes the five unresolved observation tails before another Agent drawing turn',async()=>{
 const f=fixture(1),base=f.index.items[0];f.index.items=Array.from({length:33},(_,i)=>({...base,id:'path_'+i}));f.work=createSourceWorklist(f.index,'fixture');f.state.source_worklist=f.work;f.regions[0]!.status='drawing';
 f.entities=f.index.items.slice(0,32).map((item:any,i:number)=>{const s=f.work.items[item.id]!;s.status='committed';s.entity_ids=[i+1];const op=sourceItemOperation(f.index,item,s),points=op.arguments.points as number[][];return {object_id:i+1,type:'AcDb2dPolyline',coordinates:points.flat(),coordinate_dimension:3,closed:false,constant_width:op.arguments.width,normal:[0,0,1],elevation:0,bulges:points.map(()=>0),bounding_box:{min:[100,400,0],max:[700,800,0]}};});
 let reviews=0,models=0;const c=context(f,async()=>({entities:structuredClone(f.entities),document:'owned'}),async question=>{
  const result=report(question,++reviews===1?'uncertain':'pass');if(reviews===1)result.scope_report.geometry_checks=result.scope_report.geometry_checks.map((row:any,i:number)=>({...row,status:i<3?'pass':'uncertain'}));return result;
 });Object.assign(c,{observeTargets:async(ids:number[])=>({entities:structuredClone(f.entities.filter(e=>ids.includes(e.object_id))),document:'owned',scope:'entity_set'})});
 c.model=async(_instruction?:string,request?:any)=>{models++;if(models===1){await assert.rejects(request.afterCadBatch(),/SOURCE_BATCH_VISUAL_PENDING/);assert.equal(Object.values(f.work.items).filter(s=>s.status==='committed').length,5);await assert.rejects(request.sourceBatch.compile(['path_32'],'new'),/SOURCE_COMMITTED_REVIEW_REQUIRED/);return {handoff:{kind:'verification'}} as any;}assert.ok(f.index.items.slice(0,32).every((i:any)=>f.work.items[i.id]!.status==='verified'));throw Error('FIXTURE_DONE');};
 await assert.rejects(runIndexedRegions(c),/FIXTURE_DONE/);assert.equal(models,2);assert.equal(reviews,10);assert.equal(f.regions[0]!.repairs,0);assert.equal(f.work.items.path_32!.status,'pending');assert.deepEqual(Object.values(f.work.observation_rounds!),[1]);assert.equal(f.facts.operations.length,0,'read-only tail resolution admits no extra native writes');
});

test('unresolved native-correct observations have a persisted bounded allowance and cannot open drawing turns',async()=>{
 const f=fixture(1),item=f.index.items[0],s=f.work.items[item.id]!;s.status='committed';s.native_checks=[{id:'source_'+item.id,status:'pass',evidence:'fixture'}];f.regions[0]!.status='repairing';f.regions[0]!.checks=s.native_checks;
 const op=sourceItemOperation(f.index,item,s),points=op.arguments.points as number[][];f.entities=[{object_id:1,type:'AcDb2dPolyline',coordinates:points.flat(),coordinate_dimension:3,closed:false,constant_width:op.arguments.width,normal:[0,0,1],elevation:0,bulges:points.map(()=>0),bounding_box:{min:[100,400,0],max:[700,800,0]}}];
 let reviews=0;const c=context(f,async()=>({entities:structuredClone(f.entities),document:'owned'}),async question=>{reviews++;return report(question,'uncertain');});
 await runIndexedRegions(c);assert.equal(f.regions[0]!.status,'blocked');assert.equal(f.regions[0]!.failure,'SOURCE_VISUAL_REOBSERVATION_LIMIT');assert.equal(s.status,'committed');assert.equal(reviews,4);assert.deepEqual(Object.values(f.work.observation_rounds!),[2]);
 await runIndexedRegions(c);assert.equal(reviews,4,'same saved frontier cannot reset its allowance');assert.equal(s.status,'committed');
});

for(const code of ['SOURCE_RESIDUAL_HELPER_FAILED','SOURCE_HELPER_RESOURCE_EXHAUSTED'])test('source worker failure hands the original cause to Scheduler before native writes: '+code,async()=>{
 const f=fixture(1);f.work.items.path_a!.status='pending';f.work.items.path_a!.entity_ids=[];f.regions[0]!.status='pending';let notifications=0,helpers=0,models=0;
 const c=context(f,async()=>{throw Error('No native observation allowed');},async()=>{throw Error('No visual call allowed');});
 c.runtime.checkSourcePaths=async()=>{helpers++;throw Error(code);};c.onEvidenceError=error=>{notifications++;assert.equal((error as Error).message,code);};
 c.model=async(_instruction?:string,request?:any)=>{models++;await request.sourceBatch.compile(['path_a'],'fixture');throw Error('Unreachable');};
 await assert.rejects(runIndexedRegions(c),new RegExp(code));assert.equal(models,1);assert.equal(helpers,1);assert.equal(notifications,1);assert.equal(f.work.items.path_a!.status,'pending');assert.equal(f.facts.operations.length,0);assert.notEqual(f.regions[0]!.failure,'SOURCE_REGION_NO_PROGRESS');
});
