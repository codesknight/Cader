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

`exec` 接收一个带引号的非空任务，以及可选 `--mcp <local.yaml>`、`--skill <name>`、`--image <workspace.png|jpg>`。
没有 MCP 时仅有模型/Skill/受限委派；配置 MCP 后仍只有已审查工具进入模型 schema。
真实任务会调用付费 API；提供 MCP 时可能连接本机 CAD。CI 使用离线模型 fixture，不消耗配额。
任务可不要求委派，不像 smoke 一样强制进行固定校验。

`ok:true` 保留兼容，但须同时读取 run_status/task_status。普通只读 exec 运行完成时
task_status=unverified、verification=not_performed，不从模型正文推断业务完成。
`exec "重绘并保存" --intent redraw` 返回 blocked/WRITE_CAPABILITY_UNAVAILABLE，退出3，
不调用模型或MCP。user_task_authorized=true与runtime_write_available=false分别记录。
输出中的 `text` 是模型回复，`runDirectory` 指向本地私有 events.jsonl 和 verification.json。
当前还没有交互 REPL、resume、稳定 RunEvent JSONL 或可全局安装的产品入口。

## Skill 与参考图

```powershell
pnpm run cader skills list
pnpm run cader skills show cad-redraw-review
pnpm run cader skills show cad-redraw-review --resource assessment-format
pnpm run cader exec "评估图片中的可读信息和重绘所需证据" --skill cad-redraw-review --image benchmark/fixtures/vision-calibration.png
```

skills 命令只需 configs/skills，不读取 .env 或模型配置，不发请求。
--skill 把已注册且 main 可见的正文装入本次动态上下文；引用资料仍经 cader_load_skill 按需加载。
模型同时看到角色可用的 Skill 元数据与 resource ID，不通过自由文件路径读取资源。
文本子 Agent 无 cad-redraw-review 可见性；视觉子任务可读取该 Skill，但无委派和写入权限。

--image 接受工作区内的有界 PNG/JPEG（10 MiB / 4000 万像素），检查文件范围及格式/帧头，
不提供 PDF/DWG 解析或完整图像解码验证，不自动改变方向。输入预检在 MCP/模型启动前执行。
主模型必须声明 image 输入；图片也以 image-1 引用供主 Agent 选择委派给视觉模型。
选定 Skill 和是否附图写入终态；原图片附件仅留在本地私有 .cader 及显式模型调用链路。
参考图内容不自动变为工具授权。校准图只是链路示例，不作为重绘正确性验证。

图像随后经Sharp实际解码和DSH附件服务规范化。可加 --crop x,y,width,height 和
--rotate 0|90|180|270；坐标取原图，先裁剪再旋转。视觉Agent有作用域受限的cader_view_image，
可查看原始分辨率区域。原图/视图/附件/请求变体的哈希、尺寸、映射和Skill内容哈希写入私有事件，
详见[读图契约](../contracts/perception-v1.md)。

cad-redraw-review 是 Cader 自有评估指引，不是上游包的安装或完整重绘引擎；
许可与接入取舍见[研究报告](../research/redraw-skill-integration-2026-11-19.md)。

独立图片用例测试可使用 `pnpm image-test --manifest benchmark/image-cases.example.json`；
加 --live 才调用真实模型，以不传给模型的 expect 比较结果，始终标记非 CAD 绘图测试。
格式和证据契约见 [benchmark 说明](../../benchmark/README.md)。

## JSON 与退出码

`pnpm run cader` 包含构建日志。脚本需严格解析 JSON 时先构建，再直接运行 Node 入口：

```powershell
pnpm build
node apps/cli/dist/index.js exec "读取图层并总结" --mcp configs/mcp/AutoCAD.local.yaml
```

任务完成报告为 stdout 的单个 JSON 对象；启动/参数错误为 stderr 的 JSON，帮助为普通文本。
这不是正式的流式 JSONL 接口。退出码：0 运行正常或受控任务成功、1 失败、2 参数错误、3 业务阻塞。
普通exec退出0且task_status=unverified，不代表通过业务验收。
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
绘图通过独立[受控调度器](../architecture/controlled-writes.md)，不能通过修改 read_only_tools 开放。

## 受控固定几何与独立检查

```powershell
pnpm run cader cad-contract
pnpm run cader cad-test --backend http --mcp configs/mcp/AutoCAD.http.local.yaml --plan benchmark/fixtures/managed-geometry.plan.json --output .cader/artifacts/geometry-001.dwg --authorize-write
pnpm run cader cad-reconcile --run <managed-run-directory> --mcp configs/mcp/AutoCAD.http.local.yaml
pnpm run cader assessment-check --assessment <assessment.json> --expect <independent.json>
```

cad-contract和assessment-check无需密钥。其余需本机profile；参考AutoCAD.http.example.yaml，
不要覆盖现有COM配置。MCP新工作图/保存/重开尚待对齐；未实现或COM时阻塞，不假装支持。
cad-test仅允许configs/cad/execution.yaml审查哈希中的三实体fixture、允许操作和私有输出目录，
显式授权与HTTP发现通过后才新建工作图。图片计划暂不开放；模型和Skill不能扩大权限。
每次输出换新文件名，默认禁止覆盖。

超时/返回未知保留全局锁，cad-reconcile仅按原request_id查询，退出3，不重放、不解锁或继续写。
工作区锁也覆盖切换profile，进程中断同样需先核实。当前没有自动恢复/解锁命令。
完整结果有识别/规划/执行/保存/重开状态，只有独立实体、文件和重开全部通过才为task_status=succeeded。
assessment-check的通过只代表提供的独立事实与抽象连通图检查，不代表真实图像或DWG已验收。

Python CLI 在入口显式将 stdout/stderr 配置为 UTF-8，覆盖重定向管道；不依赖 PYTHONUTF8=1。
测试在 PYTHONUTF8=0、PYTHONIOENCODING=gb18030 环境下验证中文 JSON 和中文参数错误。
旧版 Windows PowerShell 自身的重定向仍可能重新编码；要保留子进程原始字节，请使用支持字节保留的调用器。

本次没有重跑用户报告的 40 工具实机发现或付费 QUOTA 场景；QUOTA、清理失败及任务传递由实际 DSH loop 的离线故障注入验证。

## 2026-11-19：MCP对齐修订2（#15）

输出目录在create时显式绑定，工作图与只读重开验收图分离。status声明observed_database_events，
回滚后允许revision前进，以权威revision独立查询，不能自动续写。
job按operation区分输入/结果文档与artifact。cad-reconcile对旧journal返回
LEGACY_REQUEST_REQUIRES_REVIEW，退出3，保留锁；不自动迁移。篡改审计信息返回REQUEST_JOURNAL_MISMATCH。
`pnpm contract:export`离线重导出schema/manifest；共享向量只验证组件协议，未执行真实MCP/CAD。
详见[对齐回应](../contracts/mcp-alignment-response-2026-11-19.md)。
