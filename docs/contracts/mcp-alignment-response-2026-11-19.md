# Cader对MCP契约对齐意见的回应

> 本文保留实施前的对齐回应。后续MCP已确认修订2/映射修订1并实现专用profile，
> Cader已独立完成[固定几何真实闭环](../validation/2026-11-19-cader-cli-real-loop.md)。
> 原共享快照继续保留unfrozen，不据此声明联合发布冻结。

日期：2026-11-19。关联[#15](https://github.com/codesknight/Cader/issues/15)。
输入：MCP团队同日的cader-managed-cad-v1-alignment.md，审阅基线Cader be2887f / MCP 5fbd007。
本文为Cader侧回应和实施说明，**不是双方签署的冻结版本**，不宣称MCP专用profile已经存在。
原始对齐文档作为设计输入，没有自动执行其中命令，也没有修改相邻MCP项目。

## 四项语义决定

| 事项 | Cader回应及已实施行为 |
|---|---|
| managed与只读重开 | 接受MCP现有权限语义。WorkingBinding为managed=true/read_only=false；VerificationBinding为managed=false/read_only=true并绑定artifact。验收图仅进入查询，不能进入batch/save |
| 失败后revision | 接受observed_database_events，status必须声明。回滚/未执行可令revision前进；以权威失败后revision查询状态，停止本轮写入。缺失、倒退、身份不符或查询不能证实时保留锁 |
| 输出目录授权 | 选择MCP给出的第二方案：create显式传output_directory，而非到save才第一次传路径。只允许Cader现有且规范化的.cader/artifacts，回包确认目录。MCP可叠加私有白名单，不能静默换目录 |
| 操作相关对账 | job增加operation、request_document_id、result_document_id、source_artifact_id。batch/save指向原工作图；create/reopen产生新结果图，reopen按artifact匹配，不再错误要求结果等于原图 |

同意保留默认COM、旧44工具和既有HTTP Bridge。仅选择HTTP仍不等于DTO兼容。
不在Cader做旧工具静默别名，不绕过MCP专用profile；名称、单位、point→position、alias和错误DTO
适配仍归MCP。第一轮只接受layer=0上的line/circle/text，不隐式建图层。

新工作图也可能从非零观察revision开始，Cader已去除初始0假设，并在批处理前以返回revision查询空图。
成功批处理仍要求revision前进，失败不要求回退。回滚后实体查询只能核验本轮空图预期；
图层/样式事务回滚的完整承诺由MCP执行层负责。任何分支都不自动续写或重放。

## Job身份规则

| operation | request_document_id | 成功result_document_id | source_artifact_id |
|---|---|---|---|
| create_working_document | null | 新工作图，不能复用已知工作图ID | null |
| execute_atomic_batch | 原工作图 | 原工作图 | null |
| save_document_as | 原工作图 | 原工作图 | null |
| reopen_document | null | 独立验收图，不等于原工作图/其他已知图 | 输入artifact_id |

pending/not_found/失败时result_document_id可为null；有值也须符合本操作身份规则。
revision如存在，归属于result_document_id；失败无结果时归属于request_document_id。
batch失败后的revision必须权威且不小于提交前值，才能走独立状态核验；否则冻结。
reopen的同步结果还要在VerificationBinding中声明read_only和source_artifact_id。
get_job_status仍只传原request_id，返回必须匹配原实例、操作、输入目标和产物来源。

## 字符集与哈希

采用交集ID字符集`^[A-Za-z0-9._-]{1,128}$`，请求、步骤、文档、实例、产物及对象alias均为字符串。
实体alias仅在其document_id内使用，不跨工作图/重开图比较；独立几何匹配不依赖相同alias。
单位DTO限定unitless/mm/cm/m/in/ft；完整英文名及单位code的映射由MCP适配层完成。

区分三类摘要，避免把不同数据的hash误当同一协议承诺：

1. 审核计划：沿用SHA256(UTF8(JSON.stringify(Plan.parse(plan))))，只用于Cader策略审核。
2. 请求审计：prepared持久化request_json和request_sha256。request_json为
   `JSON.stringify({operation,arguments:已通过对应请求schema的参数})`的精确字符串，无末尾换行；
   参数包含预先生成的request_id，request_sha256按此字符串UTF-8字节计算。其他语言可直接对保存的字符串校验，
   不要求从对象重新序列化。共享audit_vectors给出完整字符串与期望hash。
3. 协议发布：manifest固定schema/examples两个文件的完整UTF-8/LF字节SHA-256。

**请求审计hash不替代Bridge内部去重hash**。MCP适配会转换单位、字段和操作信封，原生hash数据不同；
我们不要求修改既有journal。MCP需确认DTO→原生请求的确定性映射和重复ID冲突规则，
必要时关联转换前后hash。双方尚未冻结这一映射；Cader始终不自动重放，因此不以hash一致作为重放授权。

## 可共享的实施物

- [schema](../../configs/contracts/cader-v1.schemas.json)：cader-cad/1，draft_revision=2，含请求/响应和两种Binding。
- [manifest](../../configs/contracts/cader-v1.manifest.json)：精确文件摘要，状态明确unfrozen。
- [共享正反例](../../benchmark/fixtures/managed-cad-v1.cases.json)：18个结构、11个操作身份及1个请求审计向量，均为合成数据。
- `pnpm contract:export`：离线重导出schema与摘要；`pnpm run cader cad-contract`：离线查看schema。
- 调度器回归：只读重开、非零初始revision、回滚序号前进、stale拒绝、失败无权威状态、
  重开超时对账、旧/篡改journal、错误目录及只读权限。旧journal不自动迁移或解除锁。

## 待MCP确认与下一轮联合验收

1. 确认修订2的Binding、revision_mode、create输出目录和job身份字段；确认manifest中的同一份schema及例子。
2. 发布显式版本化profile/入口，保留普通server兼容；确认DTO映射及原生request hash冲突规则。
3. 无CAD共享向量先通过，再在授权的独立HTTP测试实例由Cader CLI完成三实体真实闭环。
4. 独立记录schema/客户端/DLL版本、请求、文件hash、只读重开查询及清理结果，再声明真实DWG验收。

本轮未执行真实MCP连接、CAD写入或DWG联合验收；组件向量/内存调度测试不替代这些条件。
图片计划仍阻塞，#15/#3/#14保持打开。
