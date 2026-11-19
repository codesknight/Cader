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
| CLI-002 Cader CLI 基础 | 已有 keyless help / 只读 exec / 参数校验 | [Issue #10](https://github.com/codesknight/Cader/issues/10)：bin、version、完整命令边界继续推进；本轮 #12 |
| CADER-011 重绘评估 Skill | 调研后接入目录、角色、资源和 PNG 评估入口 | [Issue #13](https://github.com/codesknight/Cader/issues/13)：不包含完整 DWG 重绘引擎 |
| CADER-012 本地图片测试 | 14图输入、2例真实识别通过；绘图未执行 | [Issue #14](https://github.com/codesknight/Cader/issues/14)：JPEG兼容与runner已补，#3仍阻塞实际绘图 |

Headless app、真实模型、视觉内容、取消/预算和实际 CAD 读写需要分别留证。
本轮 [#12](https://github.com/codesknight/Cader/issues/12) 交付只读用户任务、错误摘要与 Python UTF-8；
不是绘图能力。写入按[独立契约](../architecture/controlled-writes.md)在 #3 验收。
CLI 后续按原稿 CLI-003–010 逐项推进工程初始化、诊断、exec / JSONL、工作副本读写、
简单 REPL、配置与会话、受控 shell 和 Windows E2E；复用社区 TUI 后再决定 CLI-011 的自建范围。
CLI-012 评测与 #4 关联，避免重复实现。Gateway、动态路由和专业插件在基线建立后按需推进。

2026-11-19：[CADER-005 #7](https://github.com/codesknight/Cader/issues/7) 增加 YAML、两部分提示词、角色子树和真实只读/校准图验证。实际 CAD 预览、恢复和写入仍未完成；Web 移至后期阶段。

## 联合契约进展（2026-11-19 / #15）

Cader侧已具备程序写调度、任务业务状态、独立固定几何/文件/重开验收流程与读图证据门槛。
当前只在组件fixture通过；先对齐公共契约并通过真实固定几何HTTP闭环，再实现图片事实到几何的审核转换及DWG拓扑验收。
#3和#14保留打开；不可用fixture成功替代真实CAD或模型视觉验收。
