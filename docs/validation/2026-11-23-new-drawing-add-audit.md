# 2026-11-23 15:13 new_drawing / unknown.Add 审计

工作项：REQ-038 / [#20](https://github.com/codesknight/Cader/issues/20)，Milestone 3。来源为用户dev.8绘本风格房子/树新任务日志。本轮只审计，不修改运行时代码、独立MCP或历史屏障，不重放请求。

## 已证实

1. 私有运行exec-51dc2673-9fad-45bd-ab0d-39432b20d8dc：15:09:07进入规划，15:09:16组件重叠被拒，15:09:22未请求的保存门槛被拒，15:09:27计划提交成功。15:13:44审批记录落盘并进入drawing。审批前约4分钟间隔不能直接归因于模型规划缓慢。
2. 原操作5db6d425-2d43-4538-be3c-f1f31945ebc1：15:13:56.868写入prepared，15:13:58.802返回MCP错误 `Error executing tool new_drawing: <unknown>.Add`，耗时1942ms。没有acknowledgement/postflight记录，target=null，确认0/unknown1。失败在第一条新建命令，尚未绘图；quality.visual_attempt_count=0，未发生视觉调用不是此次阻塞原因。
3. 随后get_backend_status返回worker_running/not_probed、queue_depth=0，list_layers返回[0]。这证明工具服务/受控读仍可工作，不证明请求未执行或文档归属。recover拒绝DISPATCH_OUTCOME_UNCONFIRMED符合当前规则。新工作区原本无屏障，这是本轮新故障，非旧锁残留。
4. 独立AutoCAD-MCP的CADConnection.new_document直接访问app.Documents.Add，之后才_wait_for_document。等待只保护新图返回后的绑定，不保护Documents集合或Add方法获取；既有PlotConfigurations.Add恢复修复没有覆盖此路径。
5. 同时存在隐式写：COMSession在首个native请求时懒连接；CADConnection.connect若Documents.Count==0会new_document。随后COMSession.execute(new_document)再创建一次。这个分支源码确定存在，但本次调用前没有原生文档数量记录，不能断言本次走了该分支。
6. 本机pywin32 dynamic.__getattr__最终会抛AttributeError(f"{self._username_}.{attr}")，与<unknown>.Add形式一致。其元数据/属性解析可吞掉底层ole_error，MCP当前仅回传字符串，审计未保留原生Python堆栈或HRESULT。本次更指向方法解析失败，尚不足以证明实际native调用边界与全部副作用。
7. 15:17:52用独立只读COM GetActiveObject观察：当时仅1张Drawing5.dwg，ModelSpace实体0。不使用Dispatch/Add/Save/Close，不改图；只能证明该时刻有空文档，不能确认创建者/创建时间，不能将其自动接管为Cader新工作图。观察原文只保存在.cader/new-drawing-1513-native-observation.json。

## 推断与待验证

Documents动态包装器未就绪、AutoCAD忙态导致类型/方法查询失败是优先假设；尚无证据将其唯一归因于busy、线程或pywin32缓存损坏。STA串行已有实现，不能仅见COM错误便断言线程模型错误。缺少失败时原生stack、应用/文档状态与原生派发标记，不能证明具体一次Add未调用。初始化隐式新图可能先执行、显式Add再失败，与后续空图观察相容，但不是已证实历史。

计划还有风格/几何验收风险：墙体上界140而屋顶下界152、树干上界110而树冠下界124，按这些bounds直接绘制可能悬空；是否实际如此尚未发生绘图，不能当既成缺陷。终端处理中插入提示符属另一个待复现显示问题，不等于已结束模型任务。

## 应修方向（未实施）

- 在MCP原生执行边界拆开就绪检查、方法解析、实际调用、绑定验证；保留结构化原始异常、native_invoked和初始化写入证据。只有可信程序证明未到原生写入，客户端才能判定未派发；禁止仅匹配错误文字解冻。
- 对只读Documents/方法解析做有界就绪等待；Add本身不盲重试。调用后的异常必须查询对账，不能再Add试探。
- 新建任务的连接初始化不应隐式造图后又显式造图；一次新建请求只有一个受审计原生创建入口。绑定必须确认实际新文档，不能只等待任意ActiveDocument可读。
- 回归无打开文档/已有文档、Add方法解析失败、原生创建成功但回包/绑定失败等路径，并用真实AutoCAD验证。初始化副作用与未知写入恢复仍需同一证据链。

当前/mcp resolve只支持已限定的旧缺参人工复核，不适用于本次Add未知。不得删managed-write.json、重放new_drawing或接管当前空图来假装恢复。新目录最多隔离旧状态，不修复COM根因。本次两轮既有成功测试不覆盖本次失败，#20保持打开。

REQ-039后续：用户授权后已实施修复并分层复验，旧unknown仍未修改。详见[实现与真实结果](2026-11-23-native-document-create-fix.md)，上文“未实施”为审计时状态。
