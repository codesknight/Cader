import { mkdir, open, readFile, writeFile, unlink, lstat, readdir } from 'node:fs/promises';
import { resolve, relative, dirname, basename, extname, matchesGlob } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createMcpClient, defineTool, inspectCadImageBorder, assertToolArguments, ToolArgumentsError } from '@cader/dsh-adapter';
import type { ToolDefinition } from '@cader/dsh-adapter';
import { loadMcp, workspacePath, readReferenceImage } from '@cader/config';
import { runUserShell } from './interactive-shell.js';
import { validateCadArguments } from './cad-arguments.js';
import { environmentRedactor } from './session-store.js';
import type { QualityPlan } from '@cader/config';
import { inspectLegacyBarrier, archiveReviewedBarrier } from './legacy-barrier.js';
import type { BarrierReview } from './legacy-barrier.js';

export type PermissionMode = 'read-only' | 'ask' | 'workspace-write' | 'full-access';
export const PERMISSION_MODES: PermissionMode[] = ['read-only', 'ask', 'workspace-write', 'full-access'];
const reads = new Set(['get_backend_status', 'list_layers', 'list_blocks', 'list_symbol_library', 'query_entities', 'query_entities_in_region', 'get_entity', 'get_block_attributes']);
const writes = new Set(['new_drawing', 'draw_line', 'draw_circle', 'draw_arc', 'draw_rectangle', 'draw_text', 'draw_polyline', 'draw_mtext', 'draw_hatch', 'add_dimension', 'create_layer', 'set_layer_properties', 'move_entity', 'rotate_entity', 'copy_entity', 'scale_entity', 'mirror_entity', 'delete_entity', 'save_drawing']);
export type Approval = (description: string, cwd: string) => Promise<boolean>;
type Client = Awaited<ReturnType<typeof createMcpClient>>;
type Outcome = 'committed' | 'committed_observation_failed' | 'unknown' | 'blocked_not_dispatched' | 'failed_before_dispatch';
export interface CadOperationRecord { operation_id: string; tool_call_id?: string; agent_id?: string; tool: string;
  stage: string; outcome: Outcome; dispatched: boolean; error?: unknown; target: string | null; duration_ms: number }

/** One owner and one persistent MCP process per interactive workspace. COM retains its
 * scratch document binding; a new client must never inherit write authority. */
export class ExecutionSession {
  private client?: Client;
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
  private lastArtifact: { path: string; bytes: number; sha256: string } | null = null;
  mode: PermissionMode = 'ask';
  private taskGrant?: { id: string; target: string | null; newAllowed: boolean; created: Set<number> };
  private localConnectionId: string | null = null;
  private taskEntities = new Map<string,{connection:string|null;target:string|null;created:Set<number>}>();
  async authorizeTask(id: string, plan: QualityPlan, confirm?: Approval) {
    if(this.mode==='read-only'||this.frozen)return false;
    if(this.mode==='ask'&&!await confirm?.(this.clean(`CAD 任务级授权\n目标：${this.scratch??'本连接新建工作图'}\n${JSON.stringify(plan)}\n允许：本任务创建图层、绘图、本任务新建实体的局部移动/缩放/删除和视图检查，含最多3轮修正。删除其他实体、覆盖、保存及Shell仍按原策略审批。`),this.workspace))return false;
    const prior=this.taskEntities.get(id);
    if(prior&&(prior.connection!==this.localConnectionId||prior.target!==this.scratch))return false;
    const created=prior?.created??new Set<number>();
    this.taskGrant={id,target:this.scratch,newAllowed:!prior,created};
    this.taskEntities.set(id,{connection:this.localConnectionId,target:this.scratch,created});
    await this.audit({phase:'task_authorized',task_id:id,target:this.scratch,plan});return true;
  }
  endTask(){this.taskGrant=undefined;}
  async snapshot(){return this.serial(async()=>{
    if(!this.client)throw new Error('MCP_NOT_CONNECTED');
    const operationId=randomUUID();
    const entities=await this.client.call('query_entities',{},operationId);
    if(!Array.isArray(entities))throw new Error('INVALID_ENTITY_SNAPSHOT');
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
    return { connected: true, discovered: this.client.toolNames().length, exposed: this.definitions().length,
      backend: await this.client.call('get_backend_status', {}) };
  }
  async status() { return this.client ? { connected: true, discovered: this.client.toolNames().length,
    exposed: this.definitions().length, scratch: this.scratch, frozen: this.frozen,
    health: this.facts(), backend: await this.client.call('get_backend_status', {}),
    backend_metadata_note:'COM not_probed and documents=[] are lifecycle metadata, not a native document query or evidence of disconnection.' } : { connected: false, frozen: this.frozen, health: this.facts(), hint: '/mcp use <configuration>; /mcp tools' }; }
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
  toolAvailable(name: string) { return !this.frozen || (!['cader_shell','cader_apply_cad_patch','cader_review_cad_view'].includes(name) && (!name.startsWith('mcp__') || reads.has(name.split('__').at(-1)!))); }
  controlTools(): ToolDefinition[] {
    const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }] };
    return [defineTool({ name: 'cader_cad_health', description: 'Read authoritative Cader execution/lock state. COM null status fields mean unavailable metadata, not missing binding.', parameters: {}, output,
      execute: async () => JSON.stringify(await this.status()) }),
    defineTool({ name: 'cader_cad_recover', description: 'Reconcile a mutation already acknowledged on this original connection after a failed observation. Never replays. Unknown dispatch, reconnect and legacy barriers remain frozen.', parameters: {}, output,
      execute: async () => JSON.stringify(await this.recover()) })];
  }
  async captureView(signal: AbortSignal, confirm?: Approval) {
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
      assertToolArguments(exporter,{file_path:path});
      await this.acquire();
      const operationId = randomUUID();
      const captureStarted = Date.now();
      await this.audit({ phase: 'capture_prepared', operation_id: operationId, target: this.scratch, path });
      let acknowledged = false;
      try {
        const result = await this.client.call('export_current_view', { file_path: path }, operationId);
        acknowledged = true;
        if (resolve(String(result)) !== path) throw new Error('CAD_CAPTURE_PATH_MISMATCH');
        const image = await readReferenceImage(this.workspace, path);
        const evidence = { source: 'AutoCAD export_current_view', document: this.scratch, captured_at: new Date().toISOString(),
          sha256: createHash('sha256').update(image.data).digest('hex'), width: image.width, height: image.height,
          image_bounds:await inspectCadImageBorder(path),
          document_revision: null, view: 'backend extents plot', pixel_to_cad: null, mapping_note: 'No authoritative pixel-to-CAD transform; locate defects using entity queries before editing.' };
        await this.audit({ phase: 'capture_completed', operation_id: operationId, duration_ms: Date.now() - captureStarted, ...evidence });
        return { path, evidence };
      } catch (error) {
        const record: CadOperationRecord = { operation_id: operationId, tool: 'export_current_view', target: this.scratch,
          dispatched: true, stage: acknowledged ? 'capture_artifact' : 'capture_dispatch',
          outcome: acknowledged ? 'committed_observation_failed' : 'unknown', duration_ms: Date.now() - captureStarted, error: this.diagnostic(error) };
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
    const frozenOperation=this.freeze?this.operations.find(op=>op.operation_id===this.freeze!.operation_id):undefined;
    return { frozen: this.frozen, local_connection_id:this.localConnectionId, write_state: this.frozen ? 'frozen' : this.scratch ? 'scratch_bound' : 'new_scratch_required',
      freeze: this.freeze ?? null, transport: this.client ? 'connected' : 'disconnected',
      cad_observation: { source: 'last_successful_full_query', observed_at: this.observedAt, entity_count: this.observedCount,
        native_identity: 'legacy_COM_name_guard; no authoritative instance/revision', cached: true, scope:'full_document',stale_due_to_mutations:stale,
        interpretation:stale?'Cached count is stale; it does not describe the current drawing. Controlled reads remain available.':'Last full observation; not a native revision guarantee.' },
      scratch: this.scratch, artifact: this.lastArtifact, operations,
      counts:count(operations),counts_scope:since===0?'session':'since_operation_mark',operation_mark:since,session_counts:count(this.operations),
      freeze_operation:frozenOperation?structuredClone(frozenOperation):null,
      freeze_evidence:this.freeze?{source:frozenOperation?'current_session':'persisted_barrier',tool:frozenOperation?.tool??this.persistedBarrier?.tool,error:frozenOperation?.error??this.persistedBarrier?.error}:null,
      barrier_resolution:this.barrierResolution,
      recovery:this.recoveryEligibility() };
  }
  private recoveryEligibility(){
    const eligible=Boolean(this.frozen&&this.client&&this.freeze?.sameConnection&&this.freeze.outcome==='committed_observation_failed'&&this.freeze.stage==='postflight');
    return {eligible,reason:!this.frozen?'NOT_FROZEN':eligible?'ACKNOWLEDGED_WRITE_READBACK_FAILED':!this.client||!this.freeze?.sameConnection?'ORIGINAL_CONNECTION_REQUIRED':'DISPATCH_OUTCOME_UNCONFIRMED',
      guidance:!this.frozen?'No recovery is needed.':eligible?'Only re-query on the original connection; never replay.':'Repeated recovery, reconnecting or restarting CAD cannot establish a missing acknowledgement. Preserve the barrier; controlled reads remain available.'};
  }
  diagnosticSummary(){
    const facts=this.facts(),observation=facts.cad_observation;
    const error=facts.freeze_evidence?.error as {message?:string;protocol_failure?:{error?:{message?:string}}}|undefined;
    return this.clean([
      `CAD写入状态：${facts.write_state}；MCP传输：${facts.transport}。`,
      `会话累计：确认 ${facts.session_counts.committed}，未知 ${facts.session_counts.unknown}，派发前失败 ${facts.session_counts.failed_before_dispatch}。`,
      facts.freeze?`冻结操作：${facts.freeze_evidence?.tool??'见原审计'}；阶段 ${facts.freeze.stage}；结果 ${facts.freeze.outcome}；来源 ${facts.freeze_evidence?.source==='persisted_barrier'?'持久屏障（历史操作不计入本会话累计）':'本会话执行审计'}。`:facts.transport==='disconnected'?'执行连接未建立，尚未核对持久屏障。':'当前没有写屏障。',
      error?`首发错误：${(error.protocol_failure?.error?.message??error.message??'见执行审计').slice(0,800)}`:'',
      `最近全图缓存：${observation.entity_count??'未观测'}，时间 ${observation.observed_at??'无'}；${observation.stale_due_to_mutations?'已过时，不能代表当前实体数':'不是原生revision保证'}。过滤查询不覆盖此全图缓存。`,
      `自动恢复资格：${facts.recovery.eligible?'可在原连接只重查':'不可自动恢复'}（${facts.recovery.reason}）。`,
      facts.frozen?'受控只读查询仍可用；未知写入不重放，重连/重启不会解除屏障。':'',
      'COM的not_probed和documents=[]只是生命周期元数据，不代表图纸为空或连接失效。'
    ].filter(Boolean).join('\n'));
  }
  private diagnostic(error: unknown) {
    const e = error as { name?: string; message?: string; code?: unknown; stack?: string; failure?: unknown };
    const native = JSON.stringify(e?.failure ?? e?.message ?? '').match(/\((-?\d{8,}),/);
    const hresult = native ? Number(native[1]) : null;
    return JSON.parse(this.clean(JSON.stringify({ name: e?.name, message: e?.message?.slice(0, 4000), code: e?.code,
      hresult, native_code: hresult === -2147418111 ? 'RPC_E_CALL_REJECTED' : null,
      stack: e?.stack?.slice(0, 8000), protocol_failure: e?.failure })));
  }
  async probe() {
    return this.serial(async () => {
      if (!this.client) throw new Error('MCP_NOT_CONNECTED');
      const entities = await this.client.call('query_entities', {});
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
      if (!this.client || !this.freeze?.sameConnection || this.freeze.outcome !== 'committed_observation_failed' || this.freeze.stage !== 'postflight'){
        await this.audit({phase:'recovery_refused',operation_id:this.freeze?.operation_id,eligibility:this.recoveryEligibility()});
        return { recovered: false, reason: 'AUTHORITATIVE_OUTCOME_OR_ORIGINAL_CONNECTION_REQUIRED', ...this.facts() };
      }
      try {
        const observed = await this.client.call('query_entities', {});
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
  private async authorize(description: string, destructive: boolean, confirm?: Approval, shell = false, cad?:{name:string;payload:Record<string,unknown>}) {
    if (this.mode === 'read-only') throw new Error('READ_ONLY_PERMISSION');
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
      .map(tool => ({ ...tool, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        isConcurrencySafe: () => false,
        execute: async (args, exec) => this.serial(async () => {
          const name = tool.name.split('__').at(-1)!, payload = { ...args as Record<string, unknown> };
          const operationId = randomUUID(), started = Date.now();
          const correlation = { operation_id: operationId, tool_call_id: String(exec.callId), agent_id: exec.agent ? String(exec.agent.id) : undefined };
          if (reads.has(name)) {
            exec.signal.throwIfAborted();
            try {
              assertToolArguments(tool,args);
              const result = await this.client!.call(name, payload, operationId);
              if (name === 'query_entities' && !payload.entity_type) { this.observedAt = new Date().toISOString(); this.observedCount = Array.isArray(result) ? result.length : null; this.observedOperationMark=this.operations.length; }
              await this.audit({ ...correlation, phase: 'read_result', tool: name, args: payload, result, duration_ms: Date.now() - started });
              return JSON.stringify(result);
            } catch (error) { await this.audit({ ...correlation, phase: 'read_failed', tool: name, error: this.diagnostic(error) }); throw error; }
          }
          const record: CadOperationRecord = { ...correlation, tool: name, target: this.scratch, stage: 'preflight', outcome: 'failed_before_dispatch', dispatched: false, duration_ms: 0 };
          let acknowledged = false;
          try {
            exec.signal.throwIfAborted();
            if (this.frozen) { record.outcome = 'blocked_not_dispatched'; throw new Error('CAD_WRITE_BLOCKED_FROZEN_NOT_DISPATCHED'); }
            assertToolArguments(tool,args);
            validateCadArguments(name, payload);
            if (name !== 'new_drawing' && !this.scratch) throw new Error('NEW_SCRATCH_DRAWING_REQUIRED');
            let destructive = name === 'delete_entity' || payload.erase_source === true;
            let output: string | undefined;
            if (name === 'save_drawing') {
              output = resolve(this.workspace, String(payload.file_path));
              if (extname(output).toLowerCase() !== '.dwg') throw new Error('DWG_OUTPUT_REQUIRED');
              const parent = await import('node:fs/promises').then(fs => fs.realpath(dirname(output!)));
              output = resolve(parent, basename(output));
              try { const info = await lstat(output); if (!info.isFile() || info.isSymbolicLink()) throw new Error('OUTPUT_TYPE_REFUSED'); destructive = true; }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
              try { await workspacePath(this.workspace, parent); } catch { destructive = true; }
              payload.file_path = output; payload.overwrite = destructive;
            }
            await this.authorize(this.clean(`CAD ${name}\n${JSON.stringify(payload)}\nTarget: ${this.scratch ?? 'new scratch drawing'}`), destructive, confirm,false,{name,payload});
            exec.signal.throwIfAborted(); await this.acquire();
            await this.audit({ ...record, phase: 'prepared', request: operationId, args: payload });
            record.stage = 'dispatch'; record.dispatched = true;
            // Cancellation after dispatch never abandons, automatically retries or replays a mutation.
            const result = await this.client!.call(name, payload, operationId);
            acknowledged = true; record.outcome = 'committed'; record.stage = 'acknowledgement';
            if (name === 'new_drawing') this.scratch = String(result);
            if(name==='new_drawing'&&this.taskGrant){this.taskGrant.target=this.scratch;this.taskGrant.newAllowed=false;this.taskGrant.created.clear();}
            if(this.taskGrant)this.taskEntities.get(this.taskGrant.id)!.target=this.scratch;
            const createdId=Number(String(result).match(/object_id=(\d+)/)?.[1]);
            if(this.taskGrant&&/^draw_|^copy_entity$|^mirror_entity$/.test(name)&&Number.isSafeInteger(createdId))this.taskGrant.created.add(createdId);
            record.target = this.scratch;
            await this.audit({ ...record, phase: 'mutation_acknowledged', result });
            record.stage = 'postflight';
            const objectId = Number(payload.object_id ?? String(result).match(/object_id=(\d+)/)?.[1]);
            const targeted = name !== 'delete_entity' && Number.isSafeInteger(objectId) && objectId > 0;
            const observed = targeted ? [await this.client!.call('get_entity', { object_id: objectId }, operationId + '-query')]
              : await this.client!.call('query_entities', {}, operationId + '-query');
            const observation_scope = targeted ? 'affected_entity' : 'full_document';
            if (!targeted) { this.observedAt = new Date().toISOString(); this.observedCount = Array.isArray(observed) ? observed.length : null; this.observedOperationMark=this.operations.length+1; }
            if (output) {
              record.stage = 'artifact_verification';
              const bytes = await readFile(output);
              if (!/^AC10\d\d/.test(bytes.subarray(0, 6).toString('ascii'))) throw new Error('DWG_FILE_VERIFICATION_FAILED');
              this.lastArtifact = { path: output, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
            }
            record.stage = 'confirmed'; record.duration_ms = Date.now() - started;
            await this.audit({ ...record, phase: 'confirmed', request: operationId, result, observed, observation_scope, artifact: output ? this.lastArtifact : null });
            this.operations.push(record);
            return JSON.stringify({ operation: record, result, observed, observation_scope, artifact: output ? this.lastArtifact : null,
              verification: 'queried-after-write; geometric/semantic/visual/file-reopen acceptance is separate' });
          } catch (error) {
            if(!acknowledged&&error instanceof ToolArgumentsError){record.dispatched=false;record.stage='preflight';record.outcome='failed_before_dispatch';}
            if (!record.dispatched && this.frozen) record.outcome = 'blocked_not_dispatched';
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
              cause: (record.error as { message?: string })?.message, recovery: this.frozen ? this.recoveryEligibility().guidance : 'Correct arguments or obtain approval before a new request.' })));
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
    this.taskGrant=undefined;this.taskEntities.clear();this.localConnectionId=null;
  }
}
