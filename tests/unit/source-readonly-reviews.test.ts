import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceWorklist,runIndexedRegions,sourceItemOperation} from '@cader/profile';

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
 return {runtime:{executionStop:()=>null,setVerificationScope:()=>{},reviewCadView:review} as any,owner:{definitions:()=>[],facts:()=>f.facts} as any,progressive:f.state,index:f.index,sourcePath:'fixture',task:'fixture',model:async()=>{throw Error('No writer is allowed in this fixture');},enter:async()=>{},persist:async()=>{},checkpoint:async()=>{},assertSource:async()=>{},observe,emit:()=>{},onEvidenceError:()=>{},onVisual:()=>{}};
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
for(const changed of [false,true])test('three target re-observations share one fresh native bracket; changed='+changed,async()=>{
 const f=fixture(1);f.index.items=Array.from({length:7},(_,i)=>({...f.index.items[0],id:'path_'+i}));f.work=createSourceWorklist(f.index,'fixture');f.state.source_worklist=f.work;f.regions[0]!.status='pending';
 f.entities=f.index.items.map((item:any,i:number)=>{const s=f.work.items[item.id]!;s.status='committed';s.entity_ids=[i+1];const op=sourceItemOperation(f.index,item,s),points=op.arguments.points as number[][];return {object_id:i+1,type:'AcDb2dPolyline',coordinates:points.flat(),coordinate_dimension:3,closed:false,constant_width:op.arguments.width,normal:[0,0,1],elevation:0,bulges:points.map(()=>0),bounding_box:{min:[100,400,0],max:[700,800,0]}};});
 let reads=0,reviews=0;const c=context(f,async()=>{reads++;const entities=structuredClone(f.entities);if(changed&&reads===2)entities[0]!.coordinates[0]++;return {entities,document:'owned'};},async q=>report(q,++reviews===1?'uncertain':'pass'));
 c.model=async(_instruction?:string,request?:any)=>{await request.afterCadBatch();throw Error('FIXTURE_END');};
 await assert.rejects(runIndexedRegions(c),changed?/SOURCE_BATCH_VISUAL_PENDING/:/FIXTURE_END/);
 assert.equal(reviews,4);assert.equal(reads,2);assert.ok(Object.values(f.work.items).every(s=>s.status===(changed?'committed':'verified')));
});
