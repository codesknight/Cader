# Cader CLI User Guide


**English** · [简体中文](README.zh-CN.md) · [Project home](../../README.md) · [Documentation](../README.md)

**Applies to Cader 0.4.0-dev.17 · Updated 2026-11-28**

## dev.17: source worklists for large line drawings

Large (at least 8 million pixels) monochrome reference redraws can use a local OCR/path proposal index when the optional vision environment and updated AutoCAD-MCP `draw_polyline.width` / `draw_text.fit_box` support are available. Install explicitly from the repository: `uv sync --project cader-mcp --extra vision`; startup never installs packages. Missing dependencies or unsupported color imagery use the existing progressive observation flow. Simple drawings load no index. Tasks explicitly requesting engineering analysis, a netlist or BOM retain semantic verification.

The Agent chooses region order and stable source IDs. Harness compiles coordinates, uses the existing whole-Patch admission/permissions/serial writer, and verifies native geometry and actual rendered batches. Only unfinished IDs continue on the original live binding; committed/unknown requests are never replayed. Isolated OCR glyphs and unsupported stacked text remain editable native paths, with semantic interpretation unverified. Source proposals and residual scores cannot accept the task: full coverage, native readback, controlled visual review and requested DWG checks remain required. Local optional dependencies are separate from the AutoCAD-MCP conda environment. See [research, implementation and actual evidence](../development/2026-11-27-source-worklist-research.md).

Indexed construction returns compact acknowledgements for direct CAD writes as well as source batches. Full native postflight remains in the execution audit and independent verifier; creating a layer does not copy the entire drawing into model history. Explicit entity queries retain their native results. This changes context projection, not verification or permission checks.

Read-only closeups share a fresh native snapshot before and after the bounded observation group. Full-source windows are reviewed in groups of at most eight, with every window still required. Observations cannot accept an item or region before the fresh post-query; changed geometry, local writes, connection/target changes, frozen state or failed readback prevent acceptance. Native COM revision remains unsupported; this is guarded snapshot comparison, not an authoritative revision counter.

Batch native observations query the exact submitted IDs; they cannot replace the full-document count/cache. Full checkpoints still query and verify all known committed/verified source entities, including earlier batches, and reject unexpected entities. Region primitive completion and immediate round handoff may reuse the exact guarded full snapshot for at most five seconds, preserving its original timestamp; expiry or changed identity/operation count requires a new full read. Full-source windows and final acceptance retain fresh full reads. A name-only layer request reuses a fresh `list_layers` match without native creation (`native_creation_dispatched: false`); explicit color changes still dispatch and verify.

Indexed primitive closeups retain at least ten original source pixels of context on each side, and at least twice the native stroke width. This prevents a one-pixel residual stroke from filling the entire viewport. Entity IDs, exact native geometry checks and final paired full-source windows remain mandatory; framing changes do not modify geometry or constitute acceptance.

Confirmed indexed entities awaiting primitive evidence take priority over another drawing batch in the same region. Harness performs at most two additional read-only observation passes at that native write frontier; this does not consume CAD repair rounds or replay creations. Unresolved evidence blocks the region. Source recommendations can fill 64 spatially bounded IDs across the 32-item display pages; the Agent can still choose a different subset/order, with the same admission checks.

If the local source helper fails, the task pauses with its actual helper error and a private diagnostic containing bounded stderr and exit status. Explicit resource failures are reported separately. Harness stops further model/region retries and automatic SaveAs; it preserves the task rather than declaring the reference unreadable. After repairing resources/dependencies, `/quality resume` requires the original live connection and binding. This does not authorize inheriting an old drawing after a process exit. Fixed local CV workers use one numerical-library thread and receive no model credentials.

## dev.16: named source views

Scoped source workers submit positions in BASE, DETAIL_n or a returned LOOKUP_n image, using that image own normalized 0..1 coordinates. Harness owns the transforms; original dimensions and crop origins are withheld from these workers. Their crop tool also uses BASE normalized coordinates; global image viewing keeps its original-pixel interface. Crop slots cannot be rebound or expand the source scope. Dense unexecuted regions can refine within bounded depth, area and region-count limits; verified batches and whole-drawing acceptance remain distinct.


Region uncertainty and boundary-net reviews expose the same bounded high-resolution crop entry (at most two views per stage). Anchor locations are converted to BASE by Harness. A draft-text geometry failure reports actual native bounding boxes and the admitted source bounds; visual readability alone cannot override misplaced text.

A confirmed label-count overflow may refine a smaller unexecuted source region within depth 6, minimum pixel-size and the existing 64-region cap. It does not raise the observation label limit or waive coverage.

## dev.15: Request recovery and target checks

DSH retries a failed open model request at most twice for TRANSPORT/TIMEOUT/SERVER/RATE_LIMIT/EMPTY_RESPONSE. It preserves confirmed tool history, discards failed-stream tool calls and accumulates task time/tokens. QUOTA/auth failures are not retried. Exhaustion pauses the task with preserved progress instead of treating a provider failure as an unreadable region. geometry_only reports require per-target checks. Independent source/vision workers can read role-authorized registered skills; permissions are unchanged.

## dev.14: scoped source and native visual checks

Scoped analysis uses the BASE crop frame. Indexed label OCR reads a fixed location without resubmitting bounds. A partial-draft checklist is compiled from independently agreed traces; whole-source coverage stays pending.

Batch reports bind the actual document, snapshot, scope ID and entity IDs. Native WCS-window PNGs and small-text closeups require the updated AutoCAD-MCP; unsupported services leave verification pending, never claiming an enlarged extents image is native high resolution. Window, actual pixel dimensions, hashes and restored plot state are checked. Unobservable pixels without proven geometry defects retain REGION_VISUAL_EVIDENCE_UNCERTAIN rather than triggering blind repair loops. `/quality` and same-connection `/quality resume` retain evidence; unknown outcomes and cross-process ownership rules remain enforced.

A partial draft checks independently admitted primitives and text. Unobserved stroke weight, fill, color, font style and complete topology remain pending for later acceptance. Small text and tiny primitives receive up to three native close-ups from actual bounding boxes. Independent source/vision workers do not inherit another region’s stale capture state.

A background line may cross a local image edge. It does not block the batch only when verified native window settings match the scope and all declared target bounding boxes lie inside. Visual and geometry checks must still pass.

A geometry_only local report must provide per-entity geometry_checks for visibility, text readability or expected absence, consistent with its scoped verdict. Harness keeps full-source style, coverage and topology pending separately. Actual unobservable targets remain pending.

## Progressive complex drawing (dev.13)

Batch review receives only committed batch requirements/entities; regional and final review retain the full original request. An unbuilt canopy is not a defect in a trunk-only batch. Batch handoff does not request full-region acceptance. Two unchanged read-only preparation slices (up to 12 DSH model steps each) are allowed; the third consecutive slice with no entity or confirmed-operation progress stops safely. Confirmed layer setup counts as progress.

Optional `generation.progressive_reasoning_effort` in `configs/models/MainAgent.yaml` applies to bounded progressive decomposition, local planning and drawing/correction (`off` in this configuration). Ordinary MainAgent requests retain `reasoning_effort: low`, with the same 8192 output limit. Omit it to inherit the ordinary setting. `model.route` records the request; this setting neither replaces verification nor guarantees against truncation.


`progressive-drawing` is a registered, read-only workflow skill for MainAgent and VisionAgent. A reference of at least eight million pixels, an explicitly complex request, or staged/region-based drawing selects it automatically. Simple drawings keep the short workflow. Catalog descriptions remain available; skill text and decomposition, verification or recovery references load by stage, with resource hashes in `skill.loaded`. Skills grant no write authority.

If an initially short reference workflow fails its semantic source Gate before any native writes, Harness may select the progressive skill once on the same task/runtime without resetting budgets. It never adopts earlier CAD progress or retries provider/budget failures through this route.

Harness obtains a full-scope region plan (explicit rectangles or program-derived cells from model-selected cuts), authorizes a new owned document under the existing policy, then observes and draws each region. Every effective batch receives native readback, structural checks and actual vision review. Failure returns control to Scheduler; local corrections allow at most three attempts. Unrecognized regions may split. Geometry agreed by two independent source readings can form a **partial pending draft**, never complete coverage. Acceptance still requires all regions, shared boundaries, cross-region conditions and requested DWG delivery proof.

On the same live connection, `/quality resume` verifies the original request, source/plan hashes, document, confirmed ledger and fresh native state before continuing unfinished progressive regions. Verified regions are skipped; budgets, visual evidence and correction counts persist. Restart, reconnect, external document changes, unknown writes, readback failure or checkpoint failure cannot automatically resume writing. Checkpoints use a temporary file, fsync and rename; failures retain the old checkpoint and temporary evidence.

```text
Create a new drawing and reproduce this complex reference in regions: D:\CAD\source.png. Save the completed drawing to D:\CAD\result.dwg.
/quality
/quality resume
```

The cumulative scheduled-task limit `max_task_model_steps: 400` is separate from ordinary `max_model_steps: 100`. Default total duration remains 30 minutes; token/tool/CAD/round limits still apply. An explicit `max_task_duration_ms` may allow up to 24 hours (for example, `21600000` for six hours); resumption preserves the original start and totals. The higher configurable ceiling grants no automatic time or token allowance. Source/visual allowances are bounded per region and also share task-wide usage limits. Large references may remain pending because of unresolved source facts or total budgets. Skill registration does not prove arbitrary large-drawing reconstruction. See [actual regression and limitations](../validation/2026-11-27-progressive-drawing.md).


The original two-task P1 client regression passed: house 6/6 and complex sketch 13/13, with 37/83 entities in the actual read-only verification documents and independent native checks; the circuit also passed eight-net/nine-label validation.

2026-11-26 ordinary COM file-artifact P1: a capable MCP saves DWGs in an exclusive `artifact-*` subdirectory of the requested parent. Use the returned actual path; the original intent is retained as `requested_path`. Files are not overwritten or moved back. Later saves on this working document keep the original requested parent. COM SaveAs changes its label/FullName without transferring lifecycle identity.

The main Agent can call `cader_verify_dwg_artifact`; the Harness also verifies delivery before completion. Only the current authorized task's registered artifact is eligible, with no arbitrary path/document arguments. Verification documents remain separate, read-only and unmanaged. Repeated verification queries the registered document rather than reopening it again. `/quality` exposes the actual path, SHA, delivery state and `legacy_summary_partial` scope; file-verification counters are separate from CAD writes. Unknown file dispatch and ACK-after-observation failure retain a barrier that geometry recovery cannot clear. A proven pre-dispatch refusal can be retried against the same artifact. Older services retain legacy saves with no independent-reopen claim. [Integration and joint validation](../validation/2026-11-26-com-artifact-p1-integration.md).


Final live regression (b062b51): the original red-roof/blue-wall/tree case passed 7/7 and the original complex sketch 12/12, including automatic quality checks and independent read-only DWG reopening. Original drawings and old barriers remain intact. [Results and limits](../validation/2026-11-25-p0-quality-fixes.md).

The current P0 patch adds these behaviors; full live-regression results are tracked separately:

- A complete custom reference-schematic plan must share one global axis scale/translation with the source observation. Components, pins and label guides use the same transform. Drift is rejected before CAD dispatch; `source_layout:true` remains available. Arbitrary per-component rearrangement or rotation is not supported by this entry.
- When required deterministic checks pass but vision remains uncertain, Harness permits one additional evidence review using the same verified capture. Original reports remain intact; the program does not force a pass. Remaining uncertainty stays pending.
- `/quality accept [review comment]` is a user-only final-DWG review entry. Explicit natural-language manual-review declarations use the same confirmation flow. The terminal proactively asks for review when a verified DWG has only visual conditions unresolved. CAD-tool approval does not count as human acceptance.
- Human acceptance binds the task, original automatic manifest, source/image evidence and DWG hashes. Changed files or evidence invalidate it. `/quality` shows automatic and human results separately. Acceptance covers only the delivered DWG; it grants no continuation authority, does not clear unknown barriers and cannot override structural failures. File review after restarting does not adopt an old CAD document.

2026-11-25 human acceptance: the user inspected both final DWGs and confirmed no issues. Their hashes still match the regression artifacts; both deliverables are now human-accepted. Historical automatic visual uncertainty is retained separately, without claiming a model pass or treating it as proof of a final drawing defect. Those historical cold-start and coordinate-frame defects are addressed by the current P0 patch; see [the current validation report](../validation/2026-11-25-p0-quality-fixes.md) for actual live results. [Human acceptance and automatic history](../validation/2026-11-25-original-joint-regression.md).

Recorded automatic regression (14ada93): the warm house/red-roof/blue-wall/tree case passed 7/7 and independent DWG reopening. Cold new-document creation failed during MCP name observation. The original circuit passed eight-net/nine-label/native-DWG checks, but visual layout acceptance remains pending. That historical version did not consistently remap source-projected label guides. The current patch adds shared-frame validation; the historical defect is not a description of current code. The read-only receipt contract passed 7/7 with an active document, which is separate from drawing acceptance. [Current results and open defects](../validation/2026-11-25-original-joint-regression.md). Earlier original-circuit success refers to another historical run.

2026-11-25 execution evidence: when a COM server advertises `autocad-backend-evidence/1`, the execution owner selects its new receipt entrypoint per operation. Models retain the controlled CAD tools. Requests are persisted before dispatch; instance/document/request identity, native ACKs, observation stages and affected entity sets are checked. Uncovered operations such as polylines and layers retain their legacy entrypoints with working-document identity checks, without equivalent receipt guarantees. Old servers remain compatible. Broken advertised contracts fail connection; a failed dispatch never falls back to another mutator.

Document names are labels. Different IDs with the same name block writes; SaveAs on the same ID does not transfer ownership. Status distinguishes cached labels from the last explicit identity observation. COM revision remains unsupported. New drawing creation does not require an active document; only a verified working document created by this connection gains write authority.

| Valid receipt evidence | Execution behavior |
| --- | --- |
| `not_dispatched`, no native invocation or claimed effects | Pre-dispatch failure without freezing; corrections use a fresh request ID |
| All native actions ACKed, then `observation_failed` | Committed with failed observation; read-only reconciliation requires the original connection/document |
| Missing ACK, contradictory/foreign/missing receipt or dispatch timeout | Unknown and frozen; no replay or automatic unlocking |

With this contract, the main Agent can call `cader_cad_execution_status` to read its original current-connection request; it cannot supply an arbitrary request ID. The terminal states that this is read-only and leaves the barrier unchanged. Missing, expired, restarted or foreign records never prove non-execution. This entry does not automatically promote unknown outcomes. Capture still requires the independent plot-state restoration receipt; an execution ACK does not replace it.

Opt-in contract check: `pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --execution-evidence`. It uses no paid model, valid drawing operation or existing-document adoption. It performs real discovery, explicit read-only binding observation, deliberately invalid pre-native admission and journal negative checks. Without an active document, binding checks remain unevaluated and the command exits nonzero while retaining the other results. This is not drawing or quality acceptance. [Implementation, actual results and limits](../validation/2026-11-25-cader-execution-evidence.md).

2026-11-25 validation: the original complex reference circuit passed 12/12 checks with real models and AutoCAD, including safe response/budget continuation. Independent native DWG-copy reopening, eight nets, nine human-confirmed labels and source-symbol outline checks passed. This is one assisted reference case, not general OCR/physical-scale certification. Default CLI saving checks headers/hash/post-save CAD; native reopening was an additional regression check. [Evidence and limits](../validation/2026-11-24-reference-circuit-fix.md).

dev.12: reference circuits use model-planned components, named pins and external netlists, including branches and three-terminal devices. Harness schedules component, net and label units with readback checkpoints; all units still require independent geometry, topology, source-image and DWG acceptance. A unit check-in is progress, never task acceptance. The terminal reports unit progress and truncation retries.

Source-label units receive transformed placement boxes and font-size guides; check actual CAD text bounds and keep labels clear of symbols. Punctuation-only polarity/arrows are component details and are not redrawn as duplicate label units or imposed as unrequested literal-text counts. Active units receive their own data without repeating the full source report; the complete evidence remains on disk.

For reference schematics, explicit label confirmations are scheduled in batches of at most four, followed by connection confirmation and acceptance planning. The internal planning tool can select `source_layout:true` with its requirements instead of copying the complete source graph. This reuses model-observed objects/net groups, records any projection of approximate image ports onto component boundaries and applies the same plan checks before approval. It is a semantic layout reference, not a CAD operation sequence or physical scale; full custom plans remain supported.

Each component also receives its original `source_appearance` and sealed `appearance_requirements`; an abstract component kind must not replace the observed outline, fill, polarity or arrow with a merely similar convention. Visual models can still miss such differences; a passed model report alone does not prove exact symbol fidelity.

Every drawing unit receives the sealed measurable requirements and required layer names. Setup creates those layers; symbol/label work follows the plan's explicit layer constraints. Example names such as TEXT or SYMBOL do not override the accepted plan.

The per-response output limit remains 8192 tokens. Drawing/correction truncation, malformed model responses or model-response timeout permit at most two recovery attempts per verified drawing unit (two task-wide when no units exist): persist the ledger, verify the original connection/document and read back entities, then generate only missing short batches (at most eight operations per quality-task Patch). Native CAD timeouts are not replayed. Unknown writes, failed readback, changed bindings or exhausted total budgets stop continuation. Units share round allowances instead of resetting them. Internal source inspection has separate reservations bounded by its existing stages (at most 48: two partial-draft observations, two initial reads, one component inventory, two net reads, one label inventory, eight first-pass batches and 32 single-label retries). These are not Agent delegation slots. Final visual review retains its own capture/format limits, while all phases share the same task token/time/cost budget. Controlled visual exceptions save only a pending draft when the original binding, known writes, fresh guarded readback and file protection permit; unknown writes still stop saving.

Planning confirmation units share execution-round allowances instead of resetting them. CAD visual reports have at most two formatting attempts with up to four model requests each, reusing the same capture; a still-invalid report remains pending.

Default task limits are 400 cumulative model steps, 30 minutes and 16 explicit Agent delegations; cumulative tool/CAD/token limits and individual API timeouts still apply. Continuation is in-process only; `/quality resume` can continue unfinished progressive regions on the original live binding; other tasks retain verification-only behavior.

Before tracing schematic nets, an independent full-image component inventory checks position/port coverage, including unlabelled symbols. Existing pin indices are preserved; missing components are added with unresolved connectivity until traced. Unmatched prior components block drawing with `SOURCE_COMPONENT_INVENTORY_FAILED`. This check is separate from label inventory and cannot guarantee every visual interpretation.

Batch label rereading returns index/text/certainty without redefining image boxes. Single-item review may refine original-image bounds. Each reading permits up to three model requests; exhausted format repair preserves uncertainty. A later explicit user confirmation can resolve the task evidence while the failed reading/status remains recorded as human-resolved, never OCR success. Supplementary source crops are limited to two per reading.

The two label inventories are associated one-to-one. Independent inventory boxes remain the crop targets; shifted old boxes do not grow across neighboring labels. Case folding is used only to associate readings: conflicting case-sensitive values remain uncertain and must be reread or actually confirmed.

An independent source-net review checks terminal groups; a separate full-image inventory preserves every label occurrence. All labels are reread in batches of at most four, uncertain first, with one wider-context retry for unresolved crops. Unreadable labels/connections remain pending. `series_cycle` is reserved for explicit simple two-terminal series loops. Netlist verification checks queried straight-wire connectivity: interior crossings do not join automatically, and declared interior junctions need actual small circle markers. It does not simulate transistor behavior or certify electrical functionality.

Clear source observations that disagree must use the existing bounded local adjudication before drawing. A corroborated original can be restored; an unsupported changed grouping cannot silently become the contract. Historical disagreement still requires final source-fidelity review. If a clear final source partition contradicts the frozen plan, Scheduler saves a pending draft instead of attempting geometric edits toward that contract, even when native geometry has not yet passed.

A clear source rereading may correct an initially uncertain relationship while unrelated uncertainty stays pending. Only relations clear in both observations count as hard conflicts; bounded local rereading preserves already established clear groups.

Source-net review exposes a dynamic `membership` schema requiring every known terminal key exactly once; the program derives net groups and validates added component terminals. `SOURCE_NET_REPORT_INVALID` means the review failed to produce a valid structured report, not that the source image was proven ambiguous. `SOURCE_TOPOLOGY_UNCERTAIN` remains separate for unresolved source relationships.

When final source-topology fidelity is required, Vision reports original-image pin groups in `source_topology`; the program compares them with the CAD groups and native verification state. A clear matching source map and verified CAD contacts cannot be contradicted by demanding extra dots at T joints or pixel proof of microscopic CAD gaps. Genuine source uncertainty/mismatches still block acceptance. Overlap defects include wire IDs and intervals for local correction. Planning has up to two supplementary source crops per run; the attached image and independent observations remain available.

Explicit label clarifications may accompany the original request. The program records the submitted quote, source hash/position and original OCR reading; human confirmation is not reported as OCR success. An uncertain net is not a proven disconnection: a candidate may continue only when other clear terminal relations agree, and must pass the dedicated `source_topology_fidelity` image comparison. Clear conflicts or unresolved final vision still prevent completion. Final review includes relevant original-image details and coordinate transforms alongside the same CAD capture.

When the request contains a clarification, planning must review every remaining uncertain label. An explicit label clarification (`补充确认`, `标注确认` or `label clarification`) additionally requires reviewing all required labels, including clear OCR readings; genuinely uncovered indices need reasons and keep their original certainty. Quote binding is serialized and rolls back on persistence failure. Applicable values require exact user-quote bindings; uncovered indices need explicit `unconfirmed` reasons and remain pending. Source-inspection events are immutable snapshots. Image symbols do not imply a requirement for CAD block references; unrequested block-count gates are rejected before drawing.

For an ambiguous source connection, append `connection confirmation:` (or `连接确认：`) and your confirmed relationship to the request. Before sealing the plan, the Agent must bind the exact quote and source pins through `cader_confirm_source_connections`, or record why it cannot apply. Only confirmed merges are supported; unrelated uncertainty remains pending. Independent source review receives these confirmations and retains its raw reading separately. Human confirmation does not clear an unknown CAD write, authorize adopting another document, or imply unassisted image recognition.

For circuit redraws, “hand-drawn” identifies the source medium. Rough strokes and handwritten fonts are output requirements only when explicitly requested. Independent final vision compares the actual source and CAD images; preliminary model opinions are withheld to reduce anchoring.

If a queued Patch encounters a proven pre-dispatch rejection after budget renewal, the model receives its actual partial results and may replan missing operations. This requires the original connection/document and an unfrozen execution ledger; confirmed leaves are never replayed. Uncertain native outcomes still stop execution. Failed reservations remain spent.

Symbols must actually reach their declared ports; a polyline bounding box is not endpoint evidence. Proven coincident ports may touch directly without a zero-length wire. A final Patch may request program readback/check-in with `unit_complete`, avoiding an extra model request; missing contacts return acknowledged results and missing items for continuation without replay.

Cader CLI is a CAD agent terminal built on DeepSeek Harness. Describe tasks in a persistent conversation, select models and skills, reference images, inspect CAD status, or use a single command from a script.

This guide is versioned alongside the implementation. Proposed features are tracked in the [roadmap](../development/roadmap.md).

dev.11 separates visual business results from control handoff: `× cader_review_cad_view` means visual defects; `!` means capture/readback failure, an invalid report, clipping or uncertainty. Only a valid pass report receives `✓`, and independent Harness task acceptance still applies. `/quality` and historical status distinguish capture attempts from admitted vision-model request steps; failed captures do not count as vision calls, and these counters are not billing receipts.

With the updated independent AutoCAD-MCP, capture preflights before changing plot state and verifies restoration by readback. Only complete evidence matching this request, drawing and path can classify an unchanged/fully restored failure as pending without freezing. Other outcomes remain protected. Capture currently requires the model layout; paper layouts are rejected before changes, without switching user layouts. Restart the CLI and its MCP child process to load the update. Historic unknown barriers remain intact and old drawings are never automatically adopted. See [real original-house regression](../validation/2026-11-24-capture-restoration-fix.md).

dev.10 quality tasks automatically renew execution rounds within the original process: stop new dispatch, read and checkpoint progress, then continue on the same task, connection, drawing and grant. A Patch reserves its wrapper and all leaves before any mutation. An insufficient round admits none of its leaves; Scheduler dispatches only never-dispatched requests through the original tools before fresh model reasoning. Confirmed or unknown writes are never replayed. Changed bindings, failed readback or unknown writes stop continuation. Failed vision or post-review readback immediately returns control to Scheduler.

In [`configs/runtime.yaml`](../../configs/runtime.yaml), `max_tool_calls: 100` limits each execution round. `max_task_tool_calls: 600` counts total tool reservations, including Patch wrappers/leaves and vision tools. `max_cad_operations_per_round: 64` and `max_cad_operations: 400` limit round/task CAD writes. Reservations precede dispatch and do not mean entities committed. `validation_tool_reserve: 8` protects validation capacity. Patch schemas adapt to round capacity, at most 32 operations. Total limits do not reset: `max_execution_rounds: 12`, `max_task_model_steps: 400` and the default 30-minute task duration apply across rounds; `max_model_steps: 100` remains the ordinary invocation limit.

`max_task_tokens: 2000000` stops later requests using reported provider usage as a cost proxy, not an exact currency cap; it cannot undo an in-flight paid request. The CLI shows checkpoints, automatic renewal and total-limit pauses. The task's private `quality.json` retains observations, connection identity, confirmed operations, never-dispatched requests and budget counts. A paused task has not passed acceptance. Renewal is in-process only; restarting never restores write authority. `/quality resume` continues unfinished progressive regions or safely rechecks other tasks on the original binding, without replaying confirmed drawing or bypassing barriers.

Explicit live validation: `pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --round-cad-budget 4 --task "Create a new drawing with 10 separate circles and verify it"`. `--round-cad-budget` is valid only with `--quality`, accepts 1–64, and reduces this test's round CAD allowance; the report also requires actual automatic renewal. This uses paid models and real AutoCAD in a private test workspace. See [implementation and evidence](../validation/2026-11-24-budget-continuation.md).

## Contents

- [Install and launch](#install)
- [Your first session](#first-session)
- [Interactive commands](#slash-commands)
- [References, keyboard shortcuts and Shell](#interaction)
- [Model, MCP and Skill configuration](#configuration)
- [Single commands and scripting](#commands)
- [Sessions and data](#sessions)
- [CAD capabilities and verification](#cad)
- [Troubleshooting](#troubleshooting)
- [Updates and feedback](#updates)

<a id="install"></a>

## Install and launch

### Requirements

| Dependency | Requirement |
|---|---|
| Node.js | 24.9.0 or newer |
| pnpm | 11.28.5; the examples below assume Corepack is available |
| Git | Fetch and update the source |
| AutoCAD and AutoCAD-MCP | Only for real CAD operations; keep the MCP environment separate |
| uv / Python | Optional Python MCP diagnostics |

Cader currently uses a **source build and local launcher**. A public `npm install -g` package has not been released. Terminal startup, help and offline smoke need neither a model credential nor AutoCAD.

### Windows PowerShell

With a supported Node.js already on PATH:

```powershell
git clone https://github.com/codesknight/Cader.git
cd Cader
corepack.cmd enable
corepack.cmd prepare pnpm@11.28.5 --activate
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
.\cader.cmd
```

The `.cmd` entry avoids PowerShell resolving `pnpm` to a blocked `pnpm.ps1`. You do not need to relax the execution policy.

To type `cader` directly, install the launcher into a user-writable directory **already on PATH**. Use this example only if that user directory is on your PATH:

```powershell
pnpm.cmd run cli:install --bin-dir "$env:USERPROFILE\.local\bin"
cader --version
cader
```

The installer does not change PATH, overwrite an unrelated launcher, or install alongside a potentially shadowing `cader.ps1`. Otherwise, keep using `.\cader.cmd` in the repository.
The launcher points to this checkout; reinstall it after moving the checkout. A previously provisioned `.cader/tools/node-v24.9.0-win-x64/node.exe` can be selected by the Windows launcher; a fresh clone does not download it automatically.

### Linux / macOS

```sh
git clone https://github.com/codesknight/Cader.git
cd Cader
corepack enable
corepack prepare pnpm@11.28.5 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm exec cader
```

The remaining examples use `cader` for the installed entry. Without a global launcher, substitute `.\cader.cmd` on Windows or `pnpm exec cader` on Linux/macOS. Run commands from the repository root unless changing the interactive workspace.

<a id="first-session"></a>

## Your first session

Create a root `.env` only if it does not exist; edit an existing file instead:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

On Linux/macOS use `test -f .env || cp .env.example .env`. Set `DEEPSEEK_API_KEY` in your local editor, or provide it through the process environment. Do not commit or share `.env`. Natural-language tasks and `/compact` make paid model requests.

Launch `cader`, then enter these lines below the colored CADER banner:

```text
/help
/model
/skills list
/domain electrical
Explain which symbols, text and connections should be checked in a circuit diagram. Do not call tools.
/context
/exit
```

These are input examples, not an expected verbatim model answer. Startup automatically connects `configs/mcp/AutoCAD.local.yaml` when present and shows connection, discovered and exposed tool counts. COM `not_probed` is lifecycle metadata, not proof of a detected CAD version; actual CAD calls establish the native connection.

| Entry | Behavior |
|---|---|
| `cader` | Persistent session in a TTY; without a TTY, prints help and exits 0 |
| `cader chat --workspace "path"` | Starts a session in an existing directory |
| `cader chat --stdio` | Explicit piped text input; output remains human-readable and Shell approval is unavailable |
| `cader --help` / `cader --version` | No project configuration, model or MCP required |

<a id="slash-commands"></a>

## Interactive commands

Enter Slash commands inside the Cader session. Angle brackets denote a value to replace; square brackets denote an optional argument. Omit those brackets when typing.

| Command | Usage and current behavior |
|---|---|
| `/help` | Show commands and shortcuts |
| `/open <path>` | Select PNG/JPEG for subsequent turns; DWG registers metadata and reports `CAD_OPEN_UNAVAILABLE`, without opening AutoCAD |
| `/cd [path]` | Show or change workspace and clear reference grants; the parent Shell directory is unchanged |
| `/status` | Show workspace, model, permissions, MCP connection and scratch binding; COM reports lifecycle metadata |
| `/model [ID]` | List or select a configured model, e.g. `/model MainAgent`; changes the current main conversation selection |
| `/mcp list` | List configuration files |
| `/mcp barrier` | Read-only review of a legacy missing-argument barrier, its original journal and current tool schema |
| `/mcp resolve` | User-only review; matching evidence and explicit confirmation archive the old barrier and require a new scratch drawing |
| `/mcp use <config-path>` | Select MCP, e.g. `/mcp use configs/mcp/AutoCAD.local.yaml` |
| `/mcp tools` / `/mcp off` | Discover tools or disable subsequent connections; discovery does not grant the agent every tool |
| `/skills list` | List skills visible to the main agent |
| `/skills use <name>` / `/skills off` | Select or cancel preloading; the role-visible catalog remains available on demand |
| `/domain [ID]` | List or select guidance; currently `general` and `electrical` |
| `/context` | Show estimated text tokens, latest provider usage and reference count; the estimate excludes image/tool tokens |
| `/compact` | Request a model summary while preserving the archive; tools, MCP and delegation are disabled for this request; failure keeps the original context |
| `/clear` | Save the old session and start a blank conversation, retaining preferences |
| `/resume [session-ID]` | List or restore visible dialogue, summary and selections; never replay tools, Shell or CAD requests |
| `/undo` | Report `CAD_UNDO_UNAVAILABLE`; there is no controlled CAD undo interface yet |
| `/checkpoint` | Save the conversation and project-reference hashes; not a DWG backup or CAD database restore point |
| `/permissions [mode]` | read-only / ask (default) / workspace-write / full-access; also supports shell ask / shell deny |
| `/quality` / `/quality resume` | Inspect quality state or recheck on the same connection without drawing replay; at most three cumulative repairs |
| `/exit` | Save and exit |

Subcommands are expanded above; there are 17 Slash root commands. MCP connections persist across turns. Switching configuration/workspace, clearing/resuming a session, disabling MCP or exiting releases the connection. Resume resets permission to ask and grants no prior CAD write binding; a fresh connection requires a fresh scratch drawing.

| Mode | Queries | Scratch drawing/editing | Delete/overwrite |
|---|---|---|---|
| read-only | Automatic | Denied | Denied |
| ask (default) | Automatic | Approval | Approval |
| workspace-write | Automatic | Automatic within this connection's scratch drawing | Approval |
| full-access | Automatic | Automatic within this connection's scratch drawing | Automatic within authorized scope |

CAD writes target only scratch drawings created through this connection's `new_drawing`, never an inherited desktop drawing. Saving outside the workspace requires approval in workspace-write. Writes query actual entities afterward. Uncertain outcomes persist `.cader/locks/managed-write.json` and freeze further writes; COM lacks request reconciliation, so inspect the original journal and drawing manually without deleting the lock and retrying. The fixed-plan scheduler shares this write lock.

<a id="interaction"></a>

## References, keyboard shortcuts and Shell

### Reference images and drawings

```text
Assess directly observable facts in @benchmark/fixtures/vision-calibration.png.
/open "tests/images/my reference.png"
List unreadable regions in the selected image that need a closer view.
Record the file identity of @drawing.dwg without inferring its entities.
```

Apart from the bundled calibration image, these filenames are examples; replace them with existing files inside your workspace.

- Use `@draft.png`, `@"path with spaces.jpg"`, a plain local PNG/JPEG path or `/open <path>`. Explicitly selected external images are copied into hash-bound workspace `.cader/references/` snapshots, without expanding Agent file/Shell access. Quote paths containing spaces. DWG references must remain inside the workspace.
- PNG/JPEG limits are 10 MiB and 40 million pixels. One original image is active per turn; a newly selected image replaces it. The selection persists into later turns and is sent to a model configured for image input.
- DWG is limited to 64 MiB. Only its header, size and SHA-256 are recorded; drawing content is not decoded. PDF is unsupported.
- Snapshot hashes are checked before each turn. Reselect altered snapshots; changing an external original does not silently replace the selected image. `/cd` clears references and pending redraw requests. Images, Skills and drawing references cannot authorize writes.

```text
Reproduce the symbols, readable text and connections in "D:\sketches\draft.jpg" on a new blank drawing. Save as result.dwg.
```

Alternatively use `/open "D:\sketches\draft.jpg"` before your drawing request. A missing-image request is retained; select its path and say `继续` to continue. No GUI upload is required. The Harness reads source structure, plans/draws, compares the original with a real CAD capture and reports the actual DWG path. An omitted destination gets a unique workspace filename. Task approval includes saving that new file; overwriting another or externally changed file still requires approval. Completion requires both quality and file checks. When quality remains pending but saving is safe, output is explicitly a draft.

On the same connection, `继续` or `/quality resume` retains the original request, source hash, destination and repair limit without replaying confirmed geometry. Continuing a completed task does not draw it again. Reconnect/restart grants no old CAD write authority and cannot clear an unknown-write barrier.

### Keyboard shortcuts

| Key | Behavior |
|---|---|
| Tab | Complete Slash names, `@` references and `/open` or `/cd` paths; quote paths containing spaces |
| ↑ / ↓ | Browse this process's input history |
| Esc | Cancel running work; clear the input line when idle |
| Ctrl+C | Request cancellation and wait for cleanup when busy; exit when idle |
| Ctrl+D | Close input and exit |

Cancellation waits for the current runtime to clean up and never replays requests automatically. VT-capable terminals provide full editing; `TERM=dumb` uses simplified input.

### Run a user Shell command

```text
!dir
/permissions shell deny
/permissions shell ask
```

On Linux/macOS use an appropriate command such as `!ls`. Only direct user `!` input triggers Shell execution. Inspect the command and workspace, then type `y` to approve that invocation; the default is no. Windows uses PowerShell; Linux/macOS uses `/bin/sh`.
Execution uses your OS account and **is not sandboxed**. User `!` commands always ask and keep output outside model context. The separate `cader_shell` model tool returns output to the model: denied in read-only, approval in ask/workspace-write, automatic in full-access. `shell deny` hides Agent Shell and blocks user Shell.
The time limit is 30 seconds and the output cap is 64 KiB. Cancellation targets the owned process tree; prior side effects are not rolled back. Piped sessions cannot approve Shell.

<a id="configuration"></a>

## Model, MCP and Skill configuration

Editable assets live in `configs/`; credentials come from the root `.env` or process environment. Restart the terminal after configuration changes.

| Path | Purpose |
|---|---|
| [`configs/models/`](../../configs/models/) | Endpoint, model name, `api_key_env`, input capabilities and generation settings |
| [`configs/runtime.yaml`](../../configs/runtime.yaml) | Registered profiles, budgets, read-only tools and delegation limits |
| [`configs/mcp/`](../../configs/mcp/) | Separate MCP process and environment references |
| [`configs/skills/catalog.yaml`](../../configs/skills/catalog.yaml) | Skill names, role visibility and resource registration |
| [`configs/domains/catalog.yaml`](../../configs/domains/catalog.yaml) | Domain guidance |
| [`configs/prompts/static/`](../../configs/prompts/static/) | Stable coordination and role prompts |

### Choose a model

| Profile ID | Current model | Declared input |
|---|---|---|
| `MainAgent` | `deepseek-flash` | Text, images |
| `SubAgent` | `deepseek-v4-pro` | Text |
| `VisionAgent` | `deepseek-flash` | Text, images |

```text
/model SubAgent
/model MainAgent
```

Profiles reference credentials through `api_key_env: DEEPSEEK_API_KEY`; the configured `base_url` is `https://api.deepseek.com`. Never put the key value in YAML.
`/model` does not change worker configurations or permissions. Only the main agent delegates: up to five concurrent children, depth one. Declared image input does not prove recognition accuracy.

### Connect MCP and draw through natural language

Copy the example only when no local configuration exists:

```powershell
if (-not (Test-Path configs/mcp/AutoCAD.local.yaml)) {
  Copy-Item configs/mcp/AutoCAD.example.yaml configs/mcp/AutoCAD.local.yaml
}
```

Set `command` to the Python executable of your separate AutoCAD-MCP environment and `cwd` to that project. Relative `cwd` is resolved against the YAML directory. Start the required CAD environment, then enter:

```text
/mcp use configs/mcp/AutoCAD.local.yaml
/mcp tools
/status
Read and summarize the current layers without editing the drawing.
```

The MCP config path is relative to, and must stay inside, the Cader configuration root. Ordinary and managed HTTP profiles have different purposes. Selection does not start AutoCAD or switch backends.

Short names such as `/mcp use AutoCAD.local.yaml` also work. `/mcp tools`, status or the next task establishes the selected connection. Discovery of 44 tools does not expose them all: the dynamic executor reviews a subset of ordinary COM tools and excludes incompatible HTTP atomic APIs, VQA and arbitrary scripts.

```text
/permissions ask
Create a blank scratch drawing, a red layer, a 100 by 60 rectangle and a centered circle of radius 15. Query the result.
Move that circle five units right and save as test.dwg in the workspace.
```

The model chooses tools; the program shows concrete arguments and waits for `y`. A blank drawing requires no existing DWG or reference image. Agent file tools include `cader_read_file`, `cader_write_file`, `cader_edit_file`, `cader_glob` and `cader_list_files`, plus controlled Shell. File tools handle workspace UTF-8 text up to 64 KiB and exclude `.env*`, `.git`, `.cader` and CAD files. Overwrite/Edit ask except in full-access. Glob skips symlinks and private directories. Explicitly authorized host Shell does not provide a filesystem sandbox.
The current agent exposes only reviewed backend-status, layer and symbol-library reads; discovery may list additional tools.

### Select a Skill and domain

```text
/skills use cad-redraw-review
/domain electrical
Assess @benchmark/fixtures/vision-calibration.png, separating observable facts from unknowns.
```

Bundled skills are `cad-inspection` and `cad-redraw-review`. New skills require explicit registration; copying a folder does not activate it.
Skill and domain guidance support planning and checking, without Shell, COM or CAD write permission. See the [model and MCP guide](../development/model-configuration.md) for configuration details.

<a id="commands"></a>

## Single commands and scripting

### Command reference

| Command | Purpose | Model / CAD access |
|---|---|---|
| `cader --help` / `cader --version` | Help / version; aliases `help`, `-v` | None |
| `cader chat [--workspace <directory>] [--stdio]` | Persistent conversation | Depends on input |
| `cader doctor` | Check Node version; not a complete CAD diagnostic | None |
| `cader models` | Show redacted model settings and whether credentials are configured | None |
| `cader skills list` | List main-agent skills | None |
| `cader skills show <name> [--resource <ID>]` | Read registered content or a resource | None |
| `cader exec "<task>" [options]` | Single natural-language task, default ask; calls requiring approval are denied without an interactive approver | Paid model; optional MCP |
| `cader harness-smoke` | Offline DSH component check; pnpm script name is `smoke` | No real model/CAD |
| `cader live-smoke --mcp <config> [--image <image> --expected-image <JSON>]` | Fixed read-only diagnostic; image expectation is optional | Real model and selected MCP/CAD |
| `cader cad-contract` | Export the controlled CAD contract | None |
| `cader cad-test --backend http --mcp <config> --plan <JSON> --output <DWG> [--authorize-write]` | Controlled reviewed geometry fixture | No model; real CAD writes after authorization |
| `cader cad-reconcile --run <run-directory> --mcp <config>` | Query an unknown request; never replay or unlock | Selected MCP |
| `cader assessment-check --assessment <JSON> --expect <JSON>` | Independent facts and abstract connectivity checks | None |

### Tasks and image regions

```powershell
cader exec "Summarize layers without edits" --mcp configs/mcp/AutoCAD.local.yaml
cader exec "Assess this image" --skill cad-redraw-review --image benchmark/fixtures/vision-calibration.png
cader exec "Inspect the upper-left region" --image benchmark/fixtures/vision-calibration.png --crop 0,0,128,128 --rotate 90
```

Ensure crop coordinates fit the original image. `exec` accepts `--permissions read-only|ask|workspace-write|full-access`, `--mcp`, `--skill`, `--image`, `--crop x,y,w,h`, `--rotate 0|90|180|270` and `--intent assess|redraw`. Cropping uses original pixels before clockwise rotation. Exec has no interactive approver; explicitly select workspace-write for automatic drawing and create a scratch drawing in that same task.
`assess` is the default. `redraw` requires `--image`, connected MCP and write permission, and uses the same source/fresh-drawing/file quality flow. Read-only or missing-image requests still return `blocked / WRITE_CAPABILITY_UNAVAILABLE`. Example: `cader exec "Redraw the reference on a new blank drawing and save as result.dwg" --intent redraw --image draft.jpg --mcp configs/mcp/AutoCAD.local.yaml --permissions workspace-write`. New workspace files can be saved automatically; exec does not auto-approve operations requiring confirmation.
Selections made with `/model`, `/mcp` or `/skills` do not affect a separate `exec`; that command uses configuration and its own arguments.

### JSON and exit codes

For strict JSON, call the built entry directly to avoid build logs from `pnpm run cader`:

```powershell
node apps/cli/dist/index.js exec "Explain the checks without tools"
```

Single-task reports are one JSON object on stdout; startup exceptions are redacted JSON on stderr. Help is plain text. The interactive terminal and `chat --stdio` do not implement a stable JSONL interface.

| Exit code | Meaning |
|---|---|
| 0 | Command or run succeeded; a read-only task can still have `task_status=unverified` |
| 1 | Runtime, configuration, model or connection failure |
| 2 | Invalid command or arguments |
| 3 | Task blocked or verification failed; `cad-reconcile` also returns 3 while preserving the freeze |

Read `run_status`, `task_status`, `verification`, `blocked_reasons` and `artifact` together. Neither `ok=true` nor model prose proves a DWG was created and verified.

<a id="sessions"></a>

## Sessions and data

```text
/context
/compact
/checkpoint
/resume
/resume session-00000000-0000-0000-0000-000000000000
```

The last line only illustrates the ID format; use an actual ID from `/resume`. `/clear` saves the old session and creates a blank one. Resuming never replays operations.

| Location | Content |
|---|---|
| Config root `.cader/sessions/` | Visible dialogue, summary, selections and reference identities; separate Shell audit events |
| Config root `.cader/checkpoints/` | Conversation and project-reference manifests, without drawing backups |
| Workspace `.cader/runs/` | Agent events and task verification reports |
| `.cader/artifacts/` | Explicit private output directory, including DWGs from controlled fixture runs |

Interactive configuration is discovered above the current directory or in the launcher's Cader checkout. `/cd` changes only the workspace. This is not arbitrary project initialization or layered configuration merging.
Visible dialogue can contain project information even after credential redaction. Keep `.cader/` private. Images are sent through the explicitly invoked model path and run records may include attachments; do not attach full sessions or original material to public Issues.

<a id="cad"></a>

## CAD capabilities and verification

The interactive agent and `exec` default to ask. A real text model has autonomously created a drawing/layer, drawn a line/rectangle/circle, moved the circle and saved a DWG with independent checks; see [execution acceptance](../validation/2026-11-20-agent-execution.md). The separate fixed-plan HTTP scheduler retains its save/reopen acceptance. Dynamic COM has no controlled reopen capability; these are distinct evidence paths.

Explicit paid-model/real-CAD acceptance (creates a scratch drawing and saves to the private run directory; approves CAD operations only):

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --execution
```

For advanced integration testing, first follow the [controlled execution guide](../development/cli.md#controlled-execution), configure the dedicated HTTP profile and authenticated Bridge, and choose a fresh output name. The following writes a real new working drawing; run it only after preparing that environment and deciding to execute:

```powershell
cader cad-test --backend http --mcp configs/mcp/AutoCAD.managed.local.yaml --plan benchmark/fixtures/managed-geometry.plan.json --output .cader/artifacts/geometry-001.dwg --authorize-write
```

`--backend http` requires a capability and does not switch the server automatically. Only the reviewed fixture hash is permitted; files are not overwritten by default. Unknown writes freeze further writes. Reconcile the original request without replay; do not delete locks and resubmit.

Unavailable features include arbitrary existing-DWG editing, controlled COM reopen, CAD undo, CAD snapshot recovery, full image-to-DWG execution, stable RunEvent JSONL and a public npm release.
See the [write policy](../architecture/controlled-writes.md), [real fixed-geometry report](../validation/2026-11-19-cader-cli-real-loop.md) and [terminal validation](../validation/2026-11-19-interactive-terminal.md).

<a id="troubleshooting"></a>

## Troubleshooting

| Symptom / error | Action |
|---|---|
| PowerShell blocks `pnpm.ps1` | Use `pnpm.cmd` or `.\cader.cmd`, without changing the execution policy |
| `cader` not found | Use `.\cader.cmd` or `pnpm exec cader` in the checkout; verify the installed launcher directory is on PATH |
| Old Node / missing build | Check `node --version`, use Node >=24.9, install dependencies and build; portable Node is not bundled in a fresh clone |
| Launcher installation returns `EPERM` | Choose a writable directory already on PATH, or use the repository launcher |
| `QUOTA` / `ACCOUNT_QUOTA` | Check provider balance, quota and model entitlement; this does not diagnose MCP connectivity |
| `AUTH` / `RATE_LIMIT` | Check credentials and endpoint, or wait for rate-limit recovery; never paste keys into Issues |
| `CONFIG_NOT_FOUND` / `CONFIG_INVALID` | Run one-shot commands from the checkout root; check YAML, environment references and image limits |
| `MCP_CONNECTION_FAILED` | Check the independent MCP Python, `cwd`, startup environment and server stderr; ordinary and managed profiles differ |
| `MODEL_IMAGE_UNSUPPORTED` | Select a profile declaring image input, e.g. `/model MainAgent` |
| `REFERENCE_CHANGED_RESELECT_REQUIRED` | Reselect the modified file with `/open` or `@` before another request |
| No Tab completion or color | Check TTY, `TERM=dumb` and `NO_COLOR`; only VT-capable terminals should use `TERM=xterm-256color`; `FORCE_COLOR=1` enables color |
| DWG `/open` or `/undo` unavailable | A current interface gap; do not expand the read-only tool list to bypass it |

The latest live terminal model probe returned `QUOTA`. Offline multi-turn behavior and Windows terminal interactions passed; successful live model multi-turn behavior is still unverified. Historical results do not determine your current account status.

<a id="updates"></a>

## Updates and feedback

After updating source, install locked dependencies and rebuild before launching:

```powershell
git pull --ff-only
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
```

On Linux/macOS use `pnpm` instead of `pnpm.cmd`. Preserve `.env`, `*.local.yaml` and `.cader/`; resolve local Git changes before upgrading instead of forcing an overwrite.

When reporting an issue on [GitHub](https://github.com/codesknight/Cader/issues), include Cader/Node versions, OS and terminal, the command, a sanitized `errorCode`, and expected/actual behavior. Upload images only if they are explicitly cleared for publication.

CLI changes must update both language guides, help and examples in the same commit. Resolve documentation/implementation differences before acceptance. The [development process](../development/process.md) describes the checks; unavailable features retain an explicit status.


## v0.4 development snapshot: evidence, recovery and view feedback

`0.4.0-dev.1` introduced the reliability behavior below. Current dev.2 quality scheduling is described next; full v0.4 acceptance remains open.

- `/mcp doctor` queries the backend and separates transport, cached observations, scratch ownership and freeze state. The current COM backend may lazily launch CAD/create a default document when none exists; this is not an independent native side-effect-free health API.
- `/mcp recover` only reconciles an acknowledged mutation followed by a postflight read failure on the same original connection. It repeats the read, never the mutation. Unknown dispatch, timeouts, reconnects, legacy locks and capture uncertainty remain frozen; no lock deletion, CAD restart or implicit rebinding.
- Model tools `cader_cad_health` and `cader_cad_recover` expose those operations. Frozen mutation tools disappear from subsequent model steps. Already queued sibling requests return blocked_not_dispatched, distinct from an unknown dispatched operation.
- Private JSONL records preflight/dispatch/acknowledgement/postflight/artifact verification, original MCP failures, extractable HRESULT, call/operation IDs and stacks. Unavailable native thread/revision/MCP wire IDs are not invented.
- Entity-specific postflight uses get_entity with the returned ObjectID and labels observation_scope=affected_entity. It is not a full drawing listing. Document operations and explicit final queries still inspect the full drawing. Health counts are timestamped cached full observations.
- Polyline/hatch points must explicitly contain finite [x,y,z] values. Invalid arguments are rejected before dispatch without freezing.
- Reports include execution_evidence; a freeze forces ok=false and task_status=blocked even when the model finished normally. Terminal counts refer to operations, not entities.
- `cader_review_cad_view` captures the owned scratch view and automatically sends a real image attachment to the vision worker; no user reference or prior DWG save is required. Export changes viewport/plot settings and writes a private PNG under existing approval/serialization. max_visual_reviews_per_turn defaults to 4 (range 1–5). No authoritative pixel-to-CAD mapping is available; edits still require entity coordinates. Actual export timeout evidence means the complete visual correction gate has not passed.

Explicit mutually exclusive live entries, all using isolated new scratch targets:

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --reliability
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --faults
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --visual
```

Reliability is deterministic real-CAD A/B/E reproduction, with no model calls. Faults inject client-boundary response suppression/read failure/cancellation around real CAD writes; they do not claim native COM crashes or real packet loss. Visual uses paid real models to autonomously draw a seeded defect and request correction; implementation alone does not establish acceptance.

See [actual results and failures](../validation/2026-11-20-reliable-execution.md). The original Drawing8 barrier remains intact. Full-access and model changes cannot clear it. Adjacent MCP changes require separate authorization and have not been applied.

CAD failure lines display the code, stage and dispatched/not-dispatched status; full errors stay in private JSONL.

A CAD freeze also hides and blocks Agent Shell, including full-access, to prevent bypassing the write barrier. Direct user ! commands remain a separate individually approved host channel.

## dev.2: autonomous drawing quality tasks

Drawing, design/generation, redraw, diagram, layout and text-addition requests enter application-owned quality scheduling. Chinese polite drawing questions also count as tasks; capability questions remain inquiries. Simple move/rotate requests retain deterministic post-write observation without mandatory visual round trips. Complex drawings route to VisionAgent automatically; users need not request review or switch agents.

The CLI shows planning, drawing, geometry, topology, vision, correcting and complete/pending/blocked phases. The model submits an immutable requirement checklist and absolute component layout. Preflight rejects overlapping components, interior ports and nonexistent entity types. Actual CAD queries check supported counts, labels, segment/bounding-box intersections and two-terminal series graphs. Electrical tasks load the registered data-only `electrical-quality` skill; it contains no fixed drawing sequence or authority.

Default ask approves the concrete plan and owned scratch once, covering layers, drawing, captures and safe local patches to task-created entities, with at most three cumulative corrections. The approval explicitly includes deletion of those entities. Foreign deletion, saving/overwrite, files and Shell retain existing permission checks. Grants expire at task end. `cader_apply_cad_patch` batches drawing/edit/delete operations through the original schemas, guards, serial owner and journal. It stops at the first failure; committed operations must never be replayed.

Vision uses a strict report schema and one format repair on the same captured image; MainAgent and VisionAgent each allow up to 8192 output tokens by default. Quality tasks share 400 cumulative model steps; each ordinary verification scope allows four view reviews; the 100-tool execution-round allowance renews automatically within separate cumulative tool/CAD/time/usage limits. Ordinary nonscheduled turns retain the 100-tool limit. Cancellation, invalid reports, failed vision, unknown entity references, changed observations and suspected capture clipping cannot complete. Nonessential observations and geometry already proven by queries should not become visual defects. Uncertainty without a localized defect remains pending instead of triggering speculative edits.

```text
画一个带有 5V 电源和一个灯泡的串联电路图。
/quality
/quality resume
```

These are input examples, **not a claim that full real-CAD acceptance has passed**. `/quality` shows the latest checklist/evidence; `resume` rechecks on the same live connection and scratch, continues unfinished progressive regions (other tasks skip original drawing), and preserves the three-correction limit. Reconnect, exit or ordinary session restore invalidates that ownership. Quality resume never clears a write barrier; `/mcp recover` retains its existing conditions.

Private `quality.json`, `verification.json`, `events.jsonl` and execution journals retain requirements, phases, per-round checks, visual results, image hashes, observed-state digests and failures. Native `document_revision` and `pixel_to_cad` are unavailable and explicitly null. Referenced ObjectIDs must exist in queries; pixel-only edits are not authorized. The border test is conservative clipping evidence, not proof of full image coverage.

Explicit paid-model/real-CAD entry, creating an isolated workspace and actual scratch:

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality
```

The configured default MainAgent (currently Flash) receives one original request; Harness routes Flash visual review automatically and first checks a deterministic missing-argument input against the real discovered schema. The callback approves CAD operations only, which is separate from human terminal approval testing. This case does not save a DWG or establish arbitrary circuit, native revision or pixel-mapping acceptance. See [actual results and retained failures](../validation/2026-11-20-autonomous-quality.md).

## dev.3: input rejection, diagnostics and recovery display

Direct CAD calls and the program MCP client validate schemas before sending. Composite patches prevalidate every operation's schema before any operation runs. Missing required fields such as height, wrong types/enums and nested constraints report `TOOL_ARGUMENTS_INVALID` or `CAD_FAILED_BEFORE_DISPATCH`, preflight, not dispatched, without freezing. No defaults are inserted and no types are coerced. The agent may correct unexecuted requests. Patches are not rollback transactions: subsequent permission/native failures can retain prior committed operations; never blindly replay the whole batch.

Remote isError, timeout or a lost response does not prove absence of side effects, even if its message contains “validation.” Unacknowledged writes still freeze; recovery remains limited to acknowledged writes with failed postflight observation on the original connection. Old Drawing6 or other persisted unknown locks are never automatically removed.

Facts add `counts_scope`, `operation_mark`, `session_counts`, `freeze_operation`/`freeze_evidence`, `recovery.eligible/reason` and `cad_observation.stale_due_to_mutations`. The terminal separates turn and cumulative session counts. Historical barriers are not counted as operations in a restarted session, but retain their source/error. Stale counts and empty filtered results do not establish an empty drawing; empty COM lifecycle metadata does not establish disconnection.

```text
为什么阻塞了
为何冻结
查看冻结原因
恢复
/mcp recover
```

These Chinese diagnostic/recovery shortcuts are program-owned and do not invoke a model. Refused recovery is displayed explicitly; model-tool `recovered:false` no longer receives a success checkmark. Controlled reads remain available during a freeze; reconnect/restart grants no inherited ownership. Once streamed, answers receive only application status afterward rather than being printed twice on failure.

A closed or replaced original connection reports `ORIGINAL_CONNECTION_REQUIRED`; an unacknowledged dispatch on the live connection reports `DISPATCH_OUTCOME_UNCONFIRMED`. Repeated recovery does not authorize writes in either case.

Real Flash/AutoCAD validation now reaches text creation and automatic vision; the missing-input probe was rejected without dispatch or freeze. Full circuit acceptance still fails on suspected capture clipping and plan constraints. See [dev.3 fix and actual evidence](../validation/2026-11-20-schema-preflight-fix.md).

## dev.4: reviewing legacy argument barriers

Startup reads workspace barriers and displays the cause even without MCP configured. A drawing quality task with a known freeze goes directly to `blocked`, before constructing or calling the model. Reports record `model_run_status: not_started`; `run_status: succeeded` means the application handled the request, while business status remains `ok: false`, `task_status: blocked`. Zero current-turn writes do not disprove an older barrier.

Upgrading does not automatically remove an old missing-height barrier. Exit any old Cader sessions, then in a new session using the original workspace:

```text
/mcp barrier
/mcp resolve
```

Select the original MCP configuration first. The application correlates the original argument error, request, target, journal and current schema. Acknowledged writes, timeouts, captures, native errors, changed evidence and another live writer process are refused. `eligible: true` means reviewable, **not proof that CAD never executed**. Every permission mode, including `full-access`, requires explicit confirmation that the original request did not execute, has ended, and no running or delayed CAD operation remains. If unsure, decline and preserve the barrier; do not delete the lock manually. This is not a general reset and is not exposed as an Agent tool.

After operator adjudication, the original unknown barrier, journal snapshot and hashed decision receipt remain in workspace `.cader/barriers/`. Old unknown outcomes are not rewritten, operations are not replayed and old documents are not adopted. The transport closes and document/task grants are dropped; resend the task to create a fresh scratch. `/quality resume` cannot continue the old task. Review mutex and filesystem failures block release; stale review mutexes are never removed automatically.

The actual Drawing6 record was reviewed read-only against real MCP discovery and remains unchanged. Operator approval and a complete new drawing were not performed on the user's behalf. See [diagnosis and limits](../validation/2026-11-21-legacy-barrier-review.md).

## dev.5: preventing avoidable write barriers

Writes naming a layer query `list_layers` immediately before dispatch. Missing layers, failed reads and invalid responses reject the mutation as `failed_before_dispatch` without freezing. The Agent receives an actionable instruction to call `create_layer` and retry only the unexecuted operation. No hidden layer creation or whole-patch replay occurs. Failed patch results include `not_dispatched` indices; committed operations remain committed.

Native failures may leave partial geometry. Tool and final CLI results now display the original native error. An unproven terminal outcome still retains the barrier. The corresponding AutoCAD-MCP changes validate layers before entity creation and attempt cleanup only of entities created by that call. This is not a transaction receipt: failed cleanup or lost responses remain uncertain. Upgrading does not retire the existing partial Drawing2 barrier, and `/mcp resolve` is not applicable to it.

MCP export also uses foreground plotting, explicit fit-to-page and complete plot-setting restoration, and refuses existing output targets. This reduces background-job capture delays; uncertain exports are never automatically replotted or declared complete. Restart Cader to reload the updated MCP child process.

Planning model failures now enter `blocked`, preserve `quality.failure` and planning `model_runs`, and display QUOTA or the actual failure before drawing. They are no longer described as pending quality verification. A missing valid plan produces `ACCEPTANCE_PLAN_MISSING`. QUOTA alone does not establish insufficient balance.

Explicit real-model/CAD validation can use a custom quality task (paid API calls and real scratch drawings; the default remains the series circuit):

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task "Create a blank drawing with a house and a tree beside it."
```

`--task` is accepted only with `--quality`. The model receives the request, never a fixed operation sequence. See [actual tests, failures and limits](../validation/2026-11-21-dependency-and-partial-execution.md).

Do not use missing-argument adjudication to continue a partially executed frozen task. To preserve that evidence and begin an independent new task, use a new project workspace from the Cader source directory:

```powershell
New-Item -ItemType Directory -Force .cader/workspaces/new-task
cader chat --workspace .cader/workspaces/new-task
```

The new workspace still defaults to ask, requires a fresh scratch and retains the same write guards. It does not reconcile the old operation, adopt its drawing or replay its requests.

## dev.6: reference image to fresh CAD and DWG

Explicit image paths register real pixels without a GUI upload. Reproduce/trace/redraw requests enter quality scheduling, with source-reading and DWG-saving phases. Agent `cader_open_image` reads workspace PNG/JPEG pixels and enables crop tools; text Read is not semantic image inspection. The program binds the task's fresh drawing, confirmed geometry, source hash and destination, preventing reviews of an older drawing from becoming redraw results.

MainAgent/VisionAgent each default to at most 8192 output tokens, retaining overall budgets and one format repair. Forbidden component-interior wires are rejected before dispatch; nonexistent visual entity IDs require report correction. If a model fails during drawing/repair, confirmed task geometry may be saved as a draft when the connection remains unfrozen, uncancelled and file protections allow it. The original QUOTA or other failure remains; this never completes the task. Frozen/cancelled or geometry-free tasks are not automatically saved or replayed.

Real reference runs produced DWG files and independently reopened them, while full quality still has unmet conditions. [Evidence and known issues](../validation/2026-11-21-reference-redraw-fix.md). Restart the CLI and check `cader -v` for dev.6; restart its MCP child to load native capture margins too.

## dev.7: full-quality retesting and source label protection

After source observation, up to four label regions are reread with actual pixel crops. Clear source labels must appear in literal plan checks without replacing values or SI prefixes. Unresolved labels allow drawing and a draft file, but prevent completion. This applies to annotated references, without adding visual calls to simple move tasks.

Text checks normalize layout whitespace, compatible glyphs and mathematical minus, while matching complete labels, retaining SI case and checking quantity: `5V` differs from `15V`, and `m` from `M`. Visual reports must use each supplied acceptance ID exactly once; errors return to the model for correction.

Topology failures now identify coordinates, node degrees, wire IDs, nearest endpoint gaps, component bounds and unsupported entities. The current series verifier needs `AcDbLine` wires: this MCP exposes no polyline/arc wire endpoints, so such creations on the wire layer are rejected before dispatch with a line-segment alternative. Symbol layers may still use them. Ordinary drawing requests cannot acquire an invented mandatory save condition.

Component tasks also cannot acquire an unrequested line-entity ceiling. An uncertain visual verdict must identify an affected required check; all-pass checklists with unrelated global uncertainty require bounded report repair, never automatic promotion to pass. Updated 2026-11-22: the local reference and power/lamp cases passed real testing; this does not guarantee arbitrary drawing quality.

MainAgent defaults to `reasoning_effort: low`, while vision remains `off`; output/step/tool/repair limits are unchanged. Adjust the MainAgent model YAML if needed. Bounded reasoning still incurs provider costs and cannot guarantee acceptance of every drawing. After restart, `cader -v` should report dev.7. [Actual retesting and limits](../validation/2026-11-21-complete-quality-retest.md).

## dev.9: native creation and bounded recovery (2026-11-23)

The paired AutoCAD-MCP fix attaches without implicit creation. Explicit new_drawing resolves Add metadata with bounded read-only readiness, invokes once, and binds only a uniquely new active document. An old ActiveDocument is not successful creation.

Optional request_id is correlation, not idempotency or replay permission; successful names remain compatible. Cader supplies its operation ID. Only complete, matched native preflight evidence proving no invocation/implicit creation avoids freezing. The terminal distinguishes MCP receipt from native invocation. Legacy text, mismatched requests and failures/timeouts after invocation remain frozen.

Agent-requested quality review yields to Scheduler immediately. API request timeouts remain unchanged; scheduled main turns use the existing task deadline (600 seconds by default), avoiding premature cancellation of nested vision. Child limits, shared budgets, user cancellation and at most three corrections remain enforced.

A truncated plan with no valid submission gets one compact retry before CAD authorization; QUOTA is not retried. Generic illustrations may omit topology ports, and unrequested primitive ceilings are rejected. Visual malformed/truncated output gets one same-image repair. Only fully accepted current evidence supersedes prior failed visual attempts; failures remain recorded. Main failures and unmet requirements still block success.

Old unknown barriers are not retrospectively released. Exit the old CLI and start a new workspace to load a new MCP process. Existing recover/resolve cannot adjudicate the old Add outcome. Isolation neither confirms the historical request nor adopts its drawing. Check dev.9 with cader -v. See [fix and layered validation](../validation/2026-11-23-native-document-create-fix.md).

## dev.8: capability catalog, agent review and task evidence (2026-11-23)

Each model step receives a unified tool/worker/Skill catalog with purpose, trigger, input/output, invocation entry, availability and refusal reason. Input references point to that step's actual tool schemas; availability is projected from the resolved DSH toolSet. Availability does not grant write permission. Model profiles accept optional description/when_to_use, and the Skill catalog accepts optional when_to_use. Explicit registration and lazy Markdown/resource loading remain enforced.

The main agent can call `cader_review_cad_view`. In quality tasks the Harness binds this entry to frozen requirements and actual CAD observations. If omitted, mandatory Harness review still runs; model prose cannot complete a task. Valid reports are reused only within the same task with matching connection, document, write history, entity snapshot and reference image. Edits trigger revalidation. This is not a native revision guarantee; reuse never transfers across tasks, processes or resume. Clipping, invalid/cancelled reports, changed observations and unknown writes still block acceptance.

Dynamic task_state supplies phase, original requirements, visual call count, latest report/image hash, checks and unmet conditions. `/quality` exposes the same evidence, with historical rather than live-drawing scope. The terminal distinguishes agent-requested review from Harness acceptance, new calls from reuse, and source comparison from ordinary visual review.

```text
Always use vision review after drawing.
是否使用了视觉验证？
继续
以后按需做视觉检查。
```

The first input persists a session preference without a drawing plan or CAD call. The history inquiry reads recorded evidence without a model or new capture. Continue rechecks the bound task only when its original connection/document and frozen plan remain valid; it never replays drawing and does nothing to an already accepted task. The last input restores complexity-based review while preserving mandatory gates. Policy text cannot disable required acceptance, grant permission or clear barriers.

The shorter MainAgent static prompt retains stable coordination and evidence/permission rules. CAD workflow knowledge is the registered cad-execution Skill; vision uses its own role prompt. New drawings without a reference do not require one. For a local launcher already bound to this repository, run `pnpm build`, restart, and check dev.8 with `cader -v`. One real house/tree task verifies active review and Harness reuse, not arbitrary redraw, DWG delivery or full v0.4 acceptance. See [implementation and tests](../validation/2026-11-23-capability-routing.md).

Recovery sends only the latest eight operation records to the model; full audits remain persisted. A completed unit does not reset the shared token, time, step or execution-round budget.

Scheduler supplies a fresh geometry/text readback at each drawing-unit start. Explicit confirmation quotes are offered from the actual request; source indices and values remain model-selected and program-checked. Terminal recovery counts distinguish the unit allowance from the task cumulative count.

Planning and confirmation allow one compact retry for truncated output, malformed responses or model-response timeout. QUOTA/authentication errors are reported directly. Original failed records remain preserved.

A visual report cannot claim every required condition passed while its overall verdict is uncertain, even with minor advice. The model must identify an affected required condition or submit a consistent report; bounded same-image repair never converts uncertainty into success automatically.

## Long conversations and user clarification: current behavior

Cader does not automatically compact and start a successor conversation at its limits. Over 20000 estimated visible-text tokens (excluding images/tools), or an input over 24000 characters, prompts manual `/compact` or `/clear`. Over 1900 stored messages or 1600000 serialized bytes prompts `/clear`. These are application guards, not the provider's actual context capacity. `/compact` disables tools and preserves the dialogue archive; `/clear` disposes the execution owner and cannot seamlessly inherit drawing authority. Renewable execution-round allowances are separate from chat compaction; task-wide limits do not reset automatically.

A tool-approval y/N is not factual confirmation of a source label or connection. Existing tools can bind actual confirmation text, but a complete structured pending-question, batch clarification and answer-continuation workflow is not implemented. Necessary unresolved conditions still block acceptance. Stable source facts, proactive clarification and safe automatic compaction are proposed work, documented in the [engineering review](../development/2026-11-25-complex-redraw-engineering-review.md).

Internal semantic-unit/recovery/round invocations use new DSH model sessions with structured task state and readback. This is distinct from automatically summarizing or rolling over the user ChatSession; the native CAD binding and total task budgets are preserved.

For explicit large-reference runs, configuration ceilings are 30,000 task tool reservations, 20,000 CAD operations and 500 counted execution rounds. Defaults remain 600/400/12; per-round limits, validation reserves, total time/tokens and approvals still apply. The index reports candidate volume before drawing; limits are not an acceptance criterion.

For indexed line art, independent raster checks release only source-supported centerlines; literal TEXT uses vision reading. Connected source edges may form a native path, with original-edge provenance and no invented bridge. Glyph groups are admitted together. Batch visual evidence binds source IDs to native entities and the attached crop, and must match the source/document/current native state. Compact Agent receipts reference full retained audit data. Final graphical connectivity, residual and visual checks remain mandatory; none certifies a functional netlist.

Large-reference source batches validate submitted primitives first; `partial_verified` is progress, not complete regional acceptance. After every source item exists, Harness compares each paired high-resolution source/CAD window for full fidelity, followed by global and file checks. Low-confidence OCR can retain editable outline geometry; this does not certify an engineering netlist.

Source literal reconciliation ignores repeated whitespace, while preserving case, units and numeric punctuation. Conflicting broad crops require two agreeing target-only rereads. When native source geometry is correct but a primitive is unresolved in a plot, Harness requests bounded real close-ups; it blocks unnecessary geometry moves and retains all conflicting reports. These checks never replace full regional/global acceptance.

The source-ID compiler fills pending/accepted group siblings within the actual Patch capacity, including across worklist pages. Oversized groups continue in bounded primitive batches; remaining IDs stay pending and complete-window/global acceptance is mandatory. A label-only worker receives glyph lookup/readability tasks without whole-drawing planning context. Ink crossing an OCR box boundary stays editable outline geometry, preserving two-dimensional typesetting. Available shows compact evidence identities and defects; full snapshots remain in the private manifest.

During indexed construction, independent source-pixel and exact native checks precede a CAD-only rendering review of the submitted primitives. The full reference is not a primitive completeness target. After every source item exists, complete high-resolution source/CAD comparisons and global/file acceptance remain mandatory; a CAD-only report cannot satisfy full source fidelity.

On Windows, checkpoint replacement retries transient file-sharing denials for under five seconds using the same synced candidate; CAD operations are never replayed. Persistent failure reports CHECKPOINT_PERSIST_FAILED and retains the old checkpoint, candidate and private error details. Resolve the file lock or permissions before /quality resume in the original live session; restarting does not inherit write authority to the old drawing.

A provider interruption does not block the controlled readonly checkpoint. In the original live connection, /quality resume can reconcile a stale source-task checkpoint only against an exact confirmed journal extension, frozen source/request bindings and a complete fresh native read. Unknown outcomes, extra or altered geometry, changed arguments and destructive suffixes still fail. Reconciliation changes neither visual acceptance nor document write authority.

Private quality evidence loads through a shared byte-bounded reader (256MiB), separate from model context and token budgets. /quality, resume, continuation and user review share this path. QUALITY_MANIFEST_TOO_LARGE or QUALITY_MANIFEST_INVALID returns a recoverable error without disposing the session/connection or changing the original record. Resume reuses its parsed object. A new connection still cannot inherit the old drawing's write authority.

Disputed source labels require two independent target-only readings; repeated wide-view agreement is insufficient. Tiny targets can use nearest-neighbor display enlargement with original crop, scale and inverse mapping audited; no new source information is created. Fresh evidence can refine only unexecuted source text. Acknowledged geometry requires controlled repair and revalidation; genuinely unreadable targets remain pending clarification.
