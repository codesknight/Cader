# Cader documentation · 文档导航

Start with the CLI user guide for installation and daily use. / 安装与日常使用请从 CLI 使用手册开始。

| Audience / 读者 | Documentation / 文档 |
|---|---|
| CLI users / CLI 用户 | **[English user guide](cli/README.md) · [中文使用手册](cli/README.zh-CN.md)** |
| Configuration / 配置 | [Models and MCP / 模型与 MCP](development/model-configuration.md) |
| Integration / 集成 | [CLI diagnostics and controlled execution / 诊断与受控执行](development/cli.md) · [CAD contract / 公共契约](contracts/managed-cad-v1.md) |
| Contributors / 开发者 | [Development process / 开发流程](development/process.md) · [Records / 开发记录](development/README.md) · [Roadmap / 路线](development/roadmap.md) |
| Architecture / 架构 | [Terminal architecture / 交互终端](architecture/interactive-terminal.md) · [CLI First](architecture/cli-first.md) · [ADRs](adr/) |
| Verification / 验证 | [v0.4 actual results and retained failures / v0.4 实测与保留失败](validation/2026-11-20-reliable-execution.md) · [v0.3 model execution / v0.3 模型执行](validation/2026-11-20-agent-execution.md) · [Terminal validation / 终端验证](validation/2026-11-19-interactive-terminal.md) · [Real CAD fixture / 真实固定几何](validation/2026-11-19-cader-cli-real-loop.md) |
| Proposals / 设计参考 | [v0.4 development guidance / v0.4 研发指导原文](designs/Cader_v0.4.0_Development_Guide.md) · [Technical design / 技术设计](designs/Cader_Technical_Design_v0.2.md) · [CLI design / CLI 设计](designs/Cader_CLI_Design.md) |

User guides describe shipped behavior. Design proposals, fixture results, live models and real CAD tests have separate scopes; a proposal or model answer is not proof of a verified DWG.

使用手册描述已实现行为；设计提案、组件测试、真实模型和真实 CAD 的验证范围分别记录，不把提案或模型回答当作 DWG 验收。

[Project home / 项目首页](../README.md) · [简体中文](../README.zh-CN.md) · [Report an issue / 反馈问题](https://github.com/codesknight/Cader/issues)

dev.2: [自主绘图质量实测 / autonomous quality evidence](validation/2026-11-20-autonomous-quality.md) · [Harness quality gate ADR](adr/0010-harness-owned-quality-gate.md)。完整实机案例仍未通过。

dev.3: [MCP参数预检修复与实测 / input validation fix](validation/2026-11-20-schema-preflight-fix.md) · [ADR0011](adr/0011-mcp-input-validation-and-result-classification.md)。文字与自动视觉阶段已实测，完整图纸质量仍未通过。

dev.4: [历史屏障诊断与用户复核 / legacy barrier review](validation/2026-11-21-legacy-barrier-review.md) · [ADR0012](adr/0012-reviewed-legacy-barrier-retirement.md)。启动警告与模型前阻断；旧缺参只能用户显式审定，原始unknown保留，真实未知不放行。
