# Cader

An extensible AI agent for computer-aided design.

**已选定 DeepSeek Harness（DSH）+ Cordis。** 当前处于 M0 集成阶段，
采用 TypeScript / Node.js 运行时和独立 Python MCP 工具包。首个 CAD 后端继续复用
[AutoCAD-MCP](https://github.com/codesknight/AutoCAD-MCP)。

采用 **CLI First**：先复用 DSH Headless、验证社区 TUI，逐步实现 Cader CLI，
再开发 Web UI 与 CAD 内嵌插件。当前可执行入口是下文的 `pnpm` 命令；
设计中的 `cader exec`、交互 REPL 和社区 TUI 集成仍待实施。

## 当前能力

- pnpm workspace；DSH 组件锁定 `0.2.2-rc.4`，Cordis `4.1.0`。
- 真实 Cordis、DSH 默认 AgentLoop、官方 OpenAI-compatible LLM adapter 与 MCP client。
- `configs/models/*.yaml` 配置主、文本子 Agent 和视觉子 Agent；从根 `.env` 引用密钥。
- Static / Available 提示词、按需 Skill、主 Agent 统一决策的一层子树，最多 5 个子 Agent 并行。
- 独立 Cader 只读策略插件；验证参数、写入拒绝、取消和插件卸载。
- Python MCP stdio / 本地 HTTP 发现与只读诊断、离线协议 smoke。
- smoke 自动保存脱敏记录；GitHub Issues / Milestone 与仓库开发日志关联。
- Windows / Linux CI，TypeScript 与 Python 分开验证。

默认 smoke 是 **DSH 组件 fixture**。本轮已通过独立 headless Cader 组合验证真实模型、
官方 MCP、AutoCAD 只读和视觉子任务返回。DSH Web UI、实际 CAD 预览和绘图保存闭环仍待验证。
原 Deep Agents spike 已退出当前依赖和 CI，
仅保留历史证据。通用 CAD 不依赖电气研究，研究范围仍仅为变电站一次接线图。

## 开始开发

需要 Node.js >=24.9.0、pnpm 11.28.5、uv；Python 版本由 `cader-mcp/.python-version` 固定。

```powershell
corepack enable
corepack prepare pnpm@11.28.5 --activate
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm doctor
pnpm smoke
uv sync --project cader-mcp --locked
uv run --project cader-mcp pytest -q cader-mcp/tests
uv run --project cader-mcp cader-mcp smoke
```

`pnpm smoke` 无需 API Key，自动写入 `.cader/runs/<run_id>/` 的配置快照、JSONL 事件、
verification.json 与 summary.md。记录 fixture 的验证结果，不代替真实 CAD 成功率。

可信的 AutoCAD-MCP 服务仍使用独立 Python 环境。按 `configs/mcp/python-stdio.example.json`
填写被忽略的本地配置后运行：

```powershell
uv run --project cader-mcp cader-mcp mcp list --config configs/mcp/python.local.json
uv run --project cader-mcp cader-mcp mcp smoke --config configs/mcp/python.local.json
```

这里只调用已审查的 `list_layers`。历史曾出现两次超时；11 月 19 日真实模型与 MCP 只读验证已通过，历史根因仍未确认。
Python 客户端配置与 DSH profile 配置是两个独立 schema，不能直接互换。

## 设计与过程记录

- [当前技术设计 v0.2](docs/designs/Cader_Technical_Design_v0.2.md)
- [CLI 设计原稿](docs/designs/Cader_CLI_Design.md)
- [CLI First 实施边界与路线](docs/architecture/cli-first.md)
- [统一配置目录与 CLI First 决策](docs/adr/0003-config-layout-and-cli-first.md)
- [当前选型 ADR](docs/adr/0001-harness-selection.md)
- [开发过程入口](docs/development/README.md)：需求、开发、测试、Bug 与路线
- [GitHub Issues](https://github.com/codesknight/Cader/issues)
- [评测规格](benchmark/README.md)：G01–G10 尚无真实模型评分

设计文档保留原文。已实现状态以代码、测试、开发日志及 Issue 为准。
密钥、私有图纸、上游 checkout 和原始运行日志不提交公共仓库。

## 模型与真实集成测试

模型、MCP、运行预算、Static 提示词和 Skill 文件统一放在 `configs/`。
根 `.env` 提供密钥，`.cader/` 保存私有运行状态；详见[配置目录及迁移说明](docs/development/model-configuration.md)。

根 `.env` 设置 `DEEPSEEK_API_KEY`；配置只保存环境变量名。
主 Agent 使用 deepseek-flash，文本子 Agent 使用 deepseek-v4-pro，视觉子 Agent 使用 deepseek-flash。
官方当前 Pro 不支持图像，不能通过 YAML 声明改变能力。

```powershell
pnpm models
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --image benchmark/fixtures/vision-calibration.png --expected-image benchmark/fixtures/vision-calibration.expected.json
```

真实测试会调用付费 API 和本机 CAD；CI 不运行此命令。详见[模型配置](docs/development/model-configuration.md)、
[ADR 0002](docs/adr/0002-model-profiles-and-agent-tree.md)、[11 月 19 日实测记录](docs/research/smoke-2026-11-19.md)。
