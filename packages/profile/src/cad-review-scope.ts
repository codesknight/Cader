import {createHash} from 'node:crypto';
import type {CadReviewView,ImageView} from '@cader/dsh-adapter';
import {sourceRegionView,clipSourceView} from '@cader/dsh-adapter';
import type {DraftCadTrace} from './progressive-draft.js';
import {draftEntityTraces} from './progressive-draft.js';
type Box=[[number,number],[number,number]];
type Entity=Record<string,any>;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** A background entity crossing a local plot edge does not clip the declared
 * targets. This exception requires the verified native window, not pixel
 * guesses, and does not replace either target visibility or geometry checks. */
export function scopedNativeWindowContainsTargets(evidence:unknown):boolean{
  const e=evidence as any,scope=e?.review_scope,request=e?.view_request,proof=e?.view_evidence;
  const window=request?.world_window;
  if(!scope||!['affected-batch','draft-subset','complete-region','source-window'].includes(scope.mode)||!proof?.configuration_verified||proof.projection!=='WCS_XY_TOP'||!Array.isArray(window)||window.length!==4||!window.every(Number.isFinite)||window[0]>=window[2]||window[1]>=window[3])return false;
  for(const other of [scope.view?.world_window,proof.world_window])if(!Array.isArray(other)||other.length!==4||other.some((v:number,i:number)=>!Number.isFinite(v)||Math.abs(v-window[i])>1e-7))return false;
  if(!Array.isArray(scope.targets)||!scope.targets.length||!Array.isArray(scope.entity_ids)||scope.entity_ids.length!==scope.targets.length||new Set(scope.entity_ids).size!==scope.targets.length||new Set(scope.targets.map((t:any)=>t.entity_id)).size!==scope.targets.length)return false;
  if(scope.mode==='source-window'){
    const image=scope.source_window?.image,crop=scope.view?.sourceView?.crop;
    if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<=0||image.height<=0||!crop||!scope.source_sha256)return false;
    const expected=[crop.left*1000/image.width,(image.height-crop.top-crop.height)*1000/image.width,(crop.left+crop.width)*1000/image.width,(image.height-crop.top)*1000/image.width];
    if(crop.left<0||crop.top<0||crop.width<=0||crop.height<=0||crop.left+crop.width>image.width||crop.top+crop.height>image.height||window.some((v:number,i:number)=>Math.abs(v-expected[i]!)>1e-7))return false;
    return scope.targets.every((target:any)=>{const box=target.native_geometry?.bounding_box;return scope.entity_ids.includes(target.entity_id)&&target.native_geometry?.object_id===target.entity_id&&Array.isArray(box?.min)&&Array.isArray(box?.max)&&[...box.min.slice(0,2),...box.max.slice(0,2)].every(Number.isFinite)&&box.max[0]>=window[0]&&box.max[1]>=window[1]&&box.min[0]<=window[2]&&box.min[1]<=window[3];});
  }
  return scope.targets.every((target:any)=>{
    const box=target.native_geometry?.bounding_box;
    return scope.entity_ids.includes(target.entity_id)&&target.native_geometry?.object_id===target.entity_id&&Array.isArray(box?.min)&&Array.isArray(box?.max)&&box.min.length>=2&&box.max.length>=2&&[...box.min.slice(0,2),...box.max.slice(0,2)].every(Number.isFinite)&&box.min[0]<=box.max[0]&&box.min[1]<=box.max[1]&&box.min[0]>=window[0]&&box.min[1]>=window[1]&&box.max[0]<=window[2]&&box.max[1]<=window[3];
  });
}

function windowFor(entities:Entity[],fallback:Box,padding=0.08):[number,number,number,number]{
  const boxes=entities.map(e=>e.bounding_box).filter(b=>b&&[...b.min.slice(0,2),...b.max.slice(0,2)].every(Number.isFinite));
  const a=boxes.length?[Math.min(...boxes.map(b=>b.min[0])),Math.min(...boxes.map(b=>b.min[1]))]:fallback[0];
  const b=boxes.length?[Math.max(...boxes.map(b=>b.max[0])),Math.max(...boxes.map(b=>b.max[1]))]:fallback[1];
  const margin=Math.max((b[0]!-a[0]!)*padding,(b[1]!-a[1]!)*padding,0.1);
  return [a[0]!-margin,a[1]!-margin,b[0]!+margin,b[1]!+margin];
}

/** Native plot windows are derived from actual readback, never model pixel
 * guesses. Full supported coordinate checks remain independent of image zoom. */
export function progressiveReviewScope(input:{region:string;mode:'affected-batch'|'draft-subset'|'complete-region'|'source-window';document:unknown;snapshot_hash:string;source_sha256:string|null;entities:Entity[];bounds:Box;image:{width:number;height:number};source_bounds:Box;toSource:(p:number[])=>number[];draft?:DraftCadTrace[];primitiveOnly?:boolean}){
  const sourceView=(w:number[]):ImageView=>{
    const a=input.toSource([w[0]!,w[3]!]),b=input.toSource([w[2]!,w[1]!]);
    const left=Math.floor(a[0]!*input.image.width),top=Math.floor(a[1]!*input.image.height),right=Math.ceil(b[0]!*input.image.width),bottom=Math.ceil(b[1]!*input.image.height);
    if(right<=left||bottom<=top)throw new Error('CAD_REVIEW_SOURCE_WINDOW_INVALID');
    return clipSourceView({crop:{left,top,width:right-left,height:bottom-top}},sourceRegionView(input.source_bounds,input.image));
  };
  const world_window=input.mode==='complete-region'?windowFor([],input.bounds):windowFor(input.entities,input.bounds);
  const view:CadReviewView={world_window,min_long_edge:2048,...(input.source_sha256?{sourceView:sourceView(world_window)}:{})};
  // Whole-window pixels may not resolve small annotation strokes. Request
  // actual native close-ups, not interpolated crops of an extents screenshot.
  const span=Math.max(world_window[2]-world_window[0],world_window[3]-world_window[1]);
  const smallText=input.entities.filter(e=>!e.expected_absent&&typeof e.text_string==='string'&&e.bounding_box&&((e.height??e.bounding_box.max[1]-e.bounding_box.min[1])*2048/span<18)).sort((a,b)=>(a.height??0)-(b.height??0));
  const smallGeometry=input.entities.filter(e=>!e.expected_absent&&typeof e.text_string!=='string'&&e.bounding_box&&Math.max(e.bounding_box.max[0]-e.bounding_box.min[0],e.bounding_box.max[1]-e.bounding_box.min[1])*2048/span<120);
  view.details=[...smallText,...smallGeometry].slice(0,3).map(e=>{const window=windowFor([e],input.bounds,0.25);return {request:{world_window:window,min_long_edge:2048},entity_ids:[e.object_id],...(input.source_sha256?{sourceView:sourceView(window)}:{})};});
  const targets=input.entities.map(e=>({entity_id:e.object_id,type:e.type,expected_absent:Boolean(e.expected_absent),source_trace_ids:input.draft?draftEntityTraces(input.draft,e):[],native_geometry:e,visual_checks:e.expected_absent?['expected_absence']:typeof e.text_string==='string'?['text_readability',input.draft||input.primitiveOnly?'primitive_visibility':'appearance']:[input.draft||input.primitiveOnly?'primitive_visibility':'appearance'],not_checks:['unsubmitted source coverage','unsubmitted components','re-proving native endpoints from plot pixels']}));
  const binding={version:1,mode:input.mode,geometry_only:Boolean(input.draft||input.primitiveOnly),pending_source_attributes:input.draft||input.primitiveOnly?['stroke_weight','fill','color','font_style','complete_source_coverage','complete_topology']:[],region:input.region,document:input.document,snapshot_hash:input.snapshot_hash,source_sha256:input.source_sha256,entity_ids:targets.map(t=>t.entity_id),targets,view};
  return {binding:{...binding,id:hash(binding)},view};
}
