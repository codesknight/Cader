import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { loadConfig, loadMcp, loadSkills, readReferenceImage, redactSecrets, ConfigError, workspacePath } from '@cader/config';
import { createLiveRuntime } from '@cader/dsh-adapter';
import type { AgentResult, PublicEvent } from '@cader/dsh-adapter';
import type { ToolDefinition } from '@cader/dsh-adapter';
import { agentFailure, describeFailure, failureFromError } from './failure.js';
import { taskStages, BusinessOutcome } from './cad-contract.js';
import { prepareImageView } from '@cader/dsh-adapter';
import type { ImageView } from '@cader/dsh-adapter';
import { ExecutionSession } from './execution.js';
import type { PermissionMode } from './execution.js';
import { environmentRedactor } from './session-store.js';
import { requiresQuality, runQualityTask } from './quality.js';
import type { QualityResume } from './quality.js';
import type { Approval } from './execution.js';

/** Run the user's task through DSH; execution permissions come from the application. */
export async function runTask(root: string, input: { task: string; mcpPath?: string; skill?: string; image?: string; intent?: 'assess' | 'redraw'; imageView?: ImageView;
  workspaceRoot?: string; modelProfile?: string; signal?: AbortSignal; disableTools?: boolean;
  executionTools?: ToolDefinition[]; permissionMode?: PermissionMode;
  executionAuditDirectory?: string;
  executionState?: () => ReturnType<ExecutionSession['facts']>;
  toolAvailable?: (name: string) => boolean;
  captureCadView?: (signal: AbortSignal) => ReturnType<ExecutionSession['captureView']>;
  executionOwner?: ExecutionSession; confirmTask?: Approval; originalTask?: string;
  qualityResume?:QualityResume;
  history?: { role: 'user' | 'assistant'; content: string; status?: string }[]; summary?: string; domain?: string;
  onEvent?: (event: PublicEvent) => void },
  factory: typeof createLiveRuntime = createLiveRuntime) {
  if (!input.task.trim()) throw new Error('USAGE_ERROR');
  const config = await loadConfig(root);
  const cleanEnvironment = environmentRedactor().clean;
  const workspace = await realpath(input.workspaceRoot ?? root);
  if (input.modelProfile) {
    const selected = config.profiles.find(profile => profile.id === input.modelProfile);
    if (!selected) throw new ConfigError('Unknown configured model profile');
    config.profiles = config.profiles.map(profile => profile.id === config.runtime.main_profile
      ? { ...selected, id: profile.id, role: 'main' as const, can_delegate: true } : profile);
  }
  const runId = `exec-${randomUUID()}`;
  await mkdir(resolve(workspace, '.cader'), { recursive: true });
  const privateRoot = await workspacePath(workspace, '.cader');
  await mkdir(resolve(privateRoot, 'runs'), { recursive: true });
  const directory = resolve(await workspacePath(privateRoot, 'runs'), runId);
  await mkdir(directory, { recursive: true });
  const events: PublicEvent[] = [];
  let runtime: Awaited<ReturnType<typeof createLiveRuntime>> | undefined;
  let execution: ExecutionSession | undefined;
  let failure: ReturnType<typeof describeFailure> | undefined;
  let result: AgentResult | undefined;
  let quality: Awaited<ReturnType<typeof runQualityTask>> | undefined;
  let qualityPhase = 'planning';
  let qualityEnabled = Boolean(input.executionOwner && !input.disableTools && requiresQuality(input.originalTask ?? input.task));
  let cleanupError: string | undefined;
  let stage: 'configuration' | 'runtime' | 'mcp' = 'configuration';
  const stages = taskStages();
  const drawingBlocked = input.intent === 'redraw';
  try {
    if (input.skill) await (await loadSkills(root)).read(input.skill, 'main');
    if (input.image) {
      if (!config.profiles.find(profile => profile.id === config.runtime.main_profile)?.input.includes('image'))
        throw new ConfigError('The main model does not accept image input');
      await readReferenceImage(workspace, input.image);
      if (input.imageView) await prepareImageView(workspace, input.image, input.imageView);
    }
    if (!drawingBlocked) {
      let mcp = input.mcpPath ? await loadMcp(resolve(root, input.mcpPath)) : undefined;
      if (input.permissionMode && !input.executionTools) {
        const redactEnvironment = environmentRedactor().clean;
        execution = new ExecutionSession(workspace, directory, text => redactEnvironment(redactSecrets(text, config.profiles)));
        execution.mode = input.permissionMode;
        if (mcp) { stage = 'mcp'; input.signal?.throwIfAborted(); await execution.connect(resolve(root, input.mcpPath!)); }
        input.executionTools = [...execution.definitions(), ...execution.controlTools(), ...execution.fileTools()];
        input.executionState = () => execution!.facts(); input.toolAvailable = name => execution!.toolAvailable(name);
        input.captureCadView = signal => execution!.captureView(signal); mcp = undefined;
        input.executionOwner = execution;
        qualityEnabled = !input.disableTools && requiresQuality(input.originalTask ?? input.task);
      }
      stage = mcp ? 'mcp' : 'runtime';
      input.signal?.throwIfAborted();
      runtime = await factory({ root, workspaceRoot: workspace, runDirectory: directory, ...config, mcp, disableTools: input.disableTools,
        executionTools: input.executionTools, permissionMode: input.permissionMode,
        executionState: input.executionState, toolAvailable: name => (input.toolAvailable?.(name) ?? true) && (!qualityEnabled ||
          (!['cader_shell','cader_delegate','cader_review_cad_view'].includes(name) && !(qualityPhase==='correcting' && name.endsWith('__new_drawing')))), captureCadView: input.captureCadView,
        images: input.image ? { 'image-1': input.image } : {}, onEvent: event => {
          // Streaming deltas are displayed live; persist only the final public answer, not duplicate deltas.
          if (event.type !== 'assistant.delta') events.push(event);
          if (!(qualityEnabled && event.type === 'assistant.delta')) input.onEvent?.(JSON.parse(cleanEnvironment(redactSecrets(JSON.stringify(event), config.profiles))));
        } });
      stage = 'runtime';
      if(qualityEnabled && input.executionOwner) {
        quality = await runQualityTask({ runtime,root, profile: config.runtime.main_profile, task: input.originalTask??input.task,
          owner:input.executionOwner,signal:input.signal,confirm:input.confirmTask,resume:input.qualityResume,
          emit:event=>{qualityPhase=String(event.phase);events.push(event);input.onEvent?.(event);},
          persist:state=>writeFile(join(directory,'quality.json'),cleanEnvironment(redactSecrets(JSON.stringify(state,null,2),config.profiles))),
          request:{skill:input.skill,image:input.image,history:input.history,summary:input.summary,domain:input.domain} });
        result=runtime.completed().filter(agent=>agent.profile===config.runtime.main_profile).at(-1);
      } else result = await runtime.run(config.runtime.main_profile, input.task, { skill: input.skill, image: input.image, imageView: input.imageView,
          signal: input.signal, history: input.history, summary: input.summary, domain: input.domain });
      failure = agentFailure(runtime.completed(), events, result?.id);
    }
  } catch (error) { failure = failureFromError(error, stage); }
  finally {
    try { await runtime?.dispose(); }
    catch { cleanupError = 'CLEANUP_FAILED'; failure ??= describeFailure(cleanupError, 'runtime'); }
    try { await execution?.dispose(); }
    catch { cleanupError = 'CLEANUP_FAILED'; failure ??= describeFailure(cleanupError, 'runtime'); }
  }
  const cancelled = input.signal?.aborted || result?.status === 'cancelled';
  if (cancelled) failure = describeFailure('CANCELLED_OR_TIMEOUT', 'runtime');
  const runSucceeded = !failure && (drawingBlocked || result?.status === 'succeeded');
  const executionEvidence = input.executionState?.();
  const writeBlocked = Boolean(executionEvidence?.frozen);
  if (writeBlocked) stages.execution = 'blocked';
  if (drawingBlocked && runSucceeded) stages.execution = 'blocked';
  else if (runSucceeded) {
    stages.recognition = input.image ? 'unverified' : 'not_performed';
    stages.planning = 'unverified';
  }
  const qualityPending=Boolean(qualityEnabled&&quality?.phase!=='complete');
  if(quality){
    stages.planning=quality.plan?'succeeded':'failed';
    stages.execution=writeBlocked?'blocked':quality.phase==='complete'?'succeeded':'unverified';
  }
  const report = { contract_version: 'cader-task/1', ok: runSucceeded && !drawingBlocked && !writeBlocked && !qualityPending, run_status: cancelled ? 'cancelled' : runSucceeded ? 'succeeded' : 'failed',
    task_status: cancelled || writeBlocked || qualityPending ? 'blocked' : !runSucceeded ? 'failed' : drawingBlocked ? 'blocked' : quality?.phase==='complete'?'succeeded':'unverified',
    blocked_reasons: cancelled ? ['CANCELLED'] : writeBlocked ? ['CAD_WRITE_FROZEN'] : qualityPending?['QUALITY_NOT_ACCEPTED']:drawingBlocked && runSucceeded ? ['WRITE_CAPABILITY_UNAVAILABLE'] : [],
    quality:quality??null,
    execution_evidence: executionEvidence ?? null,
    authorization: { user_task_authorized: true, write_authorized: Boolean(input.permissionMode && input.permissionMode !== 'read-only' && events.some(event => event.type === 'tool.result' && event.isError === false && /(?:__(?:new_drawing|draw_\w+|create_layer|set_layer_properties|move_entity|rotate_entity|copy_entity|scale_entity|mirror_entity|delete_entity|save_drawing)|cader_(?:write_file|edit_file|shell))$/.test(String(event.tool)))),
      runtime_write_available: Boolean(input.executionTools?.length && input.permissionMode !== 'read-only') },
    performed_actions: events.filter(event => event.type === 'tool.result' && event.isError === false)
      .map(event => ({ operation: String(event.tool), status: 'succeeded' })),
    artifact: null, verification: quality?.phase==='complete'?'passed':quality?.checks.some(c=>c.status==='fail')?'failed':'not_performed', stages,
    runId, kind: 'user-task', mode: input.permissionMode ?? 'read-only',
    executionAuditDirectory: input.executionAuditDirectory ?? (execution ? directory : null),
    selectedSkill: input.skill ?? null, imageProvided: Boolean(input.image),
    text: qualityEnabled ? `${quality?.phase==='complete'?'任务验收通过。':'任务尚未完成，质量验证待通过。'}\n`+
      (quality?.plan?quality.checks.map(check=>`${check.status==='pass'?'✓':'×'} ${quality?.plan?.requirements.find(r=>r.id===check.id)?.description??check.id}：${check.evidence}`).join('\n'):'验收计划未建立，未允许绘图。')+
      `\n阶段：${quality?.phase??'pending_verification'}；修正轮次：${quality?.round??0}/3。详细证据：${join(directory,'quality.json')}` : result?.text ?? '', ...failure, cleanupError, runDirectory: directory };
  const redact = (text: string) => cleanEnvironment(redactSecrets(text, config.profiles));
  BusinessOutcome.parse(report);
  await Promise.all([
    writeFile(join(directory, 'verification.json'), redact(JSON.stringify(report, null, 2) + '\n')),
    writeFile(join(directory, 'events.jsonl'), redact(events.map(event => JSON.stringify({ runId, ...event })).join('\n') + '\n')),
  ]);
  return JSON.parse(redact(JSON.stringify(report))) as typeof report;
}
