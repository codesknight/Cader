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
