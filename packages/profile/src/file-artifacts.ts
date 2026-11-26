import {readFile,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import type {ComFileArtifact,VerificationDocument,VerificationQuery} from '@cader/dsh-adapter';

export interface FileVerificationEvidence {status:'verified';contract:'autocad-verification-query/1';geometry_scope:'legacy_summary_partial';snapshot_revision:null;document:VerificationDocument;entity_count:number;summary_sha256:string;checked_at:string;verification:'hash-identical readonly DWG reopen and supported summary comparison; full geometry/semantic verifier remains separate'}
export interface LocalArtifact {path:string;bytes:number;sha256:string;requested_path?:string;file_contract?:ComFileArtifact;file_verification?:FileVerificationEvidence}
export const filePathKey=(path:string)=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
export async function verifyArtifactBytes(path:string,expected:{sha256:string;byte_size:number}){
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||filePathKey(await realpath(path))!==filePathKey(path))throw new Error('DWG_ARTIFACT_PATH_INVALID');
  const bytes=await readFile(path);
  if(!/^AC10\d\d/.test(bytes.subarray(0,6).toString('ascii'))||bytes.length!==expected.byte_size||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw new Error('DWG_ARTIFACT_FINGERPRINT_MISMATCH');
}
export function verifyReopenBinding(saved:ComFileArtifact,doc:VerificationDocument){
  const inside=relative(dirname(saved.path),resolve(doc.path));
  if(doc.instance_id!==saved.instance_id||doc.source_document_id!==saved.source_document_id||doc.document_id===saved.source_document_id||doc.source_artifact_id!==saved.artifact_id||doc.sha256!==saved.sha256||doc.byte_size!==saved.byte_size||!inside||inside.startsWith('..')||resolve(doc.path)===resolve(saved.path))throw new Error('DWG_READONLY_BINDING_MISMATCH');
}
/** Compare exactly the fields the COM summary actually returns. IDs are scoped
 * to separate documents and cannot be compared. Missing/different fields fail;
 * matching partial data never claims full DWG semantic equivalence. */
export function summaryFingerprint(value:unknown):string{
  if(!Array.isArray(value))throw new Error('DWG_ENTITY_SUMMARY_REQUIRED');
  const normalize=(v:any):any=>typeof v==='number'?(Number.isFinite(v)?Number(v.toFixed(7)):(()=>{throw new Error('DWG_NONFINITE_SUMMARY');})()):Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])])):v;
  const rows=value.map(row=>{
    if(!row||typeof row!=='object'||!Number.isSafeInteger(row.object_id)||row.object_id<=0||typeof row.type!=='string'||typeof row.layer!=='string')throw new Error('DWG_ENTITY_SUMMARY_INVALID');
    const {object_id,...rest}=row;return JSON.stringify(normalize(rest));
  }).sort();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
export function verifyQueryBinding(saved:ComFileArtifact,doc:VerificationDocument,query:VerificationQuery){
  verifyReopenBinding(saved,doc);
  for(const key of ['instance_id','document_id','source_document_id','source_artifact_id','path','sha256','byte_size'] as const)
    if(query[key]!==doc[key])throw new Error('DWG_VERIFICATION_QUERY_BINDING_MISMATCH');
}
