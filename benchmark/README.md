# 通用 CAD smoke 评测规格

`tasks/general-smoke.json` 是 G01–G10 的任务规格，当前**没有评分 runner 或成功率数据**。
`uv run --project cader-mcp cader-mcp smoke` 测试 MCP 协议 fixture；`pnpm smoke` 测试实际 DSH 组件和独立插件。
两者均不是此套 CAD benchmark。

## 本地图片输入与识别测试

新增独立图片测试入口，不是 G01–G10 的绘图评分 runner：

```powershell
pnpm image-test --manifest benchmark/image-cases.example.json
pnpm image-test --manifest benchmark/image-cases.example.json --live
```

默认只预检工作区 PNG/JPEG 的文件范围、大小、格式头和像素上限，不调用 API 或 CAD。
--live 显式调用付费模型，以单独 expect 对照模型返回 JSON；期望值不拼接到任务指令。
真实图片 manifest 建议放 `.cader/`；文件格式参考示例，id 唯一，image 位于工作区，
task 是模型任务，expect 是事先独立核对的部分 JSON 期望。数组比较要求顺序与长度一致。
每批最多 100 个样本；遇到 QUOTA/ACCOUNT_QUOTA/AUTH/RATE_LIMIT 后跳过剩余模型调用。

私有报告保存图片 SHA-256、格式/尺寸、manifest 哈希、逐项结果和子运行目录；live 在调用前保存脱敏期望快照。
模型回复由子运行保留，不公开原始图纸。终态始终标记 cadDrawingEvaluated:false，
输入通过、识别通过或模型返回成功都不算生成 DWG/保存重开成功。

用户提供的 tests/images 资料保留本地并被 Git 忽略。2026-11-19 首轮结果见
[真实测试报告](../docs/research/local-image-tests-2026-11-19.md)。完整绘图仍由 #3 验收。

## 执行约束

每个任务在独立空白图纸或受控 fixture 副本中执行。固定模型版本、提示词、工具 schema、
预算、后端 commit、输入哈希、评分版本；答案及 verifier 约束不传入模型。
模型只收到 `instruction` 和必要输入。写入未知结果先对账，G10 不直接重放写入。

保存 task.json、脱敏配置、events.jsonl、CAD 产物、verification.json 和 summary.md。
Verifier 重新读取保存文件或受信任 CAD 状态，不根据模型最终文字决定通过。
G09 应新会话重开文件；G10 包括读取失败和写入后响应丢失两种故障。

## 比较协议

固定 DSH 基线，每种插件配置每题至少 3 次（10 × 3），配对使用同一任务输入和预算；小样本仅服务工程决策。
记录每次运行的状态、DSH/插件配置及模型版本、Token（不可得时 null）、工具次数、耗时、错误和重试。
同时记录 `claimed_success` 与 `verified_success`，计算假成功率；无自报成功时该比率为 null。
有效任务与环境无效任务分列，公布全部尝试次数、基础设施故障和重试策略。
P50/P95 使用同一明示算法，报告样本量；不把 fixture 或确定性模型结果并入真实模型指标。
