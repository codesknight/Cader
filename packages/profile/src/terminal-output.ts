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
  }|undefined;
  const business=event.businessOutcome as {
    status: string;
    reason?: string;
  }|undefined;
  const refused=business?.status==='refused';
  return `\n  ${event.isError? '×':refused? '!':'✓'} ${String(event.tool)}`+
    (failure? ` · ${failure.code} · ${failure.stage} · ${failure.dispatched? '已派发':'未派发'}`:'')+
    (refused? ` · 未恢复（${business?.reason??'REFUSED'}）`:'')+'\n';
}
