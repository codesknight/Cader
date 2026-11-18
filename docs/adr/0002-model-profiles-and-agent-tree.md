# ADR 0002：模型 YAML、两部分提示词与一层 Agent 树

- 日期：2026-11-19（Asia/Shanghai）
- 状态：本轮已实现；真实只读与视觉通道已验证
- 工作项：[CADER-005 / #7](https://github.com/codesknight/Cader/issues/7)

## 决策与来源

用户要求 Static 负责统筹规划，Available 动态装配 MCP、工具和 Skill；最多 5 个子 Agent
并行，只有主 Agent 可委派，子 Agent 的结果返回主 Agent 统一决策。模型由根 `.env` 的
`DEEPSEEK_API_KEY` 和 `config/models/*.yaml` 配置，连接独立 AutoCAD-MCP 验证。

保留 DSH 0.2.2-rc.4 / Cordis 4.1.0；使用官方 AgentFactory / AgentLoop、MCP client 和
`dsh-llm-pi-ai` 的 OpenAI-compatible LLM adapter，base URL 为 `https://api.deepseek.com`。
pi-ai 仅承担模型协议适配，Agent Runtime 仍为 DSH，没有重新选择 Pi Harness 或重写循环。

## 模型职责

| 配置 | 模型 | 职责 | 委派 |
|---|---|---|---|
| MainAgent.yaml | deepseek-flash | 主任务规划、工具与子任务协调、最终决策 | 允许 |
| SubAgent.yaml | deepseek-v4-pro | 文本、约束和方案审查 | 禁止 |
| VisionAgent.yaml | deepseek-flash | 接收已登记图片，返回视觉观察 | 禁止 |

当前官方文档明确 Flash 支持图像、Pro 不支持图像，因此没有将 Pro 配置成视觉模型。
来源：[模型能力表](https://api-docs.deepseek.com/quick_start/pricing/)、
[视觉输入](https://api-docs.deepseek.com/guides/vision/)。配置声明只用于路由和前置检查，
不能代替实际能力测试；本轮 Flash 已通过真实图片校准。

## 装配和约束

- `@cader/config` 严格读取 YAML；拒绝未知字段、内联密钥、重复键、执行标签、越界路径和不安全并发配置。
- Static 来自 `prompts/static/`，以独立 system section 注册；Available 是每步刷新的 context，工具 schema 仍由 DSH registry 提供。
- 当前 Skill 目录有 cad-inspection，正文通过受限加载工具按需读取，不能执行脚本。
- 子树通过 DSH AgentFactory 创建，具有 parentSession / depth 元数据。只有主作用域注册 cader_delegate；调用者对象身份和角色再次校验。
- 每个运行树最多 5 个子 Agent，队列等待空位；仅在子执行及清理结束后释放。模型步数、工具次数、委派次数和运行时间共享有界预算。
- 图片委派只能使用 Available 中已登记的 image_ref；模型不能传任意文件路径。输入还会检查模型能力、workspace realpath 与图像格式。
- 当前只放行已审查的 list_layers / list_symbol_library。配置不能单独把 delete_entity 等写工具提升为可用能力。
- 日志保留可见结果、调用关系、配置哈希和 Token 用量，不保存 API key 或 reasoning-delta。

## 证据与剩余门槛

本轮真实主 Agent 已通过 MCP 查询 AutoCAD，并并行委派文本子 Agent 与视觉子 Agent，
结果统一返回主 Agent。实测子 Agent 峰值为 2；上限 5 和排队通过 7 个 fixture 子任务验证，
没有把它描述为已经同时运行 5 个付费模型。

视觉测试使用独立合成校准图，验证码和图形数量由外部 verifier 比较，不进入模型文字提示。
这不是实际 CAD 预览、图纸理解准确率、绘图保存闭环或生产多 Agent 平台的验收。
Web UI、真实 CAD 图像的 MCP 传递、持久化恢复和写入对账仍需后续验证。
