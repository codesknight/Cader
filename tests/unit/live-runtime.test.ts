import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { loadConfig } from '@cader/config';
import { createLiveRuntime } from '@cader/dsh-adapter';
import type { StreamChunk } from '@cader/dsh-adapter';

test('actual DSH loop loads configs Static/Skill, isolates worker tools and enforces shared budget without provider I/O', async () => {
  const prior = process.env.CADER_FIXTURE_KEY;
  process.env.CADER_FIXTURE_KEY = 'sk-fixture-not-a-live-key';
  const config = await loadConfig(process.cwd());
  config.profiles = config.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_FIXTURE_KEY' }));
  config.runtime.max_model_steps = 3;
  const runtime = await createLiveRuntime({ ...config, root: process.cwd(),
    runDirectory: resolve('.cader/tests/runtime-fixture') });
  const requests: { model: string; tools: string[]; messages: string }[] = [];
  runtime.ctx.on('llm/stream', async function* (options): AsyncGenerator<StreamChunk> {
    requests.push({ model: options.model, tools: options.tools?.map(tool => tool.name) ?? [],
      messages: JSON.stringify(options.messages) });
    if (requests.length === 1) {
      const id = 'fixture-load-skill' as Extract<StreamChunk, { type: 'tool-call-delta' }>['id'];
      const args = JSON.stringify({ name: 'cad-inspection' });
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id, name: 'cader_load_skill', argumentsDelta: args };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'cader_load_skill', arguments: args } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
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
    assert.equal(requests.length, 3);
    assert.deepEqual(child.tools, ['cader_load_skill']);
    assert.ok(requests[0]?.messages.includes("You are a bounded Cader child agent"));
    assert.ok(!requests[0]?.messages.includes('Do not draw, save, delete, or retarget'));
    assert.ok(requests[1]?.messages.includes('Do not draw, save, delete, or retarget'));
    assert.ok(requests[2]?.messages.includes("You are Cader's main CAD agent"));
    assert.ok(!requests[0]?.tools.includes('cader_delegate'));
    assert.ok(!requests[1]?.tools.includes('cader_delegate'));
    assert.ok(requests[2]?.tools.includes('cader_delegate'));
    assert.ok(requests[2]?.messages.includes('worker_profiles'));
    assert.ok(requests[2]?.messages.includes('deepseek-v4-pro'));
    assert.ok(requests.every(request => request.messages.includes('remaining_model_steps')));
    assert.ok(requests.every(request => !request.messages.includes('sk-fixture-not-a-live-key')));
    await assert.rejects(runtime.run('SubAgent', 'Read image.', { image: 'anything.png' }), /UNSUPPORTED_IMAGE_INPUT/);
    const overBudget = await runtime.run('SubAgent', 'This must not dispatch a model request.');
    assert.equal(overBudget.status, 'failed');
    assert.equal(overBudget.errorCode, 'MODEL_STEP_BUDGET_EXCEEDED');
    assert.equal(requests.length, 3);
  } finally {
    await runtime.dispose();
    if (prior === undefined) delete process.env.CADER_FIXTURE_KEY; else process.env.CADER_FIXTURE_KEY = prior;
  }
});
