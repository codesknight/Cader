<p align="center">
  <img src="docs/assets/cader-cover.png" alt="Cader — An extensible CAD agent. CAD wireframes transition into a solid mechanical assembly." width="100%">
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/codesknight/Cader/actions/workflows/ci.yml"><img src="https://github.com/codesknight/Cader/actions/workflows/ci.yml/badge.svg" alt="Windows and Linux CI"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D24.9-43853D?logo=nodedotjs&logoColor=white" alt="Node.js 24.9 or newer"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-0891B2" alt="MIT license"></a>
</p>

<p align="center">
  An extensible CAD agent, built on DeepSeek Harness.<br>
  Plan with models. Act through tools. Verify with evidence.
</p>

<p align="center">
  <a href="#overview">Overview</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="docs/cli/README.md">CLI User Guide</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="#documentation">Documentation</a>
</p>

---

<a id="overview"></a>

## Overview

Cader is an extensible AI agent project for computer-aided design. It combines
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and Cordis with
CAD tools exposed through the Model Context Protocol (MCP).
[AutoCAD-MCP](https://github.com/codesknight/AutoCAD-MCP) is the first backend integration.

**[Read the CLI user guide →](docs/cli/README.md)** · [简体中文](docs/cli/README.zh-CN.md)

The strategy is **CLI First**: establish the agent foundation with DSH Headless,
evaluate a community TUI, then build Cader's own CLI. Web UI and CAD-embedded plugins
follow once the underlying services are stable.

> **Project status — v0.3 execution enablement.** Model profiles, bounded delegation, and read-only
> AutoCAD integration have smoke-test evidence. The **persistent `cader` terminal** provides
> a colored banner, Slash commands, resumable sessions, references and streamed replies.
> `exec` and the terminal now default to ask permissions and expose program-controlled CAD/file/Shell tools. Community TUI compatibility has only been
> statically reviewed. A controlled CAD scheduler
> passes component fixtures and a **real AutoCAD draw–save–read-only reopen** test for
> the reviewed line/circle/text plan. Image-to-DWG execution remains blocked.

| Capability | Current implementation |
|---|---|
| Agent runtime | DSH default AgentLoop, Cordis, official model adapter and MCP client |
| Interactive terminal | Colored CADER banner, 16 Slash entries, Tab completion, Esc cancellation, private sessions and confirmed user Shell |
| Context assembly | Stable Static prompts plus dynamic Available context; explicit, role-scoped Skill catalog and on-demand references |
| Delegation | Main agent coordinates up to **5 concurrent subagents**; children return results without delegating |
| Model profiles | YAML profiles for main, text-review, and vision agents; credentials come from environment variables |
| CAD integration | Model-driven scratch drawing, editing and saving with approvals; separate HTTP fixture scheduler |
| Verification | Independent entity/file/reopen checks, image fact/graph gates, deterministic fixtures and Windows/Linux CI |

```text
CLI / scripts → Cader profile → DSH + Cordis → MCP → AutoCAD
                    │
                    ├── Static + Available context
                    ├── Main agent → bounded subagents → main decision
                    └── Policies, budgets, events, and verification
```

<a id="quick-start"></a>

## Quick Start

### 1. Prepare the environment

| Requirement | Version / purpose |
|---|---|
| Node.js | **24.9.0 or newer** |
| pnpm | **11.28.5**, managed with Corepack |
| Git | Clone and track the workspace |
| uv + Python | Optional Python MCP diagnostics; Python **3.11** is pinned in `cader-mcp/` |

The first smoke test needs **no API key and no AutoCAD installation**.

### 2. Install and run

Run from a terminal with Node.js and Corepack available:

```sh
git clone https://github.com/codesknight/Cader.git
cd Cader
corepack enable
corepack prepare pnpm@11.28.5 --activate
pnpm install --frozen-lockfile
pnpm run doctor
pnpm test
pnpm smoke
```

`pnpm run doctor` checks the Node runtime. `pnpm smoke` exercises actual DSH components
with deterministic tools and should report `ok: true` with six passing checks.
It saves configuration, events, verification results, and a summary under
`.cader/runs/<run_id>/`. This is a component fixture, not a real-model or CAD benchmark.

<details>
<summary><strong>Optional: Python MCP diagnostics</strong></summary>

Install [uv](https://docs.astral.sh/uv/) and run from the repository root:

```sh
uv sync --project cader-mcp --locked
uv run --project cader-mcp pytest -q cader-mcp/tests
uv run --project cader-mcp cader-mcp smoke
```

The Python smoke is an offline MCP protocol fixture. Real server connections use a
separate local JSON configuration; see the [configuration guide](docs/development/model-configuration.md).

</details>

### 3. Start the interactive terminal

Build once, then launch. Windows PowerShell users should use the `.cmd` entry points:

```powershell
pnpm.cmd build
.\cader.cmd
```

On Linux/macOS, run `pnpm build`, then `pnpm exec cader`. Windows users can install the
launcher into a writable user directory **already on PATH**:

```powershell
pnpm.cmd run cli:install --bin-dir "$env:USERPROFILE\.local\bin"
cader
```

```text
cader [general] › /help
cader [general] › /model
cader [general] › /mcp use configs/mcp/AutoCAD.local.yaml
cader [general] › Assess @benchmark/fixtures/vision-calibration.png
cader [general] › /resume
```

Use `/status`, `/skills`, `/domain`, `/context`, `/compact`, `/checkpoint` and the other
registered commands; Tab completes input, Esc cancels work, and `!dir` requests a confirmed
user Shell command. Conversation and compaction require paid model credentials; startup,
help and session management do not. See the [CLI user guide](docs/cli/README.md).
DWG `/open` currently registers a reference; `/undo` reports an unavailable capability.
Checkpoints contain conversation and reference manifests, without a CAD snapshot.
The live model probe returned `QUOTA`; successful live multi-turn behavior remains unverified.
Offline DSH multi-turn tests and Windows terminal interactions have passed.

### Single user task

With your root `.env` and local MCP configuration ready:

```sh
pnpm run cader --help
pnpm run cader exec "Inspect layers without editing the drawing" --mcp configs/mcp/AutoCAD.local.yaml
```

`exec` accepts your task; `live-smoke` remains a fixed diagnostic. Both retain the current
permission policy (ask by default). Real tasks call the paid provider. Failures now include a sanitized
`errorCode`, `source`, and actionable `hint`; `QUOTA` is a provider failure, not proof of MCP failure.
See [CLI usage and diagnostics](docs/development/cli.md) for direct JSON output and limits.

Results separate `run_status` from `task_status`. A completed read-only model task is
`unverified`; `exec --intent redraw` returns `blocked` without starting a model or MCP.
No model answer is treated as proof that a DWG was created.

### 4. Inspect the controlled CAD contract

```sh
pnpm run cader cad-contract
pnpm run cader cad-test --backend http --mcp configs/mcp/AutoCAD.managed.local.yaml --plan benchmark/fixtures/managed-geometry.plan.json --output .cader/artifacts/geometry-001.dwg --authorize-write
```

The first command is offline. Copy [the managed profile example](configs/mcp/AutoCAD.managed.example.yaml)
to your local file, set its Python/cwd and environment references, and start an authenticated Bridge.
MCP now provides `autocad_mcp.managed_server`; the ordinary server keeps its COM default.
`--backend http` does not switch the server. The second command creates a new working drawing
when capabilities pass; it needs no model API call. Use a new output filename each time.
Only the shipped, reviewed three-entity plan is allowed. Image-redraw plans stay blocked.
Unknown writes freeze the workspace: `cad-reconcile` only queries, never replays or unlocks.
See [the public contract](docs/contracts/managed-cad-v1.md) and [execution policy](docs/architecture/controlled-writes.md).

The implementation baseline is **revision 2 / mapping revision 1**: writable working documents and read-only
verification documents have separate bindings; rollback checks use authoritative observed-event
revisions. Output directories bind at creation, and reconciliation distinguishes input/output
documents. See [the MCP alignment response](docs/contracts/mcp-alignment-response-2026-11-19.md)
and the [schema/example hash manifest](configs/contracts/cader-v1.manifest.json).
The shared snapshot remains unfrozen. [Cader's independent real-run report](docs/validation/2026-11-19-cader-cli-real-loop.md)
records a 31,988-byte DWG, geometry comparison after reopening, process cleanup and limits.
This is a fixed-plan CAD test; it does not evaluate model planning or image reconstruction.

<a id="configuration"></a>

## Configuration

Editable agent assets live together under `configs/`:

```text
configs/
├── models/                  # MainAgent, SubAgent, VisionAgent YAML profiles
├── domains/                 # Registered terminal domain guidance
├── mcp/                     # DSH YAML and Python diagnostic JSON examples
├── cad/                     # Allowed operations and reviewed plan hashes
├── contracts/               # Versioned CAD/task/perception JSON schemas
├── prompts/static/          # Stable role and coordination instructions
├── skills/                  # Reviewed, on-demand skill content
└── runtime.yaml             # Registered profiles, concurrency, budgets, tools
```

The root `.env` provides credentials; `.cader/` stores private runtime artifacts.
[`configs/skills/catalog.yaml`](configs/skills/catalog.yaml) registers `cad-inspection` and
`cad-redraw-review`. CLI discovery and DSH loading use the same catalog. Adding a folder
alone does not register a capability or grant tool execution.

### CAD redraw assessment

```sh
pnpm run cader skills list
pnpm run cader skills show cad-redraw-review
pnpm run cader exec "Assess the reference, identify missing scale evidence, and propose verification steps" --skill cad-redraw-review --image benchmark/fixtures/vision-calibration.png
```

The first two commands need no key or CAD. The last calls your image-capable main model;
the bundled image is a synthetic attachment demo, not a drawing benchmark. Replace it with
your own workspace PNG/JPEG for reference review (up to 10 MiB / 40 million pixels).

This Cader-authored Skill assesses evidence and redraw readiness. It does **not generate DWG**,
execute scripts, or open write tools. It follows a review of
[AutoCAD Redraw Skills](https://github.com/pengxiaoan/autocad-dwg-redraw-skill);
the pinned upstream snapshot had no explicit license, so its files are not redistributed.
See the [research and integration analysis](docs/research/redraw-skill-integration-2026-11-19.md)
for the workflow mapping, code-review findings, and planned MCP execution/verifier layers.

Local image cases can also be checked with `pnpm image-test --manifest benchmark/image-cases.example.json`;
add `--live` for paid recognition tests against independent expected JSON. User images in
`tests/images/` stay local. [First real-image test results](docs/research/local-image-tests-2026-11-19.md)
separate input/recognition checks from the still-pending CAD drawing workflow.

For dense text, `exec --image <file> --crop x,y,width,height --rotate 90` and the scoped
`cader_view_image` tool use original-resolution regions. Events record source, view,
attachment and actual request-image hashes with coordinate mappings. `assessment-check`
compares structured facts and port connectivity with independent expectations. These gates
do not prove real-image recognition accuracy or DWG topology; see [perception evidence](docs/contracts/perception-v1.md).

### Connect your models and AutoCAD-MCP

1. Create `.env` from [`.env.example`](.env.example) **if it does not already exist**,
   then set `DEEPSEEK_API_KEY` locally. YAML references the variable name, never its value.
2. Review [`configs/models/`](configs/models/). Current profiles use **deepseek-flash**
   for main and vision agents, and **deepseek-v4-pro** for text review.
3. Copy [`AutoCAD.example.yaml`](configs/mcp/AutoCAD.example.yaml) to
   `configs/mcp/AutoCAD.local.yaml`. Set `command` to the separate AutoCAD-MCP Python
   executable and `cwd` to that backend's checkout.

```sh
pnpm models
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml
```

`pnpm models` validates configuration without calling a provider. `live-smoke` invokes
the paid model API and local CAD backend, checking read-only operations and delegated
results. Real AutoCAD execution requires Windows and a working backend installation.

For vision calibration, supply the image and independent expected result:

```sh
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --image benchmark/fixtures/vision-calibration.png --expected-image benchmark/fixtures/vision-calibration.expected.json
```

The root `.env` and `*.local.yaml` / `*.local.json` under `configs/` are ignored by Git.
DSH YAML and Python diagnostic JSON use different schemas.
See the [model and MCP guide](docs/development/model-configuration.md) for full details.

<a id="roadmap"></a>

## Roadmap

| Stage | Focus | Status |
|---|---|---|
| Agent foundation | DSH, model profiles, Static / Available, read-only MCP smoke | Implemented; broader M0 validation continues |
| Headless + community TUI | Full Headless profile, session lifecycle, Windows TUI compatibility | Next / [TUI validation #9](https://github.com/codesknight/Cader/issues/9) |
| Cader CLI | Local launcher, persistent terminal, visible sessions and permission-controlled `exec`; structured event stream pending | [Interactive terminal #16](https://github.com/codesknight/Cader/issues/16) / [CLI foundation #10](https://github.com/codesknight/Cader/issues/10) |
| CAD workflow | Working copies, draw–save–reopen, independent verification, benchmarks | Planned / [CAD workflow #3](https://github.com/codesknight/Cader/issues/3) |
| Additional interfaces | Web UI and CAD-embedded plugins sharing the same services | Later |

See the [CLI First plan](docs/architecture/cli-first.md) for stage acceptance criteria.

<a id="documentation"></a>

## Documentation

| Resource | Contents |
|---|---|
| **[CLI User Guide](docs/cli/README.md) · [中文使用手册](docs/cli/README.zh-CN.md)** | Installation, commands, configuration, sessions, scripting and troubleshooting; maintained with the code |
| [Documentation index](docs/README.md) | User, integration, architecture and contributor documentation |
| [Technical design v0.2](docs/designs/Cader_Technical_Design_v0.2.md) · [CLI design](docs/designs/Cader_CLI_Design.md) | Original proposals; planned APIs are not shipped features |
| [Architecture decisions](docs/adr/) | Harness selection, model roles, configuration layout, CLI First |
| [Model and MCP guide](docs/development/model-configuration.md) | Profiles, credentials, local MCP setup, live smoke |
| [Skill integration analysis](docs/research/redraw-skill-integration-2026-11-19.md) · [ADR 0004](docs/adr/0004-reviewed-skill-catalog-and-redraw-assessment.md) | Upstream research, Cader-owned assessment, registration and capability boundaries |
| [Development records](docs/development/README.md) | Requirements, logs, tests, bugs, and iteration history |
| [Live smoke evidence](docs/research/smoke-2026-11-19.md) | Real-model, read-only AutoCAD, and synthetic vision-calibration results |
| [Benchmark specification](benchmark/README.md) | G01–G10 scenarios; real-model benchmark scores are not yet published |

Detailed design and development notes are currently mostly in Chinese.
The cover is conceptual artwork, not an application screenshot or CAD test result.

## Contributing

Start with the [open issues](https://github.com/codesknight/Cader/issues) and
[development process](docs/development/process.md). Run `pnpm typecheck` and `pnpm test`
before submitting changes; add `pnpm smoke` for Harness changes. Update both language CLI guides with command, configuration or behavior changes. Keep credentials,
private drawings, and raw live-run artifacts out of commits.

## License

[MIT](LICENSE) · Copyright © 2026 codesknight

Real-model CAD execution evidence: [acceptance report](docs/validation/2026-11-20-agent-execution.md).

Development snapshot 0.4.0-dev.2 adds program-owned quality phases, automatic vision, task approval and local patches. Autonomous calls work on real CAD; full circuit quality acceptance remains open. See [autonomous quality evidence](docs/validation/2026-11-20-autonomous-quality.md) and [retained reliability failures](docs/validation/2026-11-20-reliable-execution.md).
