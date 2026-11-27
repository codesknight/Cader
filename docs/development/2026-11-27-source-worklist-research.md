# REQ-053 / BUG-106：大图源证据与增量工作清单

关联Cader #20 / Milestone3。用户要求调研他人的办法并解决原始整图无法验收。旧图、77项原始证据和unknown屏障保留，不使用固定测试绘图序列。

## 一手资料及适用边界

- [SAHI sliced inference](https://github.com/obss/sahi/blob/main/docs/guides/sliced-inference.md)：重叠感知避免边界目标丢失，再做全局坐标合并。借鉴感知范围与独占所有权分离；不把通用检测库当工程符号识别器。
- [Automated Digitization of Engineering Schematics](https://www.mdpi.com/2079-9292/15/17/3785)：切片检测、OCR与文字/符号关联分阶段。该论文明确其图关系仍有范围限制，不能宣称已有通用完备电路拓扑识别。
- [Deep Vectorization of Technical Drawings](https://github.com/Vahe1994/Deep-Vectorization-of-Technical-Drawings)：清理、图元、优化、合并分层。仓库已归档、README要求Linux且MPL-2.0，不直接复制其网络或引入完整训练环境，仅借鉴图元证据与语义分离。
- [RapidOCR官方安装/使用](https://rapidai.github.io/RapidOCRDocs/main/en/install_usage/rapidocr/install/)：本机ONNX文字提案，带位置和分数。置信度不是验收。运行时不上传原图，不凭研究摘要承诺模型正确。
- [Anthropic长任务Harness](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)及[官方quickstart](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding)：用持久任务清单和可验证进展跨回合交接；压缩上下文本身不保证完成。保留DSH/Cordis，不改换框架、不复制上游Prompt/代码。
- [Autodesk Coordinates](https://help.autodesk.com/cloudhelp/2022/ENU/AutoCAD-ActiveX-Reference/files/GUID-11CAC0D6-DFCF-4653-8403-CF5AFD689773.htm)与[ScaleFactor](https://help.autodesk.com/cloudhelp/2026/DEU/AutoCAD-ActiveX-Reference/files/GUID-1192309B-E37B-438D-B6C3-6443D858FC2A.htm)：多段线是OCS坐标，不可把bbox当顶点；新建文字按原生bbox拟合，不能靠VLM反复猜移动距离。

以下是结合源码的工程判断，不是论文宣称已解决Cader：原实现每次重问整块源图，partial稿最多12条且始终partial，没有以稳定源对象为单位补齐剩余项的队列；原生几何与源语义混合也会让清晰线条因未知用途而停滞。因此需要源证据索引、独占对象账本和缺口驱动调度。

## 本轮实现方向与边界

1. 可选vision依赖放现有cader-mcp/uv锁；固定本地只读helper建立OCR/骨架路径候选，保持原始像素、来源hash、稳定对象ID与重叠识别冲突。不会执行CAD、不会自称完整或语义通过。未安装时保留旧流程，生产启动不自动安装。
2. 主Agent通过工作清单分页选ID；程序编译坐标和已核实字面值，复用原cader_apply_cad_patch整批预检/预算/权限/串行native/异常处理，不新增AgentLoop。ID调用需要独立源图复核，确认/unknown项不能重放，原生失败前缀精确记账。
3. 每批真实native顶点/文字/bbox和视觉验证；已确认事实持久缓存。全局覆盖与拓扑/视觉仍独立必验，OCR分数、像素覆盖率、工具次数、文件有效均不能各自代替完整验收。
4. 协同MCP仅补必要可选创建参数和原生几何读回：polyline顶点/宽度/闭合、文字原生尺度/bbox拟合、多段线native ACK。保持旧调用默认指纹与参数兼容、unknown不重试，其他用户web/脚本不修改。

## 当前证据（进行中）

原始大图只读本地提案：3426路径、298文字，19项低分、29项重叠识别冲突。不是CAD结果或验收通过。首轮用本地RapidOCR及骨架图得到，后续版本的性能、边界过滤和宽度证据另记。实际选型按uv锁记录（RapidOCR3.10/ONNXRuntime1.32/OpenCV5.1/scikit-image0.26），源码/许可证和模型包来自相应发行包，不提交权重。

实际失败也保留：第一次新增MCP可选参数让legacy默认参数多出字段、schema基线变化，初测3失败/304通过/34跳过；已调整仅显式值传参，尚待最终复验。TypeScript初次helper事件类型不符已修，后续typecheck通过；不把中间错误抹掉。

当前实现与回归仍进行中；单元、Harness、Python和真实原始图结果待实际完成补记。

## 2026-11-28真实开发回归与补修

首个新链路真实运行基线Cader `cc68325` / MCP `7ee4596`：首批32源对象的native与视觉通过。后续却暴露碎片组不完整、源语义/可见性混淆、主模型重复接收长native回执和全图读回过慢。没有以该部分通过宣称完整成功。在source-only阶段暂停自有驱动，核查无待回执CAD写入，154确认/0未知；独立核对151实体与确认账本一致，另存31040字节待验稿，旧77项和原质量文件保持不动。原始停止/保存回执位于私有运行目录，未清理unknown或接管旧图。

补修不只改Prompt：

- 将真实相连、近同宽笔画组织成连续原生路径，分支允许沿原边回走，不跨空白造边；保留源边溯源。原图从4586候选降为2025（1817路径＋208文字），85字形/排版组最多29路径；每组完整进入同一验证批次。独立像素检查只证明中心线来自原图，线宽包络误差另记，不能代替CAD渲染、整体残差或语义。文字仍由实际源图视觉读取并有界高清复核。
- `source_id → entity_ids → attached-source-crop`显式绑定，源坐标仅为当前参考裁片0..1。批次通过需源hash、文档、必要checklist与视觉前后native状态一致；增加图面路径连接图对比，不声称工程网表已恢复。实际中心线检查1817/1817支持；提案残差无显著缺口仅是源预检，非CAD验收。
- ID入口仅回传权威进度与操作ID，不把每条完整回执再次塞进主模型上下文；详细操作和原生/视觉证据仍保留。实际DSH测试验证长回执未回灌、预算续轮重新编译ID、确认/unknown不重放。持久化或provider失败在执行前阻断后续写入。
- 协同MCP只读性能：使用原生集合Count/Item和只读DISPID调用，成员编号缓存绑定同一canonical IUnknown及文档，属性值每次重新读。相同ObjectID或文件名不能复用另一个对象缓存。151实体同图对照：旧查询17.430秒，首次3.496秒、后续1.689秒，所有字段0差异、0CAD写入。依据[Microsoft IDispatch保证](https://learn.microsoft.com/en-us/windows/win32/api/oaidl/nf-oaidl-idispatch-getidsofnames)仅采用单对象生命周期内成员编号，不依赖跨对象或旧pywin32类型图；真实AutoCAD的ITypeInfo.GetIDsOfNames返回未实现，因此未采用那条路径。

本轮离线365项TS、16项Python及MCP316通过/34真实CAD未启用跳过，DSH组件smoke通过。新的完整原始图联合回归另记；没有把模拟、提案或局部文件有效当作完整通过。

### 分层验收补修（真实attempt05反例）

实际原生图遗漏小数点；不是视觉模型单纯误报。源骨架曾过滤孤立点和短边，已改为保留原始正长度边及本机可追溯小标记。低置信OCR不强行转TEXT，保留原生可编辑字形；不将识别分数当语义事实。

SAHI启发的是重叠观察与统一坐标，不是每裁片都要求提前包含完整图。Harness批次只验已提交图元，区域checkpoint仍为partial_verified。所有源ID存在后，程序逐一触发原图/原生同窗高清完整复核，绑定source hash、document、snapshot及同一像素窗口；随后仍要全图覆盖、残差、图面连接和最终视觉。不以primitive pass或OCR完备性证明整图完成。真实attempt05安全停于221确认/0未知，214实体另存并保留旧失败，下一轮原图回归结果另记。

### 真实源复核与图面证据分歧的进一步约束

attempt06又暴露两个可复现的工程问题：连续空格差异被当作数值冲突，且高清纠正必须服从旧宽图读数；宽图中个别细线未被辨认而进入修正流程；未记录移动或移动请求，不能将该风险描述为已经发生。修复采取目标紧裁片两次独立读取的一致性（保留旧矛盾，不折叠大小写/单位/小数点），以及最多8组实际原生高清补拍、同源/同图/同状态逐目标证据覆盖。没有合成新的视觉pass报告，只保留实际初次和补拍报告并由Harness校验必要检查覆盖。正确native几何禁止为缩略图疑问而移动；完整区域及全图仍要独立通过。

### 原始大图后续实证与最终实施边界

attempt07保留175确认/0未知、171原生实体及待验DWG。真实单标注探针在0CAD条件下将原不确定两项均读清；源worker不再承担整图位置判断。Skill整体混入是可能影响因素，未单因素消融，不能把所有原因归咎Prompt。真实记录的动态上下文投影76750→8038字节（-89.53%），完整证据仍保留。诊断/源scope改为bbox、顶点数和精确hash引用，独立原生Verifier仍逐点检查原始坐标/宽度/闭合/OCS。

跨页字形不再交给模型手工拼接：模型选择源ID，Harness按实际Patch容量填同组pending/accepted，并把大组余量留在待办。每批是primitive进度，不是完整组或图纸通过；全部源ID之后的高清窗口、图面连接/残差、全图及文件门禁保持必需。对于OCR框切过实际连通笔画的二维排版，保留原生字形路径，避免线性TEXT擦掉分隔线。新提取器原图3502路径/118文字、最大组197；全部源支持、0缺像素的结果仍只是候选预检。

紧接实际读回的检查点可复用同一个内部snapshot引用，但必须未frozen、写入mark/连接/原生目标未变，且文档匹配；复制对象或状态变化触发新读回。日志保留原observed_at和reused标记，不把缓存称为原生revision保证。完整区域评审后，全图拿到这些真实局部报告的hash和当前原生检查结果，整合可用证据，不依赖低清全图重新猜每个小字。

379项离线测试、Python21及Ruff、DSH组件smoke通过；下一轮实际生产InteractiveSession＋真实模型＋AutoCAD完整原图结果另记，尚未声明整体验收。

BUG113实证补修：attempt08原始Native正常推进，安全停于591确认/0未知，582实体与账本一致、143718字节待验稿另存，旧93项hash不变，扩展97项保护基线；没有重放或清除旧屏障。批次原图比较仍导致未绘内容误判。对同一组实际AutoCAD留存PNG及其匹配原生快照，新的独立真实Vision按CAD-render-only合同64/64可见性pass，0新CAD调用、quality=false；不把留存图重评审当新CAD执行或当前任务完成。

源CV支持/文字字面读取、Native精确坐标和批次实际CAD渲染分工明确；仅在前两者真实通过后，程序构建带source/index/native hash的只渲染scope。批次worker不装配整图规划Skill、不看尚未绘制的完整原图；所有源图元完成后，必须对原始完整参考逐窗高清比较，再做整图/文件验收。无原图的primitive报告不能满足完整保真条件。380项TS/typecheck/组件smoke通过，下一轮原图真实完整回归另记。


### 直接写工具的整图回执膨胀（BUG114）

attempt09在真实绘图中又证实一处独立缺口：源批次父结果虽已精简，直接create_layer仍返回整图observed，两个图层调用把同一主模型上下文推至372672 totalTokens；后续缓存输入也真实计入任务总量。对同一748实体实际留存回执进行DSH组件对照，消息473987→47316字符（-90.02%）。这不是新CAD或真实API测试，原始完整回执和原失败保留。程序仅精简索引写工具的模型投影，保留操作提交状态/文档/实体及观察hash；完整原生数据仍被审计和独立验证，读取工具不改变。381离线测试/typecheck/DSH组件smoke通过。attempt09安全停于885确认/0未知，874实体新待验稿198884字节；旧97项未变，保护基线103。下一轮仍需实际完成所有源窗口、整图和DWG，不以模型上下文缩小代替验收。


### 有界只读观察与Native前后快照（BUG115）

attempt10仍花费大量时间反复查询未改变的整图：每次高清补拍后一次全读，完整窗口各两次全读。这里没有Main写入，只有受控原生截图/恢复与只读Vision。现在将最多8组三目标补拍放在同一Native前后快照范围；完整原图窗口每组最多8个，逐个观察且保留各自source/window/document/image绑定，末次新鲜Native全读一致后才能逐区域晋级。观察中任意本地操作清单长度、连接、目标或frozen改变立即拒绝；未取得after hash时只能决定下一次补拍，complete恒false。Native改变、取消或读回失败不放行；保留COM无权威revision的限制。没有跳过原图、Native或视觉检查。

393 TS/typecheck/DSH组件smoke通过：17窗口fixture的全读34→6，7目标3补拍5→2；非真实整图性能数据。attempt10安全停于557确认/0未知，547实体139527字节待验稿另存，旧103份hash全同、保护清单109。下一轮完整原图真实模型＋AutoCAD另记，不能以快照批处理或组件通过宣称完成。


### 局部原生观察与完整检查点（BUG116）

从实际审计而非猜测确认，图层写入ACK后的身份检查/全图读回/审计阶段，182实体约2.3秒，748实体约26–28秒；不是单独query的微基准。于是保留原有get_entity和Checkpoint，批次先后读取确切ID，局部数据不能更新全图缓存；全图检查点仍独立查询并核验全部此前和本批已确认源项，拒绝多余实体。区域primitive结束及紧邻预算交接可在5秒内复用原全图对象/原observed_at，必须仍同连接/原生目标/操作长度且未frozen，过期或局部scope重新全读；完整窗口/最终门禁不因此豁免。Source Main实际获得list_layers，对名字已存在且无改色要求的请求，程序实时查询后明确不派发创建；显式color仍沿原执行和验证链路。

398 TS/typecheck/DSH组件smoke通过，覆盖局部与全图scope隔离、ID错配、历史项变化和checkpoint失败。attempt11在无待回执写入的只读边界停下，397确认/0未知，390实体与账本一致另存104692字节待验稿，旧109项hash未变，基线115。完整新版真实模型和AutoCAD原图结果另记，未把partial或查询次数变化算作完成。


### 原始回归暴露的图层列表与复验边界（BUG117）

attempt12的两次源图层创建均ACK，但首个绘图依赖查询未列出几何层，派发前拒绝一次，0未知；实际原生实体随后均位于正确的CADER_SOURCE_GEOMETRY/TEXT，不把它猜成错误文档。MCP协同619696d将Layers动态枚举改为每次新鲜Count/Item及Name的权威DISPID；离线反例禁止缓存枚举器/值。真实owned新空文档创建两层后连续10次新路均准确，同次旧路也正确，未复现原间歇失败，原因仍须完整新运行确认。317 Python通过/34 CAD未启用跳过；Cader398/typecheck/smoke与373e2bb双CI通过。原始218实体待验稿及失败保留，原115项hash不变，含组件后保护123份。新的完整联合模型＋AutoCAD结果另记，不以空文档组件替代原图任务。

极小图元的过度放大也会丢失可判断上下文。原图attempt13真实Native黑窗与同实体宽窗独立Vision对照已确认；保留原始像素尺度与线宽边距，不改正确几何、不省完整源图比较。见 [BUG118实际证据与限制](2026-11-28-tiny-source-framing.md)。
