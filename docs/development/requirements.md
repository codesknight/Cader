# 需求与验收记录

| ID | 来源 | 需求 | 状态与验收 |
|---|---|---|---|
| REQ-001 | 首次用户请求、v0.1 设计 | 新建并维护 Cader，优先调研、Harness 选型与 smoke | 初始化已交付；实机稳定性仍由 CADER-003 跟踪 |
| REQ-002 | 本轮用户明确选择、v0.2 设计 | Harness 确定为 DeepSeek Harness + Cordis | 已落实当前代码、依赖和 ADR；完整 app / 真模型门槛保持待验证 |
| REQ-003 | 本轮用户请求 | 持续记录需求、开发、测试、Bug 排查，可用 GitHub 开发面板 | 已建立目录、模板、AGENTS 约束、Issue/Milestone；后续每轮执行 |

## 当前实施范围

建立 TS / Python workspace、一个实际 DSH 组件与插件 smoke、迁移已有 MCP 工具、
更新 CI 与过程记录。保留旧设计和 Deep Agents spike 的 Git 历史。

后续验收仍包括完整 DSH Headless profile、真实模型 + 官方 MCP client、实际 CAD 图像、
工作副本写入/保存/独立验证和 G01–G10。Web 已按本轮 CLI First 请求后置。
原设计中的目标目录及 API 不代表已经实现。

## GitHub 验收入口

- [M0 里程碑](https://github.com/codesknight/Cader/milestone/1)
- [CADER-001：本轮 workspace / 组件 CI](https://github.com/codesknight/Cader/issues/5)
- [REQ-003：持续过程记录机制](https://github.com/codesknight/Cader/issues/6)
- [CADER-004：完整 DSH app / 模型 / MCP](https://github.com/codesknight/Cader/issues/2)

本轮 #5 / #6 的验收依据为 `ce7e9ce` 与上述远端 CI；REQ-003 的持续维护要求继续有效。

## 2026-11-19：提示词、子任务树与模型配置

| ID | 来源 | 需求与状态 |
|---|---|---|
| REQ-004 | 用户两部分提示词与 subagent 方案 | Static / Available；只有主 Agent 委派，子 Agent 不互调，最多并行 5 个；本轮实现并通过 fixture 与真实两子任务验证 |
| REQ-005 | 用户模型 API 与 YAML 配置请求 | config/models、根 .env、Main Flash / Sub Pro，连接 AutoCAD-MCP 实测；以额外 Flash VisionAgent 修正 Pro 无视觉能力，真实 7 项检查通过 |

跟踪 [CADER-005 / #7](https://github.com/codesknight/Cader/issues/7)，决策见 ADR 0002。

## 2026-11-19：配置整理与 CLI First

| ID | 来源 | 需求与验收 |
|---|---|---|
| REQ-006 | 用户本轮明确要求 | 合并 config/configs；模型、MCP、运行配置、prompts、skills 统一到 configs/；加载器、命令、忽略规则和测试同步；保留本机配置 |
| REQ-007 | 用户本轮 CLI First 请求、CLI 设计稿 | 先复用 DSH Headless / 验证社区 TUI → Cader CLI → Web / CAD 内嵌；原稿作为分阶段需求，不将建议等同已实施功能 |

本轮范围是目录迁移、当前代码的回归验证、ADR 和路线及 GitHub 工作项。
跟踪 [CADER-006 / #8](https://github.com/codesknight/Cader/issues/8)；社区 TUI 兼容性
由 [CLI-001 / #9](https://github.com/codesknight/Cader/issues/9) 验收，可安装 CLI 基础
由 [CLI-002 / #10](https://github.com/codesknight/Cader/issues/10) 验收。
REQ-005 中 config/models 是历史来源，本轮统一迁到 configs/models。
实际 CLI 命令、会话恢复和社区 TUI 接入保持待实施；原设计文件不改写。

REQ-006 目录迁移及 REQ-007 路线决策已由 `08da13b` 和 4/4 Windows/Linux CI 验收；
REQ-007 的产品阶段按 #9、#10 及 roadmap 继续实施。

## 2026-11-19：双语 README 与封面

| ID | 来源 | 需求与验收 |
|---|---|---|
| REQ-008 | 用户要求专业、美观的 README，中英文切换、封面、说明与 Quick Start | README.md / README.zh-CN.md 双向链接；共用封面；提供定位、已实现能力、环境、可执行入门命令、配置、路线与文档；链接、命令等价与页面显示检查 |

跟踪 [CADER-008 / #11](https://github.com/codesknight/Cader/issues/11)。本轮仅文档与资源，
不扩展运行时能力；原始设计文件、真实凭据与本机配置不修改。

## 2026-11-19：AutoCAD-MCP 开发方反馈

来源：用户转交的四点反馈，后续明确继续完善 CLI、暂不调研外部 CAD Skill。

| ID | 需求 | 实施与验收 |
|---|---|---|
| REQ-009 | 提供自然语言 exec，固定 smoke 与绘图能力分开 | 本轮新增只读用户任务入口；不是绘图；接收任务、参数校验与隔离 fixture |
| REQ-010 | 完整受控写入契约 | [#3](https://github.com/codesknight/Cader/issues/3) 保持打开；新建工作图、文档/实例/revision 绑定、授权与未知结果对账，见 architecture/controlled-writes.md |
| REQ-011 | CLI 汇总 provider 根因，避免混淆 MCP 故障 | QUOTA/errorCode/source/hint 汇总至终态与 verification；主因不被清理失败覆盖，实际 DSH 故障注入 |
| REQ-012 | Windows JSON 编码稳定 | Python CLI stdout/stderr 显式 UTF-8；GB18030 环境下中文重定向与参数错误测试 |

本轮工作项 [CADER-009 / #12](https://github.com/codesknight/Cader/issues/12)。未新增绘图白名单，未修改 AutoCAD-MCP，未调用真实付费模型或 CAD。

## 2026-11-19：上游 Redraw Skills 调研后接入

来源：用户重新要求深入分析上游 CAD Skill，再修改项目和更新 README；此前暂不处理的要求被本次指令取代。
跟踪 [CADER-011 / #13](https://github.com/codesknight/Cader/issues/13)。

| ID | 需求 | 验收范围 |
|---|---|---|
| REQ-013 | 先调研再实施，结合 Cader 框架 | 固定 ed182ec 快照、审查工作流/脚本/依赖/许可与副作用，研究报告和 ADR 0004 先于代码 |
| REQ-014 | 项目内可用的 Skill 接入 | Cader 独立编写重绘评估指引；共享显式清单、角色/资源加载、CLI list/show，拒绝脚本/越界/未注册目录 |
| REQ-015 | 可体验的图片评估与文档升级 | exec --skill / --image、PNG 输入预检、DSH 离线附件/资源链路测试、中英文 README 与使用指南 |

上游固定版本没有明确 LICENSE，故不复制分发其文件；本轮没有安装 Codex 主机 Skill。
这是自有评估工作流与加载机制接入，不是完整 DWG/PDF/DXF 重绘移植；确定性 verifier 和受控绘图分别继续在 #4/#3 验收。

## 2026-11-19：用户本地图片绘图测试

REQ-016：用户提供 tests/images，要求进行绘图能力测试；关联 [#14](https://github.com/codesknight/Cader/issues/14) 与受控写入 #3。
本轮已执行16文件盘点、14图输入预检、2个实际模型识别与40工具/后端状态探测；
COM 缺少当前写入契约且 Cader 绘图模式未实现，实际绘图测试仍待 #3，不能将识别通过记为绘图通过。
新增 JPEG 输入与独立图片用例 runner；原始文件、期望与模型输出只留本地，公共文档仅发布脱敏结论。

## 2026-11-19：联合反馈与受控执行（#15）

来源：用户转交MCP开发者的联合测试反馈，明确只维护Cader。原始反馈和图纸仅留本地。
工作项 [CADER-013 / #15](https://github.com/codesknight/Cader/issues/15)，M0 milestone；#3/#14保留真实CAD和图片验收。

| ID | 需求 | 本轮验收及边界 |
|---|---|---|
| REQ-017 | 公共工作图/执行/保存件契约和真正写调度 | cader-cad/1请求/响应schema、审核计划哈希、显式HTTP授权、独占锁、durable journal、未知冻结只对账；固定几何fixture闭环。真实MCP新接口待对齐 |
| REQ-018 | 业务终态独立于模型运行 | cader-task/1、五阶段、动作及授权状态；只读exec为unverified，显式redraw阻塞；错误不被模型正文掩盖 |
| REQ-019 | 原图区域审计与结构化事实 | Sharp/DSH原图裁剪旋转、原图/视图/附件/实际请求hash尺寸与坐标映射、Skill内容hash；图像事实及抽象端口拓扑与独立期望比较 |
| REQ-020 | 独立验收、失败回归和记录 | 实体/文字/图层与计划比对、文件hash和重开后独立查询；OR/XOR、漏标签、110/1100、图号与跨线固定合成回归；不把它们当真实模型修复证据 |

本轮不开放图片计划执行、不实现图像到CAD编译器或DWG电路拓扑提取器；示意layout与物理尺度明确区分。

## 2026-11-19：MCP团队契约对齐（#15）

REQ-021：用户转交MCP对be2887f的对齐提案。验收：区分可写WorkingBinding/只读VerificationBinding；
显式observed_database_events与权威失败后revision；create绑定输出目录；按操作对账输入/结果文档及artifact；
交集ID、审计hash规则、共享正反例和schema文件hash。Cader维护者确认本侧选择，但不代替MCP双方冻结。
来源文档是审阅输入，不自动执行其中脚本或授予修改MCP/真实CAD写入权限。沿用M0/#15，#3/#14继续跟踪实机门槛。

## 2026-11-19：Cader CLI真实固定几何验收（#15/#3/#14）

REQ-022：用户提供MCP完成profile及实机验收的报告，明确要求Cader执行自己的真实闭环，并补充tests/images。
验收为原生CLI单次执行已审查line/circle/text计划，持久化请求与身份、保存真实DWG、只读新文档重开独立查询、
另外新MCP客户端复查及文件hash、源输入不变、专用实例清理。模型驱动、图片重绘和真实响应丢失故障分别跟踪，不能并入固定计划成功。
MCP确认修订2/映射修订1是实施基线；原共享snapshot不修改、不擅自宣称联合发布冻结。本轮不修改MCP源码/默认COM配置或原图。


## 2026-11-19：持续交互终端（#16 / #10）

REQ-023：用户明确要求Gemini CLI/Claude Code式持续终端、彩色Cader、16个Slash入口、文件引用、用户Shell、Esc和Tab。
验收为本地可直接启动的bin/CMD、共享命令应用服务、默认只读DSH多轮可见上下文、配置选择、摘要与恢复、引用hash、
逐条确认Shell及取消、Windows PTY和跨平台CI。原始设计仍是参考；不把/open、/undo、/checkpoint菜单当作CAD执行授权或已实现接口。
关联M0 [#16](https://github.com/codesknight/Cader/issues/16)、基础入口[#10](https://github.com/codesknight/Cader/issues/10)；
社区[#9](https://github.com/codesknight/Cader/issues/9)本轮只做固定版本静态审查，保留实际运行验收。


## 2026-11-19：开源CLI使用手册（#17）

REQ-024：用户要求同步维护专门介绍Cader CLI功能与用法的开源文档。
验收为独立中英文用户手册与语言切换、可发现的项目/文档入口、安装到排障的完整已实现命令说明、
配置/权限/数据与CAD能力边界，以及同提交同步文档/帮助的开发约束。
关联M0 [DOCS-001 / #17](https://github.com/codesknight/Cader/issues/17)。本轮只维护Markdown与开发规范，不改Harness、MCP、图纸或真实模型状态。


## 2026-11-20：Agent Execution Enablement（#18）
REQ-025：来源为用户运行日志与v0.3.0纠偏指令。优先打通真实模型→工具→AutoCAD→独立验证；保留DSH/Cordis与独立MCP。
验收为自动连接、状态、新建、直线/圆/矩形、图层颜色、编辑、保存、独立回读、多轮自主调用及断线引导十项任务。
实现四权限（默认ask）、Agent文件与Shell、程序审批/工作图绑定/审计/未知写入冻结；不新增复杂协议与子Agent平台。
关联[v0.3.0 / #18](https://github.com/codesknight/Cader/issues/18)。真实证据见[验收报告](../validation/2026-11-20-agent-execution.md)，CI及剩余项单独标记。


REQ-026 (#19): 用户v0.4指导与真实CLI日志要求优先可靠执行、可观测性、恢复判断与可信报告，再推进真实视图/视觉纠错。建议门槛不作为已实现功能或相邻仓库写授权。本轮验收分开记录确定性fixture、真实CAD控制实验与真实模型；完整v0.4清单保持未验收。

REQ-027 (#19)：用户要求“提交远程推送，并更新文档”。将现有研发提交及研发指导原文同步到远端开发分支，更新文档导航、日志、实际检查与 CI 结果；不合并未验收快照到 main，不将该请求视为修改相邻 AutoCAD-MCP 的授权。原指导文件保持字节不变，实机失败及待授权事项保留。

REQ-028 / CADER-017 [#20](https://github.com/codesknight/Cader/issues/20)：来源为用户最新11:09日志与v0.4.x自主绘图质量指令。验收为一次需求→模型计划→真实CAD→几何/拓扑/自动视觉→最多3轮局部修正→程序验收；默认中文、任务授权、严格报告与安全恢复。复用DSH、ExecutionSession、MCP及Recovery，不重写AgentLoop、不硬编码电路序列。以5V电源+灯泡的串联电路为必要实机案例，不能以fixture替代。实施、已证实缺陷及仍未满足条件见[实测](../validation/2026-11-20-autonomous-quality.md)。Milestone v0.4保持打开。

REQ-029（#20/#19）：用户要求排查12:32最新CLI日志。核对原始审计、输入schema、冻结/恢复、计数范围及终端重复输出，区分已证实问题和假设；本轮交付为诊断及复现证据，修复留作明确待实施项。见[审计](../validation/2026-11-20-user-log-1232.md)，不将既有63/63视为原始MCP输入校验已覆盖。

REQ-030（#20/#19）：用户明确要求按上述审计执行代码修复。验收为原始MCP schema的缺参/类型/嵌套负向回归、纠参不重放、整批schema预检、真正未知继续冻结、本轮/累计/缓存范围明确、恢复拒绝不显示成功及流式输出去重；真实模型/CAD必须验证文字后进入自动质量阶段。保留DSH/权限/文档绑定及旧锁，不自动清理旧unknown，不修改独立MCP。实现与真实未通过的完整质量项见[修复报告](../validation/2026-11-20-schema-preflight-fix.md)。
