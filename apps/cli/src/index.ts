#!/usr/bin/env node
import { runHarnessSmoke, runLiveSmoke, runExecutionEvidenceSmoke, runExecutionSmoke, runReliabilitySmoke, runVisualSmoke, runFaultSmoke, runQualitySmoke, runTask, failureFromError, runControlledCad,
  reconcileControlledCad, contractSchemas, validateAssessment, assessmentSchemas, CAD_DRAFT_REVISION } from '@cader/profile';
import { recordSmoke } from './record.js';
import { loadConfig, loadSkills, redactSecrets, workspacePath } from '@cader/config';
import { readFile } from 'node:fs/promises';
import { runTerminal } from './terminal.js';

const command = process.argv[2];
const usage = 'Cader CLI (permission: ask by default)\nexec "<task>" [--permissions read-only|ask|workspace-write|full-access] [--intent assess|redraw] [--mcp <local.yaml>] [--skill <name>] [--image <local.png|jpg>] [--crop x,y,w,h] [--rotate 0|90|180|270]\nredraw requires an image, connected MCP and write permission; quality and DWG file verification are reported separately.\nskills list | skills show <name> [--resource <id>] | doctor | models | harness-smoke\nlive-smoke --mcp <local.yaml> [--execution-evidence | --execution | --reliability | --faults | --visual | --quality [--task <request>] [--round-cad-budget <1..64>] [--round-cad-budget <1..64>] | --image <file> --expected-image <json>]\ncad-contract\ncad-test --backend http --mcp <local.yaml> --plan <plan.json> --output .cader/artifacts/<name>.dwg [--authorize-write]\ncad-reconcile --run <managed-run-directory> --mcp <local.yaml>\nassessment-check --assessment <json> --expect <independent.json>';
function flags(keys: string[], booleans: string[] = []) {
  const result = new Map<string, string>();
  const args = process.argv.slice(3);
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!;
    if (result.has(key)) throw new Error('USAGE_ERROR');
    if (booleans.includes(key)) result.set(key, 'true');
    else if (keys.includes(key) && args[index + 1]?.trim() && !args[index + 1]!.startsWith('--')) result.set(key, args[++index]!);
    else throw new Error('USAGE_ERROR');
  }
  if (keys.some(key => !result.has(key))) throw new Error('USAGE_ERROR');
  return result;
}
try {
  if (!command || command === 'chat') {
    let workspace: string | undefined;
    let stdio = false;
    const args = process.argv.slice(3);
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--stdio' && !stdio) stdio = true;
      else if (args[index] === '--workspace' && !workspace && args[index + 1]) workspace = args[++index];
      else throw new Error('USAGE_ERROR');
    }
    if (!command && !(process.stdin.isTTY && process.stdout.isTTY)) console.log(usage + '\n\nUse cader in a terminal for interactive mode; chat --stdio accepts scripted slash commands.');
    else await runTerminal({ workspace, stdio });
  } else {
  // Parse before loading credentials or starting any runtime.
  let taskInput: { task: string; mcpPath?: string; skill?: string; image?: string; intent?: 'assess' | 'redraw';
    permissionMode?: 'read-only' | 'ask' | 'workspace-write' | 'full-access';
    imageView?: { rotation?: 0 | 90 | 180 | 270; crop?: { left: number; top: number; width: number; height: number } } } | undefined;
  let smokeInput: { mcpPath: string; image?: string; expectedImage?: string; task?:string;roundCadBudget?:number } | undefined;
  let evidenceSmoke = false;
  let executionSmoke = false;
  let reliabilitySmoke = false;
  let visualSmoke = false;
  let faultSmoke = false;
  let qualitySmoke = false;
  if (command === 'live-smoke') {
    const flags = new Map<string, string>();
    const args = process.argv.slice(3);
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index]!, value = args[index + 1];
      if (flag === '--execution-evidence' && !evidenceSmoke) { evidenceSmoke = true; index--; continue; }
      if (flag === '--execution' && !executionSmoke) { executionSmoke = true; index--; continue; }
      if (flag === '--reliability' && !reliabilitySmoke) { reliabilitySmoke = true; index--; continue; }
      if (flag === '--visual' && !visualSmoke) { visualSmoke = true; index--; continue; }
      if (flag === '--faults' && !faultSmoke) { faultSmoke = true; index--; continue; }
      if (flag === '--quality' && !qualitySmoke) { qualitySmoke = true; index--; continue; }
      if (!['--mcp', '--image', '--expected-image','--task','--round-cad-budget'].includes(flag) || flags.has(flag)
        || !value?.trim() || value.startsWith('--')) throw new Error('USAGE_ERROR');
      flags.set(flag, value);
    }
    if (!flags.has('--mcp') || (flags.has('--expected-image') && !flags.has('--image')) || ((evidenceSmoke || executionSmoke || reliabilitySmoke || visualSmoke || faultSmoke || qualitySmoke) && flags.has('--image')) || [evidenceSmoke,executionSmoke,reliabilitySmoke,visualSmoke,faultSmoke,qualitySmoke].filter(Boolean).length > 1) throw new Error('USAGE_ERROR');
    if(flags.has('--task')&&!qualitySmoke)throw new Error('USAGE_ERROR');
    const roundCadBudget=flags.has('--round-cad-budget')?Number(flags.get('--round-cad-budget')):undefined;
    if(roundCadBudget!==undefined&&(!qualitySmoke||!Number.isInteger(roundCadBudget)||roundCadBudget<1||roundCadBudget>64))throw new Error('USAGE_ERROR');
    smokeInput = { mcpPath: flags.get('--mcp')!, image: flags.get('--image'), expectedImage: flags.get('--expected-image'),task:flags.get('--task'),roundCadBudget };
  }
  if (command === 'exec' && !process.argv.slice(3).includes('--help')) {
    const args = process.argv.slice(3);
    let task: string | undefined;
    const flags = new Map<string, string>();
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      if (['--mcp', '--skill', '--image', '--intent', '--crop', '--rotate', '--permissions'].includes(arg)) {
        if (flags.has(arg) || !args[index + 1]?.trim() || args[index + 1]!.startsWith('--')) throw new Error('USAGE_ERROR');
        flags.set(arg, args[++index]!);
      } else if (arg.startsWith('--') || task !== undefined) throw new Error('USAGE_ERROR');
      else task = arg;
    }
    if (!task?.trim()) throw new Error('USAGE_ERROR');
    const intent = flags.get('--intent') ?? 'assess';
    const permission = flags.get('--permissions') ?? 'ask';
    if (!['read-only', 'ask', 'workspace-write', 'full-access'].includes(permission)) throw new Error('USAGE_ERROR');
    if (!['assess', 'redraw'].includes(intent)) throw new Error('USAGE_ERROR');
    const rotation = Number(flags.get('--rotate') ?? 0);
    if (![0, 90, 180, 270].includes(rotation) || ((flags.has('--crop') || flags.has('--rotate')) && !flags.has('--image'))) throw new Error('USAGE_ERROR');
    let crop;
    if (flags.has('--crop')) {
      const values = flags.get('--crop')!.split(',').map(Number);
      if (values.length !== 4 || values.some(value => !Number.isSafeInteger(value)) || values[0]! < 0 || values[1]! < 0 || values[2]! <= 0 || values[3]! <= 0) throw new Error('USAGE_ERROR');
      crop = { left: values[0]!, top: values[1]!, width: values[2]!, height: values[3]! };
    }
    taskInput = { task, mcpPath: flags.get('--mcp'), skill: flags.get('--skill'), image: flags.get('--image'),
      permissionMode: permission as NonNullable<typeof taskInput>['permissionMode'],
      intent: intent as 'assess' | 'redraw', imageView: { rotation: rotation as 0 | 90 | 180 | 270, crop } };
  }
  if (command === '--version' || command === '-v') {
    console.log('Cader 0.4.0-dev.13');
  } else if (command === '--help' || command === 'help' || (command === 'exec' && process.argv.includes('--help'))) {
    console.log(usage);
    console.log('\nNo command: interactive Cader terminal. chat [--workspace <dir>] [--stdio]\n--version  Show version without configuration or network.');
  } else {
    if (command === 'models' || command === 'live-smoke' || command === 'exec' || command === 'cad-test' || command === 'cad-reconcile') {
      try { process.loadEnvFile('.env'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('INVALID_ENV_FILE'); }
    }
    if (command === 'cad-contract') {
      if (process.argv.length !== 3) throw new Error('USAGE_ERROR');
      console.log(JSON.stringify({ contract_version: 'cader-cad/1', status: 'Cader-side proposal; MCP implementation required',
        draft_revision: CAD_DRAFT_REVISION,
        schemas: { ...contractSchemas(), ...assessmentSchemas() } }, null, 2));
    } else if (command === 'cad-test') {
      const parsed = flags(['--backend', '--mcp', '--plan', '--output'], ['--authorize-write']);
      const result = await runControlledCad(process.cwd(), { backend: parsed.get('--backend')!, mcpPath: parsed.get('--mcp')!,
        planPath: parsed.get('--plan')!, output: parsed.get('--output')!, authorized: parsed.has('--authorize-write') });
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.task_status === 'blocked' ? 3 : result.ok ? 0 : 1;
    } else if (command === 'cad-reconcile') {
      const parsed = flags(['--run', '--mcp']);
      console.log(JSON.stringify(await reconcileControlledCad(process.cwd(), parsed.get('--run')!, parsed.get('--mcp')!), null, 2));
      process.exitCode = 3;
    } else if (command === 'assessment-check') {
      const parsed = flags(['--assessment', '--expect']);
      const load = async (key: string) => JSON.parse(await readFile(await workspacePath(process.cwd(), parsed.get(key)!), 'utf8'));
      const result = validateAssessment(await load('--assessment'), await load('--expect'));
      console.log(JSON.stringify({ ...result, assessment: undefined, verification: 'independent-facts-and-graph-only', artifact: null }, null, 2));
      process.exitCode = result.ok ? 0 : 3;
    } else if (command === 'skills') {
      const args = process.argv.slice(3);
      if (args[0] === 'list' && args.length === 1) {
        console.log(JSON.stringify({ ok: true, skills: (await loadSkills(process.cwd())).list('main') }, null, 2));
      } else if (args[0] === 'show' && args[1] && (args.length === 2
        || (args.length === 4 && args[2] === '--resource' && args[3]?.trim()))) {
        const text = await (await loadSkills(process.cwd())).read(args[1], 'main', args[3]);
        console.log(JSON.stringify({ ok: true, name: args[1], resource: args[3] ?? null, text }, null, 2));
      } else throw new Error('USAGE_ERROR');
    } else if (command === 'exec') {
      const result = await runTask(process.cwd(), taskInput!);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.task_status === 'blocked' ? 3 : result.ok ? 0 : 1;
    } else if (command === 'doctor') {
      const [major, minor] = process.versions.node.split('.').map(Number);
      const ok = (major ?? 0) > 24 || (major === 24 && (minor ?? 0) >= 9);
      console.log(JSON.stringify({ ok, node: process.versions.node, runtime: 'DeepSeek Harness',
        dshVersion: '0.2.2-rc.4', minimumNode: '24.9.0' }, null, 2));
      process.exitCode = ok ? 0 : 1;
    } else if (command === 'harness-smoke') {
      const result = await runHarnessSmoke();
      const runDirectory = await recordSmoke(result);
      console.log(JSON.stringify({ ...result, runDirectory }, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    } else if (command === 'models') {
      const config = await loadConfig(process.cwd());
      console.log(redactSecrets(JSON.stringify({ ok: true, runtime: config.runtime, profiles: config.profiles.map(profile =>
        ({ ...profile, credentialConfigured: Boolean(process.env[profile.api_key_env]?.trim()) })) }, null, 2), config.profiles));
    } else if (command === 'live-smoke') {
      const result = evidenceSmoke ? await runExecutionEvidenceSmoke(process.cwd(), smokeInput!.mcpPath) : qualitySmoke ? await runQualitySmoke(process.cwd(), smokeInput!.mcpPath,smokeInput!.task,smokeInput!.roundCadBudget) : faultSmoke ? await runFaultSmoke(process.cwd(), smokeInput!.mcpPath) : visualSmoke ? await runVisualSmoke(process.cwd(), smokeInput!.mcpPath) : reliabilitySmoke ? await runReliabilitySmoke(process.cwd(), smokeInput!.mcpPath) : executionSmoke ? await runExecutionSmoke(process.cwd(), smokeInput!.mcpPath) : await runLiveSmoke(process.cwd(), smokeInput!);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    } else {
      console.error(usage);
      process.exitCode = 2;
    }
  }
  }
} catch (error) {
  const failure = failureFromError(error);
  console.error(JSON.stringify({ ok: false, ...failure }));
  process.exitCode = failure.source === 'usage' ? 2 : command === 'cad-reconcile' && failure.source === 'verification' ? 3 : 1;
}
