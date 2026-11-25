# 联合回归反馈：新建已 ACK 后的名称读取失败

日期：2026-11-25。关联 Cader REQ-048 / #20、AutoCAD-MCP #44。仅记录建议，不修改独立 MCP 源码，不授权清除历史屏障。

## 实际证据

在 MCP aed49a7、Cader 14ada93，AutoCAD 启动页没有活动文档时，原始绘本房子任务的新执行入口返回：

- operation=new_document，status=failed，stage=observation_failed。
- native_actions 仅 Documents.Add，acknowledged=true；native_invoked/native_acknowledged 均 true。
- error.type=AttributeError，message=`<unknown>.Name`，result_document_id=null。
- 后续显式 get_document_binding 能观察到新建空图且 managed=true；这不能追溯补造原请求结果文档身份，Cader 保留 acknowledged_unbound 屏障，没有接管活动图。

原始私有记录：`quality-9d19ef77-f2b9-4f52-964e-c6c1ee647798`，请求 `5088bad9-8439-44b1-820b-85aaa4dc9a0e`。该首轮失败保留。CAD 已有图纸后，另一个独立任务 `quality-34169d88-42bd-4555-b296-e8cbc659a265` 成功新建并完成绘本/DWG；后者不是解除、恢复或重放首轮。

## 源码判断与最小建议

已核对 `src/autocad_mcp/cad/backends/com_backend.py` 的 COMSession.execute：new_document 调用 connection.new_document 后，直接返回 `self.connection.document.Name`。已有 connection.binding 使用 capture.prop 读取 Name/ReadOnly；capture.prop 通过权威 DISPID 读取并仅对只读操作有限重试。

**已证实**：新建原生 ACK 后名称观测失败，直接属性访问路径存在；尚未证明究竟是具体包装缓存、元数据缺失还是短暂就绪问题。建议复用既有安全属性读取，而非重试 Documents.Add：

```diff
 if operation == "new_document":
+    from autocad_mcp.cad.capture import prop
     self.connection.new_document()
-    return self.connection.document.Name
+    return prop(self.connection.document, "Name")
```

此片段是待 MCP 团队评审的建议，未应用、未验收。若属性读取仍失败，必须保留 ACK/observation_failed，不伪造成功或结果 ID；可另评审如何将已知生命周期身份与标签读取分开记录，不以活动图名称推断所有权。

## 必要复验

1. 正常启动到无文档开始页，以普通产品 stdio 服务执行自然语言新建，不仅测试 NativeTests 实例入口。
2. 每次 Add 只能执行一次；冷态和已有图纸状态均验证新图身份、名称和 managed 状态。
3. 抑制/延迟名称读取时只读有限重试，不重试原生写；持续失败保留真实 ACK 后失败。
4. 保存改名保持原生命周期 ID；旧空图、旧屏障和 unknown 记录不改写。
5. 重跑原始红屋顶蓝墙/大树及复杂手稿，代码检查与真实任务结果分别报告。
