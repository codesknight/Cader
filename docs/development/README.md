# 开发过程记录

本目录是长期过程记录入口。GitHub Issues / Milestone 跟踪工作状态，Git 记录变更，
这里保存可检索的需求来源、实施经过、测试结论与排障证据。

- [需求与验收](requirements.md)
- [执行和记录规范](process.md)
- [开发日志：11 月 20 日](logs/2026-11-20.md) / [11 月 19 日](logs/2026-11-19.md) / [11 月 18 日](logs/2026-11-18.md)
- [开发日志：11 月 21 日修复收尾](logs/2026-11-21.md)
- [测试记录](testing.md)
- [Bug 与排障](bugs.md)
- [阶段路线](roadmap.md)
- **[CLI 中文使用手册](../cli/README.zh-CN.md) / [English User Guide](../cli/README.md)**
- [CLI 用户任务与诊断](cli.md)
- [CLI First 实施边界](../architecture/cli-first.md)

原始运行输出保存在被忽略的 `.cader/runs/`；公开记录只提交脱敏证据。
历史记录不覆盖旧失败，追加复验结果。没有执行的验证必须写“未执行”。

- [模型配置与真实集成](model-configuration.md)
- [v0.4 实测、故障证据与未通过门槛](../validation/2026-11-20-reliable-execution.md) · [研发指导原文](../designs/Cader_v0.4.0_Development_Guide.md)

当前为 `0.4.0-dev.1` 研发快照。代码提交、离线 CI 与完整实机验收分别跟踪；后端修补待授权、压力/生命周期及视觉纠错未通过项不会因推送而关闭，见 [#19](https://github.com/codesknight/Cader/issues/19)。

当前推进到 `0.4.0-dev.2`：[自主质量实测及脱敏轨迹](../validation/2026-11-20-autonomous-quality.md)、[调度决策](../adr/0010-harness-owned-quality-gate.md)、[#20](https://github.com/codesknight/Cader/issues/20)。自动视觉/补丁已有真实执行，完整电路验收未通过；Drawing5新捕获屏障保留。上段dev.1为历史阶段记录。

当前为 `0.4.0-dev.3`：[12:32日志审计](../validation/2026-11-20-user-log-1232.md)及[代码修复/实机证据](../validation/2026-11-20-schema-preflight-fix.md)。参数漏检、状态诊断和重复输出已修复；真实Flash已越过文字绘制进入视觉，完整质量仍未通过。上段dev.2为历史记录；旧锁不自动迁移。

2026-11-25：**[复杂手稿重绘：代码/提示词/证据复盘、标注稳定性、上下文续接与主动澄清](2026-11-25-complex-redraw-engineering-review.md)** · [MCP协同建议](../contracts/2026-11-25-cader-mcp-execution-evidence-proposal.md)。已修复与拟议能力分别列出，不将设计写成已实现。

2026-11-25：**[Cader新回执适配、身份校验与错误分级](../validation/2026-11-25-cader-execution-evidence.md)**（REQ-047 / #20）。组件、真实服务契约和完整绘图验收分开记录。

2026-11-25：**[原始房子/复杂手稿联合回归](../validation/2026-11-25-original-joint-regression.md)**（REQ-048）：热态绘本通过，冷态新建失败，手稿结构通过但视觉待验；BUG077–078保持open。

REQ-048人工验收补充：用户确认两最终DWG均无问题，hash一致；两成品人工通过，原自动历史和冷态问题分别保留，见[报告补充](../validation/2026-11-25-original-joint-regression.md)。
