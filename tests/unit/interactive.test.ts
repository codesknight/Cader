import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { resolve, sep, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { InteractiveSession, runTask, SafeTextStream } from '@cader/profile';
import type { TaskRunner } from '@cader/profile';
import { createLiveRuntime } from '@cader/dsh-adapter';
import type { StreamChunk } from '@cader/dsh-adapter';

async function setup() {
  const parent = resolve('.cader/tests'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'tui-'));
  await cp('configs', join(root, 'configs'), { recursive: true, filter: path => !/\.local\.(yaml|json)$/.test(path) });
  await cp('benchmark/fixtures/vision-calibration.png', join(root, 'draft.png'));
  await cp('benchmark/fixtures/vision-calibration.png', join(root, 'drawing with space.png'));
  await writeFile(join(root, 'test.dwg'), 'AC1032 fixture header only; never open in CAD');
  return { root, async cleanup() { assert.ok(root.startsWith(parent + sep)); await rm(root, { recursive: true }); } };
}

test('interactive selections, references, paths, sessions and checkpoints never invent CAD execution', async () => {
  const f = await setup(); let dispatched = 0;
  const runner = (async () => { dispatched++; throw new Error('No model expected'); }) as TaskRunner;
  try {
    const chat = await InteractiveSession.create(f.root, f.root, runner);
    assert.match((await chat.execute('/help')).text, /\/checkpoint/);
    await chat.execute('/model SubAgent'); assert.equal(chat.model.model, 'deepseek-v4-pro');
    await chat.execute('/domain electrical'); await chat.execute('/skills use cad-redraw-review');
    await chat.execute('/mcp use configs/mcp/AutoCAD.example.yaml'); assert.ok(chat.state.mcp);
    await chat.execute('/mcp off');
    assert.ok((await chat.complete('/con')).includes('/context'));
    assert.ok((await chat.complete('@dra')).includes('@draft.png'));
    assert.ok((await chat.complete('@drawing')).includes('@"drawing with space.png"'));
    assert.equal((await chat.execute('/open draft.png')).error, false);
    const opening = await chat.execute('/open test.dwg'); assert.match(opening.text, /CAD_OPEN_UNAVAILABLE/); assert.equal(opening.error, true);
    assert.equal((await chat.execute('/undo')).error, true);
    const checkpoint = await chat.execute('/checkpoint'); assert.match(checkpoint.text, /不含DWG/);
    const old = chat.state.id; await chat.execute('/clear'); assert.notEqual(chat.state.id, old);
    await chat.execute('/resume ' + old); assert.equal(chat.state.id, old); assert.equal(chat.state.references.length, 2);
    await mkdir(join(f.root, 'other')); await chat.execute('/cd other'); assert.equal(chat.state.references.length, 0);
    assert.equal(chat.state.workspace, await import('node:fs/promises').then(fs => fs.realpath(join(f.root, 'other'))));
    const unknown = await chat.execute('/unknown'); assert.equal(unknown.error, true); assert.equal(dispatched, 0);
    await assert.rejects(chat.execute('/resume ../../bad'));
  } finally { await f.cleanup(); }
});

test('real DSH turns receive prior dialogue, scoped model and domain; compaction has no tools and keeps archive', async () => {
  const f = await setup(); const previous = process.env.CADER_TUI_FIXTURE;
  process.env.CADER_TUI_FIXTURE = 'sk-no-network-tui';
  const requests: { messages: string; model: string; tools: string[] }[] = [];
  const factory: typeof createLiveRuntime = async options => {
    const runtime = await createLiveRuntime({ ...options, profiles: options.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_TUI_FIXTURE' })) });
    runtime.ctx.on('llm/stream', async function* (request): AsyncGenerator<StreamChunk> {
      requests.push({ messages: JSON.stringify(request.messages), model: request.model, tools: request.tools?.map(tool => tool.name) ?? [] });
      const text = options.disableTools ? 'Unverified summary: project ALPHA17; no CAD edits.' : 'Remembered ALPHA17';
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }); return runtime;
  };
  const runner: TaskRunner = (root, input) => runTask(root, input, factory);
  try {
    const chat = await InteractiveSession.create(f.root, f.root, runner);
    await chat.execute('/model SubAgent'); await chat.execute('/domain electrical');
    let deltas = '';
    assert.equal((await chat.execute('Project ALPHA17', { onEvent: event => { if (event.type === 'assistant.delta') deltas += event.text; } })).error, false);
    await chat.execute('What did I say earlier?');
    assert.match(requests[1]!.messages, /Project ALPHA17/); assert.match(requests[1]!.messages, /ports/);
    assert.equal(requests[1]!.model, 'deepseek-v4-pro'); assert.ok(deltas.includes('ALPHA17'));
    assert.ok(requests.every(row => row.tools.every(tool => ['cader_delegate', 'cader_load_skill', 'cader_read_file', 'cader_list_files', 'cader_glob', 'cader_edit_file', 'cader_write_file', 'cader_shell', 'cader_cad_health', 'cader_cad_recover'].includes(tool))));
    const compact = await chat.execute('/compact'); assert.equal(compact.error, undefined);
    assert.equal(requests[2]!.tools.length, 0); assert.equal(chat.state.contextFrom, 4); assert.equal(chat.state.messages.length, 4);
    const resumed = await InteractiveSession.create(f.root, f.root, runner);
    await resumed.execute('/resume ' + chat.state.id); await resumed.execute('Continue');
    assert.match(requests[3]!.messages, /Unverified summary/);
    assert.ok(!requests.some(row => row.messages.includes('sk-no-network-tui')));
    const saved = await readFile(join(f.root, '.cader/sessions', chat.state.id + '.json'), 'utf8'); assert.ok(!saved.includes('sk-no-network-tui'));
  } finally {
    if (previous === undefined) delete process.env.CADER_TUI_FIXTURE; else process.env.CADER_TUI_FIXTURE = previous;
    await f.cleanup();
  }
});

test('changed references fail before a provider and split credentials/control sequences cannot stream to terminal', async () => {
  const f = await setup(); let calls = 0;
  try {
    const chat = await InteractiveSession.create(f.root, f.root, (async () => { calls++; throw new Error('unexpected'); }) as TaskRunner);
    await chat.execute('/open draft.png'); await writeFile(join(f.root, 'draft.png'), 'changed');
    await assert.rejects(chat.execute('Review the selected image'), /REFERENCE_CHANGED/); assert.equal(calls, 0);
    let output = ''; const stream = new SafeTextStream(['sk-secret-12345'], chunk => { output += chunk; });
    stream.push('你好 sk-sec'); stream.push('ret-12345 \x1b['); stream.push('2J done'); stream.finish();
    assert.equal(output, '你好 [redacted]  done');
  } finally { await f.cleanup(); }
});

test('real DSH cancellation settles, records an incomplete turn, and permits the next turn', async () => {
  const f = await setup(); const previous = process.env.CADER_CANCEL_FIXTURE;
  process.env.CADER_CANCEL_FIXTURE = 'sk-cancel-fixture-only';
  const runner: TaskRunner = (root, input) => runTask(root, input, async options => {
    const runtime = await createLiveRuntime({ ...options, profiles: options.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_CANCEL_FIXTURE' })) });
    runtime.ctx.on('llm/stream', async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'Visible text' };
      if (input.task.startsWith('cancel-me')) await new Promise<void>(resolve => {
        if (input.signal?.aborted) resolve(); else input.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Visible text' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }); return runtime;
  });
  try {
    const chat = await InteractiveSession.create(f.root, f.root, runner); const controller = new AbortController();
    const cancelled = await chat.execute('cancel-me', { signal: controller.signal, onEvent: event => {
      if (event.type === 'assistant.delta') controller.abort();
    } });
    assert.equal(cancelled.error, true); assert.equal(chat.state.messages.at(-1)?.status, 'cancelled');
    const next = await chat.execute('Continue normally'); assert.equal(next.error, false);
    assert.equal(chat.state.messages.at(-1)?.status, 'succeeded');
  } finally {
    if (previous === undefined) delete process.env.CADER_CANCEL_FIXTURE; else process.env.CADER_CANCEL_FIXTURE = previous;
    await f.cleanup();
  }
});

test('shell asks once, respects deny and cancellation, and never becomes dialogue', async () => {
  const f = await setup();
  try {
    const chat = await InteractiveSession.create(f.root);
    const command = process.platform === 'win32' ? '!Write-Output "中文-shell"' : '!printf "中文-shell"';
    assert.equal((await chat.execute(command)).error, true);
    let approvals = 0;
    const result = await chat.execute(command, { confirm: async (_command, cwd) => { approvals++; assert.equal(cwd, f.root); return true; } });
    assert.equal(result.error, false, result.text); assert.match(result.text, /中文-shell/); assert.equal(approvals, 1);
    assert.equal(chat.state.messages.length, 0);
    await chat.execute('/permissions shell deny');
    assert.equal((await chat.execute(command, { confirm: async () => { throw new Error('must not ask'); } })).error, true);
    await chat.execute('/permissions shell ask'); const controller = new AbortController();
    const pending = chat.execute(process.platform === 'win32' ? '!Start-Sleep -Seconds 20' : '!sleep 20', { signal: controller.signal, confirm: async () => true });
    setTimeout(() => controller.abort(), 250);
    assert.match((await pending).text, /已取消/);
    assert.equal((await chat.execute('/context')).error, undefined);
  } finally { await f.cleanup(); }
});

test('CLI no-argument/help/version, scripted Chinese commands and package launcher work without a key', async () => {
  const cli = fileURLToPath(new URL('../../../apps/cli/dist/index.js', import.meta.url));
  const bin = fileURLToPath(new URL('../../../apps/cli/bin/cader.cjs', import.meta.url));
  for (const args of [[], ['--help'], ['--version']]) {
    const run = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd: process.env.TEMP ?? '/tmp' });
    assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /Cader/);
  }
  if (process.platform !== 'win32') {
    const direct = spawnSync(bin, ['--version'], { encoding: 'utf8', cwd: '/tmp' });
    assert.equal(direct.status, 0, direct.stderr);
  }
  const f = await setup();
  try {
    const run = spawnSync(process.execPath, [cli, 'chat', '--stdio', '--workspace', f.root], { encoding: 'utf8', cwd: f.root,
      env: { ...process.env, DEEPSEEK_API_KEY: '' }, input: '/help\n/domain electrical\n/permissions shell deny\n!echo blocked\n/checkpoint\n/exit\n', timeout: 15000 });
    assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /会话已保存/); assert.match(run.stdout, /electrical/);
    assert.match(run.stdout, /Shell 未获批准/); assert.match(run.stdout, /checkpoint-/);
  } finally { await f.cleanup(); }
});
