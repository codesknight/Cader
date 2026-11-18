# ADR 0003：统一 configs 与 CLI First

- 日期：2026-11-19
- 状态：Accepted；目录已落地，CLI 按阶段实施
- 来源：用户本轮明确要求、[CLI 原稿](../designs/Cader_CLI_Design.md)
- 跟踪：[CADER-006 / #8](https://github.com/codesknight/Cader/issues/8)

模型、运行预算、MCP、静态提示词、Skill 统一在 `configs/`。删除旧目录入口并更新加载器、
测试与当前示例，不增加兼容回退，避免两套配置产生优先级歧义。根 `.env` 保留凭据，
`.cader/` 保留私有状态；源代码、测试、依赖工具自身的构建配置不迁入业务配置目录。
本机 MCP 文件迁移但不提交；两个 MCP 客户端 schema 继续分别命名。

采用 CLI First / Harness First。先沿用已锁定 DSH 的默认 Loop、官方 adapter 和 Headless，
在独立 profile 中验证社区 TUI，再形成 Cader CLI。确定性命令经应用服务执行；Agent 任务
经 `packages/dsh-adapter` 进入 DSH。未来 CLI、slash、Web 和 CAD 插件共享服务与事件，
不在每个界面重做 Agent Loop、权限或 CAD 写入逻辑。

用户本轮要求优先于原稿中的目录与选型建议：原稿根 `skills/` 改为 `configs/skills/`；
社区 TUI 复用验证在自建 Ink / React TUI 之前。Commander、Ink、Vitest 均为建议，
此次不替换现有 node:test、不新增 UI 依赖。原稿保持原文，以此 ADR 和实施路线标明差异。

社区 TUI 尚未选定或接入。必须验证锁定 DSH 兼容性、Windows 终端、取消与会话、
Cader 的角色/工具限制；失败时继续 Headless 与简单 CLI，不以换 Harness 或长期维护完整 fork
作为默认方案。Web 与 CAD 内嵌不作为 M0 的阻塞条件。具体分阶段验收见
[CLI First 路线](../architecture/cli-first.md)。

本次只有目录迁移和路线确认，不能据此宣称正式 `cader` 命令、社区 TUI、会话恢复、
CAD 工作副本写入或完整上游 Headless app profile 已完成。
