import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readReferenceImage, workspacePath, loadConfig, redactSecrets } from '@cader/config';
import { runTask, failureFromError } from '@cader/profile';

function matches(actual, expected) {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length
    && expected.every((value, index) => matches(actual[index], value));
  return actual !== null && typeof actual === 'object' && Object.entries(expected)
    .every(([key, value]) => Object.hasOwn(actual, key) && matches(actual[key], value));
}

try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('image-test --manifest <workspace.json> [--live]\nDefault: input preflight. --live: paid model recognition against independent expectations; no CAD writes.');
  } else {
    let manifestPath, live = false;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--live' && !live) live = true;
      else if (args[index] === '--manifest' && !manifestPath && args[index + 1] && !args[index + 1].startsWith('--')) manifestPath = args[++index];
      else throw new Error('USAGE_ERROR');
    }
    if (!manifestPath) throw new Error('USAGE_ERROR');
    const manifestText = await readFile(await workspacePath(process.cwd(), manifestPath), 'utf8');
    let manifest;
    try { manifest = JSON.parse(manifestText); } catch { throw new Error('USAGE_ERROR'); }
    if (!manifest || typeof manifest !== 'object' || manifest.version !== 1 || !Array.isArray(manifest.cases)
      || !manifest.cases.length || manifest.cases.length > 100
      || manifest.cases.some(item => !item || typeof item !== 'object' || typeof item.id !== 'string'
        || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || typeof item.image !== 'string'
        || (live && (typeof item.task !== 'string' || !item.task.trim() || !item.expect || Array.isArray(item.expect)
          || typeof item.expect !== 'object' || !Object.keys(item.expect).length)))
      || new Set(manifest.cases.map(item => item.id)).size !== manifest.cases.length) throw new Error('USAGE_ERROR');
    if (live) {
      try { process.loadEnvFile('.env'); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error('INVALID_ENV_FILE'); }
    }
    const directory = resolve('.cader/runs', `image-cases-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    if (live) {
      const config = await loadConfig(process.cwd());
      await writeFile(join(directory, 'expectations.snapshot.json'), redactSecrets(JSON.stringify({
        cases: manifest.cases.map(item => ({ id: item.id, expect: item.expect })),
      }, null, 2), config.profiles));
    }
    const results = [];
    let stopReason;
    for (const item of manifest.cases) {
      if (stopReason) { results.push({ id: item.id, status: 'skipped', errorCode: stopReason }); continue; }
      try {
        const image = await readReferenceImage(process.cwd(), item.image);
        const input = { sha256: createHash('sha256').update(image.data).digest('hex'), mediaType: image.mediaType,
          width: image.width, height: image.height, bytes: image.data.length };
        if (!live) { results.push({ id: item.id, status: 'input-valid', input }); continue; }
        // Expected values are deliberately never placed into the model instruction.
        const run = await runTask(process.cwd(), { task: item.task + '\nReturn one JSON object, no Markdown. Do not delegate or call CAD tools.', image: item.image });
        let actual;
        try { actual = JSON.parse(run.text); } catch { actual = null; }
        const passed = run.ok && matches(actual, item.expect);
        results.push({ id: item.id, status: passed ? 'recognition-passed' : 'recognition-failed', input,
          errorCode: run.errorCode ?? (passed ? undefined : 'EXPECTED_RESULT_MISMATCH'), runDirectory: run.runDirectory });
        if (['QUOTA', 'ACCOUNT_QUOTA', 'AUTH', 'RATE_LIMIT'].includes(run.errorCode)) stopReason = run.errorCode;
      } catch (error) {
        const failure = failureFromError(error, 'configuration');
        results.push({ id: item.id, status: 'input-failed', ...failure });
      }
    }
    const ok = results.every(result => ['input-valid', 'recognition-passed'].includes(result.status));
    const report = { ok, kind: live ? 'live-image-recognition' : 'image-input-preflight',
      manifestSha256: createHash('sha256').update(manifestText).digest('hex'),
      cadDrawingEvaluated: false, results };
    await writeFile(join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ok, kind: report.kind, cadDrawingEvaluated: false, runDirectory: directory,
      cases: results.map(result => ({ id: result.id, status: result.status, errorCode: result.errorCode })) }, null, 2));
    process.exitCode = ok ? 0 : 1;
  }
} catch (error) {
  const failure = failureFromError(error);
  console.error(JSON.stringify({ ok: false, ...failure }));
  process.exitCode = failure.source === 'usage' ? 2 : 1;
}
