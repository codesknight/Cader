import type { AgentResult, PublicEvent } from '@cader/dsh-adapter';

export type FailureSource = 'provider' | 'agent' | 'mcp' | 'configuration' | 'runtime' | 'verification' | 'usage';
const hints: Record<string, string> = {
  QUOTA: '模型服务拒绝请求（QUOTA）；请核对该API Key对应账户的余额、配额和模型访问权限。尚不能仅凭此码断言余额不足；MCP连接状态另行报告。',
  ACCEPTANCE_PLAN_MISSING: '模型未提交有效验收计划，尚未允许绘图。检查规划工具错误和模型运行记录；不会将此状态称为已绘图待验证。',
  TASK_EXECUTION_REQUIRED:'本任务没有新建图纸或实际绘图证据，已阻止使用旧图验收。请查看执行轨迹；未重放旧操作。',
  REFERENCE_INSPECTION_FAILED:'参考图未形成有效且匹配原图哈希的结构观察；尚未允许绘图。检查视觉模型响应和格式修复记录。',
  SOURCE_TOPOLOGY_UNCERTAIN:'原图外部连接经独立复核仍不确定，尚未允许绘图；查看net_review及原图局部证据，不按电路常识猜接线。',
  SOURCE_LABEL_INVENTORY_FAILED:'原图整图标注清点未形成有效结果，尚未允许绘图；查看源图清点调用记录。',
  DRAWING_UNIT_NOT_CLOSED:'当前绘图单元未提交有效读回检查点，已停止后续单元；现有确认操作保留，不能重放整图。',
  CHECKPOINT_READBACK_FAILED:'续跑检查点读回失败，已停止自动续写；保留执行账本及原图，先核对当前文档。',
  CHECKPOINT_PERSIST_FAILED:'检查点未能写入运行记录，已停止后续绘图单元；已确认操作不得重放。',
  CONTINUATION_BINDING_CHANGED:'续跑连接或图纸绑定发生变化，已停止；不能接管新连接或重放原写入。',
  TRUNCATION_RECOVERY_UNSAFE:'截断后存在冻结或连接变化，不满足自动续跑条件；未知写入不得重放。',
  REFERENCE_CHANGED_RESELECT_REQUIRED:'已授权的参考图快照发生变化；请重新选择原图，旧任务不会自动重放。',
  REFERENCE_TASK_MISMATCH:'恢复请求的原图或DWG目标与封存任务不一致；未重放绘图。请显式发起新的任务。',
  DWG_SAVE_FAILED:'DWG未完成保存或文件校验；查看保存操作的原始错误。未知保存结果不得重放或宣称交付。',
  ACCOUNT_QUOTA: 'Check provider account quota and billing before retrying.',
  AUTH: 'Check the configured provider credential and endpoint; do not share the key.',
  RATE_LIMIT: 'Wait for the provider rate limit to recover before retrying.',
  TIMEOUT: 'Check provider availability and configured timeouts.',
  OUTPUT_TRUNCATED: '模型输出达到长度上限；未形成完整结论。检查输出预算，已确认的CAD操作不得重放。',
  MALFORMED_RESPONSE: '模型服务返回了无效格式。仅在后续有效验证实际替代该失败时记录恢复；否则任务仍未通过。',
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
  USAGE_ERROR: 'Check --help. exec accepts a task; live-smoke accepts --task only with --quality. Unknown options and empty values are rejected.',
  MODEL_STEP_BUDGET_EXCEEDED: '任务模型步骤达到总上限；质量任务已停止新操作并保留进度，续轮不会绕过总限额。',
  TOOL_BUDGET_EXCEEDED: '当前普通执行回合已达工具上限；质量任务使用检查点自动续轮，任务总限额仍然有效。',
  TASK_TOOL_BUDGET_EXCEEDED: '任务总工具预算已达上限，进度已保留；单轮续期不会重置总预算，尚未通过验收。',
  TASK_CAD_BUDGET_EXCEEDED: '任务总CAD操作预算已达上限，进度已保留；不会重放已确认操作。',
  TASK_TOKEN_BUDGET_EXCEEDED: '任务累计模型token用量达到配置上限，已停止新请求；进度待核验。这是用量限制，不是服务商余额判断。',
  EXECUTION_ROUND_LIMIT: '任务执行回合达到总上限，已安全暂停并保留检查点，尚未通过验收。',
  PATCH_EXCEEDS_ROUND_CAPACITY: '整批Patch超过单轮可容纳额度，尚未派发；调整批次大小或预算配置后再核验续跑，不能重放已确认操作。',
  CONTINUATION_OPERATION_FAILED: '未派发请求续跑时失败；已停止后续操作，查看原始执行记录。未知写入必须先对账。',
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
  if(value?.message==='REFERENCE_MCP_REQUIRED')return describeFailure('MCP_CONNECTION_FAILED','mcp');
  if(value?.message&&['REFERENCE_CHANGED_RESELECT_REQUIRED','REFERENCE_TASK_MISMATCH'].includes(value.message))return describeFailure(value.message,'verification');
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
