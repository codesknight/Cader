import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadSkills, readPng } from '@cader/config';
import { createLiveRuntime } from '@cader/dsh-adapter';
import type { StreamChunk } from '@cader/dsh-adapter';
import { runTask } from '@cader/profile';

async function fixture() {
  const parent = resolve('.cader/tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, 'skill fixture-'));
  await cp(resolve('configs/skills'), resolve(root, 'configs/skills'), { recursive: true });
  return { root, async cleanup() {
    assert.ok(resolve(root).startsWith(parent + sep));
    await rm(root, { recursive: true });
  } };
}

test('catalog registers role-scoped data and resources without discovering arbitrary folders', async () => {
  const f = await fixture();
  try {
    await mkdir(resolve(f.root, 'configs/skills/unregistered'));
    await writeFile(resolve(f.root, 'configs/skills/unregistered/SKILL.md'), 'not registered');
    const skills = await loadSkills(f.root);
    assert.equal(skills.list('main').length, 2);
    assert.deepEqual(skills.list('subagent').map(skill => skill.name), ['cad-inspection']);
    await assert.rejects(skills.read('cad-redraw-review', 'subagent'));
    await assert.rejects(skills.read('unregistered', 'main'));
    await assert.rejects(skills.read('../models/MainAgent.yaml', 'main'));
    await assert.rejects(skills.read('cad-redraw-review', 'main', '../../.env'));
    await assert.rejects(skills.read('cad-redraw-review', 'main', 'scripts'));
    assert.match(await skills.read('cad-redraw-review', 'vision', 'assessment-format'), /Cader assessment response/);
    // Real CLI process has only Skill assets: no model config or credential is available.
    for (const args of [['list'], ['show', 'cad-redraw-review', '--resource', 'assessment-format']]) {
      const child = spawnSync(process.execPath, [resolve('apps/cli/dist/index.js'), 'skills', ...args],
        { cwd: f.root, encoding: 'utf8', env: { ...process.env, DEEPSEEK_API_KEY: '' } });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(JSON.parse(child.stdout).ok, true);
    }
  } finally { await f.cleanup(); }
});

test('catalog rejects scripts, duplicate names, path escapes and oversized assets before use', async () => {
  const f = await fixture();
  const catalog = resolve(f.root, 'configs/skills/catalog.yaml');
  const original = await readFile(catalog, 'utf8');
  try {
    for (const text of [original + '    command: python\n',
      original.replace('references/assessment-format.md', '../outside.md'),
      original.replace('name: cad-redraw-review', 'name: cad-inspection')]) {
      await writeFile(catalog, text);
      await assert.rejects(loadSkills(f.root));
    }
    await writeFile(catalog, original);
    await writeFile(resolve(f.root, 'configs/skills/cad-inspection/SKILL.md'), 'x'.repeat(65537));
    await assert.rejects(loadSkills(f.root));
  } finally { await f.cleanup(); }
});

test('catalog rejects a directory link escaping the Skill boundary', async () => {
  const f = await fixture();
  try {
    const target = resolve(f.root, 'outside');
    await mkdir(target);
    await writeFile(resolve(target, 'SKILL.md'), 'private data');
    const link = resolve(f.root, 'configs/skills/cad-inspection');
    assert.ok(link.startsWith(resolve(f.root) + sep));
    await rm(link, { recursive: true });
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(loadSkills(f.root));
  } finally { await f.cleanup(); }
});

test('invalid Skill/image preflight cannot start MCP or a provider', async () => {
  let called = false;
  const factory: typeof createLiveRuntime = async () => { called = true; throw new Error('must not start'); };
  for (const input of [{ skill: 'unregistered' }, { image: 'configs/runtime.yaml' }]) {
    const report = await runTask(process.cwd(), { task: 'Assess', mcpPath: 'configs/mcp/AutoCAD.example.yaml', ...input }, factory);
    assert.equal(report.ok, false);
    assert.equal(report.source, 'configuration');
  }
  assert.equal(called, false);
  const f = await fixture();
  try {
    const image = Buffer.from(await readFile('benchmark/fixtures/vision-calibration.png'));
    image.writeUInt32BE(100000, 16);
    await writeFile(resolve(f.root, 'huge.png'), image);
    await assert.rejects(readPng(f.root, 'huge.png'));
  } finally { await f.cleanup(); }
});

test('actual DSH loop uses selected Skill, on-demand reference and real PNG attachment without write tools', async () => {
  const prior = process.env.CADER_SKILL_FIXTURE;
  process.env.CADER_SKILL_FIXTURE = 'sk-offline-skill-fixture';
  const messages: string[] = [];
  const factory: typeof createLiveRuntime = async options => {
    const runtime = await createLiveRuntime({ ...options,
      profiles: options.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_SKILL_FIXTURE' })) });
    runtime.ctx.on('llm/stream', async function* (request): AsyncGenerator<StreamChunk> {
      messages.push(JSON.stringify(request.messages));
      assert.ok(request.tools?.every(tool => ['cader_load_skill', 'cader_delegate'].includes(tool.name)));
      if (messages.length === 1) {
        const id = 'review-reference' as Extract<StreamChunk, { type: 'tool-call-delta' }>['id'];
        const args = JSON.stringify({ name: 'cad-redraw-review', resource: 'assessment-format' });
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id, name: 'cader_load_skill', argumentsDelta: args };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'cader_load_skill', arguments: args } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
        return;
      }
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'Assessment only; no CAD artifact created.' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Assessment only; no CAD artifact created.' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    });
    return runtime;
  };
  try {
    const report = await runTask(process.cwd(), { task: 'Review this reference.', skill: 'cad-redraw-review',
      image: 'benchmark/fixtures/vision-calibration.png' }, factory);
    assert.equal(report.ok, true);
    assert.equal(report.mode, 'read-only');
    assert.equal(report.selectedSkill, 'cad-redraw-review');
    assert.equal(report.imageProvided, true);
    assert.equal(messages.length, 2);
    assert.ok(messages[0]?.includes('This is Cader-authored guidance'));
    assert.ok(messages[0]?.includes('"type":"image"'));
    assert.ok(!messages[0]?.includes('Cader assessment response'));
    assert.ok(messages[1]?.includes('Cader assessment response'));
    assert.ok(messages.every(message => !message.includes('sk-offline-skill-fixture')));
  } finally {
    if (prior === undefined) delete process.env.CADER_SKILL_FIXTURE; else process.env.CADER_SKILL_FIXTURE = prior;
  }
});
