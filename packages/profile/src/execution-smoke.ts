import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { InteractiveSession } from './interactive.js';
import { createMcpClient } from '@cader/dsh-adapter';
import { loadMcp } from '@cader/config';

/** Explicit paid-model + real CAD acceptance through the same application service
 * as the CLI. The prompt supplies requirements, never tool names or a fixed plan. */
export async function runExecutionSmoke(root: string, mcpPath: string) {
  const directory = resolve(root, '.cader/runs', `agent-execution-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const output = resolve(directory, 'agent-result.dwg');
  const session = await InteractiveSession.create(root);
  const events: unknown[] = [], approvals: string[] = [], replies: unknown[] = [];
  const checks: Record<string, boolean> = {};
  try {
    await session.execute(`/mcp use ${mcpPath}`);
    await session.execute('/model SubAgent'); // configured text model, not a deterministic model fixture
    const discovered = await session.execute('/mcp tools');
    checks.discovery = discovered.text.includes('draw_circle');
    const callbacks = { confirm: async (description: string) => { if (!description.startsWith('CAD ')) return false; approvals.push(description); return true; },
      onEvent: (event: { type: string }) => { if (event.type !== 'assistant.delta') events.push(event); } };
    replies.push(await session.execute('请在AutoCAD中新建空白工作图，创建名为CADER_ACCEPTANCE的图层，颜色为红色（ACI 1）。在此层画从(0,0,0)到(100,0,0)的直线、对角点为(0,0,0)和(100,60,0)的矩形、圆心(50,30,0)半径15的圆。查询确认结果。坐标使用图纸单位，不要求参考图片。', callbacks));
    const first = replies[0] as { error?: boolean };
    if (!first.error) replies.push(await session.execute(`请把刚才创建的圆向X正方向平移5个单位，再保存为 ${output}，查询验证几何并检查文件。`, callbacks));
    // Independent client; never trusts the generating model's final text.
    const verifier = await createMcpClient(await loadMcp(mcpPath));
    let entities: Record<string, unknown>[] = [], layers: unknown;
    try { entities = await verifier.call('query_entities', {}) as typeof entities; layers = await verifier.call('list_layers', {}); }
    finally { await verifier.dispose(); }
    const close = (a: unknown, b: unknown): boolean => Array.isArray(b) ? Array.isArray(a) && a.length === b.length && b.every((v, i) => close(a[i], v)) : typeof b === 'number' ? typeof a === 'number' && Math.abs(a - b) < 1e-6 : a === b;
    checks.line = entities.some(e => e.type === 'AcDbLine' && e.layer === 'CADER_ACCEPTANCE' && close(e.start_point, [0, 0, 0]) && close(e.end_point, [100, 0, 0]));
    checks.modifiedCircle = entities.some(e => e.type === 'AcDbCircle' && e.layer === 'CADER_ACCEPTANCE' && close(e.center, [55, 30, 0]) && close(e.radius, 15));
    checks.rectangle = entities.some(e => ['AcDbPolyline', 'AcDb2dPolyline'].includes(String(e.type)) && e.layer === 'CADER_ACCEPTANCE' && close((e.bounding_box as { min: unknown })?.min, [0, 0, 0]) && close((e.bounding_box as { max: unknown })?.max, [100, 60, 0]));
    checks.layer = Array.isArray(layers) && layers.includes('CADER_ACCEPTANCE');
    checks.exactEntityCount = entities.length === 3;
    checks.approval = approvals.length > 0;
    checks.modelTurns = replies.length === 2 && replies.every(reply => !(reply as { error?: boolean }).error);
    checks.multipleToolCalls = events.filter(e => (e as { type: string }).type === 'tool.result').length > 3;
    let artifact: unknown = null;
    try { const bytes = await readFile(output); checks.savedDwg = /^AC10\d\d/.test(bytes.subarray(0, 6).toString()); artifact = { path: output, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; }
    catch { checks.savedDwg = false; }
    let native: unknown;
    try {
      const config = await loadMcp(mcpPath);
      const script = 'import json,sys,os,win32com.client\na=win32com.client.GetActiveObject("AutoCAD.Application")\nd=a.ActiveDocument\np=[e for e in d.ModelSpace if e.ObjectName in ("AcDb2dPolyline","AcDbPolyline")]\nprint(json.dumps({"file_matches":os.path.normcase(os.path.abspath(d.FullName))==os.path.normcase(os.path.abspath(sys.argv[1])),"version":a.Version,"layer_color":d.Layers.Item("CADER_ACCEPTANCE").Color,"rectangles":[{"closed":bool(e.Closed),"coordinates":list(e.Coordinates)} for e in p]}))';
      native = JSON.parse((await promisify(execFile)(config.command, ['-c', script, output], { cwd: config.cwd, timeout: 20000, windowsHide: true })).stdout);
      const actual = native as { file_matches: boolean; layer_color: number; rectangles: { closed: boolean; coordinates: number[] }[] };
      checks.nativeDocumentIdentity = actual.file_matches;
      checks.layerColor = actual.layer_color === 1;
      checks.rectangleVertices = actual.rectangles.length === 1 && actual.rectangles[0]!.closed &&
        (close(actual.rectangles[0]!.coordinates, [0,0,0,100,0,0,100,60,0,0,60,0]) || close(actual.rectangles[0]!.coordinates, [0,0,100,0,100,60,0,60]));
    } catch { checks.nativeDocumentIdentity = false; checks.layerColor = false; checks.rectangleVertices = false; }
    await session.execute('/mcp off');
    checks.disconnectedStatus = (await session.execute('/status')).text.includes('MCP 未选择');
    const guidance = await session.execute('现在MCP连接已关闭。请检查你实际可用的工具，并告诉我怎样恢复AutoCAD连接以继续绘图；不要执行Shell或修改文件。', callbacks);
    replies.push(guidance);
    checks.disconnectedGuidance = !guidance.error && guidance.text.includes('/mcp');
    const report = { ok: Object.values(checks).every(Boolean), kind: 'real-model-real-cad', checks,
      independent: { entities, layers, native }, artifact, replies, approvals: approvals.length,
      limitations: ['Native read-only COM inspection is used for layer color, polygon vertices and saved document identity.', 'COM MCP has no controlled reopen API; saved/reopened acceptance is not claimed.'], runDirectory: directory };
    await writeFile(resolve(directory, 'verification.json'), session.clean(JSON.stringify(report, null, 2)));
    await writeFile(resolve(directory, 'events.jsonl'), session.clean(events.map(e => JSON.stringify(e)).join('\n')));
    return report;
  } finally { await session.dispose(); }
}
