import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMcpClient, createToolRuntime, invokeTool } from '@cader/dsh-adapter';
import { loadMcp } from '@cader/config';
import { ExecutionSession } from './execution.js';

/** Real CAD deterministic reproduction, explicitly distinct from real-model acceptance.
 * All targets are new scratch drawings. Never adopts/removes another workspace's lock. */
export async function runReliabilitySmoke(root: string, mcpPath: string) {
  const directory = resolve(root, '.cader/runs', `reliability-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const config = await loadMcp(resolve(root, mcpPath));
  const experiments: { experiment: string; round: number; writes: number; passed: boolean; duration_ms: number; evidence?: unknown }[] = [];
  const progress = (value: unknown) => writeFile(resolve(directory, 'progress.json'), JSON.stringify(value, null, 2));
  function verify(entities: unknown, count: number) {
    if (!Array.isArray(entities) || entities.length !== count) return false;
    return Array.from({ length: count }, (_, i) => entities.some(e => e.type === 'AcDbLine' &&
      JSON.stringify(e.start_point) === JSON.stringify([i * 2, 0, 0]) && JSON.stringify(e.end_point) === JSON.stringify([i * 2, 10, 0]))).every(Boolean);
  }
  const args = (i: number) => ({ start_x: i * 2, start_y: 0, start_z: 0, end_x: i * 2, end_y: 10, end_z: 0 });
  let failure: unknown;
  try {
    // A: independent service client, three isolated rounds of 100 writes.
    const raw = await createMcpClient(config);
    try {
      for (let round = 1; round <= 3; round++) {
        const started = Date.now(); await raw.call('new_drawing', {});
        for (let i = 0; i < 100; i++) { await raw.call('draw_line', args(i)); if (i % 20 === 0) await progress({ experiment: 'A', round, writes: i + 1 }); }
        const entities = await raw.call('query_entities', {});
        experiments.push({ experiment: 'A', round, writes: 100, passed: verify(entities, 100), duration_ms: Date.now() - started });
        if (!experiments.at(-1)!.passed) throw new Error('RAW_ENTITY_VERIFICATION_FAILED');
      }
    } finally { await raw.dispose(); }
    // B: same DSH tool dispatcher + Cader execution owner, three rounds of 100.
    const owner = new ExecutionSession(directory, resolve(directory, '.cader/runs/owner'));
    owner.mode = 'workspace-write'; await owner.connect(resolve(root, mcpPath));
    const ctx = await createToolRuntime();
    try {
      for (const tool of owner.definitions()) ctx.tools.register(tool);
      const prefix = `mcp__${config.server_name}__`;
      const call = async (name: string, payload: Record<string, unknown>) => { const result = await invokeTool(ctx, prefix + name, payload); if (result.isError) throw new Error(JSON.stringify(result.error)); return result; };
      for (let round = 1; round <= 3; round++) {
        const started = Date.now(); await call('new_drawing', {});
        for (let i = 0; i < 100; i++) { await call('draw_line', args(i)); if (i % 20 === 0) await progress({ experiment: 'B', round, writes: i + 1 }); }
        const observed = JSON.parse(String((await call('query_entities', {})).value));
        experiments.push({ experiment: 'B', round, writes: 100, passed: verify(observed, 100), duration_ms: Date.now() - started });
        if (!experiments.at(-1)!.passed) throw new Error('OWNER_ENTITY_VERIFICATION_FAILED');
      }
      // E: ten explicit new-document transitions, ten writes in each document.
      for (let round = 1; round <= 10; round++) {
        const started = Date.now(); await call('new_drawing', {});
        for (let i = 0; i < 10; i++) await call('draw_line', args(i));
        const observed = JSON.parse(String((await call('query_entities', {})).value));
        experiments.push({ experiment: 'E', round, writes: 10, passed: verify(observed, 10), duration_ms: Date.now() - started });
        await progress({ experiment: 'E', round, writes: 10 });
        if (!experiments.at(-1)!.passed) throw new Error('LIFECYCLE_ENTITY_VERIFICATION_FAILED');
      }
    } finally { await owner.dispose(); await ctx.fiber.dispose(); }
  } catch (error) { failure = { name: (error as Error).name, message: (error as Error).message }; }
  const report = { ok: !failure && experiments.length === 16 && experiments.every(e => e.passed),
    kind: 'real-CAD-deterministic-reproduction', realModelEvaluated: false, experiments, failure,
    expected: 'A=3x100 direct, B=3x100 owner, E=10x10 lifecycle; compare every line endpoint', runDirectory: directory };
  await writeFile(resolve(directory, 'verification.json'), JSON.stringify(report, null, 2));
  return report;
}
