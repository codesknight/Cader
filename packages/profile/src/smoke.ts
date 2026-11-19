import { createToolRuntime, defineTool, invokeTool } from '@cader/dsh-adapter';
import * as policy from '@cader/cad-policy';
export { runLiveSmoke } from './live-smoke.js';
export { runTask } from './task.js';
export { describeFailure, failureFromError } from './failure.js';

export async function runHarnessSmoke() {
  const ctx = await createToolRuntime();
  let writes = 0;
  const events: { callId: string; tool: string; isError: boolean; observedAt: string }[] = [];
  try {
    const fixture = await ctx.plugin({
      name: 'cader-smoke-fixture', inject: ['tools'],
      apply(context) {
        context.tools.register(defineTool({
          name: 'general_ping', description: 'Read-only deterministic fixture probe.',
          parameters: { value: { type: 'string', required: true } },
          output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
          async execute(args) { return args.value; },
        }));
        context.tools.register(defineTool({
          name: 'general_write_fixture', description: 'Forbidden synthetic write for policy testing.',
          parameters: {},
          output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
          async execute() { writes++; return 'written'; },
        }));
      },
    });
    await ctx.plugin(policy, { readOnlyTools: ['general_ping'] });
    ctx.on('tools/result', (exec, result) => {
      events.push({ callId: exec.callId, tool: exec.name, isError: result.isError,
        observedAt: new Date().toISOString() });
    });
    const success = await invokeTool(ctx, 'general_ping', { value: 'cader-dsh-smoke' });
    const invalid = await invokeTool(ctx, 'general_ping', { value: 123 });
    const denied = await invokeTool(ctx, 'general_write_fixture', {});
    const controller = new AbortController();
    controller.abort();
    const cancelled = await invokeTool(ctx, 'general_ping', { value: 'cancelled' }, controller.signal);
    await fixture.dispose();
    const checks = {
      plugin_loaded: !success.isError && success.value === 'cader-dsh-smoke',
      argument_validation: invalid.isError,
      write_denied: denied.isError && denied.error.info?.code === 'PERMISSION_DENIED' && writes === 0,
      cancellation_is_error: cancelled.isError && cancelled.error.info?.code === 'ABORTED_BEFORE_DISPATCH',
      result_events: events.length === 3 && events[0]?.tool === 'general_ping'
        && events[1]?.isError === true && events[2]?.tool === 'general_write_fixture',
      plugin_disposal: ctx.tools.get('general_ping') === undefined,
    };
    return {
      ok: Object.values(checks).every(Boolean), kind: 'dsh-component-fixture',
      runtime: 'DeepSeek Harness', dshVersion: '0.2.2-rc.4', checks,
      eventCount: events.length, toolEvents: events, cancelledBeforeDispatch: cancelled.isError,
      realModelEvaluated: false, cadEvaluated: false,
      fullAppProfileEvaluated: false,
    };
  } finally {
    await ctx.fiber.dispose();
  }
}
