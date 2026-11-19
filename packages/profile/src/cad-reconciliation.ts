import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Job, Mutation } from './cad-contract.js';

const Id = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);
export const RequestIntent = z.object({ draft_revision: z.literal(2), operation: Mutation, instance_id: Id, request_id: Id,
  request_document_id: Id.nullable(), source_artifact_id: Id.nullable(),
  prior_working_document_id: Id.nullable(), existing_document_ids: z.array(Id) }).strict();
export type CadIntent = z.infer<typeof RequestIntent>;

/** Hash these exact audit-envelope UTF-8 bytes; this is not the Bridge's native deduplication hash. */
export function auditCadRequest(operation: CadIntent['operation'], args: Record<string, unknown>) {
  const request_json = JSON.stringify({ operation, arguments: args });
  return { request_json, request_sha256: createHash('sha256').update(request_json, 'utf8').digest('hex') };
}

/** Input and output documents have different meanings for create/reopen versus batch/save. */
export function parseJobForIntent(value: unknown, intent: CadIntent) {
  const job = Job.parse(value);
  const same = job.instance_id === intent.instance_id && job.request_id === intent.request_id
    && job.operation === intent.operation && job.request_document_id === intent.request_document_id
    && job.source_artifact_id === intent.source_artifact_id;
  let outputValid: boolean;
  if (intent.operation === 'execute_atomic_batch' || intent.operation === 'save_document_as') {
    outputValid = job.result_document_id === intent.request_document_id
      || (job.status !== 'succeeded' && job.result_document_id === null);
  } else {
    outputValid = job.result_document_id === null ? job.status !== 'succeeded'
      : job.result_document_id !== intent.prior_working_document_id && !intent.existing_document_ids.includes(job.result_document_id);
  }
  if (!same || !outputValid) throw new Error('RECONCILIATION_IDENTITY_MISMATCH');
  return job;
}
