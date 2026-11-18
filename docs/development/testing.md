# 测试记录

## 2026-11-18：DSH 切换

环境：Windows；便携 Node 24.9.0、pnpm 11.28.5、DSH 0.2.2-rc.4、Cordis 4.1.0；
Python 3.11.15、MCP SDK 1.28.1。配置与完整性哈希见两个锁文件。

| 检查 | 命令 | 实际结果 |
|---|---|---|
| TS 编译和类型 | pnpm typecheck | 通过 |
| DSH 组件 / 插件 | pnpm test | 2 passed：6 个 smoke 检查；后置 allow 无法绕过 guard |
| DSH CLI 与日志 | pnpm smoke | 6/6 检查通过，配置/事件/验证/摘要已写入 .cader/runs/ |
| Python lint | uv run --project cader-mcp ruff check cader-mcp | 通过 |
| Python format | uv run --project cader-mcp ruff format --check cader-mcp | 通过 |
| Python 测试 | uv run --project cader-mcp pytest -q cader-mcp/tests | 8 passed |
| MCP 协议 fixture | uv run --project cader-mcp cader-mcp smoke | 3/3 检查通过 |
| Windows / Linux CI | .github/workflows/ci.yml | 4/4 jobs 通过：Python MCP + DSH 组件各覆盖 Windows/Linux |
| 完整 DSH app / 真实模型 / 图像 / CAD 写入 | 未执行 | 保持 M0 待验证 |

DSH fixture 覆盖实际组件装配、参数 schema 校验、合成写入拒绝、预取消、事件和插件卸载。
预取消不触发普通 tools/result；CLI 单独记录取消。fixture 不计入真实 CAD 成功率。

## 历史基线（回填）

提交 `54d2ebf`：原 Deep Agents 基线 9 项 Python 测试通过，Windows/Linux CI 通过。
旧 runtime 已退出当前 CI，不将其 9 项计入迁移后的用例数。
实机：最初 tools/list 36 个工具、list_layers 2 个图层；之后两次 TimeoutError，仍未关闭。
详细证据见 docs/research/smoke-2026-11-18.md；本轮没有重跑实机或修改 AutoCAD 状态。

## 远端验收证据

代码提交：`ce7e9ce`。CI：[run 44324330594](https://github.com/codesknight/Cader/actions/runs/44324330594)，4 个任务全部 success。
DSH 原始组件 smoke 日志作为各平台 CI artifact 上传；该 CI 不执行真实模型或 AutoCAD。
