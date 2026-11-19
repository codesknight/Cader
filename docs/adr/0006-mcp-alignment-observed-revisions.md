# ADR 0006：MCP对齐后的权限、revision与对账语义

- 日期：2026-11-19
- 状态：Cader侧修订2已实施；待MCP确认，不是双方冻结
- 关联：[#15](https://github.com/codesknight/Cader/issues/15)，补充ADR0005

MCP审阅发现原Cader契约把managed同时用于工作图和验收图，并把revision当提交事务计数。
现有Bridge的managed表示允许写入的自建文档；只读重开图managed=false，revision记录数据库事件，
回滚和外部编辑均可使其前进。旧假设会拒绝合法结果，不能要求MCP重置事件序号。

分离WorkingBinding/VerificationBinding，保留MCP权限语义，验收图仅可查询。
声明observed_database_events；使用权威失败后revision验证状态，失败即终止本轮；无法验证则冻结。
去除新图初始revision=0假设，写入前查询空图。create显式传输出目录并要求回包确认。
job以operation/request_document_id/result_document_id/source_artifact_id区分操作输入输出。
缩小ID字符集到MCP交集；审计hash不替代Bridge去重hash，不修改原生journal。

发布共享正反例和文件hash manifest，草案修订号为2。旧journal不自动迁移、重放或解锁，
DTO到原生请求的映射仍待MCP确认。专用profile不存在时不得切换旧工具假装兼容。
完整回应、例子和真实验收门槛见[对齐文档](../contracts/mcp-alignment-response-2026-11-19.md)。
