import { readFile, stat, realpath, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, extname, join, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { loadConfig, loadMcp, loadSkills, readReferenceImage, workspacePath, parseYaml } from '@cader/config';
import type { PublicEvent } from '@cader/dsh-adapter';
import { runTask } from './task.js';
import { SessionStore, newSession, privateDirectory, environmentRedactor, terminalText } from './session-store.js';
import type { ChatSession } from './session-store.js';
import { runUserShell } from './interactive-shell.js';
import { ExecutionSession, PERMISSION_MODES } from './execution.js';
import type { Approval,PermissionMode } from './execution.js';
import type { QualityResume } from './quality.js';
import { qualityTaskContext } from './quality.js';
import { acceptQualityByUser,userReviewStatus,userReviewCandidate } from './quality-acceptance.js';
import { taskIntent } from './task-intent.js';
import { importReferenceImage, referencedPaths, referenceOutput, wantsRedraw } from './reference-input.js';

export const SLASH_COMMANDS = [
  ['/help', '命令与快捷键'], ['/open', '选择图片或DWG引用；CAD打开需后端能力'], ['/cd', '切换工作目录'],
  ['/status', '工作区与CAD状态'], ['/model', '查看或切换配置模型'], ['/mcp', 'list / use <配置> / tools / doctor / recover / barrier / resolve / off'],
  ['/skills', 'list / use <技能> / off'], ['/domain', '查看或切换专业'], ['/context', '上下文统计'],
  ['/compact', '用模型总结上下文，保留原始对话'], ['/clear', '保存并新建空白会话'], ['/resume', '列出或恢复会话ID'],
  ['/quality','查看质量；resume 安全重验；accept [说明] 人工复核DWG，不授予写权'],
  ['/undo', '检查受控撤销能力'], ['/checkpoint', '创建会话与工程引用检查点'], ['/permissions', 'read-only | ask | workspace-write | full-access；shell ask|deny'], ['/exit', '保存并退出'],
] as const;
const Domains = z.object({ version: z.literal(1), domains: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string(), instruction: z.string().max(4000) }).strict()).min(1) }).strict();
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
export interface ChatReply { text: string; afterStream?:string; error?: boolean; exit?: boolean; note?: string }
export interface ChatCallbacks { signal?: AbortSignal; onEvent?: (event: PublicEvent) => void;
  confirm?: (command: string, cwd: string) => Promise<boolean>; review?: Approval }
export type TaskRunner = typeof runTask;

/** Application service shared by the terminal and deterministic command tests. */
export class InteractiveSession {
  state: ChatSession;
  readonly store: SessionStore;
  readonly clean: (text: string) => string;
  readonly secrets: string[];
  lastUsage: unknown = null;
  private active = false;
  execution: ExecutionSession;
  startupStatus = 'MCP 未配置；使用 /mcp use <配置>。';
  private constructor(readonly configRoot: string, workspace: string, readonly config: Awaited<ReturnType<typeof loadConfig>>,
    readonly domains: z.infer<typeof Domains>['domains'], private readonly runner: TaskRunner) {
    const redaction = environmentRedactor(); this.secrets = redaction.secrets;
    this.clean = text => terminalText(redaction.clean(text));
    this.state = newSession(workspace, config.runtime.main_profile);
    this.execution = new ExecutionSession(workspace, join(workspace, '.cader/runs', `execution-${randomUUID()}`), this.clean);
    this.store = new SessionStore(configRoot, this.clean);
  }
  static async create(configRoot: string, workspace = configRoot, runner: TaskRunner = runTask) {
    configRoot = await realpath(configRoot); workspace = await realpath(workspace);
    const config = await loadConfig(configRoot);
    const domains = Domains.parse(parseYaml(await readFile(join(configRoot, 'configs/domains/catalog.yaml'), 'utf8'))).domains;
    if (new Set(domains.map(domain => domain.id)).size !== domains.length) throw new Error('DOMAIN_DUPLICATE');
    if (!domains.some(domain => domain.id === 'general')) throw new Error('GENERAL_DOMAIN_REQUIRED');
    const session = new InteractiveSession(configRoot, workspace, config, domains, runner);
    try{await session.execution.loadPersistedBarrier();}catch{session.startupStatus='工作区历史屏障无法读取，写入已阻断；请检查原始审计。';}
    const local = join(configRoot, 'configs/mcp/AutoCAD.local.yaml');
    try {
      await stat(local); session.state.mcp = local;
      const status = await session.execution.connect(local);
      const backend = status.backend as { backend?: string; connection_state?: string };
      session.startupStatus = session.clean(`MCP 已连接 · 发现 ${status.discovered} 工具 · Agent CAD ${status.exposed} 工具 · ${backend.backend ?? 'unknown'} · CAD ${backend.connection_state ?? '未探测'}`);
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') session.startupStatus = 'MCP 连接失败；检查 /mcp tools、Python路径和依赖。'; }
    if(session.execution.facts().frozen)session.startupStatus+='\n⚠ 工作区写入已冻结，尚不能绘图。\n'+session.execution.diagnosticSummary()+'\n/mcp barrier 查看历史屏障复核资格。';
    await session.store.save(session.state); return session;
  }
  get model() { return this.config.profiles.find(profile => profile.id === this.state.model)!; }
  context() {
    const active = this.state.messages.slice(this.state.contextFrom);
    const chars = this.state.summary.length + active.reduce((sum, message) => sum + message.content.length, 0);
    return { session: this.state.id, turns: this.state.messages.filter(message => message.role === 'user').length,
      activeMessages: active.length, estimatedTextTokens: Math.ceil(chars / 4), estimateOnly: true,
      excludesImageAndToolTokens: true, lastProviderUsage: this.lastUsage, references: this.state.references.length };
  }
  async reference(path: string) {
    const extension = extname(path).toLowerCase();
    if(['.png','.jpg','.jpeg'].includes(extension)){
      const ref=await importReferenceImage(this.state.workspace,path);
      this.state.references=this.state.references.filter(value=>value.kind!=='image');
      this.state.references.push(ref);await this.store.save(this.state);return ref;
    }
    const full = await workspacePath(this.state.workspace, path);
    const info = await stat(full); if (!info.isFile() || info.size > 64 * 1024 * 1024 || info.size === 0) throw new Error('REFERENCE_SIZE_OR_TYPE');
    let ref: ChatSession['references'][number];
    if (extension === '.dwg') {
      const data = await readFile(full); if (!/^AC10\d\d/.test(data.subarray(0, 6).toString('ascii'))) throw new Error('DWG_HEADER_INVALID');
      ref = { path: full, kind: 'drawing', sha256: hash(data), bytes: data.length };
    } else throw new Error('REFERENCE_FORMAT_UNSUPPORTED');
    this.state.references = this.state.references.filter(value => value.path !== full);
    if (this.state.references.length >= 20) throw new Error('REFERENCE_LIMIT');
    this.state.references.push(ref); await this.store.save(this.state); return ref;
  }
  async mcpProbe(tools = false) {
    if (!this.state.mcp) return 'MCP 未选择。使用 /mcp list 或 /mcp use <配置路径>。';
    const status = await this.execution.status();
    if (!status.connected) await this.execution.connect(this.state.mcp);
    return this.clean(JSON.stringify(tools ? { tools: this.execution.definitions().map(tool => tool.name) } : await this.execution.status(), null, 2));
  }
  async complete(line: string): Promise<string[]> {
    if (line.startsWith('/') && !line.includes(' ')) return SLASH_COMMANDS.map(([name]) => name).filter(name => name.startsWith(line));
    const match = line.match(/(?:^|\s)@(?:"([^"]*)|([^\s"]*))$/) ?? line.match(/^\/(?:open|cd)\s+(?:"([^"]*)|([^\s"]*))$/);
    if (!match) return [];
    const prefix = match[1] ?? match[2]!, quoted = match[1] !== undefined;
    const index = Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('\\'));
    const parent = prefix.slice(0, index + 1), leaf = prefix.slice(index + 1);
    try {
      const directory = await workspacePath(this.state.workspace, parent || '.');
      return (await readdir(directory, { withFileTypes: true })).filter(entry => entry.name.startsWith(leaf) && terminalText(entry.name) === entry.name).slice(0, 30)
        .map(entry => {
          let base = line.slice(0, line.length - prefix.length); if (quoted) base = base.slice(0, -1);
          const path = parent + entry.name + (entry.isDirectory() ? '/' : '');
          return base + (quoted || /\s/.test(path) ? '"' + path + (entry.isDirectory() ? '' : '"') : path);
        });
    } catch { return []; }
  }
  async execute(line: string, callbacks: ChatCallbacks = {}): Promise<ChatReply> {
    if (this.active) return { text: '当前任务运行中，按 Esc 中断。', error: true };
    this.active = true;
    try { return await this.dispatch(line.trim(), callbacks); }
    finally { this.active = false; }
  }
  private async dispatch(line: string, callbacks: ChatCallbacks): Promise<ChatReply> {
    if (!line) return { text: '' };
    if(/^(?:为什么(?:会)?(?:阻塞|冻结)(?:了)?|为何(?:阻塞|冻结)|查看冻结原因)[？?。！!]*$/.test(line)){
      await this.store.event(this.state,{kind:'cad-diagnostic',frozen:this.execution.facts().frozen});
      return {text:this.execution.diagnosticSummary()};
    }
    if(/^(?:恢复|恢复核对)[？?。！!]*$/.test(line)){
      const result=await this.execution.recover();
      return {text:`${result.recovered?'已完成原连接只读对账，未重放。':'未恢复：'+('reason' in result?result.reason:result.recovery.reason)+'。'}\n${this.execution.diagnosticSummary()}`,error:!result.recovered};
    }
    if (line.startsWith('!')) {
      const command = line.slice(1).trim();
      const command_sha256 = hash(Buffer.from(command, 'utf8'));
      if (this.state.shell === 'deny' || !await callbacks.confirm?.(this.clean(command), this.state.workspace)) {
        await this.store.event(this.state, { kind: 'user-shell', command_sha256, status: 'denied' });
        return { text: 'Shell 未获批准，未执行。', error: true };
      }
      await this.store.event(this.state, { kind: 'user-shell', command_sha256, cwd: this.state.workspace, status: 'prepared' });
      const result = await runUserShell(command, this.state.workspace, callbacks.signal);
      await this.store.event(this.state, { kind: 'user-shell', command_sha256, status: 'completed', code: result.code,
        cancelled: result.cancelled, timedOut: result.timedOut, capped: result.capped });
      // Shell output is deliberately absent from the conversation and session context.
      return { text: this.clean(`${result.output}\nShell exit=${result.code}${result.cancelled ? ' · 已取消，可能存在已发生的副作用，不自动重跑' : ''}${result.timedOut ? ' · 超时' : ''}${result.capped ? ' · 输出达到64KiB上限' : ''}`),
        error: result.code !== 0 || result.cancelled || result.timedOut || result.capped };
    }
    if(this.state.qualityRun&&/^(?:我)?(?:已|已经).*(?:人工|检查|查看|复核).*(?:没有问题|没问题|验收通过|确认符合)/.test(line))return this.dispatch('/quality accept '+line,callbacks);
    if (line.startsWith('/')) {
      const match = line.match(/^(\S+)(?:\s+([\s\S]*))?$/)!;
      const name = match[1]!, arg = (match[2] ?? '').trim().replace(/^"(.*)"$/, '$1');
      if (!SLASH_COMMANDS.some(([known]) => known === name)) return { text: `未知命令 ${this.clean(name)}。使用 /help。`, error: true };
      switch (name) {
        case '/quality':{
          if(!this.state.qualityRun)return {text:'当前没有质量任务。复杂绘图会自动建立质量清单。'};
          const path=await workspacePath(this.state.workspace,this.state.qualityRun);
          if((await stat(path)).size>16_000_000)throw new Error('QUALITY_MANIFEST_TOO_LARGE');
          const saved=JSON.parse(await readFile(path,'utf8'));
          const userReview=await userReviewStatus(this.state.workspace,path,this.state.qualityReview);
          if(!arg)return {text:this.clean(JSON.stringify({...qualityTaskContext(saved),acceptance:userReview.accepted?'accepted_by_user':qualityTaskContext(saved).acceptance,user_review:userReview,path},null,2))};
          if(arg==='accept'||arg.startsWith('accept ')){
            if(userReview.accepted)return {text:'该DWG已由用户人工验收，文件与证据摘要仍匹配。'};
            this.state.qualityReview=await acceptQualityByUser(this.state.workspace,path,this.execution,callbacks.review??callbacks.confirm,arg.slice(6).trim()||undefined);
            await this.store.event(this.state,{kind:'quality-user-acceptance',review:this.state.qualityReview});await this.store.save(this.state);callbacks.onEvent?.({type:'task.user_review_completed',acceptance:'accepted_by_user',review:this.state.qualityReview});
            return {text:'本任务DWG已记录为用户人工验收通过；原自动视觉结果保留。此确认仅绑定该文件，不解除屏障、不授予继续写入权限。'};
          }
          if(userReview.accepted)return {text:'该文件已人工验收；若需要修改请明确提出新需求，原确认不授予续写权限。'};
          if(arg!=='resume')return {text:'/quality /quality resume /quality accept [复核说明]',error:true};
          if(saved.phase==='complete')return {text:'该任务已验收，无需重放。'};
          return this.converse(saved.original_request,callbacks,saved as QualityResume);
        }
        case '/help': return { text: SLASH_COMMANDS.map(([key, description]) => `${key.padEnd(15)} ${description}`).join('\n')
          + '\n\n自然语言持续对话 · @"路径含空格.png" 引用 · !dir 用户Shell\n“每次绘图都做视觉检查”保存会话偏好；“是否使用了视觉验证？”读取历史证据；“继续”安全重验当前质量任务。\nEsc/Ctrl+C 中断当前任务 · Tab 补全 · 上下键历史 · Ctrl+D 或 /exit 退出\n/quality显示实际DWG路径与文件交付状态；新COM交付在artifact-*目录，验收只读图不授予写权。\n/open DWG仅引用元数据，后端尚无任意DWG受控打开接口；/undo同样按能力拒绝。' };
        case '/exit': await this.store.save(this.state); await this.dispose(); return { text: `会话已保存：${this.state.id}`, exit: true };
        case '/context': return { text: JSON.stringify(this.context(), null, 2) };
        case '/status': return { text: `工作目录 ${this.state.workspace}\n模型 ${this.model.model} (${this.state.model})\nCAD 权限 ${this.state.permission}\n${await this.mcpProbe()}` };
        case '/cd': {
          if (!arg) return { text: this.state.workspace };
          const next = await realpath(resolve(this.state.workspace, arg)); if (!(await stat(next)).isDirectory()) throw new Error('NOT_A_DIRECTORY');
          await this.dispose(); this.execution = new ExecutionSession(next, join(next, '.cader/runs', `execution-${randomUUID()}`), this.clean);
          this.state.workspace = next; this.state.references = []; this.state.redrawTask=null; this.state.pendingRedrawRequest=null; await this.store.save(this.state);
          return { text: `工作目录 ${next}\n附件授权已清空；父Shell目录不变。` };
        }
        case '/model': {
          if (!arg) return { text: this.config.profiles.map(profile => `${profile.id === this.state.model ? '●' : '○'} ${profile.id}  ${profile.model}  ${profile.input.join('/')}`).join('\n') + '\n/model <配置ID> 切换主会话使用的模型，不改变子Agent权限。' };
          const profile = this.config.profiles.find(value => value.id === arg || value.model === arg);
          if (!profile) throw new Error('MODEL_NOT_CONFIGURED');
          this.state.model = profile.id; await this.store.save(this.state); return { text: `当前模型 ${profile.model} (${profile.id})` };
        }
        case '/domain': {
          if (!arg) return { text: this.domains.map(domain => `${domain.id === this.state.domain ? '●' : '○'} ${domain.id}  ${domain.label}`).join('\n') };
          if (!this.domains.some(domain => domain.id === arg)) throw new Error('DOMAIN_NOT_CONFIGURED');
          this.state.domain = arg; await this.store.save(this.state); return { text: `专业 ${arg}；工具与写权限未扩大。` };
        }
        case '/skills': {
          const registry = await loadSkills(this.configRoot);
          if (!arg || arg === 'list') return { text: registry.list('main').map(skill => `${skill.name === this.state.skill ? '●' : '○'} ${skill.name}  ${skill.description}`).join('\n') + '\n/skills use <名称> 选择预加载；/skills off 取消预加载。' };
          if (arg === 'off') this.state.skill = null;
          else { const chosen = arg.replace(/^use\s+/, ''); await registry.read(chosen, 'main'); this.state.skill = chosen; }
          await this.store.save(this.state); return { text: `预加载Skill ${this.state.skill ?? '无'}（角色可见目录仍可按需加载）` };
        }
        case '/mcp': {
          if (!arg || arg === 'list') return { text: (await readdir(join(this.configRoot, 'configs/mcp'))).filter(file => /\.(yaml|json)$/.test(file)).join('\n') + `\n当前 ${this.state.mcp ?? '未选择'}\n/mcp use <配置路径> 选择；/mcp tools 发现；/mcp off 禁用连接。` };
          if (arg === 'tools') return { text: await this.mcpProbe(true) };
          if (arg === 'doctor') return { text: this.clean(JSON.stringify(await this.execution.probe(), null, 2)) };
          if (arg === 'recover') {const result=await this.execution.recover();return {text:this.clean(JSON.stringify(result,null,2)),error:!result.recovered};}
          if(arg==='barrier'||arg==='resolve'){
            if(!this.state.mcp)return {text:'先用 /mcp use <配置> 选择原服务，以便核对当前工具schema。',error:true};
            if(!(await this.execution.status()).connected)await this.execution.connect(this.state.mcp);
            if(arg==='barrier')return {text:this.clean(JSON.stringify(await this.execution.reviewLegacyBarrier(),null,2))};
            const result=await this.execution.resolveLegacyBarrier(callbacks.confirm);
            if(result.resolved){this.state.qualityRun=null;await this.store.save(this.state);}
            return {text:this.clean(JSON.stringify(result,null,2))+'\n'+(result.resolved?'历史屏障经用户审定已归档；旧图未接管，请重新发送新绘图任务，新任务必须新建工作图。':'屏障保留。需要证据一致且用户明确确认；真正未知结果不能通过此入口解除。'),error:!result.resolved};
          }
          await this.dispose();
          if (arg === 'off') this.state.mcp = null;
          else { const selected = arg.replace(/^use\s+/, ''); const path = await workspacePath(this.configRoot, /[\\/]/.test(selected) ? selected : join('configs/mcp', selected)); await loadMcp(path); this.state.mcp = path; }
          await this.store.save(this.state); return { text: `MCP ${this.state.mcp ?? '已禁用'}；连接在任务/状态探测时建立。` };
        }
        case '/permissions': {
          if (arg === 'shell ask' || arg === 'shell deny') { this.state.shell = arg.endsWith('ask') ? 'ask' : 'deny'; await this.store.save(this.state); }
          else if (PERMISSION_MODES.includes(arg as PermissionMode)) { this.state.permission = arg as PermissionMode; await this.store.save(this.state); }
          else if (arg) return { text: '支持 /permissions read-only|ask|workspace-write|full-access 或 shell ask|deny。', error: true };
          return { text: `执行权限 ${this.state.permission} · Shell ${this.state.shell}\nCAD写入仅绑定本连接新建的工作图。Agent Shell有效策略：${this.state.shell === 'deny' ? 'deny（优先于full-access）' : this.state.permission === 'read-only' ? 'deny' : this.state.permission === 'full-access' ? 'automatic' : 'ask'}。` };
        }
        case '/open': {
          if (!arg) return { text: '/open <本地JPG/PNG或工作区DWG路径>', error: true };
          const ref = await this.reference(arg);
          return { text: `已选择 ${basename(arg)} · ${ref.bytes} bytes · SHA256 ${ref.sha256}\n`
            + (ref.kind === 'image' ? '下轮作为授权原图发送给视觉模型。' : 'CAD_OPEN_UNAVAILABLE：已登记DWG元数据引用，尚未在AutoCAD中打开；当前MCP无任意DWG受控打开接口。'), error: ref.kind === 'drawing' };
        }
        case '/undo': return { text: 'CAD_UNDO_UNAVAILABLE：当前会话未执行CAD写入，现有公共契约无受控撤销接口；未发送逆操作。', error: true };
        case '/checkpoint': {
          const id = `checkpoint-${randomUUID()}`;
          await writeFile(join(await privateDirectory(this.configRoot, 'checkpoints'), id + '.json'), this.clean(JSON.stringify({
            version: 1, id, kind: 'conversation-and-reference-manifest', cadSnapshot: false, session: this.state }, null, 2)), { flag: 'wx', mode: 0o600 });
          return { text: `${id}\n已保存会话、工作目录和引用哈希；不含DWG数据库快照或工程文件恢复。` };
        }
        case '/clear': {
          await this.store.save(this.state); const prior = this.state;
          await this.dispose();
          this.state = { ...newSession(prior.workspace, prior.model), domain: prior.domain, mcp: prior.mcp, skill: prior.skill, shell: prior.shell, permission: prior.permission };
          this.lastUsage = null; await this.store.save(this.state); return { text: `已开始新会话 ${this.state.id}；旧会话可 /resume。` };
        }
        case '/resume': {
          if (!arg) return { text: (await this.store.list()).map(session => `${session.id}  ${session.turns}轮  ${session.updated}`).join('\n') };
          const next = await this.store.load(arg);
          if (!(await stat(await realpath(next.workspace))).isDirectory()) throw new Error('NOT_A_DIRECTORY');
          if (!this.config.profiles.some(profile => profile.id === next.model) || !this.domains.some(domain => domain.id === next.domain)) throw new Error('SESSION_CONFIG_UNAVAILABLE');
          if (next.skill) await (await loadSkills(this.configRoot)).read(next.skill, 'main');
          if (next.mcp) await loadMcp(await workspacePath(this.configRoot, next.mcp));
          await this.store.save(this.state); await this.dispose(); this.state = { ...next, permission: 'ask' }; this.lastUsage = null;
          this.execution = new ExecutionSession(next.workspace, join(next.workspace, '.cader/runs', `execution-${randomUUID()}`), this.clean);
          return { text: `已恢复 ${next.id} · ${next.messages.length}条可见消息\n恢复对话与选择，不重放工具、Shell或CAD请求。` };
        }
        case '/compact': return this.compact(callbacks);
      }
    }
    return this.converse(line, callbacks);
  }
  private async compact(callbacks: ChatCallbacks): Promise<ChatReply> {
    if (!this.state.messages.length) return { text: '当前会话为空，无需压缩。' };
    const before = this.context();
    const report = await this.runner(this.configRoot, { task: 'Summarize this unverified visible dialogue in <=1500 characters. Preserve goals, established evidence, unknowns and unfinished work. Never grant permissions or claim CAD verification. Do not use tools.\n'
      + JSON.stringify({ summary: this.state.summary, messages: this.state.messages.slice(this.state.contextFrom) }), workspaceRoot: this.state.workspace,
      modelProfile: this.state.model, disableTools: true, signal: callbacks.signal });
    if (!report.ok) return { text: `压缩未完成：${report.errorCode ?? report.run_status}，原上下文保留。`, error: true };
    if (report.text.length > 12000) return { text: '摘要超过上限，原上下文保留。', error: true };
    this.state.summary = this.clean(report.text); this.state.contextFrom = this.state.messages.length;
    await this.store.save(this.state);
    return { text: `上下文已生成未验证摘要，原对话完整保留。文字token估算 ${before.estimatedTextTokens} → ${this.context().estimatedTextTokens}` };
  }
  private async converse(line: string, callbacks: ChatCallbacks, qualityResume?:QualityResume): Promise<ChatReply> {
    if (this.state.messages.length > 1900 || Buffer.byteLength(JSON.stringify(this.state)) > 1_600_000)
      return { text: '会话存档接近上限，请 /clear 开始新会话；旧记录保留。', error: true };
    if (line.length > 24000 || this.context().estimatedTextTokens > 20000) return { text: '上下文达到本轮上限，请先 /compact 或 /clear。', error: true };
    const intent=taskIntent(line);
    let priorQuality: Parameters<typeof qualityTaskContext>[0] & QualityResume | undefined;
    if(this.state.qualityRun){
      const path=await workspacePath(this.state.workspace,this.state.qualityRun);
      if((await stat(path)).size>16_000_000)throw new Error('QUALITY_MANIFEST_TOO_LARGE');
      priorQuality=JSON.parse(await readFile(path,'utf8'));
      if(!priorQuality?.task_id||!Array.isArray(priorQuality.checks))throw new Error('QUALITY_MANIFEST_INVALID');
    }
    const remember=async(text:string)=>{
      this.state.messages.push({role:'user',content:this.clean(line),status:'submitted',at:new Date().toISOString()},
        {role:'assistant',content:this.clean(text),status:'succeeded',at:new Date().toISOString()});
      await this.store.event(this.state,{kind:'task-routing',intent,visual_policy:this.state.visualPolicy});
      await this.store.save(this.state);return {text};
    };
    if(intent==='preference'){
      const negative=/不要|不再|无需|关闭|停止|never|disable/i.test(line);
      const automatic=/按需|复杂任务|自动判断|必要时|\bauto\b/i.test(line)&&!/每次|始终|\balways\b/i.test(line);
      if(!negative)this.state.visualPolicy=automatic?'auto':'always';
      return remember(negative?'质量验收不能通过规则说明关闭。现有检查策略保留；未创建绘图任务、未调用CAD。':`已记录：${automatic?'按任务复杂度自动检查，必要视觉验收仍强制执行':'本会话后续绘图均要求视觉检查'}，恢复会话后仍保留。主Agent可主动调用，遗漏时Harness补验；未创建绘图任务、未调用CAD。`);
    }
    if(intent==='status'&&/视觉|vision/i.test(line)&&/是否|有没有|几次|多少|结果|状态|之前|此前|做过|用过|调用过|使用过|检查过|验证过|校验过|了吗|have you|did you|status/i.test(line)){
      const userReview=priorQuality?await userReviewStatus(this.state.workspace,this.state.qualityRun!,this.state.qualityReview):null;
      return remember(priorQuality?`当前任务视觉模型请求 ${qualityTaskContext(priorQuality).visual_call_count} 次，截图尝试 ${qualityTaskContext(priorQuality).capture_attempt_count} 次。以下为已保存的任务证据，不代表当前图纸的实时状态：\n${JSON.stringify({...qualityTaskContext(priorQuality),acceptance:userReview?.accepted?'accepted_by_user':qualityTaskContext(priorQuality).acceptance,user_review:userReview},null,2)}`:'当前会话没有已记录的质量任务；不能据此判断其他会话是否执行过视觉检查。');
    }
    if(intent==='continue'&&priorQuality&&(await userReviewStatus(this.state.workspace,this.state.qualityRun!,this.state.qualityReview)).accepted)return remember('本任务DWG已人工验收，文件和证据仍匹配；未重放绘图。修改请提出明确新需求。');
    if(intent==='continue'&&!this.state.redrawTask&&priorQuality){
      if(priorQuality.phase==='complete')return remember('当前任务已验收通过，未重复绘图。请明确描述新的绘图需求。');
      if(!priorQuality.plan)return remember('当前任务尚未建立有效验收计划，请重新发送完整绘图需求；未重放CAD操作。');
      qualityResume=priorQuality;line=priorQuality.original_request;
    }
    const explicit=[...new Set([...line.matchAll(/(?:^|\s)@(?:"([^"]+)"|([^\s]+))/g)].map(match=>match[1]??match[2]!).concat(referencedPaths(line)))];
    const references=explicit;
    for (const path of references) await this.reference(path);
    for (const ref of this.state.references) {
      const path = await workspacePath(this.state.workspace, ref.path);
      if (hash(await readFile(path)) !== ref.sha256) throw new Error('REFERENCE_CHANGED_RESELECT_REQUIRED');
    }
    const image = this.state.references.find(ref => ref.kind === 'image');
    if (image && !this.model.input.includes('image')) throw new Error('MODEL_IMAGE_UNSUPPORTED');
    const pathOnly=explicit.length>0&&explicit.reduce((text,path)=>text.replaceAll(path,''),line).replace(/[@"“”\s，。:：]/g,'')==='';
    if(pathOnly&&this.state.pendingRedrawRequest)line=this.state.pendingRedrawRequest;
    if(pathOnly&&!this.state.pendingRedrawRequest&&!this.state.redrawTask)
      return {text:'参考图已读入并注册为视觉输入。请描述绘图任务；例如“根据参考图新建空白图纸重绘并保存为 result.dwg”。'};
    const continuation=/^(?:继续|继续绘制|继续重绘|继续这个任务|开始|开始绘制|重试|continue|resume)[。！!？?]*$/i.test(line)||pathOnly;
    if(image&&this.state.pendingRedrawRequest&&continuation)line=this.state.pendingRedrawRequest;
    let referenceTask=this.state.redrawTask;
    if(referenceTask&&continuation){
      if(image&&image.sha256!==referenceTask.image.sha256)return {text:'参考图已更换，旧重绘任务不会自动重放或修改。请明确发送新的重绘需求和DWG目标；新任务将新建工作图。',error:true};
      else{
        line=referenceTask.request;
        if(!qualityResume&&referenceTask.qualityRun){
          const saved=JSON.parse(await readFile(await workspacePath(this.state.workspace,referenceTask.qualityRun),'utf8'));
          if(saved.phase==='complete')return {text:`该重绘任务已完成，DWG：${saved.artifact?.path??saved.execution?.artifact?.path??referenceTask.outputPath}；未重复绘图。`};
          if(saved.plan)qualityResume=saved;
        }
      }
    }
    if(!image&&wantsRedraw(line)&&/复现|重绘|临摹|手稿|参考图|图片|照片|按图|这张图|\bredraw\b|\btrace\b|\breproduce\b|\brecreate\b/i.test(line)){
      this.state.pendingRedrawRequest=line;await this.store.save(this.state);
      return {text:'重绘任务已保留，尚未收到参考图。请直接粘贴本地JPG/PNG路径，或用 /open <路径> 后输入“继续”；不需要拖入GUI附件。',error:true};
    }
    if(image&&wantsRedraw(line)){
      if(!referenceTask||!continuation&&!qualityResume){
        referenceTask={request:line,image:{path:image.path,sha256:image.sha256,width:image.width!,height:image.height!},
          outputPath:referenceOutput(this.state.workspace,line,explicit[0]??image.path),freshDrawing:true,qualityRun:null};
      }
      this.state.redrawTask=referenceTask;this.state.pendingRedrawRequest=null;
    }else referenceTask=null;
    const history = this.state.messages.slice(this.state.contextFrom).map(({ role, content, status }) => ({ role, content, status }));
    const content = this.clean(line), userIndex = this.state.messages.length;
    this.state.messages.push({ role: 'user', content, status: 'submitted', at: new Date().toISOString() }); await this.store.save(this.state);
    if (this.state.mcp && !this.execution.facts().frozen && !(await this.execution.status()).connected) await this.execution.connect(this.state.mcp);
    this.execution.mode = this.state.permission;
    const executionMark = this.execution.mark();
    const report = await this.runner(this.configRoot, { task: content + '\nAuthorized reference metadata (DWG content is NOT decoded):\n'
      + JSON.stringify(this.state.references.map(ref => ({ ...ref, path: relative(this.state.workspace, ref.path) }))),
      workspaceRoot: this.state.workspace, modelProfile: this.state.model,
      executionTools: [...this.execution.definitions(callbacks.confirm), ...this.execution.controlTools(), ...this.execution.fileTools(callbacks.confirm).filter(tool => this.state.shell !== 'deny' || tool.name !== 'cader_shell')],
      executionState: () => this.execution.facts(executionMark), toolAvailable: name => this.execution.toolAvailable(name),
      captureCadView: this.state.mcp ? (signal,view) => this.execution.captureView(signal, callbacks.confirm,view) : undefined,
      permissionMode: this.state.permission,
      executionOwner:this.execution,confirmTask:callbacks.confirm,originalTask:content,
      qualityResume,referenceTask:referenceTask??undefined,
      taskState:()=>priorQuality?qualityTaskContext(priorQuality):null,alwaysVisual:this.state.visualPolicy==='always',
      executionAuditDirectory: this.execution.runDirectory,
      skill: this.state.skill ?? undefined, image: image?.path, history, summary: this.state.summary,
      domain: this.domains.find(domain => domain.id === this.state.domain)!.instruction,
      signal: callbacks.signal, onEvent: event => { if (event.type === 'model.usage' && event.role === 'main') this.lastUsage = event.usage; callbacks.onEvent?.(event); } });
    this.state.messages[userIndex]!.status = report.run_status;
    if(report.quality){this.state.qualityRun=join(report.runDirectory,'quality.json');this.state.qualityReview=null;}

    if(referenceTask&&report.quality)this.state.redrawTask={...referenceTask,qualityRun:join(report.runDirectory,'quality.json')};
    this.state.messages.push({ role: 'assistant', content: this.clean(report.text || (report.run_status === 'cancelled' ? '[已取消，未形成完整结论]' : `[失败 ${report.errorCode ?? 'UNKNOWN'}]`)),
      status: report.run_status, at: new Date().toISOString() });
    await this.store.save(this.state);
    let reviewNote='';
    if(report.quality?.phase==='pending_verification'&&!this.execution.facts().frozen){
      try{
        const candidate=await userReviewCandidate(this.state.workspace,this.state.qualityRun!);
        callbacks.onEvent?.({type:'task.user_review_required',...candidate});
        reviewNote='\n需要用户复核上述DWG及未决视觉条件；实际检查后可使用 /quality accept [复核说明]，文件变化会使确认失效。';
        if(callbacks.review){
          try{this.state.qualityReview=await acceptQualityByUser(this.state.workspace,this.state.qualityRun!,this.execution,callbacks.review);await this.store.event(this.state,{kind:'quality-user-acceptance',review:this.state.qualityReview});await this.store.save(this.state);callbacks.onEvent?.({type:'task.user_review_completed',acceptance:'accepted_by_user',review:this.state.qualityReview});
            return {text:'本任务DWG经用户人工复核通过。原自动视觉结论保留，确认仅绑定该交付文件，不授予续写或解除屏障。',error:false};
          }catch(error){if((error as Error).message!=='HUMAN_REVIEW_NOT_CONFIRMED')reviewNote+='\n人工确认未记录：'+(error as Error).message;}
        }
      }catch{/* Structural/source/unknown failures remain program-blocked, not a manual visual override. */}
    }
    const facts=this.execution.facts(executionMark),counts=facts.counts,total=facts.session_counts;
    const status=!report.ok?this.clean(`${report.errorCode ?? report.blocked_reasons[0] ?? report.run_status}: ${report.hint ?? (report.blocked_reasons.includes('CAD_WRITE_FROZEN') ? `程序写屏障仍有效；自动恢复资格：${facts.recovery.eligible?'可对账':'不具备'}（${facts.recovery.reason}）。受控查询仍可用，重连/重启不能解除。` : report.blocked_reasons.join(', '))}`):'';
    return {text:this.clean(report.text)+(status?'\n'+status:'')+reviewNote,afterStream:status+reviewNote,error:!report.ok,
      note:`${this.state.permission} · CAD ${facts.write_state} · 本轮确认 ${counts.committed} / 未知 ${counts.unknown} / 未派发阻断 ${counts.blocked_not_dispatched} · 会话确认 ${total.committed} / 未知 ${total.unknown}${facts.file_counts?` · 文件复核确认 ${facts.file_counts.committed} / 未知 ${facts.file_counts.unknown}`:''} · 模型回复不等于独立验收`};
  }
  async dispose() { await this.execution.dispose(); }
}
