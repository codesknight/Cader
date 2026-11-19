# 本地图片资料首轮测试：2026-11-19

来源：用户提供 tests/images，授权进行绘图能力测试；跟踪 [#14](https://github.com/codesknight/Cader/issues/14)。
原图、DWG、图中内容、输入路径清单和原始模型输出只保存在本地，不上传公共仓库。

## 实际执行结果

| 层级 | 实际结果 | 不能据此推断 |
|---|---|---|
| 资料盘点 | 4 PNG、10 JPG、2 DWG；共16个文件记录 SHA-256，测试后哈希全部不变 | 没有打开/解析两个 DWG，不推定它们与某张图片配对 |
| 图片输入 | 14/14 PNG/JPEG 的边界、大小、格式头与像素上限检查通过 | 不是几何或图像质量验收，也不是 DWG 生成 |
| 真实模型识别 | 独立人工期望先于请求写入本地；代表性手绘 JPG 与旋转 CAD 导出 PNG 共2/2通过 | 只对这两张、这一轮的指定可观察信息负责；不是14张全测或通用成功率 |
| MCP 发现 | 本机 AutoCAD-MCP HEAD 841d120，40 工具；get_backend_status 成功 | 不代表每个写工具可在 Cader 中使用 |
| 实际 CAD 写入 | 未执行；当前 MCP 为 COM，atomic_batch=false / query_pagination=false，无当前受控文档/revision契约 | 不是 MCP 故障，也没有图像到 DWG 的通过结论 |

模型测试使用 Cader 已配置 MainAgent / deepseek-flash，经真实 DSH 和官方附件服务，
没有让模型读取期望文件，没有委派/调用 CAD，未切换配置或增加写工具。
用户资料中的照片/导出图是电子/电气示意图；本轮不把图中电气数值当作几何长度或物理尺度。

## 私有证据

- .cader/image-tests/inventory.json：原文件路径、类型/尺寸、哈希和 DWG 未解析状态。
- .cader/image-tests/preflight.local.json：14张输入预检 manifest。
- .cader/image-tests/live.local.json：独立准备的两项识别任务与期望，仅本地。
- .cader/runs/image-cases-50ce4229-efe0-4cab-a571-33eed4bdf6f2：14项输入预检。
- .cader/runs/image-cases-15e6af0b-cf1b-43af-99ce-8b52871c9550：两项真实模型验证，含各自 exec 子运行目录。
- .cader/runs/image-corpus-probe：实际后端状态和工具 schema。

最初真实运行发生在 runner 增加 manifest 哈希/自动期望快照之前；当时的独立期望已保存在
先行准备的 live.local.json，不把后续记录增强写成当时已存在的文件，也不为此重复付费调用。

## 兼容性修改与下一步

原 exec 只接收 PNG，本轮增加有界 JPEG 帧头识别和 image/jpeg 附件，保留现有 PNG 接口。
不自动转换、旋转或修改原始文件，也不新增图像处理依赖。已用真实 JPG 请求验证 MIME 链路。
新增 image-test 入口和离线回归，区分输入、识别与绘图状态。

下一步由 [CAD闭环 #3](https://github.com/codesknight/Cader/issues/3) 补齐/接入受控写入：
新工作图身份、实例/revision/授权、请求对账、保存和重开独立验证；之后才运行完整绘图样本。
当前 COM 会话的 not_started 是本次 MCP 后端实例状态，不据此判断桌面 AutoCAD 是否运行。
本次没有改相邻 MCP、启动/关闭 AutoCAD、修改已有图纸、创建 DWG 或自动重放写入。
