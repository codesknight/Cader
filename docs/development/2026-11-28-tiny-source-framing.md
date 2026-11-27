# 极小源图元的视觉取景修复

REQ-053 / BUG118 / [Cader #20](https://github.com/codesknight/Cader/issues/20) / Milestone3。用户要求调研并解决原始大图无法完成验收的问题；本次复用现有原生截图、源工作清单、视觉入口和Scheduler，未关闭验收。

## 已证实的现象

原始大图attempt13中，一个长1原始像素的源笔画，Native顶点/线宽检查正确，但约0.401×0.2 WCS的窗口被周围粗线填满，实际截图为纯黑图区。三次视觉不能判清，区域被阻塞。不是“没有画出”，也不能以坐标正确直接替代视觉通过。此前图层修复在这一轮为0派发前失败，不能据此宣布所有问题已解决。

暂停自有驱动于已完成截图恢复的只读模型边界后，在同一owned文档对同一实体取4×4 WCS实际窗口。无几何修改，目标身份不变，截图配置恢复/清理通过。独立真实Vision对留存宽窗PNG判可见，primitive coverage通过；该诊断0新CAD调用，`quality_accepted:false`，不回写原任务结果。

## 变更

`sourceGroupReviewScope`按当前源区域的像素/WCS比例，为批次和组详情每侧保留至少十个原图像素上下文。`progressiveReviewScope`同时保留至少两倍Native constant_width边距。已有更大边距保留，普通大窗口仍按比例取景。位置、线宽、实体ID和几何hash不改变。

完整源图窗口仍使用原有精确配对像素边界，不使用这个primitive边距；source/index/document/snapshot绑定和原生前后快照门禁不变。宽窗并不直接产生通过，仍需实际视觉报告。缺图、错图、几何变动或不可辨认仍拒绝验收。

## 实际验证与保全

- `pnpm typecheck`、`pnpm test`（400/400）、`pnpm smoke`通过。首次新增fixture类型未收窄导致typecheck失败，修正fixture后复验通过，未当作产品通过。
- 新测试覆盖源区域缩放、极短粗线、组详情上下文、实体/源/快照绑定不变、普通大窗口不膨胀；既有精确源窗口及不能以primitive通过代替完整保真负例仍通过。离线测试不等于真实整图。
- attempt13安全停于962确认/0未知/0派发前失败；959个Native实体与已确认账本一致，另存新待验稿214245字节，SHA256 `32fb9c2666963773ea0cfb8c9aa73891f3a680a2b9b0be9214376aae436e6792`。原质量失败不改写。
- 原123份文件hash不变，包含旧图、源图和屏障。新保全、宽窗诊断与环境清理报告纳入132份基线。原始日志均在私有`.cader/runs/`。
- 环境因素单独记录：在attempt13已确认只读边界，关闭10份自有、已保存、磁盘hash与保全报告相同的旧测试文档；保留运行图和组件图，owned实例文档12→2，目标身份未变。未结束AutoCAD进程、未接触用户或unknown实例。不得把环境清理后的性能全归因代码。

原始图新版真实模型＋AutoCAD完整回归另记。BUG118为修复复验中，BUG106 / Issue20保持打开，不能以这次观察对照宣称整图验收成功。

## 私有证据索引

`.cader/runs/source-worklist-20261127/`：`tiny-native-wide13.{png,json}`、`tiny-wide-vision13/result.json`、`attempt13-safe-stop.json`、`attempt13-preserved-progress.json`、`owned-saved-document-cleanup13.json`。全图数据和私有图纸内容不提交公开仓库。
