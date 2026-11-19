<p align="center">
  <img src="docs/assets/cader-cover.png" alt="Cader — 可扩展的 CAD 智能体。CAD 蓝图线框逐渐过渡为机械实体。" width="100%">
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <a href="https://github.com/codesknight/Cader/actions/workflows/ci.yml"><img src="https://github.com/codesknight/Cader/actions/workflows/ci.yml/badge.svg" alt="Windows 与 Linux CI"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D24.9-43853D?logo=nodedotjs&logoColor=white" alt="Node.js 24.9 及以上"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-0891B2" alt="MIT 许可证"></a>
</p>

<p align="center">
  基于 DeepSeek Harness，构建可扩展的 CAD 智能体。<br>
  以模型规划任务，以工具执行操作，以证据验证结果。
</p>

<p align="center">
  <a href="#overview">项目介绍</a> ·
  <a href="#quick-start">快速开始</a> ·
  <a href="#configuration">配置说明</a> ·
  <a href="#roadmap">开发路线</a> ·
  <a href="#documentation">文档索引</a>
</p>

---

<a id="overview"></a>

## 项目介绍

Cader 是面向计算机辅助设计的可扩展 AI Agent 项目，以
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与 Cordis 为运行基础，
通过模型上下文协议（MCP）连接 CAD 工具。
[AutoCAD-MCP](https://github.com/codesknight/AutoCAD-MCP) 是首个后端集成。

项目采用 **CLI First** 策略：先复用 DSH Headless 建立基础 Agent、验证社区 TUI，
再逐步实现 Cader CLI。待底层服务稳定后，继续开发 Web UI 与 CAD 内嵌插件。

> **当前阶段：M0 集成。** 模型配置、受限子任务委派和 AutoCAD 只读集成已有 smoke 验证记录。
> 当前可用入口是下文的 `pnpm` 命令，已增加接收用户任务的只读 `exec`；
> 可安装的 `cader` 产品入口、社区 TUI 接入仍在规划中。受控调度器已通过组件测试，
> 真实绘制—保存—重开闭环仍等待 MCP 新契约支持。

| 能力 | 当前实现 |
|---|---|
| Agent 运行时 | DSH 默认 AgentLoop、Cordis、官方模型适配器与 MCP 客户端 |
| 上下文组装 | 稳定 Static 与动态 Available；显式 Skill 清单、角色可见性与按需引用资料 |
| 子任务委派 | 主 Agent 最多协调 **5 个并行子 Agent**；子 Agent 返回结果，不继续委派 |
| 模型配置 | 主 Agent、文本审查和视觉子任务使用 YAML profile；凭据通过环境变量提供 |
| CAD 集成 | Agent profile 保持只读；独立程序调度器执行已审查固定几何计划 |
| 验证与记录 | 独立实体/文件/重开校验、图像事实与连通图门槛、fixture 和 Windows/Linux CI |

```text
CLI / 脚本 → Cader profile → DSH + Cordis → MCP → AutoCAD
                  │
                  ├── Static + Available 上下文
                  ├── 主 Agent → 受限子任务 → 主 Agent 统一决策
                  └── 策略、预算、事件与验证
```

<a id="quick-start"></a>

## 快速开始 · Quick Start

### 1. 准备环境

| 依赖 | 版本 / 用途 |
|---|---|
| Node.js | **24.9.0 及以上** |
| pnpm | **11.28.5**，通过 Corepack 管理 |
| Git | 获取代码与管理工作区 |
| uv + Python | 独立 Python MCP 诊断使用，可选；`cader-mcp/` 固定 Python **3.11** |

首次 smoke **不需要 API Key，也不需要安装 AutoCAD**。

### 2. 安装并运行

在已安装 Node.js 与 Corepack 的终端执行：

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

`pnpm run doctor` 检查 Node 运行环境。`pnpm smoke` 使用确定性工具验证真实 DSH 组件，
预期返回 `ok: true`，六项检查通过。配置、事件、验证结果与摘要保存在
`.cader/runs/<run_id>/`。这是组件 fixture，不代表真实模型或 CAD 基准成绩。

<details>
<summary><strong>可选：Python MCP 诊断</strong></summary>

安装 [uv](https://docs.astral.sh/uv/)，在仓库根目录执行：

```sh
uv sync --project cader-mcp --locked
uv run --project cader-mcp pytest -q cader-mcp/tests
uv run --project cader-mcp cader-mcp smoke
```

Python smoke 是离线 MCP 协议 fixture。连接真实服务需另行配置本机 JSON 文件，
详见[配置指南](docs/development/model-configuration.md)。

</details>

### 3. 体验用户任务

根 `.env` 和本机 MCP 配置就绪后执行：

```sh
pnpm run cader --help
pnpm run cader exec "读取图层并总结，不修改图纸" --mcp configs/mcp/AutoCAD.local.yaml
```

`exec` 接收用户任务，`live-smoke` 保持固定诊断；两者均保留当前只读策略。
真实任务会调用付费模型。失败摘要包含脱敏的 `errorCode`、`source` 和可操作的 `hint`；
`QUOTA` 表示 provider 配额故障，不代表 MCP 不通。
严格 JSON 输出和当前限制见 [CLI 使用与诊断](docs/development/cli.md)。

结果分别返回 `run_status` 与 `task_status`。只读模型任务完成仍标记 `unverified`；
`exec --intent redraw` 返回 `blocked`，不启动模型或 MCP。模型正文不能证明 DWG 已生成。

### 4. 查看受控 CAD 契约

```sh
pnpm run cader cad-contract
pnpm run cader cad-test --backend http --mcp configs/mcp/AutoCAD.http.local.yaml --plan benchmark/fixtures/managed-geometry.plan.json --output .cader/artifacts/geometry-001.dwg --authorize-write
```

第一条离线导出契约。第二条需要自行准备 HTTP profile 及兼容的工作图/保存/重开接口，
目前这些接口是**等待 MCP 对齐的 Cader 侧提案**；能力通过后会新建工作图并执行。
保留默认 COM，`--backend http` 不会切换服务端；当前本地 COM 返回 `HTTP_BACKEND_REQUIRED`。
现阶段只允许仓库内已审查的三实体计划，图片重绘计划仍阻塞。
未知写入冻结工作区；`cad-reconcile` 只对账，不重放或解锁。
详见[公共契约](docs/contracts/managed-cad-v1.md)与[执行策略](docs/architecture/controlled-writes.md)。

<a id="configuration"></a>

## 配置说明

需要维护的 Agent 配置与资源统一放在 `configs/`：

```text
configs/
├── models/                  # 主 Agent、文本子 Agent、视觉子 Agent
├── mcp/                     # DSH YAML 与 Python 诊断 JSON 示例
├── cad/                     # 允许操作与已审查计划哈希
├── contracts/               # CAD、任务、读图的版本化 JSON schema
├── prompts/static/          # 稳定的角色规则与统筹提示词
├── skills/                  # 已审查、按需加载的 Skill 内容
└── runtime.yaml             # 注册模型、并发、预算与工具范围
```

根 `.env` 提供凭据，`.cader/` 保存私有运行记录。
[`configs/skills/catalog.yaml`](configs/skills/catalog.yaml) 显式注册 `cad-inspection` 和
`cad-redraw-review`，CLI 发现与 DSH 加载共用清单。新增文件夹不自动注册能力，也不授予执行权限。

### CAD 重绘评估

```sh
pnpm run cader skills list
pnpm run cader skills show cad-redraw-review
pnpm run cader exec "评估参考图，列出尺度证据缺口和后续验证步骤" --skill cad-redraw-review --image benchmark/fixtures/vision-calibration.png
```

前两条命令无需密钥或 CAD。最后一条调用支持图像的主模型；仓库校准图仅演示附件链路，
不是图纸评测。实际评估时换成工作区内的 PNG/JPEG（最大 10 MiB、4000 万像素）。

这份 Cader 自有 Skill 用于证据审查与重绘准备，**不生成 DWG**，不执行脚本，也不开放写工具。
接入方案参考了 [AutoCAD Redraw Skills](https://github.com/pengxiaoan/autocad-dwg-redraw-skill) 的工作方法；
固定版本未发现明确许可证，因此没有复制分发上游文件。
[深入分析报告](docs/research/redraw-skill-integration-2026-11-19.md)说明了工作流映射、代码审查发现，
以及后续 MCP 执行和独立 verifier 的分层路线。

独立图片用例可运行 `pnpm image-test --manifest benchmark/image-cases.example.json`；
加 `--live` 才调用付费模型，以独立 JSON 期望校验识别结果。`tests/images/` 原始资料仅留本地。
[首轮真实图片测试](docs/research/local-image-tests-2026-11-19.md)区分了输入、识别与尚未完成的 CAD 绘图。

密集小字可通过 `exec --image <file> --crop x,y,width,height --rotate 90` 和受限的
`cader_view_image` 工具访问原图区域。事件记录原图、视图、附件及实际请求图的哈希与坐标映射。
`assessment-check` 将结构化事实和端口连通关系与独立期望比较；这些门槛不等于真实识别准确率
或 DWG 拓扑已通过，见[读图证据契约](docs/contracts/perception-v1.md)。

### 连接模型与 AutoCAD-MCP

1. **仅在尚无 `.env` 时**，根据 [`.env.example`](.env.example) 创建文件，
   在本机填写 `DEEPSEEK_API_KEY`。YAML 只引用环境变量名，不保存密钥值。
2. 检查 [`configs/models/`](configs/models/) 中的 profile。当前主 Agent 与视觉子 Agent
   使用 **deepseek-flash**，文本审查使用 **deepseek-v4-pro**。
3. 将 [`AutoCAD.example.yaml`](configs/mcp/AutoCAD.example.yaml) 复制为
   `configs/mcp/AutoCAD.local.yaml`。`command` 指向独立 AutoCAD-MCP 环境的 Python，
   `cwd` 指向该后端的代码目录。

```sh
pnpm models
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml
```

`pnpm models` 只检查配置，不调用模型。`live-smoke` 会调用付费模型 API 和本机 CAD 后端，
验证只读操作及子任务返回。真实 AutoCAD 执行需要 Windows 与可用的后端环境。

验证视觉输入时，可附上仓库提供的校准图和独立期望结果：

```sh
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --image benchmark/fixtures/vision-calibration.png --expected-image benchmark/fixtures/vision-calibration.expected.json
```

根 `.env` 以及 `configs/` 下的 `*.local.yaml`、`*.local.json` 已被 Git 忽略。
DSH YAML 与 Python 诊断 JSON 使用不同 schema，不能互换。
完整参数见[模型与 MCP 指南](docs/development/model-configuration.md)。

<a id="roadmap"></a>

## 开发路线

| 阶段 | 重点 | 状态 |
|---|---|---|
| Agent 基础 | DSH 集成、模型配置、Static / Available、MCP 只读 smoke | 已实现；M0 继续扩展验证 |
| Headless + 社区 TUI | 完整 Headless profile、会话生命周期、Windows TUI 兼容性 | 下一阶段 / [TUI 验证 #9](https://github.com/codesknight/Cader/issues/9) |
| Cader CLI | 已有只读 `exec`、帮助和诊断；打包入口、事件流及会话待完成 | 部分实现 / [CLI 基础 #10](https://github.com/codesknight/Cader/issues/10) |
| CAD 操作闭环 | 工作副本、绘制—保存—重开、独立验证与基准评测 | 规划中 / [CAD 闭环 #3](https://github.com/codesknight/Cader/issues/3) |
| 更多交互入口 | 共享底层服务的 Web UI 与 CAD 内嵌插件 | 后续阶段 |

各阶段验收条件见 [CLI First 实施规划](docs/architecture/cli-first.md)。

<a id="documentation"></a>

## 文档索引

| 资料 | 内容 |
|---|---|
| [技术设计 v0.2](docs/designs/Cader_Technical_Design_v0.2.md) · [CLI 设计](docs/designs/Cader_CLI_Design.md) | 原始设计稿；规划接口不等同于已实现功能 |
| [架构决策](docs/adr/) | Harness 选型、模型角色、配置目录与 CLI First |
| [模型与 MCP 指南](docs/development/model-configuration.md) | 模型 profile、凭据、本机 MCP 与真实 smoke |
| [Skill 接入分析](docs/research/redraw-skill-integration-2026-11-19.md) · [ADR 0004](docs/adr/0004-reviewed-skill-catalog-and-redraw-assessment.md) | 上游研究、Cader 自有评估、注册机制与能力边界 |
| [开发过程记录](docs/development/README.md) | 需求、日志、测试、Bug 与迭代历史 |
| [真实 smoke 证据](docs/research/smoke-2026-11-19.md) | 真实模型、AutoCAD 只读及合成图视觉校准记录 |
| [评测规格](benchmark/README.md) | G01–G10 场景；尚未发布真实模型基准评分 |

详细设计与开发记录目前主要使用中文。
封面是概念插画，不是应用截图或 CAD 实测结果。

## 参与开发

从[开放的 Issues](https://github.com/codesknight/Cader/issues)和
[开发流程](docs/development/process.md)开始。提交前运行 `pnpm typecheck`、`pnpm test`；
涉及 Harness 时增加 `pnpm smoke`。密钥、私有图纸和原始真实运行记录不提交仓库。

## 开源协议

[MIT](LICENSE) · Copyright © 2026 codesknight
