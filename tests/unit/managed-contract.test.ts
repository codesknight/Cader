import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateCadDto, RequestIntent, parseJobForIntent, auditCadRequest, CAD_DRAFT_REVISION } from '@cader/profile';

test('shared synthetic protocol vectors reject permission, unit, revision-mode and reconciliation mismatches', async () => {
  const cases = JSON.parse(await readFile('benchmark/fixtures/managed-cad-v1.cases.json', 'utf8'));
  assert.equal(cases.draft_revision, CAD_DRAFT_REVISION);
  for (const row of cases.schema_cases) assert.equal(validateCadDto(row.schema, row.value), row.valid, row.name);
  for (const row of cases.reconciliation_cases) {
    const intent = RequestIntent.parse(row.intent);
    if (row.valid) assert.doesNotThrow(() => parseJobForIntent(row.job, intent), row.name);
    else assert.throws(() => parseJobForIntent(row.job, intent), Error, row.name);
  }
  for (const row of cases.audit_vectors) assert.deepEqual(auditCadRequest(row.operation, row.args),
    { request_json: row.request_json, request_sha256: row.request_sha256 });
});

test('unfrozen manifest pins exact schema/example bytes across platforms', async () => {
  const manifest = JSON.parse(await readFile('configs/contracts/cader-v1.manifest.json', 'utf8'));
  assert.equal(manifest.draft_revision, CAD_DRAFT_REVISION);
  assert.match(manifest.status, /unfrozen/);
  for (const entry of [manifest.schema, manifest.examples]) {
    const bytes = await readFile(entry.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.ok(!bytes.includes(13), 'published vectors use LF bytes');
  }
});
