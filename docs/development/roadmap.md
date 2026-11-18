# 阶段路线

当前用户已确定 DSH；M0 目标是验证集成，不再进行框架重选。

| 工作项 | 当前状态 | 验收 / 下一步 |
|---|---|---|
| CADER-001 TS/Python workspace | 本轮迁移 | 锁文件、编译和跨平台 CI |
| CADER-003 AutoCAD-MCP | 初次成功、稳定性未过 | [Issue #1](https://github.com/codesknight/Cader/issues/1)：干净后端复现 |
| CADER-004 DSH adapter/profile | 组件 smoke 已实现 | [Issue #2](https://github.com/codesknight/Cader/issues/2)：完整 app + 真模型 + 官方 MCP |
| CADER-007 CAD 纵向闭环 | 未实现 | [Issue #3](https://github.com/codesknight/Cader/issues/3)：工作副本绘制保存并重开验证 |
| CADER-010 基准评测 | G01–G10 规格 | [Issue #4](https://github.com/codesknight/Cader/issues/4)：独立 verifier / runner |
| REQ-003 持续过程记录 | 本轮建立 | 后续每轮更新需求、日志、测试和 Bug |

DSH Web/headless、真实模型、视觉内容、取消/预算和实际 CAD 读写需要分别留证。
Gateway、动态路由、专业插件和新 UI 在基线建立后按需求推进，不提前创建空模块。
