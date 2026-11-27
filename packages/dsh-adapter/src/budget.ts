import type { RuntimeConfig } from '@cader/config';

export type BudgetStop = 'EXECUTION_ROUND_EXHAUSTED' | 'TASK_TOOL_BUDGET_EXCEEDED' | 'TASK_CAD_BUDGET_EXCEEDED' | 'TASK_TOKEN_BUDGET_EXCEEDED' | 'EXECUTION_ROUND_LIMIT' | 'PATCH_EXCEEDS_ROUND_CAPACITY';

/** Admission reservations, not claims that a native CAD mutation committed.
 * Reservations are charged before dispatch and are intentionally conservative
 * on failures. Only a new execution round replenishes the round allowance. */
export class ExecutionBudget {
  private round = 0;
  private tools = 0;
  private cad = 0;
  private roundTools = 0;
  private roundCad = 0;
  private tokens = 0;
  constructor(private readonly config: RuntimeConfig) {}
  restore(saved:{execution_round:number;tool_reservations:number;cad_reservations:number;reported_tokens:number;round_tool_reservations?:number;round_cad_reservations?:number}){
    if(this.round||this.tools||this.cad||this.tokens)throw new Error('BUDGET_ALREADY_STARTED');
    if([saved.execution_round,saved.tool_reservations,saved.cad_reservations,saved.reported_tokens].some(v=>!Number.isSafeInteger(v)||v<0)||[saved.round_tool_reservations,saved.round_cad_reservations].some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0)))throw new Error('BUDGET_CHECKPOINT_INVALID');
    this.round=saved.execution_round;this.tools=saved.tool_reservations;this.cad=saved.cad_reservations;this.tokens=saved.reported_tokens;
    // A legacy checkpoint without round reservations must yield to a NEW
    // counted round; resumption cannot silently refill the current allowance.
    this.roundTools=saved.round_tool_reservations??this.config.max_tool_calls;
    this.roundCad=saved.round_cad_reservations??(this.config.max_cad_operations_per_round??64);
  }
  beginRound(): BudgetStop | undefined {
    if (this.round >= (this.config.max_execution_rounds ?? 12)) return 'EXECUTION_ROUND_LIMIT';
    this.round++; this.roundTools = 0; this.roundCad = 0;
    return undefined;
  }
  taskStop(): BudgetStop | undefined {
    return this.tokens >= (this.config.max_task_tokens ?? 2000000) ? 'TASK_TOKEN_BUDGET_EXCEEDED' : undefined;
  }
  roundExhausted() {
    return this.roundTools >= this.config.max_tool_calls-(this.config.validation_tool_reserve??8) ||
      this.roundCad >= (this.config.max_cad_operations_per_round??64);
  }
  admit(tools: number, cad: number, validation = false, freshOverhead = 0): BudgetStop | undefined {
    const reserve = validation ? 0 : (this.config.validation_tool_reserve ?? 8);
    const roundCap = this.config.max_tool_calls - reserve;
    const cadCap = this.config.max_cad_operations_per_round ?? 64;
    if (this.taskStop()) return this.taskStop();
    if (this.tools + tools > (this.config.max_task_tool_calls ?? 600) - reserve) return 'TASK_TOOL_BUDGET_EXCEEDED';
    if (this.cad + cad > (this.config.max_cad_operations ?? 400)) return 'TASK_CAD_BUDGET_EXCEEDED';
    if (tools + freshOverhead > roundCap || cad > cadCap) return 'PATCH_EXCEEDS_ROUND_CAPACITY';
    if (this.roundTools + tools > roundCap || this.roundCad + cad > cadCap) return 'EXECUTION_ROUND_EXHAUSTED';
    this.tools += tools; this.cad += cad; this.roundTools += tools; this.roundCad += cad;
    return undefined;
  }
  recordTokens(value: number) { if (Number.isFinite(value) && value > 0) this.tokens += value; }
  snapshot() {
    return { execution_round: this.round, tool_reservations: this.tools, cad_reservations: this.cad,
      round_tool_reservations: this.roundTools, round_cad_reservations: this.roundCad, reported_tokens: this.tokens,
      remaining_round_tools: Math.max(0, this.config.max_tool_calls - this.roundTools),
      remaining_round_cad: Math.max(0, (this.config.max_cad_operations_per_round ?? 64) - this.roundCad),
      max_cad_operations_per_round: this.config.max_cad_operations_per_round ?? 64,
      remaining_task_tools: Math.max(0, (this.config.max_task_tool_calls ?? 600) - this.tools),
      remaining_task_cad: Math.max(0, (this.config.max_cad_operations ?? 400) - this.cad),
      validation_tool_reserve: this.config.validation_tool_reserve ?? 8 };
  }
}
