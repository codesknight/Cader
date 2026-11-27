import { mkdir, open, readFile, writeFile, unlink, lstat, readdir } from 'node:fs/promises';
import { resolve, relative, dirname, basename, extname, matchesGlob } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createMcpClient, defineTool, inspectCadImageBorder, assertToolArguments, ToolArgumentsError, NativeCreateNotInvokedError, NativeCaptureSafeError, captureEvidence,createToolRuntime, invokeTool } from '@cader/dsh-adapter';
import { comEvidence, parseNativeBinding, observedArguments, parseExecutionEnvelope, receiptOutcome, legacyObservedResult, ObservedMcpCallError, ExecutionReceiptError,parseFileResult } from '@cader/dsh-adapter';
import type { ComEvidence, NativeBinding, ObservedRequest, ExecutionReceipt,ComFileArtifact,VerificationDocument,VerificationQuery } from '@cader/dsh-adapter';
import type { ToolDefinition } from '@cader/dsh-adapter';
import { loadMcp, workspacePath, readReferenceImage } from '@cader/config';
import { runUserShell } from './interactive-shell.js';
import { publishCadInputContract,validateCadArguments,validatePlannedWire } from './cad-arguments.js';
import { environmentRedactor } from './session-store.js';
import type { QualityPlan } from '@cader/config';
import { inspectLegacyBarrier, archiveReviewedBarrier } from './legacy-barrier.js';
import type { BarrierReview } from './legacy-barrier.js';
import {verifyArtifactBytes,verifyReopenBinding,verifyQueryBinding,summaryFingerprint,filePathKey} from './file-artifacts.js';
import type {LocalArtifact,FileVerificationEvidence} from './file-artifacts.js';

export type PermissionMode = 'read-only' | 'ask' | 'workspace-write' | 'full-access';
export const PERMISSION_MODES: PermissionMode[] = ['read-only', 'ask', 'workspace-write', 'full-access'];
const reads = new Set(['get_document_binding', 'get_backend_status', 'list_layers', 'list_blocks', 'list_symbol_library', 'query_entities', 'query_entities_in_region', 'get_entity', 'get_block_attributes']);
const writes = new Set(['new_drawing', 'draw_line', 'draw_circle', 'draw_arc', 'draw_rectangle', 'draw_text', 'draw_polyline', 'draw_mtext', 'draw_hatch', 'add_dimension', 'create_layer', 'set_layer_properties', 'move_entity', 'rotate_entity', 'copy_entity', 'scale_entity', 'mirror_entity', 'delete_entity', 'save_drawing']);
export type Approval = (description: string, cwd: string) => Promise<boolean>;
type Client = Awaited<ReturnType<typeof createMcpClient>>;
type Outcome = 'committed' | 'committed_observation_failed' | 'unknown' | 'blocked_not_dispatched' | 'failed_before_dispatch' | 'read_failed';
export interface CadOperationRecord { operation_id: string; tool_call_id?: string; agent_id?: string; tool: string;
  arguments_sha256?:string;created_entity_ids?:number[];subject_entity_id?:number;
  stage: string; outcome: Outcome; dispatched: boolean; evidence_route?:string; execution_receipt?:ExecutionReceipt; transport_dispatched?:boolean; native_dispatched?:boolean; error?: unknown; target: string | null; duration_ms: number }

/** One owner and one persistent MCP process per interactive workspace. COM retains its
 * scratch document binding; a new client must never inherit write authority. */
export class ExecutionSession {
  private client?: Client;
  private evidence:ComEvidence|null=null;
  private nativeTarget:{instance_id:string;document_id:string}|null=null;
  private lastBinding:NativeBinding|null=null;
  private bindingError:string|null=null;
  private observedRequests=new Map<string,ObservedRequest>();

  private tail: Promise<unknown> = Promise.resolve();
  private scratch: string | null = null;
  private lock?: string;
  private frozen = false;
  private freeze?: { operation_id: string; stage: string; outcome: Outcome; reason: string; sameConnection: boolean };
  private operations: CadOperationRecord[] = [];
  private persistedBarrier?:{tool?:string;error?:unknown};
  private barrierResolution:{operation_id:string;decision:string;archive:string;receipt:string}|null=null;
  private observedAt: string | null = null;
  private observedCount: number | null = null;
  private observedOperationMark = -1;
  private lastArtifact: LocalArtifact | null = null;
  private fileOperations:CadOperationRecord[]=[];
  private verificationDocuments=new Map<string,VerificationDocument>();
  mode: PermissionMode = 'ask';
  private taskGrant?: { id: string; target: string | null; newAllowed: boolean; created: Set<number>; requireNew:boolean; outputPath?:string;plan:QualityPlan;preventDuplicateCreates?:boolean };
  private artifactOwner?:{task:string;connection:string|null;target:string|null};
  private localConnectionId: string | null = null;
  private taskEntities = new Map<string,{connection:string|null;target:string|null;created:Set<number>;startMark:number;newOperation?:string;freshRequired:boolean}>();
  async authorizeTask(id: string, plan: QualityPlan, confirm?: Approval, controls?:{freshDrawing:boolean;outputPath:string}) {
    if(this.mode==='read-only'||this.frozen)return false;
    const prior=this.taskEntities.get(id);
    if(prior&&(prior.connection!==this.localConnectionId||prior.target!==this.scratch))return false;
    if(this.mode==='ask'&&!await confirm?.(this.clean(`CAD 任务级授权\n目标：${prior?.newOperation?'继续本任务已确认工作图 '+this.scratch:controls?'本任务必须新建工作图':this.scratch??'本连接新建工作图'}\n${JSON.stringify(plan)}\n允许：本任务创建图层、绘图、本任务新建实体的局部移动/缩放/删除和视图检查，含最多3轮修正；保存后可只读重开本任务已登记DWG验收，不接管验收图。${controls?`按请求生成DWG：${controls.outputPath}（覆盖他人/已改动文件另行审批）。`:'保存仍按原策略审批。'}删除其他实体、覆盖及Shell仍按原策略审批。`),this.workspace))return false;
    const created=prior?.created??new Set<number>();
    this.taskGrant={id,target:this.scratch,newAllowed:!prior,created,requireNew:Boolean(controls&&!prior?.newOperation),outputPath:controls?.outputPath?resolve(controls.outputPath):undefined,plan:structuredClone(plan)};
    this.taskEntities.set(id,prior??{connection:this.localConnectionId,target:this.scratch,created,startMark:this.operations.length,freshRequired:Boolean(controls)});
    await this.audit({phase:'task_authorized',task_id:id,target:this.scratch,plan});return true;
  }
  endTask(){this.taskGrant=undefined;}
  /** Scheduler refinement never grants new document or entity authority. */
  async refineTaskPlan(id:string,plan:QualityPlan){
    const scope=this.taskScope(id);
    if(this.frozen||this.taskGrant?.id!==id||!scope.owned)throw new Error('TASK_PLAN_REFINEMENT_DENIED');
    this.taskGrant.plan=structuredClone(plan);this.taskGrant.preventDuplicateCreates=true;await this.audit({phase:'task_plan_refined',task_id:id,target:scope.target,plan});
  }
  taskScope(id:string){
    const task=this.taskEntities.get(id),owned=Boolean(task&&task.connection===this.localConnectionId&&task.target===this.scratch);
    const operations=task?this.operations.slice(task.startMark).filter(op=>op.target===task.target):[];
    return {owned,target:task?.target??null,connection:task?.connection??null,
      new_drawing_confirmed:Boolean(owned&&task?.newOperation&&operations.some(op=>op.operation_id===task.newOperation&&op.outcome==='committed')),
      geometry_confirmed:owned?operations.filter(op=>op.outcome==='committed'&&/^(?:draw_|add_dimension|copy_entity|mirror_entity)/.test(op.tool)).length:0,
      entity_ids:owned?[...task!.created]:[]};
  }
  taskArtifact(id:string){
    if(this.frozen||this.artifactOwner?.task!==id||this.artifactOwner.connection!==this.localConnectionId||this.artifactOwner.target!==this.scratch)return null;
    const last=this.operations.filter(op=>op.dispatched).at(-1);
    return last?.tool==='save_drawing'&&last.outcome==='committed'?this.lastArtifact:null;
  }
  async saveTaskArtifact(id:string,path:string,confirm?:Approval,signal?:AbortSignal){
    const scope=this.taskScope(id);
    if(!scope.owned||!scope.new_drawing_confirmed||!scope.geometry_confirmed||this.taskGrant?.id!==id)throw new Error('TASK_EXECUTION_REQUIRED');
    const ctx=await createToolRuntime();
    try{
      const tool=this.definitions(confirm).find(tool=>tool.name.endsWith('__save_drawing'));
      if(!tool)throw new Error('DWG_SAVE_UNAVAILABLE');
      ctx.tools.register(tool);
      const cached=this.taskArtifact(id);
      if(!cached?.file_contract||cached.requested_path!==resolve(path)){
        const result=await invokeTool(ctx,tool.name,{file_path:path},signal);
        if(result.isError)throw new Error('DWG_SAVE_FAILED: '+JSON.stringify(result.error));
      }
      if(!this.lastArtifact||resolve(path)!==(this.lastArtifact.requested_path??this.lastArtifact.path))throw new Error('DWG_ARTIFACT_MISMATCH');
      if(this.lastArtifact.file_contract)return await this.verifyTaskArtifact(id,signal);
      await verifyArtifactBytes(this.lastArtifact.path,{sha256:this.lastArtifact.sha256,byte_size:this.lastArtifact.bytes});
      return {kind:'local-dwg' as const,...this.lastArtifact,document:scope.target,task_id:id,verification:'DWG header, file hash and post-save CAD query; reopen not evaluated'};
    }finally{await ctx.fiber.dispose();}
  }
  async verifyTaskArtifact(id:string,signal?:AbortSignal){return this.serial(async()=>{
    try{
    signal?.throwIfAborted();
    const scope=this.taskScope(id),artifact=this.taskArtifact(id),saved=artifact?.file_contract;
    if(this.frozen||!scope.owned||!scope.new_drawing_confirmed||this.taskGrant?.id!==id||!saved||!this.evidence?.file_artifacts||saved.instance_id!==this.nativeTarget?.instance_id||saved.source_document_id!==this.nativeTarget?.document_id)throw new Error('DWG_OWNED_FILE_ARTIFACT_REQUIRED');
    delete artifact!.file_verification;
    await this.checkIdentity(true);await verifyArtifactBytes(saved.path,saved);
    const before=await this.readBack('query_entities',{}),digest=summaryFingerprint(before);
    let document=this.verificationDocuments.get(saved.artifact_id);
    if(!document){
      document=(await this.fileCall('reopen_document_artifact',{artifact_id:saved.artifact_id},saved.source_document_id,true,signal)).value as VerificationDocument;
      verifyReopenBinding(saved,document);this.verificationDocuments.set(saved.artifact_id,document);
    }
    await verifyArtifactBytes(document.path,document);await this.checkIdentity(true);
    const query=(await this.fileCall('query_verification_entities',{document_id:document.document_id},document.document_id,false,signal)).value as VerificationQuery;
    verifyQueryBinding(saved,document,query);
    if(summaryFingerprint(query.items)!==digest)throw new Error('DWG_REOPEN_SUMMARY_MISMATCH');
    const after=await this.readBack('query_entities',{});await this.checkIdentity(true);
    if(summaryFingerprint(after)!==digest)throw new Error('DWG_WORKING_DOCUMENT_CHANGED_DURING_VERIFICATION');
    await verifyArtifactBytes(saved.path,saved);await verifyArtifactBytes(document.path,document);
    const proof:FileVerificationEvidence={status:'verified',contract:query.contract,geometry_scope:query.geometry_scope,snapshot_revision:null,document,entity_count:query.items.length,summary_sha256:digest,checked_at:new Date().toISOString(),verification:'hash-identical readonly DWG reopen and supported summary comparison; full geometry/semantic verifier remains separate'};
    artifact!.file_verification=proof;
    await this.audit({phase:'file_verified',task_id:id,artifact,verification_query:query,working_summary:after});
    return {kind:'local-dwg' as const,...artifact!,document:scope.target,task_id:id,verification:proof.verification};
    }catch(error){await this.audit({phase:'file_verification_failed',task_id:id,artifact:this.lastArtifact,error:this.diagnostic(error)});throw error;}
  });}
  private async fileCall(operation:string,args:Record<string,unknown>,document:string,mutating:boolean,signal?:AbortSignal){
    signal?.throwIfAborted();
    if(!this.client||!this.evidence?.file_artifacts||this.frozen)throw new Error('DWG_FILE_EXECUTION_UNAVAILABLE');
    const request:ObservedRequest={instance_id:this.evidence.instance_id,request_id:randomUUID(),document_id:document,operation,arguments:args};
    const record:CadOperationRecord={operation_id:request.request_id,tool:operation,target:this.scratch,stage:'file_preflight',outcome:'failed_before_dispatch',dispatched:false,duration_ms:0},started=Date.now();
    try{
      await this.checkIdentity(true);if(mutating)await this.acquire();
      await this.audit({phase:'file_prepared',request:request.request_id,request_json:JSON.stringify(request),request_sha256:createHash('sha256').update(JSON.stringify(request)).digest('hex'),mutating});
      this.observedRequests.set(request.request_id,structuredClone(request));
      signal?.throwIfAborted();record.dispatched=true;record.transport_dispatched=true;record.stage='file_dispatch';
      const result=await this.cadCall(operation,args,request.request_id,request);
      record.execution_receipt=result.receipt;record.native_dispatched=result.receipt?.native_invoked;record.evidence_route=result.route;record.outcome='committed';record.stage='file_confirmed';
      await this.checkIdentity(true);record.duration_ms=Date.now()-started;this.fileOperations.push(record);await this.audit({...record,phase:'file_confirmed',result:result.value});return result;
    }catch(error){
      if(error instanceof ExecutionReceiptError&&error.receipt.request_id===request.request_id){record.execution_receipt=error.receipt;record.native_dispatched=error.receipt.native_invoked;record.outcome=error.outcome;if(error.outcome==='failed_before_dispatch'){record.dispatched=false;record.stage='file_native_preflight';}}
      else if(record.dispatched)record.outcome=record.execution_receipt?.native_acknowledged?'committed_observation_failed':'unknown';
      if(!mutating)record.outcome='read_failed';
      record.error=this.diagnostic(error);record.duration_ms=Date.now()-started;
      if(mutating&&record.dispatched){
        record.stage=record.outcome==='committed_observation_failed'?'file_observation_failed':'file_dispatch';this.frozen=true;this.freeze={operation_id:request.request_id,stage:record.stage,outcome:record.outcome,reason:'CAD_FILE_BARRIER',sameConnection:true};
        await writeFile(this.lock!,this.clean(JSON.stringify({frozen:true,owner_pid:process.pid,runDirectory:this.runDirectory,request:request.request_id,tool:operation,target:this.scratch,stage:record.stage,outcome:record.outcome,error:record.error})));
      }
      this.fileOperations.push(record);await this.audit({...record,phase:'file_failed',artifact:this.lastArtifact});
      throw new Error(this.clean(JSON.stringify({code:'DWG_FILE_VERIFICATION_FAILED',operation,operation_id:request.request_id,outcome:record.outcome,saved_artifact:this.lastArtifact,cause:(error as Error).message,guidance:'Save evidence is retained. Do not replay SaveAs/Open or adopt the verification document. Unknown file dispatch must be reconciled first.'})));
    }
  }
  async snapshot(){return this.serial(async()=>{
    if(!this.client)throw new Error('MCP_NOT_CONNECTED');
    const operationId=randomUUID();
    let entities:unknown;
    try {entities=await this.readBack('query_entities',{},operationId);}
    catch(error){
      await this.audit({phase:'quality_snapshot_failed',operation_id:operationId,tool:'query_entities',target:this.scratch,error:this.diagnostic(error),dispatched:true});
      throw error;
    }
    if(!Array.isArray(entities)){
      await this.audit({phase:'quality_snapshot_failed',operation_id:operationId,tool:'query_entities',target:this.scratch,error:{code:'INVALID_ENTITY_SNAPSHOT'},dispatched:true});
      throw new Error('INVALID_ENTITY_SNAPSHOT');
    }
    this.observedAt=new Date().toISOString();this.observedCount=entities.length;
    this.observedOperationMark=this.operations.length;
    await this.audit({phase:'quality_snapshot',operation_id:operationId,tool:'query_entities',target:this.scratch,observed:entities,document_revision:null});
    return {document:this.scratch,document_revision:null,entities,observed_at:new Date().toISOString()};
  });}
  constructor(readonly workspace: string, readonly runDirectory: string,
    readonly clean: (value: string) => string = environmentRedactor().clean,
    private readonly clientFactory: typeof createMcpClient = createMcpClient) {}
  async loadPersistedBarrier(){
    try {
      const barrier = JSON.parse(await readFile(await workspacePath(this.workspace, '.cader/locks/managed-write.json'), 'utf8'));
      this.persistedBarrier={tool:typeof barrier.tool==='string'?barrier.tool:undefined,error:barrier.error};
      this.frozen = true;
      this.freeze = { operation_id: barrier.request ?? 'external-lock', stage: barrier.stage ?? 'unknown',
        outcome: barrier.outcome ?? 'unknown', reason: 'PERSISTED_OR_EXTERNAL_WRITE_BARRIER', sameConnection: false };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      this.frozen=true;this.freeze={operation_id:'unreadable-barrier',stage:'unknown',outcome:'unknown',reason:'BARRIER_STATE_UNREADABLE',sameConnection:false};
      throw new Error('BARRIER_STATE_UNREADABLE');
    } }
  }
  async connect(path: string) {
    await this.dispose();
    this.observedAt=null;this.observedCount=null;this.observedOperationMark=this.operations.length;
    // A transport reconnect never adopts an old scratch or clears a persisted barrier.
    await this.loadPersistedBarrier();
    this.client = await this.clientFactory(await loadMcp(path));
    this.localConnectionId=randomUUID();
    try{return { connected: true, discovered: this.client.toolNames().length, exposed: this.definitions().length,
      backend: await this.discoverEvidence() };}catch(error){await this.dispose();throw error;}
  }
  async status() { return this.client ? { connected: true, discovered: this.client.toolNames().length,
    exposed: this.definitions().length, scratch: this.scratch, frozen: this.frozen,
    health: this.facts(), backend: await this.client.call('get_backend_status', {}),
    backend_metadata_note:this.evidence?'COM status document labels are cached_not_live; get_document_binding explicitly observes lifecycle identity. revision remains unsupported.':'Legacy COM lifecycle metadata is not a native document query or evidence of disconnection.' } : { connected: false, frozen: this.frozen, health: this.facts(), hint: '/mcp use <configuration>; /mcp tools' }; }
  mark() { return this.operations.length; }
  async reviewLegacyBarrier(){return (await inspectLegacyBarrier(this.workspace,(this.client?.definitions()??[]).filter(tool=>writes.has(tool.name.split('__').at(-1)!)))).review;}
  async resolveLegacyBarrier(confirm?:Approval):Promise<{resolved:boolean;reason:string;review?:BarrierReview;archive?:string;receipt?:string}>{
    return this.serial(async()=>{
      const definitions=(this.client?.definitions()??[]).filter(tool=>writes.has(tool.name.split('__').at(-1)!));
      const snapshot=await inspectLegacyBarrier(this.workspace,definitions),review=snapshot.review;
      if(!review.eligible)return {resolved:false,reason:review.reason,review};
      if(!confirm)return {resolved:false,reason:'OPERATOR_CONFIRMATION_REQUIRED',review};
      const directory=await workspacePath(this.workspace,'.cader/locks'),guardPath=resolve(directory,'barrier-review.lock');
      let guard;
      try{guard=await open(guardPath,'wx');}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return {resolved:false,reason:'BARRIER_REVIEW_BUSY',review};throw error;}
      const token=JSON.stringify({pid:process.pid,token:randomUUID()});
      try{
        await guard.writeFile(token);await guard.sync();
        const approved=await confirm(this.clean(`人工审定历史参数拒绝（仅用户可操作）\n${JSON.stringify(review,null,2)}\n这不是程序证明CAD未执行。仅当你已核查原请求未执行、已结束且没有运行中或延迟的CAD操作时批准。批准将归档原屏障和审计，不改写unknown原记录、不重放请求、不接管旧图；之后只能新建工作图。不能确认请选择否。`),this.workspace);
        if(!approved)return {resolved:false,reason:'OPERATOR_DECLINED',review};
        const latest=await inspectLegacyBarrier(this.workspace,definitions);
        if(!latest.review.eligible||JSON.stringify(latest.review)!==JSON.stringify(review))return {resolved:false,reason:'BARRIER_CHANGED_DURING_REVIEW',review:latest.review};
        // End this transport before retiring the barrier; never adopt its document.
        await this.client?.dispose();this.client=undefined;this.localConnectionId=null;this.scratch=null;
        const archived=await archiveReviewedBarrier(this.workspace,snapshot);
        this.lock=undefined;this.frozen=false;this.freeze=undefined;this.persistedBarrier=undefined;
        this.taskGrant=undefined;this.taskEntities.clear();this.observedAt=null;this.observedCount=null;this.observedOperationMark=this.operations.length;
        this.barrierResolution={operation_id:review.operation_id!,decision:'operator_confirmed_no_execution',archive:archived.archive,receipt:archived.receipt};
        return {resolved:true,reason:'ARCHIVED_AFTER_OPERATOR_REVIEW',review,...archived};
      }finally{
        await guard.close().catch(()=>{});
        try{if(await readFile(guardPath,'utf8')===token)await unlink(guardPath);}catch{/* Keep failed cleanup evidence; never delete another review's guard. */}
      }
    });
  }
  toolAvailable(name: string) { if(this.bindingError&&name.startsWith('mcp__')&&writes.has(name.split('__').at(-1)!))return false;return !this.frozen || (!['cader_shell','cader_apply_cad_patch','cader_review_cad_view','cader_verify_dwg_artifact'].includes(name) && (!name.startsWith('mcp__') || reads.has(name.split('__').at(-1)!))); }
  controlTools(): ToolDefinition[] {
    const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }] };
    return [...(this.evidence?.file_artifacts?[defineTool({name:'cader_verify_dwg_artifact',description:'Read-only reopen and query the saved artifact of this authorized task, using registered identities only. Reuses its verification document; never accepts arbitrary file paths or grants write authority. Compare supported summaries, not full DWG semantics. Scheduler also requires this delivery check.',parameters:{},output,execute:async(_args,exec)=>{if(!this.taskGrant)throw new Error('AUTHORIZED_TASK_REQUIRED');return JSON.stringify(await this.verifyTaskArtifact(this.taskGrant.id,exec.signal));}})]:[]),defineTool({name:'cader_cad_execution_status',description:'Read the original current-session observed request journal, without dispatching or replaying a write. Missing/expired/foreign records do not prove non-execution. This does not lift a write barrier.',parameters:{},output,execute:async()=>JSON.stringify(await this.executionStatus())}),defineTool({ name: 'cader_cad_health', description: 'Read authoritative Cader execution/lock state. COM null status fields mean unavailable metadata, not missing binding.', parameters: {}, output,
      execute: async () => JSON.stringify(await this.status()) }),
    defineTool({ name: 'cader_cad_recover', description: 'Reconcile a mutation already acknowledged on this original connection after a failed observation. Never replays. Unknown dispatch, reconnect and legacy barriers remain frozen.', parameters: {}, output,
      execute: async () => JSON.stringify(await this.recover()) })].filter(tool=>tool.name!=='cader_cad_execution_status'||Boolean(this.evidence));
  }
  async captureView(signal: AbortSignal, confirm?: Approval, view?:import('@cader/dsh-adapter').CadCaptureRequest) {
    return this.serial(async () => {
      signal.throwIfAborted();
      if (!this.client || !this.scratch) throw new Error('NEW_SCRATCH_DRAWING_REQUIRED');
      if (this.frozen) throw new Error('CAD_CAPTURE_BLOCKED_FROZEN');
      if (!this.client.toolNames().includes('export_current_view')) throw new Error('CAD_VIEW_EXPORT_UNAVAILABLE');
      await this.authorize(`CAD export_current_view\nTarget: ${this.scratch}\nExport a private PNG; backend changes viewport/plot settings. No DWG save required.`, false, confirm,false,{name:'export_current_view',payload:{}});
      signal.throwIfAborted();
      await mkdir(this.runDirectory, { recursive: true });
      const path = resolve(await workspacePath(this.workspace, this.runDirectory), `view-${randomUUID()}.png`);
      const exporter=this.client.definitions().find(tool=>tool.name.endsWith('__export_current_view'));
      if(!exporter)throw new ToolArgumentsError('export_current_view',[{path:'/',keyword:'tool',message:'Export definition is unavailable; no request sent'}]);
      const parameters=exporter.parameters as Record<string,any>;
      if(view&&(!parameters.properties?.world_window||!parameters.properties?.min_long_edge))throw new Error('CAD_LOCAL_CAPTURE_UNSUPPORTED');
      const payload={file_path:path,...view};
      assertToolArguments(exporter,payload);
      const operationId = randomUUID();
      const captureStarted = Date.now();
      const evidenceRequest=this.observedRequest('export_current_view',payload,operationId);
      await this.checkIdentity(true);
      await this.acquire();
      await this.audit({ phase: 'capture_prepared', operation_id: operationId, target: this.scratch, path,observed_request:evidenceRequest,request_json:evidenceRequest?JSON.stringify(evidenceRequest):undefined,request_sha256:evidenceRequest?createHash('sha256').update(JSON.stringify(evidenceRequest)).digest('hex'):undefined });
      if(evidenceRequest)this.observedRequests.set(operationId,structuredClone(evidenceRequest));
      let acknowledged = false;
      let receipt:ReturnType<typeof captureEvidence>;
      try {
        const dispatch=await this.cadCall('export_current_view',payload,operationId,evidenceRequest),result=dispatch.value;
        if(dispatch.receipt)await this.audit({phase:'capture_execution_receipt',receipt:dispatch.receipt});
        acknowledged = true;
        const structured=result as {result?:unknown;capture?:unknown};
        if(dispatch.receipt&&(!structured||typeof structured!=='object'||!structured.capture))throw new Error('CAD_CAPTURE_RESTORATION_PROOF_REQUIRED');
        if(structured&&typeof structured==='object'&&structured.capture){
          receipt=captureEvidence(structured.capture,operationId,path,this.lastBinding?.name??this.scratch);
          if(!receipt||receipt.stage!=='complete')throw new Error('CAD_CAPTURE_RECEIPT_INVALID');
        }
        if (resolve(String(receipt?structured.result:result)) !== path) throw new Error('CAD_CAPTURE_PATH_MISMATCH');
        const image = await readReferenceImage(this.workspace, path);
        if(view&&(!receipt?.requested_view||!receipt.actions.some(a=>a.name==='media'&&a.acknowledged)||!receipt.actions.some(a=>a.name==='window'&&a.acknowledged)||JSON.stringify(receipt.requested_view.world_window)!==JSON.stringify(view.world_window)||receipt.requested_view.min_long_edge!==view.min_long_edge||receipt.view_evidence?.configuration_verified!==true||receipt.view_evidence?.projection!=='WCS_XY_TOP'||JSON.stringify(receipt.view_evidence.world_window)!==JSON.stringify(view.world_window)||JSON.stringify(receipt.view_evidence.expected_pixels)!==JSON.stringify([image.width,image.height])||Math.max(image.width,image.height)<view.min_long_edge))throw new Error('CAD_LOCAL_CAPTURE_PROOF_MISMATCH');
        const evidence = { source: 'AutoCAD export_current_view', document: this.scratch, captured_at: new Date().toISOString(),
          sha256: createHash('sha256').update(image.data).digest('hex'), width: image.width, height: image.height,
          image_bounds:await inspectCadImageBorder(path),capture_receipt:receipt??null,
          document_revision: null, view: view?'native WCS window plot':'backend extents plot',view_request:view??null,view_evidence:receipt?.view_evidence??null, pixel_to_cad: null, mapping_note: 'No authoritative pixel-to-CAD transform; locate defects using entity queries before editing.' };
        await this.audit({ phase: 'capture_completed', operation_id: operationId, duration_ms: Date.now() - captureStarted, ...evidence });
        return { path, evidence };
      } catch (error) {
        const observedError=error instanceof ExecutionReceiptError?error:undefined;
        const safe=receipt??(error instanceof NativeCaptureSafeError?captureEvidence(error.evidence,operationId,path,this.lastBinding?.name??this.scratch):observedError&&observedError.outcome!=='unknown'?captureEvidence(observedError.receipt.native_detail,operationId,path,this.lastBinding?.name??this.scratch):undefined);
        const record: CadOperationRecord = { operation_id: operationId, tool: 'export_current_view', target: this.scratch,
          dispatched: true, stage: acknowledged ? 'capture_artifact' : 'capture_dispatch',
          outcome: acknowledged ? 'committed_observation_failed' : 'unknown', duration_ms: Date.now() - captureStarted, error: this.diagnostic(error) };
        if(observedError){record.execution_receipt=observedError.receipt;record.evidence_route='autocad-execution/1';record.native_dispatched=observedError.receipt.native_invoked;record.transport_dispatched=true;record.outcome=observedError.outcome;record.dispatched=observedError.outcome!=='failed_before_dispatch';record.stage=record.dispatched?'capture_observation':'capture_native_preflight';}
        if(observedError?.outcome==='failed_before_dispatch'){this.operations.push(record);await this.audit({...record,phase:'not_dispatched'});throw error;}
        if(safe){
          record.stage=safe.capture_mutations_started?'capture_restored':'capture_preflight';
          record.outcome=safe.capture_mutations_started?'committed_observation_failed':'failed_before_dispatch';
          record.dispatched=safe.capture_mutations_started;record.transport_dispatched=true;record.native_dispatched=safe.capture_mutations_started;
          this.operations.push(record);
          await this.audit({...record,phase:'capture_failed_verified_safe',capture_receipt:safe});
          throw new Error('CAD_CAPTURE_PENDING_VERIFICATION: native receipt proves no plot mutation or complete restoration; image review has not passed');
        }
        if(!acknowledged&&error instanceof ToolArgumentsError){
          record.dispatched=false;record.stage='capture_preflight';record.outcome='failed_before_dispatch';this.operations.push(record);
          await this.audit({...record,phase:'not_dispatched'});throw error;
        }
        this.operations.push(record); this.frozen = true;
        this.freeze = { operation_id: operationId, stage: record.stage, outcome: record.outcome, reason: 'CAD_CAPTURE_BARRIER', sameConnection: true };
        await writeFile(this.lock!, this.clean(JSON.stringify({ ...record, owner_pid:process.pid, frozen: true, runDirectory: this.runDirectory, request: operationId })));
        await this.audit({ ...record, phase: 'capture_failed' });
        throw new Error('CAD_CAPTURE_FAILED_FROZEN: inspect /mcp doctor and original capture audit; no export replay');
      }
    });
  }
  facts(since = 0) {
    const operations = this.operations.slice(since).map(operation => structuredClone(operation));
    const count=(items:CadOperationRecord[])=>Object.fromEntries(['committed','committed_observation_failed','unknown','blocked_not_dispatched','failed_before_dispatch'].map(outcome=>[outcome,items.filter(op=>op.outcome===outcome).length]));
    const stale=this.observedAt===null||this.operations.slice(Math.max(0,this.observedOperationMark)).some(op=>op.dispatched);
    const frozenOperation=this.freeze?[...this.operations,...this.fileOperations].find(op=>op.operation_id===this.freeze!.operation_id):undefined;
    return { frozen: this.frozen, local_connection_id:this.localConnectionId, write_state: this.frozen ? 'frozen' : this.bindingError ? 'binding_mismatch' : this.scratch ? 'scratch_bound' : 'new_scratch_required',
      freeze: this.freeze ?? null, transport: this.client ? 'connected' : 'disconnected',
      cad_observation: { source: 'last_successful_full_query', observed_at: this.observedAt, entity_count: this.observedCount,
        native_identity: this.evidence?'canonical_iunknown_lifecycle; COM revision unsupported':'legacy_COM_name_guard; no authoritative instance/revision', cached: true, scope:'full_document',stale_due_to_mutations:stale,
        interpretation:stale?'Cached count is stale; it does not describe the current drawing. Controlled reads remain available.':'Last full observation; not a native revision guarantee.' },
      scratch: this.scratch, native_target:this.nativeTarget?{...this.nativeTarget}:null,native_binding:this.lastBinding?{...this.lastBinding,observation:'last_verified_not_live'}:null,binding_error:this.bindingError,evidence_support:this.evidence?structuredClone(this.evidence):null,artifact: this.lastArtifact, operations,...(this.fileOperations.length?{file_operations:structuredClone(this.fileOperations),file_counts:count(this.fileOperations.filter(op=>op.tool!=='query_verification_entities'))}:{}),
      counts:count(operations),counts_scope:since===0?'session':'since_operation_mark',operation_mark:since,session_counts:count(this.operations),
      freeze_operation:frozenOperation?structuredClone(frozenOperation):null,
      freeze_evidence:this.freeze?{source:frozenOperation?'current_session':'persisted_barrier',tool:frozenOperation?.tool??this.persistedBarrier?.tool,error:frozenOperation?.error??this.persistedBarrier?.error}:null,
      barrier_resolution:this.barrierResolution,
      recovery:this.recoveryEligibility() };
  }
  private recoveryEligibility(){
    const eligible=Boolean(this.frozen&&this.client&&this.freeze?.sameConnection&&this.freeze.outcome==='committed_observation_failed'&&this.freeze.stage==='postflight'&&(!this.evidence||Boolean(this.nativeTarget&&this.scratch)));
    const fileBarrier=Boolean(this.freeze?.stage.startsWith('file_'));
    return {eligible,reason:!this.frozen?'NOT_FROZEN':fileBarrier?(this.freeze?.outcome==='committed_observation_failed'?'FILE_ACKNOWLEDGED_VERIFICATION_FAILED':'FILE_DISPATCH_OUTCOME_UNCONFIRMED'):eligible?'ACKNOWLEDGED_WRITE_READBACK_FAILED':!this.client||!this.freeze?.sameConnection?'ORIGINAL_CONNECTION_REQUIRED':'DISPATCH_OUTCOME_UNCONFIRMED',
      guidance:!this.frozen?'No recovery is needed.':fileBarrier?'File effects require their original receipt and file/document evidence. Geometry recovery cannot clear this barrier; preserve files and verification documents, never replay SaveAs/Open.':eligible?'Only re-query on the original connection; never replay.':'Repeated recovery, reconnecting or restarting CAD cannot establish a missing acknowledgement. Preserve the barrier; controlled reads remain available.'};
  }
  diagnosticSummary(){
    const facts=this.facts(),observation=facts.cad_observation;
    const error=facts.freeze_evidence?.error as {message?:string;protocol_failure?:{error?:{message?:string}}}|undefined;
    return this.clean([
      `CAD写入状态：${facts.write_state}；MCP传输：${facts.transport}。`,
      `会话累计：确认 ${facts.session_counts.committed}，未知 ${facts.session_counts.unknown}，派发前失败 ${facts.session_counts.failed_before_dispatch}。`,
      ...('file_counts' in facts&&facts.file_counts?[`文件复核操作另记：确认 ${facts.file_counts.committed}，未知 ${facts.file_counts.unknown}，ACK后观测失败 ${facts.file_counts.committed_observation_failed}。`]:[]),
      facts.freeze?`冻结操作：${facts.freeze_evidence?.tool??'见原审计'}；阶段 ${facts.freeze.stage}；结果 ${facts.freeze.outcome}；来源 ${facts.freeze_evidence?.source==='persisted_barrier'?'持久屏障（历史操作不计入本会话累计）':'本会话执行审计'}。`:facts.transport==='disconnected'?'执行连接未建立，尚未核对持久屏障。':'当前没有写屏障。',
      error?`首发错误：${(error.protocol_failure?.error?.message??error.message??'见执行审计').slice(0,800)}`:'',
      `最近全图缓存：${observation.entity_count??'未观测'}，时间 ${observation.observed_at??'无'}；${observation.stale_due_to_mutations?'已过时，不能代表当前实体数':'不是原生revision保证'}。过滤查询不覆盖此全图缓存。`,
      `自动恢复资格：${facts.recovery.eligible?'可在原连接只重查':'不可自动恢复'}（${facts.recovery.reason}）。`,
      facts.frozen?'受控只读查询仍可用；未知写入不重放，重连/重启不会解除屏障。':'',
      this.evidence?`COM生命周期身份：${this.nativeTarget?.document_id??'未绑定工作图'}；状态标签为缓存，实时检查使用get_document_binding；revision不支持。${this.bindingError?' 绑定核对失败，禁止写入：'+this.bindingError:''}`:'COM的not_probed和documents=[]只是生命周期元数据，不代表图纸为空或连接失效。'
    ].filter(Boolean).join('\n'));
  }
  private diagnostic(error: unknown) {
    const e = error as { name?: string; message?: string; code?: unknown; stack?: string; failure?: unknown };
    const native = JSON.stringify(e?.failure ?? e?.message ?? '').match(/\((-?\d{8,}),/);
    const nativeError=error instanceof ExecutionReceiptError?error.receipt.error as {hresult?:unknown}|null:null;
    const hresult=typeof nativeError?.hresult==='number'?nativeError.hresult:native?Number(native[1]):null;
    return JSON.parse(this.clean(JSON.stringify({ name: e?.name, message: e?.message?.slice(0, 4000), code: e?.code,
      hresult, native_code: hresult === -2147418111 ? 'RPC_E_CALL_REJECTED' : null,
      stack: e?.stack?.slice(0, 8000), protocol_failure: e?.failure,execution_receipt:error instanceof ExecutionReceiptError?error.receipt:undefined,client_observation_error:error instanceof ExecutionReceiptError?error.processing_error:undefined })));
  }
  /** Retry only a known transient COM rejection of a READ. A mutation is
   * invoked once regardless of whether its acknowledgement can be observed. */
  private async discoverEvidence(){
    const status=await this.client!.call('get_backend_status',{});
    this.evidence=comEvidence(status,this.client!.toolNames());return status;
  }
  private async checkIdentity(writing=false){
    if(!this.evidence||!this.nativeTarget)return;
    try{
      const binding=parseNativeBinding(await this.client!.call('get_document_binding',{}),this.nativeTarget,writing);
      this.lastBinding=binding;this.bindingError=null;
      await this.audit({phase:'native_binding_checked',binding,writing});
    }catch(error){this.bindingError=(error as Error).message;throw error;}
  }
  private observedRequest(name:string,payload:Record<string,unknown>,requestId:string):ObservedRequest|undefined{
    if(!this.evidence)return;
    if(name==='save_drawing'&&this.evidence.file_artifacts)observedArguments(name,payload); // Preserve rejection of unmapped legacy arguments.
    const mapped=name==='save_drawing'&&this.evidence.file_artifacts?{operation:'save_document_artifact',arguments:{output_directory:dirname(String(payload.file_path)),file_name:basename(String(payload.file_path))}}:observedArguments(name,{...payload,...(name==='export_current_view'?{request_id:requestId}:{})});
    if(!mapped||!this.evidence.operations.includes(mapped.operation))return;
    if(mapped.operation!=='new_document'&&!this.nativeTarget)return; // read-only attached drawing is not adopted.
    return {instance_id:this.evidence.instance_id,request_id:requestId,...mapped,document_id:mapped.operation==='new_document'?null:this.nativeTarget!.document_id};
  }
  private async cadCall(name:string,payload:Record<string,unknown>,requestId:string,prepared?:ObservedRequest){
    const request=prepared??this.observedRequest(name,payload,requestId);
    if(!request)return {value:await this.client!.call(name,payload,requestId),route:'legacy',receipt:undefined as ExecutionReceipt|undefined};
    if(!prepared){const json=JSON.stringify(request);await this.audit({phase:'evidence_request_prepared',request_json:json,request_sha256:createHash('sha256').update(json).digest('hex')});}
    let envelope:unknown,failed=false;
    try{envelope=await this.client!.call('execute_observed_operation',request as unknown as Record<string,unknown>,requestId);}
    catch(error){if(!(error instanceof ObservedMcpCallError))throw error;envelope=error.envelope;failed=true;}
    const result=parseExecutionEnvelope(envelope,request,failed);
    if(result.receipt.stage!=='completed')throw new ExecutionReceiptError(result.receipt,receiptOutcome(result.receipt));
    let value:unknown;
    try{value=request.operation==='save_document_artifact'?parseFileResult(result.result,request,result.receipt):legacyObservedResult(name,result.result,result.receipt);}catch(error){throw new ExecutionReceiptError(result.receipt,'committed_observation_failed',(error as Error).message);}
    if(name==='new_drawing')this.nativeTarget={instance_id:request.instance_id,document_id:result.receipt.result_document_id!};
    return {value,route:'autocad-execution/1',receipt:result.receipt};
  }
  async executionStatus(){return this.serial(async()=>{
    const id=this.freeze?.operation_id??[...this.observedRequests.keys()].at(-1),request=id?this.observedRequests.get(id):undefined;
    if(!this.client||!this.evidence||!request||this.freeze&&!this.freeze.sameConnection)return {recovered:false,reason:'NO_CURRENT_OBSERVED_REQUEST'};
    const value=await this.client.call('get_execution_status',{instance_id:request.instance_id,request_id:request.request_id});
    const raw=value as {status?:string;contract?:string;backend?:string;instance_id?:string;request_id?:string;replay_safe?:boolean};
    if(raw?.status==='unresolved'){
      if(raw.contract!=='autocad-execution/1'||raw.backend!=='com'||raw.instance_id!==request.instance_id||raw.request_id!==request.request_id||raw.replay_safe!==false)throw new Error('MCP_EXECUTION_STATUS_IDENTITY_MISMATCH');
      await this.audit({phase:'execution_status_unresolved',request_id:request.request_id,result:value});return {recovered:false,reason:'RECORD_UNRESOLVED',evidence:value};
    }
    const {receipt}=parseExecutionEnvelope({receipt:value},request);
    const prior=[...this.operations,...this.fileOperations].find(op=>op.operation_id===request.request_id)?.execution_receipt;
    if(prior&&prior.service_request_fingerprint!==receipt.service_request_fingerprint)throw new Error('MCP_EXECUTION_FINGERPRINT_CHANGED');
    await this.audit({phase:'execution_status_observed',request_id:request.request_id,receipt});
    return {recovered:false,replayed:false,reason:'OBSERVATION_ONLY_BARRIER_UNCHANGED',receipt};
  });}
  private async readBack(name:'query_entities'|'get_entity',args:Record<string,unknown>,correlation?:string){
    if(!this.client)throw new Error('MCP_NOT_CONNECTED');
    const baseId=correlation??randomUUID();
    for(let attempt=0;;attempt++){
      try{await this.checkIdentity();const result=await this.cadCall(name,args,attempt?`${baseId}-retry-${attempt}`:baseId);if(result.receipt)await this.audit({phase:'evidence_read_result',receipt:result.receipt});return result.value;}
      catch(error){
        const diagnostic=this.diagnostic(error);
        if(attempt>=3||![-2147418111,-2147417846].includes(diagnostic.hresult))throw error;
        await this.audit({phase:'readonly_retry',tool:name,operation_id:correlation??null,attempt:attempt+1,hresult:diagnostic.hresult});
        await new Promise(resolve=>setTimeout(resolve,250*2**attempt));
      }
    }
  }
  async probe() {
    return this.serial(async () => {
      if (!this.client) throw new Error('MCP_NOT_CONNECTED');
      const entities = await this.readBack('query_entities', {});
      this.observedAt = new Date().toISOString(); this.observedCount = Array.isArray(entities) ? entities.length : null;
      this.observedOperationMark=this.operations.length;
      await this.audit({ phase: 'probe', source: 'query_entities', scratch: this.scratch, entity_count: this.observedCount });
      return { ...this.facts(), note: 'Query succeeded. This does not grant ownership of an existing drawing or prove mutation quiescence.' };
    });
  }
  async recover() {
    return this.serial(async () => {
      if (!this.frozen) {await this.audit({phase:'recovery_refused',reason:'NOT_FROZEN'});return { recovered: false, reason: 'NOT_FROZEN', ...this.facts() };}
      // Only a successful mutation acknowledgement plus a later failed read can be
      // reconciled through this still-owned connection. Dispatch errors/timeouts cannot.
      if (!this.client || !this.freeze?.sameConnection || this.freeze.outcome !== 'committed_observation_failed' || this.freeze.stage !== 'postflight'||this.evidence&&(!this.nativeTarget||!this.scratch)){
        await this.audit({phase:'recovery_refused',operation_id:this.freeze?.operation_id,eligibility:this.recoveryEligibility()});
        return { recovered: false, reason: 'AUTHORITATIVE_OUTCOME_OR_ORIGINAL_CONNECTION_REQUIRED', ...this.facts() };
      }
      try {
        await this.checkIdentity(true);
        const observed = await this.readBack('query_entities', {});
        await this.audit({ phase: 'reconciled', operation_id: this.freeze.operation_id, outcome: 'committed', observed });
        this.observedAt = new Date().toISOString(); this.observedCount = Array.isArray(observed) ? observed.length : null;
        this.observedOperationMark=this.operations.length;
        const op = this.operations.find(op => op.operation_id === this.freeze!.operation_id);
        if (op) { op.outcome = 'committed'; op.stage = 'reconciled'; }
        // Persist ready while retaining our lock until the connection is disposed.
        await writeFile(this.lock!, JSON.stringify({ runDirectory: this.runDirectory, pid: process.pid, frozen: false }));
        this.frozen = false; this.freeze = undefined;
        return { recovered: true, replayed: false, ...this.facts() };
      } catch (error) { await this.audit({ phase: 'reconcile_failed', error: this.diagnostic(error) }); return { recovered: false, ...this.facts() }; }
    });
  }
  private async audit(value: unknown) {
    await mkdir(this.runDirectory, { recursive: true });
    const file = await open(resolve(this.runDirectory, 'execution.jsonl'), 'a');
    try { await file.writeFile(this.clean(JSON.stringify({ at: new Date().toISOString(), ...value as object })) + '\n'); await file.sync(); }
    finally { await file.close(); }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work); this.tail = next.catch(() => {}); return next;
  }
  private async validateDependencies(name:string,payload:Record<string,unknown>,operationId:string){
    const layer=name==='set_layer_properties'?payload.name:payload.layer;
    if(name==='set_layer_properties'&&(typeof layer!=='string'||!layer.trim()))throw new Error('CAD_LAYER_NAME_REQUIRED: no mutation dispatched');
    if(typeof layer!=='string'||!layer.length)return;
    // Read on every explicit layer use. A stale cache cannot authorize a mutation.
    const schema=this.client?.definitions().find(tool=>tool.name.endsWith('__list_layers'));
    if(!schema)throw new Error('CAD_DEPENDENCY_CHECK_UNAVAILABLE: list_layers; no mutation dispatched');
    assertToolArguments(schema,{});
    const layers=await this.client!.call('list_layers',{},operationId+'-layers');
    if(!Array.isArray(layers)||!layers.every(item=>typeof item==='string'))throw new Error('CAD_LAYER_OBSERVATION_INVALID: no mutation dispatched');
    await this.audit({phase:'dependency_checked',operation_id:operationId,tool:name,target:this.scratch,layer,layers});
    if(!layers.some(item=>item.toLocaleLowerCase()===layer.toLocaleLowerCase()))
      throw new Error(`CAD_LAYER_NOT_FOUND: ${layer}; call create_layer first, then retry only the unexecuted operation. No mutation dispatched.`);
  }
  private async authorize(description: string, destructive: boolean, confirm?: Approval, shell = false, cad?:{name:string;payload:Record<string,unknown>}) {
    if (this.mode === 'read-only') throw new Error('READ_ONLY_PERMISSION');
    if(cad?.name==='save_drawing'&&!destructive&&this.taskGrant?.outputPath===resolve(String(cad.payload.file_path)))return;
    if(cad?.name==='delete_entity'&&this.taskGrant?.target===this.scratch&&this.taskGrant?.created.has(Number(cad.payload.object_id)))return;
    if(!destructive&&!shell&&cad&&this.taskGrant&&this.taskGrant.target===this.scratch){
      const safe=new Set(['create_layer','set_layer_properties','draw_line','draw_circle','draw_arc','draw_rectangle','draw_text','draw_mtext','draw_polyline','draw_hatch','add_dimension','export_current_view']);
      if(safe.has(cad.name)||(cad.name==='new_drawing'&&this.taskGrant.newAllowed)||(['move_entity','rotate_entity','scale_entity','copy_entity','mirror_entity'].includes(cad.name)&&this.taskGrant.created.has(Number(cad.payload.object_id))))return;
    }
    if (this.mode === 'full-access' || (this.mode === 'workspace-write' && !destructive && !shell)) return;
    if (!await confirm?.(description, this.workspace)) throw new Error('APPROVAL_REQUIRED_OR_DENIED');
  }
  private async acquire() {
    if (this.frozen) throw new Error('OUTCOME_UNKNOWN_FROZEN');
    if (this.lock) return;
    await mkdir(resolve(this.workspace, '.cader/locks'), { recursive: true });
    const path = await workspacePath(this.workspace, '.cader/locks');
    const lock = resolve(path, 'managed-write.json');
    let file;
    try { file = await open(lock, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        this.frozen = true;
        this.freeze = { operation_id: 'external-lock', stage: 'preflight', outcome: 'blocked_not_dispatched', reason: 'WORKSPACE_WRITE_LOCKED', sameConnection: false };
      }
      throw error;
    }
    try { await file.writeFile(JSON.stringify({ runDirectory: this.runDirectory, pid: process.pid })); await file.sync(); }
    finally { await file.close(); }
    this.lock = lock;
  }
  definitions(confirm?: Approval): ToolDefinition[] {
    return (this.client?.definitions() ?? []).filter(tool => reads.has(tool.name.split('__').at(-1)!) || writes.has(tool.name.split('__').at(-1)!))
      .map(publishCadInputContract)
      .map(tool => ({ ...tool, description:tool.name.endsWith('__save_drawing')&&this.evidence?.file_artifacts?tool.description+' Saves to an exclusive artifact subdirectory under the requested parent; use the returned actual path. SaveAs renames this working document without changing identity. Later saves keep the original requested parent directory; do not use an artifact subdirectory as a new output root. The Scheduler requires independent read-only reopen verification before delivery.':tool.description, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        isConcurrencySafe: () => false,
        execute: async (args, exec) => this.serial(async () => {
          const name = tool.name.split('__').at(-1)!, payload = { ...args as Record<string, unknown> };
          const operationId = randomUUID(), started = Date.now();
          const correlation = { operation_id: operationId, tool_call_id: String(exec.callId), agent_id: exec.agent ? String(exec.agent.id) : undefined };
          if (reads.has(name)) {
            exec.signal.throwIfAborted();
            try {
              assertToolArguments(tool,args);
              await this.checkIdentity();
              const result=name==='get_document_binding'&&this.evidence?parseNativeBinding(await this.client!.call(name,payload,operationId),this.nativeTarget??{instance_id:this.evidence.instance_id}):(await this.cadCall(name,payload,operationId)).value;
              if (name === 'query_entities' && !payload.entity_type) { this.observedAt = new Date().toISOString(); this.observedCount = Array.isArray(result) ? result.length : null; this.observedOperationMark=this.operations.length; }
              await this.audit({ ...correlation, phase: 'read_result', tool: name, args: payload, result, duration_ms: Date.now() - started });
              return JSON.stringify(result);
            } catch (error) { await this.audit({ ...correlation, phase: 'read_failed', tool: name, error: this.diagnostic(error) }); throw error; }
          }
          const record: CadOperationRecord = { ...correlation, tool: name, target: this.scratch, stage: 'preflight', outcome: 'failed_before_dispatch', dispatched: false, duration_ms: 0 };
          if(Number.isSafeInteger(payload.object_id))record.subject_entity_id=Number(payload.object_id);
          let acknowledged = false;
          try {
            exec.signal.throwIfAborted();
            if (this.frozen) { record.outcome = 'blocked_not_dispatched'; throw new Error('CAD_WRITE_BLOCKED_FROZEN_NOT_DISPATCHED'); }
            assertToolArguments(tool,args);
            validateCadArguments(name, payload);
            if(this.taskGrant)validatePlannedWire(name,payload,this.taskGrant.plan);
            if(this.taskGrant?.requireNew&&name!=='new_drawing')throw new Error('NEW_TASK_DRAWING_REQUIRED: call new_drawing before editing; old drawing cannot satisfy this task');
            if(name==='new_drawing'&&this.taskGrant&&!this.taskGrant.newAllowed)throw new Error('TASK_DRAWING_ALREADY_CREATED: continue local editing; do not rebuild');
            if (name !== 'new_drawing' && !this.scratch) throw new Error('NEW_SCRATCH_DRAWING_REQUIRED');
            if(name!=='new_drawing')await this.checkIdentity(true);
            await this.validateDependencies(name,payload,operationId);
            if(name.startsWith('draw_')&&this.taskGrant?.preventDuplicateCreates){
              const properties=(tool.parameters as {properties?:Record<string,{default?:unknown}>}).properties??{},normalized={...Object.fromEntries(Object.entries(properties).filter(([,p])=>Object.hasOwn(p,'default')).map(([key,p])=>[key,p.default])),...payload};
              if('layer' in normalized)normalized.layer=normalized.layer||'0';
              const ordered=(value:any):any=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
              record.arguments_sha256=createHash('sha256').update(JSON.stringify([name,ordered(normalized)])).digest('hex');
              const start=this.taskEntities.get(this.taskGrant.id)!.startMark;
              const prior=this.operations.slice(start).filter(op=>op.outcome==='committed'&&op.tool===name&&op.arguments_sha256===record.arguments_sha256&&op.created_entity_ids?.length);
              for(const op of prior){
                const later=this.operations.slice(this.operations.indexOf(op)+1).filter(l=>l.outcome==='committed'&&/^(?:move_|rotate_|scale_|delete_|mirror_)/.test(l.tool));
                if(op.created_entity_ids!.some(id=>later.some(l=>l.subject_entity_id===id)))continue;
                const actual=await this.readBack('query_entities',{});if(!Array.isArray(actual))throw new Error('CAD_CREATION_RECHECK_FAILED');const present=op.created_entity_ids!.filter(id=>actual.some((e:{object_id:number})=>e.object_id===id));
                if(present.length)throw new Error('CAD_CREATION_ALREADY_COMMITTED: '+JSON.stringify({operation_id:op.operation_id,entity_ids:present,action:'Read back these entities and continue only missing work. Confirmed creation is not replayed.'}));
              }
            }
            let destructive = name === 'delete_entity' || payload.erase_source === true;
            let output: string | undefined;
            if (name === 'save_drawing') {
              if(this.evidence?.file_artifacts&&payload.overwrite===true)throw new Error('P1_ARTIFACTS_NEVER_OVERWRITE: save a new artifact version under the original requested parent');
              if(this.evidence?.file_artifacts&&(/^(?:\\\\|\/\/)/.test(String(payload.file_path))||String(payload.file_path).split(/[\\/]/).includes('..')))throw new Error('P1_LOCAL_PATH_WITHOUT_TRAVERSAL_REQUIRED');
              output = resolve(this.workspace, String(payload.file_path));
              if (extname(output).toLowerCase() !== '.dwg') throw new Error('DWG_OUTPUT_REQUIRED');
              const parent = await import('node:fs/promises').then(fs => fs.realpath(dirname(output!)));
              if(this.evidence?.file_artifacts&&filePathKey(parent)!==filePathKey(dirname(output)))throw new Error('P1_REPARSE_OUTPUT_DIRECTORY_REFUSED');
              output = resolve(parent, basename(output));
              try { const info = await lstat(output); if (!info.isFile() || info.isSymbolicLink()) throw new Error('OUTPUT_TYPE_REFUSED'); destructive = true; }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
              let parentInWorkspace=false;
              try { await workspacePath(this.workspace, parent);parentInWorkspace=true; } catch { destructive = true; }
              if(this.evidence?.file_artifacts&&parentInWorkspace)destructive=false;
              payload.file_path = output; payload.overwrite = this.evidence?.file_artifacts?false:destructive;
              if(destructive&&this.taskGrant?.outputPath===output&&this.artifactOwner?.task===this.taskGrant.id&&
                this.artifactOwner.connection===this.localConnectionId&&this.artifactOwner.target===this.scratch&&this.lastArtifact?.path===output&&
                createHash('sha256').update(await readFile(output)).digest('hex')===this.lastArtifact.sha256)destructive=false;
            }
            await this.authorize(this.clean(`CAD ${name}\n${JSON.stringify(payload)}\nTarget: ${this.scratch ?? 'new scratch drawing'}`), destructive, confirm,false,{name,payload});
            const evidenceRequest=this.observedRequest(name,payload,operationId);
            exec.signal.throwIfAborted();
            if(name!=='new_drawing')await this.checkIdentity(true); // Approval can outlive the document binding.
            await this.acquire();
            await this.audit({ ...record, phase: 'prepared', request: operationId, args: payload,observed_request:evidenceRequest,request_json:evidenceRequest?JSON.stringify(evidenceRequest):undefined,request_sha256:evidenceRequest?createHash('sha256').update(JSON.stringify(evidenceRequest)).digest('hex'):undefined });
            if(evidenceRequest)this.observedRequests.set(operationId,structuredClone(evidenceRequest));
            record.stage = 'dispatch'; record.dispatched = true;record.transport_dispatched=true;
            // Cancellation after dispatch never abandons, automatically retries or replays a mutation.
            const dispatched=await this.cadCall(name,payload,operationId,evidenceRequest),result=dispatched.value;
            record.evidence_route=dispatched.route;record.execution_receipt=dispatched.receipt;record.native_dispatched=dispatched.receipt?.native_invoked;
            acknowledged = true; record.outcome = 'committed'; record.stage = 'acknowledgement';
            if (name === 'new_drawing') this.scratch = String(result);
            if(name==='new_drawing'&&this.taskGrant){this.taskGrant.target=this.scratch;this.taskGrant.newAllowed=false;this.taskGrant.created.clear();}
            if(this.taskGrant){const task=this.taskEntities.get(this.taskGrant.id)!;task.target=this.scratch;
              if(name==='new_drawing'){task.newOperation=operationId;this.taskGrant.requireNew=false;}}
            const createdId=Number(String(result).match(/object_id=(\d+)/)?.[1]);
            record.created_entity_ids=[...new Set([...(Number.isSafeInteger(createdId)&&createdId>0?[createdId]:[]),...dispatched.receipt?.affected_entities.created.map(Number).filter(id=>Number.isSafeInteger(id)&&id>0)??[]])];
            if(this.taskGrant&&/^draw_|^add_dimension$|^copy_entity$|^mirror_entity$/.test(name)&&Number.isSafeInteger(createdId))this.taskGrant.created.add(createdId);
            if(this.taskGrant&&dispatched.receipt&&/^draw_|^add_dimension$|^copy_entity$|^mirror_entity$/.test(name))for(const id of dispatched.receipt.affected_entities.created){const value=Number(id);if(Number.isSafeInteger(value)&&value>0)this.taskGrant.created.add(value);}
            record.target = this.scratch;
            await this.audit({ ...record, phase: 'mutation_acknowledged', result });
            record.stage = 'postflight';
            await this.checkIdentity(true);
            const objectId = Number(payload.object_id ?? String(result).match(/object_id=(\d+)/)?.[1]);
            const targeted = name !== 'delete_entity' && Number.isSafeInteger(objectId) && objectId > 0;
            const observed = targeted ? [await this.readBack('get_entity', { object_id: objectId }, operationId + '-query')]
              : await this.readBack('query_entities', {}, operationId + '-query');
            const observation_scope = targeted ? 'affected_entity' : 'full_document';
            if (!targeted) { this.observedAt = new Date().toISOString(); this.observedCount = Array.isArray(observed) ? observed.length : null; this.observedOperationMark=this.operations.length+1; }
            if(output&&evidenceRequest?.operation==='save_document_artifact')output=(result as ComFileArtifact).path;
            if (output) {
              record.stage = 'artifact_verification';
              const bytes = await readFile(output);
              if (!/^AC10\d\d/.test(bytes.subarray(0, 6).toString('ascii'))) throw new Error('DWG_FILE_VERIFICATION_FAILED');
              this.lastArtifact = { path: output, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),...(evidenceRequest?.operation==='save_document_artifact'?{requested_path:String(payload.file_path),file_contract:result as ComFileArtifact}:{}) };
              if(this.lastArtifact.file_contract)await verifyArtifactBytes(output,this.lastArtifact.file_contract);
              this.artifactOwner=this.taskGrant?{task:this.taskGrant.id,connection:this.localConnectionId,target:this.scratch}:undefined;
            }
            record.stage = 'confirmed'; record.duration_ms = Date.now() - started;
            await this.audit({ ...record, phase: 'confirmed', request: operationId, result, observed, observation_scope, artifact: output ? this.lastArtifact : null });
            this.operations.push(record);
            return JSON.stringify({ operation: record, result, observed, observation_scope, artifact: output ? this.lastArtifact : null,
              verification: 'queried-after-write; geometric/semantic/visual/file-reopen acceptance is separate' });
          } catch (error) {
            if(error instanceof ExecutionReceiptError&&error.receipt.request_id===operationId){
              record.execution_receipt=error.receipt;record.evidence_route='autocad-execution/1';record.native_dispatched=error.receipt.native_invoked;
              acknowledged=error.outcome==='committed_observation_failed';
              if(error.outcome==='failed_before_dispatch'){record.dispatched=false;record.stage='native_preflight';record.outcome='failed_before_dispatch';}
              else if(acknowledged){record.stage=error.receipt.operation==='save_document_artifact'?'file_observation_failed':'postflight';if(this.taskGrant)for(const id of error.receipt.affected_entities.created){const n=Number(id);if(Number.isSafeInteger(n)&&n>0)this.taskGrant.created.add(n);}}
              if(name==='new_drawing'&&error.receipt.native_invoked){this.scratch=null;this.nativeTarget=null;record.target=null;record.stage=acknowledged?'acknowledged_unbound':'dispatch';}
            }
            if(!acknowledged&&name==='new_drawing'&&error instanceof NativeCreateNotInvokedError&&error.requestId===operationId){
              record.dispatched=false;record.native_dispatched=false;record.stage='native_preflight';record.outcome='failed_before_dispatch';
            }
            if(!acknowledged&&error instanceof ToolArgumentsError){record.dispatched=false;record.transport_dispatched=false;record.stage='preflight';record.outcome='failed_before_dispatch';}
            if (!record.dispatched && this.frozen) record.outcome = 'blocked_not_dispatched';
            if(name==='save_drawing'&&this.evidence?.file_artifacts&&record.dispatched)record.stage=acknowledged?'file_observation_failed':'file_dispatch';
            record.error = this.diagnostic(error); record.duration_ms = Date.now() - started;
            if (record.dispatched) {
              record.outcome = acknowledged ? 'committed_observation_failed' : 'unknown'; this.frozen = true;
              this.freeze = { operation_id: operationId, stage: record.stage, outcome: record.outcome, reason: 'CAD_WRITE_BARRIER', sameConnection: true };
              await writeFile(this.lock!, this.clean(JSON.stringify({ frozen: true, owner_pid:process.pid, runDirectory: this.runDirectory,
                request: operationId, tool: name, target: this.scratch, stage: record.stage, outcome: record.outcome, error: record.error })));
            }
            this.operations.push(record);
            await this.audit({ ...record, phase: record.dispatched ? 'frozen' : 'not_dispatched', request: operationId });
            throw new Error(this.clean(JSON.stringify({ code: record.dispatched ? acknowledged ? 'CAD_COMMITTED_OBSERVATION_FAILED' : 'OUTCOME_UNKNOWN_FROZEN' : record.outcome === 'blocked_not_dispatched' ? 'CAD_WRITE_BLOCKED_FROZEN_NOT_DISPATCHED' : 'CAD_FAILED_BEFORE_DISPATCH',
              operation_id: operationId, dispatched: record.dispatched, stage: record.stage, outcome: record.outcome,
              transport_dispatched:record.transport_dispatched??false,native_dispatched:record.native_dispatched,
              cause: (record.error as { protocol_failure?:{error?:{message?:string}};message?: string })?.protocol_failure?.error?.message ?? (record.error as { message?: string })?.message, recovery: this.frozen ? this.recoveryEligibility().guidance : 'Correct arguments or dependencies, or obtain approval before a new request. Never replay committed patch operations.' })));
          }
        }) }));
  }
  fileTools(confirm?: Approval): ToolDefinition[] {
    const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }] };
    const safe = async (path: string, creating = false) => {
      const target = resolve(this.workspace, path);
      if (relative(this.workspace, target).split(/[\\/]/).some(part => /^(?:\.env(?:\..*)?|\.git|\.cader)$/i.test(part))) throw new Error('PRIVATE_PATH_REFUSED');
      const result = creating ? resolve(await workspacePath(this.workspace, dirname(target)), basename(target)) : await workspacePath(this.workspace, target);
      if (relative(this.workspace, result).split(/[\\/]/).some(part => /^(?:\.env(?:\..*)?|\.git|\.cader)$/i.test(part))) throw new Error('PRIVATE_PATH_REFUSED');
      if (/\.(dwg|dxf|dwt|dws)$/i.test(result)) throw new Error('USE_CAD_FILE_TOOLS');
      return result;
    };
    return [defineTool({ name: 'cader_read_file', description: 'Read a UTF-8 workspace file, at most 64 KiB; private configuration excluded.',
      parameters: { path: { type: 'string', required: true } }, output,
      execute: async args => { const path = await safe(args.path); if ((await lstat(path)).size > 65536) throw new Error('FILE_SIZE_LIMIT'); return this.clean(await readFile(path, 'utf8')); } }),
    defineTool({ name: 'cader_list_files', description: 'List one workspace directory. Use directories to explore files; private paths excluded.',
      parameters: { path: { type: 'string', required: true } }, output,
      async execute(args) { return JSON.stringify((await readdir(await safe(args.path))).filter(name => !/^(?:\.env|\.git|\.cader)/i.test(name)).slice(0, 500)); } }),
    defineTool({ name: 'cader_glob', description: 'Find workspace files using a relative glob. Bounded traversal; skips private directories and symlinks.',
      parameters: { pattern: { type: 'string', required: true } }, output,
      execute: async args => {
        if (args.pattern.includes('..') || /^[\\/]|^[A-Za-z]:/.test(args.pattern)) throw new Error('RELATIVE_GLOB_REQUIRED');
        const found: string[] = []; let visited = 0;
        const walk = async (directory: string, prefix: string) => {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (++visited > 5000 || found.length >= 500) return;
            if (entry.isSymbolicLink() || /^(?:\.env|\.git|\.cader|node_modules)/i.test(entry.name)) continue;
            const name = prefix + entry.name;
            if (entry.isDirectory()) await walk(resolve(directory, entry.name), name + '/');
            else if (matchesGlob(name, args.pattern)) found.push(name);
          }
        };
        await walk(this.workspace, ''); return JSON.stringify({ files: found, capped: visited > 5000 || found.length >= 500 });
      } }),
    defineTool({ name: 'cader_edit_file', description: 'Replace exactly one occurrence in a workspace UTF-8 file, with overwrite approval.',
      parameters: { path: { type: 'string', required: true }, old_text: { type: 'string', required: true }, new_text: { type: 'string', required: true } }, output,
      execute: (args, exec) => this.serial(async () => {
        const path = await safe(args.path); if ((await lstat(path)).size > 65536) throw new Error('FILE_SIZE_LIMIT');
        const before = await readFile(path, 'utf8');
        if (!args.old_text || before.split(args.old_text).length !== 2) throw new Error('EXACT_SINGLE_MATCH_REQUIRED');
        const after = before.replace(args.old_text, args.new_text);
        if (Buffer.byteLength(after) > 65536 || this.clean(after) !== after) throw new Error('FILE_CONTENT_REFUSED');
        await this.authorize(this.clean(`Edit ${path}\nReplace:\n${args.old_text}\nWith:\n${args.new_text}`), true, confirm); exec.signal.throwIfAborted();
        if (await readFile(path, 'utf8') !== before) throw new Error('FILE_CHANGED');
        await this.audit({ phase: 'prepared', tool: 'cader_edit_file', path });
        await writeFile(path, after); await this.audit({ phase: 'confirmed', tool: 'cader_edit_file', path }); return 'File edited';
      }) }),
    defineTool({ name: 'cader_write_file', description: 'Create or replace a UTF-8 workspace file with program permission and overwrite approval.',
      parameters: { path: { type: 'string', required: true }, content: { type: 'string', required: true } }, output,
      execute: (args, exec) => this.serial(async () => {
        let path = await safe(args.path, true); let exists = false;
        try { await lstat(path); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (exists) path = await safe(args.path);
        if (Buffer.byteLength(args.content) > 65536 || this.clean(args.content) !== args.content) throw new Error('FILE_CONTENT_REFUSED');
        await this.authorize(this.clean(`Write ${path} (${Buffer.byteLength(args.content)} bytes)\n${args.content}`), exists, confirm);
        exec.signal.throwIfAborted(); await this.audit({ phase: 'prepared', tool: 'cader_write_file', path });
        await writeFile(path, args.content, { flag: exists ? 'w' : 'wx' });
        await this.audit({ phase: 'confirmed', tool: 'cader_write_file', path }); return 'File written';
      }) }),
    defineTool({ name: 'cader_shell', description: 'Run a host shell command in the workspace (not a sandbox). Always asks except full-access; bounded output/time. Output returns to the model.',
      parameters: { command: { type: 'string', required: true } }, output,
      execute: (args, exec) => this.serial(async () => {
        if (this.frozen) throw new Error('CAD_WRITE_BARRIER_AGENT_SHELL_NOT_DISPATCHED');
        await this.authorize(`Agent Shell (host access)\n${this.clean(args.command)}`, true, confirm, true);
        exec.signal.throwIfAborted(); const commandHash = createHash('sha256').update(args.command).digest('hex');
        await this.audit({ phase: 'prepared', tool: 'cader_shell', commandHash });
        const result = await runUserShell(args.command, this.workspace, exec.signal);
        await this.audit({ phase: 'completed', tool: 'cader_shell', commandHash, code: result.code, cancelled: result.cancelled });
        return this.clean(JSON.stringify(result));
      }) })];
  }
  async dispose() {
    await this.tail; await this.client?.dispose(); this.client = undefined; this.scratch = null;
    if (this.lock && !this.frozen) await unlink(this.lock);
    this.lock = undefined;
    this.taskGrant=undefined;this.taskEntities.clear();this.localConnectionId=null;this.evidence=null;this.nativeTarget=null;this.lastBinding=null;this.bindingError=null;this.observedRequests.clear();this.verificationDocuments.clear();
  }
}
