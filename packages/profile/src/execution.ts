import { mkdir, open, readFile, writeFile, unlink, lstat, readdir } from 'node:fs/promises';
import { resolve, relative, dirname, basename, extname, matchesGlob } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createMcpClient, defineTool } from '@cader/dsh-adapter';
import type { ToolDefinition } from '@cader/dsh-adapter';
import { loadMcp, workspacePath } from '@cader/config';
import { runUserShell } from './interactive-shell.js';

export type PermissionMode = 'read-only' | 'ask' | 'workspace-write' | 'full-access';
export const PERMISSION_MODES: PermissionMode[] = ['read-only', 'ask', 'workspace-write', 'full-access'];
const reads = new Set(['get_backend_status', 'list_layers', 'list_blocks', 'list_symbol_library', 'query_entities', 'query_entities_in_region', 'get_entity', 'get_block_attributes']);
const writes = new Set(['new_drawing', 'draw_line', 'draw_circle', 'draw_arc', 'draw_rectangle', 'draw_text', 'draw_polyline', 'draw_mtext', 'draw_hatch', 'add_dimension', 'create_layer', 'set_layer_properties', 'move_entity', 'rotate_entity', 'copy_entity', 'scale_entity', 'mirror_entity', 'delete_entity', 'save_drawing']);
export type Approval = (description: string, cwd: string) => Promise<boolean>;
type Client = Awaited<ReturnType<typeof createMcpClient>>;

/** One owner and one persistent MCP process per interactive workspace. COM retains its
 * scratch document binding; a new client must never inherit write authority. */
export class ExecutionSession {
  private client?: Client;
  private tail: Promise<unknown> = Promise.resolve();
  private scratch: string | null = null;
  private lock?: string;
  private frozen = false;
  mode: PermissionMode = 'ask';
  constructor(readonly workspace: string, readonly runDirectory: string,
    readonly clean: (value: string) => string = value => value,
    private readonly clientFactory: typeof createMcpClient = createMcpClient) {}
  async connect(path: string) {
    await this.dispose();
    this.client = await this.clientFactory(await loadMcp(path));
    return { connected: true, discovered: this.client.toolNames().length, exposed: this.definitions().length,
      backend: await this.client.call('get_backend_status', {}) };
  }
  async status() { return this.client ? { connected: true, discovered: this.client.toolNames().length,
    exposed: this.definitions().length, scratch: this.scratch, frozen: this.frozen,
    backend: await this.client.call('get_backend_status', {}) } : { connected: false, hint: '/mcp use <configuration>; /mcp tools' }; }
  private async audit(value: unknown) {
    await mkdir(this.runDirectory, { recursive: true });
    const file = await open(resolve(this.runDirectory, 'execution.jsonl'), 'a');
    try { await file.writeFile(this.clean(JSON.stringify({ at: new Date().toISOString(), ...value as object })) + '\n'); await file.sync(); }
    finally { await file.close(); }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work); this.tail = next.catch(() => {}); return next;
  }
  private async authorize(description: string, destructive: boolean, confirm?: Approval, shell = false) {
    if (this.mode === 'read-only') throw new Error('READ_ONLY_PERMISSION');
    if (this.mode === 'full-access' || (this.mode === 'workspace-write' && !destructive && !shell)) return;
    if (!await confirm?.(description, this.workspace)) throw new Error('APPROVAL_REQUIRED_OR_DENIED');
  }
  private async acquire() {
    if (this.frozen) throw new Error('OUTCOME_UNKNOWN_FROZEN');
    if (this.lock) return;
    await mkdir(resolve(this.workspace, '.cader/locks'), { recursive: true });
    const path = await workspacePath(this.workspace, '.cader/locks');
    const lock = resolve(path, 'managed-write.json');
    const file = await open(lock, 'wx');
    try { await file.writeFile(JSON.stringify({ runDirectory: this.runDirectory, pid: process.pid })); await file.sync(); }
    finally { await file.close(); }
    this.lock = lock;
  }
  definitions(confirm?: Approval): ToolDefinition[] {
    return (this.client?.definitions() ?? []).filter(tool => reads.has(tool.name.split('__').at(-1)!) || writes.has(tool.name.split('__').at(-1)!))
      .map(tool => ({ ...tool, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        isConcurrencySafe: () => false,
        execute: async (args, exec) => this.serial(async () => {
          exec.signal.throwIfAborted();
          const name = tool.name.split('__').at(-1)!, payload = { ...args as Record<string, unknown> };
          if (reads.has(name)) return JSON.stringify(await this.client!.call(name, payload));
          if (this.frozen) throw new Error('OUTCOME_UNKNOWN_FROZEN');
          if (name !== 'new_drawing' && !this.scratch) throw new Error('NEW_SCRATCH_DRAWING_REQUIRED');
          let destructive = name === 'delete_entity' || payload.erase_source === true;
          let output: string | undefined;
          if (name === 'save_drawing') {
            output = resolve(this.workspace, String(payload.file_path));
            if (extname(output).toLowerCase() !== '.dwg') throw new Error('DWG_OUTPUT_REQUIRED');
            const parent = await import('node:fs/promises').then(fs => fs.realpath(dirname(output!)));
            output = resolve(parent, basename(output));
            try { const info = await lstat(output); if (!info.isFile() || info.isSymbolicLink()) throw new Error('OUTPUT_TYPE_REFUSED'); destructive = true; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            // workspace-write also requires explicit approval for an external destination.
            try { await workspacePath(this.workspace, parent!); } catch { destructive = true; }
            payload.file_path = output; payload.overwrite = destructive;
          }
          await this.authorize(this.clean(`CAD ${name}\n${JSON.stringify(payload)}\nTarget: ${this.scratch ?? 'new scratch drawing'}`), destructive, confirm);
          exec.signal.throwIfAborted(); await this.acquire();
          const request = randomUUID();
          await this.audit({ phase: 'prepared', request, tool: name, target: this.scratch, args: payload });
          try {
            // Once dispatched, await quiescence; cancellation never replays the write.
            const result = await this.client!.call(name, payload);
            if (name === 'new_drawing') this.scratch = String(result);
            const observed = await this.client!.call('query_entities', {});
            let artifact: unknown;
            if (output) {
              const bytes = await readFile(output);
              if (!/^AC10\d\d/.test(bytes.subarray(0, 6).toString('ascii'))) throw new Error('DWG_FILE_VERIFICATION_FAILED');
              artifact = { path: output, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
            }
            await this.audit({ phase: 'confirmed', request, tool: name, target: this.scratch, result, observed, artifact });
            return JSON.stringify({ result, observed, artifact, verification: 'queried-after-write; geometry and reopen acceptance are separate' });
          } catch {
            this.frozen = true;
            await writeFile(this.lock!, JSON.stringify({ frozen: true, runDirectory: this.runDirectory, request, tool: name, target: this.scratch }));
            await this.audit({ phase: 'outcome_unknown', request, tool: name });
            throw new Error('OUTCOME_UNKNOWN_FROZEN');
          }
        }) }));
  }
  fileTools(confirm?: Approval): ToolDefinition[] {
    const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }] };
    const safe = async (path: string, creating = false) => {
      const target = resolve(this.workspace, path);
      if (relative(this.workspace, target).split(/[\\/]/).some(part => /^(?:\.env(?:\..*)?|\.git|\.cader)$/i.test(part))) throw new Error('PRIVATE_PATH_REFUSED');
      const result = creating ? resolve(await workspacePath(this.workspace, dirname(target)), basename(target)) : await workspacePath(this.workspace, target);
      if (relative(this.workspace, result).split(/[\\/]/).some(part => /^(?:\.env(?:\..*)?|\.git|\.cader)$/i.test(part))) throw new Error('PRIVATE_PATH_REFUSED');
      if (/\.(dwg|dxf|dwt|dws)$/i.test(result)) throw new Error('USE_CAD_FILE_TOOLS');
      return result;
    };
    return [defineTool({ name: 'cader_read_file', description: 'Read a UTF-8 workspace file, at most 64 KiB; private configuration excluded.',
      parameters: { path: { type: 'string', required: true } }, output,
      execute: async args => { const path = await safe(args.path); if ((await lstat(path)).size > 65536) throw new Error('FILE_SIZE_LIMIT'); return this.clean(await readFile(path, 'utf8')); } }),
    defineTool({ name: 'cader_list_files', description: 'List one workspace directory. Use directories to explore files; private paths excluded.',
      parameters: { path: { type: 'string', required: true } }, output,
      async execute(args) { return JSON.stringify((await readdir(await safe(args.path))).filter(name => !/^(?:\.env|\.git|\.cader)/i.test(name)).slice(0, 500)); } }),
    defineTool({ name: 'cader_glob', description: 'Find workspace files using a relative glob. Bounded traversal; skips private directories and symlinks.',
      parameters: { pattern: { type: 'string', required: true } }, output,
      execute: async args => {
        if (args.pattern.includes('..') || /^[\\/]|^[A-Za-z]:/.test(args.pattern)) throw new Error('RELATIVE_GLOB_REQUIRED');
        const found: string[] = []; let visited = 0;
        const walk = async (directory: string, prefix: string) => {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (++visited > 5000 || found.length >= 500) return;
            if (entry.isSymbolicLink() || /^(?:\.env|\.git|\.cader|node_modules)/i.test(entry.name)) continue;
            const name = prefix + entry.name;
            if (entry.isDirectory()) await walk(resolve(directory, entry.name), name + '/');
            else if (matchesGlob(name, args.pattern)) found.push(name);
          }
        };
        await walk(this.workspace, ''); return JSON.stringify({ files: found, capped: visited > 5000 || found.length >= 500 });
      } }),
    defineTool({ name: 'cader_edit_file', description: 'Replace exactly one occurrence in a workspace UTF-8 file, with overwrite approval.',
      parameters: { path: { type: 'string', required: true }, old_text: { type: 'string', required: true }, new_text: { type: 'string', required: true } }, output,
      execute: (args, exec) => this.serial(async () => {
        const path = await safe(args.path); if ((await lstat(path)).size > 65536) throw new Error('FILE_SIZE_LIMIT');
        const before = await readFile(path, 'utf8');
        if (!args.old_text || before.split(args.old_text).length !== 2) throw new Error('EXACT_SINGLE_MATCH_REQUIRED');
        const after = before.replace(args.old_text, args.new_text);
        if (Buffer.byteLength(after) > 65536 || this.clean(after) !== after) throw new Error('FILE_CONTENT_REFUSED');
        await this.authorize(this.clean(`Edit ${path}\nReplace:\n${args.old_text}\nWith:\n${args.new_text}`), true, confirm); exec.signal.throwIfAborted();
        if (await readFile(path, 'utf8') !== before) throw new Error('FILE_CHANGED');
        await this.audit({ phase: 'prepared', tool: 'cader_edit_file', path });
        await writeFile(path, after); await this.audit({ phase: 'confirmed', tool: 'cader_edit_file', path }); return 'File edited';
      }) }),
    defineTool({ name: 'cader_write_file', description: 'Create or replace a UTF-8 workspace file with program permission and overwrite approval.',
      parameters: { path: { type: 'string', required: true }, content: { type: 'string', required: true } }, output,
      execute: (args, exec) => this.serial(async () => {
        let path = await safe(args.path, true); let exists = false;
        try { await lstat(path); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (exists) path = await safe(args.path);
        if (Buffer.byteLength(args.content) > 65536 || this.clean(args.content) !== args.content) throw new Error('FILE_CONTENT_REFUSED');
        await this.authorize(this.clean(`Write ${path} (${Buffer.byteLength(args.content)} bytes)\n${args.content}`), exists, confirm);
        exec.signal.throwIfAborted(); await this.audit({ phase: 'prepared', tool: 'cader_write_file', path });
        await writeFile(path, args.content, { flag: exists ? 'w' : 'wx' });
        await this.audit({ phase: 'confirmed', tool: 'cader_write_file', path }); return 'File written';
      }) }),
    defineTool({ name: 'cader_shell', description: 'Run a host shell command in the workspace (not a sandbox). Always asks except full-access; bounded output/time. Output returns to the model.',
      parameters: { command: { type: 'string', required: true } }, output,
      execute: (args, exec) => this.serial(async () => {
        await this.authorize(`Agent Shell (host access)\n${this.clean(args.command)}`, true, confirm, true);
        exec.signal.throwIfAborted(); const commandHash = createHash('sha256').update(args.command).digest('hex');
        await this.audit({ phase: 'prepared', tool: 'cader_shell', commandHash });
        const result = await runUserShell(args.command, this.workspace, exec.signal);
        await this.audit({ phase: 'completed', tool: 'cader_shell', commandHash, code: result.code, cancelled: result.cancelled });
        return this.clean(JSON.stringify(result));
      }) })];
  }
  async dispose() {
    await this.tail; await this.client?.dispose(); this.client = undefined; this.scratch = null;
    if (this.lock && !this.frozen) await unlink(this.lock);
    this.lock = undefined;
  }
}
