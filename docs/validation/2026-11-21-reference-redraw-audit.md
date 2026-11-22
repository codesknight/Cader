# 手稿重绘日志审计：文件存在但没有源图输入

日期2026-11-21；来源为用户18:00–18:12 CLI日志及“希望从手稿新建画布并输出DWG，为什么迟迟不画”。关联REQ-033、BUG-029/030、[#20](https://github.com/codesknight/Cader/issues/20)。本轮审计，不将已有基础绘图验证等同图片重绘验收。

## 已证实

1. 用户已切full-access，图纸连接正常、frozen=false；重绘阶段写入为0。此案不是旧锁、审批或模型QUOTA造成，不能再以解除屏障解释。
2. 从首次指定手稿到最后请求的verification均imageProvided=false，已授权参考元数据为空。文件后来已复制到工作区，但没有调用/open或使用@引用；interactive.converse只注册@匹配及既有/open引用，不自动识别普通路径文本。复制文件不触发注册，Agent也没有读取本地图片并登记为图像附件的工具。
3. cader_read_file是文本工具，不会把JPG转为模型视觉输入。delegate把文件名当image_ref，实际返回IMAGE_REFERENCE_DENIED；合法image_ref必须来自Available注册表。普通命令行不提供模型臆造的“拖入后出现缩略图”上传界面，日志建议不符合本CLI。
4. “新建一个图层，帮我复现这张图”未命中requiresQuality；“绘制”命中。先前多轮走普通聊天/文件/Shell路径，没有建立持续的参考图重绘任务，反复让用户选项/口述。收到新路径却继续解释旧选项的模型回复证明上下文理解失真，但没有证据证明CLI把用户路径改写成数字。
5. 最后一轮进入quality，源图仍未注册；模型未新建/绘制，调度器仍对既有房子/树工作图做几何/视觉检查。图像评审有效不代表评审了用户手稿，源图与待验收图没有被强制绑定。该轮无save_drawing，未产出请求的DWG。
6. 规划阶段调用act时仅传onlyTools/extraTools/resultText，没有传options.request中的image/history；即使用户正确注册源图，当前规划步骤也没有显式收到源图附件。绘制步骤才传options.request，形成证据先后次序缺口。
7. 已注册的cad-redraw-review Skill仍含Image plans remain execution-blocked，catalog描述planning only/no DWG generation。源码exec --intent redraw还无条件drawingBlocked。这些是M0遗留限制；日志确实加载过该Skill，但不能证明这一句是每次拒绝的唯一原因，也不能把exec专属阻断直接当作本次chat路径的触发点。

## 图像判断的证据边界

直接人工查看用户工作区原始JPG，可识别基本电路符号、连线和元件标注。日志仅凭灰度阈值、Hough长线/圆统计推断没有工程图骨架、不能重绘，没有充分依据；未安装OCR也不意味着视觉模型无法判读。用户要求示意图重绘时，缺少物理比例不能成为全局拒绝理由；真实尺寸及不可读标注仍不得猜测。

原图和具体图面内容仅保留用户私有目录，不复制入本公开报告。此次未新调用付费模型、未操作或保存CAD。

## 无模型、无CAD的应用装配复现

私有脚本`.cader/probe-redraw-image-input.mjs`复制不含local配置的测试环境，任务runner在接收参数后立即抛哨兵中止，不伪造模型或CAD结果：

- 普通路径文本：image_present=false、has_registered_reference=false。
- 同一文件/open reference.jpg后：image_present=true、has_registered_reference=true。
- 原“帮我复现这张图”短语：quality路由false；“绘制”短语true。

记录`.cader/runs/image-input-audit-NK2FWS/verification.json`；paid_model_calls=0、cad_calls=0。这只证明输入装配，不证明/open后完整重绘成功。

## 当前可用入口和应修复的闭环

当前可用入口是把工作区内文件用/open或@显式注册。已确定CLI装配可传入图像，但不能据此保证现版规划、绘制、保存及对照验收全部通过。

需要按优先级修复：显式路径作为授权参考导入并注册图像、提供Agent图像读取工具；参考图先进入规划，持续保存原任务/新图意图/DWG产物目标；新任务不得拿旧图当结果；确认本任务发生新图/绘图后才校验，视觉应对照源图与输出图；重绘结果经过保存/文件验证才算DWG交付；将旧只读review Skill与可执行重绘流程分清。保留权限/文档绑定/未知写入保护，不能以放开所有文件或去掉验收替代这些修复。

本轮未实现上述运行时修复，图片到DWG的真实模型闭环未验收；#20及Milestone继续打开。
