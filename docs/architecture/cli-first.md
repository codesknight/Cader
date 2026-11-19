# CLI First 实施路线

依据用户本轮要求和 [CLI 设计原稿](../designs/Cader_CLI_Design.md)，
执行顺序为 DSH Headless / 社区 TUI → Cader CLI → Web UI / CAD 内嵌插件。
原稿是目标接口；当前提供 README 列出的 pnpm 诊断、smoke，以及只读用户任务 exec。

## 当前基线与边界

现有 TypeScript CLI → Cader profile → DSH adapter 已能运行组件 fixture 和真实模型 / MCP
只读 smoke。Static / Available、一层最多 5 个子任务、根 `.env` 与 YAML profile 已落地。
这条 headless Cader 组合不等于已验收上游完整 `dsh --profile headless` app。

业务配置统一在 `configs/`，当前没有任意工程目录初始化或多层配置覆盖功能。
未来 `.cader/config.json` 如需引入，只保存工程选择和状态引用，其 schema / 优先级需单独验收，
避免复制模型密钥和整套配置。`configs/` 的资产加载目前以传入的仓库 root 为基准。

## 阶段与退出条件

| 阶段 | 工作 | 退出条件 |
|---|---|---|
| A：复用与集成 | 锁定 DSH Headless；选一个社区 TUI 做独立 profile spike；接现有模型/MCP/策略 | 无密钥启动帮助；真模型只读任务；事件、取消、恢复、Windows 终端还原有证据；TUI 不绕过 Cader 工具和委派约束 |
| B：Cader CLI P0 | 可安装 bin、help/version、工程 init/status/doctor；配置与 MCP/Skill 发现；exec/JSONL；会话恢复 | 帮助/参数错误不依赖 API；无覆盖初始化；stdout 机器事件、stderr 诊断；单个终结事件；退出码与 Ctrl+C 的跨平台测试 |
| C：CAD 纵向闭环 | 工作副本、文档身份/单位/修订、锁和权限；绘制、保存、重开、独立校验 | 绑定目标与工作副本；不确定写入先对账；独立 verifier 验证结果；G01–G10 开始可复现评测 |
| D：交互完善 | 共享 Command Registry 的 slash / 简单 REPL；模型、技能和会话管理；按实际需求复用或定制 TUI | 确定性命令不走 LLM；未知 slash 报错；附件引用可追溯；取消后可继续会话 |
| E：多界面 | Web UI、CAD 内嵌插件 | 复用已稳定应用服务、事件和权限，不另建一套 Agent 逻辑 |

阶段 A 的 TUI spike 限定范围；若不兼容，记录原因并推进 Headless / CLI。
不为复用外观阻塞 Harness 与 CAD 能力。阶段 C 的只读诊断可与 B 并行，CAD 写入必须通过工作副本门槛。

## 接口规划

CLI / slash / 未来界面 → Command Registry → Application Services。
确定性诊断直接调用配置、会话或 MCP 服务；自然语言任务通过 DSH adapter 执行。
CLI 不直接访问 COM。受控 shell 与 CAD 原生命令待权限、工作目录、取消和审计契约明确后再开放。

`cader exec` 计划归一化上游结构化事件为有版本的 RunEvent，包含 seq、timestamp、runId、
sessionId、type 和 payload；stdout JSONL 与 stderr 诊断分开，恰好一个 terminal event。
不解析面向人的 TUI 文本，不原样转发上游全部事件。上游 Headless 可能输出 reasoning，
Cader 展示与持久化层需过滤 reasoning；密钥和私有图纸不写公开日志。
当前 smoke JSONL 不是承诺稳定的 RunEvent v1，正式 schema 和退出码以 CLI-005 验收为准。
2026-11-19 的 exec 先返回单个终态 JSON，默认只读；稳定事件流、恢复和绘图仍待后续验收。

沿用 DSH `0.2.2-rc.4`、Cordis `4.1.0`、Node >=24.9 和 pnpm 11.28.5。
先做 keyless CLI 基础和非交互链路，再决定是否采用 Commander；UI 需求明确前不加入 Ink / React。
保留 node:test，避免因原稿的建议重做测试基础。

## 社区 TUI 调研状态（2026-11-19）

| 候选 | 已查到的声明 | Cader 待验证 |
|---|---|---|
| [nexlineai/dsh-tui](https://github.com/nexlineai/dsh-tui) | 独立 DSH plugin、MIT；README 声明 macOS / Linux，提供会话与权限交互 | 锁定依赖、Windows 支持、可否装配 Cader profile 与子任务限制 |
| [TonyWang-hub/deepseek-harness-tui](https://github.com/TonyWang-hub/deepseek-harness-tui) | MIT 社区 fork，使用进程内终端和共享 client core | 与当前官方版本差异、能否仅复用 UI、Windows / 升级成本 |

以上是作者文档声明，不是 Cader 实测结果；尚未安装、选定或将任一依赖加入锁文件。
优先试独立 plugin，避免默认承担完整 runtime fork 的维护成本；不把旧 `turtle-ui` 示例当作可用依赖。
验收时锁定候选版本/commit，记录 Node/DSH/Windows 版本和失败证据。

官方来源：[锁定版本对应 Headless 文档](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/bundle/headless/README.md)。
该文档说明一次任务、JSON 事件和 session-id 恢复；Cader 仍需自己的兼容测试与事件过滤。

## 与原稿的差异

本轮 [ADR 0003](../adr/0003-config-layout-and-cli-first.md) 明确配置统一到 `configs/`，
社区 TUI 验证优先于自建 TUI；不自动执行原稿中的全部命令、依赖安装或 shell 能力。
CLI-001 至 CLI-012 作为需求拆分依据，逐项以代码和测试验收，不用设计完成代替功能完成。
