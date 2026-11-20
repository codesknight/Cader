import { mkdir, readFile, writeFile, rename, lstat, readdir, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { workspacePath } from '@cader/config';

export const Session = z.object({ version: z.literal(1), id: z.string().regex(/^session-[a-f0-9-]{36}$/),
  created: z.string(), updated: z.string(), workspace: z.string(), model: z.string(), domain: z.string(),
  mcp: z.string().nullable(), skill: z.string().nullable(), shell: z.enum(['ask', 'deny']),
  permission: z.enum(['read-only', 'ask', 'workspace-write', 'full-access']).default('ask'),
  qualityRun:z.string().nullable().default(null),
  summary: z.string().max(12000), contextFrom: z.int().nonnegative(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(100000),
    status: z.string(), at: z.string() }).strict()).max(2000),
  references: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(['image', 'drawing']), bytes: z.int().positive(), width: z.int().optional(), height: z.int().optional() }).strict()).max(20),
}).strict().refine(value => value.contextFrom <= value.messages.length);
export type ChatSession = z.infer<typeof Session>;
export function newSession(workspace: string, model: string): ChatSession {
  const now = new Date().toISOString();
  return { version: 1, id: `session-${randomUUID()}`, created: now, updated: now, workspace, model, domain: 'general',
    mcp: null, skill: null, shell: 'ask', permission: 'ask', qualityRun:null, summary: '', contextFrom: 0, messages: [], references: [] };
}
export async function privateDirectory(root: string, child: string) {
  await mkdir(resolve(root, '.cader'), { recursive: true });
  const base = await workspacePath(root, '.cader');
  await mkdir(join(base, child), { recursive: true });
  return workspacePath(base, child);
}
export class SessionStore {
  constructor(readonly root: string, readonly clean: (text: string) => string) {}
  async save(session: ChatSession) {
    Session.parse(session); session.updated = new Date().toISOString();
    const directory = await privateDirectory(this.root, 'sessions');
    const path = join(directory, session.id + '.json');
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('SESSION_LINK_REFUSED'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const text = this.clean(JSON.stringify(session, null, 2) + '\n');
    if (Buffer.byteLength(text) > 2_000_000) throw new Error('SESSION_SIZE_LIMIT');
    const temp = join(directory, `.write-${randomUUID()}.json`);
    await writeFile(temp, text, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  }
  async load(id: string) {
    if (!/^session-[a-f0-9-]{36}$/.test(id)) throw new Error('INVALID_SESSION_ID');
    const path = await workspacePath(await privateDirectory(this.root, 'sessions'), id + '.json');
    if ((await lstat(path)).size > 2_000_000) throw new Error('SESSION_SIZE_LIMIT');
    const session = Session.parse(JSON.parse(await readFile(path, 'utf8')));
    if (session.id !== id) throw new Error('SESSION_ID_MISMATCH');
    return session;
  }
  async event(session: ChatSession, value: Record<string, unknown>) {
    Session.parse(session);
    const path = join(await privateDirectory(this.root, 'sessions'), session.id + '.events.jsonl');
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('SESSION_LINK_REFUSED'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await appendFile(path, this.clean(JSON.stringify({ at: new Date().toISOString(), ...value })) + '\n', { mode: 0o600 });
  }
  async list() {
    const directory = await privateDirectory(this.root, 'sessions'); const rows = [];
    for (const name of (await readdir(directory)).filter(name => /^session-[a-f0-9-]{36}\.json$/.test(name)).slice(-100)) {
      try { const session = await this.load(name.slice(0, -5)); rows.push({ id: session.id, updated: session.updated,
        turns: session.messages.filter(message => message.role === 'user').length, workspace: session.workspace }); } catch { /* Invalid/private links are not loaded. */ }
    }
    return rows.sort((a, b) => b.updated.localeCompare(a.updated));
  }
}

/** Strip terminal controls from untrusted content without losing normal newlines. */
export function terminalText(text: string) {
  return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
export function environmentRedactor() {
  const secrets = Object.entries(process.env).filter(([name, value]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(name) && value && value.length >= 8)
    .map(([, value]) => value!).sort((a, b) => b.length - a.length);
  return { secrets, clean: (text: string) => secrets.reduce((value, secret) => value.replaceAll(secret, '[redacted]'), text) };
}

/** Hold prefixes so a credential split across stream chunks cannot leak. */
export class SafeTextStream {
  private buffer = '';
  constructor(private readonly secrets: string[], private readonly output: (text: string) => void) {}
  push(text: string) {
    this.buffer += text;
    while (this.buffer) {
      if (this.buffer.length === 1 && /[\ud800-\udbff]/.test(this.buffer)) break;
      const full = this.secrets.find(secret => this.buffer.startsWith(secret));
      if (full) { this.output('[redacted]'); this.buffer = this.buffer.slice(full.length); continue; }
      if (this.secrets.some(secret => secret.startsWith(this.buffer))) break;
      // Hold escape/control sequences until the final text sanitizer can discard them.
      if (this.buffer[0] === '\x1b') {
        const match = this.buffer.match(/^\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/);
        if (match) { this.buffer = this.buffer.slice(match[0].length); continue; }
        if (this.buffer.length < 4096) break;
      }
      const point = String.fromCodePoint(this.buffer.codePointAt(0)!);
      this.output(terminalText(point)); this.buffer = this.buffer.slice(point.length);
    }
  }
  finish() { if (this.buffer) this.output(this.secrets.some(secret => secret.startsWith(this.buffer)) ? '[redacted]' : terminalText(this.buffer)); this.buffer = ''; }
}
