import { mkdir, open, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { loadMcp, workspacePath, parseYaml } from '@cader/config';
import { createManagedClient, MANAGED_TOOLS } from '@cader/dsh-adapter';
import { CAD_CONTRACT, CAD_DRAFT_REVISION, Plan, Status, CreateResult, SaveResult, ReopenResult,
  EntityPage, ExecutionPolicy, BusinessOutcome, ManagedRequests, taskStages, verifyEntities } from './cad-contract.js';
import type { DocumentBinding, WorkingDocument } from './cad-contract.js';
import { RequestIntent, auditCadRequest, parseJobForIntent } from './cad-reconciliation.js';
import type { CadIntent } from './cad-reconciliation.js';

export interface CadTransport {
  toolNames(): string[];
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  dispose(): Promise<unknown>;
}
type ClientFactory = (config: Awaited<ReturnType<typeof loadMcp>>) => Promise<CadTransport>;
class Stop extends Error { constructor(readonly code: string) { super(code); this.name = 'CadControlError'; } }
function ensure(condition: unknown, code: string): asserts condition { if (!condition) throw new Stop(code); }
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
async function journal(path: string, record: unknown) {
  const file = await open(path, 'a');
  try { await file.writeFile(JSON.stringify(record) + '\n'); await file.sync(); } finally { await file.close(); }
}

/** Single-owner, program-only orchestration. No model result can authorize a write. */
export async function runControlledCad(root: string, input: { mcpPath: string; planPath: string; output: string;
  backend: string; authorized: boolean }, factory: ClientFactory = createManagedClient) {
  root = await realpath(root);
  await mkdir(resolve(root, '.cader'), { recursive: true });
  const privateRoot = await workspacePath(root, '.cader');
  await mkdir(resolve(privateRoot, 'runs'), { recursive: true });
  const runsRoot = await workspacePath(privateRoot, 'runs');
  const runId = `managed-${randomUUID()}`, directory = resolve(runsRoot, runId);
  await mkdir(directory);
  const stages = taskStages();
  const report = { version: 1, contract_version: 'cader-task/1', ok: false, run_status: 'succeeded', task_status: 'blocked',
    cad_contract: { contract_version: CAD_CONTRACT, draft_revision: CAD_DRAFT_REVISION, revision_mode: null as string | null },
    blocked_reasons: [] as string[], performed_actions: [] as { operation: string; status: 'submitted' | 'confirmed' | 'succeeded' | 'outcome_unknown'; request_id?: string; document_id?: string; revision?: number }[],
    authorization: { user_task_authorized: true, write_authorized: input.authorized, runtime_write_available: false },
    stages, artifact: null as unknown, verification: 'not_performed', runId, runDirectory: directory };
  let client: CadTransport | undefined, binding: WorkingDocument | undefined;
  let lockPath: string | undefined, owned = false, frozen = false;
  let currentStage = 'planning';
  const ledger = resolve(directory, 'requests.jsonl');
  const fail = (code: string) => { throw new Stop(code); };
  try {
    if (!input.authorized) fail('WRITE_AUTHORIZATION_REQUIRED');
    if (input.backend !== 'http') fail('EXPLICIT_HTTP_BACKEND_REQUIRED');
    let plan;
    try { plan = Plan.parse(JSON.parse(await readFile(await workspacePath(root, input.planPath), 'utf8'))); }
    catch { fail('PLAN_INVALID'); }
    if (plan!.purpose === 'image-redraw') fail('IMAGE_PLAN_REQUIRES_INDEPENDENT_REVIEW');
    let policy;
    try { policy = ExecutionPolicy.parse(parseYaml(await readFile(await workspacePath(root, 'configs/cad/execution.yaml'), 'utf8'))); }
    catch { fail('EXECUTION_POLICY_INVALID'); }
    if (!policy!.reviewed_plan_sha256.includes(sha(JSON.stringify(plan)))) fail('PLAN_NOT_REVIEWED');
    if (plan!.operations.some(op => !policy!.allowed_operations.includes(op.operation))) fail('OPERATION_NOT_AUTHORIZED');
    stages.planning = 'succeeded';
    currentStage = 'execution';
    await journal(resolve(directory, 'plan.jsonl'), { plan, plan_sha256: sha(JSON.stringify(plan)) });
    await mkdir(resolve(privateRoot, 'artifacts'), { recursive: true });
    const artifacts = await workspacePath(privateRoot, 'artifacts');
    const output = resolve(root, input.output);
    ensure(dirname(output) === artifacts && /^[A-Za-z0-9_-]+\.dwg$/.test(basename(output)), 'OUTPUT_PATH_NOT_ALLOWED');
    try { await stat(output); fail('OUTPUT_EXISTS'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const config = await loadMcp(resolve(root, input.mcpPath));
    await mkdir(resolve(privateRoot, 'locks'), { recursive: true });
    const locks = await workspacePath(privateRoot, 'locks');
    lockPath = resolve(locks, 'managed-write.json');
    try {
      const lock = await open(lockPath, 'wx');
      try { await lock.writeFile(JSON.stringify({ runId, runDirectory: directory, frozen: false })); await lock.sync(); }
      finally { await lock.close(); }
      owned = true;
    } catch { fail('WORKSPACE_WRITE_LOCKED'); }
    client = await factory(config);
    const raw = await client.call('get_backend_status', {});
    report.performed_actions.push({ operation: 'get_backend_status', status: 'succeeded' });
    if ((raw as { backend?: string })?.backend !== 'http') fail('HTTP_BACKEND_REQUIRED');
    const parsed = Status.safeParse(raw);
    if (!parsed.success) fail('MANAGED_CONTRACT_UNAVAILABLE');
    const status = parsed.data!;
    report.cad_contract.revision_mode = status.revision_mode;
    if (!MANAGED_TOOLS.every(tool => client!.toolNames().includes(tool))) fail('MANAGED_TOOLS_UNAVAILABLE');
    if (plan!.operations.length > status.capabilities.max_batch_operations || plan!.operations.some(op =>
      !status.capabilities.atomic_operations.includes(op.operation))) fail('ATOMIC_OPERATION_UNAVAILABLE');
    report.authorization.runtime_write_available = true;
    const units = plan!.units === 'layout' ? 'unitless' : plan!.units;
    const checkWorking = (doc: WorkingDocument) => ensure(doc.instance_id === status.instance_id && doc.managed && !doc.read_only
      && doc.units === units && resolve(doc.output_directory) === artifacts, 'DOCUMENT_BINDING_MISMATCH');

    async function mutate<T>(tool: 'create_working_document' | 'execute_atomic_batch' | 'save_document_as' | 'reopen_document',
      payload: Record<string, unknown>, validate: (value: unknown, requestId: string, intent: CadIntent) => T): Promise<T> {
      const requestId = randomUUID();
      const args = ManagedRequests[tool].parse({ ...payload, request_id: requestId, instance_id: status.instance_id });
      const intent = RequestIntent.parse({ draft_revision: 2, operation: tool, instance_id: status.instance_id, request_id: requestId,
        request_document_id: 'document_id' in args ? args.document_id : null,
        source_artifact_id: 'artifact_id' in args ? args.artifact_id : null,
        prior_working_document_id: binding?.document_id ?? null, existing_document_ids: status.documents.map(doc => doc.document_id) });
      await journal(ledger, { phase: 'prepared', tool, request_id: requestId, instance_id: status.instance_id,
        request_document_id: intent.request_document_id, expected_revision: 'expected_revision' in args ? args.expected_revision : undefined,
        args, intent, ...auditCadRequest(tool, args) });
      const action = { operation: tool, status: 'submitted' as 'submitted' | 'confirmed' | 'outcome_unknown', request_id: requestId,
        document_id: intent.request_document_id ?? undefined, revision: 'expected_revision' in args ? args.expected_revision : undefined };
      report.performed_actions.push(action);
      try {
        const value = validate(await client!.call(tool, args), requestId, intent);
        await journal(ledger, { phase: 'confirmed', tool, request_id: requestId, result: value });
        action.status = 'confirmed';
        return value;
      } catch {
        frozen = true;
        action.status = 'outcome_unknown';
        stages[currentStage] = 'unknown';
        await writeFile(lockPath!, JSON.stringify({ runId, runDirectory: directory, frozen: true,
          request_id: requestId, instance_id: status.instance_id, request_document_id: intent.request_document_id,
          source_artifact_id: intent.source_artifact_id }));
        await journal(ledger, { phase: 'frozen', tool, request_id: requestId });
        // Only query. Even a terminal answer does not resume the write sequence automatically.
        try {
          const job = parseJobForIntent(await client!.call('get_job_status', { request_id: requestId }), intent);
          await journal(ledger, { phase: 'reconciled', request_id: requestId, job });
          report.performed_actions.push({ operation: 'get_job_status', status: 'succeeded', request_id: requestId });
        } catch { await journal(ledger, { phase: 'reconciliation_unresolved', request_id: requestId }); }
        throw new Stop('OUTCOME_UNKNOWN_FROZEN');
      }
    }

    currentStage = 'execution';
    const created = await mutate('create_working_document', { units, managed: true, output_directory: artifacts }, (value, requestId) => {
      const result = CreateResult.parse(value);
      ensure(result.request_id === requestId, 'REQUEST_ID_MISMATCH');
      checkWorking(result.document);
      ensure(!status.documents.some(doc => doc.document_id === result.document.document_id), 'WORKING_DOCUMENT_NOT_NEW');
      return result.document;
    });
    binding = created;
    ensure((await query(binding)).length === 0, 'WORKING_DOCUMENT_NOT_EMPTY');
    const job = await mutate('execute_atomic_batch', { document_id: binding.document_id,
      expected_revision: binding.revision, operations: plan!.operations }, (value, _requestId, intent) => {
      const result = parseJobForIntent(value, intent);
      if (result.status === 'failed' && ['not_executed', 'rolled_back'].includes(result.outcome)
        && result.revision !== undefined && result.revision >= binding!.revision) return result;
      ensure(result.status === 'succeeded' && result.outcome === 'committed'
        && result.revision! > binding!.revision && result.results?.length === plan!.operations.length
        && new Set(result.results.map(item => item.object_id)).size === plan!.operations.length
        && new Set(result.results.map(item => item.id)).size === plan!.operations.length
        && plan!.operations.every(op => result.results!.some(item => item.id === op.id)), 'WRITE_RESULT_MISMATCH');
      return result;
    });
    binding = { ...binding, revision: job.revision! };
    if (job.status === 'failed') {
      report.verification = 'failed';
      try { ensure((await query(binding)).length === 0, 'ROLLBACK_VERIFICATION_FAILED'); }
      catch {
        frozen = true;
        await writeFile(lockPath!, JSON.stringify({ runId, runDirectory: directory, frozen: true,
          request_id: job.request_id, instance_id: binding.instance_id, request_document_id: binding.document_id,
          reason: 'FAILED_STATE_UNVERIFIED_FROZEN' }));
        await journal(ledger, { phase: 'frozen', request_id: job.request_id, reason: 'FAILED_STATE_UNVERIFIED_FROZEN' });
        fail('FAILED_STATE_UNVERIFIED_FROZEN');
      }
      fail('ATOMIC_BATCH_REJECTED');
    }
    async function query(doc: DocumentBinding) {
      const entities = [];
      let cursor: string | null = null;
      const seen = new Set<string>();
      for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
        const page = EntityPage.parse(await client!.call('query_entities_page', {
          instance_id: doc.instance_id, document_id: doc.document_id, expected_revision: doc.revision, cursor, limit: 1000 }));
        report.performed_actions.push({ operation: 'query_entities_page', status: 'succeeded', document_id: doc.document_id, revision: doc.revision });
        ensure(page.instance_id === doc.instance_id && page.document_id === doc.document_id && page.revision === doc.revision
          && page.unsupported_geometry_types.length === 0, 'QUERY_IDENTITY_OR_TYPES_MISMATCH');
        entities.push(...page.items);
        if (page.next_cursor === null) return entities;
        ensure(!seen.has(page.next_cursor), 'QUERY_CURSOR_REPEATED'); seen.add(page.next_cursor); cursor = page.next_cursor;
      }
      throw new Stop('QUERY_PAGE_LIMIT');
    }
    report.verification = 'failed';
    ensure(verifyEntities(plan!.operations, await query(binding)), 'ENTITY_VERIFICATION_FAILED');
    stages.execution = 'succeeded';
    currentStage = 'saving';
    const artifact = await mutate('save_document_as', { document_id: binding.document_id, expected_revision: binding.revision,
      output_path: output, overwrite: false }, (value, requestId) => {
      const saved = SaveResult.parse(value);
      ensure(saved.request_id === requestId && saved.artifact.instance_id === binding!.instance_id
        && saved.artifact.document_id === binding!.document_id && saved.artifact.revision === binding!.revision
        && resolve(saved.artifact.path) === output, 'SAVED_ARTIFACT_IDENTITY_MISMATCH');
      return saved.artifact;
    });
    ensure(await realpath(output) === output, 'ARTIFACT_PATH_CHANGED');
    const bytes = await readFile(output);
    ensure(bytes.length === artifact.byte_size && sha(bytes) === artifact.sha256 && bytes.subarray(0, 4).toString() === 'AC10', 'ARTIFACT_FILE_MISMATCH');
    report.artifact = artifact;
    stages.saving = 'succeeded';
    currentStage = 'reopening';
    const reopened = await mutate('reopen_document', { artifact_id: artifact.artifact_id }, (value, requestId) => {
      const result = ReopenResult.parse(value);
      ensure(result.request_id === requestId && result.source_artifact_id === artifact.artifact_id, 'REOPEN_ARTIFACT_MISMATCH');
      ensure(result.document.instance_id === status.instance_id && result.document.units === units
        && result.document.source_artifact_id === artifact.artifact_id, 'VERIFICATION_BINDING_MISMATCH');
      ensure(result.document.document_id !== binding!.document_id, 'REOPEN_NOT_INDEPENDENT');
      return result.document;
    });
    ensure(verifyEntities(plan!.operations, await query(reopened)), 'REOPEN_VERIFICATION_FAILED');
    stages.reopening = 'succeeded';
    report.verification = 'passed'; report.task_status = 'succeeded'; report.ok = true;
  } catch (error) {
    const code = error instanceof Stop ? error.code : 'CAD_CONTRACT_OR_TRANSPORT_FAILED';
    report.blocked_reasons.push(code);
    const rejected = /VERIFICATION_FAILED|MISMATCH|QUERY_|FILE_MISMATCH|REJECTED/.test(code);
    report.task_status = rejected ? 'failed' : 'blocked';
    if (stages[currentStage] !== 'unknown') stages[currentStage] = rejected ? 'failed' : 'blocked';
  } finally {
    try { await client?.dispose(); } catch { report.blocked_reasons.push('CLEANUP_FAILED'); report.ok = false; report.run_status = 'failed'; }
    if (owned && !frozen) await unlink(lockPath!);
  }
  BusinessOutcome.parse(report);
  await writeFile(resolve(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

/** Read-only reconciliation: no resume, release, write replay or lock deletion. */
export async function reconcileControlledCad(root: string, runPath: string, mcpPath: string, factory: ClientFactory = createManagedClient) {
  const directory = await workspacePath(await workspacePath(root, '.cader/runs'),
    isAbsolute(runPath) ? runPath : runPath.replace(/\\/g, '/').startsWith('.cader/') ? resolve(root, runPath) : runPath);
  const records = (await readFile(resolve(directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const pending = records.filter(record => record.phase === 'prepared').at(-1);
  const lock = JSON.parse(await readFile(await workspacePath(root, '.cader/locks/managed-write.json'), 'utf8'));
  ensure(pending && resolve(lock.runDirectory) === directory, 'NO_FROZEN_REQUEST');
  ensure(pending.intent?.draft_revision === 2, 'LEGACY_REQUEST_REQUIRES_REVIEW');
  const parsedIntent = RequestIntent.safeParse(pending.intent);
  ensure(parsedIntent.success, 'REQUEST_JOURNAL_MISMATCH');
  const intent = parsedIntent.data;
  const parsedArgs = ManagedRequests[intent.operation].safeParse(pending.args);
  ensure(parsedArgs.success, 'REQUEST_JOURNAL_MISMATCH');
  const args = parsedArgs.data;
  const audit = auditCadRequest(intent.operation, args);
  ensure(pending.tool === intent.operation && pending.instance_id === intent.instance_id && pending.request_id === intent.request_id
    && args.instance_id === intent.instance_id && args.request_id === intent.request_id
    && pending.request_json === audit.request_json && pending.request_sha256 === audit.request_sha256
    && intent.request_document_id === ('document_id' in args ? args.document_id : null)
    && intent.source_artifact_id === ('artifact_id' in args ? args.artifact_id : null), 'REQUEST_JOURNAL_MISMATCH');
  const client = await factory(await loadMcp(resolve(root, mcpPath)));
  try {
    const value = await client.call('get_job_status', { request_id: intent.request_id });
    let job;
    try { job = parseJobForIntent(value, intent); }
    catch { throw new Stop('RECONCILIATION_RESULT_UNVERIFIABLE'); }
    await journal(resolve(directory, 'reconciliation.jsonl'), job);
    return { run_status: 'succeeded', task_status: 'blocked', blocked_reasons: ['FROZEN_REVIEW_REQUIRED'], job,
      replayed: false, lock_released: false };
  } finally { await client.dispose(); }
}
