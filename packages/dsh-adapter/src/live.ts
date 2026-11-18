import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { brandString } from '@deepseek-ai/dsh-brand';
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { ContentBlock, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore from '@deepseek-ai/dsh-session';
import type { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import ToolsService, { defineTool } from '@deepseek-ai/dsh-tools';
import * as nativeExecutor from '@deepseek-ai/dsh-tool-executor-native';
import * as piAi from '@deepseek-ai/dsh-llm-pi-ai';
import * as mcpClient from '@deepseek-ai/dsh-mcp-client';
import Attachments from '@deepseek-ai/dsh-attachment-local';
import FileSystem from '@deepseek-ai/dsh-fs-local';
import type { ModelProfile, RuntimeConfig, McpConfig } from '@cader/config';
import { requireCredential, workspacePath } from '@cader/config';
import { ChildPool } from './pool.js';

export interface PublicEvent { type: string; agentId?: string; role?: string; [key: string]: unknown }
export interface AgentResult {
  id: string; profile: string; status: 'succeeded' | 'failed' | 'cancelled';
  text: string; errorCode?: string; modelSteps: number; tools: string[];
}
interface LiveOptions {
  root: string; runDirectory: string; profiles: ModelProfile[]; runtime: RuntimeConfig;
  mcp?: McpConfig; onEvent?: (event: PublicEvent) => void;
  images?: Record<string, string>;
}

export async function createLiveRuntime(options: LiveOptions) {
  const ctx = new Context();
  const pool = new ChildPool(options.runtime.max_parallel_subagents);
  const profiles = new Map(options.profiles.map(profile => [profile.id, profile]));
  const roles = new WeakMap<Agent, ModelProfile['role']>();
  const images = new Map(Object.entries(options.images ?? {}));
  const completed: AgentResult[] = [];
  const emit = (event: PublicEvent) => options.onEvent?.({ at: new Date().toISOString(), ...event });
  let steps = 0, calls = 0, delegations = 0;
  const lifetime = new AbortController();
  const deadline = setTimeout(() => lifetime.abort(), options.runtime.timeout_ms);
  deadline.unref();
  const routeFor = (profile: ModelProfile) => `cader-${profile.id.toLowerCase()}`;
  try {
    await ctx.plugin(FileSystem, { cwd: options.root });
    await ctx.plugin(Attachments, { dshHome: resolve(options.runDirectory, 'attachments') });
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjections);
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: true });
    await ctx.plugin(ToolsService);
    await ctx.plugin(nativeExecutor);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 5 });
    const providers: Record<string, piAi.PiAiProviderProfile> = {};
    for (const profile of options.profiles) {
      requireCredential(profile);
      providers[routeFor(profile)] = {
        apiKeyEnv: profile.api_key_env, api: 'openai-completions', baseURL: profile.base_url,
        timeoutMs: profile.timeout_ms, reasoning: profile.generation.reasoning_effort,
        models: [{ id: profile.model, input: profile.input, contextWindow: 1000000,
          maxTokens: profile.generation.max_output_tokens,
          reasoningEfforts: { off: 'none', low: 'low', high: 'high', max: 'max' } }],
        compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens',
          thinkingFormat: 'deepseek', requiresReasoningContentOnAssistantMessages: true },
        retryPolicy: { mode: 'normal', maxRetries: 0 },
      };
    }
    await ctx.plugin(piAi, { providers });
    if (options.mcp) {
      const config = options.mcp;
      await ctx.plugin(mcpClient, {
        serverName: config.server_name, transport: 'stdio', command: config.command,
        args: config.args, cwd: config.cwd, env: {},
        startupTimeoutMs: config.startup_timeout_ms, toolCallTimeoutMs: config.tool_timeout_ms,
        failOnStartupError: true, reconnect: { enabled: false },
      });
      emit({ type: 'mcp.discovered', tools: ctx.tools.schemas().map(tool => tool.name) });
    }

    async function run(profileId: string, instruction: string, request: {
      parent?: Agent; image?: string; signal?: AbortSignal;
    } = {}): Promise<AgentResult> {
      const profile = profiles.get(profileId as ModelProfile['id']);
      if (!profile) throw new Error('UNKNOWN_MODEL_PROFILE');
      if (request.parent && (roles.get(request.parent) !== 'main' || profile.role === 'main'
        || !options.runtime.subagent_profiles.includes(profileId))) throw new Error('CHILD_DELEGATION_DENIED');
      if (request.image && !profile.input.includes('image')) throw new Error('UNSUPPORTED_IMAGE_INPUT');
      const id = brandString<SessionId>(`cader-${profile.role}-${randomUUID()}`);
      const signal = AbortSignal.any([lifetime.signal, request.signal ?? new AbortController().signal,
        AbortSignal.timeout(Math.min(profile.timeout_ms, options.runtime.timeout_ms))]);
      let text = '', currentText = '', errorCode: string | undefined, agentSteps = 0;
      const tools: string[] = [];
      let handle: AgentHandle | undefined;
      const abort = () => {
        errorCode ??= 'CANCELLED_OR_TIMEOUT';
        try { handle?.agent.cancel({ kind: 'hook', reason: errorCode }); }
        catch { errorCode = 'CANCELLATION_FAILED'; }
      };
      try {
        signal.throwIfAborted();
        const staticText = await readFile(resolve(options.root, 'prompts/static',
          profile.role === 'main' ? 'MainAgent.md' : 'SubAgent.md'), 'utf8');
        handle = await ctx.agents.create({
          sessionId: id, signal,
          meta: { cwd: options.root, ...(request.parent ? { parentSession: request.parent.id,
            origin: 'subagent' as const, delegationDepth: 1 } : {}) },
          agentOptions: { provider: routeFor(profile), model: profile.model,
            maxTokens: profile.generation.max_output_tokens,
            reasoningEffort: brandString<ReasoningEffortId>(profile.generation.reasoning_effort) },
          async setup(agentCtx, agent) {
            roles.set(agent, profile.role);
            const allowed = options.runtime.read_only_tools.filter(name => Boolean(ctx.tools.get(name)));
            if (profile.can_delegate) {
              agentCtx.tools.register(defineTool({
                name: 'cader_delegate', description: 'Delegate one bounded independent task; only the main agent can call this.',
                parameters: { profile: { type: 'string', required: true,
                  enum: options.runtime.subagent_profiles }, instruction: { type: 'string', required: true },
                  image_ref: { type: 'string', description: 'Optional ID from Available.image_refs, never a filesystem path.' } },
                output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
                isConcurrencySafe: () => true,
                async execute(args, exec) {
                  if (exec.agent !== agent || profile.role !== 'main') throw new Error('CHILD_DELEGATION_DENIED');
                  if (++delegations > options.runtime.max_delegations) throw new Error('DELEGATION_BUDGET_EXCEEDED');
                  const image = args.image_ref ? images.get(args.image_ref) : undefined;
                  if (args.image_ref && !image) throw new Error('IMAGE_REFERENCE_DENIED');
                  return pool.run('main', async () => JSON.stringify(await run(args.profile, args.instruction,
                    { parent: agent, signal: exec.signal, image })));
                },
              }));
              allowed.push('cader_delegate');
            }
            agentCtx.tools.register(defineTool({
              name: 'cader_load_skill', description: 'Load a reviewed skill by its listed name.',
              parameters: { name: { type: 'string', required: true, enum: ['cad-inspection'] } },
              output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
              async execute() { return readFile(resolve(options.root, 'skills/cad-inspection/SKILL.md'), 'utf8'); },
            }));
            allowed.push('cader_load_skill');
            const hidden = ctx.tools.schemas().map(tool => tool.name).filter(name => !allowed.includes(name));
            if (hidden.length) agentCtx.tools.restrict({ deny: hidden });
            agentCtx.tools.guard(exec => {
              if (!allowed.includes(exec.name) || (exec.name === 'cader_delegate' && !profile.can_delegate))
                return { reason: 'Tool is unavailable to this role', info: { name: 'CaderPolicyError', code: 'PERMISSION_DENIED' } };
              if (++calls > options.runtime.max_tool_calls) {
                errorCode = 'TOOL_BUDGET_EXCEEDED';
                return { reason: errorCode, info: { name: 'CaderBudgetError', code: errorCode } };
              }
              return undefined;
            });
            agentCtx.systemPrompt.section({ name: 'cader:static', order: 0, text: staticText, interpolate: false });
            agentCtx.systemPrompt.context({ name: 'cader:available', order: 120, required: true,
              interpolate: false, text: () => JSON.stringify({ role: profile.role, model: profile.model,
                tools: agentCtx.tools.schemas(agent).map(tool => tool.name),
                skills: [{ name: 'cad-inspection', description: 'Read-only CAD layer inspection; load with cader_load_skill.' }],
                remaining_model_steps: Math.max(0, options.runtime.max_model_steps - steps),
                remaining_tool_calls: Math.max(0, options.runtime.max_tool_calls - calls),
                max_parallel_subagents: profile.can_delegate ? pool.limit : 0,
                worker_profiles: profile.can_delegate ? options.profiles.filter(worker => worker.role !== 'main')
                  .map(worker => ({ id: worker.id, role: worker.role, model: worker.model, input: worker.input })) : [],
                image_refs: profile.can_delegate ? [...images.keys()] : [],
                document_identity_and_units: 'not verified; do not assume target identity or units',
              }) });
            agentCtx.on('agent/pre-step', async (_payload, next) => {
              if (++steps > options.runtime.max_model_steps) { errorCode = 'MODEL_STEP_BUDGET_EXCEEDED'; return { kind: 'reject' }; }
              agentSteps++;
              emit({ type: 'model.step', agentId: id, role: profile.role, model: profile.model });
              return next();
            });
            agentCtx.on('agent/request-error', async (payload, next) => {
              errorCode = payload.failure.code;
              emit({ type: 'model.error', agentId: id, role: profile.role, code: errorCode,
                status: payload.failure.status });
              return next();
            });
            agentCtx.on('agent/assistant-stream', ({ frame }) => {
              if (frame.type === 'start') currentText = '';
              if (frame.type === 'chunk' && frame.chunk.type === 'text-delta') currentText += frame.chunk.text;
              if (frame.type === 'chunk' && frame.chunk.type === 'usage')
                emit({ type: 'model.usage', agentId: id, role: profile.role, usage: frame.chunk.usage });
              if (frame.type === 'end') text = currentText;
            });
            agentCtx.on('tools/result', (exec, result) => {
              tools.push(exec.name);
              emit({ type: 'tool.result', agentId: id, role: profile.role, callId: exec.callId,
                tool: exec.name, isError: result.isError });
            });
            const prompt = await agentCtx.systemPrompt.assemble({ scope: agent, agent });
            emit({ type: 'prompt.assembled', agentId: id, role: profile.role,
              staticPrompt: renderPrompt(prompt), available: prompt.contexts,
              tools: prompt.tools.map(tool => tool.name) });
          },
        });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        const content: ContentBlock[] = [{ type: 'text', text: instruction }];
        if (request.image) {
          const path = await workspacePath(options.root, request.image);
          const image = await ctx.attachments.saveImage({ data: await readFile(path), mediaType: 'image/png' });
          content.push({ type: 'image', attachment: image });
        }
        emit({ type: 'agent.started', agentId: id, role: profile.role, parentId: request.parent?.id });
        handle.agent.followup(createUserMessage({ content, source: { kind: 'user' } }));
        await handle.agent.whenIdle();
        const status: AgentResult['status'] = signal.aborted ? 'cancelled' : errorCode || !text.trim() ? 'failed' : 'succeeded';
        emit({ type: 'agent.completed', agentId: id, role: profile.role, status });
        const result = { id, profile: profileId, status, text, ...(errorCode ? { errorCode } : {}), modelSteps: agentSteps, tools };
        completed.push(result);
        return result;
      } finally {
        signal.removeEventListener('abort', abort);
        await handle?.dispose();
      }
    }
    return { ctx, run, pool, completed: () => completed.slice(), toolNames: () => ctx.tools.schemas().map(tool => tool.name),
      async dispose() { clearTimeout(deadline); lifetime.abort(); await ctx.fiber.dispose(); } };
  } catch (error) { clearTimeout(deadline); await ctx.fiber.dispose(); throw error; }
}
