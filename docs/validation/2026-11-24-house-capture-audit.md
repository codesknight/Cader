# dev.10 房子/树任务截图冻结审计

2026-11-24，REQ-042 / #20 / Milestone 3。用户12:35–12:38的新工作区日志。本轮只审计，不修改运行时代码、相邻MCP或CAD状态。

## 已证实

- 任务 `exec-269f01ef-95d8-4bca-868f-90d83cd36961`，执行 `execution-6231f841-7103-4a8c-90fd-183ad5937383`，工作区 `.cader/workspaces/drawing-20261124`，目标Drawing17.dwg。
- 新图、图层和两批绘图已确认，CAD committed 48次，截图前全图查询51实体。操作数不等于实体数，不能据此推断重复绘图。
- 共6模型步骤。工具余额48（含验证预留）、单轮CAD余额16、总工具余额546、总CAD余额352，无budget.handoff；不是额度阻塞。
- 主Agent主动调用cader_review_cad_view。12:38:09.484全图查询成功，09.493 capture_prepared，09.896 capture_failed，402ms即失败。请求86c606d2-e97d-4e98-83d4-716e2c06f175；无PNG/capture_completed。
- 原始错误为CAD_PLOT_RESTORE_FAILED：original=<unknown>.Count，恢复错误含<unknown>.CopyFrom及RPC_E_CALL_REJECTED，HRESULT -2147418111。
- VisionAgent启动0、image.request 0、cad.review 0，visual_calls为空。visual_attempt_count=1只是控制器尝试，不能等同于真实视觉模型调用。
- 09.900异常交接后进入blocked，未继续绘图。dev.10交接修复生效；复现的是上轮保留未修的截图故障。

## 根因边界

MCP controller.py的export_current_view会创建打印配置备份、修改布局设备/打印参数/BACKGROUNDPLOT/QuietErrorMode、打印、再恢复，并非纯读屏。代码内ModelSpace.Count位于设备修改和Regen之后；日志Count错误与此路径吻合，但缺少原生Python堆栈，不能证明具体底层诱因。

恢复使用layout.CopyFrom(backup)，本次恢复也失败，缺少恢复后参数读回。Cader收到普通MCP异常，没有完整阶段/原始设置/恢复证据，因此把该导出记录unknown并冻结后续写入；前48次确认绘图仍为committed。CAD忙、设备刷新时序和动态COM wrapper解析均为待验证诱因，不能直接归咎用户或提示词。

BUG-047：受控视觉异常返回review_valid=false、verification_pending=true，以成功结果交回Scheduler；CLI只看DSH isError=false而显示绿色勾号。它表示交接成功，不能表示视觉成功。还需区分截图尝试、视觉模型实际启动和有效报告。

## 下一步修复验收

修复独立MCP截图事务：可行的只读/就绪预检移到修改前；有界处理只读方法解析与就绪；原生变更/打印不盲重放；恢复后核对原始设置，保留操作、备份、阶段及恢复证据。只有证明未变更或恢复完整，才可重新验证；恢复未知继续保护原图。同时修复Cader业务状态展示。

真实验收使用原始红屋顶/蓝墙/大树需求，并覆盖Count、CopyFrom、COM拒绝和恢复失败。简单圆形成功不能覆盖此故障。现有Drawing17和屏障不自动解除或重画。

本轮实际读取附件、quality/events/execution/锁、源码及目标PNG是否存在；无模型/MCP/原生CAD调用，无恢复/重放。运行时代码未改，未声称新增回归或真实绘图通过；此前123测试及CI成功不覆盖本次原生故障。
