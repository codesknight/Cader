# Cader CLI 使用手册


[English](README.md) · **简体中文** · [项目首页](../../README.zh-CN.md) · [文档导航](../README.md)

**适用版本：Cader 0.4.0-dev.16 · 更新日期：2026-11-27**

## dev.16：具名源图视图

局部源图观察按BASE、DETAIL_n或工具实际返回的LOOKUP_n视图提交各自0..1坐标，换算由Harness负责；不再向局部观察混入整图尺寸与裁片原点。局部裁图工具也使用BASE归一化坐标，主Agent全图查看仍使用原始像素接口。裁图视图不可重绑或越区。密集且尚未绘制的区域可在深度、像素面积和区域数上限内进一步细分；批次通过不替代整图验收。

## dev.15：请求重试与逐目标视觉合同

模型请求使用DSH有界瞬时重试（最多2次），只适用于TRANSPORT/TIMEOUT/SERVER/RATE_LIMIT/EMPTY_RESPONSE。重试同一未完成模型步骤，不重放已确认CAD操作；总token/时间仍累计。QUOTA和认证失败不自动重试。耗尽后保留进度并暂停任务，不将服务失败当源图不可辨继续分区。geometry_only报告必填逐实体检查，独立源/视觉可读取已注册、角色允许的Skill，权限不变。

## dev.14：局部源图与视觉验收

区域分析统一使用BASE裁片坐标；索引标注OCR只读取已绑定位置，不重新提交位置框。部分待验稿清单由已核实片段生成，不要求未获准绘制的内容；全图覆盖仍独立待验。

每批视觉报告绑定实际文档、快照、scope ID和实体ID。需更新后的AutoCAD-MCP才能执行原生WCS局部PNG导出和小字近景；不支持时明确待验证，不把全图裁切放大当作高清。截图窗口、真实像素尺寸、文件hash及打印状态恢复均检查。报告不确定且没有已证实几何缺陷时保留REGION_VISUAL_EVIDENCE_UNCERTAIN，不盲目消耗绘图修正次数。`/quality`和同连接`/quality resume`保留这些证据；不会清除unknown或跨进程接管旧图。

待验稿只检查已独立采集的图元与文字；尚未采集的线宽、填充、颜色、字体及完整拓扑仍待后续验收。小字和细小图元按实际原生包围盒追加近景，最多三份。独立源观察/视觉不继承其他区域的旧截图状态。

局部图中的背景线可能触边；只有原生窗口配置已验证、窗口与scope一致且本批目标包围盒全部在窗内时，背景触边才不阻断本批。视觉和几何检查仍需通过。

geometry_only局部视觉报告必须逐实体提交geometry_checks（可见性、文字可读性、删除后的缺席），与批次结论一致。整图样式、覆盖与拓扑的待验状态继续由Harness保留，不混作本批图元不可见；真实不可观察仍保持待验。

## 渐进式复杂绘图（dev.13）

批次检查只装配本批已提交的需求与实体证据；区域及整图检查仍装配完整原需求。未画树冠不能当作树干批次的缺陷，批次交接也不会直接触发区域完整性验收。最多允许两个没有实体/确认操作变化的只读准备片段（每片段最多12个DSH模型步骤），连续第三个无进展片段安全停止；确认创建图层等准备操作计入实际进度。

`configs/models/MainAgent.yaml` 的可选 `generation.progressive_reasoning_effort` 用于渐进分区、局部清单、绘制/修正的受限步骤（当前为 `off`）；普通主Agent请求仍使用 `reasoning_effort: low`，8192输出上限不变。删除该选项则继承普通配置。实际路由记在 `model.route`；此设置不取代验收或保证模型不截断。


`progressive-drawing` 已注册为主 Agent / VisionAgent 的只读工作流技能。参考图达到 800 万像素、请求明确复杂或要求分区/分批时自动选择；普通直线、圆、房子等简单任务继续短流程。目录描述会动态暴露，正文和分解、验证、恢复 reference 按阶段加载，`skill.loaded` 记录资源及摘要。技能本身不授予写权限。

小图短流程若在原生写入前因源语义门禁失败，可在同一任务/运行时自动选择渐进技能一次，预算不归零；已有CAD进度、服务商或预算失败不走此回退。

Harness 先取得覆盖请求范围的分区计划（完整矩形，或由模型选择切线后程序生成全部格子），再依原权限批准新建工作图，逐区分析及绘制。每个有效批次自动读回并做结构和视觉检查；失败交回调度器，局部最多修正三轮。无法完整识别的区域可细分；两次独立源观察一致的几何片段只能进入**部分待验稿**，不能抵扣遗漏或被报告为整图完成。整体验收还包括全部区域、共享边界、跨区条件及 DWG 交付验证。

同一仍存活连接内，`/quality resume` 对渐进任务核对原需求、源图/计划摘要、工作图、已确认操作和新鲜实体状态，跳过已验区域，仅继续未完成内容。累计预算、视觉证据和修正次数保留。重启、重连、图纸被外部修改、未知写入、读回或检查点保存失败均不能自动续写。检查点通过临时文件、fsync 与 rename 保存，失败保留旧文件及临时证据。

```text
新建画布，分区域逐步复现这张复杂图纸：D:\CAD\source.png，完成后保存为 D:\CAD\result.dwg。
/quality
/quality resume
```

默认总任务模型步数 `max_task_model_steps: 400` 与普通调用 `max_model_steps: 100` 分开；默认总任务时间仍为 30 分钟，token / 工具 / CAD / 执行轮上限保持有效。可显式配置 `max_task_duration_ms`（不超过 4 小时）；续跑不会刷新起始时间或总额度。每个区域的源审查/视觉次数各自受限，同时共享任务总用量；不能通过分区无限续费。大图可能因源信息不清或总预算暂停，注册 Skill 不代表任意大图已支持完整重建。[实际回归及限制](../validation/2026-11-27-progressive-drawing.md)。


本批原始两任务新P1实测：房子6/6、复杂手稿13/13；实际只读验收图分别37/83实体并经独立原生检查，电路8网/9标注通过。

2026-11-26 普通COM文件交付P1：支持新契约的MCP会把DWG保存到请求父目录下的独占`artifact-*`目录；请使用返回的实际路径，旧意图路径另记为`requested_path`。不覆盖/移回原位置，同一工作图后续保存继续使用原请求父目录。SaveAs改变工作图标签/FullName，生命周期ID不变。

主Agent可调用`cader_verify_dwg_artifact`，Harness在完成交付前也会补验；它只处理当前已授权任务的已登记产物，不接受任意路径或文档ID。只读验收图与工作图身份分开，不能写入/接管验收图。重复核验重查已有验收图，不重复Open。`/quality`展示实际路径、SHA、文件交付状态和`legacy_summary_partial`范围；文件复核计数与既有CAD写入分别显示。未知文件派发或ACK后文件观测失败保留屏障，不能用几何`recover`解除；原生前拒绝可针对同一产物安全重验。旧服务保留旧保存路径并明确未评估独立重开。[接入与联合验证](../validation/2026-11-26-com-artifact-p1-integration.md)。


本轮最终实测（b062b51）：原始红屋顶蓝墙/大树7/7、原始复杂手稿12/12，自动修正/验收及DWG独立只读重开通过；原图和旧屏障保留。[最终记录及边界](../validation/2026-11-25-p0-quality-fixes.md)。

当前P0修补增加以下行为（实机完整回归状态见开发记录）：

- 参考电路的完整自定布局必须与源观察共享同一轴向缩放/平移框架；组件、端口和文字提示统一转换。布局漂移在CAD前拒绝，可改用`source_layout:true`。当前该入口不支持任意逐组件重排或旋转。
- 必要确定性检查通过而视觉仍uncertain时，Harness至多追加一次证据复核，校验并复用同一截图；不改写原报告或强制pass。仍未决则保持待验。
- `/quality accept [复核说明]`是用户专用人工复核入口；明确表示“我已人工检查这张图，没有问题”也进入同一确认流程。终端会对具备已验证DWG、仅视觉待决的任务主动询问。普通CAD工具批准不等于人工验收。
- 人工接受绑定任务、原自动记录、源图/图像及DWG摘要；文件或证据变化会使接受失效。`/quality`分别显示原自动结果和用户结果。人工接受只覆盖交付DWG，不授予续写权限，不解除unknown屏障，不覆盖结构失败。重启后的文件复核也不接管旧CAD工作图。

2026-11-25 人工验收补充：用户实际检查上述两张最终DWG后确认均无问题；文件摘要与回归产物一致，两成品现均人工验收通过。原自动视觉uncertain单独保留，不当作模型pass；也不再据此断言最终手稿有缺陷。当时记录的冷态新建和坐标框架缺口已进入本轮P0修补，当前实测状态见[修补报告](../validation/2026-11-25-p0-quality-fixes.md)。[人工结论与自动历史](../validation/2026-11-25-original-joint-regression.md)。

此前自动联合回归（14ada93）：热态房子/红屋顶蓝墙/大树通过7/7及DWG独立重开；冷态新建出现MCP名称读取失败；复杂手稿的8网/9标注/DWG结构通过，但相对布局视觉仍待验，整体未完成。该历史版本存在完整自定参考布局与标注投影未同步的缺口；本轮已增加共同框架校验，不能把历史缺口描述当作当前代码状态。活动图纸下只读回执契约7/7通过，不能替代绘图验收。[本次结果及待修复项](../validation/2026-11-25-original-joint-regression.md)。此前原稿成功为另一轮历史结果。

2026-11-25 执行证据适配：连接声明支持 `autocad-backend-evidence/1` 的 COM 服务后，执行层按操作白名单使用新回执；模型继续调用受控 CAD 工具。程序在派发前持久化请求，并核对 instance/document/request 身份、原生 ACK、观测阶段及实体集合。未覆盖的多段线、图层等仍走旧入口并核对工作图身份，不能宣称获得相同回执保证。旧服务继续兼容；已声明但不完整的契约会拒绝连接，派发失败不切回旧入口重试。

文档名称只是标签；同名不同 ID 拒绝写入，同 ID 的 SaveAs 名称变化不转移所有权。状态区分缓存标签与最近一次显式身份观察，COM revision 仍不支持。新建图纸不要求先有活动图；只有本连接新建且验证身份的工作图获得写入资格。

| 新回执的有效证据 | 执行层处理 |
| --- | --- |
| `not_dispatched`，未调用原生接口且无副作用声明 | 派发前失败，不冻结；修正后使用新的请求 ID |
| 原生全部 ACK，随后 `observation_failed` | 已提交、观测失败；原连接且原工作图可只读对账 |
| 无 ACK、矛盾/错身份/缺失回执、派发超时 | unknown，冻结；不重放、不自动解锁 |

支持新契约时主 Agent 可调用 `cader_cad_execution_status`，只查询本连接记录的原请求，不接受模型指定任意请求 ID。终端明确显示“只读执行记录查询，写屏障状态不变”；查无、过期、重启或错身份都不证明未执行。该入口尚不自动提升未知操作的结果。截图仍须验证独立的打印状态恢复回执，新执行 ACK 不能替代恢复证明。

显式契约检查：`pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --execution-evidence`。不调用付费模型、不提交有效绘图操作、不接管现有图纸；仅做真实服务发现、显式文档只读观察、故意缺参的原生前拒绝及 journal 反例。没有活动图纸时文档身份检查为未执行，报告非零退出；其他已执行检查仍保留。它不是绘图或质量验收。[实现、真实结果与限制](../validation/2026-11-25-cader-execution-evidence.md)。

2026-11-25实测：原始复杂电路手稿在真实模型/AutoCAD中12/12通过，含安全响应/预算续跑；额外原生DWG只读重开、8网、9处人工确认标注及源符号轮廓检查通过。这是一个有真实确认的参考案例，不代表任意图OCR或物理比例尺认证。CLI默认保存验文件头/hash及保存后CAD查询，原生重开是本次额外回归。[证据及限制](../validation/2026-11-24-reference-circuit-fix.md)。

dev.12：手稿电路使用模型规划的组件、具名端口及外部netlist；三端器件和分支不再强制满足串联闭环。Harness逐组件、网络和标注批次调度，每单元实际读回登记，全部完成后仍需几何、拓扑、源图对照和DWG验收。登记进度不等于验收通过；终端显示当前单元和截断续跑次数。

源标注单元附转换后的位置框及字号建议，绘制后需核对实际文字边界、不压器件。纯标点的极性/箭头由组件单元表达，不在标注单元重复绘制，也不擅自要求文字实体数量。活动单元只携带本单元数据，不再重复整份源图报告；完整证据仍保留。

参考电路的明确标注确认按最多4项分段调度，然后处理连接确认和验收规划。内部规划工具可选择`source_layout:true`并提交条件，引用模型已观察的对象/源网，避免复制整份图谱。程序记录近似图像端口投影到组件边界的调整，在审批前执行相同计划校验；这是语义布局引用，不是CAD操作序列或物理比例尺，完整自定义计划仍可用。

每个组件还收到原图`source_appearance`及封存`appearance_requirements`；抽象kind不能覆盖实际轮廓、填充、极性或箭头，不能擅自替换为仅功能相似的制式。视觉模型仍可能漏检，通过的模型报告不单独证明符号完全忠实。

各绘图单元都收到封存的可测条件及所需图层；setup创建这些层，组件和标注遵守计划的显式图层约束。TEXT、SYMBOL等示例名不能覆盖已批准计划。

单次模型输出仍为8192 token。绘制/修正输出截断、模型响应格式损坏或模型响应超时时，每个独立绘图单元最多自动恢复2次（无单元的任务仍为全任务2次）：保存账本、核对原连接和图纸、读回当前实体，只生成未完成的小批（质量任务Patch最多8项）。原生CAD超时不重放。未知写入、读回失败、连接/图纸变化或总预算耗尽时停止。单元共享轮预算，不能借新单元重置额度；默认任务上限为400次累计模型步骤、30分钟、16次Agent主动委派，工具/CAD/Token累计限额仍有效。API单次请求超时保持不变。自动续跑只限原进程，`/quality resume` 对渐进任务可安全续绘，其他任务保留原重验语义。

规划确认单元也共享执行轮额度，不因新单元重置。CAD视觉报告最多两轮格式尝试、每轮最多4次模型请求，复用同次截图；仍无有效报告保持待验。

内部源图复核按原有有界阶段单独预留次数（最多48：片段观察2、初读2、器件清点1、源网2、标注清点1、首轮8批、逐标签重试32），不占Agent委派槽。最终视觉继续受截图次数/格式修复上限控制；各阶段仍共享同一任务Token、时间和成本上限。视觉受控异常时，仅在原绑定、已知写入、执行层新鲜读回及文件保护允许时保存待验稿；未知写入仍不保存。

追踪电路源网前，先独立整图清点器件，包括无标注符号，按位置/端子数量核对覆盖。保留已有端子索引；补入器件的连接先记未知，必须实际追线。原有器件无法对齐时以`SOURCE_COMPONENT_INVENTORY_FAILED`阻止绘图。此检查独立于文字清点，不保证每次视觉解释均正确。

程序独立核对原图端子分组，并清点所有标注（同值不同位置分别保留），按不确定项优先每批最多4处裁图复核，再对未确认项扩大范围复核一次。仍不清楚的标注或连接保持待验证，不能猜值交付。`series_cycle`仅适用明确的简单两端串联闭环；netlist验证实际直线导线的外部连接，纯交叉不自动接通，声明内部交叉接点还需实际小圆标记。它不模拟晶体管电气行为，也不证明电路可正常工作。

明确源观察彼此冲突时，绘图前须用已有的有界局部复核仲裁；原分组获得佐证可恢复，未佐证的新分组不能直接封存。历史分歧仍须最终源图对照。最终明确源分区反驳封存计划时，Scheduler保存待验并停止按旧契约做几何修正，即使原生几何尚未通过。

后续明确的源读取可以纠正初读疑点，其他不确定关系仍待验；仅双边明确的关系作为硬冲突，有界局部复核保留已明确分组。

源网复核动态提供`membership`：每个已有端子均为必填属性，程序从一端子一连接组的映射生成网表，并核对补报器件端子。`SOURCE_NET_REPORT_INVALID`表示复核未提交有效结构报告，不等于已证明手稿模糊；源关系仍有冲突或不确定则另报`SOURCE_TOPOLOGY_UNCERTAIN`。

需要最终源图拓扑对照时，Vision通过`source_topology`报告原图端子分组，程序与CAD分组及原生验证状态比较。源分组明确匹配且CAD关系已证明时，不能再以T接点缺少额外圆点或CAD微小间隙在像素上不可辨来否定该条件；源图确实不清或分组不匹配仍不通过。重叠缺陷附导线ID及区间，便于局部修正。规划每次运行最多2次补充裁图，已附原图和独立观察仍可用。

模糊标注可随原请求补充明确确认；程序记录请求原文、原图hash/位置及原OCR读数，不把人工确认冒充OCR成功。网表的uncertain不等于确定断开：仅当其他明确端子关系一致时才可保留待验候选；最终必须通过专门的`source_topology_fidelity`原图对照条件。仍有明确冲突或最终视觉不确定时不能完成。最终评审附对应原图局部及其坐标变换，复用同次CAD截图。

批量标注重读只返回索引/文字/确定性，不重新估计位置框；单项复核可修正原图坐标框。每次读取最多3次模型请求，格式修复耗尽保留uncertain。随后真实用户确认可解决任务证据，但原读取及失败状态保留，明确记为人工解决，不算OCR成功。每次源读取补充裁图最多2次。

两份标注观察一对一关联，以独立清点框作为裁读目标，不再用偏移旧框扩张到邻近文字。大小写折叠仅用于关联读数，不能证明SI值；字面冲突仍需重读或真实确认。

请求含明确确认时，规划必须逐项审定剩余不确定标签；显式`补充确认`、`标注确认`或`label clarification`还要求审定所有必要标签，包括clear读数，未涵盖索引说明原因并保留原certainty。确认工具串行执行，持久化失败回滚。适用值绑定真实原文，不涵盖的索引显式记为`unconfirmed`及理由，仍保持待验。原始观察事件为不可变快照。图片中的符号不等于用户要求CAD图块；未请求的块引用数量门槛在绘图前拒绝。

源连接有歧义时，可在请求中追加`连接确认：`（或`connection confirmation:`）及实际确认的关系。封存计划前，Agent必须通过`cader_confirm_source_connections`绑定逐字原文和源端子，或记录不能适用的原因。当前仅支持确认合并，不支持拆分网络；未覆盖的疑点仍待验。独立源网复核收到确认，最终报告分别保留原始读取和确认后的分组。人工确认不解除CAD未知写屏障，不授权接管其他文档，也不冒充纯图像识别成功。

电路重绘中的“手绘”默认描述输入介质；仅在用户明确要求时，才将粗糙笔触或手写字体列为输出条件。最终视觉独立对照源图和CAD，不附先前模型的判断意见，减少结论诱导。

预算续轮后，待派发Patch若遇到有账本证明的派发前拒绝，模型会收到真实部分结果并重新规划缺失操作。仅在原连接、原图纸且账本未冻结时允许；已确认叶操作不重放，未知原生结果仍停止。失败操作的预算预留不退还。

符号必须实际接到声明端口；多段线bbox不能代替端点证据。已证实的同坐标端口允许直接接触，不画零长度导线。最终Patch可用`unit_complete`请求程序读回登记，不必额外一轮模型确认；缺少端口时返回已确认结果和缺失项，继续补齐而非重放。

Cader CLI 是基于 DeepSeek Harness 的 CAD Agent 终端：在一个持续会话中描述任务、选择模型和技能、引用图片、查看 CAD 状态，或用单次命令接入脚本。

本手册随代码在同一仓库维护，描述当前实现。设计提案与待开发功能见[开发路线](../development/roadmap.md)。

dev.11 将视觉工具的业务结果与控制交接分开：`× cader_review_cad_view` 表示视觉缺陷，`!` 表示截图/读回失败、报告无效、裁切或不确定；仅有效pass报告显示 `✓`，且任务仍须通过Harness独立验收。`/quality`及历史状态分别报告截图尝试和已准入的视觉模型请求步骤；截图失败不会被算成已调用视觉模型，也不等同于已付费次数。

配合更新后的独立AutoCAD-MCP，截图在改动打印参数前预检，并在恢复后读回核对。只有完整、匹配本请求/图纸/路径的原生证据证明未修改或已恢复，失败才保持待验证而不冻结；其余情况继续保护写入。当前捕获要求模型布局，纸布局会在变更前拒绝，不自动切换用户布局。重启CLI及其MCP子进程后新行为生效；历史unknown屏障不会因此解除，旧图不会自动接管。见[原始绘本真实回归](../validation/2026-11-24-capture-restoration-fix.md)。

dev.10 的质量任务支持原进程内自动续轮：单轮额度将尽时停止派发、读回并保存检查点，在同一任务/连接/工作图/授权下继续。整批 Patch 先预留父入口及全部子操作的额度，额度不足时整批不派发；下一轮由 Scheduler 通过原工具执行仅未派发的请求，再让主 Agent 继续推理。已确认和未知写入均不重放；连接/图纸变化、读回失败或 unknown 阻止自动续写。视觉或视觉后的读回失败也会立即交回 Scheduler，不能留在绘制阶段盲改。

在 [`configs/runtime.yaml`](../../configs/runtime.yaml) 中，`max_tool_calls: 100` 是单执行回合额度；`max_task_tool_calls: 600` 为任务总工具额度（含 Patch 父/叶及视觉工具），`max_cad_operations_per_round: 64` / `max_cad_operations: 400` 分别限制单轮/任务 CAD 写请求；计数是派发前保守预留，不是成功实体数。`validation_tool_reserve: 8` 给验证保留工具额度。Patch schema 按单轮容量动态缩小，最多32项。总工具/CAD/回合上限不会随续轮重置；`max_execution_rounds: 12`、`max_task_model_steps: 400`、默认总任务时间30分钟继续约束整个任务；`max_model_steps: 100` 仍用于普通调用。

`max_task_tokens: 2000000` 根据服务商已报告用量停止后续模型/工具请求，用作成本代理；不是精确货币额度，也不能撤销正在执行的付费请求。CLI 显示“预算检查点 / 自动续轮 / 任务总限额暂停”；完整读回、原连接标识、已确认操作、未派发队列与预算记录在当前任务 `quality.json`。总限额暂停仍未通过验收。自动续跑限于原进程内；重启不恢复写授权，`/quality resume` 只在原有效绑定下继续渐进未完成区域或安全重验，不能重放已确认绘图或绕过屏障。

显式真实验收可用 `pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --round-cad-budget 4 --task "新建图纸，画10个互不重叠的圆并验证"`。`--round-cad-budget` 仅用于 `--quality`，范围1–64；只降低本次真实测试单轮 CAD 额度，报告还要求实际发生自动续轮。命令调用付费模型与真实 AutoCAD，并在私有测试工作区绘图；不是离线测试。详见[实现与实测](../validation/2026-11-24-budget-continuation.md)。

## 目录

- [安装与启动](#install)
- [第一次对话](#first-session)
- [交互命令](#slash-commands)
- [文件引用、快捷键与 Shell](#interaction)
- [模型、MCP 与 Skill 配置](#configuration)
- [单次命令与脚本](#commands)
- [会话与数据](#sessions)
- [CAD 能力与验收](#cad)
- [常见问题](#troubleshooting)
- [更新与反馈](#updates)

<a id="install"></a>

## 安装与启动

### 环境要求

| 依赖 | 要求 |
|---|---|
| Node.js | 24.9.0 或更新版本 |
| pnpm | 11.28.5；以下安装示例要求 Corepack 已可用 |
| Git | 获取、更新源码 |
| AutoCAD 与 AutoCAD-MCP | 仅真实 CAD 操作需要；使用独立的 MCP 环境 |
| uv / Python | 可选，供 Python MCP 诊断使用 |

当前采用**源码构建与本地启动器**，尚未发布可通过 `npm install -g` 安装的公共包。启动终端、查看帮助和离线 smoke 不需要模型密钥或 AutoCAD。

### Windows PowerShell

确保支持的 Node.js 已在 PATH 中，再执行：

```powershell
git clone https://github.com/codesknight/Cader.git
cd Cader
corepack.cmd enable
corepack.cmd prepare pnpm@11.28.5 --activate
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
.\cader.cmd
```

使用 `.cmd` 可避免 PowerShell 将 `pnpm` 解析到被执行策略阻止的 `pnpm.ps1`，无需放宽执行策略。

要直接输入 `cader`，将启动器安装到**已经在 PATH 中**且当前用户可写的目录。例如，仅当下列用户目录已在 PATH 中时：

```powershell
pnpm.cmd run cli:install --bin-dir "$env:USERPROFILE\.local\bin"
cader --version
cader
```

安装器不修改 PATH，不覆盖其他来源的同名启动器，并拒绝可能遮蔽 CMD 的现有 `cader.ps1`。没有合适目录时，继续使用仓库内 `.\cader.cmd`。
启动器指向当前源码目录，移动或删除仓库后需重新安装。若本仓库已准备 `.cader/tools/node-v24.9.0-win-x64/node.exe`，Windows 启动器可优先使用它；全新克隆不会自动下载该运行时。

### Linux / macOS

```sh
git clone https://github.com/codesknight/Cader.git
cd Cader
corepack enable
corepack prepare pnpm@11.28.5 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm exec cader
```

本手册后续示例用 `cader` 表示已安装的入口；未安装全局启动器时，Windows 替换为 `.\cader.cmd`，Linux/macOS 替换为 `pnpm exec cader`。除交互会话的工作目录切换外，命令示例均在仓库根目录执行。

<a id="first-session"></a>

## 第一次对话

首次创建根 `.env`，已有文件请直接编辑：

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Linux/macOS 对应命令为 `test -f .env || cp .env.example .env`。在本机编辑器中填写 `DEEPSEEK_API_KEY`，不要提交或分享 `.env`；也可以由进程环境提供。自然语言任务与 `/compact` 会调用模型并产生费用。

运行 `cader` 后，在彩色 CADER 标识下输入：

```text
/help
/model
/skills list
/domain electrical
说明检查一张电路图时，需要确认哪些符号、文字和连接关系。不要调用工具。
/context
/exit
```

这是输入示例，模型回答不保证逐字相同。首次真实 CAD 使用前，先完成下文的 MCP 配置。启动时自动连接 `configs/mcp/AutoCAD.local.yaml`（若存在），显示服务连接状态、发现与暴露的工具数量。COM 状态的 `not_probed` 不代表已经探测到 CAD 版本；执行实际 CAD 工具才会建立原生连接。

| 启动方式 | 行为 |
|---|---|
| `cader` | 在交互终端中持续运行；非 TTY 输入输出时显示帮助，退出 0 |
| `cader chat --workspace "路径"` | 在指定工作目录进入会话，目录必须存在 |
| `cader chat --stdio` | 显式接收管道文本；仍输出面向人的文字，Shell 无法获得交互批准 |
| `cader --help` / `cader --version` | 不加载项目配置、不调用模型或 MCP |

<a id="slash-commands"></a>

## 交互命令

Slash 命令在 Cader 会话内部输入。尖括号表示需要替换的参数，方括号表示可选参数；输入时不要保留这些括号。

| 命令 | 用法与当前行为 |
|---|---|
| `/help` | 查看命令及快捷键 |
| `/open <路径>` | 选择 PNG/JPEG 供后续对话使用；DWG 仅登记元数据，明确返回 `CAD_OPEN_UNAVAILABLE`，未在 AutoCAD 中打开 |
| `/cd [路径]` | 查看或切换工作目录，清空原附件引用；不改变父 Shell 目录 |
| `/status` | 查看目录、模型、权限、MCP连接与工作图绑定；COM仅返回生命周期状态 |
| `/model [ID]` | 列出或选择已配置模型，例如 `/model MainAgent`；只影响当前主会话模型选择 |
| `/mcp list` | 列出配置文件 |
| `/mcp barrier` | 只读核对旧缺参屏障、原始审计及当前工具schema，显示人工复核资格 |
| `/mcp resolve` | 仅用户可发起的旧缺参复核；证据符合且明确确认后归档原屏障，要求新建工作图 |
| `/mcp use <配置路径>` | 选择 MCP 配置，例如 `/mcp use configs/mcp/AutoCAD.local.yaml` |
| `/mcp tools` / `/mcp off` | 发现服务工具或禁用后续 MCP 连接；发现工具不等于授权 Agent 使用全部工具 |
| `/skills list` | 查看主 Agent 可见的 Skill |
| `/skills use <名称>` / `/skills off` | 选择或取消预加载；角色可见的 Skill 目录仍可按需加载 |
| `/domain [ID]` | 列出或选择专业指导，当前为 `general`、`electrical` |
| `/context` | 查看文字 token 估算、最近 provider usage 及引用数量；估算不含图片和工具 token |
| `/compact` | 调用模型生成摘要，保留原对话；该请求关闭工具、MCP 与委派，失败时保留原上下文 |
| `/clear` | 保存旧会话，开始空白会话，保留模型等偏好 |
| `/resume [会话ID]` | 列出或恢复可见对话、摘要和选择，不重放工具、Shell 或 CAD 请求 |
| `/undo` | 明确返回 `CAD_UNDO_UNAVAILABLE`；当前没有受控 CAD 撤销接口 |
| `/checkpoint` | 保存会话及工程引用哈希清单；不备份 DWG 或创建 CAD 数据库恢复点 |
| `/permissions [模式]` | read-only / ask（默认）/ workspace-write / full-access；另支持 shell ask / shell deny |
| `/quality` / `/quality resume` | 查看质量阶段及未完成项；同一连接安全重验，不重放绘图，累计最多3轮修正 |
| `/exit` | 保存会话并退出 |

上表按子命令展开，包含 17 个 Slash 根命令。MCP连接跨轮保持；`/mcp off`、切换配置、工作目录、清空/恢复会话或退出时释放。恢复会话重置为 ask，不恢复 CAD 写入绑定；新连接必须新建工作图。

| 模式 | 查询 | 工作图绘制/编辑 | 删除、覆盖 |
|---|---|---|---|
| read-only | 自动 | 拒绝 | 拒绝 |
| ask（默认） | 自动 | 每次审批 | 每次审批 |
| workspace-write | 自动 | 本连接工作图内自动 | 审批 |
| full-access | 自动 | 本连接工作图内自动 | 授权范围内自动 |

CAD写入只作用于本连接通过 `new_drawing` 新建的工作图；不继承桌面既有图纸的写权限。保存工作区外路径在 workspace-write 下仍需审批。写后查询实际实体；失败或结果不明保留 `.cader/locks/managed-write.json` 并冻结，当前 COM 无请求日志自动对账，需人工检查原记录与图纸，不删除锁后重试。另一固定计划调度器共用写锁。

<a id="interaction"></a>

## 文件引用、快捷键与 Shell

### 引用图片与图纸

```text
评估 @benchmark/fixtures/vision-calibration.png 中可直接确认的信息。
/open "tests/images/我的参考图.png"
列出当前参考图中不可读或需要局部放大的区域。
请记录 @drawing.dwg 的文件身份，不要推断其中的实体。
```

除仓库内的校准图外，上述文件名是示例，使用前替换为当前工作区中的真实文件。

- 支持 `@draft.png`、`@"路径有空格.jpg"`、直接粘贴本地 JPG/PNG 路径和 `/open <路径>`。显式选择的外部图片会复制为工作区 `.cader/references/` 下的哈希快照，不扩大 Agent 文件/Shell 权限；含空格路径须加引号。DWG 引用仍须位于工作区内。
- PNG/JPEG 上限为 10 MiB、4000 万像素；当前每轮最多一张活动原图，新图会替换它。图片选择会保留到后续轮次，发送给配置声明支持图片的模型。
- DWG 上限为 64 MiB，只校验文件头并记录大小与 SHA-256，不解析图纸内容。PDF 尚未支持。
- 每轮前复核已选快照哈希，快照变化后要求重新选择；外部原文件变化不会暗中替换已选图片。`/cd` 清空引用和未完成重绘请求。图片、Skill 与 DWG 引用均不授予写权限。

```text
根据 "D:\sketches\draft.jpg"，新建空白图纸复现图中符号、可读文字和连接，保存为 result.dwg。
```

也可先 `/open "D:\sketches\draft.jpg"`，再发送绘图任务。未提供图片时会保留请求并提示选择；随后输入路径或 `/open` 后说“继续”，无需 GUI 上传。程序先读取手稿结构，再规划/绘图，对照原图和真实 CAD 截图验证，最后报告实际 DWG 路径。未指定路径时在工作区生成唯一文件名。批准任务包含该目标的新文件保存，覆盖其他或已改动文件仍另行审批。只有质量和文件检查均通过才完成；未通过但可安全保存时生成明确标记的待验稿，不把它当合格成品。

同一连接内说“继续”或 `/quality resume` 可继续未完成重绘，保留原始需求、原图哈希、目标和修正上限，不重放已确认几何。已经完成的任务不会因“继续”重复绘图。重启/重连不继承旧 CAD 写权限，也不解除未知写屏障。

### 快捷键

| 按键 | 行为 |
|---|---|
| Tab | 补全 Slash 名称、`@` 引用及 `/open`、`/cd` 路径；含空格的路径自动补引号 |
| ↑ / ↓ | 查看本进程输入历史 |
| Esc | 中断运行中的任务；空闲时清空当前输入 |
| Ctrl+C | 运行中请求中断并等待清理；空闲时退出 |
| Ctrl+D | 关闭输入并退出 |

取消后会等待当前运行清理完成，不自动重放请求。支持 VT 的终端提供完整编辑体验；`TERM=dumb` 使用简化输入。

### 执行用户 Shell

```text
!dir
/permissions shell deny
/permissions shell ask
```

`!` 仅响应用户直接输入，逐条展示命令与工作目录，输入 `y` 批准本次执行；默认拒绝。Windows 使用 PowerShell，Linux/macOS 使用 `/bin/sh`。
命令以本机账号执行，**不是沙箱**。用户 `!` 命令与 Agent 的 `cader_shell` 分开：前者始终逐条审批且输出不入模型上下文；后者输出回传模型，在 read-only 禁止，ask/workspace-write 逐条审批，full-access 自动执行。`shell deny` 隐藏 Agent Shell 并禁止用户 Shell。
执行时间上限为 30 秒，输出上限为 64 KiB；取消针对本次进程树，已有副作用不自动回滚。管道会话不批准 Shell。

<a id="configuration"></a>

## 模型、MCP 与 Skill 配置

所有可维护配置位于仓库 `configs/`，密钥来自根 `.env` 或环境变量。修改配置后重启终端。

| 路径 | 用途 |
|---|---|
| [`configs/models/`](../../configs/models/) | 模型地址、名称、`api_key_env`、输入能力与生成参数 |
| [`configs/runtime.yaml`](../../configs/runtime.yaml) | 注册 profile、预算、只读工具和委派限制 |
| [`configs/mcp/`](../../configs/mcp/) | 独立 MCP 进程的启动与环境引用 |
| [`configs/skills/catalog.yaml`](../../configs/skills/catalog.yaml) | Skill 名称、角色可见性与资源注册 |
| [`configs/domains/catalog.yaml`](../../configs/domains/catalog.yaml) | 专业指导目录 |
| [`configs/prompts/static/`](../../configs/prompts/static/) | 稳定统筹与角色提示词 |

### 选择模型

| 配置 ID | 当前模型 | 声明输入 |
|---|---|---|
| `MainAgent` | `deepseek-flash` | 文字、图片 |
| `SubAgent` | `deepseek-v4-pro` | 文字 |
| `VisionAgent` | `deepseek-flash` | 文字、图片 |

```text
/model SubAgent
/model MainAgent
```

配置通过 `api_key_env: DEEPSEEK_API_KEY` 引用凭据，当前 `base_url` 为 `https://api.deepseek.com`。不要在 YAML 中填写密钥值。
`/model` 不改变子 Agent 的模型配置或工具权限；只有主 Agent 可委派，最多 5 个并行子 Agent、深度 1。模型声明支持图片不等于图片识别准确度已通过验证。

### 连接 MCP 与自然语言绘图

先复制示例，已有本机配置请直接编辑：

```powershell
if (-not (Test-Path configs/mcp/AutoCAD.local.yaml)) {
  Copy-Item configs/mcp/AutoCAD.example.yaml configs/mcp/AutoCAD.local.yaml
}
```

按独立 AutoCAD-MCP 环境设置 `command` 为其 Python 可执行文件，设置 `cwd` 为该项目目录；相对 `cwd` 以 YAML 所在目录解析。启动所需 CAD 后，在 Cader 内输入：

```text
/mcp use configs/mcp/AutoCAD.local.yaml
/mcp tools
/status
只读取当前图层并总结，不修改图纸。
```

MCP 配置路径以 Cader 配置根目录为基准，须在其中。普通 profile 与受控 HTTP profile 用途不同，不能互换；`/mcp use` 不自动启动 AutoCAD 或切换后端。

也可用短文件名 `/mcp use AutoCAD.local.yaml`；配置选择后在 `/mcp tools`、状态查询或下一轮任务建立连接。发现44个工具不代表全部开放：当前动态执行审核普通 COM 工具的子集，不开放不匹配的 HTTP 原子接口、VQA 或任意脚本入口。

```text
/permissions ask
新建空白工作图，在红色图层上画100×60矩形和中心半径15的圆，然后查询验证。
把刚才的圆向右移动5个单位，保存为工作目录下 test.dwg。
```

模型自主选择工具，程序展示具体参数并等待 `y`；新建空白图无需提供已有DWG或参考图。模型还可使用 `cader_read_file`、`cader_write_file`、`cader_edit_file`、`cader_glob`、`cader_list_files` 和受控 Shell。文件工具限工作区、64KiB文本，排除 `.env*`、`.git`、`.cader` 与CAD文件；覆盖和Edit需要审批（full-access除外）。Glob跳过符号链接及私有目录。Shell是用户显式授权的本机通道，不提供文件沙箱保证。
当前 Agent 仅暴露已审查的后端状态、图层、符号库读取工具；工具发现清单可能更长。

### 使用 Skill 与专业指导

```text
/skills use cad-redraw-review
/domain electrical
评估 @benchmark/fixtures/vision-calibration.png，区分可确认事实与未知信息。
```

当前内置 `cad-inspection` 与 `cad-redraw-review`。新增 Skill 需要显式注册，复制一个目录不会自动加载。
Skill 和专业指导用于规划与检查，不授予 Shell、COM 或 CAD 写权限。详细配置见[模型与 MCP 指南](../development/model-configuration.md)。

<a id="commands"></a>

## 单次命令与脚本

### 命令总览

| 命令 | 用途 | 模型 / CAD 调用 |
|---|---|---|
| `cader --help` / `cader --version` | 帮助 / 版本；别名 `help`、`-v` | 无 |
| `cader chat [--workspace <目录>] [--stdio]` | 持续会话 | 按实际输入决定 |
| `cader doctor` | 检查 Node 版本，不是完整 CAD 诊断 | 无 |
| `cader models` | 显示模型配置及凭据是否设置，脱敏输出 | 无 |
| `cader skills list` | 列出主 Agent 可见的技能 | 无 |
| `cader skills show <名称> [--resource <ID>]` | 读取已注册正文或资源 | 无 |
| `cader exec "<任务>" [选项]` | 单次自然语言任务，默认 ask；非交互时需要审批的调用拒绝 | 调用模型；可选 MCP |
| `cader harness-smoke` | 离线 DSH 组件检查；pnpm 脚本名为 `smoke` | 无真实模型/CAD |
| `cader live-smoke --mcp <配置> [--image <图片> --expected-image <JSON>]` | 固定只读诊断，图片期望参数可选 | 真实模型及所选 MCP/CAD |
| `cader cad-contract` | 导出受控 CAD 契约 | 无 |
| `cader cad-test --backend http --mcp <配置> --plan <JSON> --output <DWG> [--authorize-write]` | 已审查固定几何的受控闭环 | 无模型；授权后真实 CAD 写入 |
| `cader cad-reconcile --run <运行目录> --mcp <配置>` | 查询未知请求结果，不重放或解锁 | 所选 MCP |
| `cader assessment-check --assessment <JSON> --expect <JSON>` | 独立事实和抽象连通图检查 | 无 |

### 单次任务与图片区域

```powershell
cader exec "读取图层并总结，不修改图纸" --mcp configs/mcp/AutoCAD.local.yaml
cader exec "评估图中信息" --skill cad-redraw-review --image benchmark/fixtures/vision-calibration.png
cader exec "检查左上区域" --image benchmark/fixtures/vision-calibration.png --crop 0,0,128,128 --rotate 90
```

裁剪示例须匹配所选原图尺寸。`exec` 支持 `--permissions read-only|ask|workspace-write|full-access`、`--mcp`、`--skill`、`--image`、`--crop x,y,w,h`、`--rotate 0|90|180|270` 和 `--intent assess|redraw`；先按原图像素裁剪，再顺时针旋转。exec无交互审批；需要自动绘图时显式选 workspace-write，并在同一任务先新建工作图。
`assess` 为默认；`redraw` 需要 `--image`、可用 MCP 和写权限，走同一源图/新图/文件质量流程。只读或无图时仍返回 `blocked / WRITE_CAPABILITY_UNAVAILABLE`。示例：`cader exec "根据参考图新建空白图纸重绘，保存为 result.dwg" --intent redraw --image draft.jpg --mcp configs/mcp/AutoCAD.local.yaml --permissions workspace-write`。非覆盖的工作区文件可自动保存；需要审批的操作在 exec 中不会自动批准。
交互会话的 `/model`、`/mcp`、`/skills` 选择不影响另一次 `exec`，单次任务从配置及本次参数装配。

### JSON 与退出码

需要严格 JSON 时直接使用构建后的入口，避免 `pnpm run cader` 的构建日志混入：

```powershell
node apps/cli/dist/index.js exec "说明检查步骤，不调用工具"
```

单次任务报告为 stdout 的一个 JSON 对象，启动异常为 stderr 的脱敏 JSON，帮助为普通文本。交互终端和 `chat --stdio` 不是稳定 JSONL 接口。

| 退出码 | 意义 |
|---|---|
| 0 | 命令正常或运行成功；只读任务可能仍为 `task_status=unverified` |
| 1 | 运行、配置、模型或连接失败 |
| 2 | 参数或命令错误 |
| 3 | 业务阻塞或验收未通过；`cad-reconcile` 保留冻结状态，也返回 3 |

同时读取 `run_status`、`task_status`、`verification`、`blocked_reasons` 与 `artifact`。`ok=true` 或模型正文不能证明已生成并验收 DWG。

<a id="sessions"></a>

## 会话与数据

```text
/context
/compact
/checkpoint
/resume
/resume session-00000000-0000-0000-0000-000000000000
```

最后一行是 ID 格式示例，实际使用 `/resume` 列出的 ID。`/clear` 保存原会话并新建空白会话；恢复不会重放任何操作。

| 位置 | 内容 |
|---|---|
| 配置根 `.cader/sessions/` | 可见对话、摘要、配置选择与引用身份；Shell 审计事件单独记录 |
| 配置根 `.cader/checkpoints/` | 会话与工程引用清单，不是图纸备份 |
| 当前工作目录 `.cader/runs/` | Agent 事件与任务验证报告 |
| `.cader/artifacts/` | 显式指定的私有输出目录；固定 CAD 测试在此保存 DWG |

交互配置根从当前目录向上发现 Cader 配置，或回到启动器所在仓库；`/cd` 仅切换工作目录。不要把这理解为任意项目配置合并或工程初始化。
可见用户输入和模型正文可能包含项目内容；即使凭据已脱敏，也应将 `.cader/` 保持私有。图片会在明确的模型调用链路中发送，运行记录可能包含附件；原始资料和完整会话不要随 Issue 上传。

<a id="cad"></a>

## CAD 能力与验收

交互 Agent 与 `exec` 默认 ask。真实文本模型已经自主完成新建、建层、直线/矩形/圆、移动圆、保存DWG与独立查询验收，见[执行验收](../validation/2026-11-20-agent-execution.md)。另外，固定计划调度器仍保留其HTTP保存/重开验收；COM动态路径尚无受控重开能力，不将两条链路的验收混用。

显式真实模型/真实CAD验收命令（会付费、创建新工作图并保存到私有运行目录；仅审批CAD操作）：

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --execution
```

高级集成测试先参照[受控执行指南](../development/cli.md#controlled-execution)，配置专用 HTTP profile、认证 Bridge 和新的输出文件名。此命令会真实写入新工作图，仅在准备好环境并决定执行时运行：

```powershell
cader cad-test --backend http --mcp configs/mcp/AutoCAD.managed.local.yaml --plan benchmark/fixtures/managed-geometry.plan.json --output .cader/artifacts/geometry-001.dwg --authorize-write
```

`--backend http` 是能力要求，不会自动切换服务端后端。仅允许审核哈希对应的固定计划；默认不覆盖文件。未知写入结果会冻结后续写入，只按原请求对账，不自动重放，也不要删除锁后重复提交。

尚未开放：任意既有 DWG 受控编辑、COM受控重开、CAD 撤销、CAD 快照恢复、图片到 DWG 的完整闭环、稳定 RunEvent JSONL、公共 npm 发布。
边界和证据见[受控写入设计](../architecture/controlled-writes.md)、[真实固定几何报告](../validation/2026-11-19-cader-cli-real-loop.md)和[交互终端验证](../validation/2026-11-19-interactive-terminal.md)。

<a id="troubleshooting"></a>

## 常见问题

| 现象 / 错误 | 处理方式 |
|---|---|
| `pnpm.ps1` 被禁止运行 | 使用 `pnpm.cmd`、`.\cader.cmd`；无需修改 PowerShell 执行策略 |
| 找不到 `cader` | 先在仓库运行 `.\cader.cmd` 或 `pnpm exec cader`；检查本地启动器目录是否已在 PATH 中 |
| Node 版本过低 / 尚未构建 | 检查 `node --version`；使用 Node >=24.9，执行安装及 `pnpm build`；便携 Node 不是克隆自带依赖 |
| 启动器安装 `EPERM` | 选择当前用户可写且已在 PATH 的目录，或继续用仓库启动器 |
| `QUOTA` / `ACCOUNT_QUOTA` | 检查 provider 余额、配额与模型权限；不能据此认定 MCP 不通 |
| `AUTH` / `RATE_LIMIT` | 检查凭据与端点，或等待限流恢复；不要在 Issue 粘贴密钥 |
| `CONFIG_NOT_FOUND` / `CONFIG_INVALID` | 单次命令从仓库根执行；检查模型/MCP/Skill YAML、环境引用与图片限制 |
| `MCP_CONNECTION_FAILED` | 检查独立 MCP Python、`cwd`、启动环境及服务端 stderr；普通与 managed profile 用途不同 |
| `MODEL_IMAGE_UNSUPPORTED` | 切换到声明图片输入的 profile，例如 `/model MainAgent` |
| `REFERENCE_CHANGED_RESELECT_REQUIRED` | 文件内容已变化，重新 `/open` 或 `@` 选择后再请求 |
| Tab 无补全或无颜色 | 检查是否 TTY、`TERM=dumb` 或 `NO_COLOR`；仅支持 VT 的终端可用 `TERM=xterm-256color`，`FORCE_COLOR=1` 显式开启颜色 |
| `/undo` 或 DWG `/open` 显示不可用 | 当前接口缺口，不是模型故障；不要通过扩大只读工具清单绕过 |

最近一次真实交互模型探测返回 `QUOTA`；离线多轮与 Windows 终端交互已验证，真实模型多轮成功仍待验收。历史测试结论与当前账户状态需分开判断。

<a id="updates"></a>

## 更新与反馈

源码更新后重新安装锁定依赖并构建，再启动终端：

```powershell
git pull --ff-only
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
```

Linux/macOS 将 `pnpm.cmd` 换为 `pnpm`。保留自己的 `.env`、`*.local.yaml` 与 `.cader/`；升级前处理本地 Git 变更，不使用强制覆盖。

在 [GitHub Issues](https://github.com/codesknight/Cader/issues) 反馈时提供 Cader/Node 版本、操作系统与终端、命令、脱敏 `errorCode` 和预期/实际行为；图片需明确允许公开后再上传。

CLI 功能变更须在同一提交中同步两种语言手册、帮助与示例；若行为不同，先修正文档或实现，再标记验收。[开发流程](../development/process.md)记录检查要求，未实现能力保留明确状态。


## v0.4 研发快照：执行事实、恢复与视觉反馈

`0.4.0-dev.1` 引入以下可靠性行为；当前 dev.2 的质量调度见下节，仍不是 v0.4 全量验收发布。

- `/mcp doctor`：通过实际查询诊断读能力，分别报告传输、缓存观察、工作图与冻结状态。当前COM可能惰性启动CAD，空文档时可能由后端创建默认图；不是独立的原生无副作用health接口。
- `/mcp recover`：仅在**同一原连接**收到明确写入成功响应、随后postflight读回失败时，重读并对账后恢复。结果未知、超时、重连、旧锁、截图未知均不自动解除，不重放写入。命令不会删除旧锁、关闭或重启AutoCAD。
- `cader_cad_health` / `cader_cad_recover`：模型可调用相同诊断/恢复能力。冻结后写工具从后续模型步骤移除；同批已排队请求返回 `blocked_not_dispatched`，不同于首个已派发操作的 `unknown`。
- 写入分别记录preflight、dispatch、acknowledgement、postflight、artifact verification。原MCP错误、HRESULT（可提取时）、调用/操作ID及异常栈留在私有执行JSONL。当前后端没有提供的COM线程ID、权威revision与MCP wire ID不伪造。
- 实体操作优先通过实际返回ObjectID调用get_entity核验，响应标记 `observation_scope=affected_entity`；它不是全图实体列表。文档级操作和显式最终查询仍读全图。健康状态里的全图数量是带时间戳的缓存。
- 三维多段线/填充要求每个点明确为有限的 `[x,y,z]`；不自动补零或展平错误点。非法参数在派发前拒绝且不冻结。
- 工具审计生成 `execution_evidence`；冻结强制 `ok=false` / `task_status=blocked`，即使模型本轮正常结束。终端显示确认操作数、未知数和未派发阻断数；操作数不是实体数。
- `cader_review_cad_view`：主Agent可导出本连接工作图的真实视图，并自动把图片附件交给视觉模型；不要求用户参考图或先存DWG。导出会改变视口/打印设置并写私有PNG，受现有权限及串行控制。默认每轮最多4次，配置 `max_visual_reviews_per_turn`（1–5）。当前后端未提供像素到CAD的权威映射；修改仍需查询实体坐标。真实导出已有超时失败记录，因此完整视觉纠错尚未验收。

显式实机入口（互斥，均会创建隔离草稿；后两种不以固定计划冒充模型推理）：

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --reliability
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --faults
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --visual
```

`--reliability` 是真实CAD确定性A/B/E复现，不调用模型；`--faults` 在真实CAD写入外注入客户端响应抑制/读回失败/取消，不冒充原生COM崩溃或真实网络丢包。`--visual` 使用付费真实模型自主绘制带缺陷房屋并请求视觉纠错；是否通过只看实际报告，不能以代码存在代替验收。

边界与失败证据见[本轮报告](../validation/2026-11-20-reliable-execution.md)。原Drawing8未知结果屏障仍保留；full-access和切换模型不能清除它。相邻MCP修补需另有授权，当前未修改。

CAD失败行现在直接显示错误码、阶段与“已派发/未派发”，完整异常留在私有JSONL。

冻结同时隐藏并阻止Agent Shell，即使full-access也不能经Shell绕开写屏障；用户主动!命令仍是独立逐条审批通道。

## dev.2：自主绘图质量任务

绘图、设计/生成图纸、重绘、示意图、布局及添加文字等请求会进入程序控制的质量任务。“能帮我画……吗”也按任务处理；“你能画什么”属于能力咨询。简单移动/旋转沿用工具后的确定性读回，不强制视觉往返。复杂图纸默认自动路由 VisionAgent，无需用户要求视觉检查或切换模型。

CLI 显示规划、绘制、几何验证、拓扑验证、视觉验证、修正和完成/待验证/阻断。模型提交不可中途修改的验收清单和组件绝对坐标布局，程序在绘图前拒绝组件重叠、内部端口及不存在的实体类型；随后查询实际 CAD 图元，检查支持的数量/标注、线段与包围盒交叉以及两端组件的串联闭环。电气任务自动加载 `electrical-quality` 知识，不提供固定绘图序列，也不扩张权限。

默认 ask 会审批具体任务计划及当前工作图。一次批准覆盖创建图层、绘图、视图检查和本任务新建实体的安全局部修正，累计最多3轮；本任务实体删除已在授权描述中明确列出。删除其他实体、保存/覆盖、文件及 Shell 操作仍按原策略处理。任务结束即撤销授权。`cader_apply_cad_patch` 可批量绘制/修改/删除；每项沿用原工具 schema、审批、串行写入和审计，首项失败停止，已确认项不得重放。

视觉报告用严格 schema 提交；最多一次格式修复复用同一图片，MainAgent 和 VisionAgent 默认输出上限均为8192。质量任务共享400次累计模型步骤、任务总工具/CAD/时间与用量限额；单轮100次工具额度可自动续期，4次视图评审及最多3轮质量修正不因续轮重置。普通非调度回合仍受100次工具上限约束。取消、格式无效、视觉未通过、未知实体引用、观察期间图元变化或疑似视图裁切均不能标为完成。非必要观察和程序已证明的几何精度不应充当视觉缺陷；无可定位缺陷但结论仍不确定时保留待验证，不推测性改图。

```text
画一个带有 5V 电源和一个灯泡的串联电路图。
/quality
/quality resume
```

这是输入示例，**不代表该完整实机案例已通过**。`/quality` 显示最新清单与证据路径；`resume` 在同一仍存活的 MCP 连接与工作图上重新查询/评审；渐进任务继续未完成区域，其他任务跳过原始绘图，不重置3轮上限。切换连接、退出或恢复普通会话后，旧连接身份失效，不能自动继承写权限；冻结仍须按 `/mcp recover` 的原有条件处理，`/quality resume` 不解除屏障。

私有 `quality.json`、`verification.json`、`events.jsonl` 及执行日志记录请求、阶段、每轮检查、视觉结果、image hash、查询状态摘要及失败。原生 `document_revision` 和 `pixel_to_cad` 当前均不可用，明确为 null；ObjectID 必须能在实际查询中找到，像素不能单独决定编辑。边缘像素检查只是保守的裁切提示，不证明图片完整。

显式实机入口（会调用付费模型并创建真实工作图，使用隔离工作目录）：

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality
```

该入口使用默认 MainAgent（当前 Flash）完成上述一个自然语言需求，由 Harness 自动调用 Flash 视觉，并先用真实发现的 schema 做漏参负向预检；审批回调仅授权 CAD 操作，不是人工终端按键验收。它不保存 DWG，也不测试任意电路、原生文档修订或像素映射。查看[真实结果、失败和未完成项](../validation/2026-11-20-autonomous-quality.md)。

## dev.3：参数拒绝、诊断与恢复显示

直接CAD调用与程序MCP客户端在发送前执行schema校验；批量补丁先验证整个批次的schema，再执行任何一项。缺少height等必填项、类型/枚举/嵌套不符会明确显示`TOOL_ARGUMENTS_INVALID`或`CAD_FAILED_BEFORE_DISPATCH`、`preflight`、`未派发`，不会因此冻结。程序不替模型填默认值、不强制转换参数；Agent可以纠参后重新提交未执行的请求。补丁不是原子事务：后续权限/原生执行失败时，已经确认的项仍可能保留，禁止整批盲目重放。

远端isError、超时、丢响应不能仅凭“validation”等报错文字认定无副作用。没有成功确认的写入仍unknown/frozen；只允许既有同连接、已确认写入后的postflight读回恢复。本次不会自动清理旧版本的Drawing6或任何持久unknown锁。

状态新增`counts_scope`、`operation_mark`、`session_counts`、`freeze_operation`/`freeze_evidence`、`recovery.eligible/reason`及`cad_observation.stale_due_to_mutations`。CLI尾行明确区分本轮与会话累计；重开进程后历史屏障不计入新会话计数，仍会显示其来源及首发错误。缓存值过时或过滤查询为空不能证明全图为空，COM生命周期空字段也不能证明断连。

```text
为什么阻塞了
为何冻结
查看冻结原因
恢复
/mcp recover
```

上述自然诊断/恢复短语由程序处理，不调用模型；受限恢复不成功会明确显示“未恢复”及资格原因。模型调用恢复工具返回`recovered:false`时也不再显示成功勾号。冻结期间受控查询仍可用，重连/重启不会赋予旧文档权限。已经流式显示的回答只追加程序状态，失败时不再重打全文。

原连接已关闭或更换时，恢复原因是`ORIGINAL_CONNECTION_REQUIRED`；连接仍在但派发未获确认时是`DISPATCH_OUTCOME_UNCONFIRMED`。两者都不能通过重复恢复来放行写入。

本次真实Flash/AutoCAD验证已越过文字绘制并进入自动视觉，缺参负向预检未派发、未冻结；完整电路仍因疑似导出裁切和计划约束未通过。详见[dev.3修复与实际结果](../validation/2026-11-20-schema-preflight-fix.md)。

## dev.4：历史缺参屏障复核

启动时即读取工作区屏障并显示冻结原因，包括没有配置MCP的情况。已知冻结的绘图质量任务直接进入`blocked`，不再先付费调用模型生成计划；报告记录`model_run_status: not_started`。`run_status: succeeded`仅表示程序处理完成，业务仍为`ok: false`、`task_status: blocked`。本轮确认0不能推翻历史屏障。

旧版缺height记录不会因升级而自动消失。先退出仍在运行的旧Cader会话，在使用原工作目录的新会话中输入：

```text
/mcp barrier
/mcp resolve
```

需先选择原MCP配置。程序把原始缺参错误、请求、目标图、日志和当前schema关联核对；已确认写入、超时、截图、原生错误、证据变化或另一原写入进程仍活跃均拒绝。`eligible: true`只表示可人工复核，**不证明CAD未执行**。即使`full-access`也必须确认：原请求未执行、已结束且无运行中或延迟操作。无法确认时回答否，保留屏障；不要手动删锁。该入口不是通用reset，Agent没有对应工具。

用户审定后，原始unknown屏障、日志快照及带hash的决定记录保存到工作区`.cader/barriers/`，不修改旧unknown、不重放、不接管原图。程序关闭当前连接并丢弃任务授权及文档绑定；重新发送任务时必须新建工作图。`/quality resume`不能续接旧任务。复核互斥锁或文件读写失败均阻断；不自动清理崩溃遗留的复核锁。

Drawing6实际记录已用真实MCP schema完成只读复核，原屏障保持不变；真实用户批准归档及完整新绘图未代替用户执行。详见[诊断与边界](../validation/2026-11-21-legacy-barrier-review.md)。

## dev.5：减少可避免的写入屏障

指定图层的写入在派发前实时查询`list_layers`。图层不存在、无法查询或返回无效数据时，本次修改不发送，记为`failed_before_dispatch`，不冻结；Agent会收到先`create_layer`再提交未执行项的明确反馈。程序不会偷偷创建图层或重复已提交的批次。补丁失败结果新增`not_dispatched`索引列表，已确认项不得重放。

原生执行失败仍可能留下部分实体。工具结果及最终CLI会显示首发原生错误；若没有可信的执行终态，仍保留屏障。相邻AutoCAD-MCP本轮增加创建前图层检查及仅清理本次新建实体的防护；这是尽力清理，不是事务证明，清理失败/丢回执仍须保留现场。旧Drawing2的部分执行屏障不会被升级自动清除，`/mcp resolve`也不适用于它。

本轮MCP导出同时改为前台打印、显式fit-to-page及完整打印设置恢复，拒绝覆盖已有输出。减少背景任务延迟触发的截图冻结；未知导出异常仍不会自动重打或宣称完成。需重启Cader使其MCP子进程加载更新。

规划模型失败现在进入`blocked`并记录`quality.failure`与规划`model_runs`，明确显示QUOTA等原因及“尚未允许绘图”；不再笼统显示质量待验证。没提交有效计划显示`ACCEPTANCE_PLAN_MISSING`。QUOTA只表示服务侧配额/访问拒绝分类，不足以单独断言余额不足。

可通过显式实机入口重跑任意质量任务（付费模型、真实CAD；默认任务仍为串联电路）：

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task "新建一张空白图纸，绘制一个房子，旁边有棵树。"
```

`--task`仅随`--quality`接受；其它smoke模式仍拒绝。测试入口给模型自然语言需求，不提交固定操作序列。实测、失败及未解决边界见[依赖预检与部分执行报告](../validation/2026-11-21-dependency-and-partial-execution.md)。

旧任务已经部分执行而被冻结时，不要使用缺参复核来强行续写旧图。需要保留现场并开始独立新任务时，可从Cader源码目录使用新的工程工作区（不复用旧图或重放旧请求）：

```powershell
New-Item -ItemType Directory -Force .cader/workspaces/new-task
cader chat --workspace .cader/workspaces/new-task
```

此工作区仍默认ask、必须新建工作图，并受相同写屏障保护；新建工作区不代表旧操作已对账或旧图质量已通过。

## dev.6：手稿到新图与DWG

显式图片路径会注册实际像素，不再要求GUI上传；“复现/临摹/重绘”进入质量任务。阶段新增“读取手稿”和“保存DWG”。Agent可用 `cader_open_image` 打开工作区PNG/JPEG并获取裁图工具；文本Read不等于图片语义读取。程序要求本任务新建图、确认几何、原图哈希及目标文件一致，不能把旧图评审当重绘结果。

MainAgent/VisionAgent默认最多8192输出token，仍受总预算和一次格式修复限制。计划禁止的穿组件导线在派发前拒绝；视觉报告的不存在实体ID要求模型纠正。模型在绘制/修正阶段失败时，若本任务已有确认几何、未冻结、未取消且仍满足文件保护条件，程序尝试保存待验稿；保留QUOTA等首发失败，绝不因此标为完成。冻结/取消/没有几何时不自动保存或重放。

真实手稿运行已生成并独立重开DWG，但完整质量仍有未通过条件；[证据及已知问题](../validation/2026-11-21-reference-redraw-fix.md)。重启CLI后 `cader -v` 应显示dev.6；MCP子进程也需重启加载截图边距修复。

## dev.7：完整质量复验与标注保护

原图观察后，程序对最多4个标注区域附带实际裁图重新读取；清晰标注必须保留在计划文字检查中，不能替换数值或SI前缀。仍不确定时会绘图并保存待验稿，保持待验证，不猜测标注后宣称完成。这一复核只用于有标注的参考图，不增加简单移动任务的视觉调用。

文字检查忽略排版空白及兼容字形，支持数学负号与普通短横的规范化，但完整核对标注、保留SI大小写并检查数量；`5V`不等于`15V`，`m`不等于`M`。视觉清单必须使用程序提供的验收ID各一次，错误会返回模型纠正。

拓扑失败证据新增断点坐标、度数、导线ID、最近端点距离、组件边界与未支持实体。当前串联验证需要导线图层使用`AcDbLine`；该MCP未提供多段线/圆弧导线端点，程序会在创建前提示改用线段，符号层仍可使用这些图元。未请求保存的普通绘图任务不能凭空增加保存验收项。

普通组件绘图未指定总线段数时，也不能自设总线段数量硬上限。视觉总评“不确定”必须关联具体未通过的必要项；全部清单通过却只提出无关不确定性时，程序要求有限重报，不直接改为通过。更新日期：2026-11-22；本地手稿和电源/灯泡两例真实通过，仍不保证任意图纸质量。

主模型默认`reasoning_effort: low`，视觉模型仍为`off`；输出、步骤、工具与修正上限不变。MainAgent模型YAML可调整；有界推理仍会产生服务费用，不保证每张图都通过。重启后 `cader -v` 应显示dev.7。[真实复验及限制](../validation/2026-11-21-complete-quality-retest.md)。

## dev.9：原生新图与有界恢复（2026-11-23）

配套AutoCAD-MCP连接不再隐式造图；新建前只读解析Documents.Add的方法标识并有界等待，实际创建仅一次，绑定须确认新增文档。旧活动图不等于新建成功。

新MCP的new_drawing可接收request_id用于关联，不代表幂等或重放权限；成功图纸名兼容。Cader自动使用操作ID，只有完整且匹配的结构化证据证明native_invoked=false、无隐式创建，才避免冻结，界面显示“MCP已送达，原生未调用”。旧文本、请求不符、原生调用后的异常/超时继续冻结。

主动视觉返回后主Agent立即交回Scheduler，程序继续核验与最多3轮修正。单次模型API超时不变；受调度主回合使用既有任务总时限（默认600秒），避免绘图耗时将子视觉提前取消。子视觉时限、步骤/工具预算与用户取消仍有效。

规划或确认遇截断、格式损坏或模型响应超时时仅紧凑重试一次，不执行CAD、不重试QUOTA。普通插画可不声明连接端口；模型自定、用户未要求的图元上限被拒。视觉格式异常/截断可用同图修复一次；只有当前必要验收全部通过，才关联此前失败视觉尝试的替代结果，原失败日志保留。主模型失败或未通过条件不能被隐藏。

旧unknown屏障不追溯解除。退出旧CLI后在新工作区启动新任务以加载新MCP；recover/resolve不能审定旧Add未知结果，新目录也不表示旧操作已确认或旧图被接管。`cader -v`应显示dev.9。见[修复与分层实测](../validation/2026-11-23-native-document-create-fix.md)。

## dev.8：能力目录、主动视觉与任务证据（2026-11-23）

主Agent每步收到按当前角色/阶段装配的统一能力目录：工具、子Agent与Skills包含用途、触发条件、输入/输出、调用入口、可用状态及不可用原因。工具输入引用该步实际函数schema，目录按DSH本步toolSet投影；目录存在不代表写入已获批准。模型角色配置支持可选description/when_to_use，技能目录支持可选when_to_use。技能仍只从显式catalog注册，正文与资源按需读取，不授予权限。

主Agent可自主调用 `cader_review_cad_view`。质量任务将它路由到Harness受控入口，以封存需求和实际CAD查询绑定评审；主Agent漏调用时Harness补验，不能仅凭模型回答完成。有效报告在同一任务、连接、文档、写入记录、实体快照与参考图一致时复用，不再重复截图；修改后重新验证。复用不是原生revision证明，不跨任务、进程或恢复继承。裁切、无效/取消报告、观察变化及未知写入继续阻断验收。

动态 `task_state` 包含阶段、原始需求、视觉调用次数、最近报告/图像hash、检查结果和未通过原因。`/quality` 同样显示这些证据；历史证据不代表当前实时图纸。CLI显示“Agent主动调用 / Harness验收”“第N次 / 复用有效报告”；无参考图时显示“视觉验证”。

```text
每次绘图都做视觉检查。
是否使用了视觉验证？
继续
以后按需做视觉检查。
```

第一句保存会话视觉偏好（恢复会话后保留），不创建验收计划或调用CAD。第二句读取已保存任务证据，不调用模型猜历史或重复截图。第三句在原连接/图纸身份仍有效且已有封存计划时安全重验，不重放原绘图；已完成则不重复执行。第四句恢复按任务复杂度检查，必要视觉验收仍强制。规则说明不能关闭强制验收、扩张权限或清除屏障；不明确的继续请求不会猜测并重放旧写入。

静态MainAgent提示词仅保留稳定统筹和权限/证据规则，CAD工作流迁入注册 `cad-execution` Skill；视觉角色使用独立提示词。无参考图的新建任务不要求源图。已绑定本仓库的本地启动器在 `pnpm build` 后重启即可更新，`cader -v` 应显示dev.8。单个真实房子/树用例已验证主动视觉及兜底复用；不代表任意手稿、DWG保存或全部v0.4验收通过，详见[实施与测试](../validation/2026-11-23-capability-routing.md)。

恢复仅向模型发送最近8项操作记录，完整审计继续保存。完成一个单元不重置共享Token、时间、步骤或执行轮预算。

Scheduler在每个绘图单元开始时提供实际几何/文字读回。标注确认候选原文来自实际请求，索引和值仍由模型选择、程序核对。终端区分单元恢复额度与任务累计次数。

视觉报告不能在全部必要条件通过时仍给整体uncertain，即使列有minor建议。模型必须指出具体受影响的必要条件或重新提交一致报告；同图有限格式修复不会由程序把不确定直接改成通过。

## 长对话与用户核对：当前行为

当前不会在对话上限自动压缩并新开会话。可见文字估算超过20000（不含图片/工具）或当前输入超过24000字符会提示手动`/compact`或`/clear`；消息超过1900或会话状态超过1600000字节会提示`/clear`。这些守卫不等于服务商真实上下文容量。`/compact`关闭工具并保留原对话；`/clear`结束当前执行对象，不能用来无缝继承原图写授权。工具预算自动续轮与聊天上下文压缩是两套机制，任务总限额不自动归零。

工具审批的y/N不是对原图标注/连接的事实确认。当前可绑定实际原文确认，但尚无完善的结构化待答清单、批量主动提问和答复续跑管理；必要歧义仍不能报完成。本轮提出的稳定源事实、主动澄清及安全自动压缩方案为待实现功能，详见[工程复盘](../development/2026-11-25-complex-redraw-engineering-review.md)。

内部单元/恢复/续轮调用使用新的DSH模型session并注入结构化任务状态与读回；它不同于用户ChatSession达到上限后自动摘要或分卷，也不改变原生CAD绑定与任务总预算。
