# dev.5：图层依赖、部分执行与规划错误

来源：用户17:22/17:24两次真实运行，以及“修复这些问题，为什么老出现这些屏障，如何彻底根治”。日期2026-11-21，关联REQ-032、BUG-027/028、[#20](https://github.com/codesknight/Cader/issues/20)、[#19](https://github.com/codesknight/Cader/issues/19)。

## 已证实的两类失败

17:22运行模型事件为QUOTA，frozen=false、无CAD写入；原质量调度未记录规划结果、将失败称为pending_verification，CLI又优先QUALITY_NOT_ACCEPTED。

17:24新图成功后直接draw_polyline(layer=HOUSE)，未创建HOUSE。原始native error为“未找到主键”，MCP源码先创建实体再赋层；查询读回一个0层AcDb2dPolyline，匹配部分执行路径。这不是缺参未执行，也不是额度错误。用户已实际确认归档旧Drawing6；现在是Drawing2的新unknown屏障，不混淆两者。

## 修复

执行层实时预检图层，拒绝未派发的缺依赖请求并允许模型纠正；补丁明确未派发索引；MCP创建前查图层、属性失败只清理本次新增实体；规划结果/失败结构化记录，失败不冒充质量待验；CLI保留真实错误码和首发原生错误。[ADR0013](../adr/0013-cad-dependency-preflight-and-partial-effects.md)说明安全边界。

本轮用户明确要求修复上述Cader及MCP问题；相邻独立仓库仅修改controller、针对性测试及开发日志，原有web/资料/图片未混入提交。

## 验证及限制

- Cader程序/实际DSH组件：缺图层只读拒绝、依赖查询失败不写、模型收到错误后自主选择create_layer再绘制一次；QUOTA/无计划在绘图前失败，原未知仍冻结。属于无付费模型/无CAD的确定性流，不冒充真实模型。
- MCP离线fault injection：38例，覆盖9种创建入口的缺失/锁定/冻结图层零创建，以及setter/hatch错误清理、清理失败明确报告。
- 真实AutoCAD，无模型：独立新工作图Drawing3，缺图层被拒绝后count=0；创建图层后正常闭合多段线；第二个新实体故意设置无效Layer，失败后仅该新增实体被清理，count仍1。只关闭本次新图，已有图纸保留。私有证据`.cader/runs/dependency-native-9a6336eb-e099-4fab-9cc9-e47fdbe62fb1/verification.json`。
- 真实模型/CLI自然语言及完整检查结果追加于[测试记录](../development/testing.md)及本报告，不以启动测试代替验收。

当前用户Drawing2屏障及残留保留，不自动放行或重放。COM原生revision/pixel映射、疑似捕获裁切、计划约束质量与原有BUG-025不在此次预检修复中宣称解决。完整根治丢回执依赖可验证的原生终态；保留该边界不会因减少误触发而取消。

## 实机进一步定位：背景打印延迟

第一轮真实模型房子/树：`quality-e2f051c5-b3bf-428f-a896-be0d655c7504`，16次确认写入，进入几何/自动视觉阶段；export_current_view等待PNG超时，随后PNG延迟出现，capture_dispatch/unknown冻结。整体exit1/blocked，未达到自动视觉验收；不能删除锁并把它改为成功。

原实现没有设置BACKGROUNDPLOT，也没有显式fit-to-page，只恢复ConfigName。后续独立新图实测该变量为2。[Autodesk PlotToFile](https://help.autodesk.com/cloudhelp/2020/ENU/AutoCAD-ActiveX-Reference/files/GUID-85A6B1AF-80AA-4F56-8305-6EFD4A4D8CF8.htm)说明前台ActiveX打印应设为0；[StandardScale](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-ActiveX-Reference/files/GUID-E8D9D4F5-24C1-4C89-924E-DF57C7F0CF5F.htm)支持fit-to-page。结合延迟文件证据，背景打印是本次故障的主要解释，不把所有历史COM异常都归为同一根因。

MCP现在临时前台打印、检查PlotToFile布尔回执、显式extents/fit/upright；用独立临时PlotConfiguration.CopyFrom备份及恢复全部打印设置，finally尽量执行每项恢复并报告恢复错误，清理临时配置，拒绝覆盖已有导出文件。没有ZoomExtents改变用户视口。未知导出失败仍在Cader冻结，不靠增加等待或自动重打消除屏障。

真实新图Drawing5验证：约1.110秒生成有效PNG；前后BACKGROUNDPLOT=2、ConfigName为空、scale/useStandard/rotation及PlotConfigurations.Count均一致；随后只关闭本次新图。证据`.cader/runs/dependency-native-87eb76c7-4e64-4887-9225-5afb8a5c2f17/verification.json`。新增5例离线导出成功/拒绝/异常/超时/已有目标不覆盖及完整恢复回归。第二轮模型验收另记。

## 第二轮真实CLI结果：无写屏障，完整质量仍待通过

显式执行`pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task "新建一张空白图纸，绘制一个房子，旁边有棵树。"`。原始记录`quality-c7032bea-5746-4cd8-88fd-c6dd5fea8fd2`，使用实际MainAgent/Flash与原生CAD，无固定操作计划。

结果：18次确认写入、unknown=0、1次负向schema预检失败（未派发），自动真实图像/视觉评审及一轮修正实际执行，review_valid=true；本轮没有写屏障。最终exit1/pending_verification，原因是计划按AcDbPolyline计数而后端返回AcDb2dPolyline，且后续修正截图触及图像边缘。计划还把“新建空图”编码为多段线计数，与其描述不等价，属于BUG-025计划/验收语义问题。不能为通过而改阈值、把类型不匹配当成功，或把视觉有效等同视觉判断可靠。

图像人工核对：首图房子与树完整但留白过大；修正后比例变大，边界触及，保守裁切提示有依据。前台导出已解决本轮延迟冻结，但未证明所有打印范围/比例或全图质量完成。截图仅保留私有目录，不作为新图已完整交付的证据。

清理：根据本轮新建图操作记录、最后全图快照和DWGTITLED=0逐一核对，仅关闭Drawing4及Drawing6测试图，Drawing1/Drawing2保留。私有`.cader/runs/dev5-cleanup.json`记录结果。初次把默认Path/FullName当作已保存标记导致保守拒绝关闭，随后使用未命名变量与完整实体快照核对通过；没有覆盖或丢弃用户原图。截图超时锁与旧Drawing2锁均保留原始证据，不重放。

本轮修复提交：独立MCP `538db9c`（codex/dependency-preflight）。Cader实现与最终CI见[测试记录](../development/testing.md)及#20；未合并到主分支、不关闭完整质量工作项。
