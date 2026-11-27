import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReferenceIndex,sourceItemView,observedArguments} from '@cader/dsh-adapter';
import type {ReferenceIndex,SourceItem} from '@cader/dsh-adapter';
import {createSourceWorklist,assertSourceWorklist,sourceSelection,sourceItemOperation,reconcileSourceBatch,verifySourceItem,sourceWorklistPage,sourceDigest,cadRequestDigest} from '@cader/profile';
const path:SourceItem={id:'path_a',kind:'path',status:'proposal',bounds:[10,20,70,60],points:[[10,20],[70,20],[70,60]],closed:false,pixel_length:100,stroke_width:2};
const text:SourceItem={id:'text_b',kind:'text',status:'proposal',bounds:[25,70,55,80],text:'10kΩ',quad:[[25,70],[55,70],[55,80],[25,80]],score:.9,alternatives:[]};
function index():ReferenceIndex{return {version:1,source:{sha256:'a'.repeat(64),width:100,height:100},engine:{coordinate_system:'original-pixels-top-left-y-down'},tiles:[{owner:[0,0,50,100],view:[0,0,60,100]},{owner:[50,0,100,100],view:[40,0,100,100]}],items:[structuredClone(path),structuredClone(text)],coverage:{status:'not_verified'},semantics:'not_verified',quality_accepted:false};}
test('source ownership covers the original once while perception can overlap; corrupt source/tiles/width fail closed',()=>{
 const v=index();assert.equal(parseReferenceIndex(v,v.source).items.length,2);
 assert.throws(()=>parseReferenceIndex({...v,source:{...v.source,sha256:'b'.repeat(64)}},v.source),/INVALID/);
 assert.throws(()=>parseReferenceIndex({...v,tiles:[v.tiles[0],v.tiles[0]]},v.source),/OWNERSHIP/);
 assert.throws(()=>parseReferenceIndex({...v,tiles:[v.tiles[0],{owner:[60,0,100,100],view:[40,0,100,100]}]},v.source),/COVERAGE/);
 const bad=index();(bad.items[0] as any).stroke_width=-1;assert.throws(()=>parseReferenceIndex(bad,bad.source),/PATH/);
 assert.throws(()=>parseReferenceIndex({...v,items:[path,path]},v.source),/ITEM/);
});
test('source compilation retains exact original placement, axis direction, width and literal case',()=>{
 const v=index(),work=createSourceWorklist(v,'fixture-index');const operation=sourceItemOperation(v,path,work.items[path.id]!);
 assert.deepEqual(operation.arguments,{points:[[100,800,0],[700,800,0],[700,400,0]],closed:false,layer:'CADER_SOURCE_GEOMETRY',width:20});
 const label=sourceItemOperation(v,text,{...work.items[text.id]!,text:'10KΩ',rotation:90});assert.equal((label.arguments as any).text,'10KΩ');assert.deepEqual((label.arguments as any).fit_box,[250,200,550,300]);
 assert.deepEqual(sourceItemView(v,[path]).crop,{left:0,top:0,width:95,height:85});
 const changed=structuredClone(v);changed.items[0]!.bounds[0]=11;assert.throws(()=>assertSourceWorklist(changed,work),/INDEX_CHANGED/);
 assert.notEqual(cadRequestDigest(operation.tool,operation.arguments),sourceDigest(operation.arguments));
 assert.equal(cadRequestDigest(operation.tool,operation.arguments),cadRequestDigest('draw_polyline',{...operation.arguments}));
});
test('exact acknowledged prefix is bound to IDs; unknowns never become retryable or verified',()=>{
 const v=index(),work=createSourceWorklist(v,'fixture-index'),op=sourceItemOperation(v,path,work.items[path.id]!);
 work.active_batch={root_call_id:'call',ids:[path.id,text.id],operation_mark:0,arguments_sha256:[cadRequestDigest(op.tool,op.arguments),'literal-hash']};
 const first:any={tool_call_id:'call:patch:0',operation_id:'ack1',tool:'draw_polyline',request_arguments_sha256:work.active_batch.arguments_sha256[0],outcome:'committed',created_entity_ids:[123]};
 const second:any={tool_call_id:'call:patch:1',operation_id:'unknown2',tool:'draw_text',request_arguments_sha256:'literal-hash',outcome:'unknown'};
 reconcileSourceBatch(work,[first,second]);reconcileSourceBatch(work,[first,second]);assert.deepEqual(work.items[path.id]!.operation_ids,['ack1']);assert.equal(work.items[text.id]!.status,'unknown');
 assert.throws(()=>sourceSelection(v,work,[path.id]),/NOT_REPLAYABLE/);assert.throws(()=>sourceSelection(v,work,[text.id]),/NOT_REPLAYABLE/);
 const tampered=createSourceWorklist(v,'fixture-index');tampered.active_batch=work.active_batch;assert.throws(()=>reconcileSourceBatch(tampered,[{...first,request_arguments_sha256:'wrong'}]),/BINDING_MISMATCH/);
});
test('native acceptance checks vertices/OCS/width/text bbox rather than a successful tool or plausible bounds',()=>{
 const v=index(),work=createSourceWorklist(v,'fixture-index'),state={...work.items[path.id]!,entity_ids:[123]};
 const entity={object_id:123,type:'AcDb2dPolyline',closed:false,coordinates:[100,800,0,700,800,0,700,400,0],coordinate_dimension:3,normal:[0,0,1],elevation:0,constant_width:20,bulges:[0,0,0]};
 assert.equal(verifySourceItem(v,path,state,[entity])[0]!.status,'pass');
 for(const patch of [{coordinates:[100,800,0,650,800,0,700,400,0]},{normal:[0,1,0]},{constant_width:0},{closed:true},{bulges:[0,.1,0]}])assert.equal(verifySourceItem(v,path,state,[{...entity,...patch}])[0]!.status,'fail');
 assert.equal(verifySourceItem(v,text,{...work.items[text.id]!,entity_ids:[456]},[{object_id:456,type:'AcDbText',text_string:'10KΩ',bounding_box:{min:[250,200,0],max:[550,300,0]}}])[0]!.status,'fail');
 work.items[path.id]!.status='uncertain';assert.equal(sourceWorklistPage(v,work,0).items[0]!.id,text.id);
 const req=observedArguments('draw_polyline',{points:[[0,0,0],[1,1,0]],closed:false,layer:'0',width:.2});assert.ok(req);assert.equal(req!.operation,'draw_polyline');
});
