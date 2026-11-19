import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { loadConfig, loadMcp, redactSecrets } from '@cader/config';
import { createLiveRuntime } from '@cader/dsh-adapter';
import type { AgentResult, PublicEvent } from '@cader/dsh-adapter';
import { agentFailure, describeFailure, failureFromError } from './failure.js';

/** User tasks use the same default read-only runtime, never the smoke's fixed instruction. */
export async function runTask(root: string, input: { task: string; mcpPath?: string },
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
  try {
    const mcp = input.mcpPath ? await loadMcp(resolve(root, input.mcpPath)) : undefined;
    stage = mcp ? 'mcp' : 'runtime';
    runtime = await factory({ root, runDirectory: directory, ...config, mcp, onEvent: event => events.push(event) });
    stage = 'runtime';
    result = await runtime.run(config.runtime.main_profile, input.task);
    failure = agentFailure(runtime.completed(), events, result.id);
  } catch (error) { failure = failureFromError(error, stage); }
  finally {
    try { await runtime?.dispose(); }
    catch { cleanupError = 'CLEANUP_FAILED'; failure ??= describeFailure(cleanupError, 'runtime'); }
  }
  const report = { ok: !failure && result?.status === 'succeeded', runId, kind: 'user-task', mode: 'read-only',
    text: result?.text ?? '', ...failure, cleanupError, runDirectory: directory };
  const redact = (text: string) => redactSecrets(text, config.profiles);
  await Promise.all([
    writeFile(join(directory, 'verification.json'), redact(JSON.stringify(report, null, 2) + '\n')),
    writeFile(join(directory, 'events.jsonl'), redact(events.map(event => JSON.stringify({ runId, ...event })).join('\n') + '\n')),
  ]);
  return JSON.parse(redact(JSON.stringify(report))) as typeof report;
}
