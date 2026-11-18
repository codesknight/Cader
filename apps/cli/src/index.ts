import { runHarnessSmoke, runLiveSmoke } from '@cader/profile';
import { recordSmoke } from './record.js';
import { loadConfig, redactSecrets } from '@cader/config';

const command = process.argv[2];
try {
  if (command === 'models' || command === 'live-smoke') {
    try { process.loadEnvFile('.env'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('INVALID_ENV_FILE'); }
  }
  if (command === 'doctor') {
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
    const argument = (name: string) => { const index = process.argv.indexOf(name);
      return index < 0 ? undefined : process.argv[index + 1]; };
    const mcpPath = argument('--mcp');
    if (!mcpPath) throw new Error('MISSING_MCP_CONFIG');
    const result = await runLiveSmoke(process.cwd(), { mcpPath, image: argument('--image'),
      expectedImage: argument('--expected-image') });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } else {
    console.error('Usage: cader doctor | models | harness-smoke | live-smoke --mcp <local.yaml> [--image <file> --expected-image <json>]');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, errorType: error instanceof Error ? error.name : 'Error' }));
  process.exitCode = 1;
}
