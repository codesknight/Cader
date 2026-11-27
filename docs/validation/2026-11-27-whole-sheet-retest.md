# REQ-052：充值后原始大图整图复验

日期：2026-11-27（Asia/Shanghai）。关联 [Cader #20](https://github.com/codesknight/Cader/issues/20)、Milestone 3、Draft PR22；基线 Cader6372386 / MCP7291468。

## 授权、原任务与保留

用户明确确认QUOTA由API账户余额导致，已经充值，要求继续完成整图验收。该用户确认解释上次服务拒绝，但不改变上次未验收结果，也不自动证明本次绘图通过。

继续使用原始4967×3509的img_001.png，SHA256 `541f0f75b878e4ca2f053ca975b5aa8e19e4db1bd87bec0199c30f7b7f314f1b`，不替换为简单图或固定几何计划。上次InteractiveSession及stdio已dispose，不能伪称恢复原活连接；本轮在此前隔离实例PID180452中经生产MCP新建owned工作图，不接管旧稿，不操作未知结果实例。原图、旧DWG、全部既有屏障与上轮结果的44项保留基线已写入私有目录。

## 实际入口与预算

显式执行 `node .cader/runs/whole-sheet-20261127/run-whole-sheet.mjs --live-smoke --case=attempt-01`。驱动复用生产InteractiveSession、runTask、createLiveRuntime、COMSession和MCP，只提供原始需求、受控CAD任务审批和预算；不注入源清点答案或几何序列，不批准Shell。

本次明确的联合回归上限：累计20M token、2小时、2000模型步、5000任务工具调用、4000CAD操作、50执行轮。单轮100工具/64CAD、验证预留、每区有限观察和三轮修正限制保持。产品configs/runtime.yaml的2M/30分钟等默认值未提高。任务内显式resume必须在原活连接上保留文档、账本与累计预算；总上限、unknown或身份不一致仍阻断。

私有轨迹、图片、工具结果、报告和检查点位于`.cader/runs/whole-sheet-20261127/`。本轮回归进行中，最终验收、文件检查与失败原因待实际完成后更新；不能把充值、预算调整或局部pass标为整图完成。


## 实测新增的局部结论冲突（BUG-099）

attempt-01基线6372386真实报告对三条提交图元明确说可见，但uncertainties全为整图样式/完整覆盖仍待验，两个同图报告均uncertain，仍阻断本批。原始报告不回写。新代码增加geometry_checks逐实体/检查类型/像素证据，要求所有本批检查键恰好一次，局部verdict和checklist与之保持一致；全局pending继续保存在Harness。

实际离线`pnpm typecheck`、`pnpm test`334/334、`pnpm smoke`通过。增加三个DSH场景：全图pending与本批pass冲突须拒绝、缺失逐目标检查须拒绝、真实目标不可观察必须保留uncertain。初次TypeScript闭包赋值推断和新增全schema严格编译错误保留在私有输出；改为单独严格校验geometry_checks字段及原有报告parser，未降低CAD校验。

随后显式运行`review-archived-targets.mjs --live-smoke`，新真实模型独立观察刚才留下的原生主图与三份近景，4份图像hash和原生窗口/恢复证明核对后只读复用，三项目标geometry_checks均pass，报告一次有效提交。此入口标记archive_only、actual_new_native_calls=0、current_task_acceptance=false，不是新的CAD执行或整图通过。最终完整任务须另用新代码实际运行。


## attempt-01：修复前完整长跑结果

基线6372386，三次同连接执行（原任务＋两次显式resume），累计4,990,037 tokens、61确认/0未知、1个原生前失败；任务总上限未耗尽，失败不是充值未生效。区域未全部通过，quality_accepted=false。保留两个独占版本的待验DWG及原始视觉、工具、源观察和所有失败，不能用保存文件替代整图验收。

该基线将TRANSPORT当作源识别失败继续处理，出现大量瞬时失败的区域及细分调用。另用新运行时只读分析其中同一原始裁片（0 CAD调用），50.191秒形成有效源观察；其中一次流终止类TRANSPORT保留并由后续观察替代。只记技术分类、错误长度和SHA，不记录错误正文、密钥或隐藏推理。服务/网络/适配器底层何者导致断流尚未证实。

## dev.15补修与验证

新增BUG100：复用上游@deepseek-ai/dsh-llm-retry0.2.2-rc.4，同持久化未完成请求最多两次瞬时重试；不新增AgentLoop，不重放工具。不重试QUOTA/AUTH，不无限重试。DSH durable重试步骤日志保持，公共model.request_retry仅显示安全字段。模型请求重试与CAD未知恢复严格区分。

源/片段/边界/视觉的未恢复provider错误向Scheduler传播并暂停任务，不能继续假装图纸不可辨而花费其他区域；已经由有效证据替代的旧失败不再阻断。视觉回调中的错误经过工具交接仍保留原代码，局部及整体验收仍不通过。合法保全保存与已确认操作不受模型错误变成unknown。

实际`pnpm typecheck`、`pnpm test`**344/344**、`pnpm smoke`通过，CLI实际dev.15。重试专项4/4为真实DSH循环＋确定性模型/工具夹具：确认写入只一次、失败流中的完整工具调用不执行、瞬时错误恢复、耗尽恰好两次重试、QUOTA/AUTH不重试。不是新真实CAD结果。中间类型/严格schema与重试事件观测失败保留，最终修复后通过。

独立源/视觉现在可以按角色读取已注册Skill；Source观察及CAD评审引用补充逐目标检查、符号本体/标注分离和不猜测隐藏连接的规则。权限不变、完整源覆盖不豁免；不是仅凭Skill宣称能力实现。新完整原图任务将在该代码版本启动，结果待实际完成补记。


## attempt-02与dev.16补修

基线554f909，两次续跑累计5,490,909 reported tokens、31个几何确认/0未知。局部per-target检查有实际通过，但区域仍不完整；不能把21个实体待验稿称为全图复现。文件操作另计：2确认、1次Open ACK后观测失败、0 unknown。错误为document_snapshot旧包装器`<unknown>.Count`，留下独占20395字节DWG（SHA256 f32b21af11dda315014c138e70a765ea2023b16b7396f05c87043c746ae69da8）及持久文件屏障；均加入63项保留基线，不重放旧Open。

BUG101：密集标签上限合法触发有界区域细分，非直接清点失败降级。BUG102：增具名源图BASE/DETAIL/LOOKUP及程序私有映射；宽条带自动附实际像素DETAIL，主动局部高清入口接收BASE 0..1，注册后的LOOKUP可作为位置视图，禁止越区、伪造及重绑。源观察不接收原图尺寸、裁片偏移和其他任务CAD截图；注册当前授权图片，确保裁图工具实际可用。根content_bounds固定BASE，OCR索引冻结。Skill说明同步实际工具Schema，未用Prompt替代程序校验。

三次同一原图裁片真实模型只读诊断保留：aspect版、view_ref版仍有定位混用；去除整图坐标元数据后的local-frame版31.781秒valid，0不确定对象/标注，但保留跨区/源unknown；模型坐标精度仍须独立核对，不据此宣称全图通过。三次均0CAD调用。

BUG103在独立MCP9f4cfb0修复，复用原生DISPID和有界只读重试，Open保持一次。307通过/34跳过，真实新文件验收结果待原图新任务实测。新隔离实例210940启动前记录全部已有PID，仅关闭其owned空白启动文档；旧unknown实例144908、新文件屏障实例180452及各旧稿保持。

新全程回归入口仍使用原始请求、真实模型自主区域/绘图、生产InteractiveSession和独立MCP；没有人工几何序列或源清点oracle。最终验收由后续实测结论补记。

dev.16实际离线命令pnpm typecheck、pnpm test（353/353）、pnpm smoke均通过，Skill quick_validate通过。新增实际DSH视图/裁图/非法ref反例为确定性模型＋合成宽图夹具，0CAD；与真实源诊断及真实整图结果严格区分。

REQ-052补BUG104/105：文字失败附原生bbox与可信源范围；区域疑问/边界net复核补受控高清入口、BASE转换和阶段资源。typecheck、356/356 tests、DSH component smoke通过。当前attempt03仍使用启动时bab3e49内存基线，不能将本次补修离线通过冒充已做新的完整CAD复验；独立原生/模型实证另记。

BUG101追加真实密度反例：attempt03有273×526像素区包含33项文字，512²阈值仍会阻止合法细分。仅SOURCE_LABEL_INVENTORY_LIMIT分支允许继续到深度6，且两边必须大于64像素、面积大于128²；总区数64、未执行区限制和32项观察合同不变。普通语义不确定仍用原深度/面积限制。全量356测试/typecheck/组件smoke通过；合成永久溢出负例终止于64区/126次检查/62次细分、0CAD/未验收，验证不会无限拆分或冒充完整。当前真实attempt03仍是bab3e49基线，不把新代码离线结果冒充其运行效果。


## attempt-03：原始整图真实回归最终结果（未通过）

启动时JS代码基线bab3e49，MCP9f4cfb0，实际MainAgent/VisionAgent均为配置的真实模型。不是确定性模型、固定几何计划或简单圆形替代。该进程启动后补修的636c9c7/8931606不会替换已加载模块；不得把其离线测试算作此轮新的完整真实验证。原始输入和Skill资源摘要在运行轨迹中保留。

本轮累计20,001,285 reported tokens，146项几何操作确认，0未知、0 ACK后观测失败、0原生前失败，CAD未冻结。达到显式20M任务总预算，在reference阶段以TASK_TOKEN_BUDGET_EXCEEDED安全暂停，不是API QUOTA。单轮自动续接确有执行，总工具调用超过100；预算和操作账本没有被清零。123个检查点始终同一连接/工作图，146个确认ID唯一且单调保留，未重放。

37个区域最终为22个partial_verified、13个blocked、1个observing、1个pending；完整区域覆盖未通过，因此最终全图视觉验收没有被标为通过。保留5处源片段无法独立达成一致、4处修正上限、跨区疑问/锚点、33项密集标注、规划细分等失败。真实局部CAD评审68次、源视图合同307次、主动LOOKUP269次；这些调用次数不代表整图质量。服务格式错误MALFORMED_RESPONSE共8条保留，本轮没有QUOTA。

已保全待验DWG：24361字节，141实体，SHA256 `f4460a2aa6496648589f633a013da789b370335b4b5b67844daf33c538b3bb5f`。程序P1保存/只读重开/查询比较通过；另在同一真实AutoCAD实例执行独立原生读回，原文件和只读副本hash一致、141实体查询ID/支持字段与原生一致、支持的几何/文字/填充投影一致，额外Open/SaveAs为0。只读和工作绑定保留，Count错误未复现。文件有效不等于原图语义/完整覆盖验收；quality_accepted=false，不作为完整DWG交付。

原图、旧稿、历史unknown及attempt02文件屏障的63项保留基线全部hash相同。本轮新DWG、质量、操作账本、原生比较及失败另加入私有保留清单；不清旧屏障、不接管旧未知实例。原始记录在`.cader/runs/whole-sheet-20261127/attempt-03/`，图纸在同级独占artifact目录。

## 已证实与仍待验证

已证实：最初规划存在矩形重叠/覆盖和共享锚点错误，后选择较粗四区，随后多次源清点/细分。源valid不等于全部对象clear，当前门禁会对不确定对象转入partial；实际unknown中混有外观端点、上下文角色和未请求物理尺度，不能全部豁免。精细规划、源不确定性的类型分离与渐进遗漏内容的后续补全仍不足，单纯提高任务预算不能解决。

已证实：一处文字视觉可读但native bbox越出可信源框，原反馈不足以支持精确修正；BUG104已补实际bbox差值证据，未改判定。区域unknown/边界net没有主动高清入口和小型密集区被面积阈值挡住也已分别补修。356项离线/typecheck/组件smoke及636/893的Windows/Linux CI通过，但这些补修后的新完整原图回归尚未通过，不能回写本次旧基线结果。

待验证：新高清入口、源视图一致性和密度细分能否在整图上稳定减少源不确定；是否需要进一步将视觉外观与上下文语义分开核实、改进计划作者和遗漏补全。这些是后续研发/实测项，不是已通过能力。Issue20、Milestone3、PR22保持进行中/Draft，不合并宣称完成。
