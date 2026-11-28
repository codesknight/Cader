# 大图质量记录加载与非致命 CLI 错误

REQ-053 / BUG123 / [#20](https://github.com/codesknight/Cader/issues/20)。attempt17 在服务恢复和受控检查点迁移后，没有进入新的模型回合：`/quality resume` 被 CLI 原有 **16000000 字节**上限拒绝，驱动的未捕获异常触发 finally 释放连接。这是实际失败，不是成功续跑。

## 根因和保全

原始暂停质量记录 58194102 字节，保存完整 Native / 截图 / 局部视觉报告；迁移后的记录 58500381 字节。写入端允许这些真实记录，CLI 两处读取却使用与任务规模不匹配的固定限制；同一 resume 在 dispatch 与 converse 还会重复解析。异常没有转换为可恢复 ChatReply，测试驱动随后退出。原连接现已释放，不能再声称仍由原 owner 持有。

已保存的 3014 实体 DWG 和其 P1 只读重开证据保留，全部原操作确认、0 unknown；2982 项 verified、32 项 committed、606 项 pending，整图未通过。原失败质量快照、迁移回执、运行日志和真实服务故障均保留，不把状态迁移当作视觉通过，也不将旧失败覆盖为新成功。

## 修复

统一私有质量记录读取入口，打开文件后检查类型与大小，分块限制实际读入字节，采用 **256 MiB** 硬上限；增长超限、非法 JSON 和错误根类型均拒绝。保留完整原始数据和原始字节 hash，不删减 Native/视觉证据来凑旧上限。该上限只适用于私有证据文件，不是模型上下文额度、任务 token 额度或放行权限。

`/quality`、`/quality resume`、普通继续任务和人工 DWG 复核共用入口；resume 向 converse 传递已读取对象，避免再次解析相同大文件。尺寸/格式错误返回明确 error reply，保持同一个 ExecutionSession，不自动断开 MCP，之后仍可使用其他 CLI 命令。未知写入、原文档/连接、人工验收和权限门禁不改变。

## 实测

`pnpm typecheck`、`pnpm test` **434/434**、`pnpm smoke`通过。新增 17MB 记录经实际 InteractiveSession `/quality` 和 resume 路由到 runner 的夹具（0真实模型/CAD），断言状态摘要短、owner 不被 dispose；256MiB+1 的稀疏记录和非法 JSON 均返回非致命错误，后续 `/help` 可用。底层 byte cap 与文件保持反例通过。

同一份实际 58500381 字节的失败记录由新生产入口完整加载，约 330ms，原始 hash 不变、3620 源项及 3018 操作记录完整，quality 仍为 false。此项只有本机文件/解析组件证据，不能代替整图验收。私有记录：`.cader/runs/source-worklist-20261127/manifest-loader17.json`。

## 后续真实回归边界

已退出的旧连接不能由新客户端继承写权；现有 MCP 公共契约还没有受控的跨进程检查点 fork/restore 入口。本轮保留旧 DWG，使用修复后的完整代码在新工作图重新执行原始整图任务。新驱动的异常分支必须先保留原 session、身份和检查点并等待处理，不再让未捕获的记录错误直接 dispose。不能把新绘图说成旧会话续跑，也不能以固定几何或直接操作原图绕过 Harness。

后续可协同 MCP 设计“仅已验证、无 unknown、原文件不修改、创建全新受控工作图”的恢复入口；它必须返回新旧实体映射和真实回执，经过完整 Native / 源 / 新图视觉复验。该能力当前未实现，不在此提交虚报。
