# Cader普通COM文件交付P1联合验收

2026-11-26，REQ-050 / Cader #20 / Milestone3。依据独立MCP3745af8/7086673的[最新报告](https://github.com/codesknight/AutoCAD-MCP/blob/3745af8/docs/validation/2026-11-25-com-artifact-p1.md)。MCP独立报告导入已有DWG，不等于本轮Cader新模型自主绘图。

本批完成Cader接入及两项原始任务的真实模型/AutoCAD闭环。房子 **6/6、57确认/0未知、37实体验收图**；复杂手稿 **13/13、88确认/0未知、83实体验收图**，均实际走三项P1文件操作，再由独立原生verifier检查服务端已重开的同一只读文档。脱敏[机器摘要与客户端关联](evidence/2026-11-26-com-artifact-p1-summary.json)；私人DWG/截图/全实体和轨迹不提交Git。

MCP报告的48/77来自导入旧图，本轮是模型从头绘制，图元分解不同，不能用旧实体总数代替本轮语义验收。对每份新产物，其工作图与只读验收图受支持字段一致；电路另过独立8网/9标注/接地轮廓。

## 实现

- 能力发现完整声明三操作和文件契约才启用；已声明但不完整拒绝连接，无静默旧入口fallback。旧服务保持原路径，明确没有新文件证明。
- 模型仍调用受控save_drawing，父目录/文件名转换为P1请求。实际落在独占artifact子目录；保留requested_path和实际path。SaveAs改变标签/FullName，但生命周期ID不变；不假装HTTP复制保存语义、不挪回用户请求路径。
- 验证receipt.file_result与结果一致、实例/源/请求/产物/验收ID关联、文件头/大小/SHA/路径；reopen结果ID仅对该操作允许不同，验收只读、managed=false且不是源图。query外层/内层均用验收ID，不更改nativeTarget；每次仍核对原工作图。
- cader_verify_dwg_artifact是当前已授权任务的受控入口，不接受任意路径或模型指定文档。Scheduler在完成前补验，已有登记验收图只重查，不重复Open。保存后旧人工入口也不能覆盖P1文件验收缺失。
- 工作图前后摘要与验收图提供的字段全部比较；仅忽略跨文档ObjectID，数字按7位小数。明确legacy_summary_partial、snapshot_revision=null；不以字段子集相等声称任意DWG完整几何语义等价。
- 明确拒绝P1 overwrite=true意图与未映射参数，不能默默改为覆盖或丢弃参数；新独占目录保留同名旧文件。外部父目录（含跨盘符）仍须原权限批准，不能因namespace而绕过workspace策略。
- SaveAs和文件复核分账；失败保留文件/ACK/副作用，不自动清理、不重放。Open未知和ACK后观测失败不接受几何recover。原生前拒绝或只读查询失败允许对同一已确认产物安全重验。

## 离线检查

`pnpm typecheck`、`pnpm test` **280/280**、`pnpm smoke`（DSH组件）通过。P1专项20项实际stdio + DSH owner + Scheduler/UI，另新增原图内容补充视图、人工验收不能覆盖缺失文件证明两项；底层确定性数据/合成文件不算AutoCAD实机。覆盖合法交付/安全重验/不重复Open、ACK丢失、ACK后失败、错身份/摘要/指纹、坏能力、UNC/父跳转/外部父目录、不覆盖、未映射参数拒绝、只读副本篡改、禁止提前完成及实际路径显示。

早期编译/夹具失败保留。发现并修复fallback视觉重算遗失Agent保存状态的问题；quality_accepted只在complete阶段持久化为true，保存/交付尚在进行时不提前通过；人工确认不能代替P1文件验收。独立verifier两次GetBoundingBox出参错误采用明确InvokeTypes出参修正，未改生产MCP或放宽任何比对。

Cader本地Python兼容检查（代码未改）：Ruff check/format、10/10 pytest及`uv run --project cader-mcp cader-mcp smoke`通过；该smoke为离线MCP协议，不是COM。独立MCP报告298通过/34跳过来自上游报告，本轮未将其冒充Cader本地测试。

## 实机

私有轨迹目录`.cader/runs/com-artifact-p1-20261126/`及下列quality run。显式命令：

```powershell
pnpm live-smoke --mcp .cader/runs/com-artifact-p1-20261126/owned-mcp.local.json --quality --task <原始房子/手稿需求及已有实际用户确认>
python .cader/runs/com-artifact-p1-20261126/verify-native-p1.py <quality-run>
node .cader/verify-circuit-semantics.mjs <原始手稿quality-run>
```

未使用旧DWG导入/固定CAD操作计划。主模型与视觉按当前deepseek-flash实际配置运行；源图已有9标注与回线真实确认继续引用，不伪造新人工批准，不把独立期望网表喂给模型。隔离选择器只返回核对过的新PID123556的真实native IDispatch；生产MCP/COM执行器未替换，没有模拟CAD结果，也不代表产品新增PID选择功能。开始前已确认不属于原PID48984/49292/59304；只关闭自建进程的一张自动空白启动图以得到冷态。

### 房子、红屋顶蓝墙和大树

run `quality-90ec8df0-ead6-42a9-9790-97bde44f0af5`，6/6、57受控CAD操作确认/0未知、3轮局部修正、4次实际视觉请求，1777042 reported tokens。模型实际调用受控文件核验入口；1次Open、2次验收查询（主Agent和Harness复验共用同一验收文档）。模型2次保存各有独占目录，旧初稿未覆盖；最终只交付下列指纹，不把首份SaveAs完成视为语义完成。

最终DWG **21206字节**，SHA-256 `bc983f03c4febad8afa363cd99557de3ecd9bcf42a7134bd6ad31cef9ccf4409`。源工作图ID `06ba31b9bca3422aba078b0fdff4c7d7`，独立验收ID `3c0db1ab9b674084a731912d0fbf6d95`。实际37实体，Native字段/文字/坐标/填充与工作图相等；查询回执实体ID和返回字段均对应同一只读图。原图画面可见红屋顶、蓝墙、大树，视觉通过，保留minor非必要建议。

### 原始复杂电路手稿

run `quality-11d93508-e335-4b93-89a4-65fb00589e2a`，13/13、88受控CAD操作确认/0未知、0修正、1次实际视觉，1510390 reported tokens。程序兜底实际执行保存→只读重开→验收ID查询；1次Open/1次查询。3种文件操作共用当前实例、请求先落盘，SaveAs的源ID不变，验收ID独立且不接管。

最终DWG **20058字节**，SHA-256 `b9068c697eb2dd5891bdb316ac9c197850fef7ecbb4ea37db5dcd5426f3ff6f1`。源ID `52326530435a414a89e699f343485a54`，验收ID `e8af064166de447d9145c7cf92f46945`。83实体只读验收，完整受支持的原生字段与源工作图相等；额外独立8网、5类文字共9标注、三角接地轮廓及10个非视觉条件通过。不是只画简单圆或复用固定电路脚本。

### 独立verifier与失败保留

独立verifier直接读生产服务已打开的验收图，不额外Open/SaveAs/Activate/Close。复用MCP验证驱动的纯snapshot函数，不运行其导入旧DWG主流程；另用明确ActiveX出参读取bbox，逐项核对本轮查询回执与实际验收图。完整支持字段比对不是任意DWG完整语义等价，源语义使用另一份期望与CAD拓扑程序验证。

前四轮手稿源识别在CAD前阻断，均0写入/0未知：

| run | 已记录原因 |
| --- | --- |
| quality-6050a1a2-4302-448c-b625-069f575cb938 | SOURCE_TOPOLOGY_UNCERTAIN |
| quality-3140c575-9142-4218-af18-626516653f58 | SOURCE_COMPONENT_INVENTORY_FAILED |
| quality-0bcb0622-79af-4b90-a408-dcddfc5060b5 | SOURCE_TOPOLOGY_UNCERTAIN |
| quality-611b7084-a954-4e93-b649-eb8b44ff01c8 | SOURCE_COMPONENT_INVENTORY_FAILED |

未据此归因MCP文件故障、重放或放宽验收。复用已有sourceDetails/图像裁看，按观察content_bounds补充内容区域放大图；原图仍同时输入，并附crop到原图归一化坐标换算。加实际DSH夹具证明两图/元数据及原文件不变；随后第五轮通过。此改动没有提供独立网表答案，也不证明所有手稿识别稳定性已彻底解决。

## 保留、范围与提交

23份原有文件摘要一致：17份历史屏障、原参考图、2份旧DWG、3份MCP已有tracked改动。MCP源码与既有untracked用户文件未改，本批仅提交Cader。新产物、初稿、只读副本、原始工具轨迹及失败均本机保留；未回写旧质量记录或旧unknown。

正常清理检查发现测试实例中的房子工作图Saved=false，原因未确证；产物/只读副本指纹及已验几何仍一致。为保留内存状态，未Close/Quit/强制保存该自建实例；原三个进程未Close/Quit。此保留不等于文件尚未交付，也不改写已验证的磁盘字节。

本轮实测在开发工作树进行；后续只增强拒绝分支、保存中完成标志/状态说明及继续时实际路径显示，其覆盖依靠新增反例与最终全量，不虚构这些拒绝在成功实机里已发生。最终提交与当前HEAD CI在#20补记，整体Milestone3/PR22其他范围保持开放。

COM没有权威revision、跨backend持久化artifact/journal、像素到实体映射；新P1也没有原子实体与文件事务。完整app profile和REQ-046自动压缩/批量澄清不属于本批。
