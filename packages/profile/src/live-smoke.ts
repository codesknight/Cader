import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { loadConfig, loadMcp, redactSecrets } from '@cader/config';
import { createLiveRuntime } from '@cader/dsh-adapter';
import type { PublicEvent } from '@cader/dsh-adapter';

/** Paid and local integration checks are opt-in; CI never invokes this entry. */
export async function runLiveSmoke(root: string, input: { mcpPath: string; image?: string; expectedImage?: string }) {
  const runId = `live-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const directory = resolve(root, '.cader/runs', runId);
  await mkdir(directory, { recursive: true });
  const config = await loadConfig(root);
  const textProfile = config.profiles.find(profile => profile.role === 'subagent');
  const visionProfile = config.profiles.find(profile => profile.role === 'vision');
  if (!textProfile || (input.image && !visionProfile)) throw new Error('SMOKE_REQUIRES_ROLE_PROFILES');
  const snapshot = redactSecrets(JSON.stringify(config, null, 2) + '\n', config.profiles);
  const configHash = createHash('sha256').update(snapshot).digest('hex');
  const events: PublicEvent[] = [];
  const checks: Record<string, boolean | null> = {
    mcp_discovery: false, model_mcp_call: false, child_returned_to_main: false,
    main_completed: false, child_has_no_delegation_tool: false, vision_input: null, vision_verified: null,
  };
  let runtime: Awaited<ReturnType<typeof createLiveRuntime>> | undefined;
  let errorCode: string | undefined;
  const results = [];
  try {
    runtime = await createLiveRuntime({ root, runDirectory: directory, ...config,
      images: input.image ? { 'image-1': input.image } : {},
      mcp: await loadMcp(resolve(root, input.mcpPath)), onEvent: event => events.push(event) });
    checks.mcp_discovery = runtime.toolNames().includes('mcp__autocad__list_layers');
    const main = await runtime.run(config.runtime.main_profile,
      'Perform a read-only connectivity smoke test. Call mcp__autocad__list_layers once. ' +
      `Then use cader_delegate to ask ${textProfile.id}, using only these task facts and no tools, to briefly confirm this inspection requires no CAD edits. ` +
      (input.image ? `Also delegate to ${visionProfile!.id} with image_ref image-1: read the large four-digit code, count blue circles and red rectangles, and return only JSON with keys code (string), blue_circles (integer), red_rectangles (integer). Do not guess. ` : '') +
      'After the child results return, report the observed layer count and findings. Do not draw, save or delete.');
    results.push(...runtime.completed());
    checks.model_mcp_call = events.some(event => event.type === 'tool.result' &&
      event.tool === 'mcp__autocad__list_layers' && event.isError === false);
    checks.child_returned_to_main = events.some(event => event.type === 'tool.result' &&
      event.tool === 'cader_delegate' && event.isError === false) && events.some(event =>
      event.type === 'agent.completed' && event.role === 'subagent' && event.status === 'succeeded');
    checks.main_completed = main.status === 'succeeded';
    const childPrompts = events.filter(event => event.type === 'prompt.assembled' && event.role !== 'main');
    checks.child_has_no_delegation_tool = childPrompts.length > 0 && childPrompts.every(event =>
      Array.isArray(event.tools) && !event.tools.includes('cader_delegate'));
    if (input.image) {
      const vision = results.find(result => result.profile === visionProfile!.id);
      // An accepted image request alone is not a successful perception test.
      checks.vision_input = vision?.status === 'succeeded';
      if (input.expectedImage) {
        const expected = JSON.parse(await readFile(resolve(root, input.expectedImage), 'utf8'));
        let actual;
        try { actual = JSON.parse(vision?.text.match(/\{[\s\S]*\}/)?.[0] ?? 'null'); } catch { actual = null; }
        checks.vision_verified = vision?.status === 'succeeded' && String(actual?.code) === String(expected.code)
          && actual?.blue_circles === expected.blue_circles && actual?.red_rectangles === expected.red_rectangles;
      }
    }
  } catch (error) {
    errorCode = error instanceof Error ? error.name : 'Error';
  } finally {
    try { await runtime?.dispose(); } catch { errorCode = 'CLEANUP_FAILED'; }
  }
  const ok = !errorCode && Object.values(checks).filter(value => value !== null).every(Boolean);
  const report = { ok, runId, kind: 'live-dsh-model-mcp', checks, errorCode,
    peakChildren: runtime?.pool.peak ?? 0, results, configHash };
  const redact = (text: string) => redactSecrets(text, config.profiles);
  await Promise.all([
    writeFile(join(directory, 'config.snapshot.json'), snapshot),
    writeFile(join(directory, 'events.jsonl'), redact(events.map(event => JSON.stringify({ runId, ...event })).join('\n') + '\n')),
    writeFile(join(directory, 'verification.json'), redact(JSON.stringify(report, null, 2) + '\n')),
    writeFile(join(directory, 'summary.md'), `# ${runId}\n\n${ok ? 'Passed' : 'Failed'}.\n\nChecks: ${JSON.stringify(checks)}\n`),
  ]);
  return { ok, runId, checks, errorCode, peakChildren: report.peakChildren, runDirectory: directory };
}
