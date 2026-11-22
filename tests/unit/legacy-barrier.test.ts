import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, cp, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { ExecutionSession, InteractiveSession, runTask } from '@cader/profile';
import type { createMcpClient, ToolDefinition } from '@cader/dsh-adapter';

async function fixture() {
  await mkdir('.cader/tests', { recursive: true });
  const root = await mkdtemp(resolve('.cader/tests/barrier-'));
  const run = join(root, '.cader/runs/original');
  const lock = join(root, '.cader/locks/managed-write.json');
  const journal = join(run, 'execution.jsonl');
  await mkdir(run, { recursive: true });
  await mkdir(join(root, '.cader/locks'), { recursive: true });
  const error = { name: 'McpCallError', code: 'MCP_TOOL_FAILED', hresult: null, native_code: null,
    protocol_failure: { error: { message: 'Error executing tool draw_text: 1 validation error for draw_textArguments\nheight\n  Field required [type=missing, input_value={}]' } } };
  const barrier = { frozen: true, request: 'original-request', tool: 'draw_text', target: 'Original.dwg',
    runDirectory: run, stage: 'dispatch', outcome: 'unknown', error };
  const rows = [
    { operation_id: barrier.request, phase: 'prepared', tool: barrier.tool, target: barrier.target, args: { text: 'fixture' } },
    { operation_id: barrier.request, phase: 'frozen', tool: barrier.tool, target: barrier.target, stage: 'dispatch', outcome: 'unknown', dispatched: true, error },
  ];
  async function save() {
    await writeFile(lock, JSON.stringify(barrier));
    await writeFile(journal, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  }
  await save();
  const definitions: ToolDefinition[] = ['draw_text', 'new_drawing', 'query_entities', 'get_backend_status'].map(name => ({
    name: `mcp__autocad__${name}`, description: 'Synthetic MCP schema; never CAD execution',
    parameters: name === 'draw_text' ? { type: 'object', properties: { text: { type: 'string' }, height: { type: 'number' } }, required: ['text', 'height'] } : {},
    output: { schema: { type: 'string' }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }] },
    async execute() { throw new Error('no direct execution'); },
  }));
  const calls: string[] = []; let disposed = 0;
  const factory: typeof createMcpClient = async () => ({ definitions: () => definitions, toolNames: () => definitions.map(d => d.name.split('__').at(-1)!),
    async call(name) { calls.push(name); if (name === 'get_backend_status') return {}; throw new Error('No CAD mutation expected'); }, async dispose() { disposed++; } });
  const owner = new ExecutionSession(root, join(root, '.cader/runs/current'), undefined, factory);
  await owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
  calls.length = 0;
  return { root, run, lock, journal, barrier, rows, save, owner, calls, disposed: () => disposed,
    async cleanup() { await owner.dispose(); await rm(root, { recursive: true }); } };
}

test('legacy review is read-only and requires explicit operator approval in every permission mode', async () => {
  const f = await fixture();
  try {
    const original = await readFile(f.lock, 'utf8');
    const review = await f.owner.reviewLegacyBarrier();
    assert.equal(review.eligible, true); assert.deepEqual(review.missing_fields, ['height']);
    assert.equal(review.native_no_execution_proven, false);
    for (const mode of ['read-only', 'ask', 'workspace-write', 'full-access'] as const) {
      f.owner.mode = mode;
      assert.equal((await f.owner.resolveLegacyBarrier()).reason, 'OPERATOR_CONFIRMATION_REQUIRED');
      assert.equal((await f.owner.resolveLegacyBarrier(async () => false)).reason, 'OPERATOR_DECLINED');
      assert.equal(await readFile(f.lock, 'utf8'), original);
      assert.equal(f.owner.facts().frozen, true);
    }
    assert.equal(f.owner.controlTools().some(tool => /resolve|barrier/.test(tool.name)), false);
    assert.deepEqual(f.calls, []);
  } finally { await f.cleanup(); }
});

test('reviewed legacy retirement preserves original unknown evidence and drops document authority without replay', async () => {
  const f = await fixture();
  try {
    const original = await readFile(f.lock, 'utf8'), journal = await readFile(f.journal, 'utf8');
    let approvals = 0;
    const result = await f.owner.resolveLegacyBarrier(async description => {
      approvals++; assert.match(description, /不是程序证明CAD未执行/); assert.match(description, /height/); return true;
    });
    assert.equal(result.resolved, true); assert.equal(approvals, 1);
    await assert.rejects(readFile(f.lock), { code: 'ENOENT' });
    assert.equal(await readFile(result.archive!, 'utf8'), original);
    assert.equal(await readFile(f.journal, 'utf8'), journal);
    const receipt = JSON.parse(await readFile(result.receipt!, 'utf8'));
    assert.equal(receipt.decision, 'operator_confirmed_no_execution'); assert.equal(receipt.native_no_execution_proven, false);
    assert.equal(await readFile(receipt.auditSnapshot, 'utf8'), journal);
    assert.equal(receipt.evidence.barrier_sha256, createHash('sha256').update(original).digest('hex'));
    assert.equal(JSON.parse(await readFile(result.archive!, 'utf8')).outcome, 'unknown');
    const facts = f.owner.facts();
    assert.equal(facts.frozen, false); assert.equal(facts.scratch, null); assert.equal(facts.local_connection_id, null);
    assert.equal(facts.write_state, 'new_scratch_required'); assert.equal(facts.transport, 'disconnected');
    assert.equal(facts.barrier_resolution?.decision, 'operator_confirmed_no_execution');
    assert.equal(f.disposed(), 1); assert.deepEqual(f.calls, []);
    assert.equal((await f.owner.resolveLegacyBarrier(async () => { throw new Error('no second approval'); })).reason, 'NO_PERSISTED_BARRIER');
  } finally { await f.cleanup(); }
});

test('timeouts, capture failures, native errors, valid args and inconsistent journals cannot be adjudicated', async () => {
  const cases: ((f: Awaited<ReturnType<typeof fixture>>) => void | Promise<void>)[] = [
    f => { f.barrier.error.protocol_failure.error.message = 'TIMEOUT: response lost'; },
    f => { f.barrier.stage = 'capture_dispatch'; },
    f => { Object.assign(f.barrier.error, { hresult: -2147418111 }); },
    f => { Object.assign(f.rows[0]!.args!, { height: 2 }); },
    f => { f.rows[1]!.phase = 'mutation_acknowledged'; },
    f => { f.rows[0]!.target = 'Other.dwg'; },
    f => { Object.assign(f.barrier, { runDirectory: resolve(f.root, '..') }); },
    f => { Object.assign(f.barrier, { owner_pid: process.ppid }); },
    f => { f.barrier.error.protocol_failure.error.message = '1 validation error for draw_textArguments\nwidth\n  Field required [type=missing]'; },
  ];
  for (const mutate of cases) {
    const f = await fixture();
    try {
      await mutate(f); await f.save();
      const original = await readFile(f.lock, 'utf8'); let approvals = 0;
      const result = await f.owner.resolveLegacyBarrier(async () => { approvals++; return true; });
      assert.equal(result.resolved, false); assert.equal(approvals, 0);
      assert.equal(await readFile(f.lock, 'utf8'), original); assert.equal(f.owner.facts().frozen, true);
      assert.deepEqual(f.calls, []);
    } finally { await f.cleanup(); }
  }
});

test('changed evidence and concurrent review refuse release without overwriting the barrier', async () => {
  for (const change of ['barrier', 'audit', 'mutex']) {
    const f = await fixture();
    try {
      if (change === 'mutex') await writeFile(join(f.root, '.cader/locks/barrier-review.lock'), 'another review');
      const result = await f.owner.resolveLegacyBarrier(async () => {
        if (change === 'barrier') await writeFile(f.lock, JSON.stringify({ ...f.barrier, target: 'Changed.dwg' }));
        if (change === 'audit') await writeFile(f.journal, '\n', { flag: 'a' });
        return true;
      });
      assert.equal(result.resolved, false); assert.match(result.reason, /BARRIER_(?:CHANGED|REVIEW_BUSY)/);
      assert.ok(await readFile(f.lock)); assert.equal(f.owner.facts().frozen, true);
      const files = await readdir(join(f.root, '.cader'));
      assert.equal(files.includes('barriers'), false); assert.deepEqual(f.calls, []);
    } finally { await f.cleanup(); }
  }
});

test('known persisted freeze blocks a drawing before model construction and appears at startup without MCP', async () => {
  const f = await fixture();
  try {
    await cp('configs', join(f.root, 'configs'), { recursive: true, filter: path => !/\.local\.(yaml|json)$/.test(path) });
    const phases: unknown[] = [];
    const report = await runTask(f.root, { task: '新建一个画布，绘制一个房子，旁边有棵树', workspaceRoot: f.root,
      permissionMode: 'ask', executionOwner: f.owner, executionTools: [], executionState: () => f.owner.facts(),
      onEvent: event => { if (event.type === 'task.phase') phases.push(event.phase); } },
      async () => { throw new Error('FROZEN_TASK_MUST_NOT_CONSTRUCT_MODEL'); });
    assert.equal(report.model_run_status, 'not_started'); assert.equal(report.run_status, 'succeeded');
    assert.equal(report.task_status, 'blocked'); assert.equal(report.ok, false);
    assert.equal(report.stages.planning, 'not_performed'); assert.equal(report.stages.execution, 'blocked');
    assert.match(report.text, /未调用模型规划/); assert.equal(report.quality?.plan, undefined);
    assert.deepEqual(phases, ['blocked']); assert.deepEqual(f.calls, []);
    const standalone = await runTask(f.root, { task: '绘制一个房子', workspaceRoot: f.root, permissionMode: 'ask' },
      async () => { throw new Error('STANDALONE_FROZEN_TASK_MUST_NOT_START_MODEL'); });
    assert.equal(standalone.model_run_status, 'not_started'); assert.equal(standalone.task_status, 'blocked');
    const chat = await InteractiveSession.create(f.root, f.root);
    try {
      assert.match(chat.startupStatus, /工作区写入已冻结/); assert.match(chat.startupStatus, /draw_text/);
      assert.match(chat.startupStatus, /height/); assert.match(chat.startupStatus, /\/mcp barrier/);
      assert.equal(chat.execution.facts().frozen, true);
    } finally { await chat.dispose(); }
  } finally { await f.cleanup(); }
});

test('interactive legacy commands preview, decline and archive without routing through the Agent', async () => {
  const f = await fixture();
  try {
    await cp('configs', join(f.root, 'configs'), { recursive: true, filter: path => !/\.local\.(yaml|json)$/.test(path) });
    const chat = await InteractiveSession.create(f.root, f.root, async () => { throw new Error('NO_AGENT_FOR_REVIEW'); });
    try {
      await chat.execution.dispose(); chat.execution = f.owner;
      chat.state.mcp = resolve('configs/mcp/AutoCAD.example.yaml');
      const preview = await chat.execute('/mcp barrier'); assert.equal(JSON.parse(preview.text).eligible, true);
      const missing = await chat.execute('/mcp resolve'); assert.equal(missing.error, true); assert.match(missing.text, /OPERATOR_CONFIRMATION_REQUIRED/);
      const declined = await chat.execute('/mcp resolve', { confirm: async () => false }); assert.equal(declined.error, true);
      const approved = await chat.execute('/mcp resolve', { confirm: async () => true }); assert.equal(approved.error, false);
      assert.match(approved.text, /旧图未接管/); assert.equal(chat.state.qualityRun, null);
      assert.ok(f.calls.every(name => name === 'get_backend_status'));
    } finally { await chat.dispose(); }
  } finally { await f.cleanup(); }
});

test('unreadable persisted state fails closed before model construction', async () => {
  const f = await fixture();
  try {
    await writeFile(f.lock, '{broken');
    await assert.rejects(f.owner.loadPersistedBarrier(), /BARRIER_STATE_UNREADABLE/);
    assert.equal(f.owner.facts().frozen, true); assert.equal((await f.owner.reviewLegacyBarrier()).reason, 'INVALID_BARRIER');
    assert.equal((await f.owner.resolveLegacyBarrier(async () => true)).resolved, false);
    assert.equal(await readFile(f.lock, 'utf8'), '{broken');
    assert.deepEqual(f.calls, []);
  } finally { await f.cleanup(); }
});
