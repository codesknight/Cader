import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { runHarnessSmoke } from '@cader/profile';

type SmokeReport = Awaited<ReturnType<typeof runHarnessSmoke>>;

function sourceState() {
  try {
    return {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
    };
  } catch { return null; }
}

export async function recordSmoke(report: SmokeReport): Promise<string> {
  const runId = `dsh-component-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const directory = join('.cader', 'runs', runId);
  await mkdir(join('.cader', 'runs'), { recursive: true });
  await mkdir(directory);
  const snapshot = { node: process.versions.node, dsh: report.dshVersion, kind: report.kind,
    source: sourceState(), readOnlyTools: ['general_ping'] };
  const configJson = JSON.stringify(snapshot, null, 2) + '\n';
  const configHash = createHash('sha256').update(configJson).digest('hex');
  const events = [
    { type: 'run.created', runId, configHash },
    ...report.toolEvents.map(event => ({ type: 'tool.result', runId, ...event })),
    { type: 'smoke.cancellation', runId, beforeDispatch: report.cancelledBeforeDispatch },
    { type: 'run.completed', runId, ok: report.ok },
  ];
  await Promise.all([
    writeFile(join(directory, 'task.json'), JSON.stringify({ runId, kind: report.kind }) + '\n', { flag: 'wx' }),
    writeFile(join(directory, 'config.snapshot.json'), configJson, { flag: 'wx' }),
    writeFile(join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }),
    writeFile(join(directory, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n', { flag: 'wx' }),
    writeFile(join(directory, 'summary.md'), `DSH component fixture: ${report.ok ? 'passed' : 'failed'}.\nNo model or CAD evaluated.\n`, { flag: 'wx' }),
  ]);
  return directory;
}
