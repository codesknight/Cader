import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMcpClient, createToolRuntime, invokeTool } from '@cader/dsh-adapter';
import { loadMcp } from '@cader/config';
import { ExecutionSession } from './execution.js';

/** Controlled client-boundary injection over REAL CAD mutations. This does not
 * claim to inject a COM crash, a lost network packet or a native rollback. */
export async function runFaultSmoke(root: string, mcpPath: string) {
  const directory = resolve(root, '.cader/runs', `faults-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const config = await loadMcp(resolve(root, mcpPath));
  const checks: Record<string, boolean> = {}, evidence: unknown[] = [];
  let failure: unknown;
  try {
    for (const scenario of ['postflight', 'lost-response', 'cancel'] as const) {
      const workspace = resolve(directory, scenario); await mkdir(workspace);
      let arm = false, queryFailure = false, dispatched = 0;
      const controller = new AbortController();
      const factory: typeof createMcpClient = async cfg => {
        const raw = await createMcpClient(cfg);
        return { ...raw, async call(name, args, callId) {
          if (arm && ['query_entities','get_entity'].includes(name) && queryFailure) { queryFailure = false; throw new Error('INJECTED_POSTFLIGHT_READ_FAILURE'); }
          const response = raw.call(name, args, callId);
          if (arm && name === 'draw_line') {
            dispatched++;
            if (scenario === 'cancel') controller.abort();
            const value = await response;
            if (scenario === 'lost-response') throw Object.assign(new Error('INJECTED_CLIENT_RESPONSE_SUPPRESSION_AFTER_REAL_COMMIT'), { code: 'TIMEOUT' });
            if (scenario === 'postflight') queryFailure = true;
            return value;
          }
          return response;
        } };
      };
      const owner = new ExecutionSession(workspace, resolve(workspace, '.cader/runs/owner'), undefined, factory);
      owner.mode = 'workspace-write'; await owner.connect(resolve(root, mcpPath));
      const ctx = await createToolRuntime();
      try {
        for (const tool of owner.definitions()) ctx.tools.register(tool);
        const prefix = `mcp__${config.server_name}__`;
        if ((await invokeTool(ctx, prefix + 'new_drawing', {})).isError) throw new Error('FAULT_SETUP_NEW_DRAWING_FAILED');
        arm = true;
        const args = { start_x: 0,start_y: 0,start_z: 0,end_x: 10,end_y: 0,end_z: 0 };
        const result = await invokeTool(ctx, prefix + 'draw_line', args, controller.signal);
        const facts = owner.facts();
        const observed = JSON.parse(String((await invokeTool(ctx, prefix + 'query_entities', {})).value)) as unknown[];
        checks[scenario + '_actual_one_entity'] = observed.length === 1;
        checks[scenario + '_single_dispatch'] = dispatched === 1;
        if (scenario === 'lost-response') {
          const blocked = await invokeTool(ctx, prefix + 'draw_line', args);
          checks.unknown_blocks_followup = blocked.isError && dispatched === 1;
          checks.unknown_does_not_recover = !(await owner.recover()).recovered;
        } else if (scenario === 'postflight') {
          checks.acknowledgement_distinguished = facts.operations.at(-1)?.outcome === 'committed_observation_failed';
          checks.acknowledged_recovered_without_replay = (await owner.recover()).recovered === true && dispatched === 1;
        } else checks.cancel_settled_committed = result.isError && facts.operations.at(-1)?.outcome === 'committed' && !facts.frozen;
        evidence.push({ scenario, facts, observed, after: owner.facts() });
      } finally { await owner.dispose(); await ctx.fiber.dispose(); }
    }
  } catch (error) { failure = { name: (error as Error).name, message: (error as Error).message }; }
  const report = { ok: !failure && Object.keys(checks).length === 11 && Object.values(checks).every(Boolean),
    kind: 'real-CAD-client-boundary-fault-injection', realModelEvaluated: false, checks, failure, evidence,
    limitations: ['Client-boundary injected failures, not actual network-loss/native COM fault injection.', 'Unresolved locks are retained only in isolated scenario workspaces.'], runDirectory: directory };
  await writeFile(resolve(directory,'verification.json'), JSON.stringify(report,null,2)); return report;
}
