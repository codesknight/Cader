import { createHash,randomUUID } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { resolve,dirname,extname } from 'node:path';
import { workspacePath } from '@cader/config';
import type { ExecutionSession,Approval } from './execution.js';

const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export interface UserQualityReview {version:1;task_id:string;manifest_sha256:string;artifact:{path:string;sha256:string};source_sha256:string|null;image_sha256:string|null;at:string;comment:string;receipt_path:string;scope:'delivered_DWG_only';source:'interactive_user_confirmation'}
async function inspect(workspace:string,path:string){
  const manifest=await workspacePath(workspace,path),raw=await readFile(manifest,'utf8');
  const saved=JSON.parse(raw),artifact=saved.artifact??saved.execution?.artifact;
  if(!saved.task_id||!saved.plan||!artifact?.path||!artifact.sha256)throw new Error('HUMAN_REVIEW_ARTIFACT_REQUIRED');
  if(artifact.file_contract&&artifact.file_verification?.status!=='verified')throw new Error('HUMAN_REVIEW_FILE_VERIFICATION_REQUIRED');
  if(saved.execution?.frozen||saved.execution?.operations?.some((op:{outcome:string;tool?:string;stage?:string})=>op.outcome==='unknown'||op.outcome==='committed_observation_failed'&&!(op.tool==='export_current_view'&&op.stage==='capture_restored')))throw new Error('HUMAN_REVIEW_UNCERTAIN_WRITE_DENIED');
  if(!saved.execution?.operations?.some((op:{tool:string;outcome:string})=>op.tool==='new_drawing'&&op.outcome==='committed')||saved.execution.operations.at(-1)?.tool!=='save_drawing'||saved.execution.operations.at(-1)?.outcome!=='committed')throw new Error('HUMAN_REVIEW_CONFIRMED_SAVE_REQUIRED');
  if(saved.reference_task&&saved.reference_observation?.valid!==true)throw new Error('HUMAN_REVIEW_SOURCE_VALIDATION_REQUIRED');
  if(!Array.isArray(saved.checks)||saved.plan.requirements.some((r:{id:string;check:string})=>r.check!=='visual'&&!saved.checks.some((c:{id:string;status:string})=>c.id===r.id&&c.status==='pass'))||saved.checks.some((c:{id:string;status:string})=>{
    const kind=saved.plan.requirements.find((r:{id:string})=>r.id===c.id)?.check;
    return c.status!=='pass'&&kind!=='visual'&&c.id!=='visual_uncertainty';
  }))throw new Error('HUMAN_REVIEW_DETERMINISTIC_CHECKS_REQUIRED');
  const file=resolve(artifact.path),bytes=await readFile(file),actual=sha(bytes);
  if(extname(file).toLowerCase()!=='.dwg'||!/^AC10\d\d/.test(bytes.subarray(0,6).toString('ascii')))throw new Error('HUMAN_REVIEW_DWG_REQUIRED');
  if(actual!==artifact.sha256)throw new Error('HUMAN_REVIEW_ARTIFACT_CHANGED');
  const source=saved.reference_task?.image;
  if(source&&sha(await readFile(await workspacePath(workspace,source.path)))!==source.sha256)throw new Error('HUMAN_REVIEW_SOURCE_CHANGED');
  const image=saved.visual?.evidence;
  if(image?.capture_receipt?.file_path&&sha(await readFile(await workspacePath(workspace,image.capture_receipt.file_path)))!==image.sha256)throw new Error('HUMAN_REVIEW_IMAGE_CHANGED');
  return {saved,manifest,manifest_sha256:sha(raw),artifact:{path:file,sha256:actual},source_sha256:source?.sha256??null,image_sha256:saved.visual?.evidence?.sha256??null};
}
export async function userReviewStatus(workspace:string,path:string,review:UserQualityReview|null|undefined){
  if(!review)return {accepted:false,reason:'NO_USER_REVIEW'};
  try{
    const now=await inspect(workspace,path);
    const receipt=JSON.parse(await readFile(await workspacePath(workspace,review.receipt_path),'utf8'));
    if(JSON.stringify(receipt)!==JSON.stringify(review))throw new Error('HUMAN_REVIEW_RECEIPT_CHANGED');
    const valid=review.source==='interactive_user_confirmation'&&review.scope==='delivered_DWG_only'&&review.task_id===now.saved.task_id&&review.manifest_sha256===now.manifest_sha256&&review.artifact.path===now.artifact.path&&review.artifact.sha256===now.artifact.sha256&&review.source_sha256===now.source_sha256&&review.image_sha256===now.image_sha256;
    return {accepted:valid,reason:valid?'ACCEPTED_BY_USER':'REVIEW_BINDING_CHANGED',review};
  }catch(error){return {accepted:false,reason:(error as Error).message,review};}
}
/** User-only entry; deliberately absent from the model tool registry. It grants
 * no write authority and never changes the original automatic quality record. */
export async function acceptQualityByUser(workspace:string,path:string,owner:ExecutionSession,confirm:Approval|undefined,comment='已人工检查，确认本任务DWG符合需求'):Promise<UserQualityReview>{
  comment=owner.clean(comment);
  if(owner.facts().frozen)throw new Error('HUMAN_REVIEW_WRITE_BARRIER_DENIED');
  const before=await inspect(workspace,path);
  if(!comment.trim()||comment.length>800)throw new Error('HUMAN_REVIEW_COMMENT_INVALID');
  if(!await confirm?.(`人工图纸复核（不解除写屏障、不授予CAD写权）\n任务：${before.saved.task_id}\nDWG：${before.artifact.path}\nSHA-256：${before.artifact.sha256}\n未通过的自动视觉条件：${JSON.stringify(before.saved.checks.filter((c:{status:string})=>c.status!=='pass'))}\n请实际查看该文件，确认符合原始需求后批准；模型判断和文件摘要不是人工检查的替代。\n复核说明：${comment}`,workspace))throw new Error('HUMAN_REVIEW_NOT_CONFIRMED');
  const after=await inspect(workspace,path);
  if(owner.facts().frozen||JSON.stringify([before.manifest_sha256,before.artifact,before.source_sha256])!==JSON.stringify([after.manifest_sha256,after.artifact,after.source_sha256]))throw new Error('HUMAN_REVIEW_CHANGED_DURING_CONFIRMATION');
  const receipt_path=resolve(dirname(after.manifest),`user-review-${randomUUID()}.json`);
  const review:UserQualityReview={version:1,task_id:after.saved.task_id,manifest_sha256:after.manifest_sha256,artifact:after.artifact,source_sha256:after.source_sha256,image_sha256:after.image_sha256,at:new Date().toISOString(),comment,receipt_path,scope:'delivered_DWG_only',source:'interactive_user_confirmation'};
  await writeFile(receipt_path,JSON.stringify(review,null,2),{flag:'wx',mode:0o600});return review;
}

export async function userReviewCandidate(workspace:string,path:string){const v=await inspect(workspace,path);return {task_id:v.saved.task_id,artifact:v.artifact,unmet_visual:v.saved.checks.filter((c:{status:string})=>c.status!=='pass')};}
