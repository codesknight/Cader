# ADR 0001：确定采用 DeepSeek Harness + Cordis

- 日期：2026-11-18
- 状态：**用户已确定；M0 集成验证中**
- 来源：用户调研结论与技术设计 v0.2。
- 替代：提交 `54d2ebf` 中的 Deep Agents M0 选择；[旧 ADR 原文](archive/0001-deep-agents-spike.md)仅作为历史证据。

## 决策

Cader 的 Agent Runtime 为 DeepSeek Harness（DSH），通过 Cordis 插件和 profile 装配。
使用 TypeScript / Node.js；CAD MCP 为独立 Python / uv 子项目。复用上游 loop 与官方
MCP client，不复制整套运行时，不重新比较框架排名。Gemini CLI、Codex 等仅作架构参考。

## 版本证据

- 上游源码调研 commit：`ca33fd6843b205e279c7ccb6cb73a472c78f5760`。
- npm DSH 组件统一精确锁定 `0.2.2-rc.4`；Cordis `4.1.0`；`pnpm-lock.yaml` 保存完整性哈希。
- Node.js 最低版本 `24.9.0`，pnpm `11.28.5`；本地用校验过官方 SHA256 的便携 Node 验证，未修改系统 Node。
- 上游 MIT；实际分发包元数据及本轮选用组件均已核对，完整 app 的依赖许可审计仍待后续。
- npm 元数据没有 gitHead，不声称 npm tarball 与上述源码 commit 字节等同。
- 各包 `latest` 标签不一致，禁止省略精确版本混装旧接口。

一手来源：[上游包声明](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/package.json)、
[扩展机制](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/docs/cookbook/extension-cookbook.md)、
[工具契约](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/docs/cookbook/adding-a-tool.md)、
[MCP client](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/mcp/mcp-client/README.md)、
[许可证](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/LICENSE)。

## 本轮落地

`dsh-adapter` 集中上游导入，装配真实 Cordis Context、SystemPrompt、ToolsService 和 NativeToolExecutor。
`cad-policy` 是独立插件，使用 pre-execute waterfall 并调用 `next()`；最终 guard 防止后续监听器撤销拒绝。
`profile` 当前仅装配组件 fixture，CLI 记录 smoke 事件、配置哈希和验证报告。

实测原始 tool-call 使用 `type: 'tool-call'` 和 JSON 字符串 arguments；参数 schema 校验
发生在上游执行管线内。预先取消的 batch 返回 `ABORTED_BEFORE_DISPATCH`，不会触发普通
`tools/result` 监听器，因此 Cader 必须在调用或 session 边界补记取消，不能只统计该监听器。

本轮未加载模型或完整 Web/headless app，不声称已验证默认 Agent Loop、官方 MCP client、
图像、真实模型或 CAD 写入。后续门槛是完整 profile + 真模型工具调用、MCP 文本/图像、
取消、工作副本保存及独立验证。选型已确定，这些是集成门槛。
