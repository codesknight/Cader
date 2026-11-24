import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { loadConfig, loadMcp, loadSkills, redactSecrets, ConfigError, workspacePath } from '@cader/config';
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
import { requiresQuality, runQualityTask, qualityTaskContext } from './quality.js';
import { taskIntent } from './task-intent.js';
import type { QualityResume } from './quality.js';
import type { Approval } from './execution.js';
import { importReferenceImage, referenceOutput, wantsRedraw } from './reference-input.js';
import type { ReferenceTask } from './reference-input.js';

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
  referenceTask?:ReferenceTask;
  taskState?: () => unknown; alwaysVisual?: boolean;
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
  let currentTaskState: unknown;
  const routedIntent=taskIntent(input.originalTask??input.task);
  const shouldCheck=()=>Boolean(input.referenceTask||input.qualityResume||requiresQuality(input.originalTask??input.task)||
    (input.alwaysVisual&&/^(?:请)?(?:移动|平移|旋转|修改|move|rotate)/i.test(input.originalTask??input.task)));
  const intentAllowsTool=(name:string)=>!['status','preference'].includes(routedIntent)||
    /^(?:cader_(?:read_file|list_files|glob|cad_health|load_skill|open_image|view_image)|mcp__.+__(?:get_\w+|query_entities|list_\w+))$/.test(name);
  let qualityEnabled = Boolean(input.executionOwner && !input.disableTools && (input.referenceTask||requiresQuality(input.originalTask ?? input.task)));
  let cleanupError: string | undefined;
  let stage: 'configuration' | 'runtime' | 'mcp' = 'configuration';
  const stages = taskStages();
  const readonly=input.permissionMode===undefined||input.permissionMode==='read-only';
  let drawingBlocked = input.intent === 'redraw'&&(readonly||!input.image);
  try {
    if(input.qualityResume?.reference_task){
      const bound=input.qualityResume.reference_task;
      if(input.referenceTask&&(input.referenceTask.image.sha256!==bound.image.sha256||resolve(input.referenceTask.outputPath)!==resolve(bound.outputPath)))throw new Error('REFERENCE_TASK_MISMATCH');
      input.referenceTask=bound;input.image=bound.image.path;
    }
    if(input.referenceTask&&!input.image)input.image=input.referenceTask.image.path;
    drawingBlocked=input.intent==='redraw'&&(readonly||!input.image);
    if (input.skill) await (await loadSkills(root)).read(input.skill, 'main');
    if (input.image) {
      if (!config.profiles.find(profile => profile.id === config.runtime.main_profile)?.input.includes('image'))
        throw new ConfigError('The main model does not accept image input');
      const originalImage=input.image;
      const image=await importReferenceImage(workspace,input.referenceTask?.image.path??input.image);
      if(input.referenceTask&&image.sha256!==input.referenceTask.image.sha256)throw new Error('REFERENCE_CHANGED_RESELECT_REQUIRED');
      input.image=image.path;
      if(!input.referenceTask&&(input.intent==='redraw'||wantsRedraw(input.originalTask??input.task)))
        input.referenceTask={request:input.originalTask??input.task,image:{path:image.path,sha256:image.sha256,width:image.width,height:image.height},
          outputPath:referenceOutput(workspace,input.originalTask??input.task,originalImage),freshDrawing:true};
      if (input.imageView) await prepareImageView(workspace, input.image, input.imageView);
    }
    qualityEnabled=Boolean(input.executionOwner&&!input.disableTools&&shouldCheck());
    if (!drawingBlocked) {
      let mcp = input.mcpPath ? await loadMcp(resolve(root, input.mcpPath)) : undefined;
      if (input.permissionMode && !input.executionTools) {
        const redactEnvironment = environmentRedactor().clean;
        execution = new ExecutionSession(workspace, directory, text => redactEnvironment(redactSecrets(text, config.profiles)));
        execution.mode = input.permissionMode;
        await execution.loadPersistedBarrier();
        if (mcp) { stage = 'mcp'; input.signal?.throwIfAborted(); await execution.connect(resolve(root, input.mcpPath!)); }
        input.executionTools = [...execution.definitions(), ...execution.controlTools(), ...execution.fileTools()];
        input.executionState = () => execution!.facts(); input.toolAvailable = name => execution!.toolAvailable(name);
        input.captureCadView = signal => execution!.captureView(signal); mcp = undefined;
        input.executionOwner = execution;
        qualityEnabled = !input.disableTools && shouldCheck();
      }
      stage = mcp ? 'mcp' : 'runtime';
      input.signal?.throwIfAborted();
      if(input.referenceTask&&input.executionOwner?.facts().transport!=='connected')throw new Error('REFERENCE_MCP_REQUIRED');
      const executeQuality=(activeRuntime?:Awaited<ReturnType<typeof createLiveRuntime>>)=>runQualityTask({runtime:activeRuntime,root,profile:config.runtime.main_profile,task:input.originalTask??input.task,
        owner:input.executionOwner!,signal:input.signal,confirm:input.confirmTask,resume:input.qualityResume,referenceTask:input.referenceTask,alwaysVisual:input.alwaysVisual,
        onState:state=>{currentTaskState=state;},
        emit:event=>{if(event.type==='task.phase')qualityPhase=String(event.phase);events.push(event);input.onEvent?.(event);},
        persist:state=>writeFile(join(directory,'quality.json'),cleanEnvironment(redactSecrets(JSON.stringify(state,null,2),config.profiles))),
        request:{skill:input.skill,image:input.image,history:input.history,summary:input.summary,domain:input.domain}});
      if(qualityEnabled&&input.executionOwner?.facts().frozen){
        quality=await executeQuality();
      }else{
      runtime = await factory({ root, workspaceRoot: workspace, runDirectory: directory, ...config, mcp, disableTools: input.disableTools,
        executionTools: input.executionTools, permissionMode: input.permissionMode,
        taskState:()=>currentTaskState??input.taskState?.()??{intent:routedIntent,phase:'conversation',visual_call_count:0},
        executionState: input.executionState, toolAvailable: name => intentAllowsTool(name) && (input.toolAvailable?.(name) ?? true) && (!qualityEnabled ||
          (!['cader_shell','cader_delegate'].includes(name) && !(qualityPhase==='correcting' && name.endsWith('__new_drawing'))&&(!input.referenceTask||!name.endsWith('__save_drawing')))), captureCadView: input.captureCadView,
        images: input.image ? { 'image-1': input.image } : {}, onEvent: event => {
          // Streaming deltas are displayed live; persist only the final public answer, not duplicate deltas.
          if (event.type !== 'assistant.delta') events.push(event);
          if (!(qualityEnabled && event.type === 'assistant.delta')) input.onEvent?.(JSON.parse(cleanEnvironment(redactSecrets(JSON.stringify(event), config.profiles))));
        } });
      stage = 'runtime';
      if(qualityEnabled && input.executionOwner) {
        quality = await executeQuality(runtime);
        result=runtime.completed().filter(agent=>agent.profile===config.runtime.main_profile).at(-1);
      } else result = await runtime.run(config.runtime.main_profile, input.task, { skill: input.skill, image: input.image, imageView: input.imageView,
          signal: input.signal, history: input.history, summary: input.summary, domain: input.domain });
      failure = agentFailure(runtime.completed(), events, result?.id);
      if((!failure||failure.errorCode==='AGENT_FAILED')&&quality?.failure)failure=describeFailure(quality.failure.code,quality.failure.source==='model'?'agent':'verification');
      }
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
  const runSucceeded = !failure && (drawingBlocked || result?.status === 'succeeded'||Boolean(quality&&runtime?.completed().some(agent=>agent.status==='succeeded'))||Boolean(quality?.phase==='blocked'&&!runtime));
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
    stages.planning=quality.plan?'succeeded':!runtime?'not_performed':'failed';
    stages.execution=writeBlocked||quality.phase==='blocked'?'blocked':quality.phase==='complete'?'succeeded':'unverified';
    if(quality.reference_task)stages.saving=quality.artifact?'succeeded':quality.failure?.stage==='saving'?'failed':'not_performed';
  }
  const report = { contract_version: 'cader-task/1', ok: runSucceeded && !drawingBlocked && !writeBlocked && !qualityPending, run_status: cancelled ? 'cancelled' : runSucceeded ? 'succeeded' : 'failed',
    task_status: cancelled || writeBlocked || qualityPending ? 'blocked' : !runSucceeded ? 'failed' : drawingBlocked ? 'blocked' : quality?.phase==='complete'?'succeeded':'unverified',
    blocked_reasons: cancelled ? ['CANCELLED'] : writeBlocked ? ['CAD_WRITE_FROZEN'] : failure?[failure.errorCode]:qualityPending?['QUALITY_NOT_ACCEPTED']:drawingBlocked && runSucceeded ? ['WRITE_CAPABILITY_UNAVAILABLE'] : [],
    quality:quality??null,
    task_context:quality?qualityTaskContext(quality):input.taskState?.()??null,
    model_run_status:result?.status??(runtime?'no_result':'not_started'),
    execution_evidence: executionEvidence ?? null,
    authorization: { user_task_authorized: true, write_authorized: Boolean(input.permissionMode && input.permissionMode !== 'read-only' && events.some(event => event.type === 'tool.result' && event.isError === false && /(?:__(?:new_drawing|draw_\w+|create_layer|set_layer_properties|move_entity|rotate_entity|copy_entity|scale_entity|mirror_entity|delete_entity|save_drawing)|cader_(?:write_file|edit_file|shell))$/.test(String(event.tool)))),
      runtime_write_available: Boolean(input.executionTools?.length && input.permissionMode !== 'read-only') },
    performed_actions: events.filter(event => event.type === 'tool.result' && event.isError === false)
      .map(event => ({ operation: String(event.tool), status: 'succeeded' })),
    artifact: null, local_artifact:quality?.artifact??null,verification: quality?.phase==='complete'?'passed':quality?.checks.some(c=>c.status==='fail')?'failed':'not_performed', stages,
    runId, kind: 'user-task', mode: input.permissionMode ?? 'read-only',
    executionAuditDirectory: input.executionAuditDirectory ?? (execution ? directory : null),
    selectedSkill: input.skill ?? null, imageProvided: Boolean(input.image),
    text: qualityEnabled&&writeBlocked?`${!runtime?'任务未开始：工作区写屏障已存在，未调用模型规划。':'绘图执行中断：尚未通过验收。'}\n${input.executionOwner?.diagnosticSummary()??''}\n${!runtime?'/mcp barrier 可查看旧缺参屏障复核资格。':'请保留原图和执行证据；不得重放未知写入。'}` : qualityEnabled&&quality?.failure?`任务在${quality.failure.stage==='planning'?'规划':quality.failure.stage}阶段失败，${quality.failure.stage==='planning'?'尚未允许绘图。':'未通过验收。'}\n原因：${failure?.errorCode??quality.failure.code}。详细证据：${join(directory,'quality.json')}` : qualityEnabled ? `${quality?.phase==='complete'?'任务验收通过。':'任务尚未完成，质量验证待通过。'}\n`+
      (quality?.plan?quality.checks.map(check=>`${check.status==='pass'?'✓':'×'} ${quality?.plan?.requirements.find(r=>r.id===check.id)?.description??check.id}：${check.evidence}`).join('\n'):'验收计划未建立，未允许绘图。')+
      `\n阶段：${quality?.phase??'pending_verification'}；截图尝试：${quality?.visual_attempt_count??0}；视觉模型请求：${quality?.visual_model_call_count??0}；修正轮次：${quality?.round??0}/3。详细证据：${join(directory,'quality.json')}`+
      (quality?.artifact?`\nDWG已生成并校验：${quality.artifact.path}${quality.phase==='complete'?'':'（待验稿，未通过全部质量条件）'}`:'') : result?.text ?? '', ...failure, cleanupError, runDirectory: directory };
  if(quality?.failure&&quality.artifact)report.text+=`\nDWG已生成并校验：${quality.artifact.path}（待验稿，模型中断，未通过全部质量条件）`;
  const redact = (text: string) => cleanEnvironment(redactSecrets(text, config.profiles));
  BusinessOutcome.parse(report);
  await Promise.all([
    writeFile(join(directory, 'verification.json'), redact(JSON.stringify(report, null, 2) + '\n')),
    writeFile(join(directory, 'events.jsonl'), redact(events.map(event => JSON.stringify({ runId, ...event })).join('\n') + '\n')),
  ]);
  return JSON.parse(redact(JSON.stringify(report))) as typeof report;
}
