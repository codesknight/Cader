# AutoCAD Redraw Skills 调研与 Cader 接入分析

日期：2026-11-19。先完成此分析，再按 ADR 0004 实施代码。

## 来源与审查范围

仓库：[pengxiaoan/autocad-dwg-redraw-skill](https://github.com/pengxiaoan/autocad-dwg-redraw-skill)。
固定 commit：`ed182ec5966caaaf1d82d6ad4015435a27a8a909`。
审查该版本完整文件清单（21 文件）、两份 Skill 指引、引用资料和 10 个 Python 脚本的静态结构，
重点核对 COM 操作、输出、重试、验证判定与依赖。原始研究快照位于被忽略的 .cader/research/redraw-skill/；
没有安装或执行第三方脚本，没有连接模型或 CAD。

GitHub metadata 的 license 为 null，递归文件清单中没有 LICENSE/COPYING 文件。
这次检查只记录许可声明缺失这一事实，不推定公开可见就允许再分发。
Cader 本轮不复制其 Skill、模板、JSON 示例或脚本，也不将上游项目标成 MIT。

## 工作流价值

| 路径 | 有价值的设计 | 对 Cader 的意义 |
|---|---|---|
| DWG 输入 | 先统计实际图元及空间，再以源文档作对照 | CAD Understanding 应先取得结构证据，不能只依赖截图 |
| PDF 输入 | 区分矢量、栅格与文本来源，保留中间转换的来源 | 不把转换结果称作未取得的原始 DWG 的精确副本 |
| 图片输入 | 先评估质量与尺度，再形成几何说明和验收条件 | 建立单独的证据/单位/不确定性记录，避免猜尺寸 |
| 交付验证 | 结构检查与配准后的视觉比较分开 | 视觉像素接近不能证明物理尺寸或保存状态正确 |

来源：[DWG 工作流](https://github.com/pengxiaoan/autocad-dwg-redraw-skill/blob/ed182ec5966caaaf1d82d6ad4015435a27a8a909/skills/autocad-dwg-redraw/SKILL.md)、
[图片工作流](https://github.com/pengxiaoan/autocad-dwg-redraw-skill/blob/ed182ec5966caaaf1d82d6ad4015435a27a8a909/skills/autocad-image-redraw/SKILL.md)。
以上是对工作方式的分析，不是移植其说明文字或接口的授权。

## 脚本审查结果

| 组件 | 观察 | 接入判断 |
|---|---|---|
| dwg_prompt_builder / dwg_redraw | win32com / pythoncom；访问文档集合；复制空间对象并另存；可调用 taskkill /F 重启 AutoCAD | 不直接挂到主/子 Agent；绕开 MCP 文档身份与授权 |
| draw_image_spec | 解释图元说明、创建层/文字/尺寸等；直接 COM 新建、修改、SaveAs；overwrite 分支可删除已有输出 | 重绘执行要重写为受控 MCP 操作；不能作为当前只读 Skill 的附带命令 |
| inspect_dwg_output | 可以启动/打开 DWG 并改变活动文档，主要统计 ModelSpace 类型/图层/单位 | 标称检查也有会话副作用，需明确目标和后端能力 |
| preflight / spec validator | 输入质量和语义门槛，与绘制分离 | 适合未来独立的确定性工具；当前不直接采用代码 |
| compare_redraw | OpenCV 以锚点计算配准，再生成边缘距离与覆盖率等指标 | 可作为视觉 verifier 的方向，不能代替真实尺度校验 |
| DXF preview / raster-to-DXF / PDF-to-DXF | ezdxf、OpenCV、PyMuPDF 等，部分路径可再经 COM 转 DWG | 应隔离为按需工具依赖；不加入基础 Agent 运行时 |

上游也有值得保留的防护：DWG 脚本为已有输出选择新文件名，图片绘制提供 dry-run，
覆盖已有 DWG 需要显式 overwrite。这些降低了部分操作风险，但不等于 Cader 的实例/文档绑定和未知结果对账。

审查中还发现三项不能忽略的局限：

- DWG 重建的脚本验收主要比较图元数量和类型分布。数量相同不能证明坐标、属性、块关系和布局等价。
- 图片 validator 的 finite 函数没有遍历 dict，而调用点传入图元 dict；不能把它当成完整有限数值校验。
- compare_redraw 的报告状态在成功执行计算后直接设为 pass，并未以指标门槛判定重绘合格。

这是固定版本的静态代码分析，未对作者项目执行复现测试；不外推为所有版本的缺陷结论。
来源：[重建脚本](https://github.com/pengxiaoan/autocad-dwg-redraw-skill/blob/ed182ec5966caaaf1d82d6ad4015435a27a8a909/skills/autocad-dwg-redraw/scripts/dwg_redraw.py)、
[说明校验脚本](https://github.com/pengxiaoan/autocad-dwg-redraw-skill/blob/ed182ec5966caaaf1d82d6ad4015435a27a8a909/skills/autocad-image-redraw/scripts/validate_image_redraw_spec.py)、
[视觉比较脚本](https://github.com/pengxiaoan/autocad-dwg-redraw-skill/blob/ed182ec5966caaaf1d82d6ad4015435a27a8a909/skills/autocad-image-redraw/scripts/compare_redraw.py)。

## 与当前 Cader 的适配差距

Cader 的能力边界是 DSH → 经审查的工具 → MCP；Skill 是按需上下文，不是执行权限。
当前只支持受限的两个 CAD 只读工具，不能取得完整 DWG、PDF 内部结构，也不能执行重建/保存。
子 Agent 只提供限定任务结果，不能调度脚本、互相调用或批准写入。
上游的 Codex 调用方式、agents/openai.yaml 和 scripts 路径不是 DSH 插件或 MCP schema。

因此三种接入方式中：

| 方案 | 判断 |
|---|---|
| 原样安装到 Codex / 复制到 configs/skills | 不选择：不是项目 DSH 集成，许可未明且直接执行模型不受控 |
| 给 Agent 加 shell 调用上游 COM 脚本 | 不选择：绕过只读、身份、revision、request_id 与对账边界 |
| 分层接入工作方法、Skill 目录、确定性验证及受控 MCP 执行 | 选择：可渐进验收，继续复用 DSH 与现有 MCP |

## 本轮实施与后续

1. 本轮独立编写 Cader 的 cad-redraw-review，只作参考证据审查、缺口识别和验收计划。
2. 新建显式 Skill 清单；CLI 和 DSH 共用角色/资源注册与加载，未注册的文件不自动获得能力。
3. readonly exec 支持受限 PNG 输入；模型可按需读 Skill 和引用资料，返回评估，不能声称已生成 DWG。
4. 后续在 Cader 自有 schema 中实现确定性单位/尺度/有限数值及约束验证，并纳入 #4 的独立评测。
5. 绘制、保存与输出检查继续按 #3 的工作图、instance/document/revision 授权、未知结果对账契约推进。
6. 如上游明确再分发许可，再决定是否单独引入经过审查、固定版本的纯工具；仍不开放任意脚本执行。

本轮不是上游两个 Skill 的安装包或全部功能移植。实际集成的是 Cader 自有评估工作流与
可扩展加载机制；DWG 解析、PDF/DXF 转换、图元复制、几何说明执行与视觉指标计算均未宣称完成。
