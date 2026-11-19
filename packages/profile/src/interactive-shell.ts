import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';

/** User-entered bang commands only. This service is never a model tool. */
export async function runUserShell(command: string, cwd: string, signal?: AbortSignal) {
  if (!command.trim() || command.length > 8000 || /[\0\r\n]/.test(command)) throw new Error('SHELL_COMMAND_INVALID');
  cwd = await realpath(cwd);
  signal?.throwIfAborted();
  const windows = process.platform === 'win32';
  const args = windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding;\n' + command] : ['-c', command];
  const child = spawn(windows ? 'powershell.exe' : '/bin/sh', args,
    { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: !windows });
  let output = '', bytes = 0, timedOut = false, capped = false, cancelled = false, stopping = false;
  const stop = () => {
    if (child.exitCode !== null || !child.pid || stopping) return;
    stopping = true;
    if (windows) {
      // Target only this owned shell tree, never enumerate and kill unrelated processes.
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill());
    } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
  };
  const abort = () => { cancelled = true; stop(); };
  const timer = setTimeout(() => { timedOut = true; stop(); }, 30000);
  const collect = (chunk: string) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 65536) { capped = true; stop(); return; }
    output += chunk;
  };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
    return { code, output, cancelled, timedOut, capped };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
