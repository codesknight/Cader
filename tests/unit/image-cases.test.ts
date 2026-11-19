import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readReferenceImage } from '@cader/config';

test('JPEG metadata gate handles APP segments and progressive frames, rejects truncation and excessive size', async () => {
  const parent = resolve('.cader/tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, 'image-header-'));
  // Header-only fixture, deliberately not presented as an encoded image or perception test.
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 4, 0, 0, 255, 194, 0, 11, 8, 0, 10, 0, 20, 1, 1, 17, 0, 255, 217]);
  try {
    await writeFile(resolve(root, 'reference.jpg'), jpeg);
    const image = await readReferenceImage(root, 'reference.jpg');
    assert.equal(image.mediaType, 'image/jpeg');
    assert.equal(image.width, 20); assert.equal(image.height, 10);
    await writeFile(resolve(root, 'truncated.jpg'), jpeg.subarray(0, 14));
    await assert.rejects(readReferenceImage(root, 'truncated.jpg'));
    const large = Buffer.from(jpeg); large.writeUInt16BE(65535, 13); large.writeUInt16BE(65535, 15);
    await writeFile(resolve(root, 'large.jpg'), large);
    await assert.rejects(readReferenceImage(root, 'large.jpg'));
    const png = await readReferenceImage(process.cwd(), 'benchmark/fixtures/vision-calibration.png');
    assert.equal(png.mediaType, 'image/png');
  } finally {
    assert.ok(root.startsWith(parent + sep));
    await rm(root, { recursive: true });
  }
});

test('image-case CLI defaults to credential-free preflight and never claims CAD evaluation', async () => {
  const parent = resolve('.cader/tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, 'image-cases-'));
  try {
    const manifest = resolve(root, 'cases.json');
    await writeFile(manifest, JSON.stringify({ version: 1, cases: [
      { id: 'synthetic', image: 'benchmark/fixtures/vision-calibration.png' },
    ] }));
    const result = spawnSync(process.execPath, ['benchmark/run-image-cases.mjs', '--manifest', manifest],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DEEPSEEK_API_KEY: '' } });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, 'image-input-preflight');
    assert.equal(report.cadDrawingEvaluated, false);
    assert.equal(report.cases[0].status, 'input-valid');
    const invalid = spawnSync(process.execPath, ['benchmark/run-image-cases.mjs', '--manifest', manifest, '--live'],
      { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(invalid.status, 2);
    assert.equal(JSON.parse(invalid.stderr).errorCode, 'USAGE_ERROR');
    await cp(resolve('configs'), resolve(root, 'configs'), { recursive: true,
      filter: source => !source.endsWith('.local.yaml') && !source.endsWith('.local.json') });
    await cp(resolve('benchmark/fixtures/vision-calibration.png'), resolve(root, 'reference.png'));
    await writeFile(manifest, JSON.stringify({ version: 1, cases: [
      { id: 'no-credential', image: 'reference.png', task: 'Read only.', expect: { count: 1 } },
    ] }));
    const missingKey = spawnSync(process.execPath, [resolve('benchmark/run-image-cases.mjs'), '--manifest', 'cases.json', '--live'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, DEEPSEEK_API_KEY: '' } });
    assert.equal(missingKey.status, 1, missingKey.stderr);
    const failed = JSON.parse(missingKey.stdout);
    assert.equal(failed.cases[0].errorCode, 'CONFIG_INVALID');
    const expected = JSON.parse(await readFile(resolve(failed.runDirectory, 'expectations.snapshot.json'), 'utf8'));
    assert.deepEqual(expected.cases[0].expect, { count: 1 });
  } finally {
    assert.ok(root.startsWith(parent + sep));
    await rm(root, { recursive: true });
  }
});
