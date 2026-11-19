import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CAD_DRAFT_REVISION, contractSchemas, assessmentSchemas } from '@cader/profile';

const hash = value => createHash('sha256').update(value).digest('hex');
const schemaPath = 'configs/contracts/cader-v1.schemas.json';
const examplesPath = 'benchmark/fixtures/managed-cad-v1.cases.json';
const schema = JSON.stringify({ contract_version: 'cader-cad/1', status: 'Cader-side proposal; MCP implementation required',
  draft_revision: CAD_DRAFT_REVISION, schemas: { ...contractSchemas(), ...assessmentSchemas() } }, null, 2) + '\n';
const examples = await readFile(examplesPath);
await mkdir('configs/contracts', { recursive: true });
await writeFile(schemaPath, schema);
await writeFile('configs/contracts/cader-v1.manifest.json', JSON.stringify({ contract_version: 'cader-cad/1',
  draft_revision: CAD_DRAFT_REVISION, status: 'unfrozen; awaiting MCP confirmation',
  schema: { path: schemaPath, sha256: hash(Buffer.from(schema, 'utf8')) },
  examples: { path: examplesPath, sha256: hash(examples) },
  hash_encoding: 'SHA-256 of exact UTF-8 file bytes including final LF; not a semantic JSON hash',
  native_bridge_request_hash: 'unchanged; requires MCP profile mapping confirmation' }, null, 2) + '\n');
console.log('Exported draft schemas and exact-byte hash manifest. No MCP, model or CAD calls.');
