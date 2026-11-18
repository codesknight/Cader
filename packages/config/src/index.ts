import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';

const Profile = z.object({
  version: z.literal(1), id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  role: z.enum(['main', 'subagent', 'vision']), provider: z.literal('openai-compatible'),
  base_url: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  }),
  api_key_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/), model: z.string().min(1),
  input: z.array(z.enum(['text', 'image'])).min(1),
  generation: z.object({ max_output_tokens: z.int().min(64).max(32768),
    reasoning_effort: z.enum(['off', 'low', 'high', 'max']) }).strict(),
  timeout_ms: z.int().min(1000).max(300000), can_delegate: z.boolean(),
}).strict().superRefine((value, context) => {
  const main = value.role === 'main';
  if (value.can_delegate !== main)
    context.addIssue({ code: 'custom', message: 'Only MainAgent may delegate' });
  if (value.model === 'deepseek-v4-pro' && value.input.includes('image'))
    context.addIssue({ code: 'custom', message: 'deepseek-v4-pro has no documented vision input' });
  if (value.role === 'vision' && !value.input.includes('image'))
    context.addIssue({ code: 'custom', message: 'VisionAgent requires an image-capable route' });
});

const Runtime = z.object({
  version: z.literal(1), main_profile: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  subagent_profiles: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)).min(1),
  max_parallel_subagents: z.int().min(1).max(5), max_delegation_depth: z.literal(1),
  max_model_steps: z.int().min(1).max(50), max_tool_calls: z.int().min(1).max(100),
  max_delegations: z.int().min(1).max(25), timeout_ms: z.int().min(1000).max(600000),
  read_only_tools: z.array(z.string().regex(/^mcp__[A-Za-z0-9_-]+__(list_layers|list_symbol_library)$/)),
}).strict();

const Mcp = z.object({
  version: z.literal(1), server_name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  transport: z.literal('stdio'), command: z.string().min(1), args: z.array(z.string()),
  cwd: z.string().min(1), startup_timeout_ms: z.int().min(1000).max(120000),
  tool_timeout_ms: z.int().min(1000).max(180000),
}).strict();

export type ModelProfile = z.infer<typeof Profile>;
export type RuntimeConfig = z.infer<typeof Runtime>;
export type McpConfig = z.infer<typeof Mcp>;

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'ConfigError'; }
}

export function parseProfile(text: string): ModelProfile {
  try { return Profile.parse(parseYaml(text)); }
  catch { throw new ConfigError('Invalid model YAML: check role, capabilities and allowed fields; secrets belong in environment variables.'); }
}

export function parseYaml(text: string): unknown {
  const document = parseDocument(text, { uniqueKeys: true, customTags: [] });
  if (document.errors.length || document.warnings.length) throw new ConfigError('Invalid YAML');
  return document.toJS({ maxAliasCount: 0 });
}

export function parseRuntime(text: string): RuntimeConfig {
  try { return Runtime.parse(parseYaml(text)); }
  catch { throw new ConfigError('Invalid runtime YAML: child concurrency must be <=5 and delegation depth must be 1.'); }
}

export async function loadConfig(root: string) {
  const runtime = parseRuntime(await readFile(resolve(root, 'config/runtime.yaml'), 'utf8'));
  const ids = [runtime.main_profile, ...runtime.subagent_profiles];
  if (new Set(ids).size !== ids.length) throw new ConfigError('Agent profile references must be unique');
  const profiles = await Promise.all(ids.map(async id => {
    const profile = parseProfile(await readFile(resolve(root, `config/models/${id}.yaml`), 'utf8'));
    if (profile.id !== id) throw new ConfigError('Model profile ID must match its filename');
    if ((id === runtime.main_profile) !== (profile.role === 'main'))
      throw new ConfigError('Only the configured main profile can use the main role');
    return profile;
  }));
  return { runtime, profiles };
}

export async function loadMcp(path: string): Promise<McpConfig> {
  let config: McpConfig;
  try { config = Mcp.parse(parseYaml(await readFile(path, 'utf8'))); }
  catch { throw new ConfigError('Invalid local MCP YAML'); }
  return { ...config, cwd: resolve(dirname(path), config.cwd) };
}

export function requireCredential(profile: ModelProfile): void {
  if (!process.env[profile.api_key_env]?.trim()) throw new ConfigError(`Missing environment variable ${profile.api_key_env}`);
}

export function redactSecrets(text: string, profiles: readonly ModelProfile[],
  environment: NodeJS.ProcessEnv = process.env): string {
  return profiles.reduce((value, profile) => {
    const secret = environment[profile.api_key_env]?.trim();
    return secret ? value.replaceAll(secret, '[redacted]') : value;
  }, text);
}

export async function workspacePath(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const target = await realpath(resolve(base, path));
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(rel))
    throw new ConfigError('File must stay inside the workspace');
  return target;
}
