# 阶段路线与维护

当前只交付 M0 的可执行起点，不一次性实现设计提案中的所有模块。

| 阶段 | 已有 | 下一验收门槛 |
|---|---|---|
| 初始化 | 包、锁文件、契约、CLI、CI | 远端 CI 通过 |
| MCP 调研 | 原始工具发现、真实只读 smoke | 锁定上游干净 commit 复现 |
| Harness 选型 | ADR、Deep Agents 确定性 spike | 真实模型 + MCP 工具适配与预算 |
| CAD 纵向闭环 | 尚未实现 | 新图纸绘制、另存、独立重开检查 |
| 比较评测 | G01–G10 规格 | fixture、verifier、runner、每题 3 次对照 |
| Gateway / Skills / 扩展 | 后续 | 由闭环及失败轨迹驱动 |

每次迭代更新 ADR、smoke 记录和相关 GitHub Issue；记录成功、失败与环境限制。
生产模型选择、专业扩展和 UI 放在真实绘图闭环之后。

## GitHub 跟踪

- [CADER-003：干净后端版本的 MCP 复现](https://github.com/codesknight/Cader/issues/1)
- [CADER-004：真实模型、MCP 适配及预算](https://github.com/codesknight/Cader/issues/2)
- [CADER-007：隔离图纸的绘制、保存和重开验证](https://github.com/codesknight/Cader/issues/3)
- [CADER-010：G01–G10 评测执行器与独立验证器](https://github.com/codesknight/Cader/issues/4)
