# 需求与验收记录

| ID | 来源 | 需求 | 状态与验收 |
|---|---|---|---|
| REQ-001 | 首次用户请求、v0.1 设计 | 新建并维护 Cader，优先调研、Harness 选型与 smoke | 初始化已交付；实机稳定性仍由 CADER-003 跟踪 |
| REQ-002 | 本轮用户明确选择、v0.2 设计 | Harness 确定为 DeepSeek Harness + Cordis | 已落实当前代码、依赖和 ADR；完整 app / 真模型门槛保持待验证 |
| REQ-003 | 本轮用户请求 | 持续记录需求、开发、测试、Bug 排查，可用 GitHub 开发面板 | 已建立目录、模板、AGENTS 约束、Issue/Milestone；后续每轮执行 |

## 当前实施范围

建立 TS / Python workspace、一个实际 DSH 组件与插件 smoke、迁移已有 MCP 工具、
更新 CI 与过程记录。保留旧设计和 Deep Agents spike 的 Git 历史。

后续验收仍包括完整 DSH Web/headless profile、真实模型 + 官方 MCP client、图像、
工作副本写入/保存/独立验证和 G01–G10。原设计中的目标目录及 API 不代表已经实现。

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
