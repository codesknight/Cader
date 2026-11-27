# Checkpoint and recovery
Use existing runtime persistence, not private-path access or fabricated tools. A logical checkpoint records task/source identity, source hash if available, target document identity, units/transform, plan version, region statuses, observation evidence, operation IDs and confirmed/unknown outcomes, verification evidence, and next ready region. Do not store secrets. If no durable API exists, state that resumption is not guaranteed.

On interruption or output truncation, resume only from recorded evidence. Verify source and document identity, reconcile unknown writes, revalidate dependencies and continue the next unfinished region. Confirmed operations must not be replayed. If a user changes scope, revise the plan and invalidate affected regions, not unrelated verified results.

For repeated errors, distinguish schema validation, missing visual evidence, permission denial, global gate, provider limit, backend failure and unknown write. Change strategy only when supported by evidence. Never relax safety gates. A blocked runtime must expose an authorized recovery route; if absent, report the exact blocker and preserve progress.
