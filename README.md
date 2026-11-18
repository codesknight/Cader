# Cader

An extensible AI agent for computer-aided design.

**已选定 DeepSeek Harness（DSH）+ Cordis。** 当前处于 M0 集成阶段，
采用 TypeScript / Node.js 运行时和独立 Python MCP 工具包。首个 CAD 后端继续复用
[AutoCAD-MCP](https://github.com/codesknight/AutoCAD-MCP)。

## 当前能力

- pnpm workspace；DSH 组件锁定 `0.2.2-rc.4`，Cordis `4.1.0`。
- 真实 Cordis、DSH tools、system-prompt 和 native executor 装配。
- 独立 Cader 只读策略插件；验证参数、写入拒绝、取消和插件卸载。
- Python MCP stdio / 本地 HTTP 发现与只读诊断、离线协议 smoke。
- smoke 自动保存脱敏记录；GitHub Issues / Milestone 与仓库开发日志关联。
- Windows / Linux CI，TypeScript 与 Python 分开验证。

当前 smoke 是 **DSH 组件 fixture**，尚未启动完整 DSH Web/headless profile、真实模型、
官方 DSH MCP client 或真实 CAD 绘图闭环。原 Deep Agents spike 已退出当前依赖和 CI，
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

可信的 AutoCAD-MCP 服务仍使用独立 Python 环境。按 `configs/mcp.stdio.example.json`
填写被忽略的本地配置后运行：

```powershell
uv run --project cader-mcp cader-mcp mcp list --config configs/local.mcp.json
uv run --project cader-mcp cader-mcp mcp smoke --config configs/local.mcp.json
```

这里只调用已审查的 `list_layers`。此前实机初次成功、最终两次超时；稳定性问题仍未关闭。
Python 客户端配置与 DSH profile 配置是两个独立 schema，不能直接互换。

## 设计与过程记录

- [当前技术设计 v0.2](docs/designs/Cader_Technical_Design_v0.2.md)
- [当前选型 ADR](docs/adr/0001-harness-selection.md)
- [开发过程入口](docs/development/README.md)：需求、开发、测试、Bug 与路线
- [GitHub Issues](https://github.com/codesknight/Cader/issues)
- [评测规格](benchmark/README.md)：G01–G10 尚无真实模型评分

设计文档保留原文。已实现状态以代码、测试、开发日志及 Issue 为准。
密钥、私有图纸、上游 checkout 和原始运行日志不提交公共仓库。
