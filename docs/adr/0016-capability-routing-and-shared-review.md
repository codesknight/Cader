# ADR 0016 — Scoped capabilities and shared visual review

Date: 2026-11-23. Work item: REQ-037 / [#20](https://github.com/codesknight/Cader/issues/20), Milestone 3.

The first house/tree transcript already contained an automatic visual review. The later main-agent denial lacked task evidence. Quality scheduling explicitly hid its visual entry, while the Available directory inspected registered tools rather than the step-admitted tools. Policy text was mistaken for a new drawing request.

Keep DSH/Cordis and the existing Scheduler. Project tools, registered Skills and configured workers into one descriptive catalog; use the assembly context's resolved toolSet for availability and reference actual tool schemas. Unavailable entries state why and never advertise an absent schema. The execution guard remains authoritative even after admission changes. Descriptions are metadata, never permission grants.

A main-agent review request in a quality task calls the same controller as mandatory fallback. The controller supplies immutable requirements, independent geometry and observed entity IDs; a model question cannot replace them. Cache is in-memory and task-local, keyed by task, connection, document, write counts, full entity digest, plan and source hash. It re-queries on reuse, coalesces simultaneous requests, and checks state before/after review. Invalid or stale reports are not reusable acceptance. A syntactically valid failed/clipped report may be reused as failure evidence, but cannot pass or authorize speculative edits. Native revisions and pixel mapping remain unavailable; no cross-task or restored-session cache adoption is allowed.

Task context is refreshed per model step with phase, requirements, checks, review attempts, latest image evidence and pending reasons. It marks write-invalidated evidence for recheck; historical manifests never authorize writes. Preference and visual-history inputs are application-routed without model/CAD calls. Generic continue rechecks an existing sealed task on the original connection; it cannot replay drawing. The visual preference is session-scoped and cannot disable mandatory gates.

Keep stable coordination, permission and evidence rules in MainAgent static text; CAD workflow knowledge moves to an explicit lazy Skill and vision gets a role prompt. This is not a new framework, universal intent classifier, or proof of reliable arbitrary-image reconstruction. COM identity/revision and capture-layout limitations remain open.
