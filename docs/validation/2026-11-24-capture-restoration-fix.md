# 截图恢复及视觉业务状态修复

2026-11-24，REQ-043 / [Cader #20](https://github.com/codesknight/Cader/issues/20)、[AutoCAD-MCP #43](https://github.com/codesknight/AutoCAD-MCP/issues/43)。用户明确授权修改两仓库，要求使用原始房子/红屋顶蓝墙/大树需求真实回归，并保留旧图及unknown证据。[故障审计](2026-11-24-house-capture-audit.md)保留原文。

## 实施与边界

AutoCAD-MCP新增capture模块，controller入口复用它，不新增工具或AgentLoop。Count、范围和投影读取先于打印设置修改；只读COM就绪、属性和方法解析有界等待，使用IDispatch DISPID绕过不稳定的动态方法表。CopyFrom、SetVariable、Delete等方法在变更前绑定；每个原生变更及PlotToFile调用一次，不因异常重放。GetWindowToPlot/GetCustomScale显式传BYREF输出参数。

恢复后独立核对本次涉及的设备/纸张/范围/缩放/原点/旋转/居中、BACKGROUNDPLOT、QuietErrorMode及配置名称集合。原生恢复即使返回成功，也须读回一致才删除临时备份；恢复或回执未知保留备份和屏障。模型布局才允许捕获，纸布局在修改前拒绝，不自动切换用户布局。

实机只读检查发现本机非活动文档的ActiveLayout可能指向当前活动文档的布局。新增布局所属Document及ObjectID检查；旧图保护核对通过ModelSpace.Layout读取，未通过“切换到旧图再修复”的方式改变用户状态。

`export_current_view`新增可选request_id，默认成功仍返回原路径文本及structured result包装；带关联请求可返回autocad-capture/1恢复回执。错误包含阶段、变更调用及确认、原始/恢复状态、恢复错误、备份名称和原异常。只更新该工具发现基线，44工具数量不变。

Cader由程序覆盖request_id并严格校验schema、请求/路径/文档、动作确认、恢复前后相等及备份清理。仅本次证明未修改或完整恢复的失败保留待验证而不冻结；缺失/篡改/不一致/legacy证据仍冻结。不回溯转换原unknown，也不自动清理历史锁。

视觉工具控制交接与业务验收分开：缺陷显示×，无效/不确定/截图失败/裁切显示!，只有有效pass报告显示✓并注明等待任务验收。真实模型步骤次数与截图尝试分别保存/注入/查询，截图失败不会增加视觉模型请求数。保持原Scheduler验收、3轮修正和权限限制。

首轮回归还遇到Layers.Add动态解析错误，补同样的只读方法就绪/单次原生调用和颜色设置；没有把未知旧调用重发或误认未执行。

## 真实模型与AutoCAD

每次均显式执行 `pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task "新建画布，画一个房子，红屋顶蓝墙，旁边有棵大树，儿童绘本风格。"`。MainAgent与VisionAgent实际为deepseek-flash。新建隔离工作区，由模型自主选择工具与操作，没有固定绘图计划，没有用圆形代替需求。

| 私有运行ID | 实际结果 |
|---|---|
| quality-e371ec22-0eb5-4d02-bb0e-6fb5d7675599 | Drawing18在create_layer遇到旧动态Add解析错误；3确认/1unknown，未到截图。失败图和屏障保留，随后修复方法解析。 |
| quality-7291faee-c902-457d-b3e4-2208157b4e56 | Drawing19整体ok=true，5/5条件，36确认/unknown0，一次任务授权，一次截图，2个视觉模型步骤；真实红屋顶/蓝墙/大树图像通过，恢复回执before=after、清理通过。 |
| quality-9eb59338-4db7-4a79-a8fa-6041b5d8e2f3 | Drawing20实际局部修正至3轮，4张真实截图全部恢复正常，64确认/unknown0。最后风格判断仍uncertain，6/7条件，保留pending_verification，整体不通过。实际工具轨迹依次显示×、×、!、!，没有绿色成功。 |
| quality-b6b91a84-2529-4889-8073-98afef0a3a2f | 最终Drawing21整体ok=true，8/8条件，35确认/unknown0，一次授权，一次截图/视觉模型步骤；最终布局所属文档/ObjectID检查及完整恢复均通过。 |

Drawing19最终PNG hash `fde03ac4a6d3943605eb4df373ba9a4c2e4d5e97c9bbaa6c92a57ae4f619df23`；Drawing21为 `c3b6607ca01818e47ad4d259650dfde0609200b01edf54dad438ec1c5a38af83`。两图1600×1280，独立人工查看有红屋顶、蓝墙和旁侧大树，边缘前景0。未请求/声称保存为DWG。

另在上述真实模型画出的复杂图上各连续导出5次：`house-capture-repeat-2ea526a3d09c4b59bd7497fbef21d5d8`（Drawing19，37实体）和 `house-capture-repeat-907c4a0ad3914c3a9813f46b56a470f7`（Drawing20，30实体）。共10次原生导出/恢复/清理全部核对通过，实体数量不变；第二组使用预绑定恢复方法。它们是真实CAD重复捕获，不冒充10次完整模型绘图验收。

## 旧图与证据保护

Drawing17始终51实体，ObjectID集合hash `848e42ed740abcdeddbcb72d8929d43968436fff0206452bf7373f3fdce2335c`，实际模型布局打印签名前后相同。旧屏障SHA256 `BD0DCFD61D19571427BB16C9528170EACA3E7FAE9A5C6071339417B27DC36045`，原execution.jsonl为 `D01E1D4C1A718143508119E4691762A6E69CE32F8F81361AB2747061FE3053A7`，均不变。保留Drawing17及本次失败的Drawing18，不恢复/解锁/重放它们。

仅关闭本轮创建、已确认无unknown的Drawing19/20/21，关闭前核对所属运行、当前空闲、实体数量和状态；未退出用户AutoCAD实例。私有原生观察/重复导出/清理证据保留在.cader，原有相邻web/backend、训练资料、tests/images改动不改写或混入提交。

## 回归与剩余限制

实际执行typecheck、Node全量测试139/139、Harness smoke及MCP全量pytest246通过/33跳过、5个改动Python文件ruff I/F，均通过；手册131链接/22锚点通过，CI另见[测试记录](../development/testing.md)。此前发现测试fixture未响应可选MCP方法导致超时，已补Method-not-found响应；旧状态查询断言随新输出同步，并非跳过断言。原生byref初次只读探测暴露参数个数错误，修正后真实捕获通过，未修改旧图。

本次修复Count/CopyFrom截图恢复与BUG-047展示；旧unknown、保存后文件验收缺口、纸布局自动路由及风格评审不确定性仍不宣称解决。没有本机实测的模型、任意图纸或完整DSH app profile不标为通过。
