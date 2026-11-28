# 模型服务中断后的源任务检查点对账

REQ-053 / BUG122 / [#20](https://github.com/codesknight/Cader/issues/20)。原始整图 attempt17 在 2982 个已验证源项、另 32 个已确认待验图元时，视觉服务返回 `QUOTA`。服务端不可用已通过官方只读诊断核实；不把外部服务拒绝当成 CAD 写入未知。用户随后确认服务恢复，仍需程序核验后续跑。

## 已证实的程序缺口

provider 故障被共用的 `assertSource` 写入/模型门禁阻止了只读 checkpoint，连保存后的读回也被拒绝。DWG 已经完成独立只读重开，质量状态却将 `QUOTA` 改标为 saving / verification。检查点只记 2985 个确认操作，实际确认账本已有 3018 个（32 个源绘图操作＋1 次保存的后缀）；直接重验会误报 `PROGRESSIVE_CHECKPOINT_CHANGED` 或 `PROGRESSIVE_LEDGER_CHANGED`。

原 writer 仍存活且显式暂停，同一独立测试实例的新鲜 Native 3014 实体与确认账本完全相等，源几何逐项 3014/3014 通过、没有额外实体。旧检查点 hash 确实滞后，不能简单忽略 hash 差异，也不能把视觉待验项改成通过。

## 修复

- provider 故障继续禁止模型/写入，但允许原 owner 做只读 checkpoint。源图 hash、文档/连接、frozen、取消和持久化门禁仍严格执行。保存后原生读回不会再被旧 `QUOTA` 误认为保存失败。
- provider 失败暂停前，持久化完整新鲜原生事实和确认操作清单。只读失败则记录未完成条件，不合成检查点。
- 兼容已有滞后暂停记录：仍须原连接和原 owner；仅在 provider 中断且旧确认清单是当前确认账本的精确前缀时，核对冻结源索引、后缀每个绘图请求的原始参数指纹、源 ID / 操作 ID / Native ID 一一绑定，再独立检查全图所有已确认源几何。只允许已确认源 polyline/text 创建及无新实体的保存后缀；未知、删除、额外实体、几何变化、改参或改写前缀均拒绝。非 provider 的外部变化继续走原严格失败路径。
- 对账只更新原生 checkpoint 和操作前缀，记录旧 hash 和对账证据；不会改变工作清单视觉状态、模型报告、质量通过位或权限，也不赋予新连接旧图写权。

## 测试与旧运行迁移边界

`pnpm typecheck`、`pnpm test` **431/431**、`pnpm smoke`通过。新增真实 Harness 调度夹具验证合法源后缀恢复、跨连接、unknown 和 Native 改变拒绝；完整几何、参数/ID、前缀、额外实体及破坏性操作负例；provider 失败后 checkpoint 必须包含实际确认前缀。它们是离线夹具，未冒充真实模型或 CAD。开发中发现 QualityResume 缺 failure 类型、闭包状态的 TS 收窄和测试参数隐式 any，均已修正，原失败日志保留。

attempt17 的主驱动已经加载 `e180c7d`，不是热更新后的新 Harness。因此旧活跃运行需要使用同一生产校验器做一次有记录的状态迁移，不能宣称它天然经过了新的自动恢复分支。迁移前保存原质量文件的完整字节及 SHA256，新鲜 Native 证据、原 writer/连接/源身份、确定确认后缀和新旧检查点均记录。仅迁移 checkpoint，`quality_accepted=false`、2982 verified / 32 committed / 606 pending 及原 `QUOTA` 保持；不调用模型、不派发 CAD、不关闭图纸、不接管旧连接。原 owner 下一次 `/quality resume` 仍须独立新鲜读回和严格账本比对，迁移本身不保证续跑或整图验收通过。

原始失败和一切后续结果分别保留。私有证据位于 `.cader/runs/source-worklist-20261127/`：`pause-checkpoint17.json`、`pause-fresh-native17.json`；受控迁移原快照和回执记录为 `pause-original-quality17.json`、`pause-migration17.json`。正式全图验收和最终 DWG 结果待实际完成补记。
