# REQ-052：局部坐标、待验范围与原生高清视觉

日期：2026-11-27（Asia/Shanghai）；Cader dev.14；关联 [Cader #20](https://github.com/codesknight/Cader/issues/20)、Milestone3。

## 来源及确认的根因

用户明确要求修复四项，允许改进progressive-drawing Skill。本轮不改变DSH/Cordis底座，不新建AgentLoop，不移除权限、独立验收或未知写入屏障。

旧原始大图轨迹有47次SOURCE_LABEL_BOUNDS_OUTSIDE_CROP。源码存在明确矛盾：scopedRun要求BASE裁片归一化坐标并执行转换，但OCR阶段的文字及补充图说明仍要求整图坐标。单项复核又允许模型重新提交位置，容易产生重复坐标转换和目标错位。不能将所有47次拒绝都直接归咎模型。

旧待验稿仅核实两条框线和一个行号，模型仍提交粗角、顶部列号/刻线等条件，超出合法绘制片段。旧批次虽传partial标志，视觉仍可无实体ID报缺少未提交器件；全图缩放的细字也不能与源局部可靠比较。4M累计token是最终停止条件，不是这些问题的根因。

## 实施

- `source-coordinates.ts`统一BASE像素边界和详情裁切；放大图不能扩张分析范围，主动看图不能越出BASE。所有报告遵守该步声明的坐标框架，只由程序转换一次。源清单仍可定位，索引OCR固定目标位置，只回index/text/certainty，保留SI大小写和不确定性。旧非渐进单项位置复核保持兼容。
- `progressive-draft.ts`依据独立agreement编译partial验收，包含片段外观和已确认字面文字；不再让模型添加未知列号/粗角/完整回路等条件。恢复时旧清单保存在draft_plan_history；partial通过始终不能代替全图覆盖或拓扑。
- `cad-review-scope.ts`从实际读回、原生文档、源hash、区域和snapshot生成scope ID及明确目标实体。原生坐标决定窗口，程序逆变换决定同区原图裁片，给出片段与实体匹配；不根据模型猜测的像素坐标修改CAD。删除目标保留原位置及expected_absent证据，其他实体只是背景上下文。
- `live.ts`对受控报告要求scope_id和checked_entity_ids完整匹配；batch/subset缺陷不得用空ID或其他实体。整区验收仍允许报告尚未创建的必要内容。原图A直接使用同区裁片，B使用真实WCS窗口导出；小字追加最多三份原生近景及对应原图。复用需所有图像字节hash一致，原始失败/复核/详情均保留。
- 视觉uncertain或格式无效且没有确定性几何失败时，交回Scheduler保留REGION_VISUAL_EVIDENCE_UNCERTAIN，不盲目改图或消耗三轮几何修正。明确的原生/视觉缺陷仍按原策略局部修复；其他独立区域可以继续。
- `ExecutionSession.captureView`继续通过执行回执、文档绑定及审计，只新增受控window参数。窗口、请求ID、原生介质像素和实际PNG尺寸须一致；不支持的旧服务在派发前拒绝，不用全图/插值放大冒充高清。窗口参数纳入observedArguments，旧无参数请求的指纹保持原样。
- 独立AutoCAD-MCP沿用capture恢复事务，增加world_window与min_long_edge：WCS XY俯视/无扭转，真实PNG介质512..4096，恢复并核对打印状态。无新参数的旧返回字段不变；新字段仅在请求局部/分辨率时出现。未知原生调用仍不重试。
- Skill的分解/验证引用同步实际接口，未增加权限或另一个技能执行器。CLI版本与中英文手册同步。

## 验证及边界

实际测试命令、真实AutoCAD原生PNG、完整原始大图运行及剩余问题见[验证记录](../validation/2026-11-27-local-visual-scope.md)。组件模型、实际stdio和真实模型/CAD分别记录，不能互相替代。

保留原有图纸、屏障和相邻仓库已有web/脚本修改；使用此前已隔离的原生实例，只在本任务新建文档绘图。原生窗口probe只临时更改打印设置并验证恢复，无新增/打开/保存/激活/关闭文档或几何修改。像素到CAD的精确投影仍未提供，窗口和实体绑定不冒充该能力；修改继续依赖原生实体读回。

## 独立证据上下文补修

实际联合回归报告引用了上一个区域的窗口。源码确认Available给所有worker注入主Agent的last_visual/执行历史。现在独立源观察、网/标签/片段/跨区审定和CAD视觉只接收本步骤证据；主Agent仍保留完整任务状态。独立worker明确只读，不再接收“当前没执行会话”或笼统的“身份未验证”来覆盖当前原生绑定证据。

源专用source-observation资源已在Catalog注册并按阶段加载；Global规划与CAD评审引用不再强加给源worker。位置索引与端子详情也转换为BASE，去掉重复的global normalized矩阵；原始像素映射仍在私有图像审计。看图工具通过raw JSON schema显示BASE像素范围，越界请求给出当前边界，失败请求不消耗成功图像读取次数；工具/模型总预算仍计费和限制。

保留两次早期联调失败：遗漏窗口参数执行回执映射，以及给DSH value-schema DSL加入不支持的minimum。前者在native前拒绝，后者0CAD装配失败；均已加实际DSH/stdio测试，不能宣称这些失败是模型识别不清。

## 待验稿的已采集属性边界

4M真实回归再次出现“线段端点已通过，但视觉要求加粗图框角”的争议。现有片段schema只采集path/circle/text，不包含线宽、填充、颜色、字体。若把整图外观要求倒灌到这一批，不论怎样重画都会偏离已核实合同。

程序编译的partial清单现只验证原生图元和字面文字，视觉绑定明确geometry_only及pending_source_attributes。受控报告仅接受primitive_not_visible、text_unreadable、rendering_artifact、unexpected_visible_target，且缺陷必须绑定当前实体；text_unreadable必须对应文字实体。未采集样式、完整覆盖与拓扑留在最终验收，不得把待验稿可见当成完成复现。小字优先、细小图元随后，最多三份真实原生近景；不通过提高全图截图插值清晰度代替近景。

源独立清点不再继承上次候选列表，后续索引OCR仍可定位当前候选但不能改变bounds；实际DSH测试同时验证独立性和主Agent状态保留。修改前4M运行不作为此最终属性合同的实测证据，另开默认2M预算的原始图完整任务。

## 局部截图的背景触边

最终默认预算真实回归第二批视觉pass，但PNG中上一批水平长线穿过右边缘，使通用clipping heuristic报4像素。实看原生PNG并核对目标bbox后确认：本批短折角在窗口内，背景触边被错当目标裁切。

`scopedNativeWindowContainsTargets`核对scope/请求/已证实原生窗口一致、目标ID与实际bbox全部在窗内，才允许局部批次不被背景边缘像素阻断；视觉pass及几何条件仍必须满足。无原生配置证明、不同窗口、未知实体或目标超窗均保持阻断。旧报告和border计数不回写。补修之后服务QUOTA，不能把留存真实证据重算说成新模型/AutoCAD全程复验。
