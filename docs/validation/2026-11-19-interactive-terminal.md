# 2026-11-19 Cader交互终端验证

关联[#16](https://github.com/codesknight/Cader/issues/16)、[#10](https://github.com/codesknight/Cader/issues/10)。
环境为Windows、Node24.9.0、pnpm11.28.5。没有更改AutoCAD-MCP、原图或CAD实例。

| 层次 | 实际结果 |
|---|---|
| 本地构建/回归 | pnpm typecheck通过；pnpm test共44项通过；pnpm smoke共6/6通过 |
| 真实DSH loop+确定性模型 | 多轮历史、主模型选择、专业上下文、无工具压缩、取消后继续通过；无付费请求 |
| 应用服务与真实子进程 | 16命令入口、引用变化拒绝、会话恢复、检查点、Shell批准/拒绝及进程树取消、UTF-8中文通过 |
| Windows PTY | 彩色CADER、/con经Tab补成/context、中文、逐条Shell确认、Esc取消20秒Sleep后继续输入、保存退出通过 |
| 当前用户安装 | 用户现有PATH目录.local/bin下安装cader.cmd；cader --version/--help成功，无管理员权限或执行策略变更 |
| 真实模型 | 一次请求返回provider QUOTA；正确显示根因且界面继续可用，停止后续付费探测；真实多轮成功未验收 |
| 真实CAD | 本轮未调用；沿用独立固定几何闭环历史证据，不将终端测试计为CAD验收 |
| 社区TUI | 固定版本静态审查；未安装或运行，不宣称兼容性通过 |

初次新增测试因断言把false误期望为undefined失败，纠正测试后44项通过。
初始PTY继承TERM=dumb，Node简化输入未启用原生Tab编辑；定位Node24 Readline分支后保留原生实现，
添加简化模式提示。支持VT的PTY显式TERM=xterm-256color、FORCE_COLOR=1时上述交互通过。
未实际验证窗口resize、真实模型Agent的PTY Esc或强杀恢复；离线实际DSH取消与TTY Shell取消分别留证。

私有session、provider错误事件及PTY诊断在.cader；不提交原始对话、密钥、Shell输出或私有图片。
本报告只发布合成测试结论。跨平台CI结果在[测试日志](../development/testing.md)与关联Issue补记。

发布补充：c68dffc的[Windows/Linux CI](https://github.com/codesknight/Cader/actions/runs/44539527045)共4/4 jobs通过（44项TS、10项Python及各自smoke/lint/format）。Linux bin实际shebang入口通过；真实模型/CAD/社区profile的未验收状态保持不变。
