# 开发过程记录

本目录是长期过程记录入口。GitHub Issues / Milestone 跟踪工作状态，Git 记录变更，
这里保存可检索的需求来源、实施经过、测试结论与排障证据。

- [需求与验收](requirements.md)
- [执行和记录规范](process.md)
- [开发日志：11 月 20 日](logs/2026-11-20.md) / [11 月 19 日](logs/2026-11-19.md) / [11 月 18 日](logs/2026-11-18.md)
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
