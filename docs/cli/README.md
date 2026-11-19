# Cader CLI User Guide

**English** · [简体中文](README.zh-CN.md) · [Project home](../../README.md) · [Documentation](../README.md)

**Applies to Cader 0.4.0-dev.1 · Updated 2026-11-20**

Cader CLI is a CAD agent terminal built on DeepSeek Harness. Describe tasks in a persistent conversation, select models and skills, reference images, inspect CAD status, or use a single command from a script.

This guide is versioned alongside the implementation. Proposed features are tracked in the [roadmap](../development/roadmap.md).

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
| `/exit` | Save and exit |

Subcommands are expanded above; there are 16 Slash root commands. MCP connections persist across turns. Switching configuration/workspace, clearing/resuming a session, disabling MCP or exiting releases the connection. Resume resets permission to ask and grants no prior CAD write binding; a fresh connection requires a fresh scratch drawing.

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

- Use `@draft.png`, `@"path with spaces.jpg"` or `@drawing.dwg`. References must stay within the current workspace.
- PNG/JPEG limits are 10 MiB and 40 million pixels. One original image is active per turn; a newly selected image replaces it. The selection persists into later turns and is sent to a model configured for image input.
- DWG is limited to 64 MiB. Only its header, size and SHA-256 are recorded; drawing content is not decoded. PDF is unsupported.
- Hashes are checked before each turn. Reselect changed files; `/cd` clears reference grants. Images, Skills and drawing references cannot authorize writes.

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
`assess` is the default; `redraw` currently returns `blocked / WRITE_CAPABILITY_UNAVAILABLE` without starting a model or MCP.
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

`0.4.0-dev.1` is a development snapshot, not full v0.4 acceptance.

- `/mcp doctor` queries the backend and separates transport, cached observations, scratch ownership and freeze state. The current COM backend may lazily launch CAD/create a default document when none exists; this is not an independent native side-effect-free health API.
- `/mcp recover` only reconciles an acknowledged mutation followed by a postflight read failure on the same original connection. It repeats the read, never the mutation. Unknown dispatch, timeouts, reconnects, legacy locks and capture uncertainty remain frozen; no lock deletion, CAD restart or implicit rebinding.
- Model tools `cader_cad_health` and `cader_cad_recover` expose those operations. Frozen mutation tools disappear from subsequent model steps. Already queued sibling requests return blocked_not_dispatched, distinct from an unknown dispatched operation.
- Private JSONL records preflight/dispatch/acknowledgement/postflight/artifact verification, original MCP failures, extractable HRESULT, call/operation IDs and stacks. Unavailable native thread/revision/MCP wire IDs are not invented.
- Entity-specific postflight uses get_entity with the returned ObjectID and labels observation_scope=affected_entity. It is not a full drawing listing. Document operations and explicit final queries still inspect the full drawing. Health counts are timestamped cached full observations.
- Polyline/hatch points must explicitly contain finite [x,y,z] values. Invalid arguments are rejected before dispatch without freezing.
- Reports include execution_evidence; a freeze forces ok=false and task_status=blocked even when the model finished normally. Terminal counts refer to operations, not entities.
- `cader_review_cad_view` captures the owned scratch view and automatically sends a real image attachment to the vision worker; no user reference or prior DWG save is required. Export changes viewport/plot settings and writes a private PNG under existing approval/serialization. max_visual_reviews_per_turn defaults to 3 (range 1–5). No authoritative pixel-to-CAD mapping is available; edits still require entity coordinates. Actual export timeout evidence means the complete visual correction gate has not passed.

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
