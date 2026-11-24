# Bug 与排障记录

2026-11-24 REQ-044/045 / #20：BUG-048～050已实施代码修复，最新180项离线测试通过；复杂原始手稿完整验收仍进行中，保持待验，不关闭Bug。

- BUG-048：已实现截断/模型响应TIMEOUT后的两次有界账本检查恢复、语义单元、8项Patch及共享轮预算/能力收窄。真实触发过两次截断恢复无重放；后续实际完成21单元、95确认写入、0 unknown并生成待验DWG。初版仍截断及累计token暂停的失败保留。
- BUG-049：已支持1～8具名端口/分支外部netlist、源端子映射/分组保持、真实符号端点、已证实同点直接接触和非连接交叉。原图明确分组冲突不猜测；不确定关系不得当成确定断开。专门源图拓扑视觉条件参与完成判定。真实完整通过待最新回归，旧同点误报保留。
- BUG-050：已独立清点所有文字并逐位置裁读，不确定项单目标扩大复核，校验更新边界；坐标映射现传入实际模型，不只落日志；用户明确确认按原图hash/位置/请求原文记录，并保留原OCR。全部9处标注已进入真实计划；旧漏读/串读/模型不确定报告保留。当前未将文件可读标为完整质量通过。

[原审计](../validation/2026-11-24-reference-circuit-audit.md) · [实施/逐次失败及真实DWG证据](../validation/2026-11-24-reference-circuit-fix.md)。

BUG-051（REQ-045回归新增，#20）：完整原图运行`quality-fff7f69d-1759-4649-8740-df0aa06d3017`续派Patch时，一条导线被WIRE_CROSSES_COMPONENT明确拒绝在派发前，前叶已确认、unknown0/frozen=false；适配器却将任何续派错误统一置为CONTINUATION_OPERATION_FAILED，无法让模型修正。本轮54确认并保存18781字节待验DWG，图与失败保留。现仅在原绑定、未冻结、增量账本全部为committed或dispatched=false的failed_before_dispatch且确有后者时，将真实部分结果及余下未派发请求返回模型重新规划，不重放原Patch。缺账本/变绑定/unknown仍停止，失败预留不退还；4个实际DSH路径回归通过（总172项）。同原图新一轮真实验收仍执行，未把fixture算完整绘图通过。

BUG-052（REQ-045回归新增，#20）：`quality-4ac644e3-6d2b-4830-8e10-03bfd47603f0`源网复核工具多次漏索引/重复端子，最终无有效报告却泛称SOURCE_TOPOLOGY_UNCERTAIN。现动态Schema要求每个已有object:terminal为必填membership属性，每端只赋一组，程序生成groups；新增器件端子、未知组名/索引、漏端子仍严格校验，不修补猜图。错误区分SOURCE_NET_REPORT_INVALID与关系不确定。173项/typecheck/smoke通过，当前原图真实回归继续；不把Schema覆盖等同于像素识别已通过。

BUG-053（REQ-045回归新增，#20）：`quality-91dc6619-d2e6-4c64-9bc3-2fe2c7c75eaa`计划文字及计数条件指定LABELS，逐项Scheduler仅传组件/网/源文字，未传这些封存条件；8个真实AcDbText均在TEXT，导致精确文字验收全部不匹配。不是MText缺字段或MCP未绘制。现每单元带去重required_layers及文字/计数/组件图层约束，setup和后续修正沿用，示例层名不覆盖计划；不放宽验证器。新增跨setup/组件/网络/标注的自定义层契约fixture，174项/typecheck/smoke通过，最新完整实机复验另记。

BUG-054（REQ-045回归新增，#20）：`quality-f5b95774-831e-4896-9f05-10f34d88757b`用户已明确提供全部标注值，模型仍跳过确认工具，让2处保持uncertain，仅画7处并提前停在待验。现有确认文本时，规划入口强制逐项审定不确定标签：适用者按真实原文绑定，不适用者显式记录unconfirmed理由且仍待验。不能忽略确认，也不强制把无关值变clear。源观察事件改为深拷贝快照，后续确认不修改早先OCR事件；原读数另保存。175项/typecheck/smoke通过，实际同图复验另记。

BUG-055（REQ-045回归新增，#20）：同轮规划把原图符号擅自要求为12个AcDbBlockReference，而实际为原生图元，source components为11。该表示法非用户要求且符号单元未承诺生成块；不能靠换成另一个任意图元数量验收。现参考任务未明确请求图块/块引用时在规划工具拒绝此约束，要求用符号视觉覆盖及源端子/netlist验收。fixture拒绝/正常自定义图层路径通过；验证器不放宽。

BUG-056（REQ-045回归新增，#20）：`quality-c2568bb0-98fb-4d3b-ab40-65b6963e8ac5`源图拓扑视觉条件以CAD图B缺少T接点实心点、微小间隙不可辨为由uncertain，缺少源端子与原生CAD分组映射。现提供位置索引/封存CAD端子映射及原生验证状态；该条件必须提交原图A的结构化membership与分组证据，程序比较CAD分组并约束checklist一致性。原生关系未验证、源图真不清或分组不匹配均不能通过，不自动把uncertain改pass。180项测试覆盖反例与一致性修复；当前真实回归另记。

BUG-057（REQ-045回归新增，#20）：同轮确定性检查只报overlap=true，未列重叠导线ID，模型修正缺乏定位。现返回导线对、各段端点、重叠轴/区间及总数，最多32对进入上下文；全图快照保留可重算。硬验收仍拒绝重叠，不自动删除或重放。fixture验证具体ID/正区间。

BUG-058（REQ-045回归新增，#20）：同轮首次规划调用8次补充裁图，共报118322 token后失败，紧凑重试再报173472；原图/独立观察已附带，父Agent反复裁图消耗总额度。现规划每次运行最多2次补充裁图，动态工具集/剩余额度和执行层均约束，伪造隐藏调用仍拒绝；原始图及独立Vision读取不被取消。任务2M总额度和8192单响应未增加。实际DSH正常/伪造路径通过，同图成本及完成状态待复验。

BUG-059（REQ-045回归新增，#20）：`quality-5aa73f47-0b99-4a36-b4ab-06200706b4a2`最终结构化源网复核明确指出原图底部回线笔触歧义，用户随后确认连通；此前只有标注确认工具，独立源网工作器也未收到完整请求，不能可靠继承连接澄清。现增加规划期`cader_confirm_source_connections`，逐字用户确认/hash/源端子绑定并保留原网表；仅合并已确认关系，未覆盖疑点和不确定桥仍保留。封存前必须审定连接确认，不能以常见电路补线。最终复核保留raw_report、确认及审定分组，未知CAD屏障不变。185项/typecheck/DSH smoke通过；含全部9处人工标注和一处连接确认的原图实机仍在执行，不能称纯OCR或完整质量已通过。

BUG-060（REQ-045回归新增，#20）：第25轮源网/文字值通过后，实际CAD截图显示字号过大、标注压器件，源极性既由组件线段绘制又被当作独立文字重复添加。视觉正确拒绝完成，修正时达到2M总额度：103 committed/0 unknown，23305字节待验DWG的86实体经原生同hash副本只读重开一致、其他图未变；独立文字清点仅2/5类合格，不算质量通过。现标注单元提供源框转换后的基线锚点、尺寸和字号上限建议，极性纯标点归组件细节，拒绝未请求的纯标点文字数量；活动单元不重复整份源报告，保留完整审计。视觉/原生硬验收仍强制；没有增大总预算或自动替用户改图。186项/typecheck/smoke通过，新同图完整回归继续。

BUG-061（REQ-045回归新增，#20）：第26轮源网仲裁将初读explicit uncertain关系也当作known clear，独立复核虽纠正了另一处关系，却因底部仍uncertain而整份报告被拒，0 CAD写入。现只有两份观察均明确的关系参与硬冲突判断；复核已明确的关系可替代初读疑点，仍不确定处保留旧候选但不能桥接两个新明确组。后续局部复核以已有有效报告为基准，不允许无关疑点让已明确关系倒退；新增器件完整保留。188项/typecheck/DSH smoke通过；完整原图继续，初读无certainty的旧冲突fixture改为显式clear，未放宽明确冲突反例。

2026-11-24 REQ-043 / #20 / MCP#43：BUG-045的Count/CopyFrom截图恢复分支及BUG-047视觉失败绿色勾号已修复，恢复后状态读回/备份清理/请求关联均强制，未知仍保护。实机发现非活动文档ActiveLayout可能指向活动文档，新增Layout.Document/ObjectID绑定检查，并用ModelSpace.Layout确认旧图未变。回归首轮还发现Layers.Add动态解析错误，复用只读就绪/单次调用修复；Drawing18旧unknown保留。两轮原始绘本整体通过、10次复杂图重复捕获恢复通过；另一次风格uncertain保持待验证，历史蓝图根因、文件验收和纸布局自动路由仍未宣称解决。[分层结果](../validation/2026-11-24-capture-restoration-fix.md)。

2026-11-24 REQ-042 / #20：BUG-045原生截图/恢复故障在用户Drawing17复现，48次绘图确认、预算充足，export Count异常及CopyFrom/COM拒绝使恢复状态未知；无PNG或实际VisionAgent调用。保留冻结，未修复。新增BUG-047：视觉失败的控制交接isError=false导致CLI绿色勾号，visual_attempt_count还包含截图失败，需拆分业务结果及真实视觉次数。dev.10异常交接本次确已生效。[证据](../validation/2026-11-24-house-capture-audit.md)。

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


## 2026-11-20：BUG-018 模型与CAD执行链断开（#18）
用户日志中的拒绝已由源码确认：会话无默认MCP、工具按read_only_tools过滤、静态提示全局禁写。已有固定计划Scheduler不服务模型动态请求。
修复：持久MCP连接、真实schema封装转发、主Agent动态请求、四权限及程序执行层、工作图/文件保护、共享锁和写后查询。
首轮真实Pro模型完成绘制与保存但验收器将AcDb2dPolyline误判为错误；旧失败保留，补充顶点/闭合/颜色独立检查后通过。
初始文件回归46/47：绝对路径包含测试根.cader导致误拦；改为相对作用域+规范路径检查后47/47通过。
实际模型/真实CAD通过不替代CI、COM受控重开或真实响应丢失验收；这些边界见验收报告。原BUG-010复杂图片问题保持未解决。


BUG-019 (#19): v0.3吞掉首发错误，将已确认写入后的读回失败与未知派发混同；后续未派发请求也称未知，模型误诊空COM状态。修复分段证据、blocked_not_dispatched、健康/受限恢复、动态写工具隐藏及任务blocked报告。新实机捕获Name就绪异常、postflight RPC_E_CALL_REJECTED和视图导出超时后PNG延迟到达；这些后端问题尚未修复，未认定为历史draw_line唯一根因。二维点展平误绘由Cader preflight拦截，MCP原生schema修补另待授权。

## 2026-11-20：BUG-020 自主质量门槛缺失（#20）

已证实：最新用户日志需要用户主动要求视觉；无效报告后仍有“基本合格”描述。源码原先只有主动评审工具，无任务验收阶段。dev.2新增调度状态机、不可变清单、自动几何/拓扑/视觉及程序完成门槛。四轮真实模型/CAD实验均未通过完整质量，但全部正确保留pending/blocked，没有以模型正常结束冒充完成。安全恢复、取消及不重放离线通过；完整实机验收保持打开。

BUG-021：视觉自由文本截断/非schema造成structured=null；DSH raw schema投影还拒绝zod非纯JSON元数据。修复严格提交工具、JSON schema规范化、一次格式修复及6144视觉预算，记录max-tokens。旧组件fixture的“fixture”判定并非合法业务报告，已更新为明确的合成严格报告。实际DSH截断→修复的两次尝试都有保留；真实CAD出现多次review_valid=true，不等于视觉内容必然正确。

BUG-022：真实模型验收计划把语义符号当原生类型、组件位置重复及端口位于禁入区域；先验证计划再写入，schema约束及精确图相交回归通过。初版任务授权测试改变返回ObjectID后，使原测试未命中get_entity读回故障；已让故障fixture覆盖目标读回和全图读回，最终全测通过。

BUG-023：真实图像有疑似裁切、视觉/几何分歧及无关uncertainty导致无谓重验。增加保守边缘证据、ObjectID校验、观察稳定性、分歧记录、域知识和非可定位问题pending；不会直接把视觉uncertain改为pass。E第4次捕获未知派发，Drawing5被冻结，unknown=1；没有重放/删锁。原生缺少显式fit-to-page只是根因假设，权威像素映射仍未实现。最后调度优化仅离线回归，实机冻结恢复与完整案例保持未通过。证据见[实测与JSON](../validation/2026-11-20-autonomous-quality.md)。

BUG-024（#20/#19，已定位、未修复）：12:32用户日志中draw_text缺height，原始MCP工具schema没有客户端执行前输入校验，明确参数拒绝被统一归dispatch/unknown而冻结Drawing6。实际DSH无CAD fixture复现缺required仍进入execute；已有defineTool测试没有覆盖真实原始定义。另确认turn/session计数语义、旧全图缓存与文字过滤查询、COM not_probed误诊、recover调用成功但业务拒绝及错误回复重复渲染。完整证据和修复验收清单见[12:32审计](../validation/2026-11-20-user-log-1232.md)。本轮仅诊断，保留锁，未操作CAD或修改相邻MCP。

BUG-024 dev.3复验：已修复Cader客户端/执行层和整批补丁schema预检，可信本地拒绝分型、作用域/缓存/原始错误/恢复资格、程序诊断/恢复及输出去重；原始raw-definition回归覆盖缺口已补。真实发现schema的缺height输入未派发未冻结，真实Flash随后确认17次写入（文字2）并自动进入视觉；unknown=0。旧Drawing6锁不自动迁移或清除，远端文本不能证明无副作用。结果见[报告](../validation/2026-11-20-schema-preflight-fix.md)，代码检查/CI另记。

BUG-025（#20，后续）：上述实机计划的描述指电源包围盒内图元，结构化component却为空，entity_count按全图计数，导致实际10对期望2..8失败；描述与结构化执行语义未对齐，完整验收未通过。现有计数路径也未实现组件范围，应明确全图/组件语义并独立验证计划覆盖，不能为该案例调整阈值。原BUG-023疑似裁切仍存在，屏幕映射/原生导出范围未修复。

2026-11-21当前状态：BUG-024参数预检、分型、诊断及输出修复已通过raw入口回归、69项本地测试、真实文字/自动视觉阶段及`660153f`的Windows/Linux CI。上面的“已定位、未修复”为初次审计历史记录。BUG-025与完整图纸质量、原生捕获/像素映射仍未验收，#20及Milestone保持打开。

## 2026-11-21：BUG-026 旧缺参屏障升级后无可审计处理入口

已证实：13:02新任务计划后blocked，原因是Drawing6历史draw_text缺height的dispatch/unknown屏障，不是新任务又写失败。原连接消失应拒绝自动recover；缺陷是启动提示和模型前阻断不足，以及没有人工复核出口。dev.3修复新请求预检不能追溯撤销旧unknown。

dev.4补齐启动读取、绘图模型前blocked及用户`/mcp barrier`、`/mcp resolve`。仅缺参原锁/原始日志/当前schema证据一致才可人工审定；四权限均须明确确认原请求未执行且无延迟操作。保留原始unknown及hash决定记录，不以人工判断冒充原生证明；关闭连接、清空授权、只允许新建工作图，不重放。真正超时/断连/捕获、原生错误、活跃其他写进程或变化证据拒绝。

当前真实MCP发现只读核对通过：Drawing6缺height候选，原锁hash未变，没有调用resolve/模型/CAD写入。程序/CLI合成回归通过，真实用户批准归档及新房子/树任务未执行。开发中初次测试把缺失plan误断言为null而失败，修正为实际undefined后通过；没有将旧失败抹除。完整检查/CI及层级见[报告](../validation/2026-11-21-legacy-barrier-review.md)和[测试记录](testing.md)。BUG-025和原生可靠性问题不因此关闭。

BUG-026本侧代码验收：`5638f41`的[CI 44871945247](https://github.com/codesknight/Cader/actions/runs/44871945247)四项全通过，启动/模型前阻断及人工复核程序路径已修复；真实用户批准仍未执行，不能报告其工作区已解除。

## 2026-11-21：BUG-027/028 依赖遗漏部分执行与失败原因被掩盖

BUG-027：17:24日志及原prepared记录证明未先create_layer就用HOUSE。MCP AddPolyline后才设置Layer，native key-not-found、读回0层残留实体。Cader缺少文档依赖预检，不能只归因于模型；MCP也缺少创建前检查和属性失败清理。dev.5加入双侧预检和本次新增实体尽力清理，真实未知仍拒绝重放。用户Drawing2旧屏障不自动解除。

BUG-028：17:22实际model.error=QUOTA，旧调度忽略规划返回状态、model_runs为空，误显示pending_verification和QUALITY_NOT_ACCEPTED。修复规划结果记录、失败直接blocked、首发错误码及冻结详情显示。无有效计划单独报告ACCEPTANCE_PLAN_MISSING，不误称已绘图待验。

真实用户日志已证明Drawing6经用户确认归档，BUG-026上面“真实用户批准未执行”为开发时历史状态；新Drawing2是另一次部分执行。离线回归与实机测试分层记录于[报告](../validation/2026-11-21-dependency-and-partial-execution.md)。最初新fixture缺InsertBlock分支、规划无结果分类断言不匹配分别失败；修正后MCP38新增例和Cader79总例通过。MCP首次pytest误在Cader根使用相邻环境导致cader_mcp导入失败，正确目录全量216通过/33跳过；不是产品运行失败。全量/CI状态另记，BUG-025及完整质量不因此关闭。

BUG-023 dev.5补充：第一轮真实房子/树已确认16写入，但export超时后PNG延迟出现；背景打印未设0、打印比例及配置恢复不完整由源码确认。新图实测原变量2，改前台打印/fit/完整快照恢复后，独立真实导出1.110秒通过且设置恢复一致。5例导出回归通过；仍不声称所有历史裁切/原生时序、像素映射或任意图纸均已解决，第二轮完整质量结果另记。

本侧修复验收：Cader89f31de的CI44891799500四项成功，MCP538db9c的CI44891530548两项成功。BUG-027依赖防护与部分清理、BUG-028规划/显示修复通过对应回归和真实集成。第二轮真实房子/树18确认/unknown0且自动视觉有效，完整质量仍pending（BUG-025类型/需求语义，截图边缘）；不关闭#20或把所有屏障根治标为完成。独立dev5工作区真实CLI启动通过，原用户Drawing2锁保持原样。

BUG-029/030（#20，已证实、未修复）：用户手稿路径只是文字，所有相关运行imageProvided=false；文件复制不注册，delegate非法image_ref被拒绝。复现措辞漏quality路由；规划步骤不显式传源图/历史，普通对话反复统计像素并要求无效GUI上传，未调用新图/绘图/保存。最后quality却检查旧房子/树，是源图与任务/结果缺绑定，不能算手稿验证。人工直接查看原始图可辨识基本电路结构，统计特征不足以断言无法重绘。只读review Skill和exec redraw遗留禁写为已确认潜在限制，不单凭其存在归为本次每一轮拒绝的唯一原因。无模型/CAD装配复现明确普通路径false、/open后true；完整证据及待修清单见[审计](../validation/2026-11-21-reference-redraw-audit.md)。

2026-11-21 REQ-034后续：BUG-029/030输入/路由/旧图验收根因已修复，88例回归及真实原图→新图→DWG链路证实。外部源复制为不可变快照，规划/绘制显式给图；旧图无本任务几何则拒绝验收；双图、哈希、文档与实体ID校验。续验无主模型响应时误报失败亦已回归修复。真实结果尚有质量未通过，不能把链路修复当作任意手稿合格重绘，#20保持打开。后续真实模型暴露输出截断、错误布线和视觉幻觉实体ID，分别扩预算、写前计划约束、有限次报告修复；各失败run及剩余条件见[记录](../validation/2026-11-21-reference-redraw-fix.md)。

BUG-031（REQ-035，#20）：实机数学负号与普通短横被判不匹配；源码还会忽略SI大小写及做子串匹配，合成复现5V/15V、m/M误通过。已改为规范化完整标注和数量检查；真实最终手稿标注及负号条件通过，原始文本保留。

BUG-032（REQ-035，#20）：视觉报告自改/遗漏验收ID，拓扑只报度数列表导致修正无定位；模型还使用查询无端点的多段线导线。已约束清单ID集合、提供断点/端口/距离/实体及边界证据，并在串联导线图层写前拒绝未支持创建类型，符号层保持可用。schema/派发前不冻结回归通过；旧失败和预算耗尽保留。

BUG-033（REQ-035，#20）：真实low对照曾程序complete但独立源图标注期望失败，属于误验收。已加最多4处真实标注裁图复核及清晰文字→计划绑定，不确定时只交待验稿；最终相同手稿用例17条件、原生文件重开及独立标注期望均通过。仍是同一视觉profile，不能据此保证任意OCR不出错；旧complete原记录保留，报告明确独立验收失败。

BUG-034（REQ-035，#20）：普通绘图计划擅自加入未请求的保存条件，修正后未保存又无法完成；已在规划工具拒绝这类额外文件门槛，合成回归通过。灯泡首轮还暴露模型自设图元数量上限和预算消耗，完整回归结论另见[本轮记录](../validation/2026-11-21-complete-quality-retest.md)，不因此关闭总体#20。

BUG-035（REQ-035，2026-11-22收尾）：灯泡第三轮修正后捕获Add.Delete，46确认/1unknown，保留原屏障。独立MCP源码与回归证明Add包装未就绪及finally保护外方法读取掩盖首发异常；80a07bd按名有界重读且保护清理，5次真实导出恢复及227/33、CI通过。不自动修订旧unknown，未混入无关相邻改动。

BUG-036（REQ-035，2026-11-22收尾）：灯泡14项必要检查全pass但视觉总评uncertain，理由为已证明的精度和未要求的手稿。schema现拒绝这种矛盾，要求绑定具体条件或重报，不直接放行。普通组件计划也不再接受未请求的线段数硬上限。最终原始灯泡23确认/unknown0、11项全过，真实保存及独立重开一致；手稿17项亦通过。见完整复验记录，#20仍为总体未完成工作项。

BUG-037（REQ-037，#20，2026-11-23）：首轮已经视觉但主Agent无任务历史且质量模式隐藏自主入口，随后误答“此前没有”；偏好文本误建绘图计划。已通过统一受控入口、每步任务状态/历史只读路由、规则/继续分流修复；两个真实用例均主动视觉并与Harness复用。旧capture_bounds原因仍待独立排查，不因本次图像未裁切便关闭捕获可靠性问题。

BUG-038（REQ-037，已证实并修复）：DSH schemas(agent)表示注册可见定义，未应用本步when准入，Available可能宣称隐藏delegate可用。实际请求级测试发现，已改读assembly.toolSet；catalog与函数可用状态一致，guard保留。新视觉进度事件也曾覆盖质量阶段字符串，可能放开修正阶段new_drawing过滤；现仅task.phase更新阶段，专项回归前后均拒绝。100例、typecheck/smoke及最终真实执行通过，CI另记。

BUG-039（REQ-038，#20，已确认故障、原生诱因待验证、未修复）：15:13新工作区首条new_drawing返回<unknown>.Add，无ack、unknown1而冻结；不是视觉入口或旧锁问题。MCP Documents.Add调用前未保护方法解析，且connect无文档时隐式新建后显式new_document可能再次新建；该分支存在，本次是否命中缺前态。只读观察已有空Drawing5，不能证明创建归属或无执行；须补原生阶段证据/有界只读就绪/单一新建入口，不能按错误文字解锁。完整证据见[审计](../validation/2026-11-23-new-drawing-add-audit.md)。

REQ-039修复：BUG-039原生边界经离线、stdio及3次真实新建验证；旧未知不回溯。BUG-040：120秒主回合包含绘图/子视觉且继续自修，已改任务/API时限分离并交回Scheduler。BUG-041：普通插画自定图元上限/截断计划，已拒绝无依据上限、允许generic空端口及一次紧凑重试。BUG-042：质量全过但旧视觉格式错误污染总报告，已仅在当前必要条件全过时关联失败视觉的替代结果，不抹历史、不隐藏主模型失败。实测与CI见[记录](../validation/2026-11-23-native-document-create-fix.md)。

BUG-043（REQ-040，#20，已证实未修复）：review后的snapshot失败绕过成功路径concludeTurn/reviewSubmitted，模型继续drawing阶段自修直到预算耗尽，round未计。BUG-044（设计缺口，未修复）：全局工具扁平计数100含Patch父/叶，缺整批预算预检与验证预留；最后32项中6已执行，非冻结但部分完成。BUG-045（空间口径风险已证实，历史蓝图原因待核）：全图ModelSpace、范围SelectionSets与ActiveLayout导出不一致，当前纸布局且导出蓝屏；不能以不完整图像缩放整图。原生snapshot失败详情亦未审计。见[证据及方案](../validation/2026-11-23-tool-budget-audit.md)。

2026-11-24 REQ-041：BUG-043/044已在代码修复并经真实模型自动续轮/视觉通过和异常fixture复验；失败快照现有协议审计。首轮实测另证实“精确耗尽时模型自行结束而未续轮”，已改pre-step主动交接并复验。BUG-045仍未修复，真实Plot恢复COM拒绝产生的unknown保留。新增BUG-046（未修复）：save已ack但后读回失败，对账恢复后缺文件验收；同时计划把精确坐标/图层名设为视觉要求，缺确定性表达而保持待验证。真实10圆与DWG独立核对成功不能替代缺失的Harness证据。[记录](../validation/2026-11-24-budget-continuation.md)。
