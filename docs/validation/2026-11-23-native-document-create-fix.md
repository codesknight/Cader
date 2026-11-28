# 2026-11-23：原生新建与真实质量链路修复

REQ-039 / [Cader#20](https://github.com/codesknight/Cader/issues/20)、[AutoCAD-MCP#41](https://github.com/codesknight/AutoCAD-MCP/issues/41)。用户在[Add审计](2026-11-23-new-drawing-add-audit.md)后明确要求修复，必要范围包含独立MCP。无关web/训练资料工作保持原样。

## 实施

MCP连接无文档时不再Add；新建在STA内只读取得Documents前态和Add DISPID，元数据失败做有界只读等待；实际Invoke仅一次。返回后须恰有一个新名称、既有集合保留且活动图属于新集合；失败不绑定旧图。原生preflight/native_call/binding阶段、调用/确认标志、前态、原异常类型/HRESULT/stack写入autocad-native-create/1。MCP错误保留isError=true并携带request_id；成功仍返回图名及{result:name}，旧无参调用兼容。新工具不再声明只描述成功的outputSchema；发现基线仅更新该项，其他工具保持对照。

Cader为支持request_id的新服务注入操作ID，完整schema及关联校验后才构造原生未调用异常。执行层保留transport_dispatched=true/native_dispatched=false与native_preflight；其他远端错误仍冻结。原生调用后错误不会因含Add/validation而降级。旧屏障既无新证据也无nonce，不能自动放行。

真实绘本任务还暴露了调度缺口：120秒主回合计时包含绘图和子视觉，且主动视觉后继续自修。质量主回合现受既有任务总时限控制，API请求profile超时、子视觉时限、用户取消与共享预算不变；主动视觉后交回Scheduler。未指定图元数量的插画不接受模型自定上限，generic端口可为空。截断规划仅允许一次紧凑重试，再失败则阻断，不重试QUOTA。

同图视觉格式修复覆盖MALFORMED_RESPONSE；只有当前几何/视觉/时效/引用等必要条件全过，才关联此前本任务失败视觉尝试的replacement ID，保留原失败状态与事件。不能覆盖主模型失败或未通过条件。

## 分层验证与保留失败

- 原生故障注入8例覆盖连接零创建、显式创建一次、动态解析暂时/永久失败、IDispatch路径、产生副作用后异常、绑定失败和不接管旧图。MCP内存调用验证关联错误与成功兼容。完整MCP pytest：235 passed / 33 skipped。已有uv环境对改动3个Python文件执行isolated ruff I/F通过；conda自身无ruff，未改依赖。
- Cader实际stdio适配器及确定性服务6例：原生未调用不冻结且可显式新请求；native/binding/nonce不符/implicit_creates不符/旧文本继续冻结。服务器fixture起初未回应SDK的server/discover探测，补标准method-not-found回退后通过，未绕开stdio。
- 其他回归覆盖任务/API时限分开、视觉交接、普通图自定上限、规划最多一次重试、同图格式修复及旧视觉失败替代。最终本地全量见下；远端CI以对应PR/Issue交付记录为准。
- 真实AutoCAD连续3次各仅新增1图，约812/500/813ms，绑定正确且只关闭自建图，原Drawing5保留。私有证据：.cader/native-create-live.json。

真实模型各轮均使用原始需求“新建画布，画一个房子，红屋顶蓝墙，旁边有棵大树，儿童绘本风格。”，没有固定绘图序列。

| 私有quality运行 | 实际结果 | 原因及处理 |
| --- | --- | --- |
| 354de466-fff8-470a-9d94-5ccbc11ee2bb | 47确认/0unknown，drawing超时 | 已新建；继续自修且模型自定数量上限，失败保留 |
| d40c6b07-2786-484e-9ec0-d82f15eb4a08 | 25确认/0unknown，子视觉被父计时取消 | 已新建；约108秒才启动视觉，约12秒后被取消，补任务/请求时限分离 |
| 72534c56-112a-4964-8e1f-17964009d618 | 规划OUTPUT_TRUNCATED，未绘图 | 不计原生测试，补一次紧凑重试 |
| 7315f417-035d-4f20-a1bb-137aab559316 | 50确认/0unknown，1轮修正，6项质量pass但总CLI失败 | 发现并修正树冠填充/多余图元；旧MALFORMED_RESPONSE污染汇总，补证据替代关联。不回写原矛盾结果 |

这些运行不计最终端到端成功。只关闭明确自建的Drawing6–11，用户Drawing5未关闭/保存/修改；最终轮结果见下。缺参负测/纠参记未派发，不冒充原生执行。

旧工作区drawing-20261123-2屏障保持原样，SHA256：AEE9269C8EA4379F286D115887E48948A2A962AD1680C2650D5CB246BA755447。旧请求没有可追溯原生未调用证据，不能据新代码推断未执行。修复后需退出旧CLI并在新工作区启动新任务，不接管旧图。原生revision/像素映射、任意风格画质和所有COM故障不在本轮保证范围；#20总体保持开放。

## 最终dev.9结果

最终同一自然语言实机运行：`.cader/runs/quality-560c6cbd-6967-42cf-961a-3a63749a1cec`，整体ok=true，complete，8/8条件pass，47次确认/0unknown，12次模型步骤，1轮局部修正。仅1次new_drawing确认；2次真实视觉与2张PNG，主Agent主动调用后Harness均复用对应报告。首次视觉发现屋顶/墙体错位与树冠外观问题，模型实际局部编辑后再次视觉通过。审批回调3次，属于CAD-only测试授权，不冒充人工终端按键验收。

最终截图hash：8f283b6fb6c96e70255f662c0817e112a5b21fbc7a8e8ae6041bed66098411eb，1600×1280，possible_clipping=false。独立查看实际PNG可辨红屋顶、蓝墙与旁边大树；这是CAD简化插画，不是任意绘本美术品质保证。未请求保存DWG，不冒充文件交付。测试图Drawing12已只关闭自身；最后只读观察仍仅用户Drawing5，实体0。旧屏障hash再次核对一致。

最终实际命令：pnpm typecheck；pnpm test **112/112**；pnpm smoke均通过。独立MCP完整pytest **235 passed / 33 skipped**；改动Python文件isolated ruff I/F通过。手册links-only与git diff检查通过，已安装启动器cader -v输出0.4.0-dev.9。早期服务fixture握手、规划fixture权限设置与schema快照失败均保留说明，未降低真实验收门槛。

用户旧CLI进程仍使用已加载旧代码，应退出并从已准备的空工作区 `.cader/workspaces/drawing-20261123-dev9` 启动新会话；未解除旧unknown或接管旧图。两个独立仓库按普通commit/push交付；具体提交、PR、远端CI与未关闭工作项记录在Cader#20及MCP#41，不将旧成功CI冒充新提交检查。
