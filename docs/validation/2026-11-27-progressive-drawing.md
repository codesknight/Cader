# REQ-051：渐进绘图实施与真实回归

日期：2026-11-27（Asia/Shanghai）；Cader 0.4.0-dev.13；工作项 [Cader #20](https://github.com/codesknight/Cader/issues/20)，Milestone 3。**原始大图尚未通过整图验收，REQ-051 保持进行中。**

## 代码与离线验证

已复用 Catalog/Loader/Available、DSH、ExecutionSession、原结构/网表/标签/视觉及 P1 文件验证模块，新增范围合同和渐进 Scheduler；没有新 AgentLoop、固定图形操作计划或模拟真实 CAD 回执。详细职责与失败驱动修复见[工程记录](../development/2026-11-27-progressive-drawing.md)。

- `pnpm typecheck`：通过。
- `pnpm test`：最终全量 **309/309** 通过，含大小写图层保护及跨区边界真实导线要求。
- `pnpm smoke`：通过；这是 DSH 组件夹具，明确 `realModelEvaluated=false / cadEvaluated=false / fullAppProfileEvaluated=false`，不冒充实机。
- `node benchmark/run-progressive-case.mjs --help`：通过，未连接模型或 CAD。
- `cader -v`：`Cader 0.4.0-dev.13`。

测试覆盖：简单/复杂/纯分析路由、只读角色与阶段资源、分区覆盖/DAG/共享锚点、裁片实际字节与程序坐标转换、越界和重复、真实 DSH 批次回调/部分成功交接、新文档 ACK 终止、视觉失败业务状态、同连接恢复/累计额度与 scope 次数、失败缓存刷新、unknown 拒绝续写、原子检查点失败和独立验收覆盖历史模型阶段错误。确定性夹具的图形与模型结果均只作离线测试，不属于下面真实模型证据。

## Skill 加载证据

用户 ZIP：`Cader_Progressive_Drawing_Skill.zip`，SHA256 `b7b08e36038c029a5cdbb25d2d6c41cb14e280a2d791e409d2eae0cc4962b99d`。已阅读 SKILL、INSTALL、三份 references 和 Catalog 示例。仅将技能正文/引用放入集中配置，并补充当前真实 Cader 绑定；未运行包内安装脚本或给 Skill 写权限。

本机实际加载的资源摘要：

| 资源 | SHA256 |
|---|---|
| SKILL.md | `599b6cee915b32c24cb71d050dcee64991f5a12dd4cd909165b9a592afecb43c` |
| task-decomposition | `73b9afa6ea4277e589f3cab3de39748806e897d95060b21c9b316ac41e75c601` |
| verification-and-repair | `2a2e6f23df6b801cdbea64ee9d4469b8926aae361d45c3f02f78d58e843709a7` |
| checkpoint-and-recovery | `0f481cf98eebabf7f2a9660e640bbdeb03dcc396291c67802ccb735c81c3611d` |

真实事件 `skill.loaded` 覆盖 main/vision、selected-resource/on-demand，另记录 `prompt.assembled` 的实际工具列表及摘要。新版 `sha256` 是正文摘要，`context_sha256` 才是正文拼接阶段资源的摘要；旧测试中的 combined hash 不应误读为文件发生改变。简单绘图只保留目录元数据，不注入渐进正文。私有原始事件与脱敏加载摘要位于 `.cader/runs/progressive-20261127/`。

## 真实环境及保护

原始参考为用户这次大图 `img_001.png`，4967×3509，SHA256 `541f0f75b878e4ca2f053ca975b5aa8e19e4db1bd87bec0199c30f7b7f314f1b`。原始请求“新建画布，复现这张图纸：…”保留，仅增加本轮独占 DWG 输出意图。模型自主分区、选工具及多轮调用；不注入预写 CAD 序列、不导入旧 DWG、不用简单电路或圆替代。

使用 AutoCAD 2026 独立新实例 PID 76772；私有 ROT selector 仅选择已验证的新实例，仍使用生产 COMSession/server/原生调用。另一个通用任务用独立 PID 144908。启动前 PID 49292/59304/123556/127908 不接管、不关闭、不清图；只关闭新实例自身未修改且为空的启动图。相邻 MCP HEAD `3745af8`，本轮不修改其源码或覆盖其原有未提交修改。

原始图、历史 DWG、锁和屏障等 **27/27 文件 SHA256 保持一致**；保留各轮新建工作图、只读验收图和新屏障，没有清理 unknown 或擅自归档。原始轨迹只留私有运行目录，公开文档不提交图纸内容、密钥或隐藏推理。

## 真实大图：已取得的证据

命令：`pnpm live-smoke --mcp <本轮已隔离实例配置> --quality --task <large-request.txt完整原文>`。模型服务和 CAD 均为真实服务。

| 运行 | 实际结果 |
|---|---|
| 早期 1–6 轮 | 规划/DAG/锚点、源坐标、局部类型、组件/标签不一致和 MALFORMED 失败，0 CAD 写入；原失败均保留并驱动代码修复。没有把 schema32 上限当作唯一已证实根因。 |
| `quality-aeda87d8-c6ba-47f2-882d-1612cc69b30a` | **40 committed / 0 unknown**，29 实体阶段性 DWG，因任务累计 token 2,009,352 安全暂停；非整图通过。 |
| `large-expanded-8b` | 新建已实际 ACK，但当时仍等模型总结导致误判；1 committed / 0 unknown，已据此修复阶段结束与原 ACK 核对。空图保留。 |
| `large-expanded-8c` | 生产 InteractiveSession 在首个通过的真实批次检查点主动中断，再同连接 `/quality resume`；恢复不变量全部通过，new_drawing 仍1次；最终 **25 committed / 0 unknown**，已登记22实体，两个区域通过。累计8,008,955 tokens暂停，整个请求未通过。DWG已保存，但独立重开被 OTHER_EMPTY_DOCUMENT_OPEN 在native前拒绝，保存证据保留。 |

阶段性 DWG 的实际路径位于本地 `artifact-14d60be7443e4831836663acb9165078/img_001-progressive.dwg`，**20,836 bytes**，SHA256 `a8f2c0334246fb1861161890b46f0ab23a2165ad2ecda46a78b4d6f69cf2adf5`。P1 保存和独立只读重开 verified，29 实体；原生独立 verifier 没有调用 Open/SaveAs/Activate/Close。工作图与只读副本的支持原生几何、文字、图层内容匹配，文件摘要一致。`legacy_summary_partial` 不当作任意 DWG 语义证明；此产物明确是**未完成待验稿**。

首次原生复核曾与先前查询的文字 bounding_box 不一致；重复原生读取后与回执一致，前次失败控制台及两轮读回均保留。可变文字范围不能当作原生 revision 保证，未据此放宽程序验收或宣称全图通过。

`large-expanded-8c` 明确启用仅本轮的扩大回归预算：8M reported tokens、3000工具、1500CAD、50轮、800模型步骤、2小时。不是产品默认值；单轮100/64、单响应8192不变，累计成本不归零。这个测试用于暴露后续调度和质量问题，不能以扩大额度宣称解决源识别。

最新有界源复核使用原始大图真实裁片和最终候选核查逻辑：两次 VLM 均成功，4/4个候选观察中 **2 个片段**达到程序一致条件，结果 `valid=true / coverage=partial`；未替换为整区清点或拓扑通过。完整像素 hash、裁片映射、独立运行 ID 和工具提交保留于 `targeted-source-review/events.jsonl`。

## 通用任务与新发现的 MCP 阻塞

另用“新建画布，分区域逐步画房子，红屋顶蓝墙，旁边大树，儿童绘本风格”验证通用路径；这不是原始大图的替代验收。真实绘制/修正产生 **21 committed / 1 unknown**，在截图 `backup_add` 时 COM 返回 `RPC_E_CALL_REJECTED`。原回执确认 capture mutation 已开始且恢复未证实，Cader冻结并停止，未重发、保存或把视觉失败显示绿色。整图 **blocked，未通过**，证据在 `house-regression/workspace/`；见 BUG-088。

截图是否受并行实例/原生忙状态影响尚无充分证据，不归因于提示词。下一步 MCP 需要原生前可观测就绪状态，以及对已派发请求的对账、恢复证明；unknown 不能通过客户端强制重试消除。本轮没有授权自己删除屏障或擅自修改邻仓。

## 可重复的真实恢复驱动

新增通用 `benchmark/run-progressive-case.mjs`，不包含案例几何或期望图。先构建，再显式调用：

```powershell
pnpm build
node benchmark/run-progressive-case.mjs --live-smoke --approve-cad-task --mcp <真实配置> --workspace <新的空目录> --task-file <UTF-8原始需求文件> --checkpoint-pause-resume
```

该脚本使用生产 Session/Task，采用当前配置总预算，首次实际通过批次检查点后才中断、同连接恢复；自动批准范围只有 CAD 请求，拒绝 Shell。所有文档/失败证据保留，最终未验收返回非零；未发生中断不冒充恢复测试通过。CI 不调用该付费/CAD驱动。

## 尚未满足的验收

原始大图的全量区域/标签/拓扑覆盖、最终完整外观与成品 DWG 尚未通过。源识别分歧、模型输出截断、总预算和服务端截图 unknown 都作为真实未决条件保留。离线测试、局部通过、文件重开或 Skill 加载均不能单独满足这项验收。对话自动压缩/新开聊天不属于本次实现；同连接任务 checkpoint 恢复不等于跨进程接管。

## 扩大预算恢复测试的交付限制

8c 保留了更早 8b 产生的空白工作图。MCP 的独立 Open 前置保护检测到另一张空图，避免 AutoCAD 自动关闭它，返回 `OTHER_EMPTY_DOCUMENT_OPEN`。该次没有 Open 派发，没有 unknown；未把已有空图关闭以换取通过。保存得到20,519 bytes阶段性 DWG，SHA256 `3ed32e31d7e65e253ad3ec441254843f85e17e57c59c6cfe14a5e2d9b19b716b`，路径在本地 `artifact-cfe09b0dbe0147feb2831592bda3c53a/`；与先前独立重开verified的29实体待验稿分别保留。前者只确认保存，**不能标为DWG独立重开通过**。

为了验证最终代码，后续原图回归使用另一新实例PID165380、生产通用驱动和产品默认2M总token/30分钟预算，仍保留全部历史图纸。新计划已实际根据priority优先调度主体区域，未固定源图坐标/操作序列；最终结果追加在下方。这不是把扩大预算默认发布。
