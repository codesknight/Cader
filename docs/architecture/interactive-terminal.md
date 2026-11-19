# Cader交互终端

面向安装和日常使用的长期说明见 **[中文 CLI 使用手册](../cli/README.zh-CN.md) · [English User Guide](../cli/README.md)**。
本页保留终端实现、边界与历史验证说明；新用户从使用手册开始。

关联[#16](https://github.com/codesknight/Cader/issues/16)、CLI入口[#10](https://github.com/codesknight/Cader/issues/10)。
当前实现为持续运行的Node终端应用，保留滚动记录、彩色CADER标识、流式正文、工具状态和输入历史。
复用现有DSH/Cordis，不另建Agent框架。原始CLI设计文档保留原文，不把其中所有规划当作已实现能力。

## 本机启动

```powershell
cd D:\LiuYanhong\Projects\BISHE\AutoCAD_Cader
cader
```

当前机器已在原有PATH中的用户.local/bin安装cader.cmd；直接选用已准备的Node24，不经过pnpm.ps1。
不修改PowerShell执行策略、PATH或管理员目录权限。仓库内也可运行`./cader.cmd`；
通用开发入口为`pnpm.cmd run cader`。非TTY无参数只显示帮助并退出0，脚本化会话显式用`cader chat --stdio`。
--help/--version无需凭据或配置，不启动Agent/MCP。当前为本地开发安装，未发布npm全局包。

其他Windows机器需先装Node>=24.9、构建，然后将启动器装到**已经在PATH中**且用户可写的目录：

```powershell
pnpm.cmd build
pnpm.cmd run cli:install --bin-dir "$env:USERPROFILE\.local\bin"
```

安装器不自动修改PATH，拒绝覆盖非本安装器的同名文件和可能遮蔽它的cader.ps1。
Linux/macOS使用apps/cli/package.json的bin入口；pnpm workspace已注册`pnpm exec cader`。

## 交互命令与真实边界

| 命令 | 当前行为 |
|---|---|
| /help | 同一注册表的命令与快捷键 |
| /open 路径 | PNG/JPEG选择为下轮原图；DWG仅检查头/哈希并登记引用，明确返回CAD_OPEN_UNAVAILABLE，未在CAD打开 |
| /cd 路径 | 切换Cader工作目录、撤销旧附件引用授权；不改变父Shell目录或配置根目录 |
| /status | 模型/工作目录/只读状态；选择MCP后进行真实只读状态探测，结束释放客户端 |
| /model [ID] | 列出YAML配置并切换主会话模型；保留主Agent角色、最多5子Agent/深度1与工具约束 |
| /mcp [list/use 路径/tools/off] | 选配置、发现工具、关闭后续连接；不自动启动AutoCAD或修改默认COM |
| /skills [list/use 名称/off] | 查看目录、选择/取消预加载；off不表示移除角色可见的按需Skill目录 |
| /domain [general/electrical] | 选择configs/domains/catalog.yaml中的专业指导，无新增工具或写权限 |
| /context | 可见上下文文字token估算、最近provider实际usage、引用数量；估算不包含图片/工具token |
| /compact | 显式调用模型生成未验证摘要，原始对话留档；压缩请求关闭全部工具/MCP/委派 |
| /clear | 保存旧会话并新建空白对话，保留选择偏好；不改CAD |
| /resume [会话ID] | 列出/恢复私有可见对话、摘要、配置选择和引用；不恢复或重放工具/Shell/CAD中间状态 |
| /undo | 明确CAD_UNDO_UNAVAILABLE；当前公共契约没有受控撤销，不发送猜测的逆操作 |
| /checkpoint | 会话、工作目录和引用哈希清单；不是DWG快照、文件备份或CAD恢复点 |
| /permissions [shell ask/deny] | Agent CAD始终只读；Shell仅直接用户输入，经逐条确认，不是Agent工具 |
| /exit | 保存并退出，清理监听器及恢复输入模式 |

现有七工具profile不提供任意DWG受控打开、undo或CAD快照；这些能力不因菜单存在而获得。
固定几何真实写入继续使用独立cad-test调度器，不在此TUI开放自然语言绘图。

## 文件、Shell和快捷键

`@draft.png`、`@"路径有空格.png"`及`@drawing.dwg`是显式引用。图片继续走原图哈希、Sharp/DSH附件及区域审计；
每轮最多选择一张原图，新图替换活动图片。DWG只提供元数据，不能据此声称已读取实体或恢复图纸。
引用必须位于当前工作区，下一轮前复核哈希，文件变化要求重新选择。/cd清空旧授权。
Tab补全Slash及引用/目录路径，含空格的候选自动补引号；上下键查看本进程输入历史。

`!dir`等命令只响应用户输入，逐条展示命令/目录并确认，非TTY拒绝批准。
Windows使用PowerShell -NoProfile -Command并指定UTF-8；Linux/macOS使用/bin/sh。
以本机账号执行，**不是沙箱**。Agent的CAD只读策略不构成操作系统隔离；模型输出从不解析为Shell命令。
时间上限30秒、输出64KiB，Esc取消只针对本次拥有的进程树；已发生的副作用不自动回滚或重跑。
Shell输出不自动送入模型；私有事件只记命令hash、目录、批准/结果，不保存原始命令或输出。

Esc/Ctrl+C中断当前操作并保留界面；空闲Ctrl+C或Ctrl+D退出。取消后DSH本轮清理完成才接受后续任务。
正常退出恢复原始TTY模式；不承诺强杀/断电场景的终端恢复。
TERM=dumb进入简化输入；真实支持VT的终端可设置TERM=xterm-256color启用完整编辑和补全。
NO_COLOR关闭色彩，FORCE_COLOR=1显式启用色彩。Windows Terminal/支持VT的控制台为完整体验路径。

## 会话与权限实现

配置根目录从当前工程向上发现configs，或使用启动器所在Cader仓库；/cd只改工作目录。
模型密钥来自配置根.env/进程环境，配置变更后重启终端；不复制密钥到会话或模型YAML。
会话位于配置根.cader/sessions，Agent原始运行记录位于工作目录.cader/runs。
通过schema、大小限制、realpath和链接检查加载私有会话；仅保存用户可见正文、来源身份与选择，
不保存隐藏推理。终端过滤控制序列，流式输出对跨chunk的已知凭据做前缀缓冲和脱敏。

每轮创建既有Cader DSH运行时，并把可见对话/摘要以明确标为数据的动态上下文装配；
不宣称恢复了上游DSH的内部工具轨迹。Main/Sub权限、预算与只读白名单仍由适配边界执行。
模型正文不作为CAD验收；界面保留“只读会话，CAD/文件未验收”的状态提示。

## 验证与限制

新增6项测试覆盖真实DSH loop多轮、模型选择、域上下文、工具隔离压缩、取消后继续、引用变化、
跨chunk凭据/终端控制、Shell授权及取消、会话恢复/检查点、无密钥入口。全部TS现为44项。
Windows实际PTY已检查彩色启动、Tab /con→/context、中文Shell输出、确认、Esc取消后继续和/exit模式恢复。
初期PTY的TERM=dumb确实使Node禁用完整编辑，保留失败及定位记录；不是宣称初次全部通过。

一次真实模型TUI探测返回provider QUOTA，已正确显示且可继续Slash/Shell；随即停止进一步付费探测。
**真实模型多轮成功未验收**，不以离线DSH fixture代替。真实CAD、任意DWG打开/撤销、CAD检查点恢复、
实际窗口尺寸变化和完整社区TUI profile不在本轮通过范围。
