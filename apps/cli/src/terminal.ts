import { createInterface } from 'node:readline';
import { basename, resolve, dirname, parse } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { InteractiveSession, SafeTextStream, terminalText, failureFromError, replyTextAfterStreaming, toolResultLine } from '@cader/profile';

export function findConfigRoot(workspace: string) {
  let path = resolve(workspace);
  while (true) {
    if (existsSync(resolve(path, 'configs/runtime.yaml'))) return path;
    if (path === parse(path).root) break;
    path = dirname(path);
  }
  const bundled = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  if (existsSync(resolve(bundled, 'configs/runtime.yaml'))) return bundled;
  throw new Error('CADER_CONFIG_ROOT_NOT_FOUND');
}
export async function runTerminal(options: { workspace?: string; stdio?: boolean } = {}) {
  const input = process.stdin, output = process.stdout;
  const priorRawMode = Boolean(input.isRaw);
  const tty = Boolean(input.isTTY && output.isTTY && !options.stdio);
  const workspace = resolve(options.workspace ?? process.cwd());
  const root = findConfigRoot(workspace);
  try { process.loadEnvFile(resolve(root, '.env')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('INVALID_ENV_FILE'); }
  const session = await InteractiveSession.create(root, workspace);
  const color = tty && (process.env.FORCE_COLOR ? process.env.FORCE_COLOR !== '0' : !process.env.NO_COLOR);
  const paint = (code: string, value: string) => color ? `\x1b[${code}m${value}\x1b[0m` : value;
  const write = (text: string) => output.write(session.clean(text));
  output.write('\n' + [
    '   ██████╗ █████╗ ██████╗ ███████╗██████╗ ',
    '  ██╔════╝██╔══██╗██╔══██╗██╔════╝██╔══██╗',
    '  ██║     ███████║██║  ██║█████╗  ██████╔╝',
    '  ██║     ██╔══██║██║  ██║██╔══╝  ██╔══██╗',
    '  ╚██████╗██║  ██║██████╔╝███████╗██║  ██║',
    '   ╚═════╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝',
  ].map((line, index) => paint(index < 3 ? '1;36' : '1;34', line)).join('\n') + '\n');
  output.write(paint('1', '  Cader 0.4.0-dev.12') + '  ·  DeepSeek Harness  ·  CAD terminal\n'
    + paint('2;36', '─'.repeat(Math.max(20, Math.min((output.columns ?? 80) - 2, 90)))) + '\n');
  write(`  ${session.model.model} · ${session.state.permission} · ${basename(workspace)}\n  ${session.startupStatus}\n  /help 命令  ·  @图片/图纸  ·  !Shell  ·  Tab 补全  ·  Esc 中断\n\n`);
  if (tty && process.env.TERM === 'dumb') write('当前终端声明TERM=dumb，使用简化输入。支持VT的终端可设置TERM=xterm-256color以启用完整编辑/补全。\n');
  const rl = createInterface({ input, output, terminal: tty, historySize: 100, removeHistoryDuplicates: true,
    completer: (line: string, callback: (error: Error | null, result: [string[], string]) => void) => {
      void session.complete(line).then(matches => callback(null, [matches, line]), () => callback(null, [[], line]));
    } });
  if (tty) input.setRawMode(true);
  let active: AbortController | undefined, busy = false, closed = false, eof = false;
  const queue: string[] = [];
  let confirmation: ((answer: boolean) => void) | undefined;
  let settle: (() => void) | undefined;
  const done = new Promise<void>(resolve => { settle = resolve; });
  const prompt = () => {
    if (tty && !busy && !closed && !eof) { input.setRawMode(true); rl.setPrompt(paint('1;36', `cader [${session.state.domain}] › `)); rl.prompt(); }
  };
  const stop = () => {
    if (active) { active.abort(); queue.length = 0; confirmation?.(false); confirmation = undefined; write('\n已请求中断，等待运行时清理；不会重放请求。\n'); }
    else { closed = true; rl.close(); settle?.(); }
  };
  const clearInput = () => { rl.write(null, { ctrl: true, name: 'u' }); rl.write(null, { ctrl: true, name: 'k' }); };
  const keypress = (_text: string, key: { name?: string }) => {
    if (key?.name === 'escape') {
      if (active) stop(); else { clearInput(); prompt(); }
    }
  };
  if (tty) input.on('keypress', keypress);
  rl.on('SIGINT', stop);
  const terminate = () => { closed = true; queue.length = 0; if (active) stop(); else { rl.close(); settle?.(); } };
  process.on('SIGINT', stop); process.on('SIGTERM', terminate);
  const resize = () => { if (!busy) rl.prompt(true); };
  if (tty) output.on('resize', resize);
  const confirm = async (command: string, cwd: string) => {
    if (!tty || active?.signal.aborted) return false;
    queue.length = 0; // Never consume pasted/type-ahead text as a permission decision or a later model task.
    write(command.startsWith('人工审定历史参数拒绝')
      ? `\n历史屏障复核 · ${cwd}\n${command}\n确认以上事实并批准归档？[y/N] `
      : `\n工具审批 · ${cwd}\n${command}\nAgent工具结果会返回模型；Shell以本机账号执行（非沙箱）。允许本次执行？[y/N] `);
    return new Promise<boolean>(resolve => { confirmation = resolve; });
  };
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length && !closed) {
      const line = queue.shift()!; active = new AbortController(); let streamed = false;
      const stream = new SafeTextStream(session.secrets, chunk => { streamed = true; output.write(chunk); });
      try {
        if (!line.startsWith('/') && !line.startsWith('!') && line.trim()) write('\nCader · 正在处理（Esc 中断）\n');
        const reply = await session.execute(line, { signal: active.signal, confirm, onEvent: event => {
          if (event.type === 'assistant.delta' && event.role === 'main') stream.push(String(event.text ?? ''));
          else if(event.type==='task.phase') write(`\n  阶段：${({reference:'读取手稿',planning:'规划',drawing:'绘制',geometry:'几何验证',topology:'拓扑验证',vision:event.has_reference?'源图对照验证':'视觉验证',correcting:'局部修正',saving:'保存DWG',complete:'验收完成',pending_verification:'待验证',blocked:'阻塞'} as Record<string,string>)[String(event.phase)]??String(event.phase)}\n`);
          else if(event.type==='task.visual') write(`\n  视觉检查 · ${event.source==='agent'?'Agent主动调用':'Harness验收'} · ${event.reused?'复用有效报告':`第${event.call_count}次`} · ${event.review_valid?String(event.verdict):'报告无效，待验证'}\n`);
          else if(event.type==='task.planning_retry')write('\n  规划输出被截断，正在进行一次紧凑重试（尚未绘图）。\n');
          else if(event.type==='task.output_retry')write(`\n  模型响应中断（${String(event.reason)}） · 已核对账本及图纸 · 短批续跑 ${event.attempt}/2（不重放已确认操作）。\n`);
          else if(event.type==='task.drawing_unit')write(`\n  绘图进度：${String(event.unit_id)} 已读回登记，整图尚待验收。\n`);
          else if(event.type==='task.checkpoint')write(`\n  预算检查点 · 第${event.execution_round}回合 · ${event.continuing?'已读回并保存进度，自动续轮':'已保存进度，任务总限额暂停'} · ${String(event.document??'尚未新建图纸')}\n`);
          else if(event.type==='task.review_handoff')write('\n  视觉或读回异常，已交回调度器；当前图纸尚未通过验收。\n');
          else if (event.type === 'tool.result') {
            write(toolResultLine(event));
          }
          else if (event.type === 'agent.started' && event.role !== 'main') write(`\n  ↳ 子任务 ${String(event.role)}\n`);
        } });
        stream.finish();
        write(replyTextAfterStreaming(reply,streamed));
        if (reply.note) output.write('\n' + paint('2', reply.note));
        output.write('\n\n');
        if (reply.exit) { closed = true; queue.length = 0; }
      } catch (error) {
        stream.finish();
        const code = active.signal.aborted ? 'CANCELLED' : error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : failureFromError(error).errorCode;
        write(`\n操作未完成：${code}。检查路径、配置或 /help；会话仍可继续。\n\n`);
      } finally { active = undefined; confirmation = undefined; }
    }
    busy = false;
    if (closed || eof) { rl.close(); settle?.(); } else prompt();
  }
  rl.on('line', line => {
    if (confirmation) { const answer = confirmation; confirmation = undefined; answer(/^y(?:es)?$/i.test(line.trim())); return; }
    if (closed) return;
    queue.push(terminalText(line)); void pump();
  });
  rl.on('close', () => {
    eof = true; confirmation?.(false); confirmation = undefined;
    if (tty && busy) { closed = true; queue.length = 0; active?.abort(); }
    if (!busy && !queue.length) settle?.();
  });
  prompt();
  try { await done; await session.store.save(session.state); }
  finally {
    await session.dispose();
    rl.close(); input.removeListener('keypress', keypress); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', terminate);
    output.removeListener('resize', resize);
    if (tty) input.setRawMode(priorRawMode);
  }
}
