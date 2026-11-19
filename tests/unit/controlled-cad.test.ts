import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runControlledCad, reconcileControlledCad, Plan, verifyEntities } from '@cader/profile';
import { MANAGED_TOOLS } from '@cader/dsh-adapter';
import type { CadTransport } from '@cader/profile';

async function setup(mode = '') {
  const parent = resolve('.cader/tests'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, 'controlled-'));
  await cp('configs/mcp/AutoCAD.example.yaml', resolve(root, 'mcp.yaml'));
  await cp('benchmark/fixtures/managed-geometry.plan.json', resolve(root, 'plan.json'));
  await cp('configs/cad', resolve(root, 'configs/cad'), { recursive: true });
  const plan = JSON.parse(await readFile(resolve(root, 'plan.json'), 'utf8'));
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const instance = 'fixture-instance'; let document = 'work-1', revision = mode === 'initial-revision' ? 7 : 0, drawn = false;
  let artifact: { artifact_id: string; [key: string]: unknown };
  const query = () => plan.operations.map((op: { operation: string; args: object }, index: number) => ({
    object_id: `entity-${index}`, operation: op.operation, args: structuredClone(op.args),
  }));
  const client: CadTransport = {
    toolNames: () => [...MANAGED_TOOLS], async dispose() {},
    async call(name, args) {
      calls.push({ name, args });
      const envelope = { contract_version: 'cader-cad/1', instance_id: instance, request_id: args.request_id };
      if (name === 'get_backend_status') return mode === 'com' ? { backend: 'com' } : {
        contract_version: 'cader-cad/1', backend: 'http', instance_id: instance,
        revision_mode: mode === 'wrong-revision-mode' ? 'committed_transactions' : 'observed_database_events', documents: [], capabilities: {
          managed_documents: true, save_as: true, reopen: true, job_status: true, query_entities: true,
          atomic_operations: mode === 'missing-op' ? ['draw_line'] : ['draw_line', 'draw_circle', 'draw_text'], max_batch_operations: 100,
        },
      };
      if (name === 'create_working_document') return { contract_version: 'cader-cad/1', request_id: args.request_id,
        status: 'succeeded', document: { instance_id: mode === 'wrong-instance' ? 'other' : instance,
          document_id: document, revision, units: 'unitless', managed: true, read_only: false,
          output_directory: mode === 'wrong-output-directory' ? resolve(root, 'elsewhere') : args.output_directory } };
      if (name === 'execute_atomic_batch') {
        const run = (await readdir(resolve(root, '.cader/runs')))[0]!;
        const ledger = await readFile(resolve(root, '.cader/runs', run, 'requests.jsonl'), 'utf8');
        assert.ok(ledger.includes(String(args.request_id)), 'intent must be durable before dispatch');
        if (mode === 'timeout') throw new Error('provider body must not be persisted');
        const identity = { operation: name, request_document_id: document, result_document_id: document, source_artifact_id: null };
        if (['rollback', 'rollback-advanced', 'rejected-stale', 'rollback-missing-revision', 'rollback-query-error', 'rollback-residue'].includes(mode)) {
          if (mode !== 'rollback') revision += 3;
          return { ...envelope, ...identity, revision: mode === 'rollback-missing-revision' ? undefined : revision, status: 'failed',
            outcome: mode === 'rejected-stale' ? 'not_executed' : 'rolled_back' };
        }
        if (mode !== 'stale-revision') revision++;
        drawn = true;
        return { ...envelope, request_id: mode === 'wrong-request' ? 'other-request' : args.request_id,
          ...identity, revision, status: 'succeeded', outcome: 'committed',
          results: plan.operations.map((op: { id: string }, index: number) => ({ id: op.id, object_id: `entity-${index}`, status: 'succeeded' })) };
      }
      if (name === 'get_job_status') {
        const original = calls.find(call => call.name !== name && call.args.request_id === args.request_id)!;
        return { ...envelope, operation: original.name, request_document_id: original.args.document_id ?? null,
          result_document_id: mode === 'timeout' ? null : document, source_artifact_id: original.args.artifact_id ?? null, revision,
          status: mode === 'timeout' ? 'pending' : 'succeeded', outcome: mode === 'timeout' ? 'unknown' : 'committed' };
      }
      if (name === 'query_entities_page') {
        const afterBatch = calls.some(call => call.name === 'execute_atomic_batch');
        if (mode === 'rollback-query-error' && afterBatch) throw new Error('fixture read failed');
        const items = drawn || (mode === 'rollback-residue' && afterBatch) ? query() : [];
        if (items.length && (mode === 'wrong-geometry' || (mode === 'reopen-mismatch' && document === 'reopened-1'))) items[0].args.end[0]++;
        if (items.length && mode === 'extra-geometry') items[2].args.rotation = 90;
        return { contract_version: 'cader-cad/1', instance_id: instance, document_id: document, revision,
          items, next_cursor: mode === 'cursor-loop' ? 'repeat' : null,
          unsupported_geometry_types: mode === 'unsupported-type' ? ['AcDbArc'] : [] };
      }
      if (name === 'save_document_as') {
        const bytes = Buffer.from('AC1032\nSYNTHETIC FIXTURE, NOT A REAL DWG');
        await writeFile(String(args.output_path), bytes, { flag: 'wx' });
        artifact = { artifact_id: 'file-1', instance_id: instance, document_id: document, revision, path: args.output_path,
          sha256: mode === 'file-hash' ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex'), byte_size: bytes.length };
        return { contract_version: 'cader-cad/1', request_id: args.request_id, status: 'succeeded', artifact };
      }
      if (name === 'reopen_document') {
        document = 'reopened-1'; revision = 0;
        if (mode === 'reopen-timeout') throw new Error('fixture unknown reopen');
        return { contract_version: 'cader-cad/1', request_id: args.request_id, status: 'succeeded', source_artifact_id: artifact.artifact_id,
          document: { instance_id: instance, document_id: document, revision, units: 'unitless', managed: mode === 'writable-reopen',
            read_only: mode !== 'writable-reopen', source_artifact_id: artifact.artifact_id } };
      }
      throw new Error('unexpected tool');
    },
  };
  return { root, client, calls, plan, input: { mcpPath: 'mcp.yaml', planPath: 'plan.json',
    output: '.cader/artifacts/test.dwg', backend: 'http', authorized: true },
  async cleanup() { assert.ok(root.startsWith(parent + sep)); await rm(root, { recursive: true }); } };
}

test('fixed geometry completes program-only create/write/query/save/reopen/query with independent checks', async () => {
  const f = await setup();
  try {
    const report = await runControlledCad(f.root, f.input, async () => f.client);
    assert.equal(report.task_status, 'succeeded', JSON.stringify(report));
    assert.equal(report.verification, 'passed'); assert.equal(report.stages.reopening, 'succeeded');
    assert.deepEqual(f.calls.map(call => call.name), ['get_backend_status', 'create_working_document', 'query_entities_page', 'execute_atomic_batch',
      'query_entities_page', 'save_document_as', 'reopen_document', 'query_entities_page']);
    assert.ok(f.calls.find(call => call.name === 'save_document_as')?.args.overwrite === false);
    assert.equal(f.calls.find(call => call.name === 'create_working_document')?.args.output_directory, resolve(f.root, '.cader/artifacts'));
    assert.ok(f.calls.filter(call => ['execute_atomic_batch', 'save_document_as'].includes(call.name)).every(call => call.args.document_id === 'work-1'));
  } finally { await f.cleanup(); }
});

test('COM, missing atomic operation, missing authorization and path escape block before creating a drawing', async () => {
  for (const mode of ['com', 'missing-op', 'no-auth', 'bad-path', 'wrong-revision-mode']) {
    const f = await setup(mode);
    try {
      const report = await runControlledCad(f.root, { ...f.input, authorized: mode !== 'no-auth',
        output: mode === 'bad-path' ? '../escape.dwg' : f.input.output }, async () => f.client);
      assert.equal(report.task_status, 'blocked');
      assert.ok(!f.calls.some(call => call.name === 'create_working_document'));
    } finally { await f.cleanup(); }
  }
});

test('unknown writes freeze the workspace and reconciliation never replays or releases it', async () => {
  const f = await setup('timeout');
  try {
    const report = await runControlledCad(f.root, f.input, async () => f.client);
    assert.deepEqual(report.blocked_reasons, ['OUTCOME_UNKNOWN_FROZEN']);
    assert.equal(f.calls.filter(call => call.name === 'execute_atomic_batch').length, 1);
    assert.ok(!f.calls.some(call => call.name === 'save_document_as'));
    await cp(resolve(f.root, 'mcp.yaml'), resolve(f.root, 'different-profile.yaml'));
    const again = await runControlledCad(f.root, { ...f.input, mcpPath: 'different-profile.yaml', output: '.cader/artifacts/another.dwg' }, async () => f.client);
    assert.deepEqual(again.blocked_reasons, ['WORKSPACE_WRITE_LOCKED']);
    const outcome = await reconcileControlledCad(f.root, report.runDirectory, 'mcp.yaml', async () => f.client);
    assert.equal(outcome.replayed, false); assert.equal(outcome.lock_released, false);
    assert.equal(f.calls.filter(call => call.name === 'execute_atomic_batch').length, 1);
  } finally { await f.cleanup(); }
});

test('known rollback and stale rejection use authoritative observed revisions, stop writes and verify state', async () => {
  for (const mode of ['rollback', 'rollback-advanced', 'rejected-stale']) {
    const f = await setup(mode);
    try {
    const report = await runControlledCad(f.root, f.input, async () => f.client);
    assert.equal(report.task_status, 'failed');
    assert.deepEqual(report.blocked_reasons, ['ATOMIC_BATCH_REJECTED']);
    assert.ok(f.calls.some(call => call.name === 'query_entities_page'));
    assert.ok(!f.calls.some(call => call.name === 'save_document_as'));
    assert.equal(f.calls.filter(call => call.name === 'query_entities_page').at(-1)?.args.expected_revision, mode === 'rollback' ? 0 : 3);
    } finally { await f.cleanup(); }
  }
});

test('failed requests without authoritative revision or verifiable state keep the workspace frozen', async () => {
  for (const mode of ['rollback-missing-revision', 'rollback-query-error', 'rollback-residue']) {
    const f = await setup(mode);
    try {
      const report = await runControlledCad(f.root, f.input, async () => f.client);
      assert.equal(report.task_status, 'blocked');
      assert.ok(report.blocked_reasons[0]!.endsWith('FROZEN'));
      assert.ok(!f.calls.some(call => call.name === 'save_document_as'));
      const lock = JSON.parse(await readFile(resolve(f.root, '.cader/locks/managed-write.json'), 'utf8'));
      assert.equal(lock.runId, report.runId);
    } finally { await f.cleanup(); }
  }
});

test('reopen reconciliation accepts a new output document and never resumes, replays or unlocks', async () => {
  const f = await setup('reopen-timeout');
  try {
    const report = await runControlledCad(f.root, f.input, async () => f.client);
    assert.deepEqual(report.blocked_reasons, ['OUTCOME_UNKNOWN_FROZEN']);
    const reconciled = await reconcileControlledCad(f.root, report.runDirectory, 'mcp.yaml', async () => f.client);
    assert.equal(reconciled.job.request_document_id, null);
    assert.equal(reconciled.job.result_document_id, 'reopened-1');
    assert.equal(reconciled.job.source_artifact_id, 'file-1');
    assert.equal(reconciled.replayed, false); assert.equal(reconciled.lock_released, false);
    assert.equal(f.calls.filter(call => call.name === 'reopen_document').length, 1);
  } finally { await f.cleanup(); }
});

test('legacy or tampered request journals require review before any reconciliation connection', async () => {
  for (const mode of ['legacy', 'tampered']) {
    const f = await setup('timeout');
    try {
      const report = await runControlledCad(f.root, f.input, async () => f.client);
      const ledgerPath = resolve(report.runDirectory, 'requests.jsonl');
      const records = (await readFile(ledgerPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      const prepared = records.filter(record => record.phase === 'prepared').at(-1);
      if (mode === 'legacy') delete prepared.intent;
      else prepared.args.request_id = 'tampered-request';
      await writeFile(ledgerPath, records.map(record => JSON.stringify(record)).join('\n') + '\n');
      let connected = false;
      await assert.rejects(reconcileControlledCad(f.root, report.runDirectory, 'mcp.yaml', async () => {
        connected = true; return f.client;
      }));
      assert.equal(connected, false);
      assert.ok(await readFile(resolve(f.root, '.cader/locks/managed-write.json'), 'utf8'));
      if (mode === 'legacy') {
        const cli = fileURLToPath(new URL('../../../apps/cli/dist/index.js', import.meta.url));
        const result = spawnSync(process.execPath, [cli, 'cad-reconcile', '--run', report.runDirectory, '--mcp', 'mcp.yaml'],
          { cwd: f.root, encoding: 'utf8', env: { ...process.env, DEEPSEEK_API_KEY: '' } });
        assert.equal(result.status, 3, result.stderr);
        assert.equal(JSON.parse(result.stderr).errorCode, 'LEGACY_REQUEST_REQUIRES_REVIEW');
      }
    } finally { await f.cleanup(); }
  }
});

test('a new work document may start above revision zero in observed-event mode', async () => {
  const f = await setup('initial-revision');
  try {
    const report = await runControlledCad(f.root, f.input, async () => f.client);
    assert.equal(report.task_status, 'succeeded');
    assert.equal(f.calls.find(call => call.name === 'execute_atomic_batch')?.args.expected_revision, 7);
  } finally { await f.cleanup(); }
});

test('unreviewed plans and an existing output are rejected without overwriting', async () => {
  const f = await setup();
  try {
    const changed = structuredClone(f.plan); changed.operations[0].args.end[0] = 99;
    await writeFile(resolve(f.root, 'changed.json'), JSON.stringify(changed));
    const rejected = await runControlledCad(f.root, { ...f.input, planPath: 'changed.json' }, async () => f.client);
    assert.deepEqual(rejected.blocked_reasons, ['PLAN_NOT_REVIEWED']);
    assert.equal(f.calls.length, 0);
    await mkdir(resolve(f.root, '.cader/artifacts'), { recursive: true });
    await writeFile(resolve(f.root, f.input.output), 'original');
    const exists = await runControlledCad(f.root, f.input, async () => f.client);
    assert.deepEqual(exists.blocked_reasons, ['OUTPUT_EXISTS']);
    assert.equal(await readFile(resolve(f.root, f.input.output), 'utf8'), 'original');
  } finally { await f.cleanup(); }
});

test('identity, geometry, file hash and reopened entity defects cannot be reported as task success', async () => {
  for (const mode of ['wrong-instance', 'wrong-output-directory', 'writable-reopen', 'wrong-geometry', 'extra-geometry', 'file-hash', 'reopen-mismatch', 'wrong-request', 'stale-revision', 'unsupported-type', 'cursor-loop']) {
    const f = await setup(mode);
    try {
      const report = await runControlledCad(f.root, f.input, async () => f.client);
      assert.equal(report.ok, false, mode); assert.notEqual(report.verification, 'passed', mode);
      if (['wrong-request', 'stale-revision'].includes(mode)) {
        assert.deepEqual(report.blocked_reasons, ['OUTCOME_UNKNOWN_FROZEN']);
        assert.equal(f.calls.filter(call => call.name === 'execute_atomic_batch').length, 1);
        assert.ok(!f.calls.some(call => call.name === 'save_document_as'));
      }
    } finally { await f.cleanup(); }
  }
});

test('schematic layout is valid without a physical scale; physical plans require evidence', async () => {
  const f = await setup();
  try {
    assert.doesNotThrow(() => Plan.parse(f.plan));
    assert.throws(() => Plan.parse({ ...f.plan, coordinate_mode: 'physical', units: 'mm' }));
    const plan = Plan.parse(f.plan);
    const actual = plan.operations.map(op => ({ object_id: op.id, operation: op.operation, args: op.args }));
    assert.equal(verifyEntities(plan.operations, actual), true);
  } finally { await f.cleanup(); }
});
