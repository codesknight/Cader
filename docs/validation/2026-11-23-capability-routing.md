# 2026-11-23：能力目录、任务状态与统一视觉入口

工作项：REQ-037 / [#20](https://github.com/codesknight/Cader/issues/20)，Milestone 3。基于[先前审计](2026-11-23-vision-routing-and-prompt-audit.md)及用户明确五项实施要求。dev.8，保留DSH/Cordis/独立AutoCAD-MCP，不修改相邻仓库。

## 实施

- `dsh-adapter/capabilities.ts`从实际工具描述/schema、已注册Skill目录及模型profile生成统一目录；每类含用途、触发条件、输入输出/入口及当前状态。关键修复：Available采用本步assembly.toolSet，而非未过滤的schemas(agent)。隐藏函数不再被目录宣称可用；失效时执行guard仍拒绝。
- 主Agent可请求受控review，质量Scheduler将请求与兜底调用导向同一控制器。使用封存需求/真实查询，不接受模型自换验收条件。任务内一致证据复用，修改、连接/图纸、完整实体或原图变化使其失效。同步请求合并；无效/取消/裁切/观察变化仍不能完成。无原生revision，不跨任务或恢复继承cache。
- 每步动态task_state含原需求/阶段、几何/拓扑检查、视觉尝试次数、报告及image hash、未通过原因、写后需重验提示；质量结果也写入verification。视觉尝试/结果随manifest保留，取消/失败不冒充未调用。
- 规则偏好不建计划；视觉历史询问只读已保存证据。通用继续重验封存计划，原连接/文档不匹配仍拒绝，不重放。偏好会话保存，支持always及按需auto，不能通过自然语言关闭必要验收。
- MainAgent静态规则精简，CAD工作流迁入注册cad-execution Skill，Vision独立角色提示词；资料仍为数据，不授予工具或权限。CLI区分主动/兜底/复用，无参考图不再标“源图对照”。双语手册及帮助同步。

## 实际验证

组件/确定性模型：定向27项通过（质量调度、实际DSH请求、会话路由、Skills）。主动review与兜底复用只产生一次capture；写入后第二次；疑似裁切仍pending；模型篡改review问题不能替换封存条件；原连接不符拒绝resume；政策及历史询问不运行模型/CAD。后续全量结果追加。

真实命令：

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task "新建一张空白图纸，绘制一个房子，旁边有棵树。"
```

真实MainAgent/Flash在已有AutoCAD进程中自主选工具和多轮执行，没有固定绘图序列。结果complete，6/6必要条件pass，21确认/0unknown，10次模型步骤，1次VisionAgent、1张1600×1280真实PNG。task.visual事件明确先source=agent,reused=false,review_valid=true,verdict=pass；随后source=harness,reused=true，没有第二张截图。截图hash为dd06e7cd64b125a65b969a88363a9747c1b5e5b523461c590496eb9a8760bd08，possible_clipping=false。独立人工查看实际PNG可辨房子、树及间隔，本例未指定DWG保存，不计作文件交付验收。

原始轨迹仅私有保存：`.cader/runs/quality-52ad3299-76cf-400d-9ae1-b973e4f85a9b/`。首次计划内部端口、擅自保存门槛两次被拒后模型纠正；批量末项因list_layers只读COM拒绝而未派发，模型仅补该圆，未重放已确认项。含显式缺参schema负测，failed_before_dispatch累计2，不冻结。旧unknown屏障未改。

## 失败与限制

首次全量96例出现2项失败：新增Skill改变目录数量；旧调度fixture未模拟修正后写入变化，使新缓存正确地复用失败证据。修正fixture为真实状态转换，未为通过测试降低门槛。次轮98例又发现目录将注册但未获本步准入的delegate标为可用，以及fixture旧计划缺字段；改为本步toolSet，并容忍旧证据摘要缺字段，定向27通过。失败原始输出保留于本次开发轨迹，不抹去。

真实规划仍要求双端口的通用组件可能过约束；一次COM只读busy已安全处理，不能据此承诺没有所有COM错误。意图路由是保守规则，不是通用语言理解；混合/不明确需求可能需要用户明确任务。原生文档revision与像素映射不可用，人工外部操作与原生不可观测状态不能靠hash证明。先前capture_bounds失败保留，不能把本次成功当作捕获问题已全面根治。#20及整个v0.4验收继续打开。

## 最终dev.8复验

最终代码补齐不可由模型删除的视觉验收条件，并修复task.visual进度不能覆盖task.phase（否则修正阶段的新建禁令可能失效）；新增调度回归证实主动检查前后new_drawing仍不可用。实际 `pnpm typecheck`、`pnpm test` **100/100**、`pnpm smoke` 通过。`python .cader/check-cli-manual.py --links-only` 通过（2语言、17 slash roots、11单命令族、140链接、22锚点）；`git diff --check`通过。本机已安装启动器执行 `cader -v` 输出0.4.0-dev.8。

最终同一自然语言命令再次真实执行：`.cader/runs/quality-703e892a-faf3-4df4-bc1f-8aa9591f08e1/`，**complete、6/6、20确认/0unknown、8模型步骤、0轮修正、1次Vision/1张截图**；主动调用后Harness复用通过结果。图像hash为90f3e78234be2f0baec3c252eb519c30ede1a5bcb859f3fbd441d02f410f0a32，1600×1280，边缘前景像素0、possible_clipping=false；再次独立查看实际PNG可辨房子和旁边的树。两次计划提交分别因version和未请求的保存被拒，模型自行纠正后开始绘图；唯一failed_before_dispatch是smoke的显式缺参负测，无真实绘图工具错误。仍未请求保存，不计DWG交付。

远端commit/CI状态将在实际运行后追加，未通过前不称远端完成。

远端交付（2026-11-23）：实现提交 `ab6c6b9` 已普通推送至 `codex/capability-vision-routing`，审阅入口 [PR #22](https://github.com/codesknight/Cader/pull/22)（草稿，未合并）。实现提交的 [CI 45127926273](https://github.com/codesknight/Cader/actions/runs/45127926273) 四项均成功：Windows/Ubuntu DSH与Python MCP。该记录后的文档提交不改执行代码，最新PR检查在交付时另核对；#20/Milestone 3保持打开。
