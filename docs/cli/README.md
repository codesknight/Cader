# Cader CLI User Guide

**English** · [简体中文](README.zh-CN.md) · [Project home](../../README.md) · [Documentation](../README.md)

**Applies to Cader 0.4.0-dev.12 · Updated 2026-11-24**

dev.12: reference circuits use model-planned components, named pins and external netlists, including branches and three-terminal devices. Harness schedules component, net and label units with readback checkpoints; all units still require independent geometry, topology, source-image and DWG acceptance. A unit check-in is progress, never task acceptance. The terminal reports unit progress and truncation retries.

The per-response output limit remains 8192 tokens. Drawing/correction truncation or model-response timeout permits at most two task-wide recovery attempts: persist the ledger, verify the original connection/document and read back entities, then generate only missing short batches (at most eight operations per quality-task Patch). Native CAD timeouts are not replayed. Unknown writes, failed readback, changed bindings or exhausted total budgets stop continuation. Units share round allowances instead of resetting them. Default task limits are 100 model steps, 30 minutes and 16 child invocations; cumulative tool/CAD/token limits and individual API timeouts still apply. Continuation is in-process only; `/quality resume` remains verification-only.

An independent source-net review checks terminal groups; a separate full-image inventory preserves every label occurrence. All labels are reread in batches of at most four, uncertain first, with one wider-context retry for unresolved crops. Unreadable labels/connections remain pending. `series_cycle` is reserved for explicit simple two-terminal series loops. Netlist verification checks queried straight-wire connectivity: interior crossings do not join automatically, and declared interior junctions need actual small circle markers. It does not simulate transistor behavior or certify electrical functionality.

Explicit label clarifications may accompany the original request. The program records the submitted quote, source hash/position and original OCR reading; human confirmation is not reported as OCR success. An uncertain net is not a proven disconnection: a candidate may continue only when other clear terminal relations agree, and must pass the dedicated `source_topology_fidelity` image comparison. Clear conflicts or unresolved final vision still prevent completion. Final review includes relevant original-image details and coordinate transforms alongside the same CAD capture.

For circuit redraws, “hand-drawn” identifies the source medium. Rough strokes and handwritten fonts are output requirements only when explicitly requested. Independent final vision compares the actual source and CAD images; preliminary model opinions are withheld to reduce anchoring.

If a queued Patch encounters a proven pre-dispatch rejection after budget renewal, the model receives its actual partial results and may replan missing operations. This requires the original connection/document and an unfrozen execution ledger; confirmed leaves are never replayed. Uncertain native outcomes still stop execution. Failed reservations remain spent.

Symbols must actually reach their declared ports; a polyline bounding box is not endpoint evidence. Proven coincident ports may touch directly without a zero-length wire. A final Patch may request program readback/check-in with `unit_complete`, avoiding an extra model request; missing contacts return acknowledged results and missing items for continuation without replay.

Cader CLI is a CAD agent terminal built on DeepSeek Harness. Describe tasks in a persistent conversation, select models and skills, reference images, inspect CAD status, or use a single command from a script.

This guide is versioned alongside the implementation. Proposed features are tracked in the [roadmap](../development/roadmap.md).

dev.11 separates visual business results from control handoff: `× cader_review_cad_view` means visual defects; `!` means capture/readback failure, an invalid report, clipping or uncertainty. Only a valid pass report receives `✓`, and independent Harness task acceptance still applies. `/quality` and historical status distinguish capture attempts from admitted vision-model request steps; failed captures do not count as vision calls, and these counters are not billing receipts.

With the updated independent AutoCAD-MCP, capture preflights before changing plot state and verifies restoration by readback. Only complete evidence matching this request, drawing and path can classify an unchanged/fully restored failure as pending without freezing. Other outcomes remain protected. Capture currently requires the model layout; paper layouts are rejected before changes, without switching user layouts. Restart the CLI and its MCP child process to load the update. Historic unknown barriers remain intact and old drawings are never automatically adopted. See [real original-house regression](../validation/2026-11-24-capture-restoration-fix.md).

dev.10 quality tasks automatically renew execution rounds within the original process: stop new dispatch, read and checkpoint progress, then continue on the same task, connection, drawing and grant. A Patch reserves its wrapper and all leaves before any mutation. An insufficient round admits none of its leaves; Scheduler dispatches only never-dispatched requests through the original tools before fresh model reasoning. Confirmed or unknown writes are never replayed. Changed bindings, failed readback or unknown writes stop continuation. Failed vision or post-review readback immediately returns control to Scheduler.

In [`configs/runtime.yaml`](../../configs/runtime.yaml), `max_tool_calls: 100` limits each execution round. `max_task_tool_calls: 600` counts total tool reservations, including Patch wrappers/leaves and vision tools. `max_cad_operations_per_round: 64` and `max_cad_operations: 400` limit round/task CAD writes. Reservations precede dispatch and do not mean entities committed. `validation_tool_reserve: 8` protects validation capacity. Patch schemas adapt to round capacity, at most 32 operations. Total limits do not reset: `max_execution_rounds: 12`, `max_model_steps: 100` and `timeout_ms: 1800000` apply across rounds.

`max_task_tokens: 2000000` stops later requests using reported provider usage as a cost proxy, not an exact currency cap; it cannot undo an in-flight paid request. The CLI shows checkpoints, automatic renewal and total-limit pauses. The task's private `quality.json` retains observations, connection identity, confirmed operations, never-dispatched requests and budget counts. A paused task has not passed acceptance. Renewal is in-process only; restarting never restores write authority. `/quality resume` remains safe verification on a valid original binding, without replaying drawing or bypassing barriers.

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

Vision uses a strict report schema and one format repair on the same captured image; MainAgent and VisionAgent each allow up to 8192 output tokens by default. Quality tasks share 100 model steps and four view reviews; the 100-tool execution-round allowance renews automatically within separate cumulative tool/CAD/time/usage limits. Ordinary nonscheduled turns retain the 100-tool limit. Cancellation, invalid reports, failed vision, unknown entity references, changed observations and suspected capture clipping cannot complete. Nonessential observations and geometry already proven by queries should not become visual defects. Uncertainty without a localized defect remains pending instead of triggering speculative edits.

```text
画一个带有 5V 电源和一个灯泡的串联电路图。
/quality
/quality resume
```

These are input examples, **not a claim that full real-CAD acceptance has passed**. `/quality` shows the latest checklist/evidence; `resume` rechecks on the same live connection and scratch, skips original drawing and preserves the three-correction limit. Reconnect, exit or ordinary session restore invalidates that ownership. Quality resume never clears a write barrier; `/mcp recover` retains its existing conditions.

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
