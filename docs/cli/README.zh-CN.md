# Cader CLI 使用手册

[English](README.md) · **简体中文** · [项目首页](../../README.zh-CN.md) · [文档导航](../README.md)

**适用版本：Cader 0.4.0-dev.5 · 更新日期：2026-11-21**

Cader CLI 是基于 DeepSeek Harness 的 CAD Agent 终端：在一个持续会话中描述任务、选择模型和技能、引用图片、查看 CAD 状态，或用单次命令接入脚本。

本手册随代码在同一仓库维护，描述当前实现。设计提案与待开发功能见[开发路线](../development/roadmap.md)。

## 目录

- [安装与启动](#install)
- [第一次对话](#first-session)
- [交互命令](#slash-commands)
- [文件引用、快捷键与 Shell](#interaction)
- [模型、MCP 与 Skill 配置](#configuration)
- [单次命令与脚本](#commands)
- [会话与数据](#sessions)
- [CAD 能力与验收](#cad)
- [常见问题](#troubleshooting)
- [更新与反馈](#updates)

<a id="install"></a>

## 安装与启动

### 环境要求

| 依赖 | 要求 |
|---|---|
| Node.js | 24.9.0 或更新版本 |
| pnpm | 11.28.5；以下安装示例要求 Corepack 已可用 |
| Git | 获取、更新源码 |
| AutoCAD 与 AutoCAD-MCP | 仅真实 CAD 操作需要；使用独立的 MCP 环境 |
| uv / Python | 可选，供 Python MCP 诊断使用 |

当前采用**源码构建与本地启动器**，尚未发布可通过 `npm install -g` 安装的公共包。启动终端、查看帮助和离线 smoke 不需要模型密钥或 AutoCAD。

### Windows PowerShell

确保支持的 Node.js 已在 PATH 中，再执行：

```powershell
git clone https://github.com/codesknight/Cader.git
cd Cader
corepack.cmd enable
corepack.cmd prepare pnpm@11.28.5 --activate
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
.\cader.cmd
```

使用 `.cmd` 可避免 PowerShell 将 `pnpm` 解析到被执行策略阻止的 `pnpm.ps1`，无需放宽执行策略。

要直接输入 `cader`，将启动器安装到**已经在 PATH 中**且当前用户可写的目录。例如，仅当下列用户目录已在 PATH 中时：

```powershell
pnpm.cmd run cli:install --bin-dir "$env:USERPROFILE\.local\bin"
cader --version
cader
```

安装器不修改 PATH，不覆盖其他来源的同名启动器，并拒绝可能遮蔽 CMD 的现有 `cader.ps1`。没有合适目录时，继续使用仓库内 `.\cader.cmd`。
启动器指向当前源码目录，移动或删除仓库后需重新安装。若本仓库已准备 `.cader/tools/node-v24.9.0-win-x64/node.exe`，Windows 启动器可优先使用它；全新克隆不会自动下载该运行时。

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

本手册后续示例用 `cader` 表示已安装的入口；未安装全局启动器时，Windows 替换为 `.\cader.cmd`，Linux/macOS 替换为 `pnpm exec cader`。除交互会话的工作目录切换外，命令示例均在仓库根目录执行。

<a id="first-session"></a>

## 第一次对话

首次创建根 `.env`，已有文件请直接编辑：

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Linux/macOS 对应命令为 `test -f .env || cp .env.example .env`。在本机编辑器中填写 `DEEPSEEK_API_KEY`，不要提交或分享 `.env`；也可以由进程环境提供。自然语言任务与 `/compact` 会调用模型并产生费用。

运行 `cader` 后，在彩色 CADER 标识下输入：

```text
/help
/model
/skills list
/domain electrical
说明检查一张电路图时，需要确认哪些符号、文字和连接关系。不要调用工具。
/context
/exit
```

这是输入示例，模型回答不保证逐字相同。首次真实 CAD 使用前，先完成下文的 MCP 配置。启动时自动连接 `configs/mcp/AutoCAD.local.yaml`（若存在），显示服务连接状态、发现与暴露的工具数量。COM 状态的 `not_probed` 不代表已经探测到 CAD 版本；执行实际 CAD 工具才会建立原生连接。

| 启动方式 | 行为 |
|---|---|
| `cader` | 在交互终端中持续运行；非 TTY 输入输出时显示帮助，退出 0 |
| `cader chat --workspace "路径"` | 在指定工作目录进入会话，目录必须存在 |
| `cader chat --stdio` | 显式接收管道文本；仍输出面向人的文字，Shell 无法获得交互批准 |
| `cader --help` / `cader --version` | 不加载项目配置、不调用模型或 MCP |

<a id="slash-commands"></a>

## 交互命令

Slash 命令在 Cader 会话内部输入。尖括号表示需要替换的参数，方括号表示可选参数；输入时不要保留这些括号。

| 命令 | 用法与当前行为 |
|---|---|
| `/help` | 查看命令及快捷键 |
| `/open <路径>` | 选择 PNG/JPEG 供后续对话使用；DWG 仅登记元数据，明确返回 `CAD_OPEN_UNAVAILABLE`，未在 AutoCAD 中打开 |
| `/cd [路径]` | 查看或切换工作目录，清空原附件引用；不改变父 Shell 目录 |
| `/status` | 查看目录、模型、权限、MCP连接与工作图绑定；COM仅返回生命周期状态 |
| `/model [ID]` | 列出或选择已配置模型，例如 `/model MainAgent`；只影响当前主会话模型选择 |
| `/mcp list` | 列出配置文件 |
| `/mcp barrier` | 只读核对旧缺参屏障、原始审计及当前工具schema，显示人工复核资格 |
| `/mcp resolve` | 仅用户可发起的旧缺参复核；证据符合且明确确认后归档原屏障，要求新建工作图 |
| `/mcp use <配置路径>` | 选择 MCP 配置，例如 `/mcp use configs/mcp/AutoCAD.local.yaml` |
| `/mcp tools` / `/mcp off` | 发现服务工具或禁用后续 MCP 连接；发现工具不等于授权 Agent 使用全部工具 |
| `/skills list` | 查看主 Agent 可见的 Skill |
| `/skills use <名称>` / `/skills off` | 选择或取消预加载；角色可见的 Skill 目录仍可按需加载 |
| `/domain [ID]` | 列出或选择专业指导，当前为 `general`、`electrical` |
| `/context` | 查看文字 token 估算、最近 provider usage 及引用数量；估算不含图片和工具 token |
| `/compact` | 调用模型生成摘要，保留原对话；该请求关闭工具、MCP 与委派，失败时保留原上下文 |
| `/clear` | 保存旧会话，开始空白会话，保留模型等偏好 |
| `/resume [会话ID]` | 列出或恢复可见对话、摘要和选择，不重放工具、Shell 或 CAD 请求 |
| `/undo` | 明确返回 `CAD_UNDO_UNAVAILABLE`；当前没有受控 CAD 撤销接口 |
| `/checkpoint` | 保存会话及工程引用哈希清单；不备份 DWG 或创建 CAD 数据库恢复点 |
| `/permissions [模式]` | read-only / ask（默认）/ workspace-write / full-access；另支持 shell ask / shell deny |
| `/quality` / `/quality resume` | 查看质量阶段及未完成项；同一连接安全重验，不重放绘图，累计最多3轮修正 |
| `/exit` | 保存会话并退出 |

上表按子命令展开，包含 17 个 Slash 根命令。MCP连接跨轮保持；`/mcp off`、切换配置、工作目录、清空/恢复会话或退出时释放。恢复会话重置为 ask，不恢复 CAD 写入绑定；新连接必须新建工作图。

| 模式 | 查询 | 工作图绘制/编辑 | 删除、覆盖 |
|---|---|---|---|
| read-only | 自动 | 拒绝 | 拒绝 |
| ask（默认） | 自动 | 每次审批 | 每次审批 |
| workspace-write | 自动 | 本连接工作图内自动 | 审批 |
| full-access | 自动 | 本连接工作图内自动 | 授权范围内自动 |

CAD写入只作用于本连接通过 `new_drawing` 新建的工作图；不继承桌面既有图纸的写权限。保存工作区外路径在 workspace-write 下仍需审批。写后查询实际实体；失败或结果不明保留 `.cader/locks/managed-write.json` 并冻结，当前 COM 无请求日志自动对账，需人工检查原记录与图纸，不删除锁后重试。另一固定计划调度器共用写锁。

<a id="interaction"></a>

## 文件引用、快捷键与 Shell

### 引用图片与图纸

```text
评估 @benchmark/fixtures/vision-calibration.png 中可直接确认的信息。
/open "tests/images/我的参考图.png"
列出当前参考图中不可读或需要局部放大的区域。
请记录 @drawing.dwg 的文件身份，不要推断其中的实体。
```

除仓库内的校准图外，上述文件名是示例，使用前替换为当前工作区中的真实文件。

- 支持 `@draft.png`、`@"路径有空格.jpg"` 和 `@drawing.dwg`，引用必须位于当前工作目录内。
- PNG/JPEG 上限为 10 MiB、4000 万像素；当前每轮最多一张活动原图，新图会替换它。图片选择会保留到后续轮次，发送给配置声明支持图片的模型。
- DWG 上限为 64 MiB，只校验文件头并记录大小与 SHA-256，不解析图纸内容。PDF 尚未支持。
- 每轮前复核已选文件哈希，变化后要求重新选择；`/cd` 清空引用。图片、Skill 与 DWG 引用均不授予写权限。

### 快捷键

| 按键 | 行为 |
|---|---|
| Tab | 补全 Slash 名称、`@` 引用及 `/open`、`/cd` 路径；含空格的路径自动补引号 |
| ↑ / ↓ | 查看本进程输入历史 |
| Esc | 中断运行中的任务；空闲时清空当前输入 |
| Ctrl+C | 运行中请求中断并等待清理；空闲时退出 |
| Ctrl+D | 关闭输入并退出 |

取消后会等待当前运行清理完成，不自动重放请求。支持 VT 的终端提供完整编辑体验；`TERM=dumb` 使用简化输入。

### 执行用户 Shell

```text
!dir
/permissions shell deny
/permissions shell ask
```

`!` 仅响应用户直接输入，逐条展示命令与工作目录，输入 `y` 批准本次执行；默认拒绝。Windows 使用 PowerShell，Linux/macOS 使用 `/bin/sh`。
命令以本机账号执行，**不是沙箱**。用户 `!` 命令与 Agent 的 `cader_shell` 分开：前者始终逐条审批且输出不入模型上下文；后者输出回传模型，在 read-only 禁止，ask/workspace-write 逐条审批，full-access 自动执行。`shell deny` 隐藏 Agent Shell 并禁止用户 Shell。
执行时间上限为 30 秒，输出上限为 64 KiB；取消针对本次进程树，已有副作用不自动回滚。管道会话不批准 Shell。

<a id="configuration"></a>

## 模型、MCP 与 Skill 配置

所有可维护配置位于仓库 `configs/`，密钥来自根 `.env` 或环境变量。修改配置后重启终端。

| 路径 | 用途 |
|---|---|
| [`configs/models/`](../../configs/models/) | 模型地址、名称、`api_key_env`、输入能力与生成参数 |
| [`configs/runtime.yaml`](../../configs/runtime.yaml) | 注册 profile、预算、只读工具和委派限制 |
| [`configs/mcp/`](../../configs/mcp/) | 独立 MCP 进程的启动与环境引用 |
| [`configs/skills/catalog.yaml`](../../configs/skills/catalog.yaml) | Skill 名称、角色可见性与资源注册 |
| [`configs/domains/catalog.yaml`](../../configs/domains/catalog.yaml) | 专业指导目录 |
| [`configs/prompts/static/`](../../configs/prompts/static/) | 稳定统筹与角色提示词 |

### 选择模型

| 配置 ID | 当前模型 | 声明输入 |
|---|---|---|
| `MainAgent` | `deepseek-flash` | 文字、图片 |
| `SubAgent` | `deepseek-v4-pro` | 文字 |
| `VisionAgent` | `deepseek-flash` | 文字、图片 |

```text
/model SubAgent
/model MainAgent
```

配置通过 `api_key_env: DEEPSEEK_API_KEY` 引用凭据，当前 `base_url` 为 `https://api.deepseek.com`。不要在 YAML 中填写密钥值。
`/model` 不改变子 Agent 的模型配置或工具权限；只有主 Agent 可委派，最多 5 个并行子 Agent、深度 1。模型声明支持图片不等于图片识别准确度已通过验证。

### 连接 MCP 与自然语言绘图

先复制示例，已有本机配置请直接编辑：

```powershell
if (-not (Test-Path configs/mcp/AutoCAD.local.yaml)) {
  Copy-Item configs/mcp/AutoCAD.example.yaml configs/mcp/AutoCAD.local.yaml
}
```

按独立 AutoCAD-MCP 环境设置 `command` 为其 Python 可执行文件，设置 `cwd` 为该项目目录；相对 `cwd` 以 YAML 所在目录解析。启动所需 CAD 后，在 Cader 内输入：

```text
/mcp use configs/mcp/AutoCAD.local.yaml
/mcp tools
/status
只读取当前图层并总结，不修改图纸。
```

MCP 配置路径以 Cader 配置根目录为基准，须在其中。普通 profile 与受控 HTTP profile 用途不同，不能互换；`/mcp use` 不自动启动 AutoCAD 或切换后端。

也可用短文件名 `/mcp use AutoCAD.local.yaml`；配置选择后在 `/mcp tools`、状态查询或下一轮任务建立连接。发现44个工具不代表全部开放：当前动态执行审核普通 COM 工具的子集，不开放不匹配的 HTTP 原子接口、VQA 或任意脚本入口。

```text
/permissions ask
新建空白工作图，在红色图层上画100×60矩形和中心半径15的圆，然后查询验证。
把刚才的圆向右移动5个单位，保存为工作目录下 test.dwg。
```

模型自主选择工具，程序展示具体参数并等待 `y`；新建空白图无需提供已有DWG或参考图。模型还可使用 `cader_read_file`、`cader_write_file`、`cader_edit_file`、`cader_glob`、`cader_list_files` 和受控 Shell。文件工具限工作区、64KiB文本，排除 `.env*`、`.git`、`.cader` 与CAD文件；覆盖和Edit需要审批（full-access除外）。Glob跳过符号链接及私有目录。Shell是用户显式授权的本机通道，不提供文件沙箱保证。
当前 Agent 仅暴露已审查的后端状态、图层、符号库读取工具；工具发现清单可能更长。

### 使用 Skill 与专业指导

```text
/skills use cad-redraw-review
/domain electrical
评估 @benchmark/fixtures/vision-calibration.png，区分可确认事实与未知信息。
```

当前内置 `cad-inspection` 与 `cad-redraw-review`。新增 Skill 需要显式注册，复制一个目录不会自动加载。
Skill 和专业指导用于规划与检查，不授予 Shell、COM 或 CAD 写权限。详细配置见[模型与 MCP 指南](../development/model-configuration.md)。

<a id="commands"></a>

## 单次命令与脚本

### 命令总览

| 命令 | 用途 | 模型 / CAD 调用 |
|---|---|---|
| `cader --help` / `cader --version` | 帮助 / 版本；别名 `help`、`-v` | 无 |
| `cader chat [--workspace <目录>] [--stdio]` | 持续会话 | 按实际输入决定 |
| `cader doctor` | 检查 Node 版本，不是完整 CAD 诊断 | 无 |
| `cader models` | 显示模型配置及凭据是否设置，脱敏输出 | 无 |
| `cader skills list` | 列出主 Agent 可见的技能 | 无 |
| `cader skills show <名称> [--resource <ID>]` | 读取已注册正文或资源 | 无 |
| `cader exec "<任务>" [选项]` | 单次自然语言任务，默认 ask；非交互时需要审批的调用拒绝 | 调用模型；可选 MCP |
| `cader harness-smoke` | 离线 DSH 组件检查；pnpm 脚本名为 `smoke` | 无真实模型/CAD |
| `cader live-smoke --mcp <配置> [--image <图片> --expected-image <JSON>]` | 固定只读诊断，图片期望参数可选 | 真实模型及所选 MCP/CAD |
| `cader cad-contract` | 导出受控 CAD 契约 | 无 |
| `cader cad-test --backend http --mcp <配置> --plan <JSON> --output <DWG> [--authorize-write]` | 已审查固定几何的受控闭环 | 无模型；授权后真实 CAD 写入 |
| `cader cad-reconcile --run <运行目录> --mcp <配置>` | 查询未知请求结果，不重放或解锁 | 所选 MCP |
| `cader assessment-check --assessment <JSON> --expect <JSON>` | 独立事实和抽象连通图检查 | 无 |

### 单次任务与图片区域

```powershell
cader exec "读取图层并总结，不修改图纸" --mcp configs/mcp/AutoCAD.local.yaml
cader exec "评估图中信息" --skill cad-redraw-review --image benchmark/fixtures/vision-calibration.png
cader exec "检查左上区域" --image benchmark/fixtures/vision-calibration.png --crop 0,0,128,128 --rotate 90
```

裁剪示例须匹配所选原图尺寸。`exec` 支持 `--permissions read-only|ask|workspace-write|full-access`、`--mcp`、`--skill`、`--image`、`--crop x,y,w,h`、`--rotate 0|90|180|270` 和 `--intent assess|redraw`；先按原图像素裁剪，再顺时针旋转。exec无交互审批；需要自动绘图时显式选 workspace-write，并在同一任务先新建工作图。
`assess` 为默认；`redraw` 当前返回 `blocked / WRITE_CAPABILITY_UNAVAILABLE`，不调用模型或 MCP。
交互会话的 `/model`、`/mcp`、`/skills` 选择不影响另一次 `exec`，单次任务从配置及本次参数装配。

### JSON 与退出码

需要严格 JSON 时直接使用构建后的入口，避免 `pnpm run cader` 的构建日志混入：

```powershell
node apps/cli/dist/index.js exec "说明检查步骤，不调用工具"
```

单次任务报告为 stdout 的一个 JSON 对象，启动异常为 stderr 的脱敏 JSON，帮助为普通文本。交互终端和 `chat --stdio` 不是稳定 JSONL 接口。

| 退出码 | 意义 |
|---|---|
| 0 | 命令正常或运行成功；只读任务可能仍为 `task_status=unverified` |
| 1 | 运行、配置、模型或连接失败 |
| 2 | 参数或命令错误 |
| 3 | 业务阻塞或验收未通过；`cad-reconcile` 保留冻结状态，也返回 3 |

同时读取 `run_status`、`task_status`、`verification`、`blocked_reasons` 与 `artifact`。`ok=true` 或模型正文不能证明已生成并验收 DWG。

<a id="sessions"></a>

## 会话与数据

```text
/context
/compact
/checkpoint
/resume
/resume session-00000000-0000-0000-0000-000000000000
```

最后一行是 ID 格式示例，实际使用 `/resume` 列出的 ID。`/clear` 保存原会话并新建空白会话；恢复不会重放任何操作。

| 位置 | 内容 |
|---|---|
| 配置根 `.cader/sessions/` | 可见对话、摘要、配置选择与引用身份；Shell 审计事件单独记录 |
| 配置根 `.cader/checkpoints/` | 会话与工程引用清单，不是图纸备份 |
| 当前工作目录 `.cader/runs/` | Agent 事件与任务验证报告 |
| `.cader/artifacts/` | 显式指定的私有输出目录；固定 CAD 测试在此保存 DWG |

交互配置根从当前目录向上发现 Cader 配置，或回到启动器所在仓库；`/cd` 仅切换工作目录。不要把这理解为任意项目配置合并或工程初始化。
可见用户输入和模型正文可能包含项目内容；即使凭据已脱敏，也应将 `.cader/` 保持私有。图片会在明确的模型调用链路中发送，运行记录可能包含附件；原始资料和完整会话不要随 Issue 上传。

<a id="cad"></a>

## CAD 能力与验收

交互 Agent 与 `exec` 默认 ask。真实文本模型已经自主完成新建、建层、直线/矩形/圆、移动圆、保存DWG与独立查询验收，见[执行验收](../validation/2026-11-20-agent-execution.md)。另外，固定计划调度器仍保留其HTTP保存/重开验收；COM动态路径尚无受控重开能力，不将两条链路的验收混用。

显式真实模型/真实CAD验收命令（会付费、创建新工作图并保存到私有运行目录；仅审批CAD操作）：

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --execution
```

高级集成测试先参照[受控执行指南](../development/cli.md#controlled-execution)，配置专用 HTTP profile、认证 Bridge 和新的输出文件名。此命令会真实写入新工作图，仅在准备好环境并决定执行时运行：

```powershell
cader cad-test --backend http --mcp configs/mcp/AutoCAD.managed.local.yaml --plan benchmark/fixtures/managed-geometry.plan.json --output .cader/artifacts/geometry-001.dwg --authorize-write
```

`--backend http` 是能力要求，不会自动切换服务端后端。仅允许审核哈希对应的固定计划；默认不覆盖文件。未知写入结果会冻结后续写入，只按原请求对账，不自动重放，也不要删除锁后重复提交。

尚未开放：任意既有 DWG 受控编辑、COM受控重开、CAD 撤销、CAD 快照恢复、图片到 DWG 的完整闭环、稳定 RunEvent JSONL、公共 npm 发布。
边界和证据见[受控写入设计](../architecture/controlled-writes.md)、[真实固定几何报告](../validation/2026-11-19-cader-cli-real-loop.md)和[交互终端验证](../validation/2026-11-19-interactive-terminal.md)。

<a id="troubleshooting"></a>

## 常见问题

| 现象 / 错误 | 处理方式 |
|---|---|
| `pnpm.ps1` 被禁止运行 | 使用 `pnpm.cmd`、`.\cader.cmd`；无需修改 PowerShell 执行策略 |
| 找不到 `cader` | 先在仓库运行 `.\cader.cmd` 或 `pnpm exec cader`；检查本地启动器目录是否已在 PATH 中 |
| Node 版本过低 / 尚未构建 | 检查 `node --version`；使用 Node >=24.9，执行安装及 `pnpm build`；便携 Node 不是克隆自带依赖 |
| 启动器安装 `EPERM` | 选择当前用户可写且已在 PATH 的目录，或继续用仓库启动器 |
| `QUOTA` / `ACCOUNT_QUOTA` | 检查 provider 余额、配额与模型权限；不能据此认定 MCP 不通 |
| `AUTH` / `RATE_LIMIT` | 检查凭据与端点，或等待限流恢复；不要在 Issue 粘贴密钥 |
| `CONFIG_NOT_FOUND` / `CONFIG_INVALID` | 单次命令从仓库根执行；检查模型/MCP/Skill YAML、环境引用与图片限制 |
| `MCP_CONNECTION_FAILED` | 检查独立 MCP Python、`cwd`、启动环境及服务端 stderr；普通与 managed profile 用途不同 |
| `MODEL_IMAGE_UNSUPPORTED` | 切换到声明图片输入的 profile，例如 `/model MainAgent` |
| `REFERENCE_CHANGED_RESELECT_REQUIRED` | 文件内容已变化，重新 `/open` 或 `@` 选择后再请求 |
| Tab 无补全或无颜色 | 检查是否 TTY、`TERM=dumb` 或 `NO_COLOR`；仅支持 VT 的终端可用 `TERM=xterm-256color`，`FORCE_COLOR=1` 显式开启颜色 |
| `/undo` 或 DWG `/open` 显示不可用 | 当前接口缺口，不是模型故障；不要通过扩大只读工具清单绕过 |

最近一次真实交互模型探测返回 `QUOTA`；离线多轮与 Windows 终端交互已验证，真实模型多轮成功仍待验收。历史测试结论与当前账户状态需分开判断。

<a id="updates"></a>

## 更新与反馈

源码更新后重新安装锁定依赖并构建，再启动终端：

```powershell
git pull --ff-only
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
```

Linux/macOS 将 `pnpm.cmd` 换为 `pnpm`。保留自己的 `.env`、`*.local.yaml` 与 `.cader/`；升级前处理本地 Git 变更，不使用强制覆盖。

在 [GitHub Issues](https://github.com/codesknight/Cader/issues) 反馈时提供 Cader/Node 版本、操作系统与终端、命令、脱敏 `errorCode` 和预期/实际行为；图片需明确允许公开后再上传。

CLI 功能变更须在同一提交中同步两种语言手册、帮助与示例；若行为不同，先修正文档或实现，再标记验收。[开发流程](../development/process.md)记录检查要求，未实现能力保留明确状态。


## v0.4 研发快照：执行事实、恢复与视觉反馈

`0.4.0-dev.1` 引入以下可靠性行为；当前 dev.2 的质量调度见下节，仍不是 v0.4 全量验收发布。

- `/mcp doctor`：通过实际查询诊断读能力，分别报告传输、缓存观察、工作图与冻结状态。当前COM可能惰性启动CAD，空文档时可能由后端创建默认图；不是独立的原生无副作用health接口。
- `/mcp recover`：仅在**同一原连接**收到明确写入成功响应、随后postflight读回失败时，重读并对账后恢复。结果未知、超时、重连、旧锁、截图未知均不自动解除，不重放写入。命令不会删除旧锁、关闭或重启AutoCAD。
- `cader_cad_health` / `cader_cad_recover`：模型可调用相同诊断/恢复能力。冻结后写工具从后续模型步骤移除；同批已排队请求返回 `blocked_not_dispatched`，不同于首个已派发操作的 `unknown`。
- 写入分别记录preflight、dispatch、acknowledgement、postflight、artifact verification。原MCP错误、HRESULT（可提取时）、调用/操作ID及异常栈留在私有执行JSONL。当前后端没有提供的COM线程ID、权威revision与MCP wire ID不伪造。
- 实体操作优先通过实际返回ObjectID调用get_entity核验，响应标记 `observation_scope=affected_entity`；它不是全图实体列表。文档级操作和显式最终查询仍读全图。健康状态里的全图数量是带时间戳的缓存。
- 三维多段线/填充要求每个点明确为有限的 `[x,y,z]`；不自动补零或展平错误点。非法参数在派发前拒绝且不冻结。
- 工具审计生成 `execution_evidence`；冻结强制 `ok=false` / `task_status=blocked`，即使模型本轮正常结束。终端显示确认操作数、未知数和未派发阻断数；操作数不是实体数。
- `cader_review_cad_view`：主Agent可导出本连接工作图的真实视图，并自动把图片附件交给视觉模型；不要求用户参考图或先存DWG。导出会改变视口/打印设置并写私有PNG，受现有权限及串行控制。默认每轮最多4次，配置 `max_visual_reviews_per_turn`（1–5）。当前后端未提供像素到CAD的权威映射；修改仍需查询实体坐标。真实导出已有超时失败记录，因此完整视觉纠错尚未验收。

显式实机入口（互斥，均会创建隔离草稿；后两种不以固定计划冒充模型推理）：

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --reliability
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --faults
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --visual
```

`--reliability` 是真实CAD确定性A/B/E复现，不调用模型；`--faults` 在真实CAD写入外注入客户端响应抑制/读回失败/取消，不冒充原生COM崩溃或真实网络丢包。`--visual` 使用付费真实模型自主绘制带缺陷房屋并请求视觉纠错；是否通过只看实际报告，不能以代码存在代替验收。

边界与失败证据见[本轮报告](../validation/2026-11-20-reliable-execution.md)。原Drawing8未知结果屏障仍保留；full-access和切换模型不能清除它。相邻MCP修补需另有授权，当前未修改。

CAD失败行现在直接显示错误码、阶段与“已派发/未派发”，完整异常留在私有JSONL。

冻结同时隐藏并阻止Agent Shell，即使full-access也不能经Shell绕开写屏障；用户主动!命令仍是独立逐条审批通道。

## dev.2：自主绘图质量任务

绘图、设计/生成图纸、重绘、示意图、布局及添加文字等请求会进入程序控制的质量任务。“能帮我画……吗”也按任务处理；“你能画什么”属于能力咨询。简单移动/旋转沿用工具后的确定性读回，不强制视觉往返。复杂图纸默认自动路由 VisionAgent，无需用户要求视觉检查或切换模型。

CLI 显示规划、绘制、几何验证、拓扑验证、视觉验证、修正和完成/待验证/阻断。模型提交不可中途修改的验收清单和组件绝对坐标布局，程序在绘图前拒绝组件重叠、内部端口及不存在的实体类型；随后查询实际 CAD 图元，检查支持的数量/标注、线段与包围盒交叉以及两端组件的串联闭环。电气任务自动加载 `electrical-quality` 知识，不提供固定绘图序列，也不扩张权限。

默认 ask 会审批具体任务计划及当前工作图。一次批准覆盖创建图层、绘图、视图检查和本任务新建实体的安全局部修正，累计最多3轮；本任务实体删除已在授权描述中明确列出。删除其他实体、保存/覆盖、文件及 Shell 操作仍按原策略处理。任务结束即撤销授权。`cader_apply_cad_patch` 可批量绘制/修改/删除；每项沿用原工具 schema、审批、串行写入和审计，首项失败停止，已确认项不得重放。

视觉报告用严格 schema 提交；最多一次格式修复复用同一图片，VisionAgent 输出上限为6144。运行时共享40次模型步骤、100次工具调用和4次视图评审预算；这是上限，并非每个任务必定消耗。取消、格式无效、视觉未通过、未知实体引用、观察期间图元变化或疑似视图裁切均不能标为完成。非必要观察和程序已证明的几何精度不应充当视觉缺陷；无可定位缺陷但结论仍不确定时保留待验证，不推测性改图。

```text
画一个带有 5V 电源和一个灯泡的串联电路图。
/quality
/quality resume
```

这是输入示例，**不代表该完整实机案例已通过**。`/quality` 显示最新清单与证据路径；`resume` 在同一仍存活的 MCP 连接与工作图上重新查询/评审，跳过原始绘图，不重置3轮上限。切换连接、退出或恢复普通会话后，旧连接身份失效，不能自动继承写权限；冻结仍须按 `/mcp recover` 的原有条件处理，`/quality resume` 不解除屏障。

私有 `quality.json`、`verification.json`、`events.jsonl` 及执行日志记录请求、阶段、每轮检查、视觉结果、image hash、查询状态摘要及失败。原生 `document_revision` 和 `pixel_to_cad` 当前均不可用，明确为 null；ObjectID 必须能在实际查询中找到，像素不能单独决定编辑。边缘像素检查只是保守的裁切提示，不证明图片完整。

显式实机入口（会调用付费模型并创建真实工作图，使用隔离工作目录）：

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality
```

该入口使用默认 MainAgent（当前 Flash）完成上述一个自然语言需求，由 Harness 自动调用 Flash 视觉，并先用真实发现的 schema 做漏参负向预检；审批回调仅授权 CAD 操作，不是人工终端按键验收。它不保存 DWG，也不测试任意电路、原生文档修订或像素映射。查看[真实结果、失败和未完成项](../validation/2026-11-20-autonomous-quality.md)。

## dev.3：参数拒绝、诊断与恢复显示

直接CAD调用与程序MCP客户端在发送前执行schema校验；批量补丁先验证整个批次的schema，再执行任何一项。缺少height等必填项、类型/枚举/嵌套不符会明确显示`TOOL_ARGUMENTS_INVALID`或`CAD_FAILED_BEFORE_DISPATCH`、`preflight`、`未派发`，不会因此冻结。程序不替模型填默认值、不强制转换参数；Agent可以纠参后重新提交未执行的请求。补丁不是原子事务：后续权限/原生执行失败时，已经确认的项仍可能保留，禁止整批盲目重放。

远端isError、超时、丢响应不能仅凭“validation”等报错文字认定无副作用。没有成功确认的写入仍unknown/frozen；只允许既有同连接、已确认写入后的postflight读回恢复。本次不会自动清理旧版本的Drawing6或任何持久unknown锁。

状态新增`counts_scope`、`operation_mark`、`session_counts`、`freeze_operation`/`freeze_evidence`、`recovery.eligible/reason`及`cad_observation.stale_due_to_mutations`。CLI尾行明确区分本轮与会话累计；重开进程后历史屏障不计入新会话计数，仍会显示其来源及首发错误。缓存值过时或过滤查询为空不能证明全图为空，COM生命周期空字段也不能证明断连。

```text
为什么阻塞了
为何冻结
查看冻结原因
恢复
/mcp recover
```

上述自然诊断/恢复短语由程序处理，不调用模型；受限恢复不成功会明确显示“未恢复”及资格原因。模型调用恢复工具返回`recovered:false`时也不再显示成功勾号。冻结期间受控查询仍可用，重连/重启不会赋予旧文档权限。已经流式显示的回答只追加程序状态，失败时不再重打全文。

原连接已关闭或更换时，恢复原因是`ORIGINAL_CONNECTION_REQUIRED`；连接仍在但派发未获确认时是`DISPATCH_OUTCOME_UNCONFIRMED`。两者都不能通过重复恢复来放行写入。

本次真实Flash/AutoCAD验证已越过文字绘制并进入自动视觉，缺参负向预检未派发、未冻结；完整电路仍因疑似导出裁切和计划约束未通过。详见[dev.3修复与实际结果](../validation/2026-11-20-schema-preflight-fix.md)。

## dev.4：历史缺参屏障复核

启动时即读取工作区屏障并显示冻结原因，包括没有配置MCP的情况。已知冻结的绘图质量任务直接进入`blocked`，不再先付费调用模型生成计划；报告记录`model_run_status: not_started`。`run_status: succeeded`仅表示程序处理完成，业务仍为`ok: false`、`task_status: blocked`。本轮确认0不能推翻历史屏障。

旧版缺height记录不会因升级而自动消失。先退出仍在运行的旧Cader会话，在使用原工作目录的新会话中输入：

```text
/mcp barrier
/mcp resolve
```

需先选择原MCP配置。程序把原始缺参错误、请求、目标图、日志和当前schema关联核对；已确认写入、超时、截图、原生错误、证据变化或另一原写入进程仍活跃均拒绝。`eligible: true`只表示可人工复核，**不证明CAD未执行**。即使`full-access`也必须确认：原请求未执行、已结束且无运行中或延迟操作。无法确认时回答否，保留屏障；不要手动删锁。该入口不是通用reset，Agent没有对应工具。

用户审定后，原始unknown屏障、日志快照及带hash的决定记录保存到工作区`.cader/barriers/`，不修改旧unknown、不重放、不接管原图。程序关闭当前连接并丢弃任务授权及文档绑定；重新发送任务时必须新建工作图。`/quality resume`不能续接旧任务。复核互斥锁或文件读写失败均阻断；不自动清理崩溃遗留的复核锁。

Drawing6实际记录已用真实MCP schema完成只读复核，原屏障保持不变；真实用户批准归档及完整新绘图未代替用户执行。详见[诊断与边界](../validation/2026-11-21-legacy-barrier-review.md)。

## dev.5：减少可避免的写入屏障

指定图层的写入在派发前实时查询`list_layers`。图层不存在、无法查询或返回无效数据时，本次修改不发送，记为`failed_before_dispatch`，不冻结；Agent会收到先`create_layer`再提交未执行项的明确反馈。程序不会偷偷创建图层或重复已提交的批次。补丁失败结果新增`not_dispatched`索引列表，已确认项不得重放。

原生执行失败仍可能留下部分实体。工具结果及最终CLI会显示首发原生错误；若没有可信的执行终态，仍保留屏障。相邻AutoCAD-MCP本轮增加创建前图层检查及仅清理本次新建实体的防护；这是尽力清理，不是事务证明，清理失败/丢回执仍须保留现场。旧Drawing2的部分执行屏障不会被升级自动清除，`/mcp resolve`也不适用于它。

本轮MCP导出同时改为前台打印、显式fit-to-page及完整打印设置恢复，拒绝覆盖已有输出。减少背景任务延迟触发的截图冻结；未知导出异常仍不会自动重打或宣称完成。需重启Cader使其MCP子进程加载更新。

规划模型失败现在进入`blocked`并记录`quality.failure`与规划`model_runs`，明确显示QUOTA等原因及“尚未允许绘图”；不再笼统显示质量待验证。没提交有效计划显示`ACCEPTANCE_PLAN_MISSING`。QUOTA只表示服务侧配额/访问拒绝分类，不足以单独断言余额不足。

可通过显式实机入口重跑任意质量任务（付费模型、真实CAD；默认任务仍为串联电路）：

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task "新建一张空白图纸，绘制一个房子，旁边有棵树。"
```

`--task`仅随`--quality`接受；其它smoke模式仍拒绝。测试入口给模型自然语言需求，不提交固定操作序列。实测、失败及未解决边界见[依赖预检与部分执行报告](../validation/2026-11-21-dependency-and-partial-execution.md)。

旧任务已经部分执行而被冻结时，不要使用缺参复核来强行续写旧图。需要保留现场并开始独立新任务时，可从Cader源码目录使用新的工程工作区（不复用旧图或重放旧请求）：

```powershell
New-Item -ItemType Directory -Force .cader/workspaces/new-task
cader chat --workspace .cader/workspaces/new-task
```

此工作区仍默认ask、必须新建工作图，并受相同写屏障保护；新建工作区不代表旧操作已对账或旧图质量已通过。
