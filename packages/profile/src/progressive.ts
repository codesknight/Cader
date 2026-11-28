import {createHash,randomUUID} from 'node:crypto';
import {readReferenceImage,parseAcceptancePlan,acceptancePlanSchema,parseProgressivePlan,progressivePlanSchema,rasterizeProgressivePlan,parseProgressivePartition,progressivePartitionSchema} from '@cader/config';
import type {QualityPlan,ProgressivePlanData,ReferenceObservationData} from '@cader/config';
import type {ToolDefinition,createLiveRuntime,ImageView} from '@cader/dsh-adapter';
import {sourceCoordinates} from '@cader/dsh-adapter';
import type {ReferenceIndex} from '@cader/dsh-adapter';
import {createSourceWorklist,assertSourceWorklist,sourceWorklistSummary,verifySourceGraph,verifySourceCheckpoint} from './source-worklist.js';
import type {SourceWorklist} from './source-worklist.js';
import {runIndexedRegions} from './indexed-regions.js';
import {verifyQuality,qualityTaskContext} from './quality.js';
import type {runQualityTask,CheckResult,QualityPhase} from './quality.js';
import {sourcePlanLayout,referenceLayoutHints,referencePlanHints,referencedPaths,referenceOutput} from './reference-input.js';
import {verifyNetlist} from './netlist.js';
import {draftCadTrace,validateDraftOperation,verifyDraftGeometry,draftAcceptancePlan} from './progressive-draft.js';
import {progressiveReviewScope,scopedNativeWindowContainsTargets} from './cad-review-scope.js';

type Runtime=Awaited<ReturnType<typeof createLiveRuntime>>;
type Observation=Awaited<ReturnType<Runtime['inspectReference']>>;
type Review=Awaited<ReturnType<Runtime['reviewCadView']>>;
type Options=Parameters<typeof runQualityTask>[0];
type Entity=Record<string,any>;
type Box=[[number,number],[number,number]];
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)??'undefined').digest('hex');
const same=(a:unknown,b:unknown)=>digest(a)===digest(b);
const layerKey=(name:unknown)=>String(name).toLowerCase();
export function canReuseValidatedObservation(token:{snapshot:unknown;mark:number;connection:unknown;target:string}|null,candidate:unknown,current:{frozen:boolean;mark:number;connection:unknown;target:string;document:unknown;maxAgeMs?:number}){
  const age=candidate&&typeof candidate==='object'?Date.now()-Date.parse((candidate as {observed_at?:string}).observed_at??''):NaN;
  return Boolean(token&&candidate&&typeof candidate==='object'&&(current.maxAgeMs===undefined||Number.isFinite(age)&&age>=0&&age<=current.maxAgeMs)&&(!(candidate as {scope?:string}).scope||(candidate as {scope?:string}).scope==='full_document')&&token.snapshot===candidate&&!current.frozen&&token.mark===current.mark&&token.connection===current.connection&&token.target===current.target&&(candidate as {document?:unknown}).document===current.document);
}
const taskStops=new Set(['SOURCE_RESIDUAL_HELPER_FAILED','SOURCE_HELPER_RESOURCE_EXHAUSTED','TASK_TOOL_BUDGET_EXCEEDED','TASK_CAD_BUDGET_EXCEEDED','TASK_TOKEN_BUDGET_EXCEEDED','MODEL_STEP_BUDGET_EXCEEDED','EXECUTION_ROUND_LIMIT','CANCELLED_OR_TIMEOUT','CONTINUATION_BINDING_CHANGED','TRUNCATION_RECOVERY_UNSAFE','CHECKPOINT_READBACK_FAILED','CHECKPOINT_PERSIST_FAILED','REFERENCE_CHANGED_RESELECT_REQUIRED','PROGRESSIVE_CHECKPOINT_CHANGED','PROGRESSIVE_LEDGER_CHANGED','QUOTA','HTTP_401','HTTP_403','AUTHENTICATION_ERROR','TRANSPORT','TIMEOUT','SERVER','RATE_LIMIT','AUTH','INVALID_REQUEST','PI_AI_ERROR','CONTEXT_WINDOW_EXCEEDED','EMPTY_RESPONSE']);
const providerFailureCodes=new Set(['TRANSPORT','TIMEOUT','SERVER','RATE_LIMIT','AUTH','INVALID_REQUEST','PI_AI_ERROR','CONTEXT_WINDOW_EXCEEDED','EMPTY_RESPONSE','QUOTA','HTTP_401','HTTP_403','AUTHENTICATION_ERROR']);
const inside=(point:number[],bounds:Box,tolerance=0.015)=>point.slice(0,2).every((p,i)=>p>=bounds[0][i]!-tolerance&&p<=bounds[1][i]!+tolerance);
export function progressiveFrame(plan:ProgressivePlanData,image:{width:number;height:number}){
  const [a,b]=plan.content_bounds,scale=1000/(b[0]-a[0]);
  const point=(p:number[])=>[Number(((p[0]!-a[0])*scale).toFixed(3)),Number(((b[1]-p[1]!)*scale*image.height/image.width).toFixed(3))];
  return {point,toSource:(p:number[])=>[a[0]+p[0]!/scale,b[1]-p[1]!/(scale*image.height/image.width)],box:(bounds:Box):Box=>[point([bounds[0][0],bounds[1][1]]) as [number,number],point([bounds[1][0],bounds[0][1]]) as [number,number]],units:'Relative image layout, not inferred physical dimensions'};
}
export interface ProgressiveRegion {
  id:string;status:'pending'|'observing'|'ready'|'drawing'|'repairing'|'verified'|'partial_verified'|'blocked';failure:string|null;
  draft_source?:Awaited<ReturnType<Runtime['inspectProgressiveDraft']>>;
  draft_plan_history?:QualityPlan[];
  verification_errors?:{stage:string;error:string;at:string}[];
  source_history?:{source?:Observation;draft_source?:ProgressiveRegion['draft_source'];plan?:QualityPlan;failure:string|null}[];
  source?:Observation;plan?:QualityPlan;entity_ids:number[];boundary_links:{anchor:string;net:string;certainty:'clear'|'uncertain';evidence:string}[];
  batches:{id:string;operation_ids:string[];entity_ids:number[];state_sha256:string;checks:CheckResult[];review?:Review;review_history?:Review[];status:'pass'|'fail'|'pending';recovered_by?:string}[];
  repairs:number;final_sha256?:string;last_review?:Review;checks?:CheckResult[];
  uncertainty_review?:{index:number;disposition:'local_required'|'cross_region'|'out_of_request';feature:'drawing_fidelity'|'physical_scale'|'source_entity_class'|'source_file_format';anchor_ids:string[];evidence:string}[];
}
export interface ProgressiveState {
  version:1;source_sha256:string|null;scope_sha256:string;plan:ProgressivePlanData|null;plan_sha256:string|null;
  active_region:string|null;regions:ProgressiveRegion[];connection:string|null;document:string|null;
  observed_sha256:string|null;confirmed_operation_ids:string[];resume_count:number;
  decompositions?:{parent:string;children:string[];reason:string;source?:Observation}[];
  last_tool_error?:{tool:string;message:string};
  source_worklist?:SourceWorklist;
}

/** Deterministic batch checks run on actual affected entities. They do not
 * demand not-yet-built regions and do not count a bounding box as topology. */
export function verifyProgressiveBatch(entities:Entity[],bounds:Box,prior:Entity[]=[]):CheckResult[]{
  const outside=entities.filter(e=>!e.bounding_box||!inside(e.bounding_box.min,bounds)||!inside(e.bounding_box.max,bounds));
  const geometry=(e:Entity)=>{
    if(e.type==='AcDbLine'&&e.start_point&&e.end_point)return JSON.stringify([e.type,e.layer,[e.start_point,e.end_point].map(p=>JSON.stringify(p)).sort()]);
    if(e.type==='AcDbCircle')return JSON.stringify([e.type,e.layer,e.center,e.radius]);
    if(['AcDbText','AcDbMText'].includes(e.type))return JSON.stringify([e.type,e.layer,e.text_string,e.bounding_box]);
    // A legacy polyline/hatch bounding box is not a geometry fingerprint.
    return JSON.stringify([e.type,e.object_id]);
  };
  const duplicates=entities.filter((e,i)=>[...prior,...entities.slice(0,i)].some(p=>p.object_id!==e.object_id&&geometry(e)===geometry(p)));
  return [{id:'batch_bounds',status:outside.length?'fail':'pass',evidence:JSON.stringify({outside_ids:outside.map(e=>e.object_id),bounds})},
    {id:'batch_duplicates',status:duplicates.length?'fail':'pass',evidence:JSON.stringify({duplicate_ids:duplicates.map(e=>e.object_id)})}];
}

/** Reuses DSH runtime, ExecutionSession authority/journal and existing native
 * readback/vision/file verifiers. This is a task scheduler, not an AgentLoop. */
export async function runProgressiveTask(options:Options):Promise<Awaited<ReturnType<typeof runQualityTask>>>{
  const {runtime,owner,task,signal}=options,reference=options.referenceTask??options.resume?.reference_task??undefined;
  const taskId=options.resume?.task_id??randomUUID(),requestHash=createHash('sha256').update(task).digest('hex');
  const outputPath=reference?.outputPath??(referencedPaths(task,'dwg').length?referenceOutput(owner.workspace,task,'drawing.png'):undefined);
  const image=reference?.image??{width:1000,height:1000};
  const plan:QualityPlan={version:1,domain:'generic',components:[],visual_required:true,requirements:[
    {id:'fresh_document',check:'new_document',source_quote:task.slice(0,800),description:'本任务新建工作图，不接管旧图'},
    {id:'global_fidelity',check:'visual',source_quote:task.slice(0,800),description:'全部请求范围、外观和跨区连接完整复现；局部通过不能代替整体验收'}]};
  let phase:QualityPhase='planning',round=0,accepted=false,authorized=false,persistFailed=false,failure:Awaited<ReturnType<typeof runQualityTask>>['failure']=null;
  let artifact:Awaited<ReturnType<typeof runQualityTask>>['artifact']=null;
  let checks:CheckResult[]=[],visual:Review|null=null;
  let visualError:string|null=null;
  let evidenceFailure:string|null=null;
  let sourceIndex:ReferenceIndex|undefined;
  const assertEvidenceOutcome=(result:{errorCode?:string;valid?:boolean;review_valid?:boolean;attempts?:{id:string}[]})=>{
    if(result.valid===true||result.review_valid===true)return;
    const ids=new Set(result.attempts?.map(a=>a.id)??[]);
    const code=result.errorCode??runtime?.completed().find(r=>ids.has(r.id)&&r.status!=='succeeded'&&!r.recovered_by&&taskStops.has(r.errorCode??''))?.errorCode;
    if(code&&taskStops.has(code)){evidenceFailure=code;throw new Error(code);}
  };
  const visualCalls:{source:'agent'|'harness';observed_state_hash:string;review:Review}[]=structuredClone(options.resume?.visual_calls??[]);
  const priorCaptures=options.resume?.visual_attempt_count??visualCalls.length,priorVisualModels=options.resume?.visual_model_call_count??0;
  const modelRuns:{phase:QualityPhase;status:string;text:string;tools:string[];error_code?:string;handoff?:unknown}[]=structuredClone(options.resume?.model_runs??[]),transitions:{phase:QualityPhase;at:string}[]=structuredClone(options.resume?.transitions??[]),checkpoints:unknown[]=structuredClone(options.resume?.checkpoints??[]);
  const progressive:ProgressiveState=structuredClone(options.resume?.progressive??{version:1,source_sha256:reference?.image.sha256??null,scope_sha256:requestHash,plan:null,plan_sha256:null,active_region:null,regions:[],connection:null,document:null,observed_sha256:null,confirmed_operation_ids:[],resume_count:0});
  const state=()=>({version:1,task_id:taskId,phase,original_request:task,request_sha256:requestHash,plan,round,checks,visual,reviews:[],visual_calls:visualCalls,
    visual_attempt_count:priorCaptures+(runtime?.reviewStats().capture_attempts??0),visual_model_call_count:priorVisualModels+(runtime?.reviewStats().model_calls??0),visual_error:visualError,
    transitions,failure,reference_task:reference??null,reference_observation:null,label_confirmations:[],unconfirmed_label_reviews:[],connection_confirmations:[],unconfirmed_connection_reviews:[],artifact,
    quality_accepted:accepted&&phase==='complete',model_runs:modelRuns,checkpoints,drawing_units:[],active_drawing_unit:null,active_planning_unit:null,planning_units:[],source_layout:null,source_frame:null,budget:runtime?.budgetState(),execution:owner.facts(),progressive});
  const persist=async()=>{try{options.onState?.(qualityTaskContext(state()));await options.persist(state());}catch{persistFailed=true;throw new Error('CHECKPOINT_PERSIST_FAILED');}};
  const enter=async(next:QualityPhase)=>{phase=next;transitions.push({phase,at:new Date().toISOString()});options.emit({type:'task.phase',phase,region:progressive.active_region,round});await persist();};
  const assertSource=async()=>{signal?.throwIfAborted();if(persistFailed)throw new Error('CHECKPOINT_PERSIST_FAILED');if(evidenceFailure)throw new Error(evidenceFailure);if(owner.facts().frozen)throw new Error('CAD_WRITE_FROZEN');
    if(reference){const actual=await readReferenceImage(owner.workspace,reference.image.path);if(createHash('sha256').update(actual.data).digest('hex')!==reference.image.sha256)throw new Error('REFERENCE_CHANGED_RESELECT_REQUIRED');}};
  let lastObservation:{snapshot:Awaited<ReturnType<typeof owner.snapshot>>;mark:number;connection:string|null;target:string}|null=null;
  const observe=async(entityIds?:readonly number[])=>{
    await assertSource();const facts=owner.facts(),scope=owner.taskScope(taskId);
    if(!scope.owned||!scope.new_drawing_confirmed||facts.local_connection_id!==progressive.connection||facts.scratch!==progressive.document)throw new Error('CONTINUATION_BINDING_CHANGED');
    let snapshot:Awaited<ReturnType<typeof owner.snapshot>>;
    try{snapshot=await owner.snapshot(entityIds);}catch(error){progressive.last_tool_error={tool:'Scheduler.readback',message:(error as Error).message.slice(0,6000)};throw new Error('CHECKPOINT_READBACK_FAILED');}
    if(snapshot.document!==facts.scratch)throw new Error('CONTINUATION_BINDING_CHANGED');
    const current=owner.facts();if(!entityIds)lastObservation={snapshot,mark:current.operations.length,connection:current.local_connection_id,target:digest(current.native_target)};
    return snapshot;
  };
  const checkpoint=async(reason:string,verifiedObservation?:Awaited<ReturnType<typeof owner.snapshot>>)=>{
    let reused=false,observedAt:string|undefined;
    if(owner.taskScope(taskId).new_drawing_confirmed){const facts=owner.facts(),budgetCandidate=reason==='EXECUTION_ROUND_EXHAUSTED'&&!verifiedObservation?lastObservation?.snapshot:undefined,candidate=verifiedObservation??budgetCandidate;reused=canReuseValidatedObservation(lastObservation,candidate,{frozen:facts.frozen,mark:facts.operations.length,connection:facts.local_connection_id,target:digest(facts.native_target),document:progressive.document,...budgetCandidate?{maxAgeMs:5000}:{}});const snapshot=reused?candidate!:await observe();
      if(sourceIndex&&progressive.source_worklist){const result=verifySourceCheckpoint(sourceIndex,progressive.source_worklist,snapshot.entities);if(!result.ok)throw new Error('SOURCE_CHECKPOINT_NATIVE_MISMATCH: '+JSON.stringify(result));}
      progressive.observed_sha256=digest(snapshot.entities);observedAt=snapshot.observed_at;}
    progressive.confirmed_operation_ids=owner.facts().operations.filter(op=>op.outcome==='committed').map(op=>op.operation_id);
    checkpoints.push({reason,reused_observation:reused,observed_at:observedAt,region:progressive.active_region,connection:progressive.connection,document:progressive.document,observed_sha256:progressive.observed_sha256,operation_ids:[...progressive.confirmed_operation_ids]});await persist();
  };
  const observeRecentFull=async()=>{await assertSource();const facts=owner.facts(),candidate=lastObservation?.snapshot;
    return canReuseValidatedObservation(lastObservation,candidate,{frozen:facts.frozen,mark:facts.operations.length,connection:facts.local_connection_id,target:digest(facts.native_target),document:progressive.document,maxAgeMs:5000})?candidate!:observe();};
  const model=async(instruction:string,request:Parameters<Runtime['run']>[2]={})=>{
    if(!runtime)throw new Error('QUALITY_RUNTIME_REQUIRED');
    let continuation=false,retries=0,submitted=false;const interrupted:string[]=[];
    const stageTools=request?.extraTools?.map(tool=>({...tool,async execute(args:unknown,exec:Parameters<ToolDefinition['execute']>[1]){try{const value=await tool.execute(args,exec);submitted=true;return value;}catch(error){progressive.last_tool_error={tool:tool.name,message:(error as Error).message.slice(0,6000)};await persist();throw error;}}}));
    for(;;){
      await assertSource();if(evidenceFailure)throw new Error(evidenceFailure);
      const diagnostic:ToolDefinition={name:'cader_quality_diagnostics',description:'Read sanitized current-task scope, region failures, native checks and permitted next actions. No private-path access, writes, approval or barrier changes.',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){const active=progressive.regions.find(r=>r.id===progressive.active_region);return JSON.stringify({task:qualityTaskContext(state()),active_region:active?{id:active.id,status:active.status,failure:active.failure,checks:progressive.source_worklist?{passed:active.checks?.filter(c=>c.status==='pass').length??0,failures:active.checks?.filter(c=>c.status!=='pass').slice(0,8)}:active.checks,last_batch:progressive.source_worklist?(()=>{const b=active.batches.at(-1),r=b?.review_history?.at(-1)??b?.review;return b?{id:b.id,status:b.status,entity_ids:b.entity_ids,state_sha256:b.state_sha256,review:r?{image_ref:r.image_ref,review_valid:r.review_valid,verdict:r.structured?.verdict,defects:r.structured?.defects}:null,full_evidence:'Private batch/native manifest; not copied into model context'}:null;})():active.batches.at(-1),confirmed_entity_ids:active.entity_ids}:null,next_actions:owner.facts().frozen?['read-only reconciliation, never replay unknown writes']:['inspect current region evidence','repair owned entities','submit current unit for verification']});}};
      const result=await runtime.run(options.profile,instruction,{...options.request,...request,keepExecutionRound:request?.keepExecutionRound??true,resultText:request?.resultText??(()=>submitted?'当前阶段已提交受控数据，交回Scheduler；不代表绘图完成。':undefined),extraTools:[...stageTools??[],diagnostic],onlyTools:request?.onlyTools?[...request.onlyTools,diagnostic.name,'cader_load_skill']:undefined,skill:'progressive-drawing',skillResource:continuation?'checkpoint-and-recovery':['drawing','correcting'].includes(phase)?'verification-and-repair':'task-decomposition',harnessTask:true,progressiveStep:true,taskState:()=>qualityTaskContext(state()),signal,continuePending:continuation});
      if(evidenceFailure)throw new Error(evidenceFailure);
      modelRuns.push({phase,status:result.status,text:result.public_text??result.text,tools:result.tools,error_code:result.errorCode,handoff:result.handoff});await persist();
      if(result.handoff?.kind==='budget'){
        await checkpoint(result.handoff.code);if(!result.handoff.renewable)throw new Error(result.handoff.code);continuation=true;continue;
      }
      if(result.handoff?.kind==='verification')return result;
      if(result.status!=='succeeded'){
        if(phase==='planning'&&['INVOCATION_MODEL_STEP_BUDGET_EXCEEDED','OUTPUT_TRUNCATED','MALFORMED_RESPONSE','TIMEOUT'].includes(result.errorCode??'')&&retries++<1&&!signal?.aborted){interrupted.push(result.id);await checkpoint('planning_schema_repair');instruction+='\n上次规划阶段未按约束修复或响应中断。只立即提交紧凑结构数据，不推演几何、不读取私有目录。以下是本任务错误及字段：'+JSON.stringify(progressive.last_tool_error??null);continue;}
        if(['OUTPUT_TRUNCATED','TIMEOUT','MALFORMED_RESPONSE'].includes(result.errorCode??'')&&retries++<2&&!signal?.aborted&&['drawing','correcting'].includes(phase)){
          await checkpoint(result.errorCode!);const scope=owner.taskScope(taskId),snapshot=scope.new_drawing_confirmed?await observe():null;instruction+='\n响应中断，不能拼接JSON或重放。仅补本区域尚缺内容；新图未确认则只能继续首次new_drawing请求，已确认则禁止再次新建。以下为程序账本及读回：'+JSON.stringify({new_document_confirmed:scope.new_drawing_confirmed,operation_ids:progressive.confirmed_operation_ids,entities:snapshot?.entities??null});continuation=false;continue;
        }
        throw new Error(result.errorCode??'PROGRESSIVE_AGENT_FAILED');
      }
      if(submitted)for(const id of interrupted){const failed=runtime.completed().find(r=>r.id===id);if(failed)failed.recovered_by=result.id;}
      return result;
    }
  };
  const crop=(bounds:Box):ImageView=>({crop:{left:Math.round(bounds[0][0]*image.width),top:Math.round(bounds[0][1]*image.height),width:Math.round(bounds[1][0]*image.width)-Math.round(bounds[0][0]*image.width),height:Math.round(bounds[1][1]*image.height)-Math.round(bounds[0][1]*image.height)}});
  const emitRegion=(r:ProgressiveRegion)=>options.emit({type:'task.region',region:r.id,status:r.status,failure:r.failure,entities:r.entity_ids.length,batches:r.batches.length});
  try{
    if(!runtime)throw new Error('QUALITY_RUNTIME_REQUIRED');runtime.enableTaskBudget();await assertSource();
    if(options.resume){
      if(options.resume.request_sha256!==requestHash||progressive.scope_sha256!==requestHash||progressive.source_sha256!==(reference?.image.sha256??null)||(progressive.plan?progressive.plan_sha256!==digest(progressive.plan):progressive.plan_sha256!==null)||options.resume.execution.local_connection_id!==owner.facts().local_connection_id||options.resume.execution.scratch!==owner.facts().scratch)throw new Error('CONTINUATION_BINDING_CHANGED');
      if(progressive.document){const snapshot=await observe();if(progressive.observed_sha256!==digest(snapshot.entities))throw new Error('PROGRESSIVE_CHECKPOINT_CHANGED');
        const actual=owner.facts().operations.filter(op=>op.outcome==='committed').map(op=>op.operation_id);if(!same(actual,progressive.confirmed_operation_ids))throw new Error('PROGRESSIVE_LEDGER_CHANGED');}
      progressive.resume_count++;
      if(options.resume.budget&&runtime.restoreTaskBudget)runtime.restoreTaskBudget(options.resume.budget);
    }
    const indexedTools=owner.definitions(options.confirm),poly=indexedTools.find(t=>t.name.endsWith('__draw_polyline')),text=indexedTools.find(t=>t.name.endsWith('__draw_text'));
    const supportsIndex=Boolean((poly?.parameters as any)?.properties?.width&&(text?.parameters as any)?.properties?.fit_box);
    const semanticTask=/(?:验证|校验|核对|检查|保证|计算|分析|验算|提取|输出|生成).{0,12}(?:网表|BOM|电气性能|短路电流|功能逻辑|拓扑|连通性|连接关系|电路功能)|\b(?:netlist|BOM|simulate|electrical analysis|verify connectivity)\b/i.test(task);
    if(reference&&runtime.indexReferenceSource&&(progressive.source_worklist||!progressive.plan&&image.width*image.height>=8000000&&!semanticTask&&supportsIndex)){
      await enter('reference');const result=await runtime.indexReferenceSource(reference.image.path,signal);
      if(result.available){sourceIndex=result.index;
        if(progressive.source_worklist)assertSourceWorklist(sourceIndex,progressive.source_worklist);
        else progressive.source_worklist=createSourceWorklist(sourceIndex,result.path);
        if(!progressive.plan){
          const candidates=sourceWorklistSummary(sourceIndex,progressive.source_worklist).tiles;
          let order:string[]|undefined;
          const submit:ToolDefinition={name:'cader_order_source_regions',description:'Choose execution order of ALL frozen source ownership tiles exactly once. Overlapping perception is independent of exclusive ownership. No item inventory or geometry generation required.',parameters:{type:'object',properties:{ids:{type:'array',minItems:candidates.length,maxItems:candidates.length,uniqueItems:true,items:{type:'string',enum:candidates.map(t=>t.id)}}},required:['ids'],additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args,exec){const ids=(args as {ids:string[]}).ids;if(new Set(ids).size!==candidates.length||ids.some(id=>!candidates.some(t=>t.id===id)))throw new Error('SOURCE_REGION_ORDER_INVALID');order=ids;exec.concludeTurn();return JSON.stringify({order,semantics:'not_verified'});}};
          await model('使用中文。原图已建立只读候选索引，不是验收结论。选择所有source_tile的绘图先后顺序：请求的主要内容优先，图框和附属呈现后置。只提交cader_order_source_regions，不重新清点、不生成坐标。感知允许跨区；每个源对象由其bbox中心独占归属，跨区完整路径只画一次。'+JSON.stringify({task,tiles:candidates}),{image:reference.image.path,onlyTools:[submit.name],extraTools:[submit],maxModelSteps:3});
          if(!order)throw new Error('SOURCE_REGION_ORDER_MISSING');
          progressive.plan=parseProgressivePlan({version:1,content_bounds:[[0,0],[1,1]],units:'relative-layout-units',anchors:[],regions:order.map(id=>{const tile=sourceIndex!.tiles[Number(id.replace('source_tile_',''))]!,[x,y,a,b]=tile.owner;return {id,bounds:[[x/image.width,y/image.height],[a/image.width,b/image.height]],description:'Frozen source-ID worklist; local actual-pixel and native evidence required',depends_on:[]};})});
          progressive.plan_sha256=digest(progressive.plan);progressive.regions=progressive.plan.regions.map(r=>({id:r.id,status:'pending',failure:null,entity_ids:[],boundary_links:[],batches:[],repairs:0}));await persist();
        }
      }else if(progressive.source_worklist)throw new Error(result.reason);
      else options.emit({type:'source.index_unavailable',reason:result.reason,fallback:'existing progressive observation'});
    }
    if(!progressive.plan){
      await enter('planning');
      const submit:ToolDefinition={name:'cader_submit_progressive_plan',description:'Partition the entire requested source scope into bounded non-overlapping rectangular regions with complete coverage, dependencies and shared boundary anchors. Overview only: no full inventory or CAD operations.',parameters:progressivePlanSchema,output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args,exec){progressive.plan=reference?rasterizeProgressivePlan(parseProgressivePlan(args),image):parseProgressivePlan(args);progressive.plan_sha256=digest(progressive.plan);progressive.regions=progressive.plan.regions.map(r=>({id:r.id,status:'pending',failure:null,entity_ids:[],boundary_links:[],batches:[],repairs:0}));await persist();exec.concludeTurn();return JSON.stringify(progressive.plan);}};
      const partition:ToolDefinition={...submit,name:'cader_submit_progressive_partition',description:'Preferred simple partition authoring: choose sorted normalized x/y cuts and describe EVERY row/column cell once. Program derives exact shared rectangular bounds, then applies the SAME coverage, DAG and anchor checks as the full plan. No CAD writes or semantic acceptance. Maximum 16 cells; empty cut array means no cut on that axis.',parameters:progressivePartitionSchema,execute(args,exec){return submit.execute(parseProgressivePartition(args),exec);}};
      await model('使用中文。先只看全局概貌，不清点全部符号/标签，不生成几何操作。优先调用cader_submit_progressive_partition：选择原图归一化x_cuts/y_cuts（递增内部切线），regions对每个row/column格子仅填一次内容、ID、priority和depends_on，程序生成严格共享的bounds；无切线轴用[]。也可调用cader_submit_progressive_plan提交完整矩形。将用户请求范围完整划分为2到16个互不重叠矩形区域。可采用对齐边界的横/竖条带或网格，面积必须完整覆盖content_bounds。优先按实际内容和空白带作少量有意义的分区，不能为了网格整齐把同一组件切碎。priority=0..100控制依赖就绪后的执行顺序：用户要求的主要图形/结构先绘，图框、索引、标题等呈现附属区域后绘。不要因左上到右下扫描而先花大量调用清点图框。depends_on只表达实际跨区前置条件，不能用它编码扫描顺序。尽量不切过符号本体；共享线/基准穿越边界处用anchors明确归一化位置、相邻regions、关系及像素证据，不确定时标uncertain。全图坐标为原图左上原点y向下；区域不能各自重置原点。未知物理比例尺用relative-layout-units。新建非参考图同样采用统一布局坐标。仅概述各区域预期内容与依赖，不逐器件追网。用户请求：'+task,{image:reference?.image.path,extraTools:[submit,partition],onlyTools:[submit.name,partition.name,'cader_view_image'],maxImageViews:2,maxModelSteps:4});
      if(!progressive.plan)await model('上一回合未提交可执行的分区计划。当前优先调用cader_submit_progressive_partition让程序从切线生成相邻区域，也可修正完整plan，不只回答说明，不做全图清点、不绘图。完整覆盖请求范围，最多16个不相交矩形，共用原图归一化坐标；几何图框使用coincident，功能网络连通才使用connected。用户请求：'+task,{image:reference?.image.path,extraTools:[submit,partition],onlyTools:[submit.name,partition.name],maxImageViews:0,maxModelSteps:3});
      if(!progressive.plan)throw new Error('PROGRESSIVE_PLAN_MISSING');
    }
    parseProgressivePlan(progressive.plan);const frame=progressiveFrame(progressive.plan,image);
    if(!await owner.authorizeTask(taskId,plan,options.confirm,outputPath?{freshDrawing:true,outputPath}:undefined)){failure={stage:phase,code:'TASK_AUTHORIZATION_DENIED',source:'verification'};await enter('blocked');return state();}
    authorized=true;
    progressive.connection=owner.facts().local_connection_id;
    if(!progressive.document&&owner.taskScope(taskId).new_drawing_confirmed){progressive.document=owner.facts().scratch;await checkpoint('original_new_document_ACK_reconciled');}
    const splitDepth=(id:string)=>{let depth=0,ancestor=id;for(;;){const parent=progressive.decompositions?.find(d=>d.children.includes(ancestor));if(!parent)break;depth++;ancestor=parent.parent;}return depth;};
    const canRefineRegion=(region:ProgressiveRegion,descriptor:ProgressivePlanData['regions'][number])=>{
      const depth=splitDepth(region.id),width=(descriptor.bounds[1][0]-descriptor.bounds[0][0])*image.width,height=(descriptor.bounds[1][1]-descriptor.bounds[0][1])*image.height,pixels=width*height;
      const denseOverflow=region.failure?.startsWith('SOURCE_LABEL_INVENTORY_LIMIT')&&depth<6&&width>64&&height>64&&pixels>128*128;
      return !region.entity_ids.length&&progressive.plan!.regions.length<64&&(depth<2||Boolean(reference)&&(depth<4&&pixels>512*512||denseOverflow));
    };
    const splitRegion=async(region:ProgressiveRegion,descriptor:ProgressivePlanData['regions'][number])=>{
      const history=progressive.decompositions??=[];
      const depth=splitDepth(region.id);
      if(!canRefineRegion(region,descriptor))return false;
      let changed=false;
      const first=region.id.slice(0,24)+'_a'+history.length,second=region.id.slice(0,24)+'_b'+history.length;
      const submit:ToolDefinition={name:'cader_split_progressive_region',description:'Refine only this unexecuted region after a source failure. Select one shared global normalized cut avoiding actual symbol bodies. Existing owned geometry and other region scopes cannot change.',parameters:{type:'object',properties:{axis:{type:'integer',enum:[0,1]},position:{type:'number'},descriptions:{type:'array',minItems:2,maxItems:2,items:{type:'string',minLength:1,maxLength:800}},anchors:{type:'array',maxItems:16,items:{type:'object',properties:{id:{type:'string',pattern:'^[a-zA-Z][a-zA-Z0-9_-]{0,23}$'},position:{type:'array',minItems:2,maxItems:2,items:{type:'number',minimum:0,maximum:1}},relation:{type:'string',enum:['connected','coincident']},certainty:{type:'string',enum:['clear','uncertain']},evidence:{type:'string',minLength:1,maxLength:400}},required:['id','position','relation','certainty','evidence'],additionalProperties:false}}},required:['axis','position','descriptions','anchors'],additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args,exec){
        const v=args as {axis:0|1;position:number;descriptions:[string,string];anchors:ProgressivePlanData['anchors']};
        const low=descriptor.bounds[0][v.axis],high=descriptor.bounds[1][v.axis];if(v.position<=low+(high-low)*0.1||v.position>=high-(high-low)*0.1)throw new Error('REGION_SPLIT_TOO_NARROW');
        const left=structuredClone(descriptor.bounds),right=structuredClone(descriptor.bounds);left[1][v.axis]=v.position;right[0][v.axis]=v.position;
        const children=[{id:first,bounds:left,description:v.descriptions[0],depends_on:descriptor.depends_on,...(descriptor.priority===undefined?{}:{priority:descriptor.priority})},{id:second,bounds:right,description:v.descriptions[1],depends_on:descriptor.depends_on,...(descriptor.priority===undefined?{}:{priority:descriptor.priority})}];
        const candidate=structuredClone(progressive.plan!);const index=candidate.regions.findIndex(r=>r.id===region.id);candidate.regions.splice(index,1,...children);
        for(const r of candidate.regions)r.depends_on=r.depends_on.flatMap(id=>id===region.id?[first,second]:[id]);
        for(const a of candidate.anchors)a.regions=[...new Set(a.regions.flatMap(id=>id===region.id?children.filter(r=>inside(a.position,r.bounds,1e-7)).map(r=>r.id):[id]))];
        candidate.anchors.push(...v.anchors.map(a=>({...a,id:'s'+history.length+'_'+a.id,regions:[first,second]})));
        const parsed=reference?rasterizeProgressivePlan(parseProgressivePlan(candidate),image):parseProgressivePlan(candidate);history.push({parent:region.id,children:[first,second],reason:region.failure??'source_failed',source:region.source});
        progressive.plan!.regions.splice(0,progressive.plan!.regions.length,...parsed.regions);progressive.plan!.anchors=parsed.anchors;progressive.plan_sha256=digest(progressive.plan);
        progressive.regions.splice(progressive.regions.findIndex(r=>r.id===region.id),1,...children.map(r=>({id:r.id,status:'pending' as const,failure:null,entity_ids:[],boundary_links:[],batches:[],repairs:0})));
        changed=true;await persist();options.emit({type:'task.region_split',parent:region.id,children:[first,second],reason:region.failure});exec.concludeTurn();return JSON.stringify(children);
      }};
      await enter('planning');await model('当前未执行区域的源观察失败；禁止重复相同整区清点。仅查看当前原图区域，选择避开符号本体的一条水平或垂直切线，调用cader_split_progressive_region将本区域完整分成两个更小区域；不改其他区域、不绘图。axis=0为竖切x坐标，1为横切y坐标，position必须是原始整图归一化坐标。描述两块独占内容并记录跨新边界的共享锚点，图框/基准线使用coincident，功能网络延续才用connected；不确定标uncertain。'+JSON.stringify({task,region:descriptor,failure:region.failure,region_pixel_dimensions:[(descriptor.bounds[1][0]-descriptor.bounds[0][0])*image.width,(descriptor.bounds[1][1]-descriptor.bounds[0][1])*image.height],source_contract:{max_labels_per_observation:32,reason:'Refine actual observation density; do not raise the label cap or waive completeness. Prefer reducing the longer pixel dimension, avoid thin strips and splitting symbols/text.'}}),{image:reference?.image.path,imageView:crop(descriptor.bounds),onlyTools:[submit.name],extraTools:[submit],maxModelSteps:3});return changed;
    };
    if(sourceIndex&&progressive.source_worklist){
      if(!owner.taskScope(taskId).new_drawing_confirmed){
        await enter('drawing');const tools=indexedTools.filter(t=>t.name.endsWith('__new_drawing')).map(t=>t.name);
        await model('立即调用new_drawing，仅新建一次本任务工作图，不绘制、不保存。'+task,{onlyTools:tools,maxModelSteps:2,completeNewDrawing:async()=>{if(!owner.taskScope(taskId).new_drawing_confirmed)throw new Error('TASK_EXECUTION_REQUIRED');progressive.document=owner.facts().scratch;await checkpoint('new_document_confirmed');},resultText:()=>owner.taskScope(taskId).new_drawing_confirmed?'新工作图已确认，交回Scheduler。':undefined});
        if(!owner.taskScope(taskId).new_drawing_confirmed)throw new Error('TASK_EXECUTION_REQUIRED');progressive.document=owner.facts().scratch;await checkpoint('new_document');
      }
      await runIndexedRegions({runtime,owner,progressive,index:sourceIndex,sourcePath:reference!.image.path,task,signal,model,enter,persist,checkpoint,assertSource,observe,observeRecentFull,observeTargets:ids=>observe(ids),emit:options.emit,confirm:options.confirm,onEvidenceError:error=>{const code=(error as Error).message,cause=(error as Error).cause as {diagnostic_path?:string}|undefined;if(taskStops.has(code))evidenceFailure=code;progressive.last_tool_error={tool:'local.source_evidence',message:(code+(typeof cause?.diagnostic_path==='string'?'; private diagnostic: '+cause.diagnostic_path:'')).slice(0,6000)};},onVisual:(review,hash)=>{visual=review;visualCalls.push({source:'harness',observed_state_hash:hash,review});assertEvidenceOutcome(review);}});
    }else for(let regionIndex=0;regionIndex<progressive.plan.regions.length;regionIndex++){
      const stopped=runtime.executionStop?.();if(stopped)throw new Error(stopped);
      const descriptor=progressive.plan.regions[regionIndex]!;
      const region=progressive.regions.find(r=>r.id===descriptor.id)!;progressive.active_region=region.id;
      if(region.status==='verified'){emitRegion(region);continue;}
      if(descriptor.depends_on.some(id=>progressive.regions.find(r=>r.id===id)?.status!=='verified')){region.status='blocked';region.failure='REGION_DEPENDENCY_PENDING';emitRegion(region);continue;}
      try{
        await assertSource();runtime.setVerificationScope(`source:${region.id}`);
        // A failed cached Gate is evidence, not an eternal verdict. A bounded
        // explicit resume may obtain fresh source evidence on the SAME scope;
        // retain its old plan/observations and every committed entity. The new
        // plan still needs native/visual acceptance, never a blind redraw.
        if(reference&&options.resume&&(region.draft_source||region.source&&!region.source.valid)&&(region.source_history?.length??0)<3){
          (region.source_history??=[]).push({source:region.source,draft_source:region.draft_source,plan:region.plan,failure:region.failure});
          region.source=undefined;region.draft_source=undefined;region.plan=undefined;region.uncertainty_review=undefined;region.boundary_links=[];region.failure=null;await persist();
        }
        if(!region.source&&reference){region.status='observing';await enter('reference');emitRegion(region);
          region.source=await runtime.inspectReference(reference.image.path,task,signal,{id:region.id,bounds:descriptor.bounds});await persist();
          const stopped=runtime.executionStop?.();if(stopped)throw new Error(stopped);
          assertEvidenceOutcome(region.source);
          if(region.source.evidence.sha256!==reference.image.sha256)throw new Error('REFERENCE_CHANGED_RESELECT_REQUIRED');
        }
        const sourceReady=region.source?.valid&&region.source.structured&&!region.source.structured.objects.some(o=>o.certainty==='uncertain')&&!region.source.structured.nets?.some(n=>n.certainty!=='clear');
        if(reference&&!sourceReady){
          if(canRefineRegion(region,descriptor))throw new Error(region.source?.valid?'REGION_SOURCE_UNCERTAIN':'REGION_REFERENCE_FAILED');
          if(!region.draft_source){region.draft_source=await runtime.inspectProgressiveDraft(reference.image.path,{id:region.id,bounds:descriptor.bounds},task,signal);await persist();options.emit({type:'reference.draft_inspected',region:region.id,valid:region.draft_source.valid,coverage:'partial',source_sha256:region.draft_source.source_sha256,verified_traces:region.draft_source.agreements.length});}
          assertEvidenceOutcome(region.draft_source);
          if(!region.draft_source.valid||region.draft_source.source_sha256!==reference.image.sha256)throw new Error('VERIFIED_DRAFT_SOURCE_UNAVAILABLE');
        }
        const source=sourceReady?region.source!.structured:undefined;
        let draft=region.draft_source?.valid&&!sourceReady?region.draft_source:undefined;
        let draftGeometry=draft?.agreements.map(({trace})=>draftCadTrace(trace,frame,progressive.plan!.content_bounds));
        let localSource:ReferenceObservationData|undefined=source?{...source,content_bounds:progressive.plan.content_bounds}:undefined;
        const regionAnchors=progressive.plan.anchors.filter(a=>a.regions.includes(region.id)&&a.relation==='connected');
        if(localSource?.unknowns.length&&!region.uncertainty_review){
          const uncertaintySource=localSource;
          const anchors=progressive.plan.anchors.filter(a=>a.regions.includes(region.id));
          let reviewed:ProgressiveRegion['uncertainty_review'];
          const submit:ToolDefinition={name:'cader_review_region_uncertainties',description:'Classify EVERY source uncertainty in the current region. Local required uncertainty blocks local acceptance. Cross-region facts need declared shared anchors and remain mandatory global checks. Only unrequested physical scale or original file/entity encoding can be out of request.',parameters:{type:'object',properties:{items:{type:'array',minItems:uncertaintySource.unknowns.length,maxItems:uncertaintySource.unknowns.length,items:{type:'object',properties:{index:{type:'integer',minimum:0,maximum:uncertaintySource.unknowns.length-1},disposition:{enum:['local_required','cross_region','out_of_request'],type:'string'},feature:{enum:['drawing_fidelity','physical_scale','source_entity_class','source_file_format'],type:'string'},anchor_ids:{type:'array',items:{type:'string'},maxItems:8},evidence:{type:'string',minLength:1,maxLength:400}},required:['index','disposition','feature','anchor_ids','evidence'],additionalProperties:false}}},required:['items'],additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args,exec){const items=(args as {items:NonNullable<ProgressiveRegion['uncertainty_review']>}).items;
            if(items.length!==uncertaintySource.unknowns.length||new Set(items.map(i=>i.index)).size!==items.length||items.some(i=>!uncertaintySource.unknowns[i.index]))throw new Error('SOURCE_UNCERTAINTY_SCOPE_INVALID');
            for(const item of items){
              if(item.disposition==='cross_region'&&(!item.anchor_ids.length||item.anchor_ids.some(id=>!anchors.some(a=>a.id===id))))throw new Error('SHARED_ANCHOR_EVIDENCE_REQUIRED');
              if(item.disposition==='out_of_request'&&(item.feature==='drawing_fidelity'||item.feature==='physical_scale'&&/比例尺|按比例|物理尺寸|毫米|厘米|\b(?:mm|cm|scale|dimensions?)\b/i.test(task)))throw new Error('REQUIRED_SOURCE_UNCERTAINTY_CANNOT_BE_WAIVED');
            }
            reviewed=items;exec.concludeTurn();return JSON.stringify(items);
          }};
          if(!runtime.visionProfileId)throw new Error('VISION_PROFILE_UNAVAILABLE');
          const result=await runtime.run(runtime.visionProfileId,'独立查看当前原图区域，逐项审定原unknowns的真实作用域，不直接删除或改写源记录。局部必要外观/连接问题保留local_required；仅跨区事实可引用已有anchor_ids记cross_region，仍须最终全图验证；未请求的物理比例尺、输入源文件格式或原始CAD实体编码可记out_of_request。不能用不要求实体类型来豁免符号、标签、颜色或实际连接的保真。必须调用cader_review_region_uncertainties。'+JSON.stringify({task,region:{id:descriptor.id,description:descriptor.description},unknowns:uncertaintySource.unknowns,anchors:sourceCoordinates(anchors,descriptor.bounds,'to-crop'),units:progressive.plan.units}),{independentEvidence:true,taskState:()=>({phase:'reference',region:region.id,source_sha256:reference?.image.sha256}),image:reference?.image.path,imageView:crop(descriptor.bounds),signal,skill:'progressive-drawing',skillResource:'source-observation',observationFrame:descriptor.bounds,observationViewAware:true,maxImageViews:2,onlyTools:[submit.name,'cader_view_image'],extraTools:[submit],maxModelSteps:3,resultText:()=>reviewed?JSON.stringify(reviewed):undefined});
          assertEvidenceOutcome(result);
          if(result.status!=='succeeded'||!reviewed)throw new Error('REGION_UNCERTAINTY_REVIEW_FAILED');region.uncertainty_review=reviewed;await persist();
        }
        if(reference&&region.uncertainty_review?.some(i=>i.disposition==='local_required')){
          if(canRefineRegion(region,descriptor))throw new Error('REGION_SOURCE_UNCERTAIN');
          if(!region.draft_source){region.draft_source=await runtime.inspectProgressiveDraft(reference.image.path,{id:region.id,bounds:descriptor.bounds},task,signal);await persist();}
          assertEvidenceOutcome(region.draft_source);
          if(!region.draft_source.valid||region.draft_source.source_sha256!==reference.image.sha256)throw new Error('VERIFIED_DRAFT_SOURCE_UNAVAILABLE');
          draft=region.draft_source;draftGeometry=draft.agreements.map(({trace})=>draftCadTrace(trace,frame,progressive.plan!.content_bounds));localSource=undefined;
        }
        if(localSource?.drawing_kind==='schematic'&&regionAnchors.length&&!region.boundary_links.length){
          const readings:ProgressiveRegion['boundary_links'][]=[];
          for(let pass=0;pass<2;pass++){
            let links:ProgressiveRegion['boundary_links']|undefined;
            const submit:ToolDefinition={name:'cader_submit_region_boundary_links',description:'Independently trace each declared source boundary anchor into exactly one observed local net. A boundary is not a device or a broken wire; uncertain evidence cannot authorize its dependent connection.',parameters:{type:'object',properties:{links:{type:'array',minItems:regionAnchors.length,maxItems:regionAnchors.length,items:{type:'object',properties:{anchor:{type:'string',enum:regionAnchors.map(a=>a.id)},net:{type:'string',enum:localSource.nets!.map(n=>n.id)},certainty:{enum:['clear','uncertain'],type:'string'},evidence:{type:'string',minLength:1,maxLength:400}},required:['anchor','net','certainty','evidence'],additionalProperties:false}}},required:['links'],additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args,exec){const parsed=(args as {links:ProgressiveRegion['boundary_links']}).links;if(parsed.length!==regionAnchors.length||new Set(parsed.map(l=>l.anchor)).size!==parsed.length||parsed.some(l=>!regionAnchors.some(a=>a.id===l.anchor)||!localSource.nets?.some(n=>n.id===l.net)))throw new Error('REGION_BOUNDARY_PARTITION_INVALID');links=parsed;exec.concludeTurn();return JSON.stringify(parsed);}};
            if(!runtime.visionProfileId)throw new Error('VISION_PROFILE_UNAVAILABLE');
            const read=await runtime.run(runtime.visionProfileId,'独立沿实际原图像素追踪当前区域边界锚点分别连接哪个局部net。不能按常识、CAD结果或先前模型意见猜测。仅调用cader_submit_region_boundary_links覆盖每个锚点，确实无法判读标uncertain。位置索引均为当前BASE归一化坐标；局部高清裁图使用BASE 0..1，跨边界内容仍待全图核对。'+JSON.stringify({region:{id:descriptor.id,description:descriptor.description},anchors:sourceCoordinates(regionAnchors,descriptor.bounds,'to-crop'),source_objects:sourceCoordinates(localSource.objects,descriptor.bounds,'to-crop'),local_nets:localSource.nets}),{independentEvidence:true,taskState:()=>({phase:'reference',region:region.id,source_sha256:reference?.image.sha256}),image:reference?.image.path,imageView:crop(descriptor.bounds),signal,skill:'progressive-drawing',skillResource:'source-observation',observationFrame:descriptor.bounds,observationViewAware:true,maxImageViews:2,onlyTools:[submit.name,'cader_view_image'],extraTools:[submit],maxModelSteps:3,resultText:()=>links?JSON.stringify(links):undefined});
            assertEvidenceOutcome(read);
            if(read.status!=='succeeded'||!links)throw new Error('REGION_BOUNDARY_REVIEW_FAILED');readings.push(links);
          }
          const partition=(links:ProgressiveRegion['boundary_links'])=>links.map(l=>[l.anchor,l.net,l.certainty].join(':')).sort();
          if(!same(partition(readings[0]!),partition(readings[1]!))||readings.some(links=>links.some(l=>l.certainty!=='clear')))throw new Error('REGION_BOUNDARY_UNCERTAIN');
          region.boundary_links=readings[1]!;await persist();
        }
        if(draft&&draftGeometry){
          const compiled=draftAcceptancePlan(task,draftGeometry);
          if(!same(region.plan,compiled)){if(region.plan)(region.draft_plan_history??=[]).push(region.plan);region.plan=compiled;await persist();}
        }
        if(!region.plan){
          region.status='ready';await enter('planning');
          const scopedPlanSchema=structuredClone(acceptancePlanSchema);if(draft||localSource&&localSource.drawing_kind!=='schematic')scopedPlanSchema.properties.domain={type:'string',const:'generic'};
          if(draft){scopedPlanSchema.properties.components.maxItems=0;scopedPlanSchema.properties.requirements.items.properties.check.enum=['visual','entity_count','text'];}
          const submit:ToolDefinition={name:'cader_submit_acceptance_plan',description:'Submit only this observed region acceptance in the supplied shared CAD frame. A layout/table/frame region is generic even when the whole source is a schematic. Prefer compact source_layout:true for observed layout or partial draft; the Harness supplies the shared frame. Only a schematic region includes independently checked ports/nets. No geometry operations.',parameters:localSource||draft?{anyOf:[{type:'object',properties:{source_layout:{const:true},requirements:acceptancePlanSchema.properties.requirements},required:['source_layout','requirements'],additionalProperties:false},scopedPlanSchema]}:scopedPlanSchema,output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args,exec){
            let input=args;
            if((args as {source_layout?:boolean}).source_layout){
              const requirements=(args as {requirements:QualityPlan['requirements']}).requirements;
              if(localSource?.drawing_kind==='schematic'&&localSource.nets?.length){const layout=sourcePlanLayout(localSource,image);input={version:1,domain:'electrical-schematic',wire_layer:`PD_${region.id}_WIRE`,visual_required:true,components:layout.components,nets:layout.nets,requirements};}
              else if(localSource||draft)input={version:1,domain:'generic',visual_required:true,components:[],requirements};
              else throw new Error('SOURCE_LAYOUT_UNAVAILABLE');
            }
            const next=parseAcceptancePlan(input);if(!next.visual_required||!next.requirements.some(r=>r.check==='visual'))throw new Error('VISUAL_ACCEPTANCE_REQUIRED');
            if(next.requirements.some(r=>r.check==='saved_dwg'))throw new Error('REGION_GLOBAL_CONDITION: DWG save/reopen belongs to final task delivery, never a regional prerequisite. Remove saved_dwg from this regional plan; the Harness preserves the original output request.');
            if(next.requirements.some(r=>r.check==='entity_count'&&r.max!==undefined)&&!/直线|线段|多段线|圆|圆弧|矩形|文字|文本|\b(?:lines?|circles?|arcs?|polylines?|rectangles?|texts?)\b/i.test(task))throw new Error('UNREQUESTED_PRIMITIVE_LIMIT: source appearance does not prescribe a CAD primitive implementation or count ceiling. Use source visual fidelity; native source geometry is checked independently.');
            if(localSource&&localSource.drawing_kind!=='schematic'&&next.domain!=='generic')throw new Error('REGION_DOMAIN_MISMATCH');
            if(draft&&(next.domain!=='generic'||next.components.length||next.requirements.some(r=>!['visual','entity_count','text'].includes(r.check))))throw new Error('PARTIAL_DRAFT_IS_NOT_SEMANTIC_ACCEPTANCE');
            if(next.requirements.some(r=>!task.includes(r.source_quote)))throw new Error('EXACT_USER_QUOTE_REQUIRED');
            if(localSource?.drawing_kind==='schematic'){
              if(next.domain!=='electrical-schematic')throw new Error('SOURCE_TOPOLOGY_ACCEPTANCE_REQUIRED');referencePlanHints(localSource,image,next);
              const actual=next.nets?.map(n=>n.pins.map(p=>{const c=next.components.find(c=>c.id===p.component)!;return c.source_id+':'+c.source_terminals![c.pin_names!.indexOf(p.pin)];}).sort().join('|')).sort();
              const expected=localSource.nets?.map(n=>n.pins.map(p=>p.object+':'+p.terminal).sort().join('|')).sort();if(!same(actual,expected))throw new Error('SOURCE_NETLIST_MISMATCH');
            }
            if(next.components.some(c=>!inside(c.bounds[0],frame.box(descriptor.bounds))||!inside(c.bounds[1],frame.box(descriptor.bounds))))throw new Error('REGION_LAYOUT_OUTSIDE_FRAME');
            region.plan=next;await persist();exec.concludeTurn();return JSON.stringify(next);
          }};
          await model((draft?'当前仅处理已独立核实的部分待验稿。必须generic、components=[]，仅visual/text/entity_count。严禁宣称整区覆盖或拓扑已通过；程序会保留SOURCE_RECONSTRUCTION_PENDING。':'')+'为当前区域提交紧凑独立验收清单，不规划全图，不绘图。仅使用实际用户原文source_quote。有源观察或已核实待验稿时优先source_layout:true，只提交紧凑视觉/文字条件，不写几何或像素位置、不添加未请求的实体数量上限。仅当source的drawing_kind为schematic时才加入netlist/no_wire_through_component/text_clearance。layout/other区域（例如图框或文字）必须使用generic，components可为空，只检查本区实际图形/文字/布局，不提交netlist或虚构元件；不能按整张图的专业类别覆盖本区域类型。组件与标注必须使用给定共享CAD坐标，不能重新缩放平移。标签逐项匹配原文/大小写/单位。局部条件不能要求其他区域已画好；不要提交saved_dwg，保存和只读重开由全图交付程序处理。'+JSON.stringify({task,region:descriptor,bounds:frame.box(descriptor.bounds),source:localSource?hints(localSource,image):null,verified_draft_subset:draftGeometry??null,draft_notice:draft?'只允许双重独立观察一致的部分图形，不能作为完整源清点或拓扑通过；遗漏内容和整图仍待验。paths用AcDbLine逐段，圆和文字按实际schema；不能新增未列的几何或猜测连接。':null}),{image:reference?.image.path,imageView:crop(descriptor.bounds),onlyTools:[submit.name],extraTools:[submit],maxModelSteps:4});
          if(!region.plan)throw new Error('ACCEPTANCE_PLAN_MISSING');
        }
        await owner.refineTaskPlan(taskId,region.plan);
        if(!owner.taskScope(taskId).new_drawing_confirmed){
          await enter('drawing');const tools=owner.definitions(options.confirm).filter(t=>t.name.endsWith('__new_drawing')).map(t=>t.name);
          await model('立即调用new_drawing，仅新建一次本任务工作图，不绘制、不保存。'+task,{onlyTools:tools,maxModelSteps:2,completeNewDrawing:async()=>{if(!owner.taskScope(taskId).new_drawing_confirmed)throw new Error('TASK_EXECUTION_REQUIRED');progressive.document=owner.facts().scratch;await checkpoint('new_document_confirmed');},resultText:()=>owner.taskScope(taskId).new_drawing_confirmed?'本任务新建图纸已通过真实执行回执及读回确认，交回Scheduler。':undefined});
          const scope=owner.taskScope(taskId);if(!scope.new_drawing_confirmed)throw new Error('TASK_EXECUTION_REQUIRED');progressive.document=owner.facts().scratch;await checkpoint('new_document');
        }
        // Region ownership includes partially committed geometry, even if a
        // previous response ended before check-in. Never reconstruct the region.
        const knownOther=new Set(progressive.regions.filter(r=>r.id!==region.id).flatMap(r=>r.entity_ids));
        region.entity_ids=[...new Set([...region.entity_ids,...owner.taskScope(taskId).entity_ids.filter(id=>!knownOther.has(id))])];
        region.status='drawing';let finished=false,verificationSubmitted=false,idleSlices=0,lastSnapshot=await observe();const changedLayers=new Set<string>();
        let regionReviewCache:{key:string;result:Review;valid:boolean;history:Review[]}|undefined;
        let batchReviewCache:{key:string;result:Review}|undefined;
        const reviewKey=(snapshotHash:string)=>digest([snapshotHash,region.plan,reference?.image.sha256,owner.facts().operations.filter(op=>op.outcome==='committed'&&op.tool!=='export_current_view').map(op=>op.operation_id)]);
        const review=async(partial:boolean,affected:Entity[],native:CheckResult[],deleted:Entity[]=[])=>{
          const snapshot=await observe(),snapshotHash=digest(snapshot.entities);
          if(!partial)await enter('vision');
          const cacheKey=reviewKey(snapshotHash);if(!partial&&regionReviewCache?.key===cacheKey&&await runtime.isCadReviewCurrent?.(regionReviewCache.result))return regionReviewCache;
          const requirements=partial?[{id:'batch_fidelity',description:'只检查本批新建/修改部分是否符合指定源区域或需求；其他未绘制内容不是此批缺陷。检查可见几何、符号细节、文字及局部连接。'}]:region.plan!.requirements.filter(r=>r.check==='visual');
          const targets=[...affected,...deleted.map(e=>({...e,expected_absent:true}))];
          const scoped=progressiveReviewScope({region:region.id,mode:partial?'affected-batch':draft?'draft-subset':'complete-region',document:owner.facts().native_target??progressive.document,snapshot_hash:snapshotHash,source_sha256:reference?.image.sha256??null,entities:targets,bounds:frame.box(descriptor.bounds),image,source_bounds:descriptor.bounds,toSource:frame.toSource,draft:draftGeometry});
          const question={review_scope:scoped.binding,original_request:partial?'仅检查当前批次实际提交图形的可见实现与下列几何证据；未提交部分不在本批范围，区域和全图另行验收。':task,task_request_sha256:requestHash,requirements,verification_scope:partial?'affected-batch':draft?'verified-partial-draft-subset':'complete-region',verified_draft_subset:partial?draftGeometry?.filter(t=>verifyDraftGeometry([t],affected)[0]?.status==='pass')??null:draftGeometry??null,omitted_source_content:partial?[]:(draft?.readings??[]).flatMap(r=>r.omitted),region:partial?{id:descriptor.id,bounds:descriptor.bounds}:descriptor,source_frame:{content_bounds:progressive.plan!.content_bounds,cad_bounds:frame.box(descriptor.bounds)},partial_batch:partial,affected_entity_ids:affected.map(e=>e.object_id),entity_snapshot:targets,geometry:native,note:'Only affected geometry (or the explicitly verified draft subset) is in scope; omitted content and other regions are still pending, not defects of this batch. Different plot zoom/blank margins do not change the shared native CAD positions. Independently compare actual pixels, not earlier verdicts.'};
          const sourceDetails=reference?[{path:reference.image.path,view:crop(descriptor.bounds),label:'ORIGINAL source region '+region.id+'; global normalized frame, NOT CAD screenshot'}]:undefined;
          const recordVisualError=async(error:unknown)=>{visualError=(error as Error).message.slice(0,6000);(region.verification_errors??=[]).push({stage:'native_local_review',error:visualError,at:new Date().toISOString()});progressive.last_tool_error={tool:'Harness.native_local_review',message:visualError};await persist();};
          let result:Review;visualError=null;
          try{result=await runtime.reviewCadView(JSON.stringify(question),signal,reference?.image.path,sourceDetails,scoped.view);}catch(error){await recordVisualError(error);throw error;}
          const history:Review[]=[];
          const remember=(report:Review)=>{report.requirements=JSON.stringify({original_request:task,region:region.id,partial_batch:partial,observed_state_hash:snapshotHash,requirement_ids:requirements.map(r=>r.id),scope_reconciliation:history.length>0,full_evidence:'cad.review event journal'});history.push(report);visual=report;region.last_review=report;visualCalls.push({source:'harness',observed_state_hash:snapshotHash,review:report});};
          const validReview=(report:Review)=>report.review_valid&&(!reference||(report.evidence as {reference?:{sha256?:string}}).reference?.sha256===reference.image.sha256)&&(report.evidence as {document?:string}).document===progressive.document&&(!(report.evidence as {image_bounds?:{possible_clipping?:boolean}}).image_bounds?.possible_clipping||scopedNativeWindowContainsTargets(report.evidence))&&report.structured?.verdict==='pass'&&requirements.every(r=>report.structured!.checklist.some(c=>c.requirement_id===r.id&&c.status==='pass'));
          remember(result);assertEvidenceOutcome(result);if(snapshotHash!==digest((await observe()).entities))throw new Error('VISUAL_OBSERVATION_CHANGED');
          let valid=validReview(result);
          if(partial&&!valid&&result.review_valid&&result.structured?.verdict!=='pass'&&native.every(c=>c.status==='pass')&&runtime.reassessCadView){
            // One independent scope reconciliation on the SAME actual image.
            // Original failed reports stay in history; no forced pass, new CAD
            // write, extra capture or whole-region acceptance is allowed here.
            try{result=await runtime.reassessCadView(JSON.stringify({...question,scope_reconciliation:{previous_report:result.structured,expected_current_geometry:question.verified_draft_subset??affected,rule:'Independently recheck ONLY these committed entities. Missing unsubmitted symbols/labels/canopies are not batch requirements. Native coordinates, direction and relative positions already verified cannot be contradicted merely because PlotToFile zooms the current extents. Report genuine visible defects or uncertainty; never force pass. Regional and final acceptance remain pending.'}}),result.image_ref,signal,reference?.image.path,sourceDetails,scoped.view);}catch(error){await recordVisualError(error);throw error;}
            remember(result);assertEvidenceOutcome(result);if(snapshotHash!==digest((await observe()).entities))throw new Error('VISUAL_OBSERVATION_CHANGED');valid=validReview(result);
          }
          if(!partial)regionReviewCache={key:cacheKey,result,valid,history};else batchReviewCache={key:cacheKey,result};return {result,valid,history};
        };
        const afterBatch=async()=>{
          const snapshot=await observe(),before=new Map(lastSnapshot.entities.map(e=>[e.object_id,e]));
          const freshOperations=owner.facts().operations.filter(op=>op.outcome==='committed'&&!progressive.confirmed_operation_ids.includes(op.operation_id));
          const styleChanged=freshOperations.some(op=>['create_layer','set_layer_properties'].includes(op.tool));
          const affected=snapshot.entities.filter(e=>!same(e,before.get(e.object_id))||styleChanged&&changedLayers.has(layerKey(e.layer))),deleted=lastSnapshot.entities.filter(e=>!snapshot.entities.some(n=>n.object_id===e.object_id));
          // Observed compound-tool helper entities belong to verification scope,
          // not automatically to write authority. ExecutionSession still checks
          // its own acknowledged created-ID ledger for every edit/delete.
          region.entity_ids=[...new Set([...region.entity_ids,...owner.taskScope(taskId).entity_ids.filter(id=>!knownOther.has(id)),...affected.filter(e=>!knownOther.has(e.object_id)).map(e=>e.object_id)])].filter(id=>snapshot.entities.some(e=>e.object_id===id));
          if(!affected.length&&!deleted.length)return;
          const batch={id:`${region.id}-${region.batches.length+1}`,operation_ids:owner.facts().operations.filter(op=>op.outcome==='committed'&&!progressive.confirmed_operation_ids.includes(op.operation_id)).map(op=>op.operation_id),entity_ids:affected.map(e=>e.object_id),state_sha256:digest(snapshot.entities),checks:verifyProgressiveBatch(affected,frame.box(descriptor.bounds),snapshot.entities.filter(e=>!affected.includes(e))),status:'pending' as 'pass'|'fail'|'pending',review:undefined as Review|undefined,review_history:[] as Review[]};
          region.batches.push(batch);lastSnapshot=snapshot;changedLayers.clear();await checkpoint('batch_committed_pending_verification');
          runtime.setVerificationScope('batch:'+batch.id);await enter('geometry');
          if([...affected,...deleted].some(e=>knownOther.has(e.object_id)))batch.checks.push({id:'region_ownership',status:'fail',evidence:'A previously owned region changed'});
          await enter('vision');const evaluated=await review(true,affected,batch.checks,deleted);batch.review=evaluated.result;batch.review_history=evaluated.history;
          batch.status=evaluated.valid&&batch.checks.every(c=>c.status==='pass')?'pass':'fail';
          await checkpoint('batch_verified');options.emit({type:'task.batch_verified',region:region.id,batch:batch.id,status:batch.status});
          if(batch.status!=='pass')throw new Error('BATCH_VERIFICATION_PENDING');
          region.status='drawing';await enter('drawing');
        };
        const checkRegion=async()=>{
          verificationSubmitted=true;
          await afterBatch();const snapshot=await observe(),entities=snapshot.entities.filter(e=>region.entity_ids.includes(e.object_id));
          let native=[...verifyQuality(region.plan!,entities,{new_document:true}),...verifyProgressiveBatch(entities,frame.box(descriptor.bounds),snapshot.entities.filter(e=>!region.entity_ids.includes(e.object_id)))];
          if(draftGeometry)native.push(...verifyDraftGeometry(draftGeometry,entities));
          if(region.plan!.domain==='electrical-schematic'){
            const boundaryPins=region.boundary_links.map(link=>{
              const sourceNet=localSource!.nets!.find(n=>n.id===link.net)!;
              const sourcePin=sourceNet.pins[0]!,component=region.plan!.components.find(c=>c.source_id===sourcePin.object)!;
              const pin=component.pin_names![component.source_terminals!.indexOf(sourcePin.terminal)]!;
              const net=region.plan!.nets!.find(n=>n.pins.some(p=>p.component===component.id&&p.pin===pin))!.id;
              return {name:'boundary:'+link.anchor,position:frame.point(regionAnchors.find(a=>a.id===link.anchor)!.position),net};
            });
            const topology=verifyNetlist(region.plan!,entities,boundaryPins);native=native.map(c=>region.plan!.requirements.find(r=>r.id===c.id)?.check==='netlist'?{id:c.id,status:topology.pass?'pass':'fail',evidence:topology.evidence,details:topology.details}:c);
          }
          if(localSource){
            const sourceLabels=hints(localSource,image).visible_text.filter(t=>/[\p{L}\p{N}]/u.test(t.text));
            const key=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'');
            const unmatched=sourceLabels.filter(t=>!entities.some(e=>typeof e.text_string==='string'&&key(e.text_string)===key(t.text)&&e.bounding_box&&inside(e.bounding_box.min,[[t.bounds[0]![0]!-2,t.bounds[0]![1]!-2],[t.bounds[1]![0]!+2,t.bounds[1]![1]!+2]],0)));
            native.push({id:'source_labels',status:unmatched.length?'fail':'pass',evidence:JSON.stringify({missing_or_misplaced:unmatched.map(t=>({text:t.text,bounds:t.bounds}))})});
          }
          if(localSource?.visible_text.some(t=>t.certainty!=='clear'))native.push({id:'source_labels_uncertain',status:'not_run',evidence:'Source label uncertainty requires explicit review, not guessed values'});
          if(!draft&&region.uncertainty_review?.some(i=>i.disposition==='local_required'))native.push({id:'source_unknowns',status:'not_run',evidence:JSON.stringify(region.uncertainty_review.filter(i=>i.disposition==='local_required').map(i=>({reading:localSource?.unknowns[i.index],review:i})))});
          const evaluated=await review(false,entities,native);region.checks=native.map(c=>c.status==='not_run'&&region.plan!.requirements.find(r=>r.id===c.id)?.check==='visual'?{...c,status:evaluated.result.structured?.checklist.find(v=>v.requirement_id===c.id)?.status==='pass'?'pass':'not_run'}:c);
          if(!evaluated.valid||region.checks.some(c=>c.status!=='pass'))throw new Error('REGION_ACCEPTANCE_PENDING');
          for(const batch of region.batches)if(batch.status!=='pass')batch.recovered_by='region_review:'+digest(snapshot.entities);
          finished=true;region.status=draft?'partial_verified':'verified';region.failure=draft?'SOURCE_RECONSTRUCTION_PENDING':null;region.final_sha256=digest(entities);await checkpoint(draft?'draft_subset_verified':'region_verified');emitRegion(region);
        };
        const finish:ToolDefinition={name:'cader_finish_drawing_unit',description:'Submit current region for mandatory actual structure and image verification. This does not complete the entire drawing.',parameters:{type:'object',properties:{unit_id:{const:region.id,type:'string'}},required:['unit_id'],additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(_args,exec){try{await checkRegion();}catch(error){if(owner.facts().frozen||signal?.aborted)throw error;region.failure=(error as Error).message;}exec.concludeTurn();return JSON.stringify({region:region.id,verified:finished,code:finished?null:region.failure,task_complete:false});}};
        const scopedNames=owner.definitions(options.confirm).filter(t=>/__(?:draw_line|draw_rectangle|draw_circle|draw_arc|draw_polyline|draw_hatch|draw_text|draw_mtext|create_layer|set_layer_properties|list_layers|get_entity|query_entities|move_entity|delete_entity)$/.test(t.name)).map(t=>t.name);
        const beforeCad=async(name:string,args:unknown)=>{
          const a=args as Record<string,any>;await assertSource();
          if(draftGeometry)validateDraftOperation(name,a,draftGeometry);
          if(name.endsWith('__move_entity')||name.endsWith('__delete_entity')){if(!region.entity_ids.includes(Number(a.object_id))||!owner.taskScope(taskId).entity_ids.includes(Number(a.object_id)))throw new Error('REGION_ENTITY_OWNERSHIP_REQUIRED');}
          const coordinates:number[][]=[];
          for(const prefix of ['start','end','center','position','insertion','corner1','corner2'])if(typeof a[prefix+'_x']==='number')coordinates.push([a[prefix+'_x'],a[prefix+'_y']]);
          for(const key of ['points','vertices'])if(Array.isArray(a[key]))coordinates.push(...a[key]);
          if(name.endsWith('__draw_circle')&&typeof a.radius==='number')coordinates.push([a.center_x-a.radius,a.center_y-a.radius],[a.center_x+a.radius,a.center_y+a.radius]);
          if(name.endsWith('__move_entity')){const e=(await observe()).entities.find(e=>e.object_id===Number(a.object_id));if(!e?.bounding_box)throw new Error('REGION_ENTITY_READBACK_REQUIRED');for(const point of [e.bounding_box.min,e.bounding_box.max])coordinates.push([point[0]+a.offset_x,point[1]+a.offset_y]);}
          if(name.endsWith('__set_layer_properties')||name.endsWith('__create_layer')){const snapshot=await observe();if(snapshot.entities.some(e=>knownOther.has(e.object_id)&&layerKey(e.layer)===layerKey(a.name)))throw new Error('REGION_SHARED_LAYER_PROTECTED');changedLayers.add(layerKey(a.name));}
          if(coordinates.some(p=>!inside(p,frame.box(descriptor.bounds))))throw new Error('REGION_WRITE_OUTSIDE_BOUNDS');
        };
        const request={cadAction:true,image:reference?.image.path,imageView:crop(descriptor.bounds),onlyTools:[...scopedNames.filter(name=>!draft||!name.split('__').at(-1)!.startsWith('draw_')||['draw_line','draw_circle','draw_text'].includes(name.split('__').at(-1)!)),'cader_apply_cad_patch','cader_review_cad_view',finish.name],extraTools:[finish],afterCadBatch:afterBatch,beforeCadOperation:beforeCad,completeDrawingUnit:checkRegion,controlledReview:async()=>{const current=await observe();if(batchReviewCache?.key===reviewKey(digest(current.entities))&&await runtime.isCadReviewCurrent?.(batchReviewCache.result))return batchReviewCache.result;const entities=current.entities.filter(e=>region.entity_ids.includes(e.object_id));return (await review(true,entities,verifyProgressiveBatch(entities,frame.box(descriptor.bounds),current.entities.filter(e=>!region.entity_ids.includes(e.object_id))))).result;},reviewEndsTurn:false,schedulerStepSlice:12,resultText:()=>finished?'当前区域已由程序核实，后续由Scheduler调度。':verificationSubmitted?'当前区域尚未通过验收，已交回Scheduler，不能报告完成。':undefined};
        const instruction='使用中文，只实际绘制当前区域，不重建工作图、不保存、不重复已确认实体。遵守冻结源布局、全部端子和字面标注；source形态不能被通用标准符号替换。图层先创建。每批最多8项工具操作，程序会在每个有效批次后自动读回及视觉验证；失败会交回Scheduler，不能继续绘制未验证批次。优先局部Patch；最终一批unit_complete=true，或调用cader_finish_drawing_unit的unit_id为区域id。局部修正仅删除/修改本区域实体。不能将整图一次生成。所有点XYZ；图纸布局单位非物理测量值。'+JSON.stringify({task,region:descriptor,cad_bounds:frame.box(descriptor.bounds),plan:region.plan,source:localSource?hints(localSource,image):null,verified_draft_subset:draftGeometry??null,draft_notice:draft?'只允许双重独立观察一致的部分图形，不能作为完整源清点或拓扑通过；遗漏内容和整图仍待验。paths用AcDbLine逐段，圆和文字按实际schema；不能新增未列的几何或猜测连接。':null,anchors:progressive.plan.anchors.filter(a=>a.regions.includes(region.id)).map(a=>({...a,cad:frame.point(a.position)})),existing_entities:lastSnapshot.entities.filter(e=>region.entity_ids.includes(e.object_id)),confirmed_operations:progressive.confirmed_operation_ids});
        while(!finished){
          verificationSubmitted=false;await enter(region.status==='repairing'?'correcting':'drawing');const current=await observe(),committedBefore=owner.facts().operations.filter(op=>op.outcome==='committed').length;const result=await model(instruction+'\n本回合新鲜实体读回（优先于历史快照；只补缺，禁止重放）：'+JSON.stringify(current.entities.filter(e=>region.entity_ids.includes(e.object_id)))+(region.status==='repairing'?'\n只修复本区域已记录缺陷，不能整区重放：'+JSON.stringify({checks:region.checks,last_batch:region.batches.at(-1),last_visual:region.last_review?.structured}):''),request);
          if(result.handoff?.code==='MODEL_SLICE_COMPLETE'){await checkpoint('region_model_slice');const after=await observe();if(same(current.entities,after.entities)&&owner.facts().operations.filter(op=>op.outcome==='committed').length===committedBefore){if(++idleSlices>=3)throw new Error('REGION_NO_PROGRESS');}else idleSlices=0;continue;}
          if(result.handoff?.kind==='verification'&&!verificationSubmitted){
            // A batch handoff is not a request for complete-region acceptance.
            // Permit construction to continue after a verified ACKed prefix;
            // actual failed batch reviews consume the bounded repair allowance.
            const after=await observe();if(same(current.entities,after.entities)&&owner.facts().operations.filter(op=>op.outcome==='committed').length===committedBefore){if(++idleSlices>=3)throw new Error('REGION_NO_PROGRESS');}else idleSlices=0;
            if(region.batches.at(-1)&&region.batches.at(-1)!.status!=='pass'){const last=region.batches.at(-1)!;if(!last.checks.some(c=>c.status==='fail')&&(!last.review?.review_valid||last.review.structured?.verdict==='uncertain'))throw new Error('REGION_VISUAL_EVIDENCE_UNCERTAIN');if(region.repairs>=3)throw new Error('REGION_REPAIR_LIMIT');region.repairs++;round=Math.max(round,region.repairs);region.status='repairing';}
            await checkpoint('batch_control_handoff');continue;
          }
          if(!finished){try{await checkRegion();}catch(error){if(owner.facts().frozen||signal?.aborted)throw error;if(!region.checks?.some(c=>c.status==='fail')&&(!region.last_review?.review_valid||region.last_review.structured?.verdict==='uncertain'))throw new Error('REGION_VISUAL_EVIDENCE_UNCERTAIN');if(region.repairs>=3)throw new Error('REGION_REPAIR_LIMIT');region.repairs++;round=Math.max(round,region.repairs);region.status='repairing';await checkpoint('local_repair');}}
        }
      }catch(error){
        if(owner.facts().frozen||signal?.aborted||taskStops.has((error as Error).message))throw error;
        region.status='blocked';region.failure=(error as Error).message;await persist();emitRegion(region);
        if(/REGION_(?:REFERENCE_FAILED|SOURCE_UNCERTAIN|BOUNDARY_UNCERTAIN)|SOURCE_LABEL_INVENTORY_LIMIT/.test(region.failure)&&!region.entity_ids.length){try{if(await splitRegion(region,descriptor))regionIndex--;}catch(splitError){if(taskStops.has((splitError as Error).message))throw splitError;region.failure+='; refinement: '+(splitError as Error).message;await persist();}}
      }
    }
    progressive.active_region=null;await enter('geometry');
    checks=progressive.regions.map(r=>({id:'region_'+r.id,status:r.status==='verified'?'pass':'not_run',evidence:r.failure??r.status}));
    checks.push({id:'coverage',status:progressive.regions.every(r=>r.status==='verified')?'pass':'not_run',evidence:'Every requested region must be independently verified'});
    if(progressive.regions.every(r=>r.status==='verified')){
      const snapshot=await observe();
      if(sourceIndex&&progressive.source_worklist){
        const work=progressive.source_worklist,summary=sourceWorklistSummary(sourceIndex,work);
        if(!summary.all_verified)throw new Error('SOURCE_WORKLIST_INCOMPLETE');
        checks.push(verifySourceGraph(sourceIndex,work,snapshot.entities));
        const residual=await runtime.compareSourceNative(reference!.image.path,{source:sourceIndex.source,annotation_bounds:((sourceIndex.engine.annotation_blocks??[]) as {bounds:[number,number,number,number]}[]).map(b=>b.bounds),snapshot_sha256:digest(snapshot.entities),document:owner.facts().native_target,entities:snapshot.entities,verified_text_entity_ids:sourceIndex.items.filter(i=>i.kind==='text').flatMap(i=>work.items[i.id]!.entity_ids)},signal);
        work.residual_reviews.push(residual);checks.push({id:'native_source_residual',status:residual.report.geometry_residual_clear?'pass':'fail',evidence:JSON.stringify(residual)});await persist();
      }
      checks.push(...progressive.regions.map(r=>({id:'region_current_'+r.id,status:digest(snapshot.entities.filter(e=>r.entity_ids.includes(e.object_id)))===r.final_sha256?'pass':'not_run',evidence:'Final native readback must match the verified regional checkpoint'} as CheckResult)));
      const anchorChecks=progressive.plan.anchors.map(a=>({id:'anchor_'+a.id,status:a.regions.every(id=>snapshot.entities.some(e=>progressive.regions.find(r=>r.id===id)!.entity_ids.includes(e.object_id)&&[e.start_point,e.end_point].some(p=>Array.isArray(p)&&Math.hypot(p[0]-frame.point(a.position)[0]!,p[1]-frame.point(a.position)[1]!)<1e-5)))?'pass':'not_run',evidence:'Actual endpoints required in every owning region; source appearance/continuity is independently checked by final visual requirements, not inferred from native coincidence'} as CheckResult));checks.push(...anchorChecks);
      await enter('vision');runtime.setVerificationScope('final');
      const finalRequirements=[...plan.requirements.filter(r=>r.check==='visual'),...progressive.plan.anchors.filter(a=>a.certainty==='uncertain').map(a=>({id:'anchor_fidelity_'+a.id,description:'独立核对原图实际边界位置与连接，解决初始概貌中的不确定；不能只凭CAD端点相接判定源图连通：'+JSON.stringify(a)})),...progressive.regions.flatMap(r=>r.uncertainty_review?.filter(i=>i.disposition==='cross_region').map(i=>({id:`deferred_${r.id}_${i.index}`,description:r.source!.structured!.unknowns[i.index]!+'；共享锚点：'+i.anchor_ids.join(',')}))??[])];
      if(finalRequirements.length>32)throw new Error('GLOBAL_REVIEW_SCOPE_TOO_LARGE');
      visual=await runtime.reviewCadView(JSON.stringify({original_request:task,requirements:finalRequirements,regions:progressive.plan.regions,anchors:progressive.plan.anchors,verified_local_evidence:sourceIndex?progressive.regions.map(r=>({region:r.id,status:r.status,image_ref:r.last_review?.image_ref,report_sha256:r.last_review?digest(r.last_review.structured):null,scope_id:(r.last_review?.evidence as any)?.review_scope?.id,source_sha256:progressive.source_sha256,native_checkpoint:r.final_sha256,current:checks.find(c=>c.id==='region_current_'+r.id)?.status==='pass'})):undefined,geometry:checks,entity_snapshot:sourceIndex?{count:snapshot.entities.length,sha256:digest(snapshot.entities),native_details:'Independently checked per source ID; full immutable native snapshot retained by Harness.'}:snapshot.entities,note:'Final complete coverage, shared connections, layout and labels; cross-region uncertainty deferred from a regional gate MUST be resolved here. No partial-region acceptance can override a missing global condition. When verified_local_evidence is present, its complete-source windows already independently checked all visible local detail and labels, and native checkpoints must still match. Integrate those valid closeups with the current overall image; do not replace them with a repeated low-resolution global OCR guess. Actual observed global defects or stale local evidence must still fail.'}),signal,reference?.image.path);
      visualCalls.push({source:'harness',observed_state_hash:digest(snapshot.entities),review:visual});assertEvidenceOutcome(visual);
      const after=await observe();const sourceBound=!reference||(visual.evidence as {reference?:{sha256?:string}}).reference?.sha256===reference.image.sha256;
      const pass=visual.review_valid&&sourceBound&&(visual.evidence as {document?:string}).document===progressive.document&&!(visual.evidence as {image_bounds?:{possible_clipping?:boolean}}).image_bounds?.possible_clipping&&visual.structured?.verdict==='pass'&&finalRequirements.every(r=>visual!.structured!.checklist.some(c=>c.requirement_id===r.id&&c.status==='pass'))&&same(snapshot.entities,after.entities)&&checks.every(c=>c.status==='pass');
      checks.push({id:'global_fidelity',status:pass?'pass':'not_run',evidence:visual.structured?JSON.stringify(visual.structured):'Final visual report invalid'});accepted=pass;
    }
    await checkpoint('global_verification');
  }catch(error){const code=(error as Error).message;failure={stage:phase,code,source:providerFailureCodes.has(code)?'model':'verification'};checks.push({id:'progressive_failure',status:'not_run',evidence:failure.code});}
  finally{
    try{
      if(authorized&&!persistFailed&&!signal?.aborted&&outputPath&&!owner.facts().frozen&&!['SOURCE_RESIDUAL_HELPER_FAILED','SOURCE_HELPER_RESOURCE_EXHAUSTED'].includes(failure?.code??'')&&owner.taskScope(taskId).geometry_confirmed){await enter('saving');artifact=await owner.saveTaskArtifact(taskId,outputPath,options.confirm,signal);await checkpoint('artifact_saved');options.emit({type:'artifact.verified',artifact,quality:accepted?'accepted':'pending'});}
    }catch(error){accepted=false;failure={stage:'saving',code:(error as Error).message,source:'verification'};checks.push({id:'artifact_delivery',status:'not_run',evidence:failure.code});}
    try{await enter(accepted?'complete':owner.facts().frozen?'blocked':'pending_verification');}finally{owner.endTask();}
  }
  return state();
}
function hints(source:ReferenceObservationData,image:{width:number;height:number}){return referenceLayoutHints(source,image);}
