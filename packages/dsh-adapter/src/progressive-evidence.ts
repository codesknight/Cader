import {createHash} from 'node:crypto';
import {readReferenceImage,progressiveDraftSchema,parseProgressiveDraft} from '@cader/config';
import type {ProgressiveTrace,ProgressiveDraftData} from '@cader/config';
import type {ToolDefinition} from '@deepseek-ai/dsh-tools';
import type {ImageView} from './image-view.js';
import {sourceCoordinates,sourceRegionView} from './source-coordinates.js';
type Box=[[number,number],[number,number]];
type Run=(profile:string,instruction:string,request:{image:string;imageView:ImageView;observationFrame:Box;independentEvidence:boolean;taskState:()=>unknown;signal?:AbortSignal;skill:string;skillResource:string;onlyTools:string[];extraTools:ToolDefinition[];maxModelSteps:number;maxImageViews:number;resultText:()=>string|undefined})=>Promise<{id:string;status:string;errorCode?:string}>;
/** Independent bounded geometric observations can release a PARTIAL draft,
 * never masquerade as a complete semantic/netlist Reference Gate pass. */
export async function inspectProgressiveDraft(run:Run,profile:string,root:string,path:string,scope:{id:string;bounds:Box},task:string,signal?:AbortSignal,reserve:()=>void=()=>{}){
  const image=await readReferenceImage(root,path),sha256=createHash('sha256').update(image.data).digest('hex');
  const [a,b]=scope.bounds,view=sourceRegionView(scope.bounds,image);
  const readings:ProgressiveDraftData[]=[],attempts:{id:string;status:string;error_code?:string}[]=[];
  for(let pass=0;pass<2;pass++){
    signal?.throwIfAborted();reserve();let observation:ProgressiveDraftData|undefined;
    const schema=structuredClone(progressiveDraftSchema);schema.properties.coordinate_system={type:'string',const:'normalized-crop-top-left-y-down'};
    const tool:ToolDefinition={name:'cader_submit_verified_draft_observation',description:'Observe at most 12 actually clear paths, complete circles or literal labels in this BASE source crop. Submit normalized BASE crop coordinates; Harness converts to original source. Partial evidence only; unknown content remains omitted.',parameters:schema,output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(args,exec){
      const local=parseProgressiveDraft(args);if(local.coordinate_system!=='normalized-crop-top-left-y-down')throw new Error('DRAFT_CROP_FRAME_REQUIRED');
      const value=parseProgressiveDraft(sourceCoordinates(local,scope.bounds,'to-source')),inside=(p:number[])=>p.every((x,i)=>x>=a[i]!-1e-6&&x<=b[i]!+1e-6);
      if(new Set(value.traces.map(t=>t.id)).size!==value.traces.length||value.traces.some(t=>t.kind==='path'?t.points.some(p=>!inside(p)):t.kind==='text'?!inside(t.bounds[0])||!inside(t.bounds[1]):!inside([t.center[0]-t.radius,t.center[1]-t.radius*image.width/image.height])||!inside([t.center[0]+t.radius,t.center[1]+t.radius*image.width/image.height])))throw new Error('DRAFT_TRACE_OUTSIDE_SCOPE');
      observation=value;exec.concludeTurn();return JSON.stringify(value);
    }};
    // Compare the same bounded features, rather than two arbitrary subsets of
    // a dense crop. Candidates are untrusted hypotheses, never expected truth.
    const candidates=pass===1?sourceCoordinates(readings[0],scope.bounds,'to-crop'):undefined;
    const review=candidates?'\n这是独立像素复核。下面候选均是不可信假设，不是答案。逐项对照实际BASE裁片，报告确实有像素证据的同一特征；错误坐标须更正，不可辨认或不存在的候选放入omitted。不得照抄以求一致，不另选无关的12个特征；不必凑足数量。候选：'+JSON.stringify(candidates):'';
    const result=await run(profile,'当前只做有界局部几何观察，不清点整图器件，不追网、不按功能补画。独立观察实际原图裁片，调用cader_submit_verified_draft_observation，只报告最多12个确实可见且清晰的直线/折线路径、完整圆或文字；无法判断的组件/标签/连接必须留在omitted，coverage必须为partial。所有点必须为当前BASE裁片0..1局部坐标，coordinate_system=normalized-crop-top-left-y-down；程序做统一整图变换，禁止自行手算整图偏移。circle.radius按当前BASE裁片宽度归一化，不猜物理尺寸。路径忠于实际像素，不能把圆弧当直线或把不确定符号归为常见器件。此记录只允许部分待验稿，不代表整区或整图已识别；勿虚构完整覆盖。'+JSON.stringify({task,scope:{id:scope.id,base_crop_original_pixels:view.crop},original_width:image.width,original_height:image.height})+review,{independentEvidence:true,taskState:()=>({phase:'reference',source_sha256:sha256,region:scope.id,evidence_scope:'Independent BASE pixel observation; no prior CAD or task reviews'}),image:path,imageView:view,observationFrame:scope.bounds,signal,skill:'progressive-drawing',skillResource:'source-observation',onlyTools:[tool.name,'cader_view_image'],extraTools:[tool],maxModelSteps:3,maxImageViews:1,resultText:()=>observation?JSON.stringify(observation):undefined});
    attempts.push({id:result.id,status:result.status,error_code:result.errorCode});if(!observation||result.status!=='succeeded')break;readings.push(observation);
  }
  const again=await readReferenceImage(root,path);if(createHash('sha256').update(again.data).digest('hex')!==sha256)throw new Error('REFERENCE_CHANGED_RESELECT_REQUIRED');
  const tolerance=0.002,used=new Set<number>(),agreements:{trace:ProgressiveTrace;independent_id:string}[]=[];
  for(const trace of readings[0]?.traces??[]){const index=readings[1]?.traces.findIndex((other,i)=>!used.has(i)&&trace.certainty==='clear'&&other.certainty==='clear'&&sameTrace(trace,other,tolerance))??-1;
    if(index>=0){used.add(index);agreements.push({trace,independent_id:readings[1]!.traces[index]!.id});}}
  return {valid:readings.length===2&&agreements.length>0,coverage:'partial' as const,scope,source_sha256:sha256,readings,agreements,attempts,tolerance,completion:'Still requires complete source reconstruction, regional and global independent acceptance'};
}
export function sameTrace(a:ProgressiveTrace,b:ProgressiveTrace,tolerance:number){
  const near=(p:number[],q:number[])=>Math.hypot(p[0]!-q[0]!,p[1]!-q[1]!)<=tolerance;
  if(a.kind==='circle'&&b.kind==='circle')return near(a.center,b.center)&&Math.abs(a.radius-b.radius)<=tolerance;
  if(a.kind==='text'&&b.kind==='text')return a.text.normalize('NFKC').replace(/\s+/g,'')===b.text.normalize('NFKC').replace(/\s+/g,'')&&near(a.bounds[0],b.bounds[0])&&near(a.bounds[1],b.bounds[1]);
  if(a.kind==='path'&&b.kind==='path'&&a.closed===b.closed&&a.points.length===b.points.length){
    const orders=[b.points,[...b.points].reverse()];return orders.some(points=>Array.from({length:a.closed?points.length:1},(_,i)=>i).some(offset=>a.points.every((p,i)=>near(p,points[(i+offset)%points.length]!))));
  }
  return false;
}
