# ADR 0001：选择 Deep Agents 作为 M0 Python spike 底座

- 日期：2026-11-18
- 状态：**接受用于 M0 spike；真实模型 CAD 对照后再确定 M1 底座**
- 原因：优先验证 SDK 扩展，不 Fork Coding Agent。

## 证据与版本

以下为当日读取的上游版本，不将浮动 main 当作锁文件。Python 分发包由 `uv.lock`
固定版本、下载来源和哈希；源码 commit 是调研快照，不声称 wheel 与其逐字相同。

| 候选 | 调研版本 / commit | 许可证 | 与当前工程的关系 |
|---|---|---|---|
| Deep Agents | 0.7.39 / `16966e76e433465fcd8feb3a01534f31095c52a3` | MIT | Python >=3.11，首选 spike |
| OpenHands SDK | 1.62.0 / `7dd877ee7a4eb813a65fc539394bf4022fc1cc23` | MIT | Python >=3.12，需独立候选环境 |
| Pi agent-core | 1.5.2 / `05fd3fbda0bbb9a1c7a76e4bf92ab58ed77c8d94` | MIT | TypeScript / Node >=22.19.0，设计对照 |

一手来源：

- Deep Agents [包声明](https://github.com/langchain-ai/deepagents/blob/16966e76e433465fcd8feb3a01534f31095c52a3/libs/deepagents/pyproject.toml)、[装配接口](https://github.com/langchain-ai/deepagents/blob/16966e76e433465fcd8feb3a01534f31095c52a3/libs/deepagents/deepagents/graph.py)、[许可证](https://github.com/langchain-ai/deepagents/blob/16966e76e433465fcd8feb3a01534f31095c52a3/LICENSE)。
- OpenHands [包声明](https://github.com/OpenHands/software-agent-sdk/blob/7dd877ee7a4eb813a65fc539394bf4022fc1cc23/openhands-sdk/pyproject.toml)、[SDK 说明](https://github.com/OpenHands/software-agent-sdk/blob/7dd877ee7a4eb813a65fc539394bf4022fc1cc23/README.md)、[许可证](https://github.com/OpenHands/software-agent-sdk/blob/7dd877ee7a4eb813a65fc539394bf4022fc1cc23/LICENSE)。
- Pi [包声明](https://github.com/earendil-works/pi/blob/05fd3fbda0bbb9a1c7a76e4bf92ab58ed77c8d94/packages/agent/package.json)、[Agent API](https://github.com/earendil-works/pi/blob/05fd3fbda0bbb9a1c7a76e4bf92ab58ed77c8d94/packages/agent/README.md)、[许可证](https://github.com/earendil-works/pi/blob/05fd3fbda0bbb9a1c7a76e4bf92ab58ed77c8d94/LICENSE)。

## 比较与决策

| 维度 | Deep Agents | OpenHands SDK | Pi |
|---|---|---|---|
| 当前语言约束 | 满足 Python 3.11 | 当前版本不满足 3.11 | 跨语言集成 |
| 主要扩展入口 | tools / middleware / backend / checkpointer | 工具、事件、会话与 workspace | context 转换、工具 hooks、事件订阅 |
| MCP | Cader 标准 SDK 客户端独立接入，尚待桥接模型工具 | 原生 SDK 路径需独立 spike | 需工具适配层，未实测 |
| 本轮运行证据 | 确定性模型 spike | 源码调研 | 源码调研 |
| 主要成本 | 默认附带文件及委派工具，需裁剪权限和工具面 | Python 与依赖环境迁移成本 | Python CAD 栈之外增加 Node 运行时 |

工程判断：先用 Deep Agents 验证 CAD 专属上下文、工具策略和独立验证接口最省迁移工作。
这不是基于任务成功率的框架排名，也没有证据证明另外两个框架表现更差。
OpenHands 当前包声明还涉及 MCP 2 依赖；保持 AutoCAD-MCP 独立环境，通过协议边界隔离。

采用 `deepagents==0.7.39` 可选依赖，保留 Cader 的配置、MCP 客户端、契约和评测规格独立。
M0 用注入的确定性模型验证工具错误可见、后续调用、事件、检查点读取及步数终止。
检查点使用内存存储，不视为断电恢复；步数上限不等于 Token、费用或工具次数预算。
spike 不执行默认文件或委派工具，不接入 API Key，也不提供生产 Agent Loop。

实测发现：本版本会将工具抛出的普通 `ValueError` 向外传播并中断运行。spike 将 MCP
`isError` 映射为 `ToolException`，通过 `StructuredTool(handle_tool_error=True)` 产生
模型可见的错误 `ToolMessage`，随后成功调用另一个 fixture 工具。这是需要保留的适配
行为，不能假设框架默认会恢复所有异常。独立的非终止模型测试触发步数预算而退出。

## 尚待关闭的选型门槛

1. 将 Cader MCP session 包装为严格 schema 的模型工具；保留工具结果及错误语义。
2. 模型、工具、墙钟、修复次数预算及超时后写入对账；审批和持久化恢复测试。
3. 使用同一固定模型、工具集、后端、预算执行 G01–G10，每题至少 3 次。
4. 比较完成率、假成功率、P50/P95、Token、工具次数、失败类型和适配改动量。
5. 纳入独立模型/网络失败记录；基础设施失败单列，不从总运行数消失。

本轮没有真实模型 CAD 对照数据，不发布成功率排名。若 Deep Agents 工具裁剪、预算或
恢复接口代价过高，重新打开 ADR，独立环境验证 OpenHands 或 Pi。
