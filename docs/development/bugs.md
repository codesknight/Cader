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

## 2026-11-19：集成补充

- BUG-001：在更新后的本地 AutoCAD-MCP c9a348d1 上，实际 DSH client 的只读调用通过。首次启动应用约 46 秒；旧超时未复现但根因未确认，不删除旧失败记录。HTTP 与固定干净环境仍需验证。
- 模型能力配置：用户最初预期 Pro 视觉；官方文档不支持。配置为 Pro 文本审查和 Flash 视觉，Flash 实际校准通过；未伪造 Pro 视觉成功。
- 依赖安装：pnpm 因 3 个未批准 build script 非零退出。核对包脚本和预构建分发后明确设为 false，安装与实际链路通过；没有整体放开安装脚本。
- RetryPolicy：锁定 DSH 的类型不支持 mode=none，改为 normal / maxRetries=0；没有开启未知重试。

- 初始文本探测中，Pro 未满足逐字 CADER_OK 的格式断言，但请求为 HTTP 200；该格式检查不标为通过，也不归因为连接失败。后续以实际 DSH 请求、工具结果、子返回和独立图片期望分别验收；没有声称逐字输出问题已修复。

## BUG-004：README doctor 命令被 pnpm 内置子命令截获（Resolved）

- 来源：#11 Quick Start 命令复验；旧 README 使用 pnpm doctor。
- 现象：pnpm 11.28.5 输出包管理器版本、缓存、registry、global bin 等诊断，而不是 Cader 的 JSON。
- 根因：pnpm 自带 doctor 子命令，与 package.json 中同名 script 冲突；省略 run 时先执行内置命令。
- 修复：中英文 README 显式使用 pnpm run doctor，不修改已可用的 Cader 脚本或历史运行记录。
- 复验：运行构建及 apps/cli/dist/index.js doctor，返回 ok:true、Node 24.9.0、DSH 0.2.2-rc.4。

## BUG-005：模型失败未汇总到 CLI（Resolved in #12）

- 用户反馈：QUOTA 只保存在 results / model.error，终态只显示 checks=false，易误判 MCP 连接。
- 根因：runLiveSmoke 只在 throw 分支设置 errorCode，没有检查返回的 failed AgentResult；顶层 catch 只输出异常类型。另有 agent/error 通路未捕获，离线 LlmError 注入发现漏报。
- 修复：共用固定错误码白名单与提示、区分 provider/mcp/configuration；捕获两条 DSH 错误通路；清理失败不覆盖主因。
- 复验：实际 DSH loop 的 QUOTA 帧/异常、MCP 发现成功、cleanup 失败组合通过；未重复真实付费 quota 请求。

## BUG-006：Python Windows JSON 重定向编码依赖环境（Resolved in #12）

- 用户反馈：默认输出含 GB18030，PYTHONUTF8=1 后可严格 UTF-8 解析。
- 根因：CLI 使用 print / ensure_ascii=False，但没有约定 stdout/stderr 编码。
- 修复：入口显式 reconfigure 为 UTF-8；不修改外部 MCP 服务或调用者系统设置。
- 复验：真实子进程强制 GB18030/关闭 UTF8 模式，中文 JSON 重定向和中文参数错误均通过严格 UTF-8 解码。

## BUG-007：smoke 静默忽略未知任务参数（Resolved in #12）

- 代码复核：旧 CLI 只查找已知参数，不拒绝 --task 等附加内容，但发送的仍为固定只读指令。
- 修复：严格校验 smoke 参数；用户任务走独立 exec。非法参数退出码 2，不加载凭据或启动 CAD。
- 绘图未实现属于既有需求，不将其归因为 MCP 故障；受控写入继续在 #3 验收。

## #13 接入边界与风险记录（非本项目 Bug）

- 上游固定快照未发现 LICENSE，不复制分发；原始研究快照仅在 .cader。许可状态需后续独立确认。
- 直接 COM、强制重启和写重试不满足当前 MCP 授权/文档绑定/对账边界，不能随 Skill 开放。
- 静态观察到图元数量不足以验证几何、上游 finite 未递归 dict、视觉指标脚本的 pass 不含质量门槛；未运行第三方复现，因此不登记为已确认上游 Bug。
- 研究报告保存具体源码链接与版本。本轮自有集成用显式目录、角色/资源和路径验证、受限图片输入消除直接执行与任意文件读取入口。
