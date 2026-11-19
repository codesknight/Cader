import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { loadConfig, loadMcp, loadSkills, readReferenceImage, redactSecrets, ConfigError } from '@cader/config';
import { createLiveRuntime } from '@cader/dsh-adapter';
import type { AgentResult, PublicEvent } from '@cader/dsh-adapter';
import { agentFailure, describeFailure, failureFromError } from './failure.js';
import { taskStages, BusinessOutcome } from './cad-contract.js';
import { prepareImageView } from '@cader/dsh-adapter';
import type { ImageView } from '@cader/dsh-adapter';

/** User tasks use the same default read-only runtime, never the smoke's fixed instruction. */
export async function runTask(root: string, input: { task: string; mcpPath?: string; skill?: string; image?: string; intent?: 'assess' | 'redraw'; imageView?: ImageView },
  factory: typeof createLiveRuntime = createLiveRuntime) {
  if (!input.task.trim()) throw new Error('USAGE_ERROR');
  const config = await loadConfig(root);
  const runId = `exec-${randomUUID()}`;
  const directory = resolve(root, '.cader/runs', runId);
  await mkdir(directory, { recursive: true });
  const events: PublicEvent[] = [];
  let runtime: Awaited<ReturnType<typeof createLiveRuntime>> | undefined;
  let failure: ReturnType<typeof describeFailure> | undefined;
  let result: AgentResult | undefined;
  let cleanupError: string | undefined;
  let stage: 'configuration' | 'runtime' | 'mcp' = 'configuration';
  const stages = taskStages();
  const drawingBlocked = input.intent === 'redraw';
  try {
    if (input.skill) await (await loadSkills(root)).read(input.skill, 'main');
    if (input.image) {
      if (!config.profiles.find(profile => profile.id === config.runtime.main_profile)?.input.includes('image'))
        throw new ConfigError('The main model does not accept image input');
      await readReferenceImage(root, input.image);
      if (input.imageView) await prepareImageView(root, input.image, input.imageView);
    }
    if (!drawingBlocked) {
      const mcp = input.mcpPath ? await loadMcp(resolve(root, input.mcpPath)) : undefined;
      stage = mcp ? 'mcp' : 'runtime';
      runtime = await factory({ root, runDirectory: directory, ...config, mcp,
        images: input.image ? { 'image-1': input.image } : {}, onEvent: event => events.push(event) });
      stage = 'runtime';
      result = await runtime.run(config.runtime.main_profile, input.task, { skill: input.skill, image: input.image, imageView: input.imageView });
      failure = agentFailure(runtime.completed(), events, result.id);
    }
  } catch (error) { failure = failureFromError(error, stage); }
  finally {
    try { await runtime?.dispose(); }
    catch { cleanupError = 'CLEANUP_FAILED'; failure ??= describeFailure(cleanupError, 'runtime'); }
  }
  const runSucceeded = !failure && (drawingBlocked || result?.status === 'succeeded');
  if (drawingBlocked && runSucceeded) stages.execution = 'blocked';
  else if (runSucceeded) {
    stages.recognition = input.image ? 'unverified' : 'not_performed';
    stages.planning = 'unverified';
  }
  const report = { contract_version: 'cader-task/1', ok: runSucceeded && !drawingBlocked, run_status: runSucceeded ? 'succeeded' : 'failed',
    task_status: !runSucceeded ? 'failed' : drawingBlocked ? 'blocked' : 'unverified',
    blocked_reasons: drawingBlocked && runSucceeded ? ['WRITE_CAPABILITY_UNAVAILABLE'] : [],
    authorization: { user_task_authorized: true, write_authorized: false, runtime_write_available: false },
    performed_actions: events.filter(event => event.type === 'tool.result' && event.isError === false)
      .map(event => ({ operation: String(event.tool), status: 'succeeded' })),
    artifact: null, verification: 'not_performed', stages,
    runId, kind: 'user-task', mode: 'read-only',
    selectedSkill: input.skill ?? null, imageProvided: Boolean(input.image),
    text: result?.text ?? '', ...failure, cleanupError, runDirectory: directory };
  const redact = (text: string) => redactSecrets(text, config.profiles);
  BusinessOutcome.parse(report);
  await Promise.all([
    writeFile(join(directory, 'verification.json'), redact(JSON.stringify(report, null, 2) + '\n')),
    writeFile(join(directory, 'events.jsonl'), redact(events.map(event => JSON.stringify({ runId, ...event })).join('\n') + '\n')),
  ]);
  return JSON.parse(redact(JSON.stringify(report))) as typeof report;
}
