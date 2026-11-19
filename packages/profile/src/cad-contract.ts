import { z } from 'zod';

export const CAD_CONTRACT = 'cader-cad/1' as const;
export const CAD_DRAFT_REVISION = 2 as const;
const Id = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);
const Units = z.enum(['unitless', 'mm', 'cm', 'm', 'in', 'ft']);
export const Mutation = z.enum(['create_working_document', 'execute_atomic_batch', 'save_document_as', 'reopen_document']);
const Point = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const Layer = z.string().min(1).max(128);
export const ExecutionPolicy = z.object({ version: z.literal(1), contract_version: z.literal(CAD_CONTRACT),
  allowed_operations: z.array(z.enum(['draw_line', 'draw_circle', 'draw_text'])).min(1),
  reviewed_plan_sha256: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1) }).strict();
const Line = z.object({ start: Point, end: Point, layer: Layer }).strict()
  .refine(args => args.start.some((value, index) => value !== args.end[index]), 'Zero-length line');
const Circle = z.object({ center: Point, radius: z.number().positive().finite(), layer: Layer }).strict();
const Text = z.object({ point: Point, text: z.string().min(1).max(2000), height: z.number().positive().finite(), layer: Layer }).strict();
export const Operation = z.discriminatedUnion('operation', [
  z.object({ id: Id, operation: z.literal('draw_line'), args: Line }).strict(),
  z.object({ id: Id, operation: z.literal('draw_circle'), args: Circle }).strict(),
  z.object({ id: Id, operation: z.literal('draw_text'), args: Text }).strict(),
]);
export type CadOperation = z.infer<typeof Operation>;
export const Plan = z.object({
  version: z.literal(1), purpose: z.enum(['geometry-fixture', 'image-redraw']),
  coordinate_mode: z.enum(['schematic', 'physical']), units: z.enum(['layout', 'mm', 'cm', 'm', 'in', 'ft']),
  scale_evidence: z.object({ source: z.enum(['user', 'dimension']), units: z.string(), value: z.number().positive().finite() }).strict().optional(),
  assessment_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  operations: z.array(Operation).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.operations.map(op => op.id)).size !== value.operations.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate operation ID' });
  if (value.coordinate_mode === 'physical' && (!value.scale_evidence || value.units === 'layout'
    || value.scale_evidence.units !== value.units)) ctx.addIssue({ code: 'custom', message: 'Physical scale evidence required' });
  if (value.coordinate_mode === 'schematic' && value.units !== 'layout')
    ctx.addIssue({ code: 'custom', message: 'Schematic plans use explicit layout units' });
});
export type CadPlan = z.infer<typeof Plan>;
const DocumentIdentity = { instance_id: Id, document_id: Id, revision: z.int().nonnegative(), units: Units };
export const WorkingBinding = z.object({ ...DocumentIdentity, managed: z.literal(true), read_only: z.literal(false),
  output_directory: z.string().min(1) }).strict();
export const VerificationBinding = z.object({ ...DocumentIdentity, managed: z.literal(false), read_only: z.literal(true),
  source_artifact_id: Id }).strict();
export type WorkingDocument = z.infer<typeof WorkingBinding>;
export type VerificationDocument = z.infer<typeof VerificationBinding>;
export type DocumentBinding = WorkingDocument | VerificationDocument;
export const Status = z.object({ contract_version: z.literal(CAD_CONTRACT), backend: z.literal('http'), instance_id: Id,
  revision_mode: z.literal('observed_database_events'), documents: z.array(WorkingBinding),
  capabilities: z.object({ managed_documents: z.literal(true), atomic_operations: z.array(z.string()),
    save_as: z.literal(true), reopen: z.literal(true), job_status: z.literal(true), query_entities: z.literal(true),
    max_batch_operations: z.int().positive().max(1000) }).strict() }).strict();
export const Job = z.object({ contract_version: z.literal(CAD_CONTRACT), instance_id: Id, request_id: Id,
  operation: Mutation, request_document_id: Id.nullable(), result_document_id: Id.nullable(),
  source_artifact_id: Id.nullable(), revision: z.int().nonnegative().optional(),
  status: z.enum(['succeeded', 'failed', 'pending', 'not_found']),
  outcome: z.enum(['committed', 'not_executed', 'rolled_back', 'unknown']),
  results: z.array(z.object({ id: Id, status: z.literal('succeeded'), object_id: Id }).strict()).optional(),
}).strict();
export const Artifact = z.object({ artifact_id: Id, instance_id: Id, document_id: Id,
  revision: z.int().nonnegative(), path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), byte_size: z.int().positive() }).strict();
export const SaveResult = z.object({ contract_version: z.literal(CAD_CONTRACT), request_id: Id, status: z.literal('succeeded'), artifact: Artifact }).strict();
export const ReopenResult = z.object({ contract_version: z.literal(CAD_CONTRACT), request_id: Id, status: z.literal('succeeded'),
  source_artifact_id: Id, document: VerificationBinding }).strict();
export const CreateResult = z.object({ contract_version: z.literal(CAD_CONTRACT), request_id: Id,
  status: z.literal('succeeded'), document: WorkingBinding }).strict();
export const Entity = z.object({ object_id: Id, operation: z.enum(['draw_line', 'draw_circle', 'draw_text']),
  args: z.record(z.string(), z.unknown()) }).strict();
export const EntityPage = z.object({ contract_version: z.literal(CAD_CONTRACT), instance_id: Id,
  document_id: Id, revision: z.int().nonnegative(), items: z.array(Entity).max(1000),
  next_cursor: z.string().nullable(), unsupported_geometry_types: z.array(z.string()) }).strict();
const RequestIdentity = { instance_id: Id, request_id: Id };
const Target = { document_id: Id, expected_revision: z.int().nonnegative() };
export const ManagedRequests = {
  get_backend_status: z.object({}).strict(),
  create_working_document: z.object({ ...RequestIdentity, units: Units, managed: z.literal(true), output_directory: z.string().min(1) }).strict(),
  execute_atomic_batch: z.object({ ...RequestIdentity, ...Target, operations: z.array(Operation).min(1).max(100) }).strict(),
  get_job_status: z.object({ request_id: Id }).strict(),
  query_entities_page: z.object({ instance_id: Id, ...Target, cursor: z.string().nullable(), limit: z.int().min(1).max(1000) }).strict(),
  save_document_as: z.object({ ...RequestIdentity, ...Target, output_path: z.string().min(1), overwrite: z.literal(false) }).strict(),
  reopen_document: z.object({ ...RequestIdentity, artifact_id: Id }).strict(),
};

export type StageStatus = 'not_performed' | 'succeeded' | 'failed' | 'blocked' | 'unverified' | 'unknown';
const Stage = z.enum(['not_performed', 'succeeded', 'failed', 'blocked', 'unverified', 'unknown']);
export const BusinessOutcome = z.object({ contract_version: z.literal('cader-task/1'),
  run_status: z.enum(['succeeded', 'failed', 'cancelled']), task_status: z.enum(['succeeded', 'failed', 'blocked', 'unverified']),
  blocked_reasons: z.array(z.string()), artifact: Artifact.nullable(), verification: z.enum(['not_performed', 'passed', 'failed']),
  authorization: z.object({ user_task_authorized: z.boolean(), write_authorized: z.boolean(), runtime_write_available: z.boolean() }).strict(),
  stages: z.object({ recognition: Stage, planning: Stage, execution: Stage, saving: Stage, reopening: Stage }).strict(),
  performed_actions: z.array(z.object({ operation: z.string(), status: z.enum(['submitted', 'confirmed', 'succeeded', 'outcome_unknown']),
    request_id: z.string().optional(), document_id: z.string().optional(), revision: z.int().optional() }).strict()) }).passthrough();
export function taskStages() {
  return { recognition: 'not_performed', planning: 'not_performed', execution: 'not_performed',
    saving: 'not_performed', reopening: 'not_performed' } as Record<string, StageStatus>;
}
function contractValidators(): Record<string, z.ZodType> {
  return { plan: Plan, status: Status, create: CreateResult, working_binding: WorkingBinding, verification_binding: VerificationBinding,
    job: Job, save: SaveResult, reopen: ReopenResult, query: EntityPage, business_outcome: BusinessOutcome, execution_policy: ExecutionPolicy,
    ...Object.fromEntries(Object.entries(ManagedRequests).map(([name, schema]) => [`${name}_request`, schema])) };
}
export function validateCadDto(name: string, value: unknown) {
  return contractValidators()[name]?.safeParse(value).success ?? false;
}
export function contractSchemas() {
  return Object.fromEntries(Object.entries(contractValidators()).map(([name, schema]) => [name, z.toJSONSchema(schema)]));
}

/** Compare actual query geometry, never the generating model's response or counts alone. */
export function verifyEntities(operations: readonly CadOperation[], entities: readonly z.infer<typeof Entity>[], tolerance = 1e-6) {
  // Unsupported geometric properties must be rejected, not silently dropped by a normalizer.
  if (entities.some(entity => !Operation.safeParse({ id: entity.object_id, operation: entity.operation, args: entity.args }).success)) return false;
  const close = (a: unknown, b: unknown): boolean => typeof b === 'number'
    ? typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= tolerance
    : Array.isArray(b) ? Array.isArray(a) && a.length === b.length && b.every((item, index) => close(a[index], item))
      : b !== null && typeof b === 'object' ? a !== null && typeof a === 'object' && Object.entries(b)
        .every(([key, value]) => Object.hasOwn(a, key) && close((a as Record<string, unknown>)[key], value)) : a === b;
  const remaining = [...entities];
  for (const op of operations) {
    const index = remaining.findIndex(entity => entity.operation === op.operation && close(entity.args, op.args));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0 && new Set(entities.map(entity => entity.object_id)).size === entities.length;
}
