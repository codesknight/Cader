# CAD 受控写入契约（待实施）

来源：用户转交 AutoCAD-MCP 开发方反馈；关联 [CAD 闭环 #3](https://github.com/codesknight/Cader/issues/3)
与 [CLI 维护 #12](https://github.com/codesknight/Cader/issues/12)。本文件是后续验收契约，不开放写权限。

本轮只读检查相邻 AutoCAD_MCP 源码（HEAD `6a8534c`），未修改该仓库、未调用 CAD。
`runtime_tools.py` 提供 get_backend_status、get_job_status、execute_atomic_batch 和 query_entities_page；
atomic batch 面向 HTTP Bridge 自建文档，COM 明确不支持。它不包含保存文件操作。
旧 new_drawing 返回名称，旧 save_drawing 操作当前文档；不能仅凭这两个旧接口声称完成新契约。
这些是代码审查结果，不是 Cader 的实际连接或 Bridge 版本兼容验收。

## 执行前

1. 显式取得工作区及本次写入授权。主 Agent 负责计划，子 Agent 不直接写 CAD。
2. 发现 backend / instance_id / capabilities；能力缺失时返回不支持，不回退到隐式当前文档。
3. 通过经验证的接口新建工作图或工作副本，取得 document_id、revision、单位及实例身份。
   现有工具返回值不足时需先约定 MCP/Bridge 能力，不能拿文档名称充当 document_id。
4. 将授权绑定工作副本、document_id、instance_id、expected_revision、允许操作和输出路径。
   调度器持有锁和授权，模型只能提交受限参数，不能自行扩张授权。
5. 建立独立的写入策略/schema/工具入口；严格检查坐标、单位、有限数值与操作数量。
   不将 draw_*、save_*、new_drawing 或 atomic batch 加入 read_only_tools。

## 提交与对账

- 提交前生成并保存 request_id、计划摘要、文档身份和期望 revision；单次派发。
- 返回成功后核对 request_id、document_id、revision 与逐步结果，通过独立只读查询校验几何。
- OUTCOME_UNKNOWN、POST 超时、断链或实例变化时冻结后续写入，按原 request_id 调用 get_job_status。
- 不通过重发相同或新 request_id 猜测结果。实例变更、journal 过期或 JOB_NOT_FOUND 都不证明写入从未执行。
- 对账确认结果后更新 revision；无法确认时报告未知状态并等待人工核实，禁止自动重放。
- 清理、取消不保证回滚已派发操作；不把 shell / COM 重试当作恢复策略。

## 保存与验收

另行实现绑定文档的另存为、禁止覆盖原图、重开及独立 verifier；batch 成功不等于已保存 DWG。
必须覆盖目标错配、过期 revision、未授权写入、请求重复、断链后未知结果、journal 丢失和实例切换。
fixture 验收后，在新建工作图上完成实机绘制—保存—重开验证，再开放写入模式。
本次 readonly exec、真实 smoke、40 工具发现都不作为此写入契约通过的证据。
