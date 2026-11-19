# Real model → AutoCAD execution acceptance

Date: 2026-11-20 (Asia/Shanghai). Work item [#18](https://github.com/codesknight/Cader/issues/18), v0.3.0 milestone. User requested correction from read-only chat to actual autonomous CAD operation. No files in the separate AutoCAD-MCP repository were modified.

## Environment and method

Windows, Node 24.9+ (initial checks used installed 24.22.1), pnpm 11.28.5, existing independent autocad-mcp conda Python. DSH 0.2.2-rc.4 / Cordis 4.1.0. Real `deepseek-v4-pro`, reasoning off; real COM AutoCAD version read independently as `25.1s (LMS Tech)`. Existing configured Flash remains the interactive default; this acceptance explicitly selects the configured text profile.

First, an independent MCP client discovered 44 tools and actually called new_drawing/list_layers/query_entities, obtaining a new blank drawing with default layer 0. Status discovery alone returned COM `not_probed`; it was not counted as native connection proof.

Then run:

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --execution
```

This enters the same InteractiveSession/runTask/DSH path as CLI conversation. Two natural-language prompts specify desired geometry, layer and later modification/save; neither prompt supplies tool names or a fixed operation plan. Ask approvals are handled by an explicit acceptance callback restricted to CAD requests; Agent Shell requests are denied. Expected geometry is fixed independently in the verifier, not read from model prose.

## Observed result

Final pinned-Node 24.9.0 run: `.cader/runs/agent-execution-01b35dc7-f3f9-4bef-b1e5-55816aa4dde8/verification.json` and `events.jsonl`. CAD write audit: `.cader/runs/execution-*/execution.jsonl` referenced by the workspace lock during execution. These are private records, not committed raw logs.

| User acceptance | Evidence | Result |
|---|---|---|
| Startup auto-connect | Local profile connected, 44 discovered tools; wrapped reviewed subset exposed | Passed |
| CAD connection status | Real calls succeeded; status correctly reports COM lifecycle limitations | Passed with limited COM status detail |
| Natural-language blank drawing | Model selected new_drawing, created fresh Drawing5 | Passed |
| Line, rectangle, circle | Independent MCP client read three expected entities | Passed |
| Layer and color | Layer CADER_ACCEPTANCE; native Layers.Item color ACI 1 | Passed |
| Modify created entity | Circle moved from (50,30,0) to (55,30,0), radius remains 15 | Passed |
| Save specified DWG | Existing scratch saved to fresh private run path, 16479 bytes, AC1032 header | Passed |
| Independent verification | Line endpoints, circle center/radius, rectangle vertices/closed, layer, document FullName, file hash | Passed |
| Autonomous repeated calls | Real DSH tool-call events across two model turns, seven CAD approvals | Passed |
| Disconnected guidance | Deterministic CLI state and prompt explicitly direct /mcp use, /mcp tools, /status | Passed: third real-model turn recognizes missing tools and gives /mcp use, /mcp tools and /status guidance |

Rectangle independently read as closed AcDb2dPolyline with vertices (0,0,0), (100,0,0), (100,60,0), (0,60,0). Line endpoints (0,0,0) → (100,0,0). All entities on CADER_ACCEPTANCE; exactly three entities. Native active document path matched the expected saved artifact. SHA256 `96b646609046f59af390e0a7f52e83f0017908cb8dd42843009c2c9063a0beb1`.

## Retained failures and limits

First real run `agent-execution-95792f37-23bf-4e52-8e2c-39857157c4fe` actually drew, moved and saved, but verifier incorrectly required AcDbPolyline and rejected the server's AcDb2dPolyline. The old failed report remains untouched. Corrected verifier accepts both known native types and additionally checks native vertices and closure; the second run passed all 13 executed checks.

An initial regression test failed because the file privacy filter inspected the absolute test workspace under `.cader/tests`; corrected filtering checks paths relative to the workspace plus canonical target. Old 46/47 failure is recorded in testing.md; 47/47 passed after correction.

COM provides name-based active-document protection, not HTTP revision/instance bindings. Controlled COM reopen, original-DWG editing and automatic request reconciliation are not implemented. Unknown writes persist a shared freeze for manual review; real response-loss fault injection was not performed. Model prose can overstate independent verification; only the external acceptance report is authoritative. Saved header/hash and in-memory entity queries do not establish reopened-file geometry integrity. No image-to-DWG or full upstream DSH app-profile acceptance is claimed.

Final third run passed all 15 executed checks, including a real-model disconnected-guidance turn after MCP off. Model-requested host Shell checks were denied; the independent verifier still confirmed file/geometry/color. Sanitized actual model/tool events and independent observations: [evidence JSON](2026-11-20-agent-execution.evidence.json).

Windows真实PTY补测：直接启动 cader.cmd（0.3.0），自动发现44/暴露27项CAD工具；选择真实Pro模型，用自然语言新建空图并绘制半径2圆。分别在new_drawing和draw_circle审批框输入y，真实执行后query_entities回读一个AcDbCircle（中心0,0,0，半径2）。未保存，未执行Shell；/exit正常保存会话并释放MCP。此为真实终端审批，区别于自动验收回调。

CI acceptance: implementation commit `7709770`, [Windows/Linux CI](https://github.com/codesknight/Cader/actions/runs/44575837079) completed successfully, 4/4 jobs (DSH components and Python MCP on both OSes). No credentials, paid model or real CAD were used in CI. #18 core execution acceptance passed; #3 retains controlled reopen/reconciliation/fault-followup scope.
