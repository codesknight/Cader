# Windows 检查点替换与失败交接

REQ-053 / BUG121 / [#20](https://github.com/codesknight/Cader/issues/20)。原始大图 attempt16 在 298 个源项已验证、301 次 CAD 操作确认、0 未知时，发生 `CHECKPOINT_PERSIST_FAILED`。没有把该任务标为完成。

## 证据与研究

失败时间留下完整的 `.write-*.json` 候选；原 `quality.json` 随后仍能持久化最终失败状态。旧 catch 抹除了原始 errno，所以只能确认检查点替换环节失败，不能断言历史错误一定来自某个读进程、杀毒软件或权限设置。

[微软 CreateFileW 文档](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)说明，不含 `FILE_SHARE_DELETE` 的现存句柄会阻止删除及重命名。[graceful-fs 上游实现](https://github.com/isaacs/node-graceful-fs/blob/main/polyfills.js)也针对 Windows `EPERM/EACCES/EBUSY` 做有限重试。借鉴错误分类及异步退避思路，未复制上游实现，也未引入全局 fs 补丁。

本机独立文件实测：受控 Python `CreateFileW` 只持有新建测试文件、不接触 CAD。直接 rename 实际返回 `EPERM`；短占用释放后，新入口约 826ms 成功；持续占用时约 4649ms 后明确失败，旧内容完整保留，已同步候选留存，诊断包含 `rename / EPERM / -4048 / 10 attempts`。这是文件系统组件实证，不能证明旧失败的唯一原因。

## 修复边界

`atomicPrivateState` 只对同一份已写入、sync、关闭的候选执行有限 rename 重试；仅 Windows 三种可重试错误，总退避不足 5 秒。不会删除旧检查点、退回原位非原子覆盖、重放 CAD 操作或无限等待。其他错误立即失败。耗尽时保留 stage、errno、syscall、次数及私有候选位置。

Progressive Harness 将检查点失败记录为持久故障并保留根因；源编译失败立即结束 DSH 模型回合，不再请求一个无效的视觉工具或继续派发写入。最终检查点若仍不可写，任务仍是失败，不能用内存中的进度宣称已持久化。

## 实际测试与保全

`pnpm typecheck`、`pnpm test` **417/417**、`pnpm smoke`通过。新增 Windows 共享拒绝的有限重试、持久权限拒绝、磁盘错误和非 Windows 立即失败、旧内容/候选保留，以及真实 DSH 编译失败后只调用一次模型且零 CAD 写入的夹具。首次测试使用源码相对导入，编译后找不到模块；已改由包边界导出，旧失败日志保留。

attempt16 的新鲜 Native 298 实体与确认账本完全相符。另存新的待验稿 87824 字节，SHA256 `a5dd91c2a24880120e87578f2f10a7a0501066b6c46444c1d12d88cf50610b67`，原 quality、临时候选及运行轨迹不改写。该外部保全不是 P1 文件验收。仅关闭这份已保存且 hash 匹配的自有文档，未操作其他实例。

私有证据：`.cader/runs/source-worklist-20261127/windows-checkpoint-sharing/result.json`、`attempt16-native.json`、`attempt16-preserved.json`；原始失败在 `.cader/runs/whole-sheet-20261127/attempt-16/`。完整原始大图真实模型＋AutoCAD 回归仍须通过，不能以组件成功替代。
