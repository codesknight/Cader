import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readReferenceImage} from '@cader/config';
import {createSourceWorklist,sourceItemOperation,cadRequestDigest,sourceDigest,runProgressiveTask} from '@cader/profile';
import type{ReferenceIndex}from'@cader/dsh-adapter';

for(const fault of ['none','connection','unknown','geometry'] as const)test('Harness resumes provider pause with fresh native known-prefix reconciliation: '+fault,async()=>{
 const task='复现测试参考图',imagePath='benchmark/fixtures/vision-calibration.png',image=await readReferenceImage(process.cwd(),imagePath),sha=createHash('sha256').update(image.data).digest('hex');
 // request_sha256 hashes the original string itself, rather than its JSON encoding.
 const requestHash=createHash('sha256').update(task).digest('hex');
 const index:ReferenceIndex={version:1,source:{sha256:sha,width:image.width,height:image.height},engine:{coordinate_system:'original-pixels-top-left-y-down'},tiles:[{owner:[0,0,image.width,image.height],view:[0,0,image.width,image.height]}],items:[{id:'path_a',kind:'path',status:'proposal',bounds:[10,20,20,20],points:[[10,20],[20,20]],closed:false,pixel_length:10,stroke_width:1}],coverage:{status:'not_verified'},semantics:'not_verified',quality_accepted:false};
 const work=createSourceWorklist(index,'fixture-index'),item=index.items[0]!,state=work.items.path_a!;state.status='committed';state.entity_ids=[1];state.operation_ids=['draw'];const op=sourceItemOperation(index,item,state),args=op.arguments as any;
 const entities=[{object_id:1,type:'AcDb2dPolyline',coordinates:args.points.flat(),coordinate_dimension:3,closed:false,normal:[0,0,1],elevation:0,constant_width:fault==='geometry'?0:args.width,bulges:[0,0]}];
 const operations:any[]=[{operation_id:'new',tool:'new_drawing',outcome:'committed'},{operation_id:'draw',tool:'draw_polyline',outcome:fault==='unknown'?'unknown':'committed',created_entity_ids:[1],request_arguments_sha256:cadRequestDigest(op.tool,op.arguments)}];
 let reads=0,models=0,ended=0;const persisted:any[]=[];
 const facts=()=>({frozen:false,local_connection_id:fault==='connection'?'other':'same',scratch:'owned.dwg',operations,native_target:{instance_id:'instance',document_id:'document'},session_counts:{committed:2,unknown:fault==='unknown'?1:0}});
 const owner={workspace:process.cwd(),facts,taskScope:()=>({owned:true,new_drawing_confirmed:true,geometry_confirmed:true}),async snapshot(){reads++;return {document:'owned.dwg',entities,observed_at:new Date().toISOString()};},endTask(){ended++;},definitions:()=>[]};
 const runtime={enableTaskBudget(){},reviewStats:()=>({capture_attempts:0,model_calls:0}),budgetState:()=>({}),completed:()=>[],restoreTaskBudget(){},async indexReferenceSource(){return {available:true,index,path:'fixture-index'};},async run(){models++;throw Error('FIXTURE_STOP_AFTER_RECONCILIATION');}};
 const resume:any={task_id:'task',original_request:task,request_sha256:requestHash,round:0,failure:{code:'QUOTA',source:'model'},execution:{local_connection_id:'same',scratch:'owned.dwg'},progressive:{version:1,source_sha256:sha,scope_sha256:requestHash,plan:null,plan_sha256:null,active_region:null,regions:[],connection:'same',document:'owned.dwg',observed_sha256:'older-checkpoint',confirmed_operation_ids:['new'],resume_count:0,source_worklist:work}};
 const result=await runProgressiveTask({runtime,owner,root:process.cwd(),profile:'MainAgent',task,resume,referenceTask:{request:task,image:{path:imagePath,sha256:sha,width:image.width,height:image.height},outputPath:'.cader/tests/not-written.dwg',freshDrawing:true},emit(){},persist:async(s:unknown)=>{persisted.push(structuredClone(s));}} as never);
 assert.equal(result.quality_accepted,false);assert.equal(ended,1);assert.equal(work.items.path_a!.status,'committed');assert.equal(operations.length,2);
 if(fault==='none'){assert.ok(persisted.some(s=>s.progressive.resume_reconciliations?.length===1));assert.deepEqual(result.progressive!.confirmed_operation_ids,['new','draw']);assert.equal(result.progressive!.observed_sha256,sourceDigest(entities));assert.equal(models,1);}
 else{assert.equal(models,0);assert.equal(result.progressive!.resume_reconciliations,undefined);assert.match(result.failure!.code,fault==='connection'?/CONTINUATION_BINDING_CHANGED/:fault==='unknown'?/SOURCE_RESUME_UNKNOWN_OUTCOME/:/SOURCE_RESUME_NATIVE_MISMATCH/);if(fault==='connection')assert.equal(reads,0);}
});
