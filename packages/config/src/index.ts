import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
export { parseVisualReport, visualReportSchema, parseAcceptancePlan, acceptancePlanSchema,parseReferenceObservation,referenceObservationSchema,parseReferenceLabels,referenceLabelsSchema } from './quality.js';
export type { VisualReview, QualityPlan,ReferenceObservationData } from './quality.js';

const Profile = z.object({
  version: z.literal(1), id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  role: z.enum(['main', 'subagent', 'vision']), provider: z.literal('openai-compatible'),
  base_url: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  }),
  api_key_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/), model: z.string().min(1),
  input: z.array(z.enum(['text', 'image'])).min(1),
  description: z.string().min(1).max(400).optional(),
  when_to_use: z.string().min(1).max(400).optional(),
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
  max_task_tool_calls: z.int().min(1).max(5000).optional(),
  max_cad_operations_per_round: z.int().min(1).max(256).optional(),
  max_cad_operations: z.int().min(1).max(5000).optional(),
  max_execution_rounds: z.int().min(1).max(50).optional(),
  validation_tool_reserve: z.int().min(0).max(32).optional(),
  max_task_tokens: z.int().min(1).max(20000000).optional(),
  max_delegations: z.int().min(1).max(25), timeout_ms: z.int().min(1000).max(600000),
  max_visual_reviews_per_turn: z.int().min(1).max(5).default(4),
  read_only_tools: z.array(z.string().regex(/^mcp__[A-Za-z0-9_-]+__(list_layers|list_symbol_library|get_backend_status)$/)),
}).strict().superRefine((value, context) => {
  if ((value.validation_tool_reserve ?? 8) >= value.max_tool_calls)
    context.addIssue({code:'custom',message:'validation_tool_reserve must be smaller than max_tool_calls'});
});

const Mcp = z.object({
  version: z.literal(1), server_name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  transport: z.literal('stdio'), command: z.string().min(1), args: z.array(z.string()),
  cwd: z.string().min(1), startup_timeout_ms: z.int().min(1000).max(120000),
  tool_timeout_ms: z.int().min(1000).max(180000),
  env_refs: z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string().regex(/^[A-Z][A-Z0-9_]*$/)).default({}),
}).strict();

export type ModelProfile = z.infer<typeof Profile>;
export type RuntimeConfig = z.infer<typeof Runtime>;
export type McpConfig = z.infer<typeof Mcp>;

export function mcpEnvironment(config: McpConfig) {
  return Object.fromEntries(Object.entries(config.env_refs ?? {}).map(([name, reference]) => {
    const value = process.env[reference];
    if (!value?.trim()) throw new ConfigError('Missing MCP environment reference');
    return [name, value];
  }));
}

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
  const runtime = parseRuntime(await readFile(resolve(root, 'configs/runtime.yaml'), 'utf8'));
  const ids = [runtime.main_profile, ...runtime.subagent_profiles];
  if (new Set(ids).size !== ids.length) throw new ConfigError('Agent profile references must be unique');
  const profiles = await Promise.all(ids.map(async id => {
    const profile = parseProfile(await readFile(resolve(root, `configs/models/${id}.yaml`), 'utf8'));
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

const skillName = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(64);
const Catalog = z.object({ version: z.literal(1), skills: z.array(z.object({
  name: skillName, description: z.string().min(1).max(400),
  when_to_use: z.string().min(1).max(400).optional(),
  roles: z.array(z.enum(['main', 'subagent', 'vision'])).min(1),
  mode: z.literal('read-only'),
  resources: z.record(skillName, z.string().regex(/^references\/[A-Za-z0-9_-]+\.md$/)).default({}),
}).strict()).min(1).max(32) }).strict();
export type SkillRole = ModelProfile['role'];

/** Explicit registration only. Files are data; this registry has no execution API. */
export async function loadSkills(root: string) {
  try {
    const base = await workspacePath(root, 'configs/skills');
    const readAsset = async (directory: string, path: string) => {
      const target = await workspacePath(directory, path);
      const info = await stat(target);
      if (!info.isFile() || info.size > 65536) throw new ConfigError('Invalid Skill asset');
      return readFile(target, 'utf8');
    };
    const catalog = Catalog.parse(parseYaml(await readAsset(base, 'catalog.yaml')));
    if (new Set(catalog.skills.map(skill => skill.name)).size !== catalog.skills.length)
      throw new ConfigError('Duplicate Skill names');
    // Validate registered assets before publishing metadata to any role.
    for (const skill of catalog.skills) {
      const directory = await workspacePath(base, skill.name);
      const body = await readAsset(directory, 'SKILL.md');
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body);
      const header = frontmatter ? parseYaml(frontmatter[1]!) as { name?: string } : undefined;
      if (header?.name !== skill.name) throw new ConfigError('Skill name mismatch');
      for (const resource of Object.values(skill.resources)) await readAsset(directory, resource);
    }
    const list = (role: SkillRole) => catalog.skills.filter(skill => skill.roles.includes(role))
      .map(skill => ({ name: skill.name, description: skill.description, when_to_use: skill.when_to_use ?? skill.description, mode: skill.mode,
        resources: Object.keys(skill.resources) }));
    return {
      list,
      async read(name: string, role: SkillRole, resource?: string) {
        const skill = catalog.skills.find(skill => skill.name === name && skill.roles.includes(role));
        if (!skill || (resource !== undefined && !Object.hasOwn(skill.resources, resource)))
          throw new ConfigError('Skill or resource is unavailable to this role');
        // Resolve again at read time so changed links do not escape the registered boundary.
        const directory = await workspacePath(base, skill.name);
        return readAsset(directory, resource === undefined ? 'SKILL.md' : skill.resources[resource]!);
      },
    };
  } catch { throw new ConfigError('Invalid Skill catalog or asset'); }
}

/** Current attachment contract: bounded PNG inside the workspace, no implicit URL/file reads. */
export async function readPng(root: string, path: string) {
  const target = await workspacePath(root, path);
  const info = await stat(target);
  if (!info.isFile() || info.size < 33 || info.size > 10 * 1024 * 1024)
    throw new ConfigError('PNG must be a regular file no larger than 10 MiB');
  const data = await readFile(target);
  if (data.length < 33 || data.length > 10 * 1024 * 1024
    || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || data.toString('ascii', 12, 16) !== 'IHDR' || !data.readUInt32BE(16) || !data.readUInt32BE(20)
    || data.readUInt32BE(16) * data.readUInt32BE(20) > 40_000_000)
    throw new ConfigError('Unsupported or oversized PNG header');
  return data;
}

/** JPEG frame metadata gate; image decoding remains the attachment/provider's job. */
export async function readReferenceImage(root: string, path: string) {
  const target = await workspacePath(root, path);
  const info = await stat(target);
  if (!info.isFile() || info.size < 4 || info.size > 10 * 1024 * 1024)
    throw new ConfigError('Reference image must be a file no larger than 10 MiB');
  const data = await readFile(target);
  if (data.length > 10 * 1024 * 1024) throw new ConfigError('Reference image exceeds limit');
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    const png = await readPng(root, path);
    return { data: png, mediaType: 'image/png' as const, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  }
  if (data[0] !== 255 || data[1] !== 216) throw new ConfigError('Only PNG and JPEG references are supported');
  let offset = 2;
  while (offset < data.length) {
    if (data[offset++] !== 255) break;
    while (data[offset] === 255) offset++;
    const marker = data[offset++];
    if (marker === undefined || marker === 217 || marker === 218 || offset + 2 > data.length) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) break;
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (length < 8) break;
      const height = data.readUInt16BE(offset + 3), width = data.readUInt16BE(offset + 5);
      if (!width || !height || width * height > 40_000_000) break;
      return { data, mediaType: 'image/jpeg' as const, width, height };
    }
    offset += length;
  }
  throw new ConfigError('Invalid or oversized JPEG frame header');
}
