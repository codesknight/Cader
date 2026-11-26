import { fileOperations,validateFileReceipt } from './file-evidence.js';
import { assertToolArguments, ToolArgumentsError } from './tool-validation.js';

const id={type:'string',pattern:'^[A-Za-z0-9._-]{1,128}$'};
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required});
const nullable=(value:unknown)=>({anyOf:[value,{type:'null'}]});
const ids={type:'array',maxItems:10000,uniqueItems:true,items:{type:'string',pattern:'^[1-9][0-9]*$'}};
const bindingSchema={name:'document_binding',parameters:object({instance_id:id,document_id:id,name:{type:'string',minLength:1},managed:{type:'boolean'},read_only:{type:'boolean'},revision:{type:'null'},revision_mode:{const:'unsupported'}})};
const receiptSchema={name:'execution_receipt',parameters:object({contract:{const:'autocad-execution/1'},backend:{const:'com'},instance_id:id,request_instance_id:id,request_id:id,operation:{type:'string',minLength:1},request_document_id:nullable(id),result_document_id:nullable(id),status:{enum:['pending','failed','succeeded']},stage:{enum:['queued','preflight','not_dispatched','dispatching','native_acknowledged','observing','observation_failed','result_unknown','completed']},revision:{type:'null'},revision_mode:{const:'unsupported'},native_invoked:{type:'boolean'},native_acknowledged:{type:'boolean'},native_actions:{type:'array',maxItems:10000,items:object({name:{type:'string',minLength:1},acknowledged:{type:'boolean'}})},observation:{enum:['not_started','pending','failed','succeeded']},affected_entities:object({created:ids,modified:ids,deleted:ids,complete:{type:'boolean'}}),service_request_fingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'},fingerprint_algorithm:{const:'sha256-canonical-com-request-v1'},retention:object({scope:{const:'python_backend_lifetime'},terminal_ttl_seconds:{type:'number',minimum:0},capacity:{type:'integer',minimum:1}}),error:nullable({type:'object'})})};
export interface NativeBinding {instance_id:string;document_id:string;name:string;managed:boolean;read_only:boolean;revision:null;revision_mode:'unsupported'}
export interface ObservedRequest {instance_id:string;request_id:string;operation:string;arguments:Record<string,unknown>;document_id:string|null}
export interface ExecutionReceipt {contract:'autocad-execution/1';backend:'com';instance_id:string;request_instance_id:string;request_id:string;operation:string;request_document_id:string|null;result_document_id:string|null;status:'pending'|'failed'|'succeeded';stage:string;revision:null;revision_mode:'unsupported';native_invoked:boolean;native_acknowledged:boolean;native_actions:{name:string;acknowledged:boolean}[];observation:string;affected_entities:{created:string[];modified:string[];deleted:string[];complete:boolean};service_request_fingerprint:string;fingerprint_algorithm:string;[key:string]:unknown}
export interface ComEvidence {instance_id:string;operations:string[];contract:'autocad-backend-evidence/1';file_artifacts?:true}
export class EvidenceProtocolError extends Error {readonly code='MCP_EVIDENCE_INVALID';constructor(message:string){super(message);this.name='EvidenceProtocolError';}}
/** Raw failure envelope from the exact additive MCP entrypoint; NOT yet trusted. */
export class ObservedMcpCallError extends Error {constructor(readonly envelope:unknown){super('MCP_OBSERVED_OPERATION_FAILED');this.name='ObservedMcpCallError';}}
export class ExecutionReceiptError extends Error {
  constructor(readonly receipt:ExecutionReceipt,readonly outcome:'failed_before_dispatch'|'committed_observation_failed'|'unknown',readonly processing_error?:string){
    super(`MCP_OBSERVED_${outcome.toUpperCase()}: ${processing_error??String((receipt.error as {message?:string}|null)?.message??receipt.stage)}`);this.name='ExecutionReceiptError';
  }
}
export function comEvidence(status:unknown,tools:string[]):ComEvidence|null{
  const s=status as {backend?:string;instance_id?:string;capabilities?:{evidence_support?:any}}|null,cap=s?.capabilities?.evidence_support;
  if(!cap||s?.backend!=='com')return null; // HTTP keeps its distinct existing contract, never COM fallback.
  try{
    assertToolArguments({name:'backend_evidence',parameters:object({contract:{const:'autocad-backend-evidence/1'},document_identity:object({supported:{const:true},scope:{const:'python_com_session'},mechanism:{const:'canonical_iunknown_lifecycle'},entity_ids_scope:{const:'document'}}),revision:object({authoritative:{const:false},manual_edits_observed:{const:false},mode:{const:'unsupported'}}),execution_receipts:object({supported:{const:true},contract:{const:'autocad-execution/1'},entrypoint:{const:'execute_observed_operation'},native_action_ack:{const:true},automatic_write_replay:{const:false},operations:{type:'array',uniqueItems:true,items:{type:'string'}}}),reconciliation:object({supported:{const:true},scope:{const:'python_backend_lifetime'},survives_python_restart:{const:false},missing_record_proves_not_executed:{const:false}})})},cap);
    assertToolArguments({name:'instance',parameters:id},s.instance_id);
    if(!['get_document_binding','execute_observed_operation','get_execution_status'].every(name=>tools.some(t=>t.split('__').at(-1)===name)))throw new Error('Advertised evidence tool missing');
    if(!cap.execution_receipts.operations.includes('new_document'))throw new Error('Creation receipt required for owned-document binding');
    const fileSupport=fileOperations.some(name=>cap.execution_receipts.operations.includes(name));
    if(fileSupport){
      if(!fileOperations.every(name=>cap.execution_receipts.operations.includes(name)))throw new Error('Incomplete file operations');
      assertToolArguments({name:'file_artifact_capability',parameters:object({contract:{const:'autocad-file-artifact/1'},persistent:{const:false},source_revision_authoritative:{const:false},save_semantics:{const:'save_as_renames_source'},output_namespace:{const:'unique_artifact_subdirectory'},overwrite:{const:false},atomic_with_entities:{const:false}})},cap.file_artifacts);
      if(cap.readonly_reopen?.supported!==true||cap.readonly_reopen?.scope!=='python_backend_owned_artifacts')throw new Error('Read-only reopen capability missing');
    }
    return {instance_id:s.instance_id!,operations:[...cap.execution_receipts.operations],contract:cap.contract,...(fileSupport?{file_artifacts:true as const}:{})};
  }catch{throw new EvidenceProtocolError('MCP_EVIDENCE_CAPABILITIES_INVALID: no silent downgrade');}
}
export function parseNativeBinding(value:unknown,expected:{instance_id:string;document_id?:string}|undefined,writing=false):NativeBinding{
  try{assertToolArguments(bindingSchema,value);}catch{throw new EvidenceProtocolError('MCP_DOCUMENT_BINDING_INVALID');}
  const b=value as NativeBinding;
  if(expected&&(b.instance_id!==expected.instance_id||expected.document_id!==undefined&&b.document_id!==expected.document_id))throw new EvidenceProtocolError('MCP_DOCUMENT_IDENTITY_MISMATCH');
  if(writing&&(!b.managed||b.read_only))throw new EvidenceProtocolError('MCP_DOCUMENT_NOT_WRITABLE');
  return structuredClone(b);
}
export function observedArguments(name:string,p:Record<string,unknown>):{operation:string;arguments:Record<string,unknown>}|undefined{
  const fields:Record<string,string[]>={new_drawing:['request_id'],draw_line:['start_x','start_y','start_z','end_x','end_y','end_z','layer'],draw_circle:['center_x','center_y','center_z','radius','layer'],draw_text:['position_x','position_y','position_z','text','height','layer','rotation'],move_entity:['object_id','offset_x','offset_y','offset_z'],delete_entity:['object_id'],get_entity:['object_id'],save_drawing:['file_path','overwrite'],query_entities:['entity_type'],export_current_view:['file_path','request_id']};
  if(fields[name]&&Object.keys(p).some(key=>!fields[name]!.includes(key)))throw new ToolArgumentsError(name,[{path:'/',keyword:'mapping',message:'Argument has no observed-operation mapping; no request sent'}]);
  const point=(prefix:string)=>['x','y','z'].map(axis=>p[`${prefix}_${axis}`]);
  const layer=p.layer?{layer:p.layer}:{};
  switch(name){
    case 'new_drawing':return {operation:'new_document',arguments:{}};
    case 'draw_line':return {operation:name,arguments:{start:point('start'),end:point('end'),...layer}};
    case 'draw_circle':return {operation:name,arguments:{center:point('center'),radius:p.radius,...layer}};
    case 'draw_text':return {operation:name,arguments:{position:point('position'),text:p.text,height:p.height,rotation:p.rotation??0,...layer}};
    case 'move_entity':return {operation:name,arguments:{object_id:p.object_id,offset:point('offset')}};
    case 'delete_entity':case 'get_entity':return {operation:name,arguments:{object_id:p.object_id}};
    case 'save_drawing':return {operation:name,arguments:{file_path:p.file_path,overwrite:p.overwrite??false}};
    case 'query_entities':return {operation:name,arguments:p.entity_type?{entity_type:p.entity_type}:{}};
    case 'export_current_view':return {operation:name,arguments:{file_path:p.file_path,request_id:p.request_id}};
    default:return undefined;
  }
}
/** Validate identity AND causal consistency before interpreting any ACK/status. */
export function parseExecutionEnvelope(value:unknown,request:ObservedRequest,isError=false){
  const envelope=value as {receipt?:unknown;result?:unknown}|null;
  try{assertToolArguments(receiptSchema,envelope?.receipt);}catch{throw new EvidenceProtocolError('MCP_EXECUTION_RECEIPT_INVALID');}
  const r=envelope!.receipt as ExecutionReceipt;
  if(r.instance_id!==request.instance_id||r.request_instance_id!==request.instance_id||r.request_id!==request.request_id||r.operation!==request.operation||r.request_document_id!==request.document_id||r.result_document_id!==null&&request.document_id!==null&&r.result_document_id!==request.document_id&&request.operation!=='reopen_document_artifact')throw new EvidenceProtocolError('MCP_EXECUTION_IDENTITY_MISMATCH');
  const invoked=r.native_actions.length>0,ack=invoked&&r.native_actions.every(a=>a.acknowledged),reading=['get_entity','query_entities','query_verification_entities'].includes(request.operation);
  if(r.native_invoked!==invoked||r.native_acknowledged!==ack||reading&&invoked)throw new EvidenceProtocolError('MCP_NATIVE_ACK_CONTRADICTION');
  if(r.stage==='not_dispatched'&&(r.status!=='failed'||invoked||r.result_document_id!==null||r.affected_entities.complete||['created','modified','deleted'].some(k=>(r.affected_entities[k as 'created']).length>0)||!['not_started','failed'].includes(r.observation)||r.error===null))throw new EvidenceProtocolError('MCP_NOT_DISPATCHED_CONTRADICTION');
  if(r.stage==='completed'&&(r.status!=='succeeded'||r.observation!=='succeeded'||!r.affected_entities.complete||!r.result_document_id||!reading&&!ack||r.error!==null||isError))throw new EvidenceProtocolError('MCP_COMPLETION_CONTRADICTION');
  if(r.stage==='observation_failed'&&(r.status!=='failed'||r.observation!=='failed'||!reading&&!ack))throw new EvidenceProtocolError('MCP_OBSERVATION_CONTRADICTION');
  if(r.stage==='result_unknown'&&(r.status!=='failed'||!invoked||ack))throw new EvidenceProtocolError('MCP_UNKNOWN_CONTRADICTION');
  const effectKey=['draw_line','draw_circle','draw_text'].includes(request.operation)?'created':request.operation==='move_entity'?'modified':request.operation==='delete_entity'?'deleted':null;
  for(const key of ['created','modified','deleted'] as const){
    const affected=r.affected_entities[key];
    if(key!==effectKey&&affected.length||key===effectKey&&(affected.length>1||r.stage==='completed'&&affected.length!==1))throw new EvidenceProtocolError('MCP_AFFECTED_ENTITY_MISMATCH');
    if(key===effectKey&&['modified','deleted'].includes(key)&&affected.some(id=>id!==String(request.arguments.object_id)))throw new EvidenceProtocolError('MCP_AFFECTED_ENTITY_MISMATCH');
  }
  if(r.status==='succeeded'&&r.stage!=='completed'||isError&&r.status!=='failed')throw new EvidenceProtocolError('MCP_STATUS_CONTRADICTION');
  validateFileReceipt(envelope!,request,r);
  return {receipt:structuredClone(r),result:envelope!.result};
}
export function receiptOutcome(r:ExecutionReceipt):'failed_before_dispatch'|'committed_observation_failed'|'unknown'{
  if(r.stage==='not_dispatched'&&!r.native_invoked)return 'failed_before_dispatch';
  if(r.native_acknowledged&&r.stage==='observation_failed')return 'committed_observation_failed';
  return 'unknown';
}
export function legacyObservedResult(name:string,value:unknown,receipt:ExecutionReceipt):unknown{
  if(['draw_line','draw_circle','draw_text'].includes(name)){
    const n=Number(value);if(typeof value!=='number'||!Number.isSafeInteger(n)||n<=0||!receipt.affected_entities.created.includes(String(value)))throw new EvidenceProtocolError('MCP_CREATED_ENTITY_MISMATCH');
    return `${name} ok, object_id=${n}`;
  }
  if(name==='new_drawing'&&(typeof value!=='string'||!value))throw new EvidenceProtocolError('MCP_NEW_DOCUMENT_LABEL_INVALID');
  if(name==='save_drawing')return 'saved';
  return value;
}
