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
