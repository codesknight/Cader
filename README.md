# Cader

An extensible AI agent for computer-aided design.

当前处于 **M0：调研、Harness 选型和 smoke**。核心研发对象是 CAD Agent Harness；
首个执行后端复用独立项目 [AutoCAD-MCP](https://github.com/codesknight/AutoCAD-MCP)。
通用 CAD 能力独立于电气研究；当前电气研究范围仅为变电站一次接线图。

## 已实现

- Python 包、uv 锁定环境、Windows / Linux CI。
- MCP stdio / 本地 Streamable HTTP 的工具发现；只读 `list_layers` 实机探测。
- 离线 MCP 正常及错误响应 smoke。
- Deep Agents 确定性模型 spike：事件、工具错误反馈、检查点读取和步数终止。
- Harness 调研 ADR、10 个通用 CAD 任务的评测规格。

暂未实现真实模型绘图、Gateway、完整 benchmark runner 或 Electrical 扩展。
确定性模型及 fixture 通过不代表真实 CAD 任务成功；10 个任务规格尚未执行评分。

## 快速开始

需要 Git、[uv](https://docs.astral.sh/uv/)；`.python-version` 固定 Python 3.11。

```powershell
uv sync --locked --extra deepagents
uv run cader doctor
uv run cader smoke
uv run cader harness-smoke
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
```

`harness-smoke` 使用本地确定性模型，无需 API Key。普通 MCP 工具可只执行
`uv sync --locked`，不安装 Harness extra。

## 接入 AutoCAD-MCP

AutoCAD-MCP 保持独立环境。复制 `configs/mcp.stdio.example.json` 为
`configs/local.mcp.json` 并填写实际 Python 路径和后端目录：

```powershell
uv run cader mcp list --config configs/local.mcp.json
uv run cader mcp smoke --config configs/local.mcp.json
```

第二条只调用已审查的 `list_layers`，不创建或修改图纸。stdout 为 JSON，失败返回非零。
配置会启动指定的 stdio 子进程，须使用自己信任的本地服务；服务 stderr 属于本地诊断输出。
首次启动前确认没有其他客户端同时向同一 AutoCAD 文档写入。

HTTP 示例对应上游 `python -m autocad_mcp.server --http` 的
`http://127.0.0.1:8931/mcp`，需要服务预先运行；示例不代表本机已启动 HTTP 服务。
M0 不提供任意工具调用、远程认证或图纸写入 CLI。

## 研发资料

- [原始设计提案](docs/designs/Cader_Development_Guide.md)
- [Harness 选型 ADR](docs/adr/0001-harness-selection.md)
- [上游接入调研](docs/research/autocad-mcp.md)
- [Smoke 记录](docs/research/smoke-2026-11-18.md)
- [评测方案](benchmark/README.md)
- [阶段路线](docs/development/roadmap.md)

设计提案保留原文；其中命令、目录和工具名不自动成为已实现能力。执行状态以本仓库代码、
检查记录及 GitHub Issues 为准。私有运行数据放入被忽略的 `.cader/`，密钥及私有图纸不提交。
