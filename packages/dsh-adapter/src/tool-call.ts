import type { Context } from '@deepseek-ai/cordis';
import { brandString } from '@deepseek-ai/dsh-brand';
import type { ToolCallId } from '@deepseek-ai/dsh-llm';

export async function invokeTool(ctx: Context, name: string, args: Record<string, unknown>,
  signal: AbortSignal = new AbortController().signal, callId: string = crypto.randomUUID()) {
  const batch = await ctx.tools.execute({ calls: [{ type: 'tool-call', id: brandString<ToolCallId>(callId),
    name, arguments: JSON.stringify(args) }], signal, maxParallelToolCalls: 1 });
  const result = batch.results[0]?.result;
  if (!result) throw new Error('DSH returned no tool result');
  return result;
}
