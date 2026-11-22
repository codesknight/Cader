import { readFile, lstat, mkdir, writeFile, rename, link } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { workspacePath } from '@cader/config';
import { assertToolArguments, ToolArgumentsError } from '@cader/dsh-adapter';
import type { ToolDefinition } from '@cader/dsh-adapter';

const hash=(data:string)=>createHash('sha256').update(data).digest('hex');
export interface BarrierReview {
  eligible:boolean; reason:string; operation_id?:string; tool?:string; target?:string;
  validation_error?:string; original_audit?:string;
  missing_fields?:string[]; argument_names?:string[]; barrier_sha256?:string; audit_sha256?:string; schema_sha256?:string;
  writer_process?:'current'|'stopped'|'not_recorded'; requires_operator_confirmation:true;
  native_no_execution_proven:false;
}
export interface BarrierSnapshot { review:BarrierReview; path?:string; raw?:string; auditPath?:string }
async function bounded(workspace:string,path:string,max:number){
  const info=await lstat(path);
  if(info.isSymbolicLink()||!info.isFile()||info.size>max)throw new Error('BARRIER_REVIEW_PATH_REFUSED');
  return readFile(await workspacePath(workspace,path),'utf8');
}

/** This establishes a review candidate, never native execution proof. No error
 * text or changed client schema by itself permits release of a barrier. */
export async function inspectLegacyBarrier(workspace:string,tools:ToolDefinition[]):Promise<BarrierSnapshot>{
  const no=(reason:string):BarrierSnapshot=>({review:{eligible:false,reason,requires_operator_confirmation:true,native_no_execution_proven:false}});
  const path=resolve(workspace,'.cader/locks/managed-write.json');
  let raw:string;
  try{raw=await bounded(workspace,path,1_000_000);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return no('NO_PERSISTED_BARRIER');throw error;}
  let barrier:any;
  try{barrier=JSON.parse(raw);}catch{return no('INVALID_BARRIER');}
  if(!barrier.frozen||barrier.outcome!=='unknown'||barrier.stage!=='dispatch'||typeof barrier.request!=='string'||
    typeof barrier.tool!=='string'||! /^[a-z][a-z0-9_]+$/.test(barrier.tool)||typeof barrier.target!=='string'||typeof barrier.runDirectory!=='string')return no('NOT_LEGACY_ARGUMENT_REJECTION');
  const matches=tools.filter(t=>t.name.endsWith('__'+barrier.tool));
  if(matches.length!==1)return no('CURRENT_TOOL_SCHEMA_REQUIRED');
  const error=barrier.error;
  const message=error?.protocol_failure?.error?.message;
  if(error?.name!=='McpCallError'||error?.code!=='MCP_TOOL_FAILED'||error.hresult!=null||error.native_code!=null||typeof message!=='string'||
    !message.includes('validation error')||!message.includes(barrier.tool+'Arguments'))return no('EXECUTION_OUTCOME_UNCONFIRMED');
  const auditPath=resolve(barrier.runDirectory,'execution.jsonl');
  let auditRaw:string,rows:any[];
  try{auditRaw=await bounded(workspace,auditPath,32_000_000);rows=auditRaw.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
  catch{return no('ORIGINAL_AUDIT_UNAVAILABLE');}
  const own=rows.filter(row=>row.operation_id===barrier.request);
  const prepared=own.filter(row=>row.phase==='prepared');
  const failed=own.filter(row=>row.phase==='frozen');
  if(prepared.length!==1||failed.length!==1||own.some(row=>['mutation_acknowledged','confirmed','reconciled'].includes(row.phase))||
    own.some(row=>row.tool!==barrier.tool||row.target!==barrier.target)||failed[0].stage!=='dispatch'||failed[0].outcome!=='unknown'||
    failed[0].dispatched!==true||JSON.stringify(failed[0].error)!==JSON.stringify(error))return no('ORIGINAL_AUDIT_MISMATCH');
  let missing:string[]=[];
  try{assertToolArguments(matches[0]!,prepared[0].args);return no('ARGS_MATCH_CURRENT_SCHEMA');}
  catch(problem){
    if(!(problem instanceof ToolArgumentsError)||!problem.issues.length||problem.issues.some(issue=>issue.keyword!=='required'||!/^\/[A-Za-z_][A-Za-z0-9_]*$/.test(issue.path)))return no('NOT_MISSING_REQUIRED_ARGUMENTS');
    missing=problem.issues.map(issue=>issue.path.slice(1));
  }
  if(!missing.every(field=>new RegExp('(?:^|\\n)'+field+'\\r?\\n\\s+Field required \\[type=missing').test(message)))return no('SERVER_VALIDATION_EVIDENCE_MISMATCH');
  let writer:BarrierReview['writer_process']='not_recorded';
  if(Number.isSafeInteger(barrier.owner_pid)&&barrier.owner_pid>0){
    if(barrier.owner_pid===process.pid)writer='current';
    else{try{process.kill(barrier.owner_pid,0);return no('ORIGINAL_WRITER_STILL_RUNNING');}
      catch(problem){if((problem as NodeJS.ErrnoException).code!=='ESRCH')return no('ORIGINAL_WRITER_STATE_UNAVAILABLE');writer='stopped';}}
  }
  return {path,raw,auditPath,review:{eligible:true,reason:'LEGACY_MISSING_ARGUMENTS_REVIEW_CANDIDATE',operation_id:barrier.request,tool:barrier.tool,target:barrier.target,
    validation_error:message.slice(0,2000),original_audit:auditPath,
    missing_fields:missing,argument_names:Object.keys(prepared[0].args??{}),writer_process:writer,
    barrier_sha256:hash(raw),audit_sha256:hash(auditRaw),schema_sha256:hash(JSON.stringify(matches[0]!.parameters)),requires_operator_confirmation:true,native_no_execution_proven:false}};
}

/** Call only while the review mutex is held and after explicit operator
 * confirmation. The old outcome remains unknown in the preserved original. */
export async function archiveReviewedBarrier(workspace:string,snapshot:BarrierSnapshot){
  if(!snapshot.review.eligible||!snapshot.raw||!snapshot.path||!snapshot.auditPath)throw new Error('BARRIER_REVIEW_NOT_ELIGIBLE');
  const current=await bounded(workspace,snapshot.path,1_000_000),audit=await bounded(workspace,snapshot.auditPath,32_000_000);
  if(hash(current)!==snapshot.review.barrier_sha256||hash(audit)!==snapshot.review.audit_sha256)throw new Error('BARRIER_CHANGED_DURING_REVIEW');
  await mkdir(resolve(workspace,'.cader/barriers'),{recursive:true});
  const directory=await workspacePath(workspace,'.cader/barriers'),id=randomUUID();
  const archive=resolve(directory,id+'.barrier.json'),receipt=resolve(directory,id+'.review.json'),auditSnapshot=resolve(directory,id+'.execution.jsonl');
  await writeFile(auditSnapshot,audit,{flag:'wx',mode:0o600});
  await writeFile(receipt,JSON.stringify({version:1,at:new Date().toISOString(),decision:'operator_confirmed_no_execution',
    native_no_execution_proven:false,assertions:['request_did_not_execute','no_running_or_delayed_CAD_operation','new_scratch_only'],
    evidence:snapshot.review,archive,auditSnapshot},null,2),{flag:'wx',mode:0o600});
  // Final source comparison after all preparation. Never overwrite a new lock.
  if(hash(await bounded(workspace,snapshot.path,1_000_000))!==snapshot.review.barrier_sha256||
    hash(await bounded(workspace,snapshot.auditPath,32_000_000))!==snapshot.review.audit_sha256)throw new Error('BARRIER_CHANGED_DURING_REVIEW');
  await rename(snapshot.path,archive);
  if(hash(await bounded(workspace,archive,1_000_000))!==snapshot.review.barrier_sha256){
    // Restore only if no other writer has claimed the path; preserve both files.
    await link(archive,snapshot.path).catch(()=>{});throw new Error('BARRIER_CHANGED_DURING_ARCHIVE');
  }
  return {archive,receipt,auditSnapshot};
}
