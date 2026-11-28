import { isDeepStrictEqual } from 'node:util';
import { resolve, dirname, basename } from 'node:path';
import { assertToolArguments } from './tool-validation.js';
import { EvidenceProtocolError } from './execution-evidence.js';
import type { ObservedRequest, ExecutionReceipt } from './execution-evidence.js';

export const fileOperations=['save_document_artifact','reopen_document_artifact','query_verification_entities'];
const id={type:'string',pattern:'^[A-Za-z0-9._-]{1,128}$'},text={type:'string',minLength:1};
const fingerprint={sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},byte_size:{type:'integer',minimum:6}};
const base={instance_id:id,source_document_id:id,revision:{type:'null'},revision_mode:{const:'unsupported'},path:text,...fingerprint};
export interface ComFileArtifact {contract:'autocad-file-artifact/1';artifact_id:string;instance_id:string;source_document_id:string;output_directory:string;path:string;sha256:string;byte_size:number;state:'saved';save_semantics:'save_as_renames_source';verification:'not_performed';saved_at:string}
export interface VerificationDocument {contract:'autocad-verification-document/1';instance_id:string;document_id:string;source_document_id:string;source_artifact_id:string;path:string;sha256:string;byte_size:number;read_only:true;managed:false}
export interface VerificationQuery extends Omit<VerificationDocument,'contract'> {contract:'autocad-verification-query/1';items:Record<string,unknown>[];geometry_scope:'legacy_summary_partial';snapshot_revision:null}
export function parseFileResult(value:unknown,request:ObservedRequest,receipt:ExecutionReceipt):ComFileArtifact|VerificationDocument|VerificationQuery {
  const operation=request.operation,common={...base};
  const properties=operation==='save_document_artifact'?{...common,contract:{const:'autocad-file-artifact/1'},artifact_id:id,output_directory:text,state:{const:'saved'},saved_at:text,save_semantics:{const:'save_as_renames_source'},verification:{const:'not_performed'}}:
    {...common,contract:{const:operation==='reopen_document_artifact'?'autocad-verification-document/1':'autocad-verification-query/1'},document_id:id,source_artifact_id:id,managed:{const:false},read_only:{const:true},...(operation==='reopen_document_artifact'?{verification:{const:'content_not_yet_compared'}}:{items:{type:'array',maxItems:10000,items:{type:'object'}},geometry_scope:{const:'legacy_summary_partial'},snapshot_revision:{type:'null'}})};
  try{assertToolArguments({name:'COM_file_result',parameters:{type:'object',properties,required:Object.keys(properties)}},value);}catch{throw new EvidenceProtocolError('MCP_FILE_RESULT_INVALID');}
  const v=value as any;
  if(v.instance_id!==request.instance_id)throw new EvidenceProtocolError('MCP_FILE_INSTANCE_MISMATCH');
  if(operation==='save_document_artifact'){
    const root=resolve(String(request.arguments.output_directory)),path=resolve(v.path);
    if(v.source_document_id!==request.document_id||receipt.result_document_id!==v.source_document_id||resolve(v.output_directory)!==root||dirname(path)!==resolve(root,'artifact-'+v.artifact_id)||basename(path)!==request.arguments.file_name)throw new EvidenceProtocolError('MCP_ARTIFACT_BINDING_MISMATCH');
  }else if(operation==='reopen_document_artifact'){
    if(v.source_document_id!==request.document_id||v.source_artifact_id!==request.arguments.artifact_id||v.document_id===v.source_document_id||receipt.result_document_id!==v.document_id)throw new EvidenceProtocolError('MCP_VERIFICATION_BINDING_MISMATCH');
  }else if(v.document_id!==request.document_id||v.document_id!==request.arguments.document_id||v.source_document_id===v.document_id||receipt.result_document_id!==v.document_id)throw new EvidenceProtocolError('MCP_VERIFICATION_QUERY_MISMATCH');
  return structuredClone(value) as any;
}
export function validateFileReceipt(envelope:{result?:unknown},request:ObservedRequest,receipt:ExecutionReceipt){
  if(!fileOperations.includes(request.operation))return;
  const progress=receipt.file_progress as any;
  if(progress!=null&&(typeof progress!=='object'||progress.operation!==request.operation))throw new EvidenceProtocolError('MCP_FILE_PROGRESS_MISMATCH');
  if(receipt.stage==='completed'){
    parseFileResult(receipt.file_result,request,receipt);
    if('result' in envelope&&!isDeepStrictEqual(envelope.result,receipt.file_result))throw new EvidenceProtocolError('MCP_FILE_RESULT_RECEIPT_MISMATCH');
    if(request.operation!=='query_verification_entities'&&progress?.state!==(request.operation==='save_document_artifact'?'saved':'readonly_opened'))throw new EvidenceProtocolError('MCP_FILE_PROGRESS_INCOMPLETE');
  }
}
