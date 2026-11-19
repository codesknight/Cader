# CAD 受控写入契约

## 2026-11-19 实施状态（#15）

以下原契约保留为历史需求。MCP专用profile已实现，Cader程序调度器现已独立通过固定直线/圆/文字的
真实新建、绘制、保存和只读重开验收；模型驱动/图片重绘仍未通过。关联[#15](https://github.com/codesknight/Cader/issues/15)，
证据见[实机报告](../validation/2026-11-19-cader-cli-real-loop.md)。
公共接口与业务终态见 [v1 草案](../contracts/managed-cad-v1.md)，
读图证据与抽象拓扑检查见 [perception-v1](../contracts/perception-v1.md)。

`exec` 保持只读。新增 `cad-test` 是独立程序入口，需显式 HTTP、授权、计划和输出路径。
策略位于 configs/cad/execution.yaml，仅放行已审查哈希的固定几何计划；当前支持直线、圆、文字。
所有 image-redraw 计划仍阻塞；Skill 和模型不能授权，也不能把图片计划改称 fixture 绕过哈希。

调度器先获取工作区独占锁，再只读发现能力，绑定新工作图身份。变更前将计划、request_id、
目标和 expected_revision 写入并 fsync 私有 journal，只派发一次。写调用异常或返回不符时冻结，
保留全局锁，仅按原请求对账。切换 profile 不能绕过锁。cad-reconcile 不重放、不恢复、不解锁；
即使查询终态也需人工审查。进程中断留下的锁同样先对账，不能靠删除锁假定安全。

修订2采用observed_database_events：明确rolled_back/not_executed可令revision前进，以权威失败后revision
查询新工作图为空，随后结束，不继续保存。缺少权威revision或无法核验状态时保留锁。
工作图managed=true/read_only=false；重开验收图managed=false/read_only=true并绑定artifact，只用于查询。
create时显式绑定输出目录；按操作区分输入与结果文档对账。详见[MCP对齐回应](../contracts/mcp-alignment-response-2026-11-19.md)。
文件保存和重开各有独立request_id，不属于图元事务。

验收读取绑定文档全部分页（最多20页），拒绝错误身份、revision、重复游标及未知实体类型。
计划与实际实体一对一匹配坐标、半径、文字、字高和图层（容差1e-6布局单位），不靠数量或模型正文。
保存后校验本地路径、字节数、SHA-256和基础DWG签名，再按artifact_id重开为不同document_id并重新查询。
签名检查不是DWG解码；只有完整流程通过才返回 task_status=succeeded、verification=passed、artifact。
保存失败保留绘制状态，重开失败保留文件状态。输出仅限 .cader/artifacts 下单一英文文件名DWG，禁止覆盖。

当前 verifier 只覆盖三类固定几何；CAD实体到电路拓扑、符号库和视觉相似度尚未实现。
组件测试使用内存MCP和明确标识的合成文件字节，不能作为真实DWG验收。
早期CLI仅做COM只读探测并返回HTTP_BACKEND_REQUIRED，旧失败保留。当前显式managed_server/HTTP实测
已绘制真实DWG并重开比较；没有模型请求，不将该成功计入模型或图片准确率。

## 原验收要求（历史）

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
