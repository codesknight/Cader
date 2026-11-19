# 读图审计、结构化事实与回归门槛

来源：2026-11-19联合测试的门类型、文字、电压与拓扑误识别；跟踪
[#15](https://github.com/codesknight/Cader/issues/15)和[#14](https://github.com/codesknight/Cader/issues/14)。
本轮实现审计与确定性校验，尚未证明真实模型已修复识别错误。

## 图像证据链

复用DSH附件服务和同版本Sharp解码PNG/JPEG，保留原图；记录EXIF orientation，不自动改变方向。
先在**原图像素坐标**裁剪，再显式顺时针旋转0/90/180/270度。

```powershell
pnpm run cader exec "查看局部小字，逐条标出未知信息" --skill cad-redraw-review --image tests/images/example.jpg --crop 100,200,800,600 --rotate 90
```

example.jpg为占位路径，需替换。运行中视觉角色可调用
cader_view_image(image_ref,left,top,width,height,rotation)访问已授权原图区域。
文本子Agent无此工具，视觉子Agent仅能访问委派图像。局部查看回到原始分辨率，
不声称插值能恢复不可读内容，仍受原有文件/像素上限约束。

| 私有events.jsonl事件 | 证据 |
|---|---|
| image.attached | 原图、视图、规范化附件的SHA-256、尺寸和格式；EXIF、crop、rotation及映射 |
| image.request | 实际请求图片变体的SHA-256、尺寸、格式、target和source_mappings |
| skill.loaded | Skill名、资源ID、角色、装载方式及内容哈希 |
| prompt.assembled | 提示词摘要哈希、角色、工具名，不保存整段提示词 |

view_to_source、attachment_to_source、request_to_source是2×3仿射矩阵`[a,b,c,d,e,f]`：
source_x=a*x+b*y+c，source_y=d*x+e*y+f。使用左上原点的连续像素边界坐标，像素中心为x+0.5/y+0.5。
映射组合裁剪、旋转及附件/请求缩放。相同像素可能去重成一个附件，request记录全部来源映射。
哈希只证明内容身份和转换，不证明模型理解正确。

## 事实与抽象连通图

公共[schema](../../configs/contracts/cader-v1.schemas.json)的assessment和independent_facts
定义识别结果和独立期望。assessment-check --assessment <json> --expect <json>不调用模型/CAD；
输入为JSON文件，Markdown或fenced JSON不构成正式契约。

assessment包含source_sha256、坐标模式、regions、facts、symbols/ports、nodes、wires、crossings。
事实关联原图区域，保存raw与规范值；unknown必须value=null，unknown/conflict阻止验收。
符号、标签、电压、图号、crossing均与独立期望比较。110kV→1100、OR→XOR、漏标签、猜图号和
跨线误接，已有固定合成回归。wire连接节点，junction合并，bridge不合并；
独立connected/disconnected端口对验证应连/不应连关系，不由生成模型自评分。

该检查不是DWG实体到电路图提取器，也不证明未列出的全部连通关系。
独立期望由用户或单独维护的ground truth提供，不能复制本次模型输出。
原图哈希与尺寸由调用方取得，命令不自行读取原图或判定ROI语义。
示意图可使用layout单位，不因缺真实比例尺一律阻塞规划，也不能宣称恢复物理尺寸。
physical模式要求已观察且独立确认的尺度事实；几何计划另须匹配单位的scale_evidence。

## 执行边界

调度器当前拒绝全部image-redraw计划；assessment-check通过不会授予写权限。
仍需完成图像事实→可审核几何计划、独立审查绑定、真实CAD符号/拓扑提取和重开验收。
先让已审查固定几何走完整程序流程，再扩大图片任务。
原图、附件、原始报告只保留.cader/与tests/images/，不进入Git或CI。
