# 源辅助程序失败的诊断与任务暂停

REQ-053 / BUG120 / [#20](https://github.com/codesknight/Cader/issues/20)。原始整图attempt15运行至999个已验证图元后，多区提交均报`SOURCE_RESIDUAL_HELPER_FAILED`。主模型缩小集合后仍失败，旧Harness反复换区，最后把根因遮蔽成`SOURCE_REGION_NO_PROGRESS`。

## 已证实与待验证

- 原实现对子进程使用`stdio: ignore`，丢弃stderr，只报告统一错误码；这使模型和用户无法判断依赖、资源或输入错误。此诊断缺口已证实。
- 同时实测系统物理内存占用约96%、剩余提交内存约1.4–1.7GB，PowerShell启动实际报`System.OutOfMemoryException`。这是已证实的系统资源故障。
- 第一份失败的实际原图请求事后单独执行成功；新单线程受控入口对同一32项也全部支持，结果与资源恢复后的旧基线逐项一致。故不能把失败解释为原图不可辨。旧stderr缺失，**不能单凭同时发生的内存不足证明每个helper退出的唯一原因**。
- 原Node进程已消失，console停于普通调用记录，没有完整退出异常；不将其确定归因为OOM杀进程。最后quality仍在reference，1002确认、0未知，不能把进程消失当任务完成。

## 修复

固定本地辅助入口保留受限stderr、退出码/信号和启动错误，将私有诊断绑定输入hash、源图hash及mode。Windows明确的内存/提交限制状态、ENOMEM和明确内存错误文本单独报告`SOURCE_HELPER_RESOURCE_EXHAUSTED`；SIGKILL等不明终止不猜测为OOM。数值库环境仅传系统路径白名单、没有模型密钥，OpenMP/OpenBLAS/MKL/NumExpr和OpenCV限定单线程。

源检查异常立即交回Scheduler，并结束当前DSH模型回合，保留实际原因/诊断位置；不继续让模型在各区重试，不把软件故障变成源图不清或普通无进展。资源/辅助失败不自动派发SaveAs；持久化任务与已确认记录，交互会话可在环境修复后通过原连接`/quality resume`。未知写入规则不变，跨进程不会继承旧图写入权限。

## 实际验证和保全

`pnpm typecheck`、`pnpm test` 411/411、`pnpm smoke`通过；`uv run --project cader-mcp ruff check cader-mcp`、`ruff format --check cader-mcp`及`pytest -q cader-mcp/tests`（21通过）均通过。新增有限stderr/资源分类/不传密钥、Scheduler一次通知且零Native派发、实际DSH在helper失败后不再请求下一模型步骤的夹具；不是实际整图验收。首次新增测试相对导入路径错误及诊断code字段覆盖问题已修正，失败记录保留。

原始失败32项通过生产helper入口复验，0模型/0CAD调用，只证明辅助环节恢复。整图仍未通过。

新鲜独立Native数据与确认账本999项一致，SourceVerifier逐项999/999、0缺失/额外；另存新待验稿218250字节，SHA256 `ab577e3dd063f6525aba35d2335768b4a0dca9c8a920131ca4092db27363f997`。原quality和进程锁保留，不计P1交付。原149份保护基线待下一轮逐一复核。

为释放自有资源，先核对自有测试实例的两份图均已保存、文件hash一致；原4实体组件图额外对照最初Native创建记录验证其身份/字段，并登记文件保留hash。仅关闭这两份已确认的自有图并退出该自有实例，未操作用户/未知CAD或其他应用。其后实测可用物理内存约5.4GB、提交余量约10.5GB；期间其他环境也可能变化，不把全部改善归因于代码或这一次退出。

私有证据：`.cader/runs/source-worklist-20261127/`下的`helper-repro15.json`、`helper15-runtime-retest.json`、`memory-after15.json`、`memory-after-owned-retire15.json`、`attempt15-memory-native-check.json`、`attempt15-preserved.json`、`component-retention15.json`、`owned-app15-retired.json`。下一轮须使用原始整图、真实模型及新建工作图完成完整验收，不能以这些组件结果代替。
