import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ExecutionSession } from '@cader/profile';
import { createToolRuntime, defineTool, invokeTool } from '@cader/dsh-adapter';
import type { createMcpClient } from '@cader/dsh-adapter';

async function setup() {
  await mkdir('.cader/tests', { recursive: true });
  const root = await mkdtemp(resolve('.cader/tests/execution-'));
  const calls: string[] = []; let fail = false;
  const definitions = ['new_drawing', 'draw_circle', 'delete_entity', 'query_entities', 'get_backend_status', 'unreviewed_write'].map(name => defineTool({
    name: `mcp__autocad__${name}`, description: name, parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() { throw new Error('must dispatch through owner'); } }));
  const factory: typeof createMcpClient = async () => ({ definitions: () => definitions, toolNames: () => definitions.map(d => d.name),
    async call(name) { calls.push(name); if (fail && name === 'draw_circle') throw new Error('response lost');
      return name === 'new_drawing' ? 'Scratch.dwg' : name === 'query_entities' ? [] : {}; }, async dispose() {} });
  const owner = new ExecutionSession(root, join(root, '.cader/runs/test'), undefined, factory);
  await owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
  const ctx = await createToolRuntime();
  return { root, owner, ctx, calls, setFail() { fail = true; },
    install(confirm?: (description: string, cwd: string) => Promise<boolean>) {
      for (const tool of [...owner.definitions(confirm), ...owner.fileTools(confirm)]) ctx.tools.register(tool);
    }, async cleanup() { await owner.dispose(); await ctx.fiber.dispose(); await rm(root, { recursive: true }); } };
}

test('dynamic CAD dispatch enforces ask/read-only and a fresh scratch binding, with no invented capabilities', async () => {
  const f = await setup(); let approvals = 0; f.install(async () => { approvals++; return true; });
  try {
    assert.equal(f.ctx.tools.get('mcp__autocad__unreviewed_write'), undefined);
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__draw_circle', {})).isError, true);
    f.owner.mode = 'read-only'; assert.equal((await invokeTool(f.ctx, 'mcp__autocad__new_drawing', {})).isError, true);
    assert.equal(approvals, 0); f.owner.mode = 'ask';
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__new_drawing', {})).isError, false);
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__draw_circle', {})).isError, false);
    assert.equal(approvals, 2); assert.ok(f.calls.includes('query_entities'));
  } finally { await f.cleanup(); }
});
test('workspace-write approves destructive CAD calls; unknown writes persist a freeze and never replay', async () => {
  const f = await setup(); f.install(); f.owner.mode = 'workspace-write';
  try {
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__new_drawing', {})).isError, false);
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__delete_entity', {})).isError, true);
    f.setFail(); assert.equal((await invokeTool(f.ctx, 'mcp__autocad__draw_circle', {})).isError, true);
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__draw_circle', {})).isError, true);
    assert.equal(f.calls.filter(name => name === 'draw_circle').length, 1);
    await f.owner.dispose(); assert.equal(JSON.parse(await readFile(join(f.root, '.cader/locks/managed-write.json'), 'utf8')).frozen, true);
  } finally { await f.cleanup(); }
});
test('agent files obey permissions, exact edits, glob boundaries and private/CAD file protection', async () => {
  const f = await setup(); f.install(); f.owner.mode = 'workspace-write';
  try {
    assert.equal((await invokeTool(f.ctx, 'cader_write_file', { path: 'note.txt', content: 'one' })).isError, false);
    assert.equal((await invokeTool(f.ctx, 'cader_write_file', { path: 'note.txt', content: 'two' })).isError, true);
    assert.equal((await invokeTool(f.ctx, 'cader_shell', { command: 'echo no' })).isError, true);
    f.owner.mode = 'full-access';
    assert.equal((await invokeTool(f.ctx, 'cader_edit_file', { path: 'note.txt', old_text: 'one', new_text: 'two' })).isError, false);
    assert.equal(await readFile(join(f.root, 'note.txt'), 'utf8'), 'two');
    await writeFile(join(f.root, '.env'), 'never read');
    assert.equal((await invokeTool(f.ctx, 'cader_read_file', { path: '.env' })).isError, true);
    assert.equal((await invokeTool(f.ctx, 'cader_write_file', { path: 'unsafe.dwg', content: 'bad' })).isError, true);
    assert.equal((await invokeTool(f.ctx, 'cader_read_file', { path: '../outside' })).isError, true);
    const glob = await invokeTool(f.ctx, 'cader_glob', { pattern: '**/*.txt' });
    assert.equal(glob.isError, false); assert.match(String(glob.value), /note.txt/); assert.doesNotMatch(String(glob.value), /\.env/);
  } finally { await f.cleanup(); }
});
