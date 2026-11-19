import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '@cader/config';
import { createLiveRuntime } from '@cader/dsh-adapter';
import type { StreamChunk, PublicEvent } from '@cader/dsh-adapter';
import { runTask, validateCadArguments } from '@cader/profile';

test('legacy CAD coordinate constraints reject malformed XYZ before any side effects', () => {
  assert.throws(() => validateCadArguments('draw_polyline', { points: [[-40,14],[-24,14],[-18,20]] }), /XYZ/);
  assert.throws(() => validateCadArguments('draw_line', { start_x: 0,start_y: 0,start_z: 0,end_x: 0,end_y: 0,end_z: 0 }), /ZERO_LENGTH/);
  assert.throws(() => validateCadArguments('draw_circle', { radius: Infinity }), /NONFINITE/);
  validateCadArguments('draw_polyline', { points: [[-40,14,0],[-24,14,0],[-18,20,0]] });
});

test('actual DSH routes a generated image attachment to vision automatically and enforces review budget', async () => {
  const previous = process.env.CADER_FEEDBACK_FIXTURE; process.env.CADER_FEEDBACK_FIXTURE = 'sk-offline-feedback';
  await mkdir('.cader/tests', { recursive: true }); const root = await mkdtemp(resolve('.cader/tests/feedback-'));
  const config = await loadConfig(process.cwd()); const events: PublicEvent[] = [];
  let captures = 0, imageRequests = 0, mainSteps = 0, visionSteps = 0;
  const runtime = await createLiveRuntime({ root: process.cwd(), workspaceRoot: process.cwd(), runDirectory: root,
    ...config, runtime: { ...config.runtime, max_visual_reviews_per_turn: 1 },
    profiles: config.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_FEEDBACK_FIXTURE' })),
    captureCadView: async () => { captures++; return { path: resolve('benchmark/fixtures/vision-calibration.png'), evidence: { source: 'synthetic capture fixture; not real CAD' } }; },
    onEvent: event => events.push(event) });
  runtime.ctx.on('llm/stream', async function* (request): AsyncGenerator<StreamChunk> {
    const messages = JSON.parse(JSON.stringify(request.messages)) as { content: { type: string; attachment: Parameters<typeof runtime.ctx.attachments.readImageRequest>[0] }[] }[];
    const images = messages.flatMap(message => message.content).filter(block => block.type === 'image');
    if (images.length) {
      visionSteps++;
      assert.ok(request.tools?.every(tool => !tool.name.startsWith('mcp__') && !['cader_delegate','cader_review_cad_view'].includes(tool.name)));
      for (const block of images) { await runtime.ctx.attachments.readImageRequest(block.attachment, { width: 48, height: 48, maxBytes: 100000 }); imageRequests++; }
      const text = JSON.stringify({ defects: [], uncertainties: ['fixture only'], verdict: 'fixture' });
      yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } }; return;
    }
    mainSteps++;
    if (mainSteps <= 2) {
      const id = `review-${mainSteps}` as Extract<StreamChunk, { type: 'tool-call-delta' }>['id'];
      const args = JSON.stringify({ question: 'Review this fixture' });
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id, name: 'cader_review_cad_view', argumentsDelta: args };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'cader_review_cad_view', arguments: args } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
    }
    const text = 'Fixture complete, not real CAD acceptance';
    yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } };
  });
  try {
    const result = await runtime.run(config.runtime.main_profile, 'Review generated view');
    assert.equal(result.status, 'succeeded'); assert.equal(captures, 1); assert.equal(visionSteps, 1); assert.equal(imageRequests, 1);
    assert.ok(events.some(event => event.type === 'cad.review' && event.review_valid === true));
    assert.ok(events.some(event => event.type === 'tool.result' && event.isError === true));
  } finally { await runtime.dispose(); await rm(root, { recursive: true }); if (previous === undefined) delete process.env.CADER_FEEDBACK_FIXTURE; else process.env.CADER_FEEDBACK_FIXTURE = previous; }
});

test('a successful model answer cannot hide an authoritative frozen CAD task', async () => {
  const previous = process.env.CADER_REPORT_FIXTURE; process.env.CADER_REPORT_FIXTURE = 'sk-offline-report';
  const factory: typeof createLiveRuntime = async options => {
    const runtime = await createLiveRuntime({ ...options, profiles: options.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_REPORT_FIXTURE' })) });
    runtime.ctx.on('llm/stream', async function* (): AsyncGenerator<StreamChunk> {
      const text = 'Everything succeeded (deliberately false fixture prose)';
      yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } };
    }); return runtime;
  };
  try {
    const report = await runTask(process.cwd(), { task: 'Report', executionState: () => ({ frozen: true, write_state: 'frozen', freeze: null,
      transport: 'connected', scratch: 'Scratch', artifact: null, operations: [], counts: { unknown: 1 },
      cad_observation: { source: 'fixture', observed_at: null, entity_count: null, native_identity: 'unavailable', cached: true } }) }, factory);
    assert.equal(report.run_status, 'succeeded'); assert.equal(report.ok, false); assert.equal(report.task_status, 'blocked');
    assert.deepEqual(report.blocked_reasons, ['CAD_WRITE_FROZEN']);
    assert.equal(JSON.parse(await readFile(resolve(report.runDirectory,'verification.json'),'utf8')).ok, false);
  } finally { if (previous === undefined) delete process.env.CADER_REPORT_FIXTURE; else process.env.CADER_REPORT_FIXTURE = previous; }
});
