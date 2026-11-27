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
