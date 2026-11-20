# 阶段路线

当前用户已确定 DSH；采用 CLI First，M0 目标是 Harness 与 CAD 能力集成。
先复用 DSH Headless、验证社区 TUI，随后形成 Cader CLI，最后开发 Web 与 CAD 内嵌。
完整阶段验收见 [CLI First 实施路线](../architecture/cli-first.md)。

| 工作项 | 当前状态 | 验收 / 下一步 |
|---|---|---|
| CADER-001 TS/Python workspace | 已完成本轮验收 | [Issue #5](https://github.com/codesknight/Cader/issues/5)，4/4 CI jobs 通过 |
| CADER-003 AutoCAD-MCP | 初次成功、稳定性未过 | [Issue #1](https://github.com/codesknight/Cader/issues/1)：干净后端复现 |
| CADER-004 DSH adapter/profile | 默认 loop / 官方 MCP / 真实角色模型只读已验证 | [Issue #2](https://github.com/codesknight/Cader/issues/2)：完整 Headless app、会话恢复与取消；Web 后置 |
| CADER-007 CAD 纵向闭环 | 固定计划真实闭环已过；模型驱动及真实故障条件待验 | [Issue #3](https://github.com/codesknight/Cader/issues/3)：图片计划、受控调度及故障验收 |
| CADER-010 基准评测 | G01–G10 规格 | [Issue #4](https://github.com/codesknight/Cader/issues/4)：独立 verifier / runner |
| REQ-003 持续过程记录 | 机制已验收 | [Issue #6](https://github.com/codesknight/Cader/issues/6)；后续每轮持续维护 |
| CADER-006 配置统一 / CLI First | 已验收，4/4 CI 通过 | [Issue #8](https://github.com/codesknight/Cader/issues/8)：configs 加载、引用与路线；后续功能见 #9 / #10 |
| CLI-001 社区 TUI | 已固定版本静态审查，运行兼容未验 | [Issue #9](https://github.com/codesknight/Cader/issues/9)：保留独立社区 profile 实测条件 |
| CLI-002 Cader CLI 基础 | 本地 bin/CMD、keyless help/version、裸命令退出语义与只读 exec 已实现 | [Issue #10](https://github.com/codesknight/Cader/issues/10)：跨平台入口测试与用户目录安装 |
| CADER-014 持续交互终端 | Node TTY/Readline、16命令入口、会话与上下文、引用、确认 Shell | [Issue #16](https://github.com/codesknight/Cader/issues/16)：Windows PTY及离线DSH通过；真实模型QUOTA，CAD打开/撤销尚无受控接口 |
| DOCS-001 开源CLI手册 | 独立中英文手册、文档导航与同提交同步规则 | [Issue #17](https://github.com/codesknight/Cader/issues/17)：安装、命令、配置、会话、脚本、能力限制及排障，随实现维护 |
| CADER-011 重绘评估 Skill | 调研后接入目录、角色、资源和 PNG 评估入口 | [Issue #13](https://github.com/codesknight/Cader/issues/13)：不包含完整 DWG 重绘引擎 |
| CADER-012 本地图片测试 | 14图输入、2例既有识别通过；图片重绘未执行 | [Issue #14](https://github.com/codesknight/Cader/issues/14)：固定几何实机基础已通过，图片计划与验收继续推进 |

Headless app、真实模型、视觉内容、取消/预算和实际 CAD 读写需要分别留证。
本轮 [#12](https://github.com/codesknight/Cader/issues/12) 交付只读用户任务、错误摘要与 Python UTF-8；
不是绘图能力。写入按[独立契约](../architecture/controlled-writes.md)在 #3 验收。
CLI 后续按原稿 CLI-003–010 逐项推进工程初始化、诊断、exec / JSONL、工作副本读写、
简单 REPL、配置与会话、受控 shell 和 Windows E2E；本轮按用户明确要求实现Cader终端，社区候选另保留独立兼容性验收。
CLI-012 评测与 #4 关联，避免重复实现。Gateway、动态路由和专业插件在基线建立后按需推进。

2026-11-19：[CADER-005 #7](https://github.com/codesknight/Cader/issues/7) 增加 YAML、两部分提示词、角色子树和真实只读/校准图验证。实际 CAD 预览、恢复和写入仍未完成；Web 移至后期阶段。

## 联合契约进展（2026-11-19 / #15）

Cader侧已具备程序写调度、任务业务状态、独立固定几何/文件/重开验收流程与读图证据门槛。
修订2/映射修订1已确认，专用profile与Cader独立固定几何HTTP实机闭环已通过，见[实机报告](../validation/2026-11-19-cader-cli-real-loop.md)。
下一步为模型计划的审核调度、图片事实到几何转换及DWG拓扑验收；#3的完整模型/故障条件和#14图片条件保持打开。
固定三实体成功不代表任意图片、真实模型规划或长期稳定性通过。


## 2026-11-20：用户纠偏后的优先级（#18 / v0.3.0）
1. Agent Can Act：持久MCP、实际schema、动态调用与程序权限（默认ask），优先于新UI/复杂协议/子Agent扩展。
2. Agent Can Draw：真实自然语言新建/图层/绘图/编辑/保存/查询，独立验收；COM受控重开与故障恢复边界另跟踪。
3. Agent Can Solve：图纸理解与复杂任务，在实际执行基线上推进。
4. Harness Optimization：上下文/路由/专家/Benchmark在核心链路稳定后推进。
真实Pro模型已自主完成基础绘图与保存，见[证据](../validation/2026-11-20-agent-execution.md)。旧M0/固定计划与视觉验收不自动视为v0.3全部完成。


2026-11-20 / #19：v0.4按可靠执行→视觉反馈→纠错推进。本轮Cader侧可靠性与图像路由代码已实施；实机揭示MCP文档就绪/RPC拒绝与导出延迟，完整P0压力/生命周期及P1视觉纠错未通过。批次审批、领域拓扑和更广Benchmark继续后置，不用通过的fixture替代这些门槛。

2026-11-20 / #20：最新用户优先级将任务状态机、自动质量门槛、视觉格式修复和任务审批前移。dev.2已实现这些Cader调度行为、局部批量补丁和串联端口图检查，未新增研究/多Agent平台。真实模型已自主调用视觉并修改，但完整电路案例仍失败；优先解决原生捕获、可信证据归并与冻结后安全核实，再扩大通用拓扑或专业研究功能，见[失败与边界](../validation/2026-11-20-autonomous-quality.md)。

dev.3按最新审计先修复Cader raw schema输入预检与误冻结路径、明确状态和恢复/输出。真实文字及自动视觉已复验；下一步仍为组件计数范围/计划质量、原生裁切与可信视觉闭环，保持完整质量门槛，不因参数修复而提前发布完整v0.4。
