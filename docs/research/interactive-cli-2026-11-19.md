# 交互CLI体验与社区兼容性审查

工作项[#16](https://github.com/codesknight/Cader/issues/16)，来源为用户明确要求持续终端、彩色标识、Slash、引用、Shell和快捷键。

[Gemini CLI官方命令说明](https://geminicli.com/docs/reference/commands/)将自然语言、slash、文件引用和shell分开。
[Claude Code官方交互说明](https://code.claude.com/docs/en/interactive-mode)提供持续会话、补全、键盘中断和历史导航。
Cader借鉴这些交互规律，使用自己的标识、命令服务和现有Harness，不复制其UI源码或暗示功能等价。

社区候选[nexlineai/dsh-tui](https://github.com/nexlineai/dsh-tui/tree/0bebfc6912ca9fa68e42b5a42433d196a62b9334)
固定到0bebfc6912ca9fa68e42b5a42433d196a62b9334，package版本0.1.2，声明MIT。
其manifest依赖DSH ^0.1.0-rc.6；src/index.ts要求agentDefaultModel、sessionQuery、compaction、
permissionPresets及planMode等服务。当前Cader锁定DSH0.2.2-rc.4，使用自己的角色/工具策略装配，
未安装这些额外服务。仅有依赖范围和服务清单不足以证明可直接接入，不能未经验证覆盖Cader主/子Agent约束。

本轮选择Node原生Readline/TTY实现Cader的持续终端层，复用现有profile和dsh-adapter，
不迁移整套runtime、不引入React/Ink依赖、不重新选Harness。采用滚动历史加输入提示，保留终端原生复制体验。
用户已明确UI需求，原设计也允许先简易REPL；新增功能以实际能力和[交互指南](../architecture/interactive-terminal.md)为准。

这是静态兼容性审查，**没有运行社区TUI**，不将其Windows兼容性判为通过或失败；#9保留未执行条件。
来源代码和上游文件不打包进Cader。后续如使用全屏社区UI，需要独立profile复验与权限/取消/恢复测试。
