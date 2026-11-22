# dev.4：重启仍被冻结的诊断与旧缺参复核

日期：2026-11-21；来源：用户13:01–13:02日志及“这是bug吗，如何解决”；关联 [#20](https://github.com/codesknight/Cader/issues/20)、[#19](https://github.com/codesknight/Cader/issues/19)、REQ-031 / BUG-026。

## 已证实

新任务只提交验收计划就blocked，当前任务没有绘图写入。阻塞来自用户工作区历史Drawing6的draw_text请求，原始错误是缺少height；原日志对应同请求的prepared及frozen，没有该请求的成功确认。dev.3预检修复不会追溯清理这个锁。新进程本轮/会话0次写入与历史屏障存在并不矛盾。

原连接已消失，所以ORIGINAL_CONNECTION_REQUIRED符合恢复策略。缺陷在旧缺参错误曾进入unknown，以及升级后缺少显式可审计的人工处理入口、启动提示不明确、仍花费模型计划后才检查屏障。MCP已连接、44工具与COM not_probed不能说明当前有写权限；不是这次房子/树规划或模型能力导致新冻结。

## 变更

启动读取屏障并显示首发错误。已知冻结的质量绘图直接blocked，不启动模型；verification明确model_run_status=not_started。独立exec未配置MCP时也先读取屏障。

新增用户命令`/mcp barrier`和`/mcp resolve`。候选检查、人工确认、原始证据保留与新图要求见[ADR0012](../adr/0012-reviewed-legacy-barrier-retirement.md)和[手册](../cli/README.zh-CN.md#dev4历史缺参屏障复核)。真正未知/超时不通过此入口处理，旧unknown不改写成程序证明的失败。

## 实际验证层级

- **离线组件/程序调度**：合成原始schema、原日志及屏障；涵盖四权限仍需确认、拒绝不清理、显式人工决定归档、原始字节/hash/日志保留、无CAD调用/重放、不继承连接/图纸权限、真实未知拒绝、活跃PID、变化证据/互斥阻断、损坏锁拒绝及CLI命令不经过模型。完整命令结果在[测试记录](../development/testing.md)。
- **真实MCP发现＋用户历史证据，只读**：`.cader/review-user-barrier.mjs`连接已配置独立AutoCAD-MCP，仅list_tools及get_backend_status；Drawing6归为LEGACY_MISSING_ARGUMENTS_REVIEW_CANDIDATE，缺height。前后原屏障hash一致，`model_called=false`、`cad_write_called=false`、`resolution_called=false`；没有新建任何图纸。原始私有记录在`.cader/runs/barrier-readonly-preview/preview.json`。这是当前schema与旧日志的关联核对，不是原生无副作用证明。
- **真实CLI入口**：`chat --stdio --workspace C:/Users/LiuYanhong`输入`/mcp barrier`、用户房子/树请求、`/exit`，exit0；启动警告、复核候选和模型前blocked均核对通过，原锁hash不变。没有人工TTY批准或CAD写入，stdout/stderr与汇总仅保留私有目录。
- **未执行**：没有代替用户批准Drawing6归档；没有对真实旧图重放、接管或写入；本轮没有新增付费模型、新房子/树图、完整DSH app profile或完整质量闭环验收。此前真实Flash/AutoCAD证据仍见[dev.3报告](2026-11-20-schema-preflight-fix.md)，不能冒充本轮新验收。

## 解决步骤与边界

使用dev.4构建，退出旧Cader会话，再启动原工作目录会话。先`/mcp barrier`核对错误、请求与目标；只有能确认原请求未执行、已结束且无延迟操作时，才在`/mcp resolve`提示中批准。不确定就拒绝，不手动删锁。归档后重发新任务，新连接必须创建新工作图；不能恢复旧任务授权。

BUG-025组件计数范围、BUG-023疑似视图裁切/像素映射和完整质量仍未解决。人工流程也不能解决真实超时或旧原生请求仍在执行的问题；这些继续保留屏障。

代码`5638f41`已推送，[Windows/Linux CI 44871945247](https://github.com/codesknight/Cader/actions/runs/44871945247)四项全通过。代码/组件验收不改变上述真实用户锁及完整绘图验收边界。
