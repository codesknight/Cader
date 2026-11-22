import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InteractiveSession } from './interactive.js';
import { createMcpClient } from '@cader/dsh-adapter';
import { loadMcp } from '@cader/config';

/** Real-model defect detection/correction, no fixed tool-call plan. Explicit live entry only. */
export async function runVisualSmoke(root: string, mcpPath: string) {
  const workspace = resolve(root, '.cader/runs', `visual-${randomUUID()}`);
  await mkdir(workspace, { recursive: true });
  const session = await InteractiveSession.create(root, workspace);
  const events: { type: string; [key: string]: unknown }[] = [];
  const replies: unknown[] = [];
  const callbacks = { confirm: async (description: string) => description.startsWith('CAD '),
    onEvent: (event: { type: string; [key: string]: unknown }) => { if (event.type !== 'assistant.delta') events.push(event); } };
  let failure: unknown;
  let entities: Record<string, unknown>[] = [];
  try {
    await session.execute(`/mcp use ${resolve(root, mcpPath)}`); await session.execute('/model SubAgent');
    replies.push(await session.execute('请新建工作图画一个简易房屋正立面：墙体矩形(0,0)到(6000,4000)，三角屋顶顶点(-500,4000)、(3000,6500)、(6500,4000)，以及半径400的圆窗。为测试下一轮纠错，请故意将圆窗放在(3000,8800)。本轮保留这个缺陷，不保存DWG，不执行Shell。坐标均为布局单位。', callbacks));
    replies.push(await session.execute('现在请用当前CAD实际视图自动交给视觉模型检查，找出漂浮圆窗并修正，使圆完全位于三角屋顶内部。通过实体查询和几何计算定位修改，修正后再次视觉复核。无需我上传参考图，不要保存DWG或执行Shell。', callbacks));
    const verifier = await createMcpClient(await loadMcp(resolve(root, mcpPath)));
    try { entities = await verifier.call('query_entities', {}) as typeof entities; } finally { await verifier.dispose(); }
  } catch (error) { failure = { name: (error as Error).name, message: (error as Error).message }; }
  finally { await session.dispose(); }
  const circle = entities.find(e => e.type === 'AcDbCircle');
  // Independent expected triangle, check distance to every inward half-plane.
  const triangle = [[-500,4000],[6500,4000],[3000,6500]];
  const center = circle?.center as number[] | undefined, radius = circle?.radius as number | undefined;
  const contained = Boolean(center && typeof radius === 'number' && radius > 0 && triangle.every((a,i) => {
    const b = triangle[(i+1)%3]!;
    return ((b[0]!-a[0]!)*(center[1]!-a[1]!) - (b[1]!-a[1]!)*(center[0]!-a[0]!)) / Math.hypot(b[0]!-a[0]!,b[1]!-a[1]!) >= radius - 1e-6;
  }));
  const checks = { realViewCaptured: events.some(e => e.type === 'cad.view'),
    visionImageRequest: events.some(e => e.type === 'image.request'),
    visionWorkerExecuted: events.some(e => e.type === 'agent.started' && e.role === 'vision'),
    visionWorkerSucceeded: events.some(e => e.type === 'agent.completed' && e.role === 'vision' && e.status === 'succeeded'),
    twoObservations: events.filter(e => e.type === 'cad.view').length >= 2,
    circleInsideRoof: contained, exactlyOneCircle: entities.filter(e => e.type === 'AcDbCircle').length === 1,
    modelTurnsSucceeded: replies.length === 2 && replies.every(reply => !(reply as { error?: boolean }).error) };
  const report = { ok: !failure && Object.values(checks).every(Boolean), kind: 'real-model-real-CAD-visual-correction', checks,
    failure, entities, replies, execution: session.execution.facts(), runDirectory: workspace,
    limits: ['No controlled DWG reopen requested.', 'No authoritative pixel-to-CAD mapping supplied by backend; edits use queried entity coordinates.'] };
  await writeFile(resolve(workspace, 'verification.json'), session.clean(JSON.stringify(report, null, 2)));
  await writeFile(resolve(workspace, 'events.jsonl'), session.clean(events.map(e => JSON.stringify(e)).join('\n')));
  return report;
}
