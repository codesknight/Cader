---
name: progressive-drawing
description: Plan and incrementally draw or reconstruct complex CAD drawings using bounded regions, shared anchors, local verification, evidence-driven repair and resumable progress. Grants no tools or execution authority.
---

# Progressive Drawing

## Current Cader bindings
The Harness selects this skill for large references or complex/staged drawing. Use only entries actually present in Available. `cader_submit_progressive_plan` declares scope/dependencies/shared anchors; `cader_split_progressive_region` refines an unexecuted region. `cader_quality_diagnostics` exposes task-scoped errors without reading private directories. `cader_finish_drawing_unit` requests regional checks, not task completion. `cader_review_cad_view` and mandatory Harness checks share eligible regional evidence.

Source observers submit an explicit normalized BASE-crop frame; the Harness performs crop-to-source and source-to-CAD transforms. Main CAD operations use the supplied shared CAD frame, never locally rescaled coordinates. An independently agreed geometric subset is a **partial draft**, with omitted content and topology still pending; `partial_verified` cannot satisfy complete source coverage. A Skill grants no execution rights.

## Activation
Use for complex reference redraw, multi-part CAD creation, dense drawings, explicit requests to draw in stages, or recovery from repeated whole-drawing analysis failures. For simple primitives, use the normal short workflow. For analysis-only requests, produce analysis artifacts without CAD writes. Apply across architectural, mechanical, electrical and general CAD tasks; load domain-specific knowledge only when needed.

## Operating principles
- Plan globally; resolve details locally; integrate and verify globally.
- Preserve user scope, source identity, target document identity, units and authorization. Do not modify a previous task's document by default.
- Never bypass Harness gates, approval, frozen-write barriers, or independent verification. A skill is guidance, not authority.
- Treat uncertainty as explicit data. Do not invent dimensions, symbols, topology or unreadable annotations. Pixel scale is not a physical unit without evidence.
- Prefer small evidence-backed batches to a single large response or patch.
- Automatically verify after each meaningful committed batch when authorized; do not wait for a user to request verification.
- Never claim completion from model text, a tool dispatch, or a partial artifact alone.

## Procedure
1. Identify task intent (analysis, fresh drawing, append, repair or resume). Inspect available capabilities and task state. Reuse an existing checkpoint only if source, scope and document identity match.
2. Read the overview once. Identify global bounds, shared geometry, coordinate transform, scale uncertainty, and candidate regions or semantic parts. Do not attempt exhaustive component recognition at this stage unless required by an existing gate.
3. Create a bounded task plan with region IDs, source bounding boxes, dependencies, shared anchors, intended outputs and local acceptance criteria. Use existing planning/persistence interfaces if available; otherwise retain a concise explicit plan and report that it is not durable. Consult `references/task-decomposition.md` when needed.
4. Establish an authorized isolated target document and shared frame. Check document identity and units before writes. If shared geometry is uncertain, defer dependent regions. Do not create a new document for analysis-only requests.
5. For each ready region, run the loop below. Parallelize read-only analysis only when supported; serialize writes to the same document unless the runtime explicitly guarantees safe transactions.
6. Integrate verified regions, reconcile overlaps and shared anchors, validate cross-region topology and global layout. Perform final independent checks, save and reopen when supported. Report draft/partial/unverified status when evidence is incomplete.

## Region execution loop
When the runtime exposes `cader_source_worklist` / `cader_apply_source_batch`, use the frozen ID worklist rather than recounting the region. Choose spatially coherent IDs (the suggested subset is advisory), let Harness compile the original-pixel transform, and continue only pending/accepted items. Native/visual checks remain mandatory. A committed item awaiting verification is not a missing item to redraw. Use the controlled CAD review entry to check it. Unknown outcomes require reconciliation.

The local line-art index separates graphic reproduction from engineering interpretation. Isolated OCR glyphs or stacked typesetting may remain editable native paths instead of guessed TEXT. This preserves source appearance but does not prove a recovered literal, netlist, BOM or functional design. Explicit semantic tasks keep their semantic gates. Whole-image residual checks and final independent visual acceptance are still required; completing the candidate list alone is insufficient.

- OBSERVE: inspect original-resolution crops with source-coordinate mapping; reuse prior observations; identify unresolved details.
- PLAN: make a bounded patch or operation batch, with expected entities/relations and affected scope. Validate geometry, dependencies, target and authorization.
- ACT: use only actual registered and authorized CAD tools. If a region-level write is not permitted, continue useful authorized analysis or request runtime recovery; do not pretend to have drawn.
- VERIFY: query actual entities and capture the drawn region. Compare to independent source evidence, including geometry, labels, connectivity when relevant, and visual appearance. Tool success alone is insufficient.
- REPAIR: use concrete discrepancy feedback to make a minimal correction, then verify again. Preserve previously verified unrelated regions.
- CHECKPOINT: persist accepted observations, operation outcomes, verification evidence and remaining work through available trusted interfaces. Consult `references/checkpoint-and-recovery.md`.

For scoped source observation/OCR, read `references/source-observation.md`; global planning guidance is not an instruction to inventory the whole drawing in a worker.

For Cader partial drafts, Harness compiles acceptance from independently agreed traces; do not invent a broader checklist. Scoped analysis uses the declared BASE frame; indexed label OCR does not relocate labels. During visual review follow the supplied entity-bound scope and actual native closeups; see `references/verification-and-repair.md`.

## Failure handling
Do not repeat identical failed submissions without new evidence or changed inputs. For a repeated failure, obtain sanitized diagnostics, inspect schema and scope, then split the region or switch analysis strategy. If feedback is inaccessible, report the exact error and missing diagnostic interface. Do not guess validator requirements. If a global gate blocks local execution, preserve useful analysis and report the runtime limitation; do not bypass it or claim partial CAD success. Unknown write outcomes require authoritative reconciliation before any retry. Never replay confirmed writes. Stop automatic retries when budget is exhausted or progress cannot be demonstrated. Ask the user only for essential ambiguity, authorization or unrecoverable external dependencies.

## Verification and delivery
Consult `references/verification-and-repair.md`. Distinguish planned, analyzed, written, verified and delivered states. Give the user verified progress, remaining regions, uncertainties and artifact paths actually returned by tools. If final acceptance fails, retain the draft and state why. Do not present an unverified engineering reconstruction as a construction-ready drawing.
