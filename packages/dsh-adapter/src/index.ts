// Keep upstream imports and version-sensitive wiring inside this package.
import { Context } from '@deepseek-ai/cordis';
import { brandString } from '@deepseek-ai/dsh-brand';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as nativeExecutor from '@deepseek-ai/dsh-tool-executor-native';
import ToolsService, { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolCallId } from '@deepseek-ai/dsh-llm';

export { Context, defineTool };
export type { ToolExecution, ToolExecutionResult, PreToolDecision } from '@deepseek-ai/dsh-tools';

export async function createToolRuntime(): Promise<Context> {
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolsService);
    await ctx.plugin(nativeExecutor);
    return ctx;
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
}

export async function invokeTool(
  ctx: Context, name: string, args: Record<string, unknown>,
  signal: AbortSignal = new AbortController().signal,
) {
  const batch = await ctx.tools.execute({
    calls: [{
      type: 'tool-call', id: brandString<ToolCallId>(crypto.randomUUID()),
      name, arguments: JSON.stringify(args),
    }],
    signal,
    maxParallelToolCalls: 1,
  });
  const result = batch.results[0]?.result;
  if (!result) throw new Error('DSH returned no tool result');
  return result;
}
