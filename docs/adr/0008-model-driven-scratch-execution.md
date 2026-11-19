# ADR 0008: Model-driven scratch CAD execution

Date: 2026-11-20. Source: user v0.3.0 execution instruction; [#18](https://github.com/codesknight/Cader/issues/18), milestone v0.3.0.

The previous natural-language path exposed only read-only tools; the separate reviewed-plan HTTP scheduler could write but the model could not request its actions. The user's new explicit instruction supersedes the old default-read-only requirement with default ask.

Keep DSH AgentLoop and Cordis. Install actual discovered MCP schemas into the main agent as wrapped tools. A persistent execution owner holds the MCP connection, serial queue, scratch binding, approval policy and fsynced audit. Reuse the existing shared workspace CAD lock. Only this connection's newly created scratch drawings are writable; COM's native connection checks the active document name before each operation. This is a conservative legacy binding, not the HTTP contract's instance/document/revision identity.

The existing fixed-plan HTTP scheduler and its strict reconciliation contract remain intact. The dynamic execution owner handles individual model-chosen operations without plan hashes. In the currently installed COM service, atomic batches, authoritative revisions, request reconciliation and controlled reopen are unavailable. Never advertise them based on discovered names alone. An uncertain mutation or failed write-after-query check freezes the shared lock; retain the original audit for manual reconciliation and never replay.

Queries run automatically. Ask requests concrete per-call approval. Workspace-write automatically permits scratch edits but asks for destructive actions and external save destinations. Full-access automatically permits actions within the exposed tool scope. Read-only rejects writes in code. Host Shell is a separate explicit escape from filesystem confinement, asks in ask/workspace-write, and is denied in read-only; shell deny removes it entirely. File tools enforce workspace/private-path/CAD-file boundaries and bounded text; skill content grants no authority.

Independent acceptance is outside the generating model: new MCP client queries, known expected geometry, native read-only color/vertices/document-path inspection and DWG file checks. A successful model answer remains unverified in the generic task report. Full app-profile, image reconstruction, controlled COM reopen and fault-injection acceptance remain separate work.
