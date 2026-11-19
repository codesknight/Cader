import { runHarnessSmoke, runLiveSmoke, runTask, failureFromError } from '@cader/profile';
import { recordSmoke } from './record.js';
import { loadConfig, redactSecrets } from '@cader/config';

const command = process.argv[2];
const usage = 'Cader CLI (read-only)\nUsage: cader exec "<task>" [--mcp <local.yaml>] | doctor | models | harness-smoke | live-smoke --mcp <local.yaml> [--image <file> --expected-image <json>]';
try {
  // Parse before loading credentials or starting any runtime.
  let taskInput: { task: string; mcpPath?: string } | undefined;
  let smokeInput: { mcpPath: string; image?: string; expectedImage?: string } | undefined;
  if (command === 'live-smoke') {
    const flags = new Map<string, string>();
    const args = process.argv.slice(3);
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index]!, value = args[index + 1];
      if (!['--mcp', '--image', '--expected-image'].includes(flag) || flags.has(flag)
        || !value?.trim() || value.startsWith('--')) throw new Error('USAGE_ERROR');
      flags.set(flag, value);
    }
    if (!flags.has('--mcp') || (flags.has('--expected-image') && !flags.has('--image'))) throw new Error('USAGE_ERROR');
    smokeInput = { mcpPath: flags.get('--mcp')!, image: flags.get('--image'), expectedImage: flags.get('--expected-image') };
  }
  if (command === 'exec' && !process.argv.slice(3).includes('--help')) {
    const args = process.argv.slice(3);
    let task: string | undefined, mcpPath: string | undefined;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      if (arg === '--mcp') {
        if (mcpPath !== undefined || !args[index + 1]?.trim() || args[index + 1]!.startsWith('--')) throw new Error('USAGE_ERROR');
        mcpPath = args[++index];
      } else if (arg.startsWith('--') || task !== undefined) throw new Error('USAGE_ERROR');
      else task = arg;
    }
    if (!task?.trim()) throw new Error('USAGE_ERROR');
    taskInput = { task, mcpPath };
  }
  if (command === '--help' || command === 'help' || (command === 'exec' && process.argv.includes('--help'))) {
    console.log(usage);
  } else {
    if (command === 'models' || command === 'live-smoke' || command === 'exec') {
      try { process.loadEnvFile('.env'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('INVALID_ENV_FILE'); }
    }
    if (command === 'exec') {
      const result = await runTask(process.cwd(), taskInput!);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
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
      const result = await runLiveSmoke(process.cwd(), smokeInput!);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    } else {
      console.error(usage);
      process.exitCode = 2;
    }
  }
} catch (error) {
  const failure = failureFromError(error);
  console.error(JSON.stringify({ ok: false, ...failure }));
  process.exitCode = failure.source === 'usage' ? 2 : 1;
}
