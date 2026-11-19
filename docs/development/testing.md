# 测试记录

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
