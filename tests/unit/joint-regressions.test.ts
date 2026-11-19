import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateAssessment, runTask, contractSchemas, assessmentSchemas } from '@cader/profile';
import { loadConfig, loadMcp, mcpEnvironment } from '@cader/config';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLiveRuntime, prepareImageView, attachmentToSource } from '@cader/dsh-adapter';
import type { PublicEvent, StreamChunk } from '@cader/dsh-adapter';

test('versioned public schema export matches the keyless CLI and config keeps writes outside readonly tools', async () => {
  const expected = { contract_version: 'cader-cad/1', status: 'Cader-side proposal; MCP implementation required',
    schemas: { ...contractSchemas(), ...assessmentSchemas() } };
  assert.deepEqual(JSON.parse(await readFile('configs/contracts/cader-v1.schemas.json', 'utf8')), expected);
  const cli = fileURLToPath(new URL('../../../apps/cli/dist/index.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'cad-contract'], { encoding: 'utf8', env: { ...process.env, DEEPSEEK_API_KEY: '' } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  const { runtime } = await loadConfig(process.cwd());
  assert.ok(runtime.read_only_tools.includes('mcp__autocad__get_backend_status'));
  assert.ok(runtime.read_only_tools.every(name => /__(list_layers|list_symbol_library|get_backend_status)$/.test(name)));
  const mcp = await loadMcp('configs/mcp/AutoCAD.example.yaml');
  delete process.env.CADER_ENV_REF_FIXTURE;
  assert.throws(() => mcpEnvironment({ ...mcp, env_refs: { AUTOCAD_BRIDGE_TOKEN: 'CADER_ENV_REF_FIXTURE' } }), /Missing MCP environment reference/);
});

function syntheticAssessment() {
  const source = 'a'.repeat(64);
  const facts = [
    { id: 'gate-fact', kind: 'symbol', raw: 'OR', value: 'OR' },
    { id: 'sink-fact', kind: 'symbol', raw: 'RESISTOR', value: 'RESISTOR' },
    { id: 'label', kind: 'label', raw: 'OUT_1', value: 'OUT_1' },
    { id: 'voltage', kind: 'voltage_kv', raw: '110kV', value: 110 },
    { id: 'drawing', kind: 'drawing_id', raw: 'DEMO_001', value: 'DEMO_001' },
    { id: 'cross', kind: 'crossing', raw: 'bridge', value: 'bridge' },
  ].map(fact => ({ ...fact, status: 'observed', region_id: 'source' }));
  const assessment = { version: 1, source_sha256: source, coordinate_mode: 'schematic', layout_units: 'layout', physical_scale: null,
    regions: [{ id: 'source', left: 0, top: 0, width: 200, height: 100 }], facts, nodes: ['a', 'b', 'c', 'd'],
    symbols: [{ id: 'gate', kind: 'OR', fact_id: 'gate-fact', ports: [{ id: 'pa', node_id: 'a' }, { id: 'pb', node_id: 'b' }] },
      { id: 'sink', kind: 'RESISTOR', fact_id: 'sink-fact', ports: [{ id: 'pc', node_id: 'c' }, { id: 'pd', node_id: 'd' }] }],
    wires: [{ id: 'wa', from_node: 'a', to_node: 'c', region_id: 'source' }, { id: 'wb', from_node: 'b', to_node: 'd', region_id: 'source' }],
    crossings: [{ wire_a: 'wa', wire_b: 'wb', kind: 'bridge', node_id: null as string | null, fact_id: 'cross' }] };
  const expected = { source_sha256: source, width: 200, height: 100,
    values: Object.fromEntries(facts.map(fact => [fact.id, fact.value])), symbol_kinds: { gate: 'OR', sink: 'RESISTOR' },
    connected: [['pa', 'pc']], disconnected: [['pa', 'pb']], required_labels: ['OUT_1'] };
  return { assessment, expected };
}

test('independent facts and graph reject joint-test error classes, including uncertain facts', () => {
  const { assessment, expected } = syntheticAssessment();
  assert.equal(validateAssessment(assessment, expected).ok, true);
  const wrongGate = structuredClone(assessment); wrongGate.symbols[0]!.kind = 'XOR'; wrongGate.facts[0]!.value = 'XOR';
  assert.ok(validateAssessment(wrongGate, expected).issues.includes('SYMBOL_TYPE_UNVERIFIED'));
  const wrongVoltage = structuredClone(assessment); wrongVoltage.facts.find(fact => fact.id === 'voltage')!.value = 1100;
  assert.ok(validateAssessment(wrongVoltage, expected).issues.includes('VOLTAGE_NORMALIZATION_CONFLICT'));
  const missingLabel = structuredClone(assessment); missingLabel.facts = missingLabel.facts.filter(fact => fact.id !== 'label');
  assert.ok(validateAssessment(missingLabel, expected).issues.includes('REQUIRED_LABEL_MISSING'));
  const wrongText = structuredClone(assessment); wrongText.facts.find(fact => fact.id === 'drawing')!.value = 'GUESSED_002';
  assert.ok(validateAssessment(wrongText, expected).issues.includes('TEXT_NORMALIZATION_CONFLICT'));
  const shorted = structuredClone(assessment); shorted.crossings[0]!.kind = 'junction'; shorted.crossings[0]!.node_id = 'a';
  assert.ok(validateAssessment(shorted, expected).issues.includes('TOPOLOGY_FALSE_CONNECTION'));
  const unknown = structuredClone(assessment); unknown.facts[0]!.status = 'unknown';
  assert.ok(validateAssessment(unknown, expected).issues.includes('UNKNOWN_MUST_BE_NULL'));
  const physical = { ...assessment, coordinate_mode: 'physical' };
  assert.ok(validateAssessment(physical, expected).issues.includes('PHYSICAL_SCALE_UNESTABLISHED'));
  assert.equal(validateAssessment('```json\n{}\n```', expected).ok, false);
  const unverified = structuredClone(expected); delete unverified.values['gate-fact'];
  assert.ok(validateAssessment(assessment, unverified).issues.includes('FACT_NOT_INDEPENDENTLY_VERIFIED'));
});

test('authorized redraw in readonly exec is formally blocked without starting a model or MCP', async () => {
  let started = false;
  const result = await runTask(process.cwd(), { task: 'Draw and save a DWG', intent: 'redraw' }, async () => {
    started = true; throw new Error('must not start');
  });
  assert.equal(started, false); assert.equal(result.run_status, 'succeeded');
  assert.equal(result.task_status, 'blocked'); assert.equal(result.ok, false);
  assert.deepEqual(result.blocked_reasons, ['WRITE_CAPABILITY_UNAVAILABLE']);
  assert.equal(result.authorization.user_task_authorized, true);
  assert.equal(result.artifact, null); assert.equal(result.verification, 'not_performed');
  assert.equal(result.stages.execution, 'blocked');
});

test('crop/rotation mapping and source hash are reproducible and never mutate the source', async () => {
  const path = 'benchmark/fixtures/vision-calibration.png';
  const original = await readFile(path), hash = createHash('sha256').update(original).digest('hex');
  const view = await prepareImageView(process.cwd(), path, { crop: { left: 5, top: 7, width: 64, height: 48 }, rotation: 90 });
  assert.equal(view.audit.source_sha256, hash);
  assert.equal(view.audit.view_width, 48); assert.equal(view.audit.view_height, 64);
  assert.deepEqual(view.audit.view_to_source, [0, 1, 5, -1, 0, 55]);
  assert.deepEqual(attachmentToSource(view.audit.view_to_source, 48, 64, 24, 32), [0, 2, 5, -2, 0, 55]);
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), hash);
  await assert.rejects(prepareImageView(process.cwd(), path, { crop: { left: -1, top: 0, width: 5, height: 5 } }));
});

test('DSH region tool and actual request-image service record hashes, mappings and Skill resource identity', async () => {
  const prior = process.env.CADER_AUDIT_FIXTURE;
  process.env.CADER_AUDIT_FIXTURE = 'sk-no-network-audit';
  const events: PublicEvent[] = [];
  const factory: typeof createLiveRuntime = async options => {
    const runtime = await createLiveRuntime({ ...options, onEvent: event => { options.onEvent?.(event); events.push(event); },
      profiles: options.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_AUDIT_FIXTURE' })) });
    let step = 0;
    runtime.ctx.on('llm/stream', async function* (request): AsyncGenerator<StreamChunk> {
      step++;
      const messages = JSON.parse(JSON.stringify(request.messages)) as { content: { type: string;
        attachment: Parameters<typeof runtime.ctx.attachments.readImageRequest>[0] }[] }[];
      const images = messages.flatMap(message => message.content).filter(block => block.type === 'image');
      for (const block of images) await runtime.ctx.attachments.readImageRequest(block.attachment, { width: 24, height: 24, maxBytes: 100000 });
      if (step === 1) {
        const id = 'crop-01' as Extract<StreamChunk, { type: 'tool-call-delta' }>['id'];
        const args = JSON.stringify({ image_ref: 'image-1', left: 5, top: 7, width: 64, height: 48, rotation: 90 });
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id, name: 'cader_view_image', argumentsDelta: args };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'cader_view_image', arguments: args } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
      }
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'Unverified region review' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Unverified region review' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    });
    return runtime;
  };
  try {
    const result = await runTask(process.cwd(), { task: 'Review', skill: 'cad-redraw-review', image: 'benchmark/fixtures/vision-calibration.png' }, factory);
    assert.equal(result.run_status, 'succeeded', JSON.stringify(result)); assert.equal(result.task_status, 'unverified');
    assert.equal(events.filter(event => event.type === 'image.attached').length, 2);
    assert.ok(events.some(event => event.type === 'image.request' && Array.isArray(event.source_mappings) && event.source_mappings.length > 0));
    assert.ok(events.some(event => event.type === 'skill.loaded' && event.name === 'cad-redraw-review' && typeof event.sha256 === 'string'));
    assert.ok(events.every(event => !JSON.stringify(event).includes('sk-no-network-audit')));
  } finally {
    if (prior === undefined) delete process.env.CADER_AUDIT_FIXTURE; else process.env.CADER_AUDIT_FIXTURE = prior;
  }
});
