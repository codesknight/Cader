import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createLiveRuntime, LlmError, defineTool } from '@cader/dsh-adapter';
import type { StreamChunk } from '@cader/dsh-adapter';
import { runTask, runLiveSmoke, describeFailure, failureFromError } from '@cader/profile';

test('task and smoke propagate actual DSH QUOTA to terminal and saved verification without secrets', async () => {
  const prior = process.env.CADER_PROVIDER_FIXTURE;
  const secret = 'sk-quotafixture-private';
  process.env.CADER_PROVIDER_FIXTURE = secret;
  let framed = false;
  const factory: typeof createLiveRuntime = async options => {
    const runtime = await createLiveRuntime({ ...options, mcp: undefined,
      profiles: options.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_PROVIDER_FIXTURE' })) });
    runtime.ctx.tools.register(defineTool({ name: 'mcp__autocad__list_layers', description: 'Offline discovery fixture',
      parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { throw new Error('QUOTA must prevent tool dispatch'); } }));
    runtime.ctx.on('llm/stream', async function* (): AsyncGenerator<StreamChunk> {
      if (framed) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'QUOTA', message: secret, status: 402 } } };
        return;
      }
      throw new LlmError(secret, 'QUOTA');
    });
    const dispose = runtime.dispose;
    runtime.dispose = async () => { await dispose(); throw new Error(secret); };
    return runtime;
  };
  try {
    for (const variant of [false, true]) {
      framed = variant;
      for (const report of [await runTask(process.cwd(), { task: '检查图层' }, factory),
        await runLiveSmoke(process.cwd(), { mcpPath: 'configs/mcp/AutoCAD.example.yaml' }, factory)]) {
        assert.equal(report.ok, false);
        assert.equal(report.errorCode, 'QUOTA');
        assert.equal(report.source, 'provider');
        assert.match(report.hint!, /balance|quota|配额/);
        assert.equal(report.cleanupError, 'CLEANUP_FAILED');
        const saved = await readFile(report.runDirectory + '/verification.json', 'utf8');
        assert.equal(JSON.parse(saved).errorCode, 'QUOTA');
        assert.ok(!saved.includes(secret));
        assert.ok(!(await readFile(report.runDirectory + '/events.jsonl', 'utf8')).includes(secret));
        assert.ok(!JSON.stringify(report).includes(secret));
        if ('checks' in report) assert.equal(report.checks.mcp_discovery, true);
      }
    }
  } finally {
    if (prior === undefined) delete process.env.CADER_PROVIDER_FIXTURE; else process.env.CADER_PROVIDER_FIXTURE = prior;
  }
});

test('setup failures identify MCP/configuration and never forward raw exception data', async () => {
  assert.deepEqual(describeFailure('QUOTA sk-sensitive', 'provider').errorCode, 'UNKNOWN');
  const failed = await runLiveSmoke(process.cwd(), { mcpPath: 'configs/mcp/AutoCAD.example.yaml' },
    async () => { throw new Error('private provider body sk-sensitive'); });
  assert.equal(failed.errorCode, 'MCP_CONNECTION_FAILED');
  assert.equal(failed.source, 'mcp');
  assert.ok(!JSON.stringify(failed).includes('sk-sensitive'));
  assert.equal(failureFromError(Object.assign(new Error('private'), { name: 'ConfigError' })).source, 'configuration');
});

test('exec passes the user task through the real DSH loop while preserving tool restrictions', async () => {
  const prior = process.env.CADER_PROVIDER_FIXTURE;
  process.env.CADER_PROVIDER_FIXTURE = 'sk-fake-offline';
  let messages = '';
  const factory: typeof createLiveRuntime = async options => {
    const runtime = await createLiveRuntime({ ...options,
      profiles: options.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_PROVIDER_FIXTURE' })) });
    runtime.ctx.on('llm/stream', async function* (request): AsyncGenerator<StreamChunk> {
      messages = JSON.stringify(request.messages);
      assert.ok(request.tools?.every(tool => ['cader_delegate', 'cader_load_skill','cader_open_image'].includes(tool.name)));
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: '中文结果' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '中文结果' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    });
    return runtime;
  };
  try {
    const report = await runTask(process.cwd(), { task: '独立的用户任务：检查图层' }, factory);
    assert.equal(report.ok, true);
    assert.equal(report.text, '中文结果');
    assert.equal(report.mode, 'read-only');
    assert.ok(messages.includes('独立的用户任务：检查图层'));
    assert.ok(!messages.includes('Perform a read-only connectivity smoke test'));
  } finally {
    if (prior === undefined) delete process.env.CADER_PROVIDER_FIXTURE; else process.env.CADER_PROVIDER_FIXTURE = prior;
  }
});

test('CLI help and invalid exec arguments do not require repository config, credentials or CAD', () => {
  const cli = fileURLToPath(new URL('../../../apps/cli/dist/index.js', import.meta.url));
  for (const args of [['--help'], ['exec', '--help'], ['exec'], ['exec', '任务', '--write'], ['exec', '任务', '--mcp'],
    ['exec', '任务', '--image'], ['exec', '任务', '--skill', 'cad-inspection', '--skill', 'cad-inspection'],
    ['live-smoke', '--mcp', 'local.yaml', '--task', '画圆'],
    ['live-smoke', '--mcp', 'local.yaml', '--round-cad-budget', '4'],
    ['live-smoke', '--mcp', 'local.yaml', '--quality', '--round-cad-budget', '0'],
    ['live-smoke', '--mcp', 'local.yaml', '--quality', '--round-cad-budget', '1.5'],
    ['live-smoke', '--mcp', 'local.yaml', '--quality', '--round-cad-budget', '65']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: process.env.TEMP ?? '/tmp', encoding: 'utf8' });
    if (args.includes('--help')) {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /read-only/);
    } else {
      assert.equal(result.status, 2, result.stderr);
      assert.equal(JSON.parse(result.stderr).errorCode, 'USAGE_ERROR');
    }
  }
});
