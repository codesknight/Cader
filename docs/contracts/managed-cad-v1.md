# Cader / MCP 公共契约草案 v1

状态：**Cader 侧已实现消费与校验，等待 MCP 对齐**。不是 MCP 已实现能力的声明。
关联 [#15](https://github.com/codesknight/Cader/issues/15)。
机读 [schema](../../configs/contracts/cader-v1.schemas.json) 可通过 `pnpm run cader cad-contract` 无凭据导出。
版本为 cader-cad/1；新接口名称和字段待两方确认后实机验收，旧接口保留兼容。
复用现有 HTTP 的身份、revision、分页和请求对账；不创建另一套 Bridge，不回退文件名或当前文档。

## 请求与返回

| 工具 | Cader 提交字段 | 返回 schema |
|---|---|---|
| get_backend_status | `{}` | status：backend=http、instance_id、documents、capabilities |
| create_working_document | instance_id、request_id、units、managed=true | create：request_id、status=succeeded、document |
| execute_atomic_batch | instance_id、request_id、document_id、expected_revision、operations | job：请求/文档身份、revision、status、outcome、results |
| get_job_status | request_id | job；匹配原实例、请求和已知文档 |
| query_entities_page | instance_id、document_id、expected_revision、cursor、limit=1000 | query：身份、items、next_cursor、unsupported_geometry_types |
| save_document_as | instance_id、request_id、document_id、expected_revision、output_path、overwrite=false | save：request_id、status=succeeded、artifact |
| reopen_document | instance_id、request_id、artifact_id | reopen：request_id、status=succeeded、source_artifact_id、document |

这些写工具只由程序客户端调用，不加入LLM schema或read_only_tools。
返回可用structuredContent对象，也兼容text content中的单个JSON对象。

document严格包含instance_id/document_id/revision/units/managed:true；revision非负。
status.documents是当前实例的**受控文档**集合，新工作图ID不得与之重复，初始revision=0。
示意图计划的units=layout明确映射到CAD unitless，其他单位沿用计划。
capabilities需明确managed_documents/save_as/reopen/job_status/query_entities均为true，
atomic_operations列出批处理支持的操作，max_batch_operations给出上限。
工具目录存在draw_text不代表支持原子批处理。当前计划只支持draw_line/draw_circle/draw_text。

批处理成功需status=succeeded/outcome=committed、revision前进，每个计划ID对应唯一object_id。
明确失败需failed + rolled_back|not_executed且revision未变；其他结果冻结。
job的pending/not_found/unknown不允许触发重放。
创建、保存和重开当前只消费同步明确成功；其他响应冻结并对账，尚不实现异步完成轮询。

query.items规范化为`{object_id,operation,args}`，保留几何、文字、字高和图层字段。
不能读取的类型列入unsupported_geometry_types；非空阻止验收，不能静默丢弃。
args必须完整符合对应操作参数，未支持的旋转/线型等几何属性不能静默归一化掉；
当前三操作范围以外的内容应明确拒绝验收，后续扩展schema再接入。
末页next_cursor=null；查询期间绑定revision不得变化。
artifact包含artifact_id/instance_id/document_id/revision/path/sha256/byte_size。
保存成功须表示文件确已完成，不属于图元事务。当前要求同机可读输出路径，未实现远程下载。
重开引用同一artifact_id、相同实例、不同document_id，再独立读取几何。

## Cader 业务终态

业务结果使用独立版本cader-task/1，示例：

```json
{
  "contract_version": "cader-task/1",
  "run_status": "succeeded",
  "task_status": "blocked",
  "blocked_reasons": ["WRITE_CAPABILITY_UNAVAILABLE"],
  "artifact": null,
  "verification": "not_performed",
  "authorization": {
    "user_task_authorized": true,
    "write_authorized": false,
    "runtime_write_available": false
  },
  "stages": {
    "recognition": "not_performed",
    "planning": "not_performed",
    "execution": "blocked",
    "saving": "not_performed",
    "reopening": "not_performed"
  },
  "performed_actions": []
}
```

run_status描述程序/Agent运行，task_status描述业务结果。普通只读exec完成也标记unverified，
不从正文猜“画完”；旧ok保留兼容，不能单独作为业务验收字段。
exec --intent redraw明确阻塞且不启动模型/MCP；自然语言本身不作可靠意图分类器。
stages分别记录识别、规划、执行、保存、重开，performed_actions记录真实动作与请求身份。
用户任务授权、显式写授权、运行时能力分别记录，避免把缺少接口误报为用户未授权。

JSON schema描述结构；计划ID唯一、尺度证据、身份匹配、revision前进、几何及文件一致性，
还由TypeScript运行时校验。仅schema通过不代表可执行。
策略哈希针对JSON.stringify(Plan.parse(plan))的UTF-8字节计算SHA-256，而非原文件字节；
添加新哈希是维护者审查后的配置变更，不由模型自动更新。

## 接入与验收

独立profile参考[AutoCAD.http.example.yaml](../../configs/mcp/AutoCAD.http.example.yaml)。
command/cwd替换为本机绝对路径；根.env的CADER_AUTOCAD_HTTP_CONFIG引用已存在的独立HTTP配置路径，
AUTOCAD_BRIDGE_TOKEN提供凭据。env_refs只写变量名，缺失拒绝启动。
示例不会创建MCP配置或更改默认COM，也不保证外部服务已支持本协议。

先通过固定几何真实闭环，再扩大图片任务。当前fixture覆盖身份/请求错配、过期revision、
未知结果、回滚、分页循环、未知类型、错误几何/文字、文件哈希及重开不符。
真实MCP与DWG验收仍在[#3](https://github.com/codesknight/Cader/issues/3)和
[#14](https://github.com/codesknight/Cader/issues/14)跟踪；本轮未修改MCP。
