# Cader 新回执适配、身份校验与错误分级

2026-11-25，REQ-047 / [#20](https://github.com/codesknight/Cader/issues/20)，Milestone 3。基线 Cader a2ee0b1；独立 MCP aed49a7（PR45 / 实施 8b86140）。依据用户明确启动的首批接入要求及 MCP 的 `docs/validation/2026-11-25-execution-evidence-p0.md`。本批适配和离线测试已通过；真实服务契约部分通过，实时图纸绑定受当前无活动图纸限制，完整绘本/复杂手稿联合验收未执行。

## 执行层接入

保留 DSH/Cordis、ExecutionSession 串行与权限、Scheduler 和 Recovery。新模块 `packages/dsh-adapter/src/execution-evidence.ts` 负责 COM 能力、身份和回执验证；DSH 内部调用仍只在 adapter 边界。没有新 AgentLoop，没有向模型开放通用执行接口，也没有修改相邻 MCP 项目。

连接后核对 `autocad-backend-evidence/1`、COM 生命周期身份、明确不支持 revision、`autocad-execution/1` 入口及原请求 journal。声明不完整或缺失入口则拒绝连接；旧服务没有该声明时保留既有受控路径。HTTP 不套用 COM 契约，既有 managed/Bridge 路径不变，本轮没有新增 HTTP 验收。

模型仍调用原受控工具。执行层在权限、schema、几何、图层依赖和文件保护通过后，按服务声明选择新入口：

| 模型工具 | 新入口 operation / 主要转换 |
| --- | --- |
| new_drawing | new_document，输入 document_id=null |
| draw_line / draw_circle / draw_text | start/end、center、position 的 XYZ 数组，保留图层和文字旋转度数 |
| move_entity / delete_entity | 原实体 ID、offset 数组 |
| save_drawing | 受保护的实际路径与 overwrite |
| get_entity / query_entities | 同一工作图的实体读取 |
| 内部 export_current_view | 受控文件路径和程序 request_id；仍校验独立截图恢复回执 |

未覆盖的图层、多段线等使用原接口，仍校验原工作图身份；不能声称拥有相同逐动作 ACK。每个请求使用程序生成的 ID；精确请求 JSON 及其 Cader SHA-256 在派发前写入并同步到私有 audit，再单次调用。服务指纹与 Cader 请求 JSON 摘要各自保存，算法/序列化范围不同，不混称同一个 hash。禁止派发失败后切换入口重试。

## 身份和分级

新建成功回执提供 instance/document 身份，随后显式观察 `get_document_binding` 并核对 managed、read_only。后续写入前、审批后、postflight 和只读对账均核对原身份。同名不同 ID、换实例、只读或非本连接工作图拒绝写入；同 ID 的 SaveAs 标签变化不转移所有权。缓存名称不是实时观察，COM revision 始终标为 unsupported。新建图纸本身不要求先有活动文档。

DSH MCP 插件对 `isError=true` 抛出文本错误并丢弃 structuredContent；adapter 只对精确的新入口尝试解析 JSON 信封。信封仍不可信，必须通过 schema、请求/实例/文档/operation、动作 ACK、阶段和实体集合一致性校验后才可用于分级。普通错误文字不证明未执行。

| 情况 | 结果 |
| --- | --- |
| 匹配的 not_dispatched，无原生动作/副作用声明 | failed_before_dispatch；transport 已送达、native 未调用，不冻结 |
| 原生全部 ACK，之后 observation_failed | committed_observation_failed；保留写入 ACK 和已知实体集合，不能把不完整集合当完整结果 |
| 无 ACK、错身份、缺字段、矛盾回执、无可信信封或超时 | unknown，保留屏障，不重放 |
| 新建已 ACK 但缺少可验证的结果文档 | acknowledged_unbound；不能查询活动旧图来恢复 |
| 原写入成功，独立读回失败 | 保留原写入回执，读回异常另存，不能用读回 ID 覆盖写入 ID |

`cader_cad_execution_status` 无模型可传入参数，只读取本连接准备过的原写请求；查询不改变 outcome 或解除屏障，缺失/过期/重启/异身份均不能证明未执行。当前没有实现“journal 查到成功就自动解除 unknown”。既有 ACK 后 postflight 失败仅允许原连接、同一可写工作图只读重查后恢复；原始失败审计不改写。繁忙只读查询有限重试时使用新 ID，避免服务缓存同一失败结果；写入不重试。

截图外层执行回执和内层 `autocad-capture/1` 同时验证。外层 unknown 不能被内层恢复声明覆盖；新入口即使返回图片路径，没有打印设置恢复证明也不能宣称截图已安全完成。

## 实际检查

| 层级 / 命令 | 实际结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **241/241** 通过 |
| `pnpm smoke` | DSH 组件通过；无真实模型/CAD，不是完整 app profile |
| 新专项 `node --test dist/tests/unit/execution-evidence.test.js` | **38/38**；真实 stdio + DSH + 受控执行层，服务/原生数据为确定性夹具 |
| `pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --execution-evidence` | 真实服务契约 **5 项通过、2 项绑定检查未执行，整体非零退出** |

专项覆盖：成功、原生前拒绝、ACK 后观测失败、真正 unknown、错误/缺失/矛盾身份和副作用、同名换图/换实例、只读/非托管、错误能力声明、journal 错请求/指纹变化/查无/丢响应、只读繁忙新 ID 重试、终止读回失败、未绑定新建、旧接口兼容及未知、权限拒绝、重连保留原锁字节、截图恢复/未知/缺证明。模型不能取得原始 execute_observed_operation 入口，未出现新入口失败后的旧写入兜底。

真实契约最终记录 `.cader/runs/execution-evidence-f7dcddc3-bd59-4235-a354-f22d235a3908/`：47 工具能力发现、故意缺少 center/radius 的请求由服务在原生前拒绝、原请求完整 journal 一致、错实例 unresolved、查无 unresolved 均通过。测试不发有效绘图操作、不调用付费模型、不采用现有图纸为工作图。

当前 PID 48984 停在 AutoCAD“开始”页，没有活动图纸，真实 `get_document_binding` 返回 `CAD document is not connected`；绑定前后检查保持 null，报告 ok=false，未改成通过。此前两次探测的失败也保留。本轮不是 CAD 崩溃、COM 写失败或完整绘图失败的复现，没有借此修改 MCP 或清除旧锁。

原始检查和本轮历史失败归档到 `.cader/runs/receipt-adaptation-20261125/checks/`。开发中首个新夹具未响应客户端额外 RPC 而握手超时；补标准 method-not-found 响应后连通。旧兼容夹具曾错误把标量放入 structuredContent，改为标准 text content。初版 typed fixture 缺少新增 health 字段、离线工具目录断言也分别修正；旧失败输出保留，不把它们当产品真实 CAD 故障。

## 保留与下一批

旧 unknown 屏障和审计不迁移、不重放、不解除。重连保留锁的回归在独立夹具验证；真实历史锁另作只读观察记录，不冒充“测试前后 hash 比较”。未覆盖的旧操作仍可能因缺乏可靠原生证据而冻结。COM 没有权威 revision、跨 Python journal、原子批次或可靠像素映射保证。

下一批在明确工作图/原连接下，分别完成真实生命周期切图/SaveAs 和错误分级验证，再以原始“红屋顶蓝墙、大树、儿童绘本”和原始复杂手稿运行真实模型自主多轮绘制、视觉/拓扑、DWG 保存及独立重开。保留此前 MCP 手稿失败和已有用户确认，不能用本批夹具或 admission 测试替代。稳定源确认、主动真人澄清和聊天自动压缩仍为 REQ-046 的未实现项，不包含在本批通过范围。

提交与当前 HEAD CI 在 Issue20 补记；#20/Milestone3 及 PR22 的整体集成状态保持未完成。
