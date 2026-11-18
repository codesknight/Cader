# 通用 CAD smoke 评测规格

`tasks/general-smoke.json` 是 G01–G10 的任务规格，当前**没有评分 runner 或成功率数据**。
`cader smoke` 测试 MCP 协议 fixture；`cader harness-smoke` 测试确定性模型框架接线。
两者均不是此套 CAD benchmark。

## 执行约束

每个任务在独立空白图纸或受控 fixture 副本中执行。固定模型版本、提示词、工具 schema、
预算、后端 commit、输入哈希、评分版本；答案及 verifier 约束不传入模型。
模型只收到 `instruction` 和必要输入。写入未知结果先对账，G10 不直接重放写入。

保存 task.json、脱敏配置、events.jsonl、CAD 产物、verification.json 和 summary.md。
Verifier 重新读取保存文件或受信任 CAD 状态，不根据模型最终文字决定通过。
G09 应新会话重开文件；G10 包括读取失败和写入后响应丢失两种故障。

## 比较协议

每候选每题至少 3 次（10 × 3），配对使用同一任务输入和预算；小样本仅服务工程决策。
记录每次运行的状态、框架及模型版本、Token（不可得时 null）、工具次数、耗时、错误和重试。
同时记录 `claimed_success` 与 `verified_success`，计算假成功率；无自报成功时该比率为 null。
有效任务与环境无效任务分列，公布全部尝试次数、基础设施故障和重试策略。
P50/P95 使用同一明示算法，报告样本量；不把 fixture 或确定性模型结果并入真实模型指标。
