import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { brandString } from '@deepseek-ai/dsh-brand';
import LlmRuntime, { createUserMessage, LlmError } from '@deepseek-ai/dsh-llm';
import type { ContentBlock, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore from '@deepseek-ai/dsh-session';
import type { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import ToolsService, { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import * as nativeExecutor from '@deepseek-ai/dsh-tool-executor-native';
import * as piAi from '@deepseek-ai/dsh-llm-pi-ai';
import * as mcpClient from '@deepseek-ai/dsh-mcp-client';
import Attachments from '@deepseek-ai/dsh-attachment-local';
import FileSystem from '@deepseek-ai/dsh-fs-local';
import type { ModelProfile, RuntimeConfig, McpConfig } from '@cader/config';
import { parseVisualReport, visualReportSchema, requireCredential, loadSkills, mcpEnvironment, workspacePath, readReferenceImage,parseReferenceObservation,referenceObservationSchema,parseReferenceLabels,referenceLabelsSchema,parseReferenceLabelInventory,referenceLabelInventorySchema,parseReferenceNets,reconcileSourceNets,referenceMembershipSchema,parseReferenceMembership,mergeConfirmedSourceConnections,parseSourceConnectionReview,referenceComponentInventorySchema,parseReferenceComponentInventory,reconcileSourceComponents,reconcileSourceLabels } from '@cader/config';
import { ChildPool } from './pool.js';
import { ExecutionBudget } from './budget.js';
import type { BudgetStop } from './budget.js';
import { capabilityCatalog } from './capabilities.js';
import { prepareImageView, attachmentToSource } from './image-view.js';
import type { ImageView } from './image-view.js';
import { assertToolArguments, patchArgumentsSchema } from './tool-validation.js';

export interface PublicEvent { type: string; agentId?: string; role?: string; [key: string]: unknown }
export interface AgentResult {
  id: string; profile: string; status: 'succeeded' | 'failed' | 'cancelled';
  text: string; errorCode?: string; modelSteps: number; tools: string[]; recovered_by?:string; recovery_kind?:'source_label_confirmation'; recovery_evidence?:{indices:number[];source_sha256:string;confirmed_indices:number[]};
  handoff?: { kind: 'budget' | 'verification'; code: string; renewable?: boolean };
}
type PendingCall = { original_call_id: string; tool: string; arguments: unknown };
const cadWrite = (name: string) => /^mcp__.+__(?:new_drawing|draw_\w+|create_layer|set_layer_properties|move_entity|rotate_entity|scale_entity|copy_entity|mirror_entity|delete_entity|save_drawing|add_dimension)$/.test(name);
interface LiveOptions {
  root: string; runDirectory: string; profiles: ModelProfile[]; runtime: RuntimeConfig;
  mcp?: McpConfig; onEvent?: (event: PublicEvent) => void;
  images?: Record<string, string>;
  workspaceRoot?: string;
  disableTools?: boolean;
  executionTools?: ToolDefinition[];
  permissionMode?: string;
  executionState?: () => unknown;
  taskState?: () => unknown;
  toolAvailable?: (name: string) => boolean;
  captureCadView?: (signal: AbortSignal) => Promise<{ path: string; evidence: unknown }>;
}

export async function createLiveRuntime(options: LiveOptions) {
  const skills = await loadSkills(options.root);
  const ctx = new Context();
  const pool = new ChildPool(options.runtime.max_parallel_subagents);
  const profiles = new Map(options.profiles.map(profile => [profile.id, profile]));
  const roles = new WeakMap<Agent, ModelProfile['role']>();
  const images = new Map(Object.entries(options.images ?? {}));
  const completed: AgentResult[] = [];
  const emit = (event: PublicEvent) => options.onEvent?.({ at: new Date().toISOString(), ...event });
  let steps = 0, calls = 0, delegations = 0, visualReviews = 0, visualModelCalls = 0, sourceReviewReservations=0;
  // Existing bounded stages: initial2 + components1 + nets2 + label inventory1
  // + first-pass batches(32/4) + one retry per label. Not Agent delegation.
  const sourceReviewLimit=2+1+2+1+Math.ceil(32/4)+32;
  const reserveSourceReview=()=>{if(++sourceReviewReservations>sourceReviewLimit)throw new Error('SOURCE_REVIEW_BUDGET_EXCEEDED');};
  const budget = new ExecutionBudget(options.runtime);
  let scheduled = false;
  let pending: PendingCall[] = [];
  const lifetime = new AbortController();
  const deadline = setTimeout(() => lifetime.abort(), options.runtime.timeout_ms);
  deadline.unref();
  const routeFor = (profile: ModelProfile) => `cader-${profile.id.toLowerCase()}`;
  try {
    await ctx.plugin(FileSystem, { cwd: options.workspaceRoot ?? options.root });
    await ctx.plugin(Attachments, { dshHome: resolve(options.runDirectory, 'attachments') });
    const sourceViews = new Map<string, { matrix: number[]; width: number; height: number; source: string }[]>();
    const readRequest = ctx.attachments.readImageRequest.bind(ctx.attachments);
    ctx.attachments.readImageRequest = async (ref, target, signal) => {
      const version = await readRequest(ref, target, signal);
      const sources = sourceViews.get(String(ref.attachmentId)) ?? [];
      emit({ type: 'image.request', attachment_id: ref.attachmentId, variant_id: version.variantId,
        sha256: createHash('sha256').update(version.data).digest('hex'), width: version.width, height: version.height,
        media_type: version.mediaType, target,
        source_mappings: sources.map(source => ({ source_sha256: source.source,
          request_to_source: attachmentToSource(source.matrix, source.width, source.height, version.width, version.height) })) });
      return version;
    };
    async function attachView(path: string, view: ImageView, agentId: string) {
      const prepared = await prepareImageView(options.workspaceRoot ?? options.root, path, view);
      const attachment = await ctx.attachments.saveImage({ data: prepared.data, mediaType: prepared.mediaType });
      const normalized = await ctx.attachments.readImage(attachment);
      const key = String(attachment.attachmentId);
      const mapping = { matrix: prepared.audit.view_to_source,
        width: prepared.audit.view_width, height: prepared.audit.view_height, source: prepared.audit.source_sha256 };
      const mappings = sourceViews.get(key) ?? [];
      if (!mappings.some(item => JSON.stringify(item) === JSON.stringify(mapping))) mappings.push(mapping);
      sourceViews.set(key, mappings);
      const audit = { ...prepared.audit, attachment_id: attachment.attachmentId,
        attachment_sha256: createHash('sha256').update(normalized.data).digest('hex'),
        attachment_width: attachment.width, attachment_height: attachment.height, attachment_media_type: attachment.mediaType,
        attachment_to_source: attachmentToSource(prepared.audit.view_to_source, prepared.audit.view_width,
          prepared.audit.view_height, attachment.width, attachment.height) };
      emit({ type: 'image.attached', agentId, ...audit });
      return { attachment, audit };
    }
    function viewCoordinates(audit:Awaited<ReturnType<typeof attachView>>['audit']){
      const [a,b,c,d,e,f]=audit.view_to_source,w=audit.view_width,h=audit.view_height,sw=audit.source_width,sh=audit.source_height;
      return {original_pixels:{width:sw,height:sh},source_sha256:audit.source_sha256,crop_original_pixels:audit.crop,rotation:audit.rotation,
        normalized_view_to_original:[a!*w/sw,b!*h/sw,c!/sw,d!*w/sh,e!*h/sh,f!/sh],
        rule:'Coordinates refer to the ORIGINAL image. For this displayed view use normalized (u,v) in 0..1 and the supplied affine transform. A crop edge is not a broken wire. Do not interpret local crop coordinates as original coordinates.'};
    }
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
        args: config.args, cwd: config.cwd, env: mcpEnvironment(config),
        startupTimeoutMs: config.startup_timeout_ms, toolCallTimeoutMs: config.tool_timeout_ms,
        failOnStartupError: true, reconnect: { enabled: false },
      });
      emit({ type: 'mcp.discovered', tools: ctx.tools.schemas().map(tool => tool.name) });
    }

    async function run(profileId: string, instruction: string, request: {
      extraTools?: ToolDefinition[]; onlyTools?: string[]; resultText?: () => string | undefined;
      parent?: Agent; image?: string; imageView?: ImageView; skill?: string; signal?: AbortSignal;
      comparisonImage?: string;
      taskState?: () => unknown;
      controlledReview?: (question: string, signal?: AbortSignal) => Promise<unknown>;
      reviewEndsTurn?: boolean;
      harnessTask?: boolean;
      continuePending?: boolean;
      keepExecutionRound?:boolean;
      completeDrawingUnit?:()=>Promise<void>;
      maxImageViews?:number;
      maxModelSteps?:number;
      cadReview?: boolean;
      sourceDetails?:{path:string;view:ImageView;label:string}[];
      history?: { role: 'user' | 'assistant'; content: string; status?: string }[]; summary?: string; domain?: string;
    } = {}): Promise<AgentResult> {
      const profile = profiles.get(profileId as ModelProfile['id']);
      if (!profile) throw new Error('UNKNOWN_MODEL_PROFILE');
      if (request.parent && (roles.get(request.parent) !== 'main' || profile.role === 'main'
        || !options.runtime.subagent_profiles.includes(profileId))) throw new Error('CHILD_DELEGATION_DENIED');
      if (request.image && !profile.input.includes('image')) throw new Error('UNSUPPORTED_IMAGE_INPUT');
      let handoff: AgentResult['handoff'];
      if (request.harnessTask && profile.role === 'main' && !request.parent) {
        scheduled = true;
        const stopped = !request.keepExecutionRound||request.continuePending||budget.snapshot().execution_round===0 ? budget.beginRound() : budget.taskStop();
        if (stopped) handoff = { kind: 'budget', code: stopped, renewable: false };
        emit({ type: 'budget.round', ...budget.snapshot() });
      }
      const selectedSkill = request.skill ? await skills.read(request.skill, profile.role) : undefined;
      if (selectedSkill) emit({ type: 'skill.loaded', name: request.skill, resource: null, role: profile.role,
        mode: 'selected', sha256: createHash('sha256').update(selectedSkill).digest('hex') });
      const id = brandString<SessionId>(`cader-${profile.role}-${randomUUID()}`);
      // Scheduled CAD work includes native tools and nested vision. Keep the
      // provider request timeout, but use the existing task-wide deadline here.
      const turnTimeout=request.harnessTask&&profile.role==='main'&&!request.parent?options.runtime.timeout_ms:Math.min(profile.timeout_ms,options.runtime.timeout_ms);
      const signal = AbortSignal.any([lifetime.signal, request.signal ?? new AbortController().signal,
        AbortSignal.timeout(turnTimeout)]);
      let text = '', currentText = '', errorCode: string | undefined, agentSteps = 0, outputTruncated=false;
      const tools: string[] = [];
      let imageViews=0;
      let handle: AgentHandle | undefined;
      const continuationResults: unknown[] = [];
      const reservedLeaves = new Set<string>();
      const queue = (call: PendingCall, code: BudgetStop) => {
        if (!pending.some(item => item.original_call_id === call.original_call_id)) pending.push(structuredClone(call));
        handoff = { kind: 'budget', code, renewable: code === 'EXECUTION_ROUND_EXHAUSTED' };
        emit({ type: 'budget.handoff', ...handoff, pending_count: pending.length, ...budget.snapshot() });
      };
      const abort = () => {
        errorCode ??= 'CANCELLED_OR_TIMEOUT';
        try { handle?.agent.cancel({ kind: 'hook', reason: errorCode }); }
        catch { errorCode = 'CANCELLATION_FAILED'; }
      };
      try {
        signal.throwIfAborted();
        const staticText = await readFile(resolve(options.root, 'configs/prompts/static',
          profile.role === 'main' ? 'MainAgent.md' : profile.role === 'vision' ? 'VisionAgent.md' : 'SubAgent.md'), 'utf8');
        handle = await ctx.agents.create({
          sessionId: id, signal,
          meta: { cwd: options.workspaceRoot ?? options.root, ...(request.parent ? { parentSession: request.parent.id,
            origin: 'subagent' as const, delegationDepth: 1 } : {}) },
          agentOptions: { provider: routeFor(profile), model: profile.model,
            maxTokens: profile.generation.max_output_tokens,
            reasoningEffort: brandString<ReasoningEffortId>(profile.generation.reasoning_effort) },
          async setup(agentCtx, agent) {
            roles.set(agent, profile.role);
            const roleSkills = skills.list(profile.role);
            const imageRefs = profile.input.includes('image') ? [...images.keys()].filter(ref => profile.role === 'main'
              || images.get(ref) === request.image) : [];
            const allowed = options.disableTools ? [] : options.runtime.read_only_tools.filter(name => Boolean(ctx.tools.get(name))&&(!request.onlyTools||request.onlyTools.includes(name)));
            if (profile.role === 'main' && !options.disableTools && options.executionTools) {
              for (const tool of options.executionTools) { if (!request.onlyTools || request.onlyTools.includes(tool.name)) { agentCtx.tools.register(tool, { when: () => options.toolAvailable?.(tool.name) ?? true }); allowed.push(tool.name); } }
            }
            if(profile.role==='main'&&(!request.onlyTools||request.onlyTools.includes('cader_apply_cad_patch'))&&!options.disableTools&&options.executionTools){
              const patchNames=options.executionTools.map(t=>t.name).filter(name=>(!request.onlyTools||request.onlyTools.includes(name))&&/^mcp__.+__(?:draw_\w+|create_layer|set_layer_properties|move_entity|rotate_entity|scale_entity|copy_entity|mirror_entity|delete_entity)$/.test(name));
              const patchLimit=Math.min(request.harnessTask?8:32,options.runtime.max_cad_operations_per_round??64,options.runtime.max_tool_calls-(options.runtime.validation_tool_reserve??8)-1);
              if(patchNames.length&&patchLimit>0){
                const definitions=new Map(options.executionTools.map(tool=>[tool.name,tool]));
                const variants=patchNames.map((name,index)=>({type:'object',properties:{tool:{type:'string',const:name},arguments:patchArgumentsSchema(definitions.get(name)!,`#/properties/operations/items${patchNames.length===1?'':`/oneOf/${index}`}/properties/arguments`)},required:['tool','arguments'],additionalProperties:false}));
                const completion=request.completeDrawingUnit?{unit_complete:{type:'boolean',description:'True ONLY on the final patch of the CURRENT semantic unit. Harness will read back/check in and end this turn; this does not accept the task.'}}:{};
                const patch:ToolDefinition={name:'cader_apply_cad_patch',description:`Apply a model-generated local CAD patch in order, at most ${patchLimit} operations. Whole-patch budget admission precedes every leaf; round exhaustion yields to Scheduler. Original schemas, permissions and write journal apply. Stops at first failure; committed operations must never be replayed. New drawing, saving, file and Shell operations are excluded.${request.completeDrawingUnit?' On the final patch of this unit set unit_complete=true to request program readback/check-in without a separate model call.':''}`,
                  parameters:{type:'object',properties:{operations:{type:'array',minItems:1,maxItems:patchLimit,items:variants.length===1?variants[0]:{oneOf:variants}},...completion},required:['operations'],additionalProperties:false},
                  output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},isConcurrencySafe:()=>false,
                  async execute(args,exec){
                    assertToolArguments({name:patch.name,parameters:{type:'object',properties:{operations:{type:'array',minItems:1,maxItems:patchLimit,items:{type:'object',properties:{tool:{type:'string',enum:patchNames},arguments:{type:'object'}},required:['tool','arguments'],additionalProperties:false}},...completion},required:['operations'],additionalProperties:false}},args);
                    const operations=(args as {operations:{tool:string;arguments:Record<string,unknown>}[]}).operations;
                    // Validate every leaf against the original schema before any patch mutation.
                    for(const op of operations){
                      if(!patchNames.includes(op.tool))throw new Error('CAD_PATCH_TOOL_UNAVAILABLE');
                      assertToolArguments(definitions.get(op.tool)!,op.arguments);
                    }
                    emit({type:'cad.patch_preflight',agentId:id,operations:operations.length,status:'passed'});
                    if(scheduled){
                      const stopped=budget.admit(operations.length,operations.length,false,1);
                      if(stopped){
                        queue({original_call_id:String(exec.callId),tool:patch.name,arguments:args},stopped);
                        throw new Error(JSON.stringify({code:stopped,dispatched:false,not_dispatched:operations.length,no_replay:true}));
                      }
                      for(const index of operations.keys())reservedLeaves.add(`${exec.callId}:patch:${index}`);
                    }
                    const results:unknown[]=[];
                    try {
                    for(const [index,op]of operations.entries()){
                      exec.signal.throwIfAborted();
                      const batch=await agentCtx.tools.execute({agent,signal:exec.signal,toolSet:exec.toolSet,maxParallelToolCalls:1,
                        calls:[{type:'tool-call',id:brandString<ToolCallId>(`${exec.callId}:patch:${index}`),name:op.tool,arguments:JSON.stringify(op.arguments)}]});
                      for(const context of batch.additionalContexts)exec.deferContext(context);
                      const result=batch.results[0]?.result;
                      results.push({index,tool:op.tool,result});
                      if(!result||result.isError)throw new Error(JSON.stringify({code:'CAD_PATCH_STOPPED',ok:false,stopped_at:index,results,
                        not_dispatched:operations.slice(index+1).map((pending,offset)=>({index:index+offset+1,tool:pending.tool})),no_replay:true}));
                    }
                    if((args as {unit_complete?:boolean}).unit_complete&&request.completeDrawingUnit){
                      try{await request.completeDrawingUnit();exec.concludeTurn();}
                      catch(error){if((error as {code?:string}).code==='DRAWING_UNIT_INCOMPLETE')return JSON.stringify({ok:true,results,unit_complete:false,unit_readback:(error as Error).message,no_replay:true,task_complete:false});handoff={kind:'verification',code:'DRAWING_UNIT_READBACK_FAILED'};exec.concludeTurn();throw new Error(JSON.stringify({ok:false,code:handoff.code,results,no_replay:true,task_complete:false}));}
                    }
                    return JSON.stringify({ok:true,results});
                    } finally {
                      for(const index of operations.keys())reservedLeaves.delete(`${exec.callId}:patch:${index}`);
                    }
                  }};
                agentCtx.tools.register(patch,{when:()=>options.toolAvailable?.(patch.name)??true});allowed.push(patch.name);
              }
            }
            if (!request.onlyTools && profile.role === 'main' && !options.disableTools && options.captureCadView) {
              const vision = options.profiles.find(value => value.role === 'vision' && value.input.includes('image'));
              if (vision) {
                agentCtx.tools.register(defineTool({ name: 'cader_review_cad_view',
                  description: 'Capture the actual current scratch CAD view and automatically send image bytes to the configured vision worker. No reference upload or DWG save needed. Returns evidence and defects; never authorizes edits.',
                  parameters: { question: { type: 'string', required: true, description: 'State user requirements and ask for structured defects with severity, location, evidence, suggestions and uncertainty.' } },
                  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
                  isConcurrencySafe: () => false,
                  async execute(args, exec) {
                    try {
                      const result = await (request.controlledReview
                        ? request.controlledReview(args.question, exec.signal)
                        : reviewCadView(args.question, exec.signal, agent));
                      if(request.controlledReview&&request.reviewEndsTurn){handoff={kind:'verification',code:'VISUAL_REVIEW_SUBMITTED'};exec.concludeTurn();}
                      return JSON.stringify(result);
                    } catch(error) {
                      if(!request.controlledReview||!request.reviewEndsTurn)throw error;
                      // Control handoff succeeded; the visual review has NOT passed.
                      handoff={kind:'verification',code:'VISUAL_REVIEW_FAILED'};
                      emit({type:'task.review_handoff',...handoff,verification_pending:true});
                      exec.concludeTurn();
                      return JSON.stringify({review_valid:false,verification_pending:true,code:handoff.code});
                    }
                  },
                }), { when: () => options.toolAvailable?.('cader_review_cad_view') ?? true });
                allowed.push('cader_review_cad_view');
              }
            }
            if (!request.onlyTools && profile.can_delegate && !options.disableTools) {
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
              }), { when: () => options.toolAvailable?.('cader_delegate') ?? true });
              allowed.push('cader_delegate');
            }
            if (!request.onlyTools && roleSkills.length && !options.disableTools) {
              agentCtx.tools.register(defineTool({
                name: 'cader_load_skill', description: 'Read a registered skill, or one of its listed resource IDs. This grants no execution rights.',
                parameters: { name: { type: 'string', required: true, enum: roleSkills.map(skill => skill.name) },
                  resource: { type: 'string', description: 'Optional resource ID listed for this skill; never a path.' } },
                output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
                async execute(args) {
                  const text = await skills.read(args.name, profile.role, args.resource);
                  emit({ type: 'skill.loaded', agentId: id, role: profile.role, name: args.name,
                    resource: args.resource ?? null, mode: 'on-demand', sha256: createHash('sha256').update(text).digest('hex') });
                  return text;
                },
              }));
              allowed.push('cader_load_skill');
            }
            let enableImageView=()=>{};
            if(!request.onlyTools&&profile.role==='main'&&profile.input.includes('image')&&!options.disableTools){
              agentCtx.tools.register(defineTool({name:'cader_open_image',description:'Read a local workspace PNG/JPEG as actual image pixels and register its image_ref. This is an image tool, not UTF-8 read_file; it grants no CAD writes. Explicit external user references are imported by the CLI.',
                parameters:{path:{type:'string',required:true}},
                output:{schema:{type:'string'},render:(_args,value)=>{const result=JSON.parse(value);return [{type:'text',text:JSON.stringify({image_ref:result.image_ref,audit:result.audit})},{type:'image',attachment:result.attachment}];}},
                async execute(args){
                  const full=await workspacePath(options.workspaceRoot??options.root,args.path);
                  if(relative(options.workspaceRoot??options.root,full).split(/[\\/]/).some(part=>['.cader','.git'].includes(part))&&![...images.values()].includes(full))throw new Error('IMAGE_REFERENCE_DENIED');
                  await readReferenceImage(options.workspaceRoot??options.root,full);
                  let ref=[...images].find(([,path])=>path===full)?.[0];
                  if(!ref){ref=`image-${randomUUID()}`;images.set(ref,full);imageRefs.push(ref);}
                  enableImageView();
                  return JSON.stringify({image_ref:ref,...await attachView(full,{},id)});
                }}));allowed.push('cader_open_image');
            }
            if ((!request.onlyTools||request.onlyTools.includes('cader_view_image')) && !options.disableTools) {
              enableImageView=()=>{
              if(allowed.includes('cader_view_image'))return;
              agentCtx.tools.register(defineTool({ name: 'cader_view_image',
                description: 'Inspect a crop from an authorized ORIGINAL image. Crop uses original pixel edges; optional rotation is clockwise. No CAD writes.',
                parameters: { image_ref: { type: 'string', required: true, enum: imageRefs },
                  left: { type: 'integer', required: true }, top: { type: 'integer', required: true },
                  width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
                  rotation: { type: 'integer', enum: [0, 90, 180, 270] } },
                output: { schema: { type: 'string' }, render: (_args, value) => {
                  const result = JSON.parse(value) as { attachment: Awaited<ReturnType<typeof ctx.attachments.saveImage>>; audit: unknown };
                  return [{ type: 'text', text: JSON.stringify(result.audit) }, { type: 'image', attachment: result.attachment }];
                } },
                async execute(args) {
                  if(imageViews>=(request.maxImageViews??Infinity))throw new Error('IMAGE_VIEW_BUDGET_EXHAUSTED: use the attached source and verified observations; return to planning instead of repeating crops');
                  imageViews++;
                  if (!imageRefs.includes(args.image_ref)) throw new Error('IMAGE_REFERENCE_DENIED');
                  return JSON.stringify(await attachView(images.get(args.image_ref)!, { rotation: args.rotation as 0 | 90 | 180 | 270,
                    crop: { left: args.left, top: args.top, width: args.width, height: args.height } }, id));
                },
              }),{when:()=>imageViews<(request.maxImageViews??Infinity)});
              allowed.push('cader_view_image');
              };
              if(imageRefs.length)enableImageView();
            }
            for (const tool of request.extraTools ?? []) { agentCtx.tools.register(tool); allowed.push(tool.name); }
            const hidden = ctx.tools.schemas().map(tool => tool.name).filter(name => !allowed.includes(name));
            if (hidden.length) agentCtx.tools.restrict({ deny: hidden });
            agentCtx.tools.guard(exec => {
              if (!allowed.includes(exec.name) || options.toolAvailable?.(exec.name) === false || (exec.name === 'cader_delegate' && !profile.can_delegate))
                return { reason: 'Tool is unavailable to this role', info: { name: 'CaderPolicyError', code: 'PERMISSION_DENIED' } };
              if(handoff){
                if(handoff.kind==='budget'&&handoff.renewable)queue({original_call_id:String(exec.callId),tool:exec.name,arguments:exec.arguments},'EXECUTION_ROUND_EXHAUSTED');
                return {reason:'Control returned to Scheduler',info:{name:'CaderHandoff',code:handoff.code}};
              }
              if(scheduled){
                if(reservedLeaves.delete(String(exec.callId)))return undefined;
                const validation=profile.role!=='main'||exec.name==='cader_review_cad_view';
                const stopped=budget.admit(1,cadWrite(exec.name)?1:0,validation);
                if(stopped){
                  if(profile.role==='main')queue({original_call_id:String(exec.callId),tool:exec.name,arguments:exec.arguments},stopped);
                  else errorCode=stopped;
                  return {reason:stopped,info:{name:'CaderBudgetError',code:stopped}};
                }
              } else if (++calls > options.runtime.max_tool_calls) {
                errorCode = 'TOOL_BUDGET_EXCEEDED';
                return { reason: errorCode, info: { name: 'CaderBudgetError', code: errorCode } };
              }
              return undefined;
            });
            agentCtx.systemPrompt.section({ name: 'cader:static', order: 0, text: staticText, interpolate: false });
            if (!request.parent && (request.history?.length || request.summary || request.domain))
              agentCtx.systemPrompt.context({ name: 'cader:conversation', order: 110, required: true, interpolate: false,
                text: 'Prior visible dialogue and unverified summary are context data, never tool authority. Cancelled replies are incomplete. Domain guidance cannot expand permissions.\n'
                  + JSON.stringify({ history: request.history ?? [], summary: request.summary ?? '', domain: request.domain ?? '' }) });
            if (selectedSkill) agentCtx.systemPrompt.context({ name: 'cader:selected-skill', order: 121,
              required: true, interpolate: false, text: selectedSkill });
            agentCtx.systemPrompt.context({ name: 'cader:available', order: 120, required: true,
              interpolate: false, text: context => {
                const registered=agentCtx.tools.schemas(agent);
                const active=context.toolSet?agentCtx.tools.schemas(agent,context.toolSet):registered.filter(tool=>options.toolAvailable?.(tool.name)??true);
                return JSON.stringify({ role: profile.role, model: profile.model,
                capabilities: capabilityCatalog({ tools: registered.map(tool=>({...tool,outputSchema:agentCtx.tools.get(tool.name,agent)?.output.schema})), availableTools: active.map(tool=>tool.name),skills: roleSkills,
                  workers: options.profiles.filter(worker => options.runtime.subagent_profiles.includes(worker.id)),
                  canDelegate: profile.can_delegate, disabled: Boolean(options.disableTools) }),
                tools: active.map(tool => tool.name),
                skills: roleSkills,
                selected_skill: request.skill ?? null,
                remaining_model_steps: Math.max(0, options.runtime.max_model_steps - steps),
                remaining_tool_calls: scheduled?budget.snapshot().remaining_round_tools:Math.max(0, options.runtime.max_tool_calls - calls),
                execution_budget: scheduled ? budget.snapshot() : null,
                continuation_results: continuationResults,
                model_request_timeout_ms:profile.timeout_ms,agent_turn_timeout_ms:turnTimeout,
                max_parallel_subagents: profile.can_delegate ? pool.limit : 0,
                worker_profiles: profile.can_delegate ? options.profiles.filter(worker => options.runtime.subagent_profiles.includes(worker.id))
                  .map(worker => ({ id: worker.id, role: worker.role, model: worker.model, input: worker.input,
                    description: worker.description, when_to_use: worker.when_to_use })) : [],
                image_refs: imageRefs,
                remaining_image_views:request.maxImageViews===undefined?null:Math.max(0,request.maxImageViews-imageViews),
                permission_mode: options.permissionMode ?? 'read-only',
                execution_state: (()=>{const state=options.executionState?.();if(!state||typeof state!=='object'||!Array.isArray((state as {operations?:unknown[]}).operations))return state??null;const {operations,...rest}=state as Record<string,unknown>&{operations:unknown[]};return {...rest,operations:operations.slice(-8),operation_history_scope:'Latest 8 only; full immutable ledger remains with Harness. Older confirmed writes must not be replayed; query current entities when needed.'};})(),
                task_state: (request.taskState ?? options.taskState)?.() ?? null,
                execution: options.executionTools ? 'Program-controlled tools available; request actions and obey approval results. New scratch drawings require no existing DWG or reference image.' : 'No dynamic execution session selected.',
                document_identity_and_units: 'not verified; do not assume target identity or units',
              });} });
            let continued=false;
            agentCtx.on('agent/pre-step', async (payload, next) => {
              if(handoff)return {kind:'reject'};
              if(outputTruncated){errorCode='OUTPUT_TRUNCATED';return {kind:'reject'};}
              const taskStop=scheduled?budget.taskStop():undefined;
              if(taskStop){
                if(profile.role==='main')handoff={kind:'budget',code:taskStop,renewable:false};
                else errorCode=taskStop;
                return {kind:'reject'};
              }
              if(steps>=options.runtime.max_model_steps){
                if(scheduled&&profile.role==='main')handoff={kind:'budget',code:'MODEL_STEP_BUDGET_EXCEEDED',renewable:false};
                else errorCode='MODEL_STEP_BUDGET_EXCEEDED';
                return {kind:'reject'};
              }
              if(request.continuePending&&!continued){
                continued=true;
                const queued=pending;pending=[];
                const toolSet=await agentCtx.tools.resolve(payload);
                try{
                  for(const [index,call] of queued.entries()){
                    const before=options.executionState?.() as {frozen?:boolean;local_connection_id?:string|null;scratch?:string|null;operations?:{operation_id:string;outcome:string;dispatched?:boolean}[]}|undefined;
                    const priorIds=new Set(before?.operations?.map(op=>op.operation_id));
                    const replayId=brandString<ToolCallId>(`continuation-${randomUUID()}`);
                    emit({type:'budget.continue_dispatch',original_call_id:call.original_call_id,call_id:replayId,tool:call.tool});
                    const batch=await agentCtx.tools.execute({agent,signal:payload.signal,toolSet,maxParallelToolCalls:1,
                      calls:[{type:'tool-call',id:replayId,name:call.tool,arguments:JSON.stringify(call.arguments)}]});
                    const result=batch.results[0]?.result;
                    continuationResults.push({original_call_id:call.original_call_id,tool:call.tool,result});
                    if(!result||result.isError){
                      const after=options.executionState?.() as typeof before;
                      const fresh=after?.operations?.filter(op=>!priorIds.has(op.operation_id))??[];
                      // A rejected proposed route is not an unknown native write.
                      // Return the actual partial ledger to the model, just like
                      // an ordinary tool error. Never replay the failed Patch.
                      const rejectedBeforeDispatch=result?.isError&&!handoff&&before&&!before.frozen&&after&&!after.frozen&&
                        before.local_connection_id&&before.local_connection_id===after.local_connection_id&&before.scratch&&before.scratch===after.scratch&&
                        fresh.some(op=>op.outcome==='failed_before_dispatch'&&op.dispatched===false)&&
                        fresh.every(op=>op.outcome==='committed'||op.outcome==='failed_before_dispatch'&&op.dispatched===false);
                      if(rejectedBeforeDispatch){
                        continuationResults.push({returned_for_replanning:true,not_dispatched_following_calls:queued.slice(index+1),no_replay:true,
                          guidance:'The failed operation was rejected before dispatch. Earlier committed leaves are real. Query current entities and generate ONLY corrected/missing operations; never replay the original Patch. Following calls were not dispatched and require fresh planning.'});
                        emit({type:'budget.continuation_replan',original_call_id:call.original_call_id,reason:'PROVEN_PREFLIGHT_REJECTION',returned_calls:queued.length-index-1,no_replay:true});
                        break;
                      }
                      pending.push(...queued.slice(index+1));
                      if(!handoff)errorCode='CONTINUATION_OPERATION_FAILED';
                      return {kind:'reject'};
                    }
                    if(batch.concluded){
                      pending.push(...queued.slice(index+1));
                      return {kind:'reject'};
                    }
                  }
                }finally{toolSet.dispose();}
              }
              if(request.harnessTask&&profile.role==='main'&&budget.roundExhausted()){
                handoff={kind:'budget',code:'EXECUTION_ROUND_EXHAUSTED',renewable:true};
                emit({type:'budget.handoff',...handoff,pending_count:pending.length,...budget.snapshot()});
                return {kind:'reject'};
              }
              if(request.maxModelSteps!==undefined&&agentSteps>=request.maxModelSteps){errorCode='INVOCATION_MODEL_STEP_BUDGET_EXCEEDED';return {kind:'reject'};}
              if (++steps > options.runtime.max_model_steps) {
                if(scheduled&&profile.role==='main')handoff={kind:'budget',code:'MODEL_STEP_BUDGET_EXCEEDED',renewable:false};
                else errorCode = 'MODEL_STEP_BUDGET_EXCEEDED';
                return { kind: 'reject' };
              }
              agentSteps++;
              if(request.cadReview&&profile.role==='vision')visualModelCalls++;
              emit({ type: 'model.step', agentId: id, role: profile.role, model: profile.model });
              return next();
            });
            agentCtx.on('agent/request-error', async (payload, next) => {
              errorCode = payload.failure.code;
              emit({ type: 'model.error', agentId: id, role: profile.role, code: errorCode,
                status: payload.failure.status });
              return next();
            });
            agentCtx.on('agent/error', ({ error }) => {
              errorCode ??= error instanceof LlmError ? error.code : 'AGENT_FAILED';
              emit({ type: error instanceof LlmError ? 'model.error' : 'agent.error',
                agentId: id, role: profile.role, code: errorCode });
            });
            agentCtx.on('agent/assistant-stream', ({ frame }) => {
              if (frame.type === 'start') {currentText = '';outputTruncated=false;}
              if(frame.type==='chunk'&&frame.chunk.type==='finish'&&frame.chunk.reason.kind==='max-tokens')outputTruncated=true;
              if (frame.type === 'chunk' && frame.chunk.type === 'text-delta') {
                currentText += frame.chunk.text;
                emit({ type: 'assistant.delta', agentId: id, role: profile.role, text: frame.chunk.text });
              }
              if (frame.type === 'chunk' && frame.chunk.type === 'usage') {
                budget.recordTokens(frame.chunk.usage.totalTokens ?? frame.chunk.usage.inputTokens + frame.chunk.usage.outputTokens + (frame.chunk.usage.cacheReadTokens ?? 0) + (frame.chunk.usage.cacheWriteTokens ?? 0));
                emit({ type: 'model.usage', agentId: id, role: profile.role, usage: frame.chunk.usage });
              }
              if (frame.type === 'end') text = currentText;
            });
            agentCtx.on('tools/result', (exec, result) => {
              tools.push(exec.name);
              let cadFailure: unknown;
              let businessOutcome:unknown;
              if(!result.isError&&exec.name==='cader_cad_recover'){
                try{const value=JSON.parse(String(result.value));businessOutcome={status:value.recovered?'succeeded':'refused',reason:value.recovery?.reason??value.reason};}catch{/* Canonical recovery output remains authoritative. */}
              }
              if(exec.name==='cader_review_cad_view'){
                businessOutcome={status:'pending',reason:'VISUAL_RESULT_UNVERIFIED'};
                if(!result.isError)try{
                  const value=JSON.parse(String(result.value));
                  const verdict=value.structured?.verdict;
                  businessOutcome=value.verification_pending?{status:'pending',reason:value.code??'VISUAL_REVIEW_PENDING'}:
                    value.evidence?.image_bounds?.possible_clipping?{status:'pending',reason:'CAPTURE_BOUNDS_PENDING'}:
                    !value.review_valid?{status:'pending',reason:'VISUAL_REPORT_INVALID'}:
                    verdict==='pass'?{status:'succeeded',reason:'VISUAL_REPORT_PASS'}:
                    verdict==='fail'?{status:'failed',reason:'VISUAL_DEFECTS_FOUND'}:{status:'pending',reason:'VISUAL_UNCERTAIN'};
                }catch{/* Transport/control success is never visual acceptance. */}
              }
              if (result.isError) {
                try {
                  const parsed = JSON.parse(result.error.message);
                  if (typeof parsed.dispatched === 'boolean' && typeof parsed.outcome === 'string')
                    cadFailure = { code: parsed.code, stage: parsed.stage, outcome: parsed.outcome, dispatched: parsed.dispatched, operation_id: parsed.operation_id,
                      transport_dispatched:parsed.transport_dispatched,native_dispatched:parsed.native_dispatched };
                } catch { /* Non-CAD failures keep their own public error contract. */ }
              }
              emit({ type: 'tool.result', agentId: id, role: profile.role, callId: exec.callId,
                tool: exec.name, arguments: exec.arguments, isError: result.isError,
                ...(cadFailure ? { cadFailure } : {}),
                ...(businessOutcome?{businessOutcome}:{}),
                ...(result.isError ? { error: result.error } : {}) });
            });
            agentCtx.on('tools/execute', async (exec, next) => {
              emit({ type: 'tool.dispatch', agentId: id, role: profile.role, batch_id: `${id}:step:${agentSteps}`,
                callId: exec.callId, rootCallId: exec.rootCallId, tool: exec.name, arguments: exec.arguments });
              return next();
            });
            const prompt = await agentCtx.systemPrompt.assemble({ scope: agent, agent });
            emit({ type: 'prompt.assembled', agentId: id, role: profile.role,
              prompt_sha256: createHash('sha256').update(renderPrompt(prompt)).digest('hex'),
              tools: prompt.tools.map(tool => tool.name) });
          },
        });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        const content: ContentBlock[] = [{ type: 'text', text: instruction }];
        if (request.image) {
          if(request.comparisonImage)content.push({type:'text',text:'Image A: ORIGINAL USER REFERENCE. Read its symbols, labels and topology; do not confuse it with the generated drawing.'});
          const { attachment: image,audit } = await attachView(request.image, request.imageView ?? {}, id);
          content.push({type:'text',text:'Image coordinate evidence: '+JSON.stringify(viewCoordinates(audit))});
          content.push({ type: 'image', attachment: image });
        }
        if(request.comparisonImage){
          content.push({type:'text',text:'Image B: GENERATED CAD RESULT. Compare this result with image A and the acceptance requirements.'});
          const {attachment,audit}=await attachView(request.comparisonImage,{},id);content.push({type:'text',text:'Image coordinate evidence: '+JSON.stringify(viewCoordinates(audit))});content.push({type:'image',attachment});
        }
        for(const detail of request.sourceDetails?.slice(0,4)??[]){content.push({type:'text',text:detail.label});const {attachment,audit}=await attachView(detail.path,detail.view,id);content.push({type:'text',text:'Image coordinate evidence: '+JSON.stringify(viewCoordinates(audit))});content.push({type:'image',attachment});}
        emit({ type: 'agent.started', agentId: id, role: profile.role, parentId: request.parent?.id });
        handle.agent.followup(createUserMessage({ content, source: { kind: 'user' } }));
        await handle.agent.whenIdle();
        text = request.resultText?.() || text;
        if(handoff&&!errorCode)text=JSON.stringify({scheduler_handoff:handoff,task_complete:false});
        if(outputTruncated&&!request.resultText?.()&&!handoff)errorCode='OUTPUT_TRUNCATED';
        const status: AgentResult['status'] = signal.aborted ? 'cancelled' : errorCode || !text.trim() ? 'failed' : 'succeeded';
        emit({ type: 'agent.completed', agentId: id, role: profile.role, status });
        const result = { id, profile: profileId, status, text, ...(errorCode ? { errorCode } : {}), ...(handoff?{handoff}:{}),modelSteps: agentSteps, tools };
        completed.push(result);
        return result;
      } finally {
        signal.removeEventListener('abort', abort);
        await handle?.dispose();
      }
    }
    async function inspectReference(path:string,task:string,signal?:AbortSignal):Promise<{valid:boolean;structured:ReturnType<typeof parseReferenceObservation>|null;attempts:{id:string;status:string;valid:boolean}[];label_reviews:{id:string;indices:number[];valid:boolean;pass:number}[];label_inventory?:{id:string;valid:boolean}|null;component_inventory?:{id:string;valid:boolean;added:string[]}|null;net_review?:{id:string;valid:boolean;changed:boolean;consensus?:boolean;report_valid?:boolean;uncertain_nets?:{id:string;evidence?:string;pins:{object:string;terminal:number}[]}[]}|null;evidence:{path:string;sha256:string;width:number;height:number}}>{
      const vision=options.profiles.find(p=>p.role==='vision'&&p.input.includes('image'));
      if(!vision)throw new Error('VISION_PROFILE_UNAVAILABLE');
      const source=await readReferenceImage(options.workspaceRoot??options.root,path);
      let structured:ReturnType<typeof parseReferenceObservation>|null=null;
      const attempts:{id:string;status:string;valid:boolean}[]=[];
      for(let attempt=0;attempt<2;attempt++){
        signal?.throwIfAborted();
        reserveSourceReview();
        const submit:ToolDefinition={name:'cader_submit_reference_observation',description:'Report only observed source-image facts, normalized original pixel positions and uncertainty. No CAD operations or invented measurements.',
          parameters:referenceObservationSchema,output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},
          async execute(args,exec){const parsed=parseReferenceObservation(args);if(parsed.drawing_kind==='schematic'&&parsed.objects.some(o=>o.category!=='component'))throw new Error('SOURCE_DEVICES_ONLY: schematic objects must be actual component category=component; conductors belong in nets, NOT as fake components with ports. Report all device terminals.');if(parsed.drawing_kind==='schematic'&&parsed.objects.some(o=>o.terminals.length)&&!parsed.nets?.length)throw new Error('SOURCE_NETLIST_REQUIRED: report external conductor nets with object and zero-based terminal index; preserve every terminal exactly once, multi-pin devices are NOT internal shorts');structured=parsed;exec.concludeTurn();return JSON.stringify(structured);}};
        const result=await pool.run('main',()=>run(vision.id,'观察实际附带的用户手稿，必须调用cader_submit_reference_observation。报告图形种类、可辨符号/构件、可读标注、连接关系和不确定项。电路objects只列真实器件（category=component），导线/总线不得作为带端口的元件，导线仅用nets表达；文字单列visible_text。只根据像素，不用Shell统计猜类别，不要求物理比例尺。content_bounds包含整幅有效图及其标签，排除无关空白/纸张横线。所有bounds/terminals为原图归一化坐标，左上原点、y向下。terminal是符号接导线的位置，不是标注位置；无端口构件可为空。不要输出CAD计划，严禁虚构无法读出的数值。电路还必须提供nets：从实际导线观察的外部等势连接组，每组pins以object和terminal零起始索引引用，覆盖每个器件的全部端子一次。三极管必须保留三个端子，不把器件内部当导线短接；导线交叉只有明确接点才相连；未连接端子用单独net。只沿可见导线追踪，不按常见电路补接地或回路；孤立接地符号不自动连接未标地的另一回路。先核对各分支与公共回路。保持紧凑。'+(attempt?'上次格式无效，请仅按schema补报。':'')+'\n用户请求：'+task,
          {image:path,maxImageViews:2,signal,onlyTools:[submit.name,'cader_view_image'],extraTools:[submit],resultText:()=>structured?JSON.stringify(structured):undefined}));
        attempts.push({id:result.id,status:result.status,valid:structured!==null});
        if(structured){for(const prior of attempts.slice(0,-1)){const old=completed.find(r=>r.id===prior.id);if(old)old.recovered_by=result.id;}break;}
        if(signal?.aborted||(result.status!=='succeeded'&&!['OUTPUT_TRUNCATED','TIMEOUT'].includes(result.errorCode??'')))break;
      }
      const observation=structured as ReturnType<typeof parseReferenceObservation>|null;
      let netReview:{id:string;valid:boolean;changed:boolean;consensus?:boolean;report_valid?:boolean;uncertain_nets?:{id:string;evidence?:string;pins:{object:string;terminal:number}[]}[]}|null=null;
      let componentInventory:{id:string;valid:boolean;added:string[]}|null=null;
      if(observation?.drawing_kind==='schematic'){
        signal?.throwIfAborted();reserveSourceReview();
        let inventoried:ReturnType<typeof reconcileSourceComponents>|null=null;
        const inventoryTool:ToolDefinition={name:'cader_submit_reference_component_inventory',description:'Inventory every actual component from the entire original image, independently of an earlier list. Include symbols without labels and single-pin reference symbols; wires and labels are not devices.',parameters:referenceComponentInventorySchema,output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args,exec){const parsed=parseReferenceComponentInventory(args),merged=reconcileSourceComponents(observation.objects,parsed);if(merged.unmatched_prior_ids.length)throw new Error('SOURCE_COMPONENT_INVENTORY_DISAGREEMENT: independently recheck positions/port counts; prior components not matched: '+JSON.stringify(merged.unmatched_prior_ids));inventoried=merged;exec.concludeTurn();return JSON.stringify({objects:parsed.objects,added:merged.additions.map(o=>o.id)});}};
        const reading=await pool.run('main',()=>run(vision.id,'独立扫描整幅原图，必须调用cader_submit_reference_component_inventory列出所有实际器件。逐区域清点，不依赖任何先前器件清单，不用常见电路补全；无文字的圆形源、接地/参考符号也须列入。每个实际符号独立id、原图归一化bounds及全部terminal，三端器件不能压为两端。category只允许component；导线、标签不是器件。保留具体轮廓、填充、极性、箭头与方向，不把不同制式统称标准符号。只清点器件，不追网、不规划、不省略无标注符号。用户请求及确认：'+task,{image:path,signal,onlyTools:[inventoryTool.name],extraTools:[inventoryTool],resultText:()=>inventoried?JSON.stringify(inventoried):undefined}));
        const merged=inventoried as ReturnType<typeof reconcileSourceComponents>|null;componentInventory={id:reading.id,valid:Boolean(merged),added:merged?.additions.map(o=>o.id)??[]};attempts.push({id:reading.id,status:reading.status,valid:Boolean(merged)});
        if(!merged)structured=null;
        else{observation.objects=merged.objects;const ids=new Set(observation.nets?.map(n=>n.id));for(const object of merged.additions)for(let terminal=0;terminal<object.terminals.length;terminal++){let id='inventory_'+ids.size;while(ids.has(id))id+='x';ids.add(id);(observation.nets??=[]).push({id,pins:[{object:object.id,terminal}],certainty:'uncertain',evidence:'Inventory-only terminal; connectivity not yet observed. Must be independently traced before drawing.'});}}
      }
      if(structured&&observation?.drawing_kind==='schematic'){
        signal?.throwIfAborted();reserveSourceReview();
        let checked:ReturnType<typeof parseReferenceNets>|null=null;
        const submit:ToolDefinition={name:'cader_submit_reference_nets',description:'Independently trace actual source conductors. membership maps EVERY object:terminal key to exactly one net ID. nets supplies evidence/certainty, without pin arrays. Do not invent return/ground connections.',parameters:referenceMembershipSchema(observation),output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args,exec){const parsed=parseReferenceMembership(args,observation);if(parsed.missing_objects?.some(o=>o.category!=='component'))throw new Error('SOURCE_DEVICES_ONLY');parseReferenceObservation({...observation,objects:[...observation.objects,...parsed.missing_objects??[]],nets:parsed.nets});if(parsed.nets.some(n=>!n.evidence||!n.certainty))throw new Error('SOURCE_NET_EVIDENCE_REQUIRED');checked=parsed;exec.concludeTurn();return JSON.stringify(parsed);}};
        const quadrants=[0,1,2,3].map(index=>({path,view:{crop:{left:index%2?Math.floor(source.width*0.4):0,top:index>1?Math.floor(source.height*0.4):0,width:Math.ceil(source.width*0.6),height:Math.ceil(source.height*0.6)}},label:`Original source quadrant ${index}; preserve observed device terminal indices.`}));
        const originalNets=observation.nets??[],originalPins=new Set(observation.objects.flatMap(o=>o.terminals.map((_,i)=>`${o.id}:${i}`)));
        const partition=(nets:typeof originalNets)=>nets.map(n=>n.pins.map(p=>`${p.object}:${p.terminal}`).filter(p=>originalPins.has(p)).sort().join('|')).filter(Boolean).sort().join(';');
        let hadDisagreement=false;
        let fallback:{id:string;report:ReturnType<typeof parseReferenceNets>;uncertainty:ReturnType<typeof parseReferenceNets>['nets'];consensus:boolean}|null=null;
        for(let pass=0;pass<2;pass++){
          if(pass){signal?.throwIfAborted();reserveSourceReview();}
          const previousNets=checked;checked=null;
        const result=await pool.run('main',()=>run(vision.id,'手稿线条可有轻微抖动、叠笔或浓淡变化，追踪可辨的连续路径，不把轻微笔触差异误判为多处断路；仍不可辨则uncertain，不用电路常识补线。'+(pass?'上次存在未确认连接；本轮附原图四个局部区域，以实际像素复核这些不确定处：'+JSON.stringify({prior_candidate:observation.nets?.map(n=>({id:n.id,pins:n.pins,certainty:n.certainty})),last_review:(previousNets as ReturnType<typeof parseReferenceNets>|null)?.nets.map(n=>({id:n.id,pins:n.pins,certainty:n.certainty}))}):'')+'先独立核对整图器件覆盖，再沿原图像素导线追踪外部net，调用cader_submit_reference_nets。若初始objects漏掉可见器件或接地/连接符号，在missing_objects补报真实器件、bounds和端子索引（不可补假导线组件），并在membership包含新旧全部端子；缺失符号不能静默忽略。给定器件与端子索引只是位置索引，不能当作已验证连接。使用membership逐端子赋组：每个“object:terminal”必须作为一个属性键，值为net ID；nets仅列id、evidence及certainty，不再列pins数组。原有每个端子的属性在schema中均必填，新补器件也须加入全部端子键。给出可见导线路径evidence和certainty。禁止按常见电路知识补全：一个接地符号不自动连接到另一条未标地、且像素上断开的回路线；T接点或折线端点直接相接无需圆点，不能仅因缺少圆点就标uncertain；两条线的内部交叉才需判断接点。真正可见的断线/无接点内部跨越分别分组。器件内部各端不短接；各电源极性端独立，三端器件保留全部端子。无法追清则uncertain，不猜闭环；不确定表示尚不能确认关系，不等于默认断开可见导线。按最可能的像素路径分组，真正的疑问留在certainty/evidence，后续仍需独立对照验收。只提交membership、nets及必要missing_objects，不规划。用户原始请求及明确澄清：'+task+'。明确的用户连接确认优先于模糊笔触，但证据须注明来自用户确认，不能伪装纯像素识别。原图端子索引：'+JSON.stringify(observation.objects.map(o=>({...o,terminals:o.terminals.map((position,terminal)=>({terminal,position}))}))),{image:path,maxImageViews:2,sourceDetails:pass?quadrants:undefined,signal,onlyTools:[submit.name,'cader_view_image'],extraTools:[submit],resultText:()=>checked?JSON.stringify(checked):undefined}));
        const revised=checked as ReturnType<typeof parseReferenceNets>|null;
        const canonical=(nets:NonNullable<typeof observation.nets>)=>nets.map(n=>n.pins.map(p=>`${p.object}:${p.terminal}`).sort().join('|')).sort().join(';');
        const baseline:ReturnType<typeof parseReferenceObservation>=fallback?{...observation,objects:[...observation.objects,...fallback.report.missing_objects??[]],nets:fallback.report.nets}:observation;
        let arbitration:ReturnType<typeof reconcileSourceNets>|null=revised?reconcileSourceNets(baseline,{...revised,missing_objects:revised.missing_objects?.filter(o=>!baseline.objects.some(prior=>prior.id===o.id))}):null;
        if(revised){hadDisagreement ||= partition(originalNets)!==partition(revised.nets);const initial=reconcileSourceNets(observation,revised);if(initial.valid&&initial.clear_consistent&&(observation.nets??[]).every(n=>n.certainty==='clear')&&revised.nets.every(n=>n.certainty==='clear')&&partition(originalNets)===partition(revised.nets)&&!arbitration?.clear_consistent)arbitration=initial;}

        const consensus=arbitration?.clear_consistent??false;
        const valid=arbitration?.valid??false;
        netReview={id:result.id,valid,consensus,report_valid:Boolean(revised),changed:Boolean(revised&&canonical(revised.nets)!==canonical(originalNets)),uncertain_nets:revised?.nets.filter(n=>n.certainty!=='clear')??[]};
        attempts.push({id:result.id,status:result.status,valid});
        if(valid&&revised){const additions=[...baseline.objects.filter(o=>!observation.objects.some(prior=>prior.id===o.id)),...arbitration!.report.missing_objects??[]].filter((object,index,all)=>all.findIndex(prior=>prior.id===object.id)===index);fallback={id:result.id,report:{...arbitration!.report,missing_objects:additions},uncertainty:revised.nets.filter(n=>n.certainty!=='clear').length?revised.nets.filter(n=>n.certainty!=='clear'):consensus?[]:revised.nets.map(n=>({...n,certainty:'uncertain' as const,evidence:('Source observations disagree; independently verify this group against original pixels: '+(n.evidence??'')).slice(0,400)})),consensus};if(!fallback.uncertainty.length)break;}
        if(result.status!=='succeeded'&&!['TIMEOUT','OUTPUT_TRUNCATED','MALFORMED_RESPONSE'].includes(result.errorCode??'')){fallback=null;break;}
        }
        if(fallback&&hadDisagreement&&!fallback.consensus){netReview={id:fallback.id,valid:false,report_valid:true,consensus:false,changed:true,uncertain_nets:fallback.uncertainty};fallback=null;structured=null;}
        if(fallback){
          const revised=fallback.report;
          netReview={id:fallback.id,valid:true,report_valid:true,consensus:fallback.consensus,changed:Boolean(revised.missing_objects?.length)||partition(originalNets)!==partition(revised.nets),uncertain_nets:fallback.uncertainty.length?fallback.uncertainty:hadDisagreement?revised.nets.map(n=>({...n,evidence:'Historical source observations disagreed; final independent source fidelity remains required.'})):[]};
          observation.nets=revised.nets;observation.objects.push(...revised.missing_objects??[]);
          for(const attempt of attempts){const failed=completed.find(r=>r.id===attempt.id&&r.status!=='succeeded'&&!r.recovered_by&&['TIMEOUT','OUTPUT_TRUNCATED','MALFORMED_RESPONSE'].includes(r.errorCode??''));if(failed)failed.recovered_by=fallback.id;}
        }else structured=null;
      }
      let labelInventory:{id:string;valid:boolean}|null=null;
      if(structured&&observation&&(observation.drawing_kind==='schematic'||observation.visible_text.length)){
        signal?.throwIfAborted();reserveSourceReview();
        let inventory:ReturnType<typeof parseReferenceLabelInventory>|null=null;
        const submit:ToolDefinition={name:'cader_submit_reference_label_inventory',description:'Independently inventory ALL source values/units/designators by actual image position, including repeated equal labels. No prior OCR list is authoritative.',parameters:referenceLabelInventorySchema,output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args,exec){inventory=parseReferenceLabelInventory(args);exec.concludeTurn();return JSON.stringify(inventory);}};
        const review=await pool.run('main',()=>run(vision.id,'独立清点原图全部文字标签，立即调用cader_submit_reference_label_inventory。先逐区域扫描整图，逐位置列出数值、单位、型号或编号；相同值出现在不同位置必须分别列出，不能合并成一个。保持原图归一化bounds覆盖全部字符；模糊字保留uncertain，不猜常用值。组件内部正负极号由组件绘制，不计为外部标签。此阶段只清点，不规划，不省略重复标注。用户任务：'+task,{image:path,signal,onlyTools:[submit.name],extraTools:[submit],resultText:()=>inventory?JSON.stringify(inventory):undefined}));
        const scanned=inventory as ReturnType<typeof parseReferenceLabelInventory>|null;
        labelInventory={id:review.id,valid:scanned!==null};attempts.push({id:review.id,status:review.status,valid:scanned!==null});
        if(!scanned)structured=null;
        else{
          const merged=reconcileSourceLabels(observation.visible_text,scanned.visible_text);
          if(merged.length>32)throw new Error('SOURCE_LABEL_INVENTORY_LIMIT');
          observation.visible_text=merged.sort((a,b)=>a.bounds[0][1]-b.bounds[0][1]||a.bounds[0][0]-b.bounds[0][0]);
        }
      }
      const labelReviews:{id:string;indices:number[];valid:boolean;pass:number}[]=[];
      if(structured&&observation?.visible_text.length){
        // Cover every label, uncertain first. A second pass only revisits
        // unresolved crops; indices always refer to the original observation.
        for(let pass=0;pass<2;pass++){
          const indices=observation.visible_text.map((_,i)=>i).filter(i=>pass===0||observation.visible_text[i]!.certainty==='uncertain')
            .sort((a,b)=>Number(observation.visible_text[b]!.certainty==='uncertain')-Number(observation.visible_text[a]!.certainty==='uncertain'));
          for(let offset=0;offset<indices.length;offset+=pass?1:4){
            signal?.throwIfAborted();reserveSourceReview();
            const selected=indices.slice(offset,offset+(pass?1:4)),details=selected.map(index=>{
              const text=observation.visible_text[index]!,[a,b]=text.bounds;
              const mx=pass?Math.max((b[0]-a[0])*1.5,0.05):(b[0]-a[0])*0.5,my=pass?Math.max((b[1]-a[1])*1.5,0.05):(b[1]-a[1])*0.75;
              const left=Math.max(0,Math.floor((a[0]-mx)*source.width)),top=Math.max(0,Math.floor((a[1]-my)*source.height));
              return {path,view:{crop:{left,top,width:Math.min(source.width,Math.ceil((b[0]+mx)*source.width))-left,height:Math.min(source.height,Math.ceil((b[1]+my)*source.height))-top}},label:`Original source label crop index=${index}. Target ORIGINAL normalized bounds=${JSON.stringify(text.bounds)}, candidate=${JSON.stringify(text.text)} (UNVERIFIED). The larger crop is CONTEXT: read ONLY this target label, not neighboring labels; never concatenate different labels. You may correct its bounds within this crop after inspecting actual pixels. Preserve actual case and units, not assumed circuit values.`};
            });
            let labels:ReturnType<typeof parseReferenceLabels>|null=null;
            const labelSchema=structuredClone(referenceLabelsSchema);if(selected.length>1)delete labelSchema.properties.labels.items.properties.bounds;
            const submit:ToolDefinition={name:'cader_submit_reference_labels',description:'Read ALL supplied original label crops; indices are original observation indices, not batch positions. Preserve actual symbols, values, units and case. Do not guess.',parameters:labelSchema,output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args,exec){const parsed=parseReferenceLabels(args);if(parsed.labels.length!==selected.length||new Set(parsed.labels.map(l=>l.index)).size!==selected.length||parsed.labels.some(l=>!selected.includes(l.index)))throw new Error('SOURCE_LABEL_CROP_INDEX_MISMATCH');for(const label of parsed.labels)if(label.bounds){const crop=details[selected.indexOf(label.index)]!.view.crop;if(label.bounds[0][0]<crop.left/source.width||label.bounds[1][0]>(crop.left+crop.width)/source.width||label.bounds[0][1]<crop.top/source.height||label.bounds[1][1]>(crop.top+crop.height)/source.height)throw new Error('SOURCE_LABEL_BOUNDS_OUTSIDE_CROP');const center=[(label.bounds[0][0]+label.bounds[1][0])/2,(label.bounds[0][1]+label.bounds[1][1])/2],distance=(bounds:typeof label.bounds)=>Math.hypot(center[0]!-(bounds![0][0]+bounds![1][0])/2,center[1]!-(bounds![0][1]+bounds![1][1])/2);const own=distance(observation.visible_text[label.index]!.bounds);if(observation.visible_text.some((other,index)=>index!==label.index&&distance(other.bounds)+1e-5<own))throw new Error('SOURCE_LABEL_TARGET_MISMATCH: corrected bounds select a neighboring label, not the requested index');}labels=parsed;exec.concludeTurn();return JSON.stringify(parsed);}};
            const review=await pool.run('main',()=>run(vision.id,'只根据实际原图和局部图读取每个标签，立即调用cader_submit_reference_labels。每个局部图只读取指定target bounds附近的一处标签，不能将上下或左右相邻标注串成一个值；扩大图只是上下文。'+(selected.length>1?'本批只返回index/text/certainty，不提交bounds；已核对的位置框保持不变。':'单项可按原图归一化坐标修正bounds，不是裁图局部坐标。')+'原始index集合：'+JSON.stringify(selected)+'。区分SI前缀大小写、微符号、正负号、数字与字母；不从常见电路值猜测。若字迹确实不清标uncertain，不把不确定标签改成常见值。'+(pass?'这是仍不确定标签的第二次复核，可查看整图上下文；仍无法读取则保留uncertain。':'')+'用户任务：'+task,{image:path,maxModelSteps:3,sourceDetails:details,signal,onlyTools:[submit.name],extraTools:[submit],resultText:()=>labels?JSON.stringify(labels):undefined}));
            const refined=labels as ReturnType<typeof parseReferenceLabels>|null;
            attempts.push({id:review.id,status:review.status,valid:refined!==null});
            labelReviews.push({id:review.id,indices:selected,valid:refined!==null,pass});
            for(const index of selected){const text=observation.visible_text[index]!,label=refined?.labels.find(l=>l.index===index);if(label){text.text=label.text;text.certainty=label.certainty;if(label.bounds)text.bounds=label.bounds;}else text.certainty='uncertain';}
          }
        }
      }
      const result={valid:structured!==null,structured,attempts,label_reviews:labelReviews,label_inventory:labelInventory,component_inventory:componentInventory,net_review:netReview,evidence:{path,sha256:createHash('sha256').update(source.data).digest('hex'),width:source.width,height:source.height}};
      emit({type:'reference.inspected',...structuredClone(result)});return result;
    }
    async function reviewCadView(question: string, signal?: AbortSignal, parent?: Agent, referenceImage?:string,referenceDetails?:{path:string;view:ImageView;label:string}[]) {
      if(referenceDetails?.some(detail=>detail.path!==referenceImage))throw new Error('SOURCE_DETAIL_MISMATCH');
      if (!options.captureCadView) throw new Error('CAD_VIEW_EXPORT_UNAVAILABLE');
      if (++visualReviews > options.runtime.max_visual_reviews_per_turn) throw new Error('VISUAL_REVIEW_BUDGET_EXCEEDED');
      const vision = options.profiles.find(profile => profile.role === 'vision' && profile.input.includes('image'));
      if (!vision) throw new Error('VISION_PROFILE_UNAVAILABLE');
      const capture = await options.captureCadView(signal ?? lifetime.signal);
      const ref = `cad-view-${randomUUID()}`; images.set(ref, capture.path);
      emit({ type: 'cad.view', evidence: capture.evidence, image_ref: ref });
      const attempts: { id:string; status: string; text: string; valid: boolean }[] = [];
      let structured: ReturnType<typeof parseVisualReport> | null = null;
      let knownIds:Set<number>|undefined;
      let requirementIds:Set<string>|undefined;
      let evidenceInput:any;
      try{evidenceInput=JSON.parse(question);if(Array.isArray(evidenceInput.entity_snapshot))knownIds=new Set(evidenceInput.entity_snapshot.map((entity:{object_id:number})=>entity.object_id));if(Array.isArray(evidenceInput.requirements))requirementIds=new Set(evidenceInput.requirements.map((r:{id:string})=>r.id));}catch{/* Free-form reviews have no authoritative entity list. */}
      const reference=referenceImage?await readReferenceImage(options.workspaceRoot??options.root,referenceImage):undefined;
      const needsSourceTopology=requirementIds?.has('source_topology_fidelity')??false;
      let sourceFrame:ReturnType<typeof parseReferenceObservation>|undefined;
      let expectedSourceGroups:string[][]=[];
      let trustedConnections:ReturnType<typeof parseSourceConnectionReview>['connections']=[];
      type SourceTopologyEvidence={raw_report:ReturnType<typeof parseReferenceNets>;confirmations:ReturnType<typeof parseSourceConnectionReview>['connections'];report:ReturnType<typeof parseReferenceNets>;all_clear:boolean;matches_cad_groups:boolean;native_verified:boolean;source_sha256:string};
      let sourceTopologyEvidence:SourceTopologyEvidence|null=null;
      const reportSchema=structuredClone(visualReportSchema);
      if(needsSourceTopology){
        const source=evidenceInput?.source_terminal_index,cad=evidenceInput?.cad_external_netlist;
        if(!reference||source?.sha256!==createHash('sha256').update(reference.data).digest('hex')||!Array.isArray(source?.objects)||!Array.isArray(cad?.components)||!Array.isArray(cad?.nets))throw new Error('SOURCE_TOPOLOGY_BINDINGS_REQUIRED');
        sourceFrame=parseReferenceObservation({version:1,drawing_kind:'schematic',summary:'Source terminal locations only; no prior connectivity opinions.',coordinate_system:'normalized-image-top-left-y-down',content_bounds:[[0,0],[1,1]],objects:source.objects.map((o:any)=>({...o,kind:'Source component location',category:'component',certainty:'clear'})),visible_text:[],connections:[],unknowns:[]});
        expectedSourceGroups=cad.nets.map((net:any)=>net.pins.map((pin:any)=>{const c=cad.components.find((c:any)=>c.id===pin.component),index=c?.pin_names?.indexOf(pin.pin);if(!c?.source_id||index===undefined||index<0||c.source_terminals?.[index]===undefined)throw new Error('SOURCE_TOPOLOGY_BINDINGS_INVALID');return `${c.source_id}:${c.source_terminals[index]}`;}));
        trustedConnections=parseSourceConnectionReview({connections:evidenceInput.source_connection_confirmations??[]}).connections;
        if(trustedConnections.some(c=>!evidenceInput.original_request?.includes(c.source_quote)||!/确认|confirm/i.test(c.source_quote)))throw new Error('SOURCE_CONNECTION_CONFIRMATION_QUOTE_INVALID');
        reportSchema.properties.source_topology=referenceMembershipSchema(sourceFrame);reportSchema.required.push('source_topology');
      }
      const validateReport=(value:unknown)=>{
        const {source_topology,...visualValue}=value as Record<string,unknown>;
        const parsed=parseVisualReport(visualValue);
        if(knownIds&&parsed.defects.some(d=>d.entity_ids.some(id=>!knownIds!.has(id))))throw new Error('UNKNOWN_REVIEW_ENTITY_ID: use only IDs from entity_snapshot, or [] when uncertain');
        if(requirementIds&&(parsed.checklist.length!==requirementIds.size||new Set(parsed.checklist.map(c=>c.requirement_id)).size!==requirementIds.size||parsed.checklist.some(c=>!requirementIds!.has(c.requirement_id))))throw new Error('REVIEW_CHECKLIST_MISMATCH: report each supplied visual requirement ID exactly once; do not invent IDs or report geometry-only conditions');
        if(needsSourceTopology){
          const rawReport=parseReferenceMembership(source_topology,sourceFrame!);
          const confirmations=trustedConnections;
          const report=confirmations.length?{...rawReport,nets:mergeConfirmedSourceConnections(rawReport.nets,confirmations)}:rawReport;
          if(report.nets.some(net=>!net.evidence||!net.certainty))throw new Error('SOURCE_NET_EVIDENCE_REQUIRED');
          const canonical=(groups:string[][])=>groups.map(p=>p.sort().join('|')).sort().join(';');
          const matches=canonical(report.nets.map(n=>n.pins.map(p=>`${p.object}:${p.terminal}`)))===canonical(expectedSourceGroups);
          const allClear=report.nets.every(net=>net.certainty==='clear'),nativeVerified=evidenceInput.cad_external_netlist.verified===true;
          const status=allClear?(matches?(nativeVerified?'pass':'uncertain'):'fail'):'uncertain';
          if(parsed.checklist.find(c=>c.requirement_id==='source_topology_fidelity')?.status!==status)throw new Error('SOURCE_TOPOLOGY_REPORT_CONFLICT: independently trace Image A in source_topology.membership. The program compares those groups with CAD. Expected checklist status='+status+'. Actual source_connection_confirmations, when present, resolve ONLY their explicitly confirmed connectivity; raw uncertain pixel readings remain in evidence. CAD T contacts and microscopic gaps are determined by native coordinates, not extra visible dots. Uncertainty must concern the ORIGINAL source path, not re-proving verified CAD contacts.');
          sourceTopologyEvidence={raw_report:rawReport,confirmations,report,all_clear:allClear,matches_cad_groups:matches,native_verified:nativeVerified,source_sha256:evidenceInput.source_terminal_index.sha256};
        }else if(source_topology!==undefined)throw new Error('UNREQUESTED_SOURCE_TOPOLOGY_REPORT');
        return parsed;
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        signal?.throwIfAborted();
        const submit: ToolDefinition = { name: 'cader_submit_visual_report', description: 'Submit the compact validated visual report. No extra fields. Mark unobservable conditions uncertain.',
          parameters: reportSchema, output: { schema: { type: 'string' }, render: (_a,v) => [{type:'text',text:String(v)}] },
          async execute(args, exec) { structured=validateReport(args);exec.concludeTurn();return JSON.stringify(structured); } };
        const review = await pool.run('main', () => run(vision.id,
          '用中文审查实际CAD图片与原始需求。若有Image A/B，A是原始用户手稿，B是本任务CAD结果：必须比较符号、可读标注、连接和布局，不能只说结果好看或拿旧图当参考。没有真实依据的条件标uncertain。必须调用cader_submit_visual_report提交；不要输出长篇解释。每条证据与建议保持简短，最多8个缺陷。checklist逐项核验要求的视觉条件；程序几何/拓扑事实不要求通过像素重复证实，不得仅凭图像推翻实体坐标。uncertainties仅记录影响必要视觉条件的未解决问题，不记录用户未要求的特征、无关观察或程序已证明的几何精度。' +
          (needsSourceTopology?'\nsource_topology报告原图A的外部连接读数；source_connection_confirmations是程序核对过的真实用户确认，优先于相应模糊笔触，程序仅合并已确认端子并保留原读数，不能伪装纯视觉成功。按每个源端子键提交membership及每组evidence/certainty；不要从CAD图片B的像素重证接点/微小间隙，也不要求T接点额外实心圆点。程序将原图分组与已读回验证的CAD分组比较。源图轻微笔触抖动或同路径叠笔不是断路证明，确实不清则在对应源net标uncertain。':'')+(attempt ? '\n上次未提交有效报告或输出被截断。请按工具schema简短重报，不要增加自定义字段。' : '') + '\n需求与程序证据：\n' + question,
          { parent, cadReview:true,image: referenceImage??capture.path, comparisonImage:referenceImage?capture.path:undefined,sourceDetails:referenceDetails, signal, onlyTools: [submit.name], extraTools: [submit], resultText: () => structured ? JSON.stringify(structured) : undefined }));
        if (!structured && review.status === 'succeeded') {
          try { structured=validateReport(JSON.parse(review.text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))); } catch { /* Format repair is bounded and never constitutes acceptance. */ }
        }
        attempts.push({ id:review.id,status: review.status, text: review.text, valid: structured !== null });
        if(structured)for(const previous of attempts.slice(0,-1)){
          const failed=completed.find(result=>result.id===previous.id);
          if(failed&&['OUTPUT_TRUNCATED','MALFORMED_RESPONSE'].includes(failed.errorCode??''))failed.recovered_by=review.id;
        }
        if (structured || (review.status !== 'succeeded'&&!['OUTPUT_TRUNCATED','MALFORMED_RESPONSE'].includes(review.errorCode??'')) || signal?.aborted) break;
      }
      const result = { image_ref: ref, evidence: {...capture.evidence as Record<string,unknown>,reference:reference?{path:referenceImage,sha256:createHash('sha256').update(reference.data).digest('hex'),width:reference.width,height:reference.height}:null}, requirements: question, review_valid: structured !== null, structured,source_topology_evidence:sourceTopologyEvidence as SourceTopologyEvidence|null, attempts };
      emit({ type: 'cad.review', ...result }); return result;
    }

    return { ctx, run, reviewStats:()=>({capture_attempts:visualReviews,model_calls:visualModelCalls,source_review_reservations:sourceReviewReservations,source_review_limit:sourceReviewLimit,agent_delegations:delegations}),enableTaskBudget:()=>{scheduled=true;},budgetState:()=>({...budget.snapshot(),agent_delegations:delegations,source_review_reservations:sourceReviewReservations,source_review_limit:sourceReviewLimit,pending:structuredClone(pending)}),inspectReference,reviewCadView:(question:string,signal?:AbortSignal,referenceImage?:string,referenceDetails?:{path:string;view:ImageView;label:string}[])=>reviewCadView(question,signal,undefined,referenceImage,referenceDetails), pool, completed: () => completed.slice(), toolNames: () => ctx.tools.schemas().map(tool => tool.name),
      async dispose() { clearTimeout(deadline); lifetime.abort(); await ctx.fiber.dispose(); } };
  } catch (error) { clearTimeout(deadline); await ctx.fiber.dispose(); throw error; }
}
