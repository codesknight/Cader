# Bug 与排障记录

## BUG-001：真实 AutoCAD 只读调用超时（Open）

- 来源：CADER-003，GitHub Issue #1；历史 smoke 记录。
- 现象：tools/list 可发现 36 个工具；list_layers 初次成功、最终连续两次 TimeoutError。
- 证据：docs/research/smoke-2026-11-18.md；当时 AutoCAD 进程 ID 发生变化。
- 根因：**未确认**。其他开发活动是环境事实，不能直接证明 COM 繁忙或连接失效。
- 下一步：在干净固定后端和专用图纸环境重现，记录连接、调用、取消及清理阶段。
- 本轮：未重启 AutoCAD、未修改上游、未重跑实机；保持 Open。

## BUG-002：旧 Deep Agents 普通工具异常中断（Historical / resolved）

- 来源：提交 54d2ebf 的 spike；普通 ValueError 向外传播。
- 修复：MCP isError 映射 ToolException，启用 handle_tool_error；原测试复验通过。
- 状态：旧实现已随 runtime 选择退出当前代码；只保留历史，不移植成 DSH 的假设。

## BUG-003：TS 统一输出目录破坏 pnpm 包解析（Resolved）

- 现象：tsc 编译后，在根 dist/packages/ 执行时找不到 @deepseek-ai/cordis。
- 复现：首次 pnpm test 的 ERR_MODULE_NOT_FOUND；依赖实际位于 adapter 包的 node_modules。
- 根因：把不同 workspace 包编译到一个脱离包边界的目录，改变 Node 的依赖查找祖先。
- 修复：每包 tsconfig/outDir 和 exports，采用 project references；内部通过 workspace 包名导入。
- 复验：pnpm test 2 passed。不是通过提升全部依赖到根目录来掩盖依赖边界。

## 集成发现：预取消 batch 不发普通 tool result 事件

这属于已确认的上游行为，不归因为未证实的上游 Bug。测试曾期待 4 个普通结果事件，实际
3 个；取消调用在 dispatch 前短路，返回 ABORTED_BEFORE_DISPATCH。现在验证 3 个真实
结果及独立取消结果，并由 CLI 补记取消。完整 session / Agent 取消行为仍需后续测试。

## 环境记录：GitHub Git 连接失败（已绕过，根因未定）

默认 Git 代理指向未监听的本地 10809；禁用该代理后，当前默认 GitHub 地址仍连接失败，
但 GitHub API 可访问。通过独立 DNS 查询得到可达地址，使用单次命令的 curloptResolve
保留 GitHub 主机名及 TLS 验证后 fetch 成功。未修改全局 Git 代理、DNS 或系统配置。
此记录只证明当时存在路由差异，不将其诊断成仓库或认证故障。
