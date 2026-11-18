import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { loadConfig } from '@cader/config';
import { createLiveRuntime } from '@cader/dsh-adapter';
import type { StreamChunk } from '@cader/dsh-adapter';

test('actual DSH loop sends Static/Available, isolates worker tools and stops at shared step budget without provider I/O', async () => {
  const prior = process.env.CADER_FIXTURE_KEY;
  process.env.CADER_FIXTURE_KEY = 'sk-fixture-not-a-live-key';
  const config = await loadConfig(process.cwd());
  config.profiles = config.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_FIXTURE_KEY' }));
  config.runtime.max_model_steps = 2;
  const runtime = await createLiveRuntime({ ...config, root: process.cwd(),
    runDirectory: resolve('.cader/tests/runtime-fixture') });
  const requests: { model: string; tools: string[]; messages: string }[] = [];
  runtime.ctx.on('llm/stream', async function* (options): AsyncGenerator<StreamChunk> {
    requests.push({ model: options.model, tools: options.tools?.map(tool => tool.name) ?? [],
      messages: JSON.stringify(options.messages) });
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'Fixture result' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Fixture result' } };
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  });
  try {
    const child = await runtime.run('SubAgent', 'Return a fixture result.');
    const main = await runtime.run('MainAgent', 'Return a fixture result without using tools.');
    assert.equal(child.status, 'succeeded');
    assert.equal(main.status, 'succeeded');
    assert.equal(requests.length, 2);
    assert.ok(!requests[0]?.tools.includes('cader_delegate'));
    assert.ok(requests[1]?.tools.includes('cader_delegate'));
    assert.ok(requests.every(request => request.messages.includes('remaining_model_steps')));
    assert.ok(requests.every(request => !request.messages.includes('sk-fixture-not-a-live-key')));
    await assert.rejects(runtime.run('SubAgent', 'Read image.', { image: 'anything.png' }), /UNSUPPORTED_IMAGE_INPUT/);
    const overBudget = await runtime.run('SubAgent', 'This must not dispatch a model request.');
    assert.equal(overBudget.status, 'failed');
    assert.equal(overBudget.errorCode, 'MODEL_STEP_BUDGET_EXCEEDED');
    assert.equal(requests.length, 2);
  } finally {
    await runtime.dispose();
    if (prior === undefined) delete process.env.CADER_FIXTURE_KEY; else process.env.CADER_FIXTURE_KEY = prior;
  }
});
