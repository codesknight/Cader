# 测试记录

## 2026-11-24 REQ-043：截图恢复与视觉状态

最终本地 `pnpm typecheck`、`pnpm test` **139/139**、`pnpm smoke` 通过，`cader -v` 为0.4.0-dev.11；手册131本地链接/22锚点与diff检查通过。新增真实DSH业务结果×/!/✓、截图失败不计模型请求、真实stdio关联/错文档/错nonce/状态不一致/legacy冻结与未识别文档的无变更预检证明；fixture不冒充真实CAD。MCP独立全量pytest **246 passed/33 skipped**，5个改动Python文件isolated ruff I/F通过，发现基线仅export_current_view更新；Cader自身Python未改。

4轮均用显式`pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task "新建画布，画一个房子，红屋顶蓝墙，旁边有棵大树，儿童绘本风格。"`，无固定绘图计划。两轮完整成功5/5、8/8，36/35确认/unknown0；一轮先遇Layers.Add，保留unknown后修复方法解析；另一轮截图全部恢复正常，视觉仍风格uncertain，3轮修正后pending，未标为通过。两张复杂图共10次独立原生导出全部恢复/清理核对通过，不当成10次完整模型验收。仅关闭自建无unknown图，Drawing17及失败Drawing18和旧屏障/审计保留。[运行ID、hash、代码与限制](../validation/2026-11-24-capture-restoration-fix.md)。CI/提交后续补记；完整DSH app profile、任意任务和旧图解冻均未宣称通过。

2026-11-24 REQ-042只读排障：读取用户附件、quality/events/execution/锁及相关源码，核对6模型步骤、48确认CAD操作、51读回实体、402ms导出失败、视觉启动/图片请求/报告均0、预算未耗尽、无目标PNG。未运行模型/原生CAD、未重放或恢复；运行时代码未变，本轮未新增回归/真实绘图验收，旧123通过不覆盖本次导出异常。屏障SHA256为BD0DCFD61D19571427BB16C9528170EACA3E7FAE9A5C6071339417B27DC36045，未改写。[审计](../validation/2026-11-24-house-capture-audit.md)。

## 2026-11-18：DSH 切换

环境：Windows；便携 Node 24.9.0、pnpm 11.28.5、DSH 0.2.2-rc.4、Cordis 4.1.0；
Python 3.11.15、MCP SDK 1.28.1。配置与完整性哈希见两个锁文件。

| 检查 | 命令 | 实际结果 |
|---|---|---|
| TS 编译和类型 | pnpm typecheck | 通过 |
| DSH 组件 / 插件 | pnpm test | 2 passed：6 个 smoke 检查；后置 allow 无法绕过 guard |
| DSH CLI 与日志 | pnpm smoke | 6/6 检查通过，配置/事件/验证/摘要已写入 .cader/runs/ |
| Python lint | uv run --project cader-mcp ruff check cader-mcp | 通过 |
| Python format | uv run --project cader-mcp ruff format --check cader-mcp | 通过 |
| Python 测试 | uv run --project cader-mcp pytest -q cader-mcp/tests | 8 passed |
| MCP 协议 fixture | uv run --project cader-mcp cader-mcp smoke | 3/3 检查通过 |
| Windows / Linux CI | .github/workflows/ci.yml | 4/4 jobs 通过：Python MCP + DSH 组件各覆盖 Windows/Linux |
| 完整 DSH app / 真实模型 / 图像 / CAD 写入 | 未执行 | 保持 M0 待验证 |

DSH fixture 覆盖实际组件装配、参数 schema 校验、合成写入拒绝、预取消、事件和插件卸载。
预取消不触发普通 tools/result；CLI 单独记录取消。fixture 不计入真实 CAD 成功率。

## 历史基线（回填）

提交 `54d2ebf`：原 Deep Agents 基线 9 项 Python 测试通过，Windows/Linux CI 通过。
旧 runtime 已退出当前 CI，不将其 9 项计入迁移后的用例数。
实机：最初 tools/list 36 个工具、list_layers 2 个图层；之后两次 TimeoutError，仍未关闭。
详细证据见 docs/research/smoke-2026-11-18.md；本轮没有重跑实机或修改 AutoCAD 状态。

## 远端验收证据

代码提交：`ce7e9ce`。CI：[run 44324330594](https://github.com/codesknight/Cader/actions/runs/44324330594)，4 个任务全部 success。
DSH 原始组件 smoke 日志作为各平台 CI artifact 上传；该 CI 不执行真实模型或 AutoCAD。

## 2026-11-19：YAML / 真实 DSH / MCP

- TypeScript 配置与运行测试：9 passed，typecheck / frozen lock 通过；新增配置秘密隔离、非法 YAML、Pro 图像拒绝、5 槽队列、realpath 越界和实际 DSH loop 的离线消息/预算测试。
- 真实 CLI 7/7 检查通过：MCP 发现、实际 AutoCAD 只读调用、子返回主、主完成、子无委派入口、图片输入、独立视觉验证。
- 实际子 Agent 并行峰值 2；7 个 fixture 子任务测得峰值 5，无泄漏槽位。
- 图像测试为合成校准图，通过附件服务输入；不声称 MCP CAD 图片链路或图纸识别性能已验收。
- 实机上游 HEAD c9a348d1，既有 web 改动保持原样，MCP 发现 36 工具；没有 CAD 写入。
- CI 无密钥、无付费请求；真实运行输出仅在 .cader/runs。详见 docs/research/smoke-2026-11-19.md。

本轮 Python lint / format、8 项测试、协议 smoke 3/3，以及 DSH 组件 smoke 6/6 均通过。远端 [CI run 44353967017](https://github.com/codesknight/Cader/actions/runs/44353967017) 的 4 job 全部通过，对应提交 325a6cf。

## 2026-11-19：configs 迁移 / CLI First（#8）

环境：Windows、Node 24.9.0、pnpm 11.28.5；依赖锁未改。

| 实际检查 | 结果 |
|---|---|
| pnpm typecheck | 通过 |
| pnpm test | 9/9；实际 DSH loop 在无 provider I/O 下加载 configs 中的 Static 和 Skill，验证两阶段消息、角色隔离及共享预算 |
| pnpm smoke | 组件 fixture 6/6；本地记录 .cader/runs/dsh-component-2026-11-18T17-19-18-307Z-32c25bd6-f91c-4905-b6f9-645fc931b8dc |
| pnpm models | 三个 YAML profile 和运行配置有效，只输出 credentialConfigured，不发 API |
| loadMcp：configs/mcp 下 example 与 local YAML | 相对 cwd 与预期相邻 AutoCAD_MCP 一致，本机 command/cwd 存在；无进程启动 |
| uv run --project cader-mcp python：load_server | 三个迁移 JSON（HTTP 示例、stdio 示例、本机）有效，本机路径存在；无 MCP 连接 |
| git check-ignore | .env、configs/mcp/AutoCAD.local.yaml、configs/mcp/python.local.json 均忽略 |
| 新 CLI 原稿 SHA-256 | 与 D:/ChromeDownload/Cader_CLI_Design.md 一致；原稿不格式化 |
| 真实 API / CAD、社区 TUI、正式 cader bin / exec | 本轮未执行或未实施；不计入通过项 |

本轮不改 Python 源码，完整 Python lint / format / 8 项测试 / 协议 smoke 交由现有 Windows/Linux CI 回归。
原研究报告及历史日志的旧路径为当时证据，不作为当前命令示例；当前命令以 README 与 model-configuration.md 为准。

远端验收：提交 `08da13b`， [CI run 44357754943](https://github.com/codesknight/Cader/actions/runs/44357754943) 的 4 jobs 全部成功，覆盖 Windows/Linux DSH 与 Python。
发布前实际凭据扫描 26 个暂存文件、泄漏 0；10 个迁移文件逐字节一致；25 个当前变更文档相对链接有效；git diff --cached --check 通过。

## 2026-11-19：双语 README 与封面（#11）

- Windows / Node 24.9.0 / pnpm 11.28.5：pnpm typecheck、pnpm test（9/9）、pnpm run doctor 和 pnpm smoke（6/6）通过。
- README.md / README.zh-CN.md 的 48 个本地文件链接及自定义导航锚点有效；4 组 shell 块一致；pnpm 命令对应当前脚本，未把规划中的 cader 命令写成可用入口。
- PNG 签名和尺寸检查：2172×724、3:1、1,516,186 字节。已检查生成图中的 Cader / An extensible CAD agent / CLI FIRST 文案与构图；生成方式和最终提示词可追溯。
- pnpm doctor 首次验证执行了包管理器内置诊断，并非 Cader。更正 README 为 pnpm run doctor 后返回 Cader ok:true、DSH 0.2.2-rc.4 与 Node 版本；保留该发现于 BUG-004。
- 本轮不改 TS/Python 源码、不新增测试依赖。真实模型/CAD 未重跑；Python 全套由现有跨平台 CI 回归。
- GitHub GFM API：英文/中文各保留 4 张图片、4 张表格、1 个折叠区、语言切换及 pnpm run doctor。辅助检查最初误写 5 张表，核对文档实际结构后修正为 4，再次通过；不是渲染器丢表。
- 浏览器截图/点击视觉验收未执行成功：IAB 两次超时，Windows Computer Use 因无法可靠确认 URL 停止；保留该限制，不以 API 结构检查代替视觉通过。
- 发布前 8 文件凭据扫描泄漏 0；提示词文件末尾空行导致一次 diff --check 失败，修正后通过。
- 远端提交 0a417b2：[CI run 44360225897](https://github.com/codesknight/Cader/actions/runs/44360225897) 的 Windows/Linux DSH 与 Python 共 4/4 jobs 通过。

## 2026-11-19：CLI 反馈维护（#12）

- Node 24.9.0 / pnpm 11.28.5：typecheck 通过；13 项 TS 测试通过；组件 smoke 6/6；pnpm run cader --help 实际可用。
- 真实 DSH loop 的离线 QUOTA：覆盖 provider finish(error) 和抛出 LlmError 两条通路，故障同时注入清理异常；exec/live-smoke 的终态和 verification 保留 QUOTA/source/provider hint，事件与报告无 fixture 密钥。工具发现成功与 provider 故障独立。
- 用户任务实际进入模型消息，输出中文结果；工具 schema 保持只读范围。CLI 子进程在仓库外、无配置/凭据条件下验证帮助与空任务/缺失参数/未知 --write/烟测 --task 拒绝。
- MCP 启动异常、ConfigError 和不可信错误码覆盖来源区分与脱敏。
- Python ruff check/format 通过；10 项 pytest 通过；MCP 协议 smoke 3/3。新子进程在 PYTHONUTF8=0、PYTHONIOENCODING=gb18030 下验证重定向 JSON 及 stderr 中文可按严格 UTF-8 解码。
- 初次 TS 检查中，spawnSync 收到 URL 类型、CLI 测试路径多退一层导致失败，已修正；首次 thrown LlmError 漏报根因，补 agent/error 后通过。没有把这些初次失败记成成功。
- 本轮没有真实 API/CAD/写入测试。用户反馈的 QUOTA、40 工具及旧 GB18030 字节为外部实测线索，未声称本轮实机重现。
- 远端验收：实现 `92b79dd`，[CI run 44460992169](https://github.com/codesknight/Cader/actions/runs/44460992169) 的 4 jobs 全部通过，覆盖 Windows/Linux DSH 与 Python；22 文件实际凭据扫描泄漏 0，55 个本地文档链接和暂存 whitespace 检查通过。

## 2026-11-19：Skill 目录与重绘评估（#13）

- Windows / Node 24.9.0 / pnpm 11.28.5：typecheck、18 项 TS 测试、组件 smoke 6/6 通过；pnpm run cader skills list 与 skills show ... --resource assessment-format 实际输出正确 JSON。
- 新增 5 项有效场景：目录/角色/未注册文件；禁止脚本字段、重复名称、路径和大小；目录链接越界；坏 Skill/PNG 在 MCP/模型工厂前拒绝；真实 DSH loop 中的选定 Skill、按需资源、PNG 附件与只读 schema。
- CLI 进程在仅有 Skill 文件、没有 models/runtime 配置且无 API key 的临时工程中，list/show 成功；验证确定性发现不依赖 provider。
- 图片链路测试使用已存在的合成校准 PNG 和离线响应，不评估视觉正确性；只验证附件/上下文传递和权限。PNG 预检为边界、大小和头信息检查，不宣称完整解码或图像质量分析。
- 未执行上游脚本、真实 API/CAD、DWG/PDF/DXF 重绘或视觉指标计算；10 脚本的检查为静态分析，非第三方测试通过。
- 不改 Python 代码或依赖；完整 Python 回归由现有 Windows/Linux CI 执行。原设计、密钥与相邻 MCP 仓库未修改。
- 实现 `cda8c75` 的 [CI run 44462708123](https://github.com/codesknight/Cader/actions/runs/44462708123) 共 4/4 jobs 成功：Windows/Linux 的 18 项 TS、10 项 Python 及各自 smoke、Python lint/format 均通过。发布前实际凭据扫描 22 文件泄漏 0，63 个文档链接/锚点和暂存 whitespace 检查通过。

## 2026-11-19：用户图片与后端实测（#14）

- 原始资料16文件哈希前后相同；14/14 PNG/JPEG边界/头/大小预检通过，2 DWG未解析。
- 实际deepseek-flash经DSH/官方附件服务：2/2代表性识别案例通过事先独立期望。期望未进入模型任务，没有CAD工具或委派调用。不是全量14图识别，也不是绘图评分。
- 实际MCP：40工具，get_backend_status成功，COM后端不具备atomic batch/分页或当前受控文档/revision契约；实际CAD写入、保存和重开未执行，保留阻塞。
- 本地pnpm typecheck、20项TS、组件smoke6/6通过；新增头信息测试不是完整JPEG解码，真实JPEG请求才提供附件兼容证据。
- runner默认离线测试无Key；测试--live的缺凭据路径使用独立临时工作区和空Key，在provider装配前失败，无真实API请求，并验证独立期望快照。
- 原始运行、清单、任务与期望均在.cader；公开报告只保留聚合结论。根tests/images被忽略，不上传用户数据或将其放入CI。
- 远端：实现855b10a，[CI run 44467176367](https://github.com/codesknight/Cader/actions/runs/44467176367) 的4/4 jobs全部成功（Windows/Linux TS20项、Python10项及smoke）。20个暂存文件实际凭据扫描泄漏0；66个文档链接/锚点及暂存whitespace检查通过。

## 2026-11-19：受控执行与读图回归（#15）

- Node24.9.0/pnpm11.28.5：pnpm typecheck、pnpm test（32/32）通过；新增请求schema后最终复验另记。使用缓存依赖的pnpm install --offline已通过。
- 固定几何的内存MCP fixture覆盖新建→批处理→查询→保存→重开→再查询；合成文件明确不是真实DWG。覆盖授权/审核哈希/COM/操作缺失/路径/覆盖拦截，未知冻结、跨profile锁、只读对账、已知回滚、错误实例/请求/revision/几何/hash/重开、未知实体及分页循环。
- 合成事实回归覆盖OR/XOR、遗漏标签、110→1100、猜图号、错误跨线、unknown非null和缺少物理尺度；通过只代表校验器拒绝这些输入，不代表模型已看懂用户原图。
- 实际Sharp crop/rotation和仿射映射、源文件hash不变；实际DSH loop区域工具、请求图变体和Skill hash事件通过，无付费请求。公开schema、keyless CLI和只读工具边界测试通过。
- 真实MCP仅get_backend_status，当前COM，退出3/HTTP_BACKEND_REQUIRED，runtime_write_available=false，artifact=null，无写入/保存/重开；证据.cader/runs/managed-f47d2131-6938-410f-a7a4-a689e54c3d3c/verification.json。本轮不改MCP代码、配置或默认后端。
- Python源码未变；Windows/Linux完整Python lint/format/pytest/协议smoke由CI验证。真实HTTP、完整DWG与复杂图片识别未执行，保持未验收状态。
- 最终本地复验：pnpm install --offline --frozen-lockfile、pnpm typecheck、pnpm test（32/32）、pnpm smoke（6/6）通过。发布前增加拒绝未支持几何属性的验证后再执行必要复验；不重复付费模型或真实CAD写入。
- 实现提交d061b55已核对完整tree/commit并非强制同步GitHub；[CI run 44475849146](https://github.com/codesknight/Cader/actions/runs/44475849146) 的Windows/Linux DSH与Python共4/4 jobs成功，包含32项TS、10项Python及各自smoke和Python lint/format。
- 最后几何属性拒绝分支新增后，本地typecheck、32项TS、smoke6/6复验通过。发布前39文件实际凭据扫描0泄漏、15个Markdown的59个本地链接有效、暂存whitespace检查通过。
- 新增schema导出和请求校验均已进入上述CI；真实模型/复杂图片识别、真实HTTP写入及DWG闭环未执行，不标为通过。BUG-008的业务状态修复已由远端CI验收；BUG-010及#3/#14的实机门槛保持开放。

## 2026-11-19：MCP对齐修订2（#15）

- 本轮只执行离线验证；原始MCP文档及例子只读参考，不执行其check_cader_contract脚本，不调用真实MCP、模型或CAD。
- pnpm contract:export通过，生成draft_revision=2及schema/examples文件SHA-256，fixture含18个schema、11个操作对账和1个请求审计向量。hash不是Bridge原生去重hash，双方协议仍未冻结。
- pnpm test初次完整运行38/38通过；后续CLI阻塞原因与锁标记补充后最终复验见下。定向受控调度10项先前通过，包含只读重开、权威失败revision、非零初始revision与输出目录。
- 共享向量与运行时校验、schema导出/CLI一致及manifest精确字节校验均已覆盖；组件传输使用内存MCP及合成文件，非DWG。旧/篡改journal不得启动MCP连接。
- 新测试初次typecheck因assert.throws的undefined参数不满足Node类型定义失败，改为Error谓词后通过；保留该记录，不当作产品运行失败。
- 最终本地复验：pnpm typecheck、pnpm test（38/38）、pnpm smoke（6/6）通过；uv run --project cader-mcp cader-mcp smoke（离线协议3/3）通过。Python smoke有既有Pydantic lifespan前向引用警告，没有抑制或归因到本轮协议。
- 旧journal的真实CLI子进程返回退出3和LEGACY_REQUEST_REQUIRES_REVIEW，不建立MCP连接；失败核验锁标记、只读重开和请求审计补充均已进入本次最终复验。完整Python lint/pytest留给跨平台CI，Python源码未改。
- 远端实现eed2f33：[CI run 44480295260](https://github.com/codesknight/Cader/actions/runs/44480295260) 的Windows/Linux DSH及Python共4/4 jobs成功，含38项TS、10项Python、组件/协议smoke及Python lint/format。
- 发布前26文件实际凭据扫描0泄漏、11个Markdown的69个本地链接有效、schema/examples暂存字节与manifest一致、whitespace检查通过。普通git push因既有127.0.0.1:10809代理未监听失败，使用既有API回退核对完整tree/commit后非强制推进，未改系统代理或覆盖提交。
- 本轮无真实MCP/模型/CAD请求。schema与例子的Cader验证通过不等于MCP profile已实现或双方冻结；#15/#3/#14的真实验收条件继续开放。

## 2026-11-19：Cader原生CLI实机（#15）

- 实际pnpm build后，在专用HTTP实例运行node apps/cli/dist/index.js cad-test --backend http --mcp <私有运行profile> --plan benchmark/fixtures/managed-geometry.plan.json --output <新的.cader/artifacts DWG> --authorize-write。单次派发，exit0，8动作/4变更均confirmed，业务成功及verification passed。
- run managed-797c993f-798b-4bca-8df6-00f479854f54，31988字节真实DWG。独立读取磁盘摘要、另起DSH/stdio客户端查询源图及只读重开图通过；三实体所有受限参数匹配，unsupported为空；源/验收document_id不同。
- 首次额外源图读用revision16被拒，权威状态为25；仅刷新状态并读取后通过，未重放写入。源文件事件序号在保存/重开后可能不同，未逐事件分析具体增量来源。
- source.before与实测结束128 tracked文件逐字节hash相同；16用户输入hash不变，14图片输入有效、2DWG不解析/不开原图。共享snapshot e239266e/9e33ab75未改，安装DLL与settings前后相同。
- 首次启动/ROT身份拒绝、界面激活失败、收尾辅助依赖/信封守卫及RPC拒绝均见实机报告，不删除失败。成功实例只关闭3张自建图，正常Quit后无acad，写锁已释放，产物保留。
- 真实CAD仅此固定计划：未调用模型、未图片重绘、未真实写响应丢失注入。原MCP团队两轮验收属于外部证据，与本轮独立运行分开。原始完整日志和私有资料仅留.cader；仓库只提交合成图元的脱敏摘要。
- 文档/配置维护后本地pnpm typecheck、pnpm test（38/38）、pnpm smoke（6/6）通过；新增AutoCAD.managed.example.yaml实际经loadMcp解析，入口与两项env引用正确。没有新增与实现镜像的测试或修改运行时策略。
- 原schema e239266e和cases 9e33ab75仍完全相同，hash manifest未改；当前无acad进程。完整Python回归由跨平台CI执行，Python源码未改。
- 发布验收：提交3d471ea，[CI run 44525767262](https://github.com/codesknight/Cader/actions/runs/44525767262) 的Windows/Linux DSH与Python共4/4 jobs成功，覆盖38项TS、10项Python及各自smoke/lint/format。
- 发布前15文件扫描实际模型密钥和Bridge令牌两类凭据，泄漏0；82个本地文档链接有效，暂存whitespace通过。原始资料、DWG、完整request_json和私有日志未提交。普通Git因既有未监听代理失败，核对完整tree/commit后非强制API同步，不更改全局代理。


## 2026-11-19：持续终端与CLI入口（#16 / #10）

- Node24.9.0/pnpm11.28.5：pnpm install --offline通过；最终pnpm typecheck、pnpm test（44/44）、pnpm smoke（6/6）通过。新增6项测试含实际DSH loop与确定性模型，无付费请求。
- 新增测试初次把返回false误断言为undefined失败，修正测试后通过；没有隐藏最初失败。多轮历史/选择/域上下文、无工具压缩、取消后继续、resume、路径/hash变化和跨chunk凭据脱敏均通过。
- 用户Shell真实子进程验证中文UTF-8、逐条确认、deny/非TTY无批准、20秒Sleep取消，输出没有进入模型历史。会话/引用检查点与DWG能力缺口明确测试；不执行CAD。
- Windows实际PTY：TERM=dumb初期未启用Node原生Tab编辑，定位Readline简化分支，保留原生补全并加入提示；VT环境TERM=xterm-256color/FORCE_COLOR=1下，彩色CADER、/con→Tab→/context、中文、Shell确认、Esc取消及后续输入、保存退出通过。
- 实际安装：管理员所有的Node全局目录返回EPERM，没有改ACL；选择已在PATH中的用户.local/bin安装cader.cmd，cader --version及--help通过。不改PATH/PowerShell策略，无需pnpm.ps1。
- 一次真实TUI模型请求返回QUOTA，错误根因正确显示且界面继续运行；停止后续付费探测。真实模型多轮成功、实际Agent PTY取消、窗口resize、社区profile、真实CAD不标通过。
- 原始session/events/PTY诊断仅在.cader；公开[验证报告](../validation/2026-11-19-interactive-terminal.md)只包含合成用例结论。Python未变，完整Python检查由跨平台CI执行。CI结果待发布后补记。

- 发布验收：实现c68dffc的[CI run 44539527045](https://github.com/codesknight/Cader/actions/runs/44539527045)，Windows/Linux DSH及Python共4/4 jobs成功，覆盖44项TS、10项Python、组件/协议smoke及Python lint/format。Linux实际直接执行100755的bin/shebang通过。
- 暂存30文件实际模型凭据扫描0泄漏、79个本地Markdown链接有效、whitespace检查通过。Git push仍受既有未监听代理阻塞，核对完整tree/commit后以既有API回退非强制推进，未更改全局代理。


## 2026-11-19：CLI公开使用手册（#17）

- 文档及规范变更；Node24.9.0/pnpm11.28.5的pnpm typecheck、pnpm test共44/44通过。无Harness/Python源码变更，不新增镜像测试或调用付费模型。
- 本地私有审查脚本.cader/check-cli-manual.py核对两种语言的16根Slash、11个单次命令族及18个参数名；实际运行13次CLI子进程：裸非TTY、help、version、doctor、models、skills list/show/resource、cad-contract、harness-smoke、redraw阻塞、非法选项、chat --stdio。
- stdio会话覆盖16根Slash的离线分支，MCP未选择，/compact为空会话不发请求，Shell被deny拒绝；未做真实模型摘要、实际MCP连接或CAD操作。已有交互/DSH回归另由44项测试执行，不将示例核对计为真实CAD验证。
- harness-smoke六项组件检查通过；redraw返回退出3/WRITE_CAPABILITY_UNAVAILABLE且artifact=null，非法选项退出2。校准图裁剪示例在原图边界内。
- 初次完整手册检查167个相对链接、24个文档锚点有效，语言切换互通；最终记录追加后再查。原始检查JSON/会话在.cader，不上传私人输入或历史会话。Windows/Linux CI待发布后补记。

- 发布验收：实现fb2d766的[CI run 44551809258](https://github.com/codesknight/Cader/actions/runs/44551809258)共4/4 jobs成功，Windows/Linux 44项TS、10项Python、DSH/协议smoke及Python lint/format通过。最终手册与日志检查171个本地链接、24个锚点有效，16个暂存文件实际模型凭据扫描0泄漏，whitespace通过。
- 普通push因既有127.0.0.1:10809代理未监听失败，核对完整tree/commit后通过既有API回退非强制推进，未更改代理或覆盖提交。真实模型/MCP/CAD未执行，文档验证不改变历史能力验收。


## 2026-11-20：v0.3 Agent Execution Enablement（#18）
- 首次pnpm build/typecheck在PATH Node22.19执行，出现引擎警告；不作为受支持环境验收。随后切换24.22.1并最终使用仓库私有Node24.9.0，pnpm11.28.5。
- 独立MCP真实发现44工具；new_drawing/list_layers/query_entities创建新空白图并读取默认层与空实体，证据.cader/runs/execution-probe/result.json。
- pnpm test：原44/44通过；新增回归首次46/47（绝对私有路径误拦），修复后47/47通过；旧失败保留于本记录。
- pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --execution：首轮真实执行成功但矩形类型误判导致ok=false；第二轮13/13实测通过。第三轮增加断线后的真实模型引导并使用固定Node24.9，结果补记。
- 已测试：程序ask/read-only、workspace-write删除审批、未知写入持久冻结与无重放、文件写/编辑/Glob/私有与CAD路径保护。真实CAD响应丢失故障注入未执行；COM受控重开不可用。
- 真实模型自然语言运行与确定性组件fixture分开；原始记录留在.cader/runs，公开脱敏结论见[验收报告](../validation/2026-11-20-agent-execution.md)。本轮不修改Python MCP，无Python源码检查要求；CI仍运行其原有检查。

最终固定Node24.9.0：pnpm typecheck通过，pnpm test 47/47通过，pnpm smoke 6/6组件门槛通过；真实live-smoke第三轮15/15通过（含真实模型断线引导），无固定操作计划。CI等待提交后执行。

Windows真实PTY补测：直接启动 cader.cmd（0.3.0），自动发现44/暴露27项CAD工具；选择真实Pro模型，用自然语言新建空图并绘制半径2圆。分别在new_drawing和draw_circle审批框输入y，真实执行后query_entities回读一个AcDbCircle（中心0,0,0，半径2）。未保存，未执行Shell；/exit正常保存会话并释放MCP。此为真实终端审批，区别于自动验收回调。

CI acceptance: implementation commit `7709770`, [Windows/Linux CI](https://github.com/codesknight/Cader/actions/runs/44575837079) completed successfully, 4/4 jobs (DSH components and Python MCP on both OSes). No credentials, paid model or real CAD were used in CI. #18 core execution acceptance passed; #3 retains controlled reopen/reconciliation/fault-followup scope.


2026-11-20 / #19：Node24.9.0、pnpm11.28.5。初始46/47因新健康工具未纳入旧测试期望；随后新测试相对源码导入路径导致50/51，改从包导出后53/53通过。真实A每次3x100两轮套件均通过，B首轮各100通过（279159ms全图读回 vs 18991ms目标实体读回），后续new_drawing分别出现dispatch Name异常和ack后query RPC拒绝，两个套件均ok=false；E未完成不得标通过。真实CAD客户端边界故障注入11/11通过；不等同原生COM崩溃/网络丢包。真实Pro视觉纠错因export超时失败，未执行VisionAgent，晚到PNG仅作失败证据。根目录Drawing8屏障保留，MCP用户改动未修改。最终检查与CI另记。

#19本地最终检查：pnpm typecheck通过、pnpm test 53/53通过、pnpm smoke 6/6组件门槛通过。版本为0.4.0-dev.1，不代表完整v0.4实机门槛通过。分支codex/v0.4-reliable-execution供审阅，MCP修补授权仍待答复；CI待推送后执行。

补充：full-access下Agent Shell仍受CAD冻结屏障约束，新增断言确认无Shell派发。GitHub API可访问但普通Git HTTPS push多次连接失败；当前提交保留本地，CI不得标为通过。

## 2026-11-20 / REQ-027：提交前离线复核

固定 Node 24.9.0 / pnpm 11.28.5：`pnpm typecheck` 通过；`pnpm test` 53/53 通过；`pnpm smoke` 六项组件门槛全部通过，记录 `.cader/runs/dsh-component-2026-11-20T03-28-09-770Z-244c21ea-2202-45b3-9013-c4ec9bbd833a`。文档新增相对链接检查、`git diff --check` 通过；指导原文 SHA256 保持不变。本轮未重新调用付费模型或真实CAD，既有实机失败不变；CI实际结果待远端运行后追加。

REQ-027 远端复核：`55ad82f` 的 [CI 44667978153](https://github.com/codesknight/Cader/actions/runs/44667978153) 4/4 jobs成功：python-mcp/windows、python-mcp/ubuntu、dsh-components/windows、dsh-components/ubuntu。CI没有读取密钥、调用付费模型或真实CAD。本地53/53及上述CI不替代仍未通过的压力/生命周期和视觉纠错验收。

原文校验：提交后的指导文件blob与用户提供文件SHA256一致。将原文纳入暂存区后，`git diff --check` 报告原稿第3–5行Markdown换行用的尾部空格；按保留原文要求未改写。排除该原稿后，本次变更的 `git diff 55ad82f^ 55ad82f --check -- . ':!docs/designs/Cader_v0.4.0_Development_Guide.md'` 通过。此前历史推送失败保留，本次远端同步成功已在日志补记。

## 2026-11-20 / REQ-028 / #20：自主质量任务

Node24.9.0 / pnpm11.28.5。`pnpm typecheck`通过，`pnpm test`63/63通过；`pnpm smoke`六项组件门槛通过，运行`.cader/runs/dsh-component-2026-11-20T04-08-50-190Z-bb3cfd9b-b009-4a00-a05f-c025d589a2c3`。区分实际DSH+确定性模型、组件fixture与真实模型/CAD；上述离线检查不访问密钥或CAD。

初始视觉fixture/非纯JSON schema投影失败及后来ObjectID读回fixture失败保留为调试事实；修正后最终全测通过。新用例覆盖严格报告及截断修复、首错停止补丁、真实端口图的断路/支路/重叠/长线穿盒、任务审批范围、3轮上限、取消、陈旧连接/观察变化、恢复不重放。

`pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality`五次尝试，其中四次真实模型+CAD，一次知识文件frontmatter配置预检失败；四次完整质量验收全部ok=false，含实际自动视觉和局部修改。最后Drawing5在第4次导出未知派发后冻结，保留锁，停止实机写入。真实运行时间、逐工具计数、视觉报告/图片hash、验收状态及根因边界见[报告](../validation/2026-11-20-autonomous-quality.md)和[JSON](../validation/2026-11-20-autonomous-quality.evidence.json)。

最终非可定位uncertainty早停、视觉/程序清单分工及审计优化未重新进行实机写入，不能将旧运行标为这些改动已通过。保存原图的边缘检查离线检出实验C疑似裁切；不证明新导出成功。本轮没有Python改动或相邻MCP写入，Python本地检查未执行；CI按仓库原配置执行。代码提交CI另记。

提交前最终复核：`pnpm typecheck`、`pnpm test`63/63及`pnpm smoke`全部通过，最终组件运行`.cader/runs/dsh-component-2026-11-20T04-20-11-767Z-f513ea5d-5fb2-4cc5-98fe-b5e95e8d5919`。44个本轮变更文件的Markdown本地链接和不回显密钥的泄漏检查通过，`git diff --check`通过。原始设计及相邻MCP没有修改。

实现提交`187f658`正常推送；[CI 44673924887](https://github.com/codesknight/Cader/actions/runs/44673924887) Windows/Linux DSH组件与Python MCP四项全部成功。随后入口复核修正礼貌问句“能帮我画……吗”和“设计电路”的任务识别，补充断言及无计划时的明确阻断文案；未追加CAD调用。该补充提交CI单独跟踪，不能拿前一提交CI替代。

入口补充本地复验：typecheck、测试63/63及smoke通过；组件运行`.cader/runs/dsh-component-2026-11-20T04-24-22-416Z-0c5261d7-4b16-43b5-99ca-d645423c5e29`。8个补充文件的文档链接、密钥泄漏检查及diff检查通过；补充提交CI最终状态在[#20](https://github.com/codesknight/Cader/issues/20)记录，不改变完整CAD验收未通过结论。

补充代码提交`2d7b818`已正常推送；[CI 44674290412](https://github.com/codesknight/Cader/actions/runs/44674290412)四项全部成功：Windows/Linux DSH组件及Python MCP。离线 `cader --version` 返回`0.4.0-dev.2`。根目录原屏障及quality-e450…的Drawing5屏障均仍存在，后者为capture_dispatch/unknown/frozen；没有通过重连或删锁绕过。源码本地及CI通过，完整CAD质量案例仍未通过。

12:32用户日志排障：`.cader/probe-raw-schema.mjs`使用实际DSH+无副作用原始定义，缺必填height时body=1、isError=false，缺陷复现成功；server_called=false、cad_called=false。这不是预期行为通过，也不是修复回归通过。阅读用户原始审计确认参数拒绝及14确认/1未知，未执行真实CAD/模型复验，BUG-024未修复。报告见[排障](../validation/2026-11-20-user-log-1232.md)。

该文档审计本地复核：`pnpm typecheck`、`pnpm test`63/63、Markdown链接、密钥泄漏及`git diff --check`通过。未修改Harness/Python，无新增smoke或真实API/CAD执行。通过的旧测试不会覆盖本次已复现的参数预检缺陷。

## REQ-030 / dev.3：BUG-024代码修复

Node24.9.0 / pnpm11.28.5。最终`pnpm typecheck`通过；`pnpm test`69/69通过；`pnpm smoke`六项组件门槛通过，运行`.cader/runs/dsh-component-2026-11-20T05-13-44-396Z-53a701c0-1ec3-4616-89b7-5175b18949d8`。新负向回归使用raw ToolDefinition，含本地拒绝与伪造/远端类似validation错误的区分、合法纠参、整批预检、计数/缓存、持久屏障、捕获拒绝、恢复事件和实际流式去重；均不调用真实服务或付费模型。

修复过程中typecheck曾因validator异步类型及旧facts fixture新增字段失败，随后诊断结果union和测试fixture字面量类型失败，修正后上述检查通过。首次依赖查询因系统npm缓存不可写失败，使用本工作区私有cache和官方registry完成固定Ajv8.20.0安装，不改全局权限或配置。

真实集成显式执行`pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality`。首次测试入口负向预检在延迟连接前读取定义失败，未绘图；连接准备修正后，quality-77de84c9…通过真实schema缺height拒绝（未派发、未冻结），真实Flash确认17次CAD写入含文字2、unknown=0、审批1、自动视觉valid=true。完整图纸质量ok=false/pending，疑似裁切和计划计数范围仍未通过；原始日志、初次失败及[实际证据](../validation/2026-11-20-schema-preflight-fix.md)保留，不当作完整质量通过。

本轮Python/独立MCP无变更，本地Python检查未新增；CI仍运行原矩阵。`cader --version`为0.4.0-dev.3；Drawing6、旧Drawing5和原根屏障均保留，未自动迁移或重放。提交/远端CI结果另记。

2026-11-21收尾：实现提交`0c5eba3`的[CI 44680055023](https://github.com/codesknight/Cader/actions/runs/44680055023) Windows/Linux DSH组件与Python MCP四项全部成功。连接关闭原因补充断言此前已全量通过69/69及smoke，运行`.cader/runs/dsh-component-2026-11-20T05-19-11-904Z-c29128a5-073f-418e-af7d-2eb7309aa57b`；此日核对源码差异与日志，未新增付费模型/真实CAD复验。完整图纸质量仍未通过，补充提交的最终CI在#20记录。

补充代码`660153f`已推送，[CI 44783085937](https://github.com/codesknight/Cader/actions/runs/44783085937)成功。代码检查通过不改变完整图纸质量pending或历史unknown屏障；BUG-024修复验收与BUG-025/原生导出剩余项继续分开跟踪。

## 2026-11-21 / REQ-031 / dev.4：历史缺参屏障复核

Node24.9.0 / pnpm11.28.5；`pnpm typecheck`通过，`pnpm test`76/76通过，`pnpm smoke`六项通过，组件记录`.cader/runs/dsh-component-2026-11-21T05-30-53-295Z-16f5465e-4f06-4b7a-9137-ab1fff513ca0`。7项新增顶层回归涵盖四权限人工确认、原始证据归档/不重放/丢弃文档权限、未知结果拒绝、证据变化与互斥、模型前阻断/无MCP启动警告、CLI程序路由和损坏状态阻断。fixture不调用真实CAD/付费模型。最初fixture用defineTool传原始schema导致typecheck失败，改为真实形状的ToolDefinition；首次plan断言null而实际undefined，修正后74/74，补充CLI及损坏锁后76/76。

`node .cader/review-user-barrier.mjs`实际连接独立MCP发现schema并读取原用户Drawing6锁/日志，仅list_tools和get_backend_status。缺height候选核对通过；原锁前后hash相同，model_called/cad_write_called/resolution_called均false。私有结果`.cader/runs/barrier-readonly-preview/preview.json`；未调用draw/new/recover/resolve，未创建CAD工作图，不是原生无副作用证明。

本轮Python/独立MCP未修改；没有新增本地Python检查、付费模型或新图完整质量验收。用户真实归档确认未执行，屏障保留。CLI版本/实际启动验证及最终提交CI另记；BUG-025及原生导出/像素映射仍未解决。

CLI实际执行`node apps/cli/dist/index.js chat --stdio --workspace C:/Users/LiuYanhong`，输入`/mcp barrier`、原房子/树请求和`/exit`。exit0，dev.4启动明确警告，原记录候选可见，绘图请求直接blocked，未出现planning阶段，原锁hash不变。私有stdout/stderr/check结果在`.cader/runs/barrier-readonly-preview/`。这验证真实入口和服务发现，不是用户TTY审批或真实新图验收；现有`cader.cmd`仍指向本仓库构建，不需重新安装。文档链接检查旧私有脚本尚断言16个根命令，实际已有17个（含/quality），更新检查器后另记结果。

最终复跑typecheck、76/76 tests及smoke均通过，最终组件记录`.cader/runs/dsh-component-2026-11-21T05-33-56-678Z-90fd4fc0-63b6-45b4-8dd8-0a44ef1ad08b`；`cader --version`实际返回0.4.0-dev.4。`python .cader/check-cli-manual.py --links-only`通过2语言/17根命令/193本地链接/23锚点；`git diff --check`通过。提交及远端最终CI链接记录在[#20](https://github.com/codesknight/Cader/issues/20)，本地组件通过不替代CI或完整绘图验收。

代码`5638f41`已普通推送，[CI 44871945247](https://github.com/codesknight/Cader/actions/runs/44871945247)四项全部成功（Windows/Linux DSH组件及Python MCP）。工作树与远端一致，用户原锁最终hash仍与只读核对前一致。Git直连及旧端点超时后，确认当前系统代理10808正常、Git旧配置10809，单次参数10808完成fetch/push；不改全局配置或TLS校验。最终文档提交CI在#20补充。

## 2026-11-21 / REQ-032 / dev.5：依赖预检与部分执行

最终`pnpm typecheck`、`pnpm test`79/79、`pnpm smoke`六项通过，组件记录`.cader/runs/dsh-component-2026-11-21T09-51-50-083Z-0b727f69-f22d-43b1-8473-0e661a090f37`。依赖缺失/查询失败无写入无冻结，真实DSH组件收到错误后调用create_layer并只画一次；QUOTA/缺计划在规划阶段阻断。不是付费模型结果。

Cader Python检查：`uv run --project cader-mcp ruff check cader-mcp`、`ruff format --check cader-mcp`、`pytest -q cader-mcp/tests`均通过，10项测试；未修改该Python模块。独立MCP使用自身conda Python执行`python -m pytest -q`：221 passed/33 skipped；43新增定向案例包括38创建安全、5导出恢复。MCP未配置ruff，借用uv环境isolated I/F检查3个变更Python文件并修正imports；最初误用Cader严格BLE规则报告了旧代码和刻意cleanup捕获，不伪装为相邻仓库既有lint结果。

开发失败保留：最初MCP fixture缺InsertBlock、Cader无规划返回分类不匹配导致37/38与78/79，修正后全过；一次相邻环境误在Cader根跑pytest导致cader_mcp导入失败，正确目录执行后通过；不是实机产品故障。

真实CAD：`.cader/live-dependency-native.py`新图缺图层后count0、建层后多段线正常、后续无效setter仅清理第二个新增实体。加入导出修复后1.110秒有效PNG且系统变量/打印设置恢复一致，定向图纸均关闭。两轮自然语言入口：`pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task "新建一张空白图纸，绘制一个房子，旁边有棵树。"`。

首轮`quality-e2f051c5…`16确认，截图等待超时后文件延迟出现，capture_dispatch冻结，exit1；未篡改为成功。第二轮`quality-c7032bea…`18确认、unknown0、实际自动视觉有效并一轮修正，exit1/pending：计划类型/需求检查语义不当和截图边缘未通过。未执行固定绘图计划，未声称完整质量或保存DWG通过。完整私有工具/图像轨迹及清理证据见[报告](../validation/2026-11-21-dependency-and-partial-execution.md)。原用户Drawing2及其部分执行锁不修改。最终提交/CI另在#20记录。

Cader实现`89f31de`已推送，[CI 44891799500](https://github.com/codesknight/Cader/actions/runs/44891799500) Windows/Linux四项成功；MCP实现`538db9c`的[CI 44891530548](https://github.com/codesknight/AutoCAD-MCP/actions/runs/44891530548) offline/bridge-contracts成功。本地双语201链接/22锚点、staged30文件密钥扫描与diff-check通过。最终文档提交CI在#20记录。

已建立私有`.cader/workspaces/dev5`供独立新任务；真实CLI --stdio --workspace启动、/status、/exit检查exit0，dev.5且不继承用户旧冻结，旧Drawing2锁hash不变，没有调用模型或新建图纸。证据`.cader/runs/dev5-workspace-check.json`；这是隔离新任务，不是清除旧图屏障或对账完成。

REQ-033手稿日志审计：读取用户原始附件及实际verification/events、人工查看原始JPG，核对输入注册/任务路由/规划传参与旧图视觉评审。`node .cader/probe-redraw-image-input.mjs`应用装配复现通过：普通路径image=false，/open后同文件image=true；“复现”路由false，“绘制”路由true。runner在模型启动前立即中止，paid_model_calls=0、cad_calls=0；不是模拟工具成功或重绘验收。首次汇总PowerShell foreach直接接管道发生解析错误，改为先收集数组后读取成功，不是产品故障。只更新诊断文档，不修改运行时、权限、图纸或独立MCP，最终文档检查/CI在#20记录。

本轮`pnpm typecheck`、`pnpm test`79/79通过，双语手册根命令及52个改动文档本地链接、diff-check通过。Harness/Python无代码变更，未新增smoke/付费模型/真实CAD调用；这些通过不证明图片重绘已修复。文档提交CI与BUG-029/030未解决状态在#20同步。

### REQ-034，2026-11-21：手稿重绘执行修复

本轮实际`pnpm typecheck`、`pnpm test`88/88和`pnpm smoke`通过；有真实DSH装配，但CAD/视觉fixture明确为模拟断言。新增路径快照/续接请求、实际图片块、双图、新图/实体归属、local DWG文件核对、续验不重放和导线约束。真实模型+AutoCAD采用显式`pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task <手稿任务>`；前三轮记录真实新图/DWG与失败，完整质量没有冒充通过。MCP独立原生截图验证通过，221 passed/33 skipped；最终检查、实机结果及CI见[完整分层记录](../validation/2026-11-21-reference-redraw-fix.md)。

最终第四轮服务QUOTA中断于修正阶段，39确认/unknown0、两次有效源图对照及一轮修正已发生，仍有拓扑/外观未通过。新增模型失败后待验稿保存及更换源图后阻止裸“继续”的回归；最终88/88、typecheck、smoke通过。独立三份DWG重开保持几何/文字，末份为人工保存的测试稿，不代替应用QUOTA收尾实机验收。CLI手册检查17根命令、13个离线入口通过；首次新日志相对链接层级有误，已修复后重验。付费完整质量和新增收尾分支受服务限制未重跑。

实现199f34a的[Cader CI](https://github.com/codesknight/Cader/actions/runs/44900911369)及MCP f583b70的[CI](https://github.com/codesknight/AutoCAD-MCP/actions/runs/44899684701)均成功。本地最终88/88、typecheck、smoke，手册216本地链接/22锚点通过，实际cader -v为dev.6。CI与离线通过不改变完整真实质量未通过的状态，#20保持打开；后续文档CI在Issue记录。

### REQ-035，2026-11-21：完整绘图质量续验

显式`pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task <原始手稿请求>`及无`--task`的原始灯泡案例；原图及完整轨迹私有保存。初轮36确认/4次评审/3轮修正后pending；第二轮47确认后仍有未支持导线及步骤超限；off灯泡66确认后工具预算耗尽。low手稿一轮22确认虽complete，独立源图标注期望却失败，明确不计通过。加入真实裁图读取/文字绑定后相同请求31确认、17条件全过、应用DWG17435bytes/26实体，独立只读重开与原始期望一致。均无unknown，未补画或改写失败记录。

实际`pnpm typecheck`、`pnpm test`93/93、`pnpm smoke`通过；定向21项涵盖完整文字/数量/SI、定位断点、清单ID修复、原图裁图数据通路、清晰文字绑定与不确定稿仍绘制保存但不完成。这些fixture不是实际OCR或真实CAD证明；后者分层见[记录](../validation/2026-11-21-complete-quality-retest.md)。最终灯泡/手册/CI状态随后追加，不据此关闭全部v0.4验收。

2026-11-22最终收尾：typecheck、94/94测试、smoke通过；定向22项。实际最终手稿17/17及灯泡11/11通过，DWG分别17435/16991bytes，独立只读重开/源期望核对通过；灯泡文件从执行审计取得，未冒充手工保存。中间一次捕获Add.Delete导致unknown，原锁保留；独立MCP80a07bd修复后5次新图截图/恢复通过，227 passed/33 skipped及CI44914265701通过。无关全局视觉uncertain现在要求有界重报而非直接pass，组件任务也不得自设总线段上限。详细失败和证据层级见同一实测记录。

## 2026-11-23 REQ-037 / #20：能力与视觉路由

`pnpm typecheck`、`pnpm test`100/100、`pnpm smoke`通过；手册links-only及diff检查通过。新增实际DSH请求级目录/准入一致性与任务状态刷新、主动/兜底同份证据、写后失效/并发合并、裁切不通过、模型不能去掉必要视觉条件、偏好/历史不启动模型/CAD、继续不重放及视觉进度不解除修正阶段禁新图回归。最初96/98测试的失败及修复记录保留于[本轮实测](../validation/2026-11-23-capability-routing.md)，不覆盖旧失败。

两次显式 `pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task "新建一张空白图纸，绘制一个房子，旁边有棵树。"` 均真实模型/AutoCAD完成6/6，均Agent主动评审1次、Harness复用、1张真实图，unknown0；最终dev.8为20确认、8步骤、0修正。图片独立查看，未保存DWG，不冒充文件验收。非固定绘图计划，原始轨迹只在.cader/runs；CI另按实际结果追加。

远端交付（2026-11-23）：实现提交 `ab6c6b9` 已普通推送至 `codex/capability-vision-routing`，审阅入口 [PR #22](https://github.com/codesknight/Cader/pull/22)（草稿，未合并）。实现提交的 [CI 45127926273](https://github.com/codesknight/Cader/actions/runs/45127926273) 四项均成功：Windows/Ubuntu DSH与Python MCP。该记录后的文档提交不改执行代码，最新PR检查在交付时另核对；#20/Milestone 3保持打开。

2026-11-23 REQ-038审计：只读解析用户运行JSONL/quality，核对MCP连接/新建及pywin32源码；用conda环境Python执行GetActiveObject/只读Documents与ModelSpace.Count，15:17:52见1张空Drawing5。无Add/Save/Close/Dispatch启动、无模型调用、无重放或解锁。运行代码未变，本次没有重新执行单测或付费绘图；此前100/100不覆盖新故障。见[证据与待验证假设](../validation/2026-11-23-new-drawing-add-audit.md)。

## 2026-11-23 REQ-039修复验收

最终pnpm typecheck、pnpm test 112/112、pnpm smoke通过；实际stdio链路6项负测、原生故障注入8项、同图格式修复、视觉交接/父子时限与规划有限重试均分层验证。独立MCP pytest235 passed/33 skipped，已有uv环境isolated ruff I/F通过（conda无ruff）。手册links-only及diff检查通过，cader -v为dev.9。

真实原生连续3次新建且只新增1图/绑定正确，测试图全部关闭，用户Drawing5保留。原始红屋顶/蓝墙/大树绘本需求最终整体ok=true，8/8、47确认/0unknown、12步骤、1轮修正、2次主动视觉且Harness复用。只关闭本轮自建图；未保存DWG。各早期超时/截断/质量与汇总矛盾原结果保留，不改成通过。运行ID、截图hash与证据范围见[完整记录](../validation/2026-11-23-native-document-create-fix.md)。远端以相关PR对应提交CI与Issue交付记录为准。

2026-11-23 REQ-040只读审计：解析本次quality/events/execution，重建100次预算及最后Patch 6确认/1拒绝/25未派发，查看真实蓝色PNG，核对当前源代码与编译产物。独立GetActiveObject仅读取文档/布局/空间数量，未切换或改图；无模型调用、无恢复或重放。运行代码未变，本次未执行回归/真实绘图；此前112通过不覆盖此异常路径。[完整记录](../validation/2026-11-23-tool-budget-audit.md)。

## 2026-11-24 REQ-041 / #20

最终 `pnpm typecheck`、`pnpm test` 123/123、`pnpm smoke` 通过；CLI `cader -v` 为0.4.0-dev.10。手册links-only检查127个本地链接/22锚点通过，`git diff --check`通过。新增预算fixture、实际DSH续派/总限额/精确耗尽，以及原连接Scheduler异常交接测试；均不冒充真实模型/CAD。

显式真实测试使用 `pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --round-cad-budget 4 --task <自然语言需求>`。第三例完整成功：自动续轮3次，同一Drawing16，12确认写入/unknown0，一次授权，10圆/视觉4项条件全过，独立原生核对10个不同ID绿色圆且互不重叠。第一例Plot恢复COM拒绝仍unknown，第二例实际10圆/DWG保存但文件/精确验收证据不完整仍pending，均保留失败。Python仅执行私有独立原生观察/文件核对/清理脚本，仓库Python代码未改、未重新声称Python回归或完整DSH app profile通过。[运行ID、图像hash、DWG证据与限制](../validation/2026-11-24-budget-continuation.md)。

远端实施提交8dfe3ae：[push CI 45324012147](https://github.com/codesknight/Cader/actions/runs/45324012147)、[PR CI 45324019005](https://github.com/codesknight/Cader/actions/runs/45324019005)均success，各4项Windows/Ubuntu DSH及Cader Python MCP检查全过。CI为无付费API/真实CAD的回归，与上述显式真实测试分开记。
