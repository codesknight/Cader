import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, mkdtemp, symlink, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, parseProfile, parseRuntime, workspacePath, redactSecrets } from '@cader/config';
import { ChildPool } from '@cader/dsh-adapter';

test('shipped YAML loads models without serializing environment secrets', async () => {
  const prior = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'sk-test-configuration-secret';
  try {
    const config = await loadConfig(process.cwd());
    assert.equal(config.profiles.find(profile => profile.id === 'MainAgent')?.model, 'deepseek-flash');
    assert.deepEqual(config.profiles.find(profile => profile.id === 'SubAgent')?.input, ['text']);
    assert.equal(config.runtime.max_parallel_subagents, 5);
    assert.ok(!JSON.stringify(config).includes('sk-test-configuration-secret'));
  } finally {
    if (prior === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prior;
  }
});

test('rejects inline secrets, YAML execution tags, duplicate keys and image claims for Pro', async () => {
  const source = await readFile('configs/models/SubAgent.yaml', 'utf8');
  for (const text of [source + '\napi_key: sk-test-configuration-secret',
    source.replace('input: [text]', 'input: [text, image]'),
    source + '\nmodel: duplicate', source.replace('deepseek-v4-pro', '!!js dangerous()'),
    source.replace('can_delegate: false', 'can_delegate: true')]) {
    assert.throws(() => parseProfile(text), error => error instanceof Error
      && !error.message.includes('sk-test-configuration-secret'));
  }
});

test('redacts credentials from arbitrary report and snapshot fields while retaining the variable reference', async () => {
  const { profiles } = await loadConfig(process.cwd());
  const value = redactSecrets(JSON.stringify({ api_key_env: 'DEEPSEEK_API_KEY',
    diagnostic: 'Bearer sk-fixture-sensitive-value' }), profiles,
    { DEEPSEEK_API_KEY: 'sk-fixture-sensitive-value' });
  assert.ok(!value.includes('sk-fixture-sensitive-value'));
  assert.ok(value.includes('DEEPSEEK_API_KEY'));
  assert.ok(value.includes('[redacted]'));
});

test('rejects unsafe runtime limits and unreviewed CAD write tools', async () => {
  const text = await readFile('configs/runtime.yaml', 'utf8');
  assert.throws(() => parseRuntime(text.replace('max_parallel_subagents: 5', 'max_parallel_subagents: 6')));
  assert.throws(() => parseRuntime(text.replace('max_delegation_depth: 1', 'max_delegation_depth: 2')));
  assert.throws(() => parseRuntime(text.replace('list_layers', 'delete_entity')));
});

test('seven child tasks use at most five slots and release slots after failure', async () => {
  const pool = new ChildPool(5);
  const results = await Promise.allSettled(Array.from({ length: 7 }, (_, index) =>
    pool.run('main', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (index === 2) throw new Error('fixture failure');
      return index;
    })));
  assert.equal(pool.peak, 5);
  assert.equal(pool.active, 0);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 6);
  await assert.rejects(pool.run('subagent', async () => true), /CHILD_DELEGATION_DENIED/);
  await assert.rejects(pool.run('vision', async () => true), /CHILD_DELEGATION_DENIED/);
});

test('image path resolution rejects symlinks that escape the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cader-path-'));
  const workspace = join(root, 'workspace'), outside = join(root, 'outside');
  await mkdir(workspace); await mkdir(outside);
  await symlink(outside, join(workspace, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  try { await assert.rejects(workspacePath(workspace, 'link')); }
  finally {
    await unlink(join(workspace, 'link'));
    await rmdir(workspace); await rmdir(outside); await rmdir(root);
  }
});
