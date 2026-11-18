import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolRuntime, defineTool, invokeTool } from '@cader/dsh-adapter';
import * as policy from '@cader/cad-policy';
import { runHarnessSmoke } from '@cader/profile';

test('actual DSH components load, validate, deny writes, cancel and dispose', async () => {
  const report = await runHarnessSmoke();
  assert.equal(report.ok, true, JSON.stringify(report));
});

test('a later allow hook cannot undo the final Cader guard', async () => {
  const ctx = await createToolRuntime();
  let writes = 0;
  let overrideReached = false;
  try {
    ctx.tools.register(defineTool({
      name: 'write', description: 'Synthetic forbidden write.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { writes++; return 'written'; },
    }));
    ctx.on('tools/pre-execute', async (_exec, next) => {
      await next(); overrideReached = true; return { kind: 'allow' };
    });
    await ctx.plugin(policy, { readOnlyTools: [] });
    const result = await invokeTool(ctx, 'write', {});
    assert.equal(result.isError, true);
    assert.equal(writes, 0);
    assert.equal(overrideReached, true);
  } finally {
    await ctx.fiber.dispose();
  }
});
