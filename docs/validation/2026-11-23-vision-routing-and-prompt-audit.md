# 视觉调用、提示词与动态能力审计

2026-11-23；关联#20；来源：用户14:06–14:09房子/树日志及“参考Gemini CLI动态暴露工具、subagent、skills”建议。只读核对实际quality/events、截图与当前main源码，查阅Gemini CLI官方实现；本记录是审计及待实施方案，不冒充代码修复。未启动模型或CAD、未改变图纸/权限/屏障。

## 已证实事实

- 初轮14:07:35–14:07:42已有vision子任务及cader_submit_visual_report，真实quality.json含round0报告、图像hash与1600×1280图像证据；视觉verdict=pass，三个视觉条件均pass，另有minor构图建议。Harness因possible_clipping=true拒绝完成，非“没有视觉调用”。程序记录边缘前景2274像素。
- 后续主Agent回答“此前没有视觉审查”与以上证据矛盾；14:08再次调用cader_review_cad_view不证明前次没有调用。当前会话主要回填report.text，Available.execution_state缺少任务视觉历史，私有quality.json又不能由普通文件工具任意读取，导致能力与证据断层。不能把模型回忆当审计。
- 用户“每次绘制都应该启动视觉验证”被requiresQuality关键词规则误识别为新绘图请求。四次提交均SOURCE_QUOTE_MUST_BE_FROM_ORIGINAL_REQUEST，最终ACCEPTANCE_PLAN_MISSING；不是CAD失败。
- 当前capture PNG肉眼可见大片空白、边框和底部贴边，不能取消裁切门槛硬放行。新建文档初始ModelSpace实体0；布局/打印空间或模板配置是待证假设，捕获时ActiveLayout.ModelType并未留证，不能已断言纸空间是根因。

## 当前提示词与能力装配

| 层 | 实际实现 | 缺口 |
|---|---|---|
| Static | configs/prompts/static/MainAgent.md；子Agent含vision均读SubAgent.md | 统筹、权限、恢复、业务/布局知识混杂；无独立视觉静态角色资源 |
| Available | live.ts逐步装配角色/模型、实际工具名称、skills目录、预算、worker_profiles、图片引用、权限、execution_state | 子Agent缺description/触发条件；缺当前质量阶段、调度归属、最近视觉证据；可列worker但委派工具不可调用 |
| Tool definitions | 经DSH Tool Registry、prompt.tools向模型提供实际description及schema | 不能误认为只有Available的名称清单；需与阶段过滤共享同一事实源 |
| Skills | catalog.yaml显式注册名称/description/roles/resources，cader_load_skill按需读取 | 部分已有渐进加载；planning的onlyTools会排除skill加载入口 |
| Quality routing | task.ts显式隐藏delegate/review；quality.ts绘图指令要求不调用视觉，随后直接runtime.reviewCadView | 强制门槛有效但主Agent看不到完整执行历史/归属解释；通用自主路由与质量流程分裂 |

相关代码：packages/dsh-adapter/src/live.ts的setup、cader:available及reviewCadView；packages/profile/src/task.ts的toolAvailable；quality.ts的requiresQuality/act/review循环；interactive.ts的会话回填；terminal.ts仅对部分事件渲染。

## Gemini CLI官方参考（仅结构参考，未复制代码或提示词）

- https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/prompts/promptProvider.ts ：从Registry收集工具、技能和子Agent，按可用委派工具决定是否装配子Agent目录。
- https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/prompts/snippets.ts ：基础规则、工作流程、Available Sub-Agents与Available Agent Skills分节；目录包含name/description以及调用入口。
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md ：先发现name/description，再按需activate读取正文与资源。其扫描/授权策略不直接替换Cader显式catalog规则。

## 待实施设计

1. 统一能力注册与阶段投影：工具schema/description、技能及子Agent目录来自同一注册源。描述包含用途、何时调用、输入输出、限制、调用入口及当前是否可调用；不可用给出阶段/权限/冻结原因。不伪造可调用工具。
2. 主Agent能调用受控视觉入口；入口复用Scheduler/captureView/reviewCadView，检查文档、权限、预算及证据时效。绘制后Agent主动触发，漏调用时Harness补做/拒绝完成；同一文档与状态有效结果复用，避免重复截图。不开放绕过串行写/验收的裸委派。
3. 动态注入Task State：task_id、阶段、原始要求、geometry/topology/vision状态、调用次数、最新图像hash、结果、待验原因、证据ID和授权范围。新增只读任务状态查询或等价受控数据入口，回填到主Agent会话与最终报告。
4. 角色及流程分开：稳定规则保持简洁，Vision职责/输出schema独立装配；Skill先目录后正文。当前阶段无需的描述不堆入主提示词；明确无参考图的新建任务不需要Image A。
5. 意图路由区分执行、质量询问、策略偏好、继续/恢复。将“以后绘图都做视觉检查”作为质量偏好，不能创建新验收计划；询问已有视觉状态先查Task State，不重复调用并猜测过去。
6. CLI明确显示“VisionAgent自动检查/Agent请求检查”、次数/报告有效性/结论/阻塞原因；无源图时不显示“源图对照”。截图捕获补布局、ModelType、范围、视口/媒介等证据后处理视图故障，不能用修改图元掩盖捕获缺陷。

后续回归应覆盖上述真实三句输入、实际模型请求内的能力描述与phase过滤、历史视觉状态准确回答、策略输入不触发绘图、主动/兜底调用不重复、裁切仍待验及未知写入继续冻结。保留DSH/Cordis，不新建AgentLoop或多Agent平台。本次尚未实施这些改动，既有94测试不证明它们已修复。

后续状态（2026-11-23）：用户授权五项方案后已实施dev.8并完成两轮真实绘图验证。上文“未实施”为审计时记录，具体代码、回归、真实证据及限制见[实施与测试](2026-11-23-capability-routing.md)。
