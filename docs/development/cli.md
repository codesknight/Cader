# Cader CLI：用户任务与诊断

当前 CLI 支持传入自然语言任务的 `exec`，与固定只读的 `live-smoke` 分开。
`exec` 仍使用 M0 只读策略，不代表已经实现绘图。它可以使用现有主/子 Agent、Skill 和已审查的只读工具。

## 启动

在仓库根目录使用 Node >=24.9.0、pnpm 11.28.5；模型密钥仍从根 `.env` 读取。

```powershell
pnpm run cader --help
pnpm run cader exec "说明当前只读检查的步骤，不调用工具"
pnpm run cader exec "读取当前图层并总结，不修改图纸" --mcp configs/mcp/AutoCAD.local.yaml
```

`exec` 接收一个带引号的非空任务，以及可选 `--mcp <local.yaml>`。
没有 MCP 时仅有模型/Skill/受限委派；配置 MCP 后仍只有已审查工具进入模型 schema。
真实任务会调用付费 API；提供 MCP 时可能连接本机 CAD。CI 使用离线模型 fixture，不消耗配额。
任务可不要求委派，不像 smoke 一样强制进行固定校验。

`ok:true` 表示 Agent 运行完成，不证明任何绘图需求已满足；本轮结果固定标注 `mode:read-only`。
输出中的 `text` 是模型回复，`runDirectory` 指向本地私有 events.jsonl 和 verification.json。
当前还没有交互 REPL、resume、图片任务参数、稳定 RunEvent JSONL 或可全局安装的产品入口。

## JSON 与退出码

`pnpm run cader` 包含构建日志。脚本需严格解析 JSON 时先构建，再直接运行 Node 入口：

```powershell
pnpm build
node apps/cli/dist/index.js exec "读取图层并总结" --mcp configs/mcp/AutoCAD.local.yaml
```

任务完成报告为 stdout 的单个 JSON 对象；启动/参数错误为 stderr 的 JSON，帮助为普通文本。
这不是正式的流式 JSONL 接口。退出码：0 成功、1 运行失败、2 参数错误。
未知选项、重复 --mcp、缺失参数和空任务在加载凭据或连接 CAD 之前拒绝。

失败示例：

```json
{
  "ok": false,
  "errorCode": "QUOTA",
  "source": "provider",
  "hint": "Check provider balance, quota and model entitlement. MCP connectivity is reported separately."
}
```

报告还包含 runId / runDirectory；`live-smoke` 继续包含各项 checks。
错误摘要不复制 provider 响应体、异常 message/name 或密钥。

| 来源 | 示例 | 下一步 |
|---|---|---|
| provider | QUOTA / ACCOUNT_QUOTA / AUTH / RATE_LIMIT | 检查余额、额度、模型权限、凭据或限流，不据此判断 MCP 失败 |
| mcp | MCP_CONNECTION_FAILED | 检查本机 command、cwd、独立环境和 MCP stderr |
| configuration | CONFIG_INVALID / CONFIG_NOT_FOUND | 检查 YAML、路径和凭据环境变量 |
| agent | MODEL_STEP_BUDGET_EXCEEDED / AGENT_FAILED | 查看任务预算和脱敏事件 |
| verification | VERIFICATION_FAILED | 查看未通过的 smoke checks；不当作绘图结果 |
| usage | USAGE_ERROR | 查看帮助及支持参数 |

主错误优先保留。清理失败另列 `cleanupError:CLEANUP_FAILED`，不覆盖 QUOTA 等主因。
未识别的 provider code 归为 UNKNOWN，不反射未经审查的字符串。重试策略未放宽。

## 固定 smoke 与 Python 诊断

```powershell
pnpm run doctor
pnpm run models
pnpm run smoke
pnpm run live-smoke --mcp configs/mcp/AutoCAD.local.yaml
uv run --project cader-mcp cader-mcp mcp list --config configs/mcp/python.local.json
```

`live-smoke` 不接受用户任务；`--task`、`--write` 等不支持的参数会返回 USAGE_ERROR。
绘图需要后续[受控写入契约](../architecture/controlled-writes.md)，不能通过修改 read_only_tools 开放。

Python CLI 在入口显式将 stdout/stderr 配置为 UTF-8，覆盖重定向管道；不依赖 PYTHONUTF8=1。
测试在 PYTHONUTF8=0、PYTHONIOENCODING=gb18030 环境下验证中文 JSON 和中文参数错误。
旧版 Windows PowerShell 自身的重定向仍可能重新编码；要保留子进程原始字节，请使用支持字节保留的调用器。

本次没有重跑用户报告的 40 工具实机发现或付费 QUOTA 场景；QUOTA、清理失败及任务传递由实际 DSH loop 的离线故障注入验证。
