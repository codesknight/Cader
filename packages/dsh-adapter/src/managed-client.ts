import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolsService from '@deepseek-ai/dsh-tools';
import * as nativeExecutor from '@deepseek-ai/dsh-tool-executor-native';
import * as mcpClient from '@deepseek-ai/dsh-mcp-client';
import type { McpConfig } from '@cader/config';
import { mcpEnvironment } from '@cader/config';
import { invokeTool } from './tool-call.js';

export const MANAGED_TOOLS = ['get_backend_status', 'create_working_document', 'execute_atomic_batch',
  'get_job_status', 'query_entities_page', 'save_document_as', 'reopen_document'] as const;

/** Program-only client. No Agent, model, generic shell or tools exposed to children. */
export async function createManagedClient(config: McpConfig) {
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolsService);
    await ctx.plugin(nativeExecutor);
    await ctx.plugin(mcpClient, { serverName: config.server_name, transport: 'stdio', command: config.command,
      args: config.args, cwd: config.cwd, env: mcpEnvironment(config), startupTimeoutMs: config.startup_timeout_ms,
      toolCallTimeoutMs: config.tool_timeout_ms, failOnStartupError: true, reconnect: { enabled: false } });
    return {
      toolNames: () => ctx.tools.schemas().map(tool => tool.name.replace(`mcp__${config.server_name}__`, '')),
      async call(name: string, args: Record<string, unknown>): Promise<unknown> {
        if (!(MANAGED_TOOLS as readonly string[]).includes(name)) throw new Error('UNSUPPORTED_MANAGED_TOOL');
        const result = await invokeTool(ctx, `mcp__${config.server_name}__${name}`, args);
        if (result.isError) throw new Error('MCP_TOOL_FAILED');
        const value = result.value as { structuredContent?: unknown; content?: { type: string; text?: string }[] };
        if (value.structuredContent && typeof value.structuredContent === 'object') return value.structuredContent;
        const text = value.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('');
        if (!text) throw new Error('INVALID_MCP_RESULT');
        return JSON.parse(text);
      },
      dispose: () => ctx.fiber.dispose(),
    };
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
