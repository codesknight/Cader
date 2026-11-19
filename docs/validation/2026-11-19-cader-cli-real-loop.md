# Cader CLI 独立实机闭环验收

日期：2026-11-19。关联[#15](https://github.com/codesknight/Cader/issues/15)、
[#3](https://github.com/codesknight/Cader/issues/3)、[#14](https://github.com/codesknight/Cader/issues/14)。
用户在MCP完成profile验收后明确授权Cader执行真实闭环。**本轮Cader原生CLI固定几何计划通过。**
机读脱敏结果见[验收JSON](2026-11-19-cader-cli-real-loop.json)。

## 结果

| 检查 | 实际结果 |
|---|---|
| Cader CLI | 单次cad-test，exit 0；run_status/task_status=succeeded，verification=passed |
| 工作图 | 新建、managed=true/read_only=false，原子绘制直线/圆/文字，实际查询与计划匹配 |
| 保存 | 独立新DWG，31988字节；另行读取磁盘核对大小及SHA-256 |
| 重开 | 不同document_id，managed=false/read_only=true，绑定同一artifact_id |
| 独立复查 | 新Python MCP进程/DSH客户端发现七工具，再读源图及重开图；各3实体，参数/文字/图层一致，无unsupported类型 |
| 审计 | 4个变更请求均先有prepared及精确JSON/hash，再有confirmed；CLI共8项动作，无写入重放 |
| 保护 | 128个tracked文件在实测前后摘要相同；16份用户输入摘要相同，2份原DWG未打开 |
| 清理 | 仅关闭归属已核实的3张测试图，正常Quit专用实例；无剩余acad进程、无写锁，DWG保留 |

运行ID：`managed-797c993f-798b-4bca-8df6-00f479854f54`。
产物在本地`.cader/artifacts/cader-owned-6705ffff93de484bacdfac9887de1071.dwg`，不提交二进制。
SHA-256：`6eb9da7e128b2199ca2d5fc270fce09fad1a028371b46495c76d444048c81cba`。

源图`434fcdd9ae164cf5abe47e03e50ce829`：初始revision=0，批处理后16，文件操作后另查为25。
重开图`0cfec2a145ff4c1db6e8dc1906178b39`：revision=0。后续独立复查按各自权威revision读取，
逐项比较几何、文字和图层，而非只数实体或采信模型正文。

## 固定版本

- 实测Cader：`266c6895048f1ce97a5517265a7f14f29bfa5e1c`；执行前重新pnpm build，运行中代码/策略未改。
- MCP：`2fa994852bba0b1a479f9fa7304ccc3026777426`，入口`autocad_mcp.managed_server`，Python3.11.15、MCP SDK1.28.1。
- Node24.9.0，DSH0.2.2-rc.4，Cordis4.1.0。链路为原生CLI→DSH MCP客户端→stdio专用profile→HTTP Bridge→AutoCAD。
- AutoCAD2026二进制FileVersion为R25.1.60.0.0；专用成功实例PID13372。
- 安装并明确NETLOAD的Bridge DLL SHA-256：`dd8321e2aae125354e9cdaa4170873332539c849ff47b1acf45ba239d284a642`，测试前后文件一致。
- 公共契约修订2 / mapping revision1，schema SHA-256：`e239266ee97ccd64284f6a6b5896eb57532b0f18eb5769dad3899e614191dd28`。
  已比较本机Cader编译CLI、源schema与MCP内嵌快照一致。

本轮未调用模型；recognition=not_performed。规划采用已审查fixture，不能据此声明“真实模型自动完成CAD任务”。
共享schema/manifest仍原样保留unfrozen元数据；MCP已确认实施基线并实现profile，这不等于联合发布已冻结。

## 实际命令与复现

```powershell
pnpm build
node apps/cli/dist/index.js cad-test --backend http --mcp .cader/runs/cader-real-20261119-200458-80d373db/managed-profile.local.json --plan benchmark/fixtures/managed-geometry.plan.json --output .cader/artifacts/cader-owned-6705ffff93de484bacdfac9887de1071.dwg --authorize-write
```

上面是实际运行参数，输出已存在，**不要原样重跑覆盖**。复现时复制
[managed示例](../../configs/mcp/AutoCAD.managed.example.yaml)为本机profile，设置独立HTTP配置、同一Bridge令牌，
安装选定MCP版本并先启动Bridge；使用新的输出文件名。普通COM配置和模型.env未修改。
私有profile只引用进程环境变量名，不写token。完整执行、请求、页结果与清理记录在本地
`.cader/runs/cader-real-20261119-200458-80d373db/`及CLI自身run目录。

## 失败与恢复记录

1. 首次隐藏启动PID66744未暴露可用窗口/Bridge；归属及启动时间确认后关闭，未派发Cader写请求。
   普通启动专用实例13372后，界面工具出现激活失败/错误截图；停止UI输入，使用attach-only应用API核实
   PID及零文档，再建立启动空图、NETLOAD已安装DLL并启动Bridge。未更改SECURELOAD或处理安全确认。
   启动延迟根因未确认，不归因为MCP受控接口故障。
2. ROT最初返回旧启动PID；身份保护拒绝初始化。旧归属进程退出后才初始化正确实例，没有向错误目标发绘图请求。
3. CLI已通过后，额外源图读取仍用revision16，得到REVISION_CONFLICT；重新读取权威状态revision25后，
   只重做读取并通过。不能假定文件操作后仍是批处理revision；本次未逐事件归因这9步增量，
   也不能用这次只读冲突重放写入。
4. 本地收尾辅助脚本初次缺少可选psutil、误读原生status信封，均在关闭前停止；改用已有进程查询和正确result字段。
   关闭第一张图后立即观察又遇到RPC_E_CALL_REJECTED；重新观察实际剩余文档，再关闭其余已归属图纸并正常退出。
   没有重画、重存或强杀成功实例；失败启动实例的终止与成功实例的正常Quit分别记录。

## 图片与剩余门槛

当前tests/images为14张PNG/JPEG和2份DWG。14张输入范围、格式及像素上限检查通过；全部16文件未变。
原图、原始图名/哈希和附件不公开。本轮没有付费图片识别、图片到CAD编译或电路拓扑还原测试。
image-redraw计划继续受独立审查门槛阻塞，BUG-010的真实识别问题不能因此标为修复。

本次通过范围是固定line/circle/text真实文件闭环，不覆盖任意用户计划、长期稳定性、视觉相似度、
真实响应丢失故障注入或完整DSH模型app profile。#3的模型驱动和故障实测、#14的图片重绘条件保持开放。
