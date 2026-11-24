// Keep upstream imports and version-sensitive wiring inside this package.
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as nativeExecutor from '@deepseek-ai/dsh-tool-executor-native';
import ToolsService, { defineTool } from '@deepseek-ai/dsh-tools';

export { Context, defineTool };
export { invokeTool } from './tool-call.js';
export { assertToolArguments, ToolArgumentsError } from './tool-validation.js';
export { createLiveRuntime } from './live.js';
export type { AgentResult, PublicEvent } from './live.js';
export type { StreamChunk } from '@deepseek-ai/dsh-llm';
export { LlmError } from '@deepseek-ai/dsh-llm';
export { ChildPool } from './pool.js';
export { ExecutionBudget } from './budget.js';
export { createManagedClient, createMcpClient, MANAGED_TOOLS } from './managed-client.js';
export { NativeCreateNotInvokedError } from './managed-client.js';
export { nativeCreateRejection } from './native-create.js';
export type { ToolDefinition } from '@deepseek-ai/dsh-tools';
export { prepareImageView, attachmentToSource, inspectCadImageBorder } from './image-view.js';
export type { ImageView } from './image-view.js';
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
