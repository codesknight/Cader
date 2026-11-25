# 新回执下的原始绘本与复杂手稿联合回归

2026-11-25，REQ-048 / [#20](https://github.com/codesknight/Cader/issues/20)，Milestone 3。Cader **14ada93**、独立 AutoCAD-MCP **aed49a7**，真实模型和 AutoCAD 2026。**本次联合回归未全部通过：绘本热态通过；绘本冷态新建失败；复杂手稿结构检查通过，但视觉未接受，保留待验 DWG。** 既有成功记录不替代本次结果。

## 输入、入口和证据范围

绘本保留原始“新建画布，房子、红屋顶蓝墙、旁边大树、儿童绘本风格”，只增加本次 DWG 保存要求。复杂手稿使用同一原图和原始复现请求，沿用实际用户已确认的九处标注及一处底部回线关系；没有新增人工回答，没有把它替换成简单电路。

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task $houseTask
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --quality --task $circuitTask
```

完整输入分别保留在私有 `joint-regression-20261125/house-request.txt` 和 `circuit-request.txt`。两个入口均经过实际 InteractiveSession、DSH MainAgent、受控工具及独立 VisionAgent；模型自主选择工具、生成组件和导线操作，未用固定几何计划代替推理。不是完整 DSH app profile 验收。本批没有改 Cader/MCP 运行时代码，没有放宽 verifier 或审批策略。

原始 console、事件、quality、execution、截图和模型可见结构化报告均保留在 `.cader/runs/`；公开文档不包含私有图纸、源图连接明细或密钥。

## 逐次实际结果

| 任务与私有 run | 结果 | 执行事实 |
| --- | --- | --- |
| 绘本冷态 `quality-9d19ef77-f2b9-4f52-964e-c6c1ee647798` | **blocked，未完成** | 新建原生 ACK 后读取 Name 失败；0 committed、1 committed_observation_failed、0 unknown；168906 tokens |
| 同原需求的独立绘本热态任务 `quality-34169d88-42bd-4555-b296-e8cbc659a265` | **7/7，通过** | 34 committed、0 unknown；1 轮修正，2 次 Agent 主动 CAD 视觉/2 次模型请求；562857 tokens |
| 原始复杂手稿 `quality-ab6e3d71-02ab-44ca-bb85-df75ab44cd78` | **pending_verification，未接受** | 93 committed、0 unknown；1 轮修正，2 次 CAD 视觉/2 次模型请求；1256147 tokens |

每次 smoke 都包含一次故意遗漏文字高度的确定性负测，它基于真实发现的 MCP schema，在本地派发前拒绝，不能算作模型自主错误或真实原生故障。绘本热态另有两次填充 XYZ 参数拒绝，手稿另有一次模型请求派发前拒绝，均没有冻结或副作用；这些原始失败不删除。

绘本热态一次任务授权，保存另审，共两次批准；手稿一次任务授权覆盖本任务受保护的目标 DWG。未向 Agent 开放通用 execute 入口。绘本确认写入使用新回执 12 次/旧受控入口 22 次；手稿为 84/9。旧入口不能声称有同等原生逐动作回执。

## 绘本与生命周期验证

热态绘本完成了红屋顶、蓝墙、大树、简明亮色绘本风格和文件保存。复用 Harness 导出的最终图像作独立人工查看；原生实体检查确认屋顶、墙体、树冠填充分别为实际红、蓝、绿。树冠较棱角化为已记录的 minor 风格建议，不影响本次必要条件。

新建回执与 SaveAs 回执的 instance/document ID 一致，实时绑定名称从新图标签变化为保存名称；没有以名称变化转移所有权。该正向实机证据补充首批接入时尚无活动图纸的限制。

绘本 DWG **21116 字节**，SHA-256 `8e44cb3221abd0cac2a32bd64d0952f72a1df2a48bf11768056c585dab53e0c8`。在同哈希副本上独立原生只读重开，**35 实体**的几何、文字、图层、颜色等与原生快照一致，审计共享字段匹配；其他文档在该检查前后不变。原文件和原文档保留。通用绘图保存证据位于 `execution.artifact`，本例的顶层 `quality.artifact` 为 null，不能据此误报没生成文件；报告明确使用实际保存回执、文件摘要和原生重开结果。

## 复杂手稿：可靠续跑通过，视觉仍未通过

独立源器件清点、连接复核、标注清点有效，九处标注/一处回线真实确认全部绑定。11 个组件的计划外部连接与独立原图期望的 **8 网**匹配。模型选择了完整自定布局，`source_layout=null`，没有使用现有源布局投影入口。

执行中实际出现 **2 次 MALFORMED_RESPONSE、2 次 OUTPUT_TRUNCATED 和 1 次 EXECUTION_ROUND_EXHAUSTED** 检查点。Harness 保留原任务/连接/文档、查询进度后有界续跑，不重放已确认操作；这些不是故障夹具。早期将两个格式恢复检查点口头称作预算检查点不准确，本报告按最终原始 reason 统计。

初轮检查发现导线穿文字包围盒；视觉还发现部分标注远离所属元件及右下支路布局偏差。局部移动后，压线、禁穿组件、文字数值与外部拓扑检查通过。最终视觉仍为有效 **uncertain**：必要的符号/相对布局验收未接受，且没有给出可定位的新缺陷。现有 `nonActionableUncertainty` 分支在第 1 轮后安全暂停，没有虚构修正或把 uncertain 改为 pass。这不是达到三轮/总预算上限，也不是 MCP 断线或 unknown 屏障。

待验 DWG **22697 字节**，SHA-256 `fa7346e87b3ae489395984b7084ba632b9283b10785662938f007553dd6e9e0d`。其同哈希副本独立只读重开成功，**79 实体**与审计及原生快照一致；独立原图期望核对 8 网、9 标注（5 种字符串出现次数）和三角接地轮廓，10 项非视觉原生检查通过。**这些结构结果不能把 quality_accepted=false 的待验稿提升为完成稿。** 本次并未完成整体重绘验收。

## 已证实缺口与后续修复边界

**BUG-077 / MCP，open：** 无活动文档开始页的原生 Documents.Add 已 ACK，随后 `<unknown>.Name` 导致 result_document_id=null。后续观察到 managed 新空图，不能追溯补造原请求绑定。COMSession.execute 存在直接 `document.Name` 访问，而既有 binding 使用安全 DISPID getter。确切包装缓存/元数据/就绪机制未确定；[最小修补建议及冷态复验要求](../contracts/2026-11-25-mcp-new-document-label-feedback.md)已记录，未改相邻源码、未解锁首轮。热态成功不是冷态缺陷修复。

**BUG-078 / Cader，open：** 自定参考布局与源投影标注坐标没有统一。`quality.ts` 的 schema 允许完整自定 components/nets；本次确实选择自定布局并引入相对位置偏差。绘制单元的 label 布局提示仍直接来自 `referenceLayoutHints`，未按该自定布局重映射，导致初稿出现明显标注偏移。源码路径与实际图像、计划/标签坐标共同支持这一缺口；视觉具体每次措辞仍属模型判断，不能一概当成确定性定位。

下一步应在派发前统一参考重绘的组件、端口和标注坐标：默认复用 `source_layout`；完整自定布局须提供并验证一致映射，不能只增加“请使用 source_layout”的提示。对源图相对布局有明确要求时，违规方案应在 CAD 前拒绝并反馈重规划。视觉模糊意见须结合源位置、原生实体和已封存布局对账，产生可执行缺陷或明确 replan 状态；不询问用户是否愿意接受已知布局偏差，不放宽验收，不硬编码本电路。

本批仅回归和审计，上述两个缺口均未被标成已修复。此前 REQ-046 的源确认恢复、主动真人澄清和聊天自动压缩仍不在通过范围。

## 契约、检查与保留

图纸打开后再次执行 `pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --execution-evidence`：`execution-evidence-a7e615ea-c9c5-4599-85e1-2084e1d5a499` **7/7、exit0**。这是实际 MCP/COM 只读契约检查；不调用模型、不发送有效绘图操作，不替代上述两个原始任务。

`pnpm typecheck`、`pnpm test` **241/241** 通过；本批未改 Harness，没有重复组件 smoke 的必要，真实质量入口已显式执行。CI 仍为无付费模型/CAD的代码回归，当前报告提交的 CI 结果在 Issue20 补记，不将它当作视觉通过。

开始前记录的 **16 份历史屏障**、原图 SHA 和此前原稿通过收据在回归后均不变；此前通过 DWG 另作摘要核对。首轮新建失败的空图/屏障、已验绘本、待验手稿、只读校验副本及所有失败轨迹均保留；没有关闭或重启 AutoCAD，没有清除或重放旧 unknown。

汇总 `.cader/runs/joint-regression-20261125/summary.json`；各 run 内保留 `independent-native*.json`、原图期望验证和绘本独立检查。独立原图期望仅用于验收，未传给模型规划或 CAD 执行。#20/Milestone3 及 PR22 整体集成状态保持待验。
