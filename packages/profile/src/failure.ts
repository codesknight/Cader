import type { AgentResult, PublicEvent } from '@cader/dsh-adapter';

export type FailureSource = 'provider' | 'agent' | 'mcp' | 'configuration' | 'runtime' | 'verification' | 'usage';
const hints: Record<string, string> = {
  QUOTA: 'Check provider balance, quota and model entitlement. MCP connectivity is reported separately.',
  ACCOUNT_QUOTA: 'Check provider account quota and billing before retrying.',
  AUTH: 'Check the configured provider credential and endpoint; do not share the key.',
  RATE_LIMIT: 'Wait for the provider rate limit to recover before retrying.',
  TIMEOUT: 'Check provider availability and configured timeouts.',
  OUTPUT_TRUNCATED: '模型输出达到长度上限；未形成完整结论。检查输出预算，已确认的CAD操作不得重放。',
  NETWORK: 'Check provider network connectivity.',
  CONFIG_INVALID: 'Check model/MCP/Skill configuration, reference image limits and required credential environment variables.',
  CONFIG_NOT_FOUND: 'Check the configuration file path and run from the Cader repository root.',
  MCP_CONNECTION_FAILED: 'Check the MCP command, environment, working directory and server stderr.',
  LEGACY_REQUEST_REQUIRES_REVIEW: 'This journal predates draft revision 2. Keep the lock and review the original request; do not replay or auto-migrate it.',
  REQUEST_JOURNAL_MISMATCH: 'The persisted request does not match its audit data. Keep the lock and inspect the original journal before further action.',
  NO_FROZEN_REQUEST: 'No matching locked request was found. Check the run directory without deleting a lock or replaying a request.',
  RECONCILIATION_RESULT_UNVERIFIABLE: 'The response did not match the original operation, instance, documents or artifact. Keep the lock; do not replay.',
  RUNTIME_INIT_FAILED: 'Check runtime configuration and dependencies.',
  VERIFICATION_FAILED: 'Inspect individual checks and verification.json; smoke is a fixed read-only test.',
  USAGE_ERROR: 'Check --help. exec accepts a task; live-smoke is fixed and accepts no --task. Unknown options and empty values are rejected.',
  MODEL_STEP_BUDGET_EXCEEDED: 'Reduce task scope or review the configured model-step budget.',
  TOOL_BUDGET_EXCEEDED: 'Reduce task scope or review the configured tool-call budget.',
  CANCELLED_OR_TIMEOUT: 'The run was cancelled or timed out; inspect its recorded events.',
};
const known = new Set([...Object.keys(hints), 'EMPTY_RESPONSE', 'CONTEXT_WINDOW_EXCEEDED', 'NO_ADAPTER',
  'UNKNOWN', 'AGENT_FAILED', 'CHILD_FAILED', 'DELEGATION_BUDGET_EXCEEDED', 'CLEANUP_FAILED']);

/** Never expose arbitrary exception names/messages or provider response bodies as diagnostics. */
export function describeFailure(code: unknown, source: FailureSource) {
  const errorCode = typeof code === 'string' && (known.has(code) || /^HTTP_[1-5][0-9]{2}$/.test(code))
    ? code : 'UNKNOWN';
  return { errorCode, source, hint: hints[errorCode] ?? 'Inspect sanitized run events and verification.json for this failure.' };
}

export function failureFromError(error: unknown, source: FailureSource = 'runtime') {
  const value = error as { name?: string; code?: string; message?: string } | null;
  if (value?.name === 'CadControlError' && ['LEGACY_REQUEST_REQUIRES_REVIEW', 'REQUEST_JOURNAL_MISMATCH',
    'NO_FROZEN_REQUEST', 'RECONCILIATION_RESULT_UNVERIFIABLE'].includes(value.code ?? ''))
    return describeFailure(value.code, 'verification');
  if (value?.name === 'ConfigError') return describeFailure('CONFIG_INVALID', 'configuration');
  if (value?.message === 'INVALID_ENV_FILE' || value?.message === 'SMOKE_REQUIRES_ROLE_PROFILES')
    return describeFailure('CONFIG_INVALID', 'configuration');
  if (value?.code === 'ENOENT') return describeFailure('CONFIG_NOT_FOUND', 'configuration');
  if (value?.message === 'USAGE_ERROR') return describeFailure('USAGE_ERROR', 'usage');
  return describeFailure(source === 'mcp' ? 'MCP_CONNECTION_FAILED' : 'RUNTIME_INIT_FAILED', source);
}

export function agentFailure(results: readonly AgentResult[], events: readonly PublicEvent[], mainId?: string) {
  const main = results.find(result => result.id === mainId);
  const failed = main?.status !== 'succeeded' ? main : results.find(result => result.status !== 'succeeded'&&!result.recovered_by);
  if (!failed) return undefined;
  const provider = events.find(event => event.type === 'model.error' && event.agentId === failed.id);
  return describeFailure(failed.errorCode ?? provider?.code ?? 'AGENT_FAILED', provider ? 'provider' : 'agent');
}
