import { runHarnessSmoke } from '@cader/profile';
import { recordSmoke } from './record.js';

const command = process.argv[2];
try {
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
  } else {
    console.error('Usage: cader doctor | harness-smoke');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, errorType: error instanceof Error ? error.name : 'Error' }));
  process.exitCode = 1;
}
