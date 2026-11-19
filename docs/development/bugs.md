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

## #14：图片输入与绘图就绪情况

- 10张用户JPG原先不在PNG-only入口支持范围；新增JPEG帧头识别与image/jpeg附件，通过真实JPG模型识别及离线边界测试。输入兼容问题已修复，不推断绘图能力。
- 后端实测为COM，40工具发现成功。当前原子写入、文档/revision身份及保存重开契约未就绪，属于#3未实现/环境能力缺口，不登记为MCP连接Bug，不通过加入写白名单绕过。
- 私有清单检查脚本曾默认GBK解码UTF-8失败，显式UTF-8复验通过；与前述产品Python CLI修复分开记录。

## 2026-11-19：联合反馈回归（#15）

- BUG-008（已修复，待远端验收）：runTask的ok仅表示Agent运行，正文缺少正式业务状态。现在返回cader-task/1和五阶段，普通exec为unverified；显式redraw为blocked且不启动模型/MCP。离线真实DSH loop和无工厂调用测试通过。
- BUG-009（已补审计，真实复杂图效果待验）：整图附件缩放后没有可审计ROI和坐标链。增加原图区域工具与旋转、原图/视图/附件/实际请求hash尺寸映射，Sharp/DSH组件测试通过；不能据此宣称小字一定可读。
- BUG-010（未解决的真实识别问题）：外部联合测试报告门类型、文字、110/1100电压与拓扑误识别。已把类别加入独立事实/抽象连通图合成回归并阻止未知/冲突进入执行；未重新进行真实模型复杂图评测，未证明识别问题已修复。#14继续跟踪。
- 外部能力缺口：本地COM不支持本轮受控协议；MCP新工作图/保存/重开待对齐，真实DWG闭环未执行。不是MCP连接失败，也不是用户未授权。#3继续跟踪。

#15远端复验补充：d061b55的CI run 44475849146共4/4 jobs成功，BUG-008状态改为已验收；BUG-009仅审计能力完成，BUG-010真实识别问题保持未解决，不因合成回归通过而关闭。

## 2026-11-19：MCP语义对齐问题（#15 / 待CI验收）

- BUG-011：原重开Binding错误要求managed=true；修订为managed=false/read_only=true且绑定source_artifact_id，工作图和验收图在类型上分离。fixture验证合法只读重开通过、可写验收图被拒绝。
- BUG-012：原failed rolled_back要求revision不变，与observed_database_events冲突。改为权威失败后revision>=提交值、独立核验后终止；新图也不再强制revision=0。权威状态缺失/倒退仍冻结。
- BUG-013：对账统一要求job.document_id等于原图，会误拒重开。改用operation及输入/结果图/artifact校验，重开超时后新结果ID可对账，不续写或解锁。
- BUG-014：明确失败后的查询异常可能走finally释放全局锁。改为无法核验状态即保留锁，覆盖查询异常及残留实体反例。
- 这些是Cader契约/状态处理问题，不归因为MCP执行失败；真实DWG闭环和BUG-010图片识别问题仍未解决。

BUG-011–014验收补充：Cader实现eed2f33的CI run 44480295260共4/4 jobs通过，状态改为本侧修复已验收。MCP新profile及真实DWG联合验收未执行，BUG-010真实识别问题不因此关闭。

## 2026-11-19：真实闭环环境与复核（#15）

- BUG-015（环境限制，已绕过，根因未定）：隐藏启动无可用Bridge/窗口，普通启动后ROT先指向旧归属进程；PID保护在初始化前拒绝。确认归属后结束无写请求的失败启动，以正常专用实例和attach-only初始化完成实测。没有据此诊断MCP协议失败，也未放开安全设置。
- 额外复查中的REVISION_CONFLICT是预期保护：批处理revision16在后续源图观察时已为25，读取权威状态后只重读通过，不作为写入重试理由；不统计为绘制失败。
- 收尾私有辅助脚本初次缺少psutil、误读原生status信封，在关闭前守卫退出；使用现有进程查询和正确字段后推进。第一次关闭后观察有RPC_E_CALL_REJECTED，重新观察剩余归属文档后清理完成。不是Cader绘图调度器失败。
- 固定几何真实文件闭环已通过；BUG-010复杂图识别仍未解决。模型驱动调度、真实写响应丢失和长期稳定性未验收。


## 2026-11-19：交互终端与Windows入口（#16 / #10）

- BUG-016（本地修复，待CI）：裸CLI无参数仅打印帮助并退出2，没有持续会话。改为TTY启动彩色交互，非TTY帮助退出0；help/version无需配置和API，保留exec JSON。新增真实CLI子进程回归及Windows PTY证据。
- PowerShell环境限制：pnpm命中pnpm.ps1被执行策略拒绝；使用pnpm.cmd及用户目录cader.cmd，不放宽执行策略。原Node全局目录EPERM为已确认ACL限制，改装用户既有PATH目录，不夺取管理员目录权限。
- TERM=dumb为初次PTY补全失败的已确认条件：Node使用简化Readline。保留原生编辑、显示简化提示；支持VT的PTY声明xterm-256color后补全及Esc清行正常。未对真实终端能力进行未经验证的强制假设。
- 本轮真实provider QUOTA属于配额/权限环境，根因代码已传播，未归因为MCP失败；没有重试付费请求，真实多轮验收保持未通过。原BUG-010复杂图识别仍未解决。
- CAD任意DWG打开、受控撤销与CAD快照为尚无公共接口的能力缺口，不通过菜单伪装执行或扩张只读白名单。

BUG-016验收补充：实现c68dffc的[CI run 44539527045](https://github.com/codesknight/Cader/actions/runs/44539527045)共4/4 jobs通过，状态改为已验收。终端可用不代表QUOTA或尚缺的CAD接口已解决。


## 2026-11-19：CLI文档可发现性（#17）

- 用户反馈：CLI说明分散在README、架构和开发记录，缺少专门的开源用户手册。新增中英文手册与文档导航，入口和更新责任写入README、AGENTS及开发流程。
- 这是文档缺口修复，不增加运行时Bug编号；命令/链接/离线示例核对通过，CI结果另记。既有QUOTA、BUG-010复杂图片识别及CAD接口缺口状态不变。

#17文档缺口验收补充：fb2d766的[CI run 44551809258](https://github.com/codesknight/Cader/actions/runs/44551809258)共4/4 jobs通过，公开双语手册与维护入口已验收；没有据此关闭运行时或CAD能力问题。
