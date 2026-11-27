import type {ReferenceIndex,SourceItem,ToolDefinition,createLiveRuntime} from '@cader/dsh-adapter';
import type {ProgressiveState,ProgressiveRegion} from './progressive.js';
import type {ExecutionSession} from './execution.js';
import type {QualityPhase} from './quality.js';
import {sourceDigest,sourceSelection,sourceItemOperation,reconcileSourceBatch,verifySourceItem,sourceItemOwner,sourceWorklistPage,sourceWorklistSummary,cadRequestDigest} from './source-worklist.js';
import {progressiveReviewScope,scopedNativeWindowContainsTargets} from './cad-review-scope.js';

type Runtime=Awaited<ReturnType<typeof createLiveRuntime>>;
type Model=(instruction:string,request?:Parameters<Runtime['run']>[2])=>Promise<Awaited<ReturnType<Runtime['run']>>>;
type Snapshot=Awaited<ReturnType<ExecutionSession['snapshot']>>;
type Review=Awaited<ReturnType<Runtime['reviewCadView']>>;
interface Context {runtime:Runtime;owner:ExecutionSession;progressive:ProgressiveState;index:ReferenceIndex;sourcePath:string;task:string;signal?:AbortSignal;model:Model;enter:(phase:QualityPhase)=>Promise<void>;persist:()=>Promise<void>;checkpoint:(reason:string)=>Promise<void>;observe:()=>Promise<Snapshot>;emit:(event:{type:string;[key:string]:unknown})=>void;onEvidenceError:(error:unknown)=>void;onVisual:(review:Review,snapshot:string)=>void;confirm?:Parameters<ExecutionSession['definitions']>[0]}

/** A Scheduler mode using the same DSH loop/serial executor/permissions/recovery.
 * Model selects item IDs and local patches. Neither OCR nor a fixed drawing
 * sequence can bypass actual native and visual verification. */
export async function runIndexedRegions(c:Context){
 const {index,progressive:p,runtime,owner}=c,work=p.source_worklist!;
 const itemMap=new Map(index.items.map(i=>[i.id,i]));
 const frame={point:([x,y]:number[])=>[x!*1000,(1-y!)*1000*index.source.height/index.source.width],toSource:([x,y]:number[])=>[x!/1000,1-y!*index.source.width/(1000*index.source.height)]};
 if(!p.document){
  // The parent supplies the already approved task's new-document callback.
  throw new Error('SOURCE_WORKLIST_REQUIRES_CONFIRMED_DOCUMENT');
 }
 const definitions=owner.definitions(c.confirm),names=definitions.map(t=>t.name);
 for(const region of p.regions){
  const stopped=runtime.executionStop();if(stopped)throw new Error(stopped);
  if(region.status==='verified')continue;
  p.active_region=region.id;region.status='drawing';region.failure=null;await c.persist();
  const tile=Number(region.id.replace('source_tile_','')),local=index.items.filter(i=>sourceItemOwner(index,i)===tile),localIds=new Set(local.map(i=>i.id));
  let idle=0;
  const read=()=>c.observe();
  const sync=async()=>{reconcileSourceBatch(work,owner.facts().operations);await c.persist();};
  const afterBatch=async()=>{
   await sync();const snapshot=await read(),active=work.active_batch;
   const selected=active?active.ids.filter(id=>work.items[id]!.status==='committed').map(id=>itemMap.get(id)!):local.filter(i=>work.items[i.id]!.entity_ids.length&&work.items[i.id]!.status!=='verified');
   if(!selected.length)return;
   const checks=selected.flatMap(i=>verifySourceItem(index,i,work.items[i.id]!,snapshot.entities));region.checks=checks;
   c.emit({type:'source.native_checks',region:region.id,checks});
   if(checks.some(check=>check.status!=='pass')){region.status='repairing';await c.checkpoint('source_native_geometry_pending');throw new Error('SOURCE_BATCH_NATIVE_CHECK_FAILED');}
   const entities=snapshot.entities.filter(e=>selected.some(i=>work.items[i.id]!.entity_ids.includes(e.object_id)));
   if(!entities.length)throw new Error('SOURCE_BATCH_NATIVE_ENTITIES_MISSING');
   const descriptor=p.plan!.regions.find(r=>r.id===region.id)!;
   const scoped=progressiveReviewScope({region:region.id,mode:'affected-batch',document:owner.facts().native_target,snapshot_hash:sourceDigest(snapshot.entities),source_sha256:index.source.sha256,entities,bounds:[[0,0],[1000,1000*index.source.height/index.source.width]],image:index.source,source_bounds:[[0,0],[1,1]],toSource:frame.toSource});
   const requirements=[{id:'indexed_batch_fidelity',description:'只核对本批列出的已提交源图元和字面文字：实际轮廓、相对位置、线宽及文字可读性与对应源像素一致。未选中部分仍在待办，不是本批缺陷。字体文件名、原CAD实体类名和未知功能不是本次要求；实际可见形状、文字和图形关系不可豁免。'}];
   await c.enter('vision');runtime.setVerificationScope('source-batch:'+region.id+':'+region.batches.length);
   const question=JSON.stringify({review_scope:scoped.binding,original_request:c.task,requirements,entity_snapshot:entities,source_item_ids:selected.map(i=>i.id),source_evidence:selected.map(i=>({id:i.id,reading:work.items[i.id]!.source_evidence})),verification_scope:'indexed-source-batch',note:'Actual source and native rendered result. Local graphical fidelity only; complete coverage and global connectivity are separate mandatory checks.'});
   const previous=region.batches.at(-1),reuse=previous?.state_sha256===sourceDigest(snapshot.entities)&&sourceDigest(previous.entity_ids)===sourceDigest(entities.map(e=>e.object_id))&&previous.review&&await runtime.isCadReviewCurrent(previous.review);
   const review=reuse&&previous.review?.structured?.verdict==='pass'?previous.review:reuse&&previous.review&&(!previous.review.review_valid||previous.review.structured?.verdict==='uncertain')?await runtime.reassessCadView(question,previous.review.image_ref,c.signal,c.sourcePath,undefined,scoped.view):await runtime.reviewCadView(question,c.signal,c.sourcePath,undefined,scoped.view);
   c.onVisual(review,sourceDigest(snapshot.entities));
   const clipping=(review.evidence as any)?.image_bounds?.possible_clipping;
   const valid=review.review_valid&&review.structured?.verdict==='pass'&&(!clipping||scopedNativeWindowContainsTargets(review.evidence));
   const batch={id:region.id+'-source-'+(region.batches.length+1),operation_ids:selected.flatMap(i=>work.items[i.id]!.operation_ids),entity_ids:entities.map(e=>e.object_id),state_sha256:sourceDigest(snapshot.entities),checks,status:valid?'pass' as const:'fail' as const,review};region.batches.push(batch);
   for(const item of selected){const state=work.items[item.id]!;state.native_checks=checks.filter(v=>v.id==='source_'+item.id).map(v=>({...v,evidence:sourceDigest(v)}));state.visual_evidence={scope_id:scoped.binding.id,image_ref:review.image_ref,evidence_sha256:sourceDigest(review.evidence),report_sha256:sourceDigest(review.structured)};if(valid)state.status='verified';}
   region.entity_ids=[...new Set(local.flatMap(i=>work.items[i.id]!.entity_ids))];
   await c.checkpoint('indexed_batch_verified');c.emit({type:'task.batch_verified',region:region.id,batch:batch.id,status:batch.status});
   if(!valid){region.status='repairing';throw new Error('SOURCE_BATCH_VISUAL_PENDING');}
   region.status='drawing';await c.enter('drawing');
  };
  const finishRegion=async()=>{
   const remaining=local.filter(i=>work.items[i.id]!.status!=='verified');if(remaining.length)throw new Error('SOURCE_REGION_HAS_PENDING_ITEMS: '+JSON.stringify({counts:sourceWorklistSummary(index,work).counts,remaining:remaining.slice(0,32).map(i=>({id:i.id,status:work.items[i.id]!.status,entity_ids:work.items[i.id]!.entity_ids}))}));
   const snapshot=await read();region.entity_ids=[...new Set(local.flatMap(i=>work.items[i.id]!.entity_ids))];
   const checks=local.flatMap(i=>verifySourceItem(index,i,work.items[i.id]!,snapshot.entities));if(checks.some(v=>v.status!=='pass')){region.checks=checks;throw new Error('SOURCE_REGION_NATIVE_CHANGED');}
   region.status='verified';region.failure=null;region.final_sha256=sourceDigest(snapshot.entities.filter(e=>region.entity_ids.includes(e.object_id)));await c.checkpoint('indexed_region_verified');
  };
  const pageTool:ToolDefinition={name:'cader_source_worklist',description:'Read remaining stable source IDs in this region, with exact progress and existing native ownership. Optional cursor pages a frozen source list. This is not a whole-image recount.',parameters:{type:'object',properties:{cursor:{type:'integer',minimum:0}},additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args){return JSON.stringify(sourceWorklistPage(index,work,tile,(args as {cursor?:number}).cursor??0));}};
  const finish:ToolDefinition={name:'cader_finish_drawing_unit',description:'Request complete verification of all source IDs in the CURRENT region. Missing IDs cannot pass, and this cannot complete the entire drawing.',parameters:{type:'object',properties:{unit_id:{const:region.id,type:'string'}},required:['unit_id'],additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(_args,exec){await finishRegion();exec.concludeTurn();return JSON.stringify({region:region.id,verified:true,task_complete:false});}};
  const sourceBatch={
   async compile(ids:string[],callId:string){
    if(ids.some(id=>!localIds.has(id)))throw new Error('SOURCE_BATCH_REGION_OWNERSHIP_REQUIRED');
    const items=sourceSelection(index,work,ids),unread=items.filter(i=>work.items[i.id]!.status==='pending');
    if(unread.length){
     await c.enter('reference');runtime.setVerificationScope('source-read:'+region.id+':'+work.rounds++);
     let report:Awaited<ReturnType<Runtime['reviewIndexedSource']>>;
     try{report=await runtime.reviewIndexedSource(c.sourcePath,index,unread,c.task,c.signal);}catch(error){c.onEvidenceError(error);throw error;}
     c.emit({type:'source.items_reviewed',region:region.id,report});
     for(const row of report.items){const state=work.items[row.id]!;state.source_evidence={source_sha256:report.source_sha256,view:report.view,attempt_ids:report.attempts.map(a=>a.id),reading:row};state.status=row.status==='clear'?'accepted':'uncertain';if(row.text!==null)state.text=row.text;if(row.rotation!==null)state.rotation=row.rotation;}
     await c.persist();
    }
    const blocked=items.filter(i=>work.items[i.id]!.status!=='accepted');if(blocked.length)throw new Error('SOURCE_BATCH_NOT_FULLY_ACCEPTED: '+JSON.stringify({accepted:items.filter(i=>work.items[i.id]!.status==='accepted').map(i=>i.id),unresolved:blocked.map(i=>({id:i.id,evidence:work.items[i.id]!.source_evidence})),next:'Select accepted IDs; preserve unresolved facts for bounded clarification, never repeat the entire source inventory.'}));
    const operations=items.map(i=>sourceItemOperation(index,i,work.items[i.id]!));work.active_batch={root_call_id:callId,ids,operation_mark:owner.facts().operations.length,arguments_sha256:operations.map(o=>cadRequestDigest(o.tool,o.arguments))};await c.persist();await c.enter('drawing');return {operations};
   },
   async settled(){await sync();work.active_batch=null;await c.persist();}
  };
  const beforeCad=async(name:string,args:unknown)=>{
   const tool=name.split('__').at(-1)!,a=args as Record<string,unknown>;
   if(tool==='create_layer'&&['CADER_SOURCE_GEOMETRY','CADER_SOURCE_TEXT'].includes(String(a.name)))return;
   if(['draw_polyline','draw_text'].includes(tool)){
    if(!work.active_batch||!work.active_batch.ids.some(id=>sourceDigest(sourceItemOperation(index,itemMap.get(id)!,work.items[id]!).arguments)===sourceDigest(a)))throw new Error('SOURCE_ITEM_ID_EXECUTION_REQUIRED');return;
   }
   if(['move_entity','rotate_entity','scale_entity'].includes(tool)){
    const item=local.find(i=>work.items[i.id]!.entity_ids.includes(Number(a.object_id)));
    if(item){const state=work.items[item.id]!;if(state.status==='verified'){state.history=[...state.history??[],{visual:state.visual_evidence,native:state.native_checks}];state.status='committed';await c.persist();}return;}
   }
   throw new Error('SOURCE_REGION_WRITE_NOT_AUTHORIZED');
  };
  for(;;){
   const stopped=runtime.executionStop();if(stopped)throw new Error(stopped);
   if(local.every(i=>work.items[i.id]!.status==='verified')){await finishRegion();break;}
   if(local.every(i=>['verified','uncertain','unknown'].includes(work.items[i.id]!.status))){region.status='blocked';region.failure='SOURCE_ITEMS_REQUIRE_CLARIFICATION';await c.persist();break;}
   const mark=owner.facts().operations.length,progress=Object.values(work.items).filter(s=>s.status==='verified').length;
   await c.enter(region.status==='repairing'?'correcting':'drawing');
   const result=await c.model('使用中文。根据当前工作清单自主选择源图ID并实际绘制，不重新清点全图、不手抄坐标、不重放已确认项。先用create_layer创建CADER_SOURCE_GEOMETRY、CADER_SOURCE_TEXT（已有则复用）；cader_apply_source_batch接受本区最多32个ID，程序复用原Patch预检/权限/预算和串行MCP，自动源复核、原生读回及视觉检查。若文字与路径跨度过大可拆批。源图不可辨项保持待确认，可继续其他accepted/pending项；不要重复提交同一uncertain集合。已提交但待验项用cader_review_cad_view交回受控检查；具体几何失败用本区局部移动/旋转/缩放patch，不删除重建全图。所有ID通过后调用cader_finish_drawing_unit；任务完整性由全图独立验收决定。'+JSON.stringify({task:c.task,region:p.plan!.regions.find(r=>r.id===region.id),worklist:sourceWorklistPage(index,work,tile),checks:region.checks,last_visual:region.batches.at(-1)?.review?.structured}),{cadAction:true,image:c.sourcePath,imageView:{crop:{left:index.tiles[tile]!.view[0],top:index.tiles[tile]!.view[1],width:index.tiles[tile]!.view[2]-index.tiles[tile]!.view[0],height:index.tiles[tile]!.view[3]-index.tiles[tile]!.view[1]}},maxImageViews:2,onlyTools:[...names.filter(n=>/__(?:draw_polyline|draw_text|create_layer|move_entity|rotate_entity|scale_entity|get_entity)$/.test(n)),'cader_apply_cad_patch','cader_review_cad_view','cader_view_image',pageTool.name,finish.name],extraTools:[pageTool,finish],sourceBatch,beforeCadOperation:beforeCad,afterCadBatch:afterBatch,controlledReview:async()=>{await afterBatch();const review=region.batches.at(-1)?.review;if(!review)throw new Error('SOURCE_BATCH_VISUAL_EVIDENCE_MISSING');return review;},reviewEndsTurn:true,schedulerStepSlice:12,completeDrawingUnit:finishRegion});
   if(owner.facts().frozen)throw new Error('CAD_WRITE_FROZEN');
   if((region as ProgressiveRegion).status==='verified')break;
   const now=Object.values(work.items).filter(s=>s.status==='verified').length;
   if(mark===owner.facts().operations.length&&now===progress){if(++idle>=3){region.status='blocked';region.failure='SOURCE_REGION_NO_PROGRESS';await c.persist();break;}}else idle=0;
   if(result.handoff?.kind==='verification'&&region.batches.at(-1)?.status==='fail'){
    if(++region.repairs>=3){region.status='blocked';region.failure='REGION_REPAIR_LIMIT';await c.persist();break;}
    region.status='repairing';
   }
  }
  c.emit({type:'task.region',region:region.id,status:region.status,failure:region.failure,entities:region.entity_ids.length,batches:region.batches.length});
 }
 p.active_region=null;
}
