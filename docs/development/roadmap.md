# 阶段路线

当前用户已确定 DSH；采用 CLI First，M0 目标是 Harness 与 CAD 能力集成。
先复用 DSH Headless、验证社区 TUI，随后形成 Cader CLI，最后开发 Web 与 CAD 内嵌。
完整阶段验收见 [CLI First 实施路线](../architecture/cli-first.md)。

| 工作项 | 当前状态 | 验收 / 下一步 |
|---|---|---|
| CADER-001 TS/Python workspace | 已完成本轮验收 | [Issue #5](https://github.com/codesknight/Cader/issues/5)，4/4 CI jobs 通过 |
| CADER-003 AutoCAD-MCP | 初次成功、稳定性未过 | [Issue #1](https://github.com/codesknight/Cader/issues/1)：干净后端复现 |
| CADER-004 DSH adapter/profile | 默认 loop / 官方 MCP / 真实角色模型只读已验证 | [Issue #2](https://github.com/codesknight/Cader/issues/2)：完整 Headless app、会话恢复与取消；Web 后置 |
| CADER-007 CAD 纵向闭环 | 未实现 | [Issue #3](https://github.com/codesknight/Cader/issues/3)：工作副本绘制保存并重开验证 |
| CADER-010 基准评测 | G01–G10 规格 | [Issue #4](https://github.com/codesknight/Cader/issues/4)：独立 verifier / runner |
| REQ-003 持续过程记录 | 机制已验收 | [Issue #6](https://github.com/codesknight/Cader/issues/6)；后续每轮持续维护 |
| CADER-006 配置统一 / CLI First | 已验收，4/4 CI 通过 | [Issue #8](https://github.com/codesknight/Cader/issues/8)：configs 加载、引用与路线；后续功能见 #9 / #10 |
| CLI-001 社区 TUI | 已调研候选，未集成 | [Issue #9](https://github.com/codesknight/Cader/issues/9)：锁定版本 / Windows / Cader profile 兼容 smoke |
| CLI-002 Cader CLI 基础 | 待实施 | [Issue #10](https://github.com/codesknight/Cader/issues/10)：bin、keyless help/version、参数错误与命令边界 |

Headless app、真实模型、视觉内容、取消/预算和实际 CAD 读写需要分别留证。
CLI 后续按原稿 CLI-003–010 逐项推进工程初始化、诊断、exec / JSONL、工作副本读写、
简单 REPL、配置与会话、受控 shell 和 Windows E2E；复用社区 TUI 后再决定 CLI-011 的自建范围。
CLI-012 评测与 #4 关联，避免重复实现。Gateway、动态路由和专业插件在基线建立后按需推进。

2026-11-19：[CADER-005 #7](https://github.com/codesknight/Cader/issues/7) 增加 YAML、两部分提示词、角色子树和真实只读/校准图验证。实际 CAD 预览、恢复和写入仍未完成；Web 移至后期阶段。
