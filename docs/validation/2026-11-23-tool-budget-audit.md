# 2026-11-23：TOOL_BUDGET_EXCEEDED审计

REQ-040 / [Cader#20](https://github.com/codesknight/Cader/issues/20)，Milestone 3。来源为用户dev.9运行日志及quality exec-8d8c4ef9-bbfb-4d90-8ba1-c505a05fbb9a。本轮只读审计，没有运行模型、修改CAD、恢复任务或修改运行时代码；不能把此前112测试与成功实测当本故障已修复。

## 确认的时间线

- 17:47:06进入规划，两次计划拒绝后提交成功；17:47:28进入drawing。新图创建成功，本次不是Add未知或写屏障故障。
- 前三批Patch分别执行6/13/25项，加1次新建，共45次CAD写入。17:48:22全图快照包含45个模型空间实体（17条AcDb2dPolyline、10个Hatch、13条Line、5个Circle）。
- 17:48:25捕获1600×1280 PNG，hash 45159a6d32019cc685c5f8e0939b1b88211439e3751ccb966a12077fe4178ce3。边缘前景像素4530，possible_clipping=true。独立查看实际PNG几乎整幅蓝色，不能看见房子/树。
- VisionAgent实际运行并提交有效fail报告，17:48:30.936结束；不是没有调用视觉。17:48:31.231 cader_review_cad_view返回isError=true，原因为MCP_TOOL_FAILED: query_entities。
- quality.visual_calls已保存报告，但visual_error记录上述读回失败；源码显示异常出现在review后的owner.snapshot。snapshot只审计成功，没有保存这次原生失败的详细HRESULT/stack，不能确定是忙态、枚举器、绑定还是其他COM错误。
- live.ts仅在await controlledReview成功后concludeTurn；quality.act也仅在成功返回后设置reviewSubmitted。因此异常绕过交接，主Agent继续处于drawing，未进入Scheduler的correcting阶段。三批缩放/移动分别请求2/30/32项，统一scale_factor=0.012；这些批次的实体集合不重叠，不能将其误称为同一实体反复重放。
- 最后一批执行6项成功，第7项scale在工具guard被拒，之后25项未派发。最终83确认/0unknown，scratch_bound、frozen=false；quality blocked，round=0。这暴露的是错误路径中的修正越过调度阶段，而非真实发生0次修正。

## 精确预算账目

当前runtime.max_tool_calls=100，变量在整个runtime中共享，覆盖规划、绘制、视觉和修正，而非每个模型回合重置。Patch入口和每个叶工具都经guard计数。

| 已获准工具执行类别 | 次数 |
| --- | ---: |
| CAD写入成功 | 83 |
| Patch入口（含最后失败的外层调用） | 6 |
| 验收计划提交（两次拒绝也计数） | 3 |
| 其他主Agent调用：状态、health、review、范围查询、glob、2次get_entity | 7 |
| Vision报告提交 | 1 |
| 合计 | 100 |

第101个候选工具被拒。原始events有100条tool.dispatch和101条tool.result；错误含两个计划、review、被拒叶工具、外层Patch。只有17个model.step，未耗尽40步；不是模型账户余额或token上限。内部依赖检查/写后读回会产生更多MCP RPC，但不通过这个主Agentguard计数，不能拿服务INFO行数代替预算账。

最后一批入口已获准时，其32个叶操作所需成本超过剩余6个名额，但没有整批预算预检或预留，导致可预见的部分执行。83确认包含38次实际缩放/移动；已完成操作不得重放。会话“未派发阻断0”只统计ExecutionSession日志，预算拒绝发生在其前，说明当前汇总没有覆盖所有guard拒绝。

## 空间证据与不确定项

query_entities全图路径遍历ModelSpace；范围查询使用SelectionSets且未明确限定同一空间。17:48:39范围查询仅返回AcDbViewport，与模型空间快照口径不一致。独立只读GetActiveObject观察（17:57:39）发现当前Drawing13活动布局为非模型的“布局1”，ActiveSpace=0、MSpace=false，模型实体45、纸空间实体2。未调用Dispatch、Add、Save、Close或切换布局，观察原文仅存.cader/budget-20261123-native-observation.json。

导出代码使用doc.ActiveLayout，只有ModelType为真才使用模型空间窗口边距，否则走纸布局extents。综合证据，纸空间/视口与模型空间不一致是优先假设；截图当时没有Layout/ModelType等原生元数据，不能以当前观察完全证明历史原因，也不能排除填充遮挡等问题。不得仅凭蓝色/裁切截图推断几何全错，再缩放全部实体。

## 当前恢复与应修方向（尚未实施）

若原Cader/MCP会话仍存活，可先在AutoCAD只切换到模型页、缩放范围检查当前图，不改图元；然后/quality查看证据，/quality resume重新查询验收。该入口跳过原始drawing，不整批重放，使用新runtime预算，但仍检查原连接/图纸绑定、图像完整性及必要条件。已退出或换连接不能靠恢复聊天接管旧图；再次蓝屏/读失败应待验证，不能承诺通过。图中已有部分变换，不能把83确认当作未执行。

修复优先级：

1. 受控review无论成功、读回失败、裁切或无效，都须让Harness接管；未核验前在工具执行层阻止几何写入，异常不能重新进入drawing自修。
2. 快照失败保留原生异常；只读重验有界，不重放写入。明确模型空间/纸空间语义，导出与查询使用一致空间，并记录布局、视口、范围及恢复结果。
3. Patch在派发任何叶操作前验证整批预算、权限和schema；预算不足应整体拒绝并列明已完成/未派发项，而不是中途才发现不足。保留串行与未知写入保护。
4. 分开呈现模型工具调用、实际CAD操作和验证预算，给验证/恢复预留额度与低预算提示。不能让一个Patch成为无限免费写入，也不能仅把100调大。

配置schema当前max_tool_calls上限也是100。把YAML直接改成200/300会触发配置校验失败；放宽额度需同时调整schema与预算策略，且只能缓解成本，不解决以上控制流/空间问题。#20保持开放。
