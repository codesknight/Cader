import type { PublicEvent } from '@cader/dsh-adapter';
/** The answer has already passed through SafeTextStream. Only append application
 * status after it, including on failure; never render the entire answer twice. */
export function replyTextAfterStreaming(reply: {
  text: string;
  afterStream?: string;
},streamed: boolean) {
  return streamed? (reply.afterStream? '\n'+reply.afterStream:''):reply.text;
}
export function toolResultLine(event: PublicEvent) {
  const failure=event.cadFailure as {
    code: string;
    stage: string;
    dispatched: boolean;
    transport_dispatched?:boolean;
    native_dispatched?:boolean;
  }|undefined;
  const business=event.businessOutcome as {
    status: string;
    reason?: string;
  }|undefined;
  const refused=business?.status==='refused';
  const visual=event.tool==='cader_review_cad_view'||event.tool==='cader_submit_visual_report';
  const failed=business?.status==='failed';
  const pending=business?.status==='pending'||(visual&&!failed&&business?.status!=='succeeded');
  return `\n  ${event.isError||failed? '×':refused||pending? '!':'✓'} ${String(event.tool)}`+
    (failure? ` · ${failure.code} · ${failure.stage} · ${failure.transport_dispatched&&failure.native_dispatched===false?'MCP已送达，原生未调用':failure.dispatched? '已派发':'未派发'}`:'')+
    (refused? ` · 未恢复（${business?.reason??'REFUSED'}）`:'')+
    (event.tool==='cader_cad_execution_status'?' · 只读执行记录查询，写屏障状态不变':'')+
    (visual?pending?` · 视觉待验证（${business?.reason}）`:failed?' · 视觉未通过':business?.status==='succeeded'?' · 视觉报告通过，等待任务验收':' · 视觉未完成':'')+'\n';
}
