import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loadMcp } from '@cader/config';
import { createMcpClient, comEvidence, parseNativeBinding, parseExecutionEnvelope, receiptOutcome, ObservedMcpCallError } from '@cader/dsh-adapter';
import type { ObservedRequest, NativeBinding } from '@cader/dsh-adapter';
import { environmentRedactor } from './session-store.js';

/** Explicit opt-in: actual MCP/COM reads and deliberately invalid admission requests.
 * No valid mutator, model request, document adoption or barrier retirement is issued. */
export async function runExecutionEvidenceSmoke(root:string,mcpPath:string){
  const directory=resolve(root,'.cader/runs',`execution-evidence-${randomUUID()}`);
  await mkdir(directory,{recursive:true});
  const clean=environmentRedactor().clean;
  const events:unknown[]=[];
  const checks:Record<string,boolean|null>={discovery:false,binding:null,refusal_receipt:false,journal:false,foreign_instance_refused:false,missing_record_unresolved:false,binding_unchanged:null};
  let client:Awaited<ReturnType<typeof createMcpClient>>|undefined;
  let failure:{name:string;message:string;protocol_failure?:unknown}|undefined;
  try{
    client=await createMcpClient(await loadMcp(resolve(root,mcpPath)));
    const status=await client.call('get_backend_status',{}),support=comEvidence(status,client.toolNames());
    events.push({phase:'capabilities',status});
    if(!support)throw new Error('COM_EXECUTION_EVIDENCE_REQUIRED');
    checks.discovery=true;
    let before:NativeBinding|undefined;
    try{before=parseNativeBinding(await client.call('get_document_binding',{}),support);events.push({phase:'binding_before',binding:before});checks.binding=true;}
    catch(error){failure=JSON.parse(clean(JSON.stringify({name:(error as Error).name,message:(error as Error).message,protocol_failure:(error as {failure?:unknown}).failure})));events.push({phase:'binding_unavailable',failure});}
    // Missing radius/center is rejected before session/native dispatch by the real server.
    const request:ObservedRequest={instance_id:support.instance_id,request_id:randomUUID(),operation:'draw_circle',arguments:{},document_id:before?.document_id??'unbound-contract-probe'};
    events.push({phase:'request_prepared',request});
    await writeFile(resolve(directory,'evidence.json'),clean(JSON.stringify(events,null,2)));
    let rejected:ObservedMcpCallError|undefined;
    try{await client.call('execute_observed_operation',request as unknown as Record<string,unknown>);}catch(error){if(!(error instanceof ObservedMcpCallError))throw error;rejected=error;}
    if(!rejected)throw new Error('INVALID_NATIVE_REQUEST_WAS_NOT_REJECTED');
    const {receipt}=parseExecutionEnvelope(rejected.envelope,request,true);
    events.push({phase:'refused',receipt});
    checks.refusal_receipt=receiptOutcome(receipt)==='failed_before_dispatch';
    const journal=await client.call('get_execution_status',{instance_id:request.instance_id,request_id:request.request_id});
    const reread=parseExecutionEnvelope({receipt:journal},request).receipt;
    events.push({phase:'journal',receipt:reread});
    checks.journal=JSON.stringify(receipt)===JSON.stringify(reread);
    const foreign=await client.call('get_execution_status',{instance_id:`foreign-${randomUUID()}`,request_id:request.request_id}) as Record<string,unknown>;
    events.push({phase:'foreign_instance',result:foreign});
    checks.foreign_instance_refused=foreign.status==='unresolved'&&foreign.reason==='INSTANCE_MISMATCH'&&foreign.replay_safe===false;
    const missing=await client.call('get_execution_status',{instance_id:request.instance_id,request_id:randomUUID()}) as Record<string,unknown>;
    events.push({phase:'missing_record',result:missing});
    checks.missing_record_unresolved=missing.status==='unresolved'&&missing.reason==='RECORD_NOT_AVAILABLE'&&missing.replay_safe===false;
    if(before){const after=parseNativeBinding(await client.call('get_document_binding',{}),before);events.push({phase:'binding_after',binding:after});checks.binding_unchanged=after.document_id===before.document_id;}

  }catch(error){failure=JSON.parse(clean(JSON.stringify({name:(error as Error).name,message:(error as Error).message,protocol_failure:(error as {failure?:unknown}).failure})));}
  finally{try{await client?.dispose();}catch(error){failure??={name:'CleanupError',message:clean((error as Error).message)};}}
  await writeFile(resolve(directory,'evidence.json'),clean(JSON.stringify(events,null,2)));
  const report={ok:!failure&&Object.values(checks).every(Boolean),kind:'live-mcp-com-readonly-contract',runDirectory:directory,checks,failure,realModelEvaluated:false,nativeWriteEvaluated:false,fullQualityEvaluated:false};
  await writeFile(resolve(directory,'report.json'),clean(JSON.stringify(report,null,2)));
  return report;
}
