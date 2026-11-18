# 开发与记录流程

每个有实质变更的迭代按下面流程记录，不要求逐条转录工具调用或聊天。

1. **需求**：在 requirements.md 登记来源、范围、验收标准；关联 GitHub Issue 和 Milestone。
2. **实施**：Issue 标记进行中；当日日志记变更、取舍、受影响接口；架构变化更新 ADR。
3. **验证**：testing.md 记录实际命令、版本、结果、失败/跳过/未执行项和证据位置。
4. **排障**：bugs.md 保留现象、复现条件、证据、假设、根因是否确认、修复和复验；禁止用猜测当根因。
5. **提交**：小范围 commit 关联 Issue；PR（使用时）列需求、变更、测试、Bug 与限制。
6. **验收**：CI 通过后更新日志及 Issue；有未满足条件则保持打开，不因完成部分代码而关闭整个 M0。

## GitHub 面板

当前用 Issues 的标签、Milestone 和关闭状态组织 Requirement / Development / Test / Bug。
仓库日志与 Issue 相互链接；可以在 Issues 按 milestone / label 过滤查看进度。
Project board 可后续接入，但不是记录工作的前置条件。

## 每条记录的最小内容

- 日期和工作项 ID；本地时间采用 Asia/Shanghai，精确时间不可得时只写日期。
- 需求来源及验收；本次修改及原因；实际检查和结果；遗留问题；相关 commit / Issue。
- 区分组件 fixture、模型 fixture、真实模型、真实 CAD 和环境失败。
- 运行事件只记录可见状态与结果；日志不含密钥、私有图纸、完整敏感响应或隐藏推理。

后续每轮开发都遵循本流程。文档性或微小修正可合并进同一工作项的日志，不制造空记录。

当前面板入口：[M0 Milestone](https://github.com/codesknight/Cader/milestone/1)、[Issues](https://github.com/codesknight/Cader/issues)。
