# BUG-024 修复与验证：原始MCP参数预检

日期：2026-11-20，Asia/Shanghai。版本：`0.4.0-dev.3`。工作项：[REQ-030 / #20](https://github.com/codesknight/Cader/issues/20)。此前[12:32审计](2026-11-20-user-log-1232.md)作为历史失败保留。[脱敏机器证据](2026-11-20-schema-preflight-fix.evidence.json)由原始轨迹提取。

## 实施

- 原始MCP schema通过独立校验器在程序客户端和ExecutionSession执行前检查，包含必填、类型、枚举、数组/嵌套及数值约束；不会猜测height或自动填默认值。
- 补丁呈现具体工具参数schema，在任意写入前验证整批schema；合法操作仍走原审批/文档绑定/串行审计，运行时首错停止，不回滚或重放已确认项。
- 本地拒绝明确failed_before_dispatch、不冻结；只有可信本地错误类提供未派发证明。远端/超时/丢响应，甚至包含“validation”文字或伪造同名code的异常，仍保留unknown保护。
- facts区分本轮与会话累计，保留冻结首发错误、恢复资格、全图缓存范围及过时标志。过滤文字为空不能代表全图为空；重连会清除旧连接观测缓存。
- “为什么阻塞了”“为何冻结”“查看冻结原因”和“恢复/恢复核对”直接由程序给出诊断或受限恢复，不调用模型猜测。恢复被拒显示未恢复；流式回复只追加程序状态，不再重复全文。
- 用户原Drawing6、旧Drawing5及根目录锁均保持；未修改相邻AutoCAD-MCP，不自动迁移旧unknown记录。

## 离线验证

新增真实raw-definition形态回归，不以defineTool的内置校验替代：漏height未派发/未冻结、纠参只执行一次、整批预检无部分写入、模型纠参后可继续、远端类似校验错误仍冻结、作用域计数及缓存时效、旧屏障诊断、恢复拒绝事件、捕获本地拒绝分型，以及实际DSH+InteractiveSession+SafeTextStream的回复去重。最终typecheck、测试及Harness smoke结果见[测试记录](../development/testing.md)。

缺参负向输入、确定性模型fixture、真实模型及真实CAD严格分开。通过旧测试不是修复证据；新增raw入口回归和下列实机结果才覆盖本次缺口。

## 真实模型与AutoCAD

显式命令：`pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality`。使用新的隔离workspace与本连接新建工作图，默认MainAgent的真实Flash模型，Harness自动路由Flash视觉。测试回调仅确认CAD任务，不是人工TTY按键验收。

首轮`quality-057ea35c…`在测试入口连接准备阶段失败，未执行绘图：`/mcp use`释放旧连接并延迟建连，新加入的负向预检过早读取工具列表。已在smoke入口显式建连，保留失败日志`.cader/schema-fix-live.log`；没有修改Cader正常连接行为来掩盖它。

复验`quality-77de84c9-a37d-4f15-94de-3ab35ee960b5`，13:01–13:03附近：

| 检查 | 实际结果 |
|---|---|
| 确定性漏height输入 + 真实发现schema | rejected=true、dispatched=false、frozen=false；没有发送这项CAD写入 |
| 原始自然语言任务 | “画一个带有 5V 电源和一个灯泡的串联电路图。”；无固定绘图操作序列 |
| 真实模型/CAD确认写入 | 新建1、图层3、直线10、圆1、文字2，共17次；未知0；任务授权1次 |
| 5V文字 | 实际创建并读回，独立几何检查匹配到文字，邻近电源条件pass |
| 自动质量阶段 | 绘制→几何/拓扑→实际图像附件→视觉；review_valid=true |
| 本次参数阻塞回归 | 通过：漏参不会冻结，合法文字已进入CAD，任务到达自动视觉 |
| 完整电路质量验收 | **未通过**，pending_verification，round=0；疑似导出裁切，停止基于不完整图像修正 |

完整质量报告还发现模型计划的文字描述要求统计电源包围盒内图元，但结构化component字段为空，entity_count执行器按全图计数，实际10而期望2..8；该约束不代表已验证电源符号计数。当前组件计数范围/计划质量、原生导出范围以及权威像素映射仍是后续问题，不把它们算作BUG-024已解决的内容。没有保存DWG、重开或完整上游app profile验收。

原始证据：`.cader/runs/quality-77de84c9-a37d-4f15-94de-3ab35ee960b5/verification.json`、`events.jsonl`、嵌套exec的`quality.json`、独立execution日志与PNG。正式提交只包含脱敏结论，原始私有数据不入Git。完整质量ok=false与参数回归通过分别记录，不用模拟图元或假模型结果冒充实机成功。

## 剩余边界

已有Drawing6锁来自旧客户端的unknown记录。本次修复防止新的同类误冻结，不根据一段远端错误文本自动清理历史锁或继承原连接权限。真正未知、重连、旧捕获屏障仍需有证据的安全核实；新的诊断不会建议反复恢复或重启来绕过。

独立MCP若未来增加结构化“未执行”证明，可另行审查接入；目前没有该契约，服务端普通isError一律不被当作安全解锁凭证。复杂电路拓扑、符号语义和完整图像映射保持原有未验收状态。

2026-11-21提交验收：实现`0c5eba3`及原连接关闭诊断补充`660153f`已推送；补充提交的[CI 44783085937](https://github.com/codesknight/Cader/actions/runs/44783085937)通过。此日未新增CAD调用，真实结果仍为上面的11月20日记录；完整图纸质量未通过。
