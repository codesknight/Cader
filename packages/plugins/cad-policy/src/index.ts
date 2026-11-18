import type { Context, ToolExecution, PreToolDecision } from '@cader/dsh-adapter';

export const name = 'cader-cad-policy';
export const inject = ['tools'];

export interface PolicyConfig {
  readOnlyTools: readonly string[];
}

export function apply(ctx: Context, config: PolicyConfig): void {
  const allowed = new Set(config.readOnlyTools);
  const denial = (exec: ToolExecution) => allowed.has(exec.name) ? undefined : {
    reason: 'Cader M0 permits only explicitly reviewed read-only tools.',
    info: { name: 'CaderPolicyError', code: 'PERMISSION_DENIED' },
  };
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const refused = denial(exec);
    if (refused) return { kind: 'deny', ...refused };
    return next();
  });
  // The final guard preserves denial even if a later cooperative hook returns allow.
  ctx.tools.guard(denial);
}
