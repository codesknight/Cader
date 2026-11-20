import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InteractiveSession } from './interactive.js';
/** One original user request, real models and real AutoCAD. No operation sequence. */
export async function runQualitySmoke(root: string, mcpPath: string) {
  const workspace = resolve(root, '.cader/runs', `quality-${randomUUID()}`);
  await mkdir(workspace, { recursive: true });
  const session = await InteractiveSession.create(root, workspace);
  const events: unknown[] = [];
  let approvals = 0;
  try {
    await session.execute(`/mcp use ${resolve(root, mcpPath)}`);
    await session.execute('/model SubAgent');
    const reply = await session.execute('画一个带有 5V 电源和一个灯泡的串联电路图。', {
      confirm: async (description) => {
        if(!description.startsWith('CAD '))
          return false; approvals++; return true;
      },
      onEvent: event => {
        if(event.type !== 'assistant.delta')
          events.push(event);
      }
    });
    const reports = events as {
      type: string;
      phase?: string;
      review_valid?: boolean;
      structured?: unknown;
    }[];
    const checks = {
      completed: !reply.error && reports.some(e => e.type === 'task.phase' && e.phase === 'complete'),
      autonomousVision: reports.some(e => e.type === 'cad.review' && e.review_valid === true),
      realImageRequest: reports.some(e => e.type === 'image.request'), taskApproval: approvals >= 1
    };
    const report = {
      ok: Object.values(checks).every(Boolean), kind: 'real-model-real-CAD-autonomous-quality', request: '画一个带有 5V 电源和一个灯泡的串联电路图。', checks, reply, approvals,
      limits: ['Native COM revision and pixel-to-CAD transform are not available; entities are re-queried by ID, never edited from pixels alone.'], runDirectory: workspace
    };
    await writeFile(resolve(workspace, 'verification.json'), session.clean(JSON.stringify(report, null, 2)));
    await writeFile(resolve(workspace, 'events.jsonl'), session.clean(events.map(e => JSON.stringify(e)).join('\n')));
    return report;
  }
  finally {
    await session.dispose();
  }
}
