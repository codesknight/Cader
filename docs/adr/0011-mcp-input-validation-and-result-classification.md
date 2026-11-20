# ADR 0011 — MCP input validation and scoped diagnostics

Date: 2026-11-20. Status: implemented for dev.3. Related: BUG-024, [#20](https://github.com/codesknight/Cader/issues/20), [12:32 audit](../validation/2026-11-20-user-log-1232.md).

Raw DSH/MCP ToolDefinition.parameters describes inputs but does not enforce them before execute. The integration previously assumed that schema forwarding was validation, causing a missing text height to reach MCP and a known parameter error to be classified as an unknown CAD write.

Use pinned Ajv 8.20.0 inside dsh-adapter, reusing JSON Schema rather than hardcoding drawing-tool required fields. Validate in the program MCP client and ExecutionSession before dispatch. Support draft-07, 2019-09 and 2020-12; unknown/unsupported schemas and asynchronous schemas fail closed. No remote schema fetching, coercion, inserted defaults or dropped arguments. See [schema dialects](https://ajv.js.org/guide/schema-language) and [data mutation options](https://ajv.js.org/guide/modifying-data.html).

The composite CAD patch exposes a tool-specific union of argument schemas. Validate the whole envelope and all leaf schemas before any patch operation. Dispatch remains serial through the original tool registry and execution owner, with permission/binding/geometric checks per call and stop-on-first-failure. This is schema preflight, not an atomic rollback transaction: later runtime, permission or supplemental geometric failures may still leave earlier confirmed operations committed.

Only the adapter's local ToolArgumentsError can establish failed_before_dispatch after a client-side rejection. No text matching, remote error code imitation or generic MCP isError proves absence of side effects. Unacknowledged remote/transport failures still freeze; acknowledged writes with failed readback retain the existing limited reconcile mechanism. Old persisted unknown locks are not migrated or removed automatically.

Expose scoped counts, cumulative session counts, the first frozen operation, explicit recovery eligibility and full-query cache freshness. A filtered query does not replace the full-query observation. COM not_probed and empty lifecycle document lists do not imply disconnection. Exact natural diagnostic/recovery requests use program-owned summaries; other model turns receive the same structured facts.

Separate recovery invocation completion from recovered=false. The CLI renders refusals explicitly and appends only application status after streamed replies. It no longer reprints an answer when the CAD task remains blocked. DSH/Cordis, permission modes and unknown-write protection are retained; the independent MCP repository is unchanged.
