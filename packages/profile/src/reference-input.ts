import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readReferenceImage, workspacePath, sourceBodyMarginOverlapMax } from '@cader/config';
import type { ReferenceObservationData,QualityPlan } from '@cader/config';

export interface ReferenceTask {
  request: string;
  image: { path:string; sha256:string; width:number; height:number };
  outputPath: string;
  freshDrawing: true;
}
const imageExtension = /\.(?:png|jpe?g)$/i;

/** Only explicit file names/paths in the user's text are capabilities. No search. */
export function referencedPaths(text:string, extensions='png|jpe?g') {
  const result:string[]=[];
  const quoted=new RegExp('["“]([^"”\\r\\n]+\\.(?:'+extensions+'))["”]','gi');
  for(const match of text.matchAll(quoted))result.push(match[1]!);
  const absolute=new RegExp('(?<![a-z0-9])[a-z]:[\\\\/][^\\s"<>|?*\\r\\n]*?\\.(?:'+extensions+')(?=$|[\\s，。；;：:！!？?)）])','gi');
  for(const match of text.matchAll(absolute))result.push(match[0]);
  const relative=new RegExp('(?:^|[\\s：:，,])@?((?:\\.{1,2}[\\\\/])?(?:[^\\s"<>|?*：:,，。；;()（）]+[\\\\/])*[^\\s"<>|?*：:,，。；;()（）\\\\/]+\\.(?:'+extensions+'))(?=$|[\\s，。；;！!？?)）])','gi');
  for(const match of text.matchAll(relative))if(!result.some(path=>path.endsWith(match[1]!))&&!/^https?:/i.test(match[1]!))result.push(match[1]!);
  return [...new Set(result)];
}
export function wantsRedraw(text:string) {
  return !/^(?:为什么|为何|如何|怎么|查看|有什么功能|能画什么)/.test(text.trim()) &&
    /复现|重绘|临摹|重建|描绘|绘制|绘图|画|生成.*(?:图|dwg)|\bredraw\b|\btrace\b|\bdraw\b|\breproduce\b|\brecreate\b/i.test(text);
}

/** An explicitly selected external image is copied as an immutable asset. This
 * does not widen the workspace, shell scope or agent file access. */
export async function importReferenceImage(workspace:string, path:string) {
  const source=resolve(workspace,path);
  if(!imageExtension.test(source)||source.startsWith('\\\\'))throw new Error('LOCAL_REFERENCE_IMAGE_REQUIRED');
  const info=await lstat(source);
  if(!info.isFile()||info.isSymbolicLink()||info.size===0||info.size>64*1024*1024)throw new Error('REFERENCE_SIZE_OR_TYPE');
  const canonical=await realpath(source);
  const image=await readReferenceImage(dirname(canonical),basename(canonical));
  const sha256=createHash('sha256').update(image.data).digest('hex');
  await mkdir(resolve(workspace,'.cader'),{recursive:true});
  const base=await workspacePath(workspace,'.cader');
  await mkdir(resolve(base,'references'),{recursive:true});
  const directory=await workspacePath(base,'references');
  const target=resolve(directory,sha256+extname(canonical).toLowerCase());
  try{await writeFile(target,image.data,{flag:'wx',mode:0o600});}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const checked=await readFile(await workspacePath(workspace,target));
  if(createHash('sha256').update(checked).digest('hex')!==sha256)throw new Error('REFERENCE_ASSET_CHANGED');
  return {path:target,kind:'image' as const,sha256,bytes:image.data.length,width:image.width,height:image.height};
}
export function referenceOutput(workspace:string, text:string, source:string) {
  const explicit=referencedPaths(text,'dwg');
  if(explicit.length>1)throw new Error('ONE_DWG_OUTPUT_REQUIRED');
  const selected=explicit[0];
  return selected?resolve(workspace,selected):resolve(workspace,`${basename(source,extname(source))}-redraw-${randomUUID().slice(0,8)}.dwg`);
}
/** Consistent image-y-down -> CAD-y-up hints, never physical measurements or a
 * hard-coded drawing plan. Actual geometry still comes from the Agent. */
export function referenceLayoutHints(source:ReferenceObservationData,image:{width:number;height:number}){
  const [low,high]=source.content_bounds,scale=1000/(high[0]-low[0]);
  const point=(p:number[])=>[Number(((p[0]!-low[0])*scale).toFixed(3)),Number(((high[1]-p[1]!)*scale*image.height/image.width).toFixed(3))];
  const box=(b:number[][])=>[point([b[0]![0]!,b[1]![1]!]),point([b[1]![0]!,b[0]![1]!])];
  return {coordinate_system:'CAD XY: x right, y UP. Relative layout units, not physical dimensions.',
    objects:source.objects.map(o=>({...o,bounds:box(o.bounds),terminals:o.terminals.map(point),indexed_terminals:o.terminals.map((p,index)=>({index,position:point(p)}))})),
    visible_text:source.visible_text.map(t=>{const bounds=box(t.bounds),width=bounds[1]![0]!-bounds[0]![0]!,height=bounds[1]![1]!-bounds[0]![1]!;
      return {...t,bounds,text_layout:{anchor:bounds[0],target_width:width,target_height:height,max_text_height:Number(Math.min(height*0.7,width/(Math.max(1,[...t.text].length)*0.9)).toFixed(3)),note:'Source label box is a placement/size guide, not a point at the component centre. Fit native text inside this box; check actual bounding_box after writing.'}};
    }),connections:source.nets?.length?[]:source.connections,nets:source.nets,unknowns:source.unknowns};
}

/** Reuse model-observed source facts as a semantic layout, never CAD operations.
 * Source coordinates are approximate image locations; project interior terminals
 * to the nearest symbol boundary and record every adjustment before approval. */
export function sourcePlanLayout(source:ReferenceObservationData,image:{width:number;height:number}){
  const hints=referenceLayoutHints(source,image),normalized_ports:{component:string;terminal:number;original:number[];planned:number[]}[]=[];
  const bodies=hints.objects.filter(o=>o.terminals.length).map(o=>({...o,bounds:o.bounds.map(p=>[...p])}));
  const normalized_bounds:{components:string[];axis:number;overlap:number;boundary:number}[]=[];
  // Source boxes are approximate observations. Resolve only narrow touching
  // margins in the layout, without translating symbols or changing the frame.
  // Material overlaps still require a new source observation.
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    const a=bodies[i]!,b=bodies[j]!;
    const overlaps=[0,1].map(axis=>Math.min(a.bounds[1]![axis]!,b.bounds[1]![axis]!)-Math.max(a.bounds[0]![axis]!,b.bounds[0]![axis]!));
    if(overlaps.some(v=>v<=0))continue;
    const options=[0,1].map(axis=>({axis,ratio:overlaps[axis]!/Math.min(a.bounds[1]![axis]!-a.bounds[0]![axis]!,b.bounds[1]![axis]!-b.bounds[0]![axis]!)})).sort((x,y)=>x.ratio-y.ratio);
    const {axis,ratio}=options[0]!;
    if(ratio>sourceBodyMarginOverlapMax)throw new Error('SOURCE_SYMBOL_BOUNDS_OVERLAP: materially overlapping observed symbol bodies need a new source inspection');
    const [left,right]=(a.bounds[0]![axis]!+a.bounds[1]![axis]!)<(b.bounds[0]![axis]!+b.bounds[1]![axis]!)?[a,b]:[b,a];
    const boundary=Number(((left.bounds[1]![axis]!+right.bounds[0]![axis]!)/2).toFixed(3));
    left.bounds[1]![axis]=boundary;right.bounds[0]![axis]=boundary;
    normalized_bounds.push({components:[left.id,right.id],axis,overlap:overlaps[axis]!,boundary});
  }
  const components:QualityPlan['components']=bodies.map(o=>{
    // OCR terminals may denote distant wire junctions. Expanding the symbol's
    // forbidden interior to those junctions can swallow adjacent components.
    // Keep the observed body box and project each terminal to its closest edge.
    const bounds:[[number,number],[number,number]]=[[o.bounds[0]![0]!,o.bounds[0]![1]!],[o.bounds[1]![0]!,o.bounds[1]![1]!]];
    const ports=o.terminals.map((p,terminal):[number,number]=>{
      const clamp=(v:number,axis:number)=>Math.max(bounds[0][axis]!,Math.min(bounds[1][axis]!,v));
      const candidates:[number,number][]=[[bounds[0][0],clamp(p[1]!,1)],[bounds[1][0],clamp(p[1]!,1)],[clamp(p[0]!,0),bounds[0][1]],[clamp(p[0]!,0),bounds[1][1]]];
      const q=candidates.sort((a,b)=>Math.hypot(a[0]-p[0]!,a[1]-p[1]!)-Math.hypot(b[0]-p[0]!,b[1]-p[1]!))[0]!;
      if(Math.hypot(q[0]-p[0]!,q[1]-p[1]!)>1e-6)normalized_ports.push({component:o.id,terminal,original:p,planned:q});
      return q;
    });
    return {id:o.id,source_id:o.id,kind:o.kind.slice(0,64),bounds,ports,pin_names:ports.map((_,i)=>`p${i}`),source_terminals:ports.map((_,i)=>i)};
  });
  const nets:NonNullable<QualityPlan['nets']>=(source.nets??[]).map(n=>({id:n.id,pins:n.pins.map(p=>({component:p.object,pin:`p${p.terminal}`}))}));
  return {components,nets,normalized_ports,normalized_bounds};
}

/** A custom reference plan must share one source-to-CAD frame. Fit the whole
 * scene, never separately translate a label or silently relocate a component. */
export function referencePlanHints(source:ReferenceObservationData,image:{width:number;height:number},plan:QualityPlan){
  const hints=referenceLayoutHints(source,image),canonical=sourcePlanLayout(source,image);
  const pairs=plan.components.map(c=>({target:c,source:canonical.components.find(o=>o.source_id===c.source_id)}));
  if(!pairs.length||pairs.some(p=>!p.source)||new Set(pairs.map(p=>p.source!.source_id)).size!==canonical.components.length)throw new Error('SOURCE_LAYOUT_FRAME_MISMATCH: all source components need one coordinate mapping; use source_layout:true');
  const axes=[0,1].map(axis=>{
    const values=pairs.flatMap(p=>[0,1].map(side=>({s:p.source!.bounds[side]![axis]!,t:p.target.bounds[side]![axis]!})));
    const sm=values.reduce((s,p)=>s+p.s,0)/values.length,tm=values.reduce((s,p)=>s+p.t,0)/values.length;
    const variance=values.reduce((s,p)=>s+(p.s-sm)**2,0);
    if(variance<=1e-12)throw new Error('SOURCE_LAYOUT_FRAME_DEGENERATE');
    const scale=values.reduce((s,p)=>s+(p.s-sm)*(p.t-tm),0)/variance,offset=tm-scale*sm;
    const span=Math.max(...values.map(p=>p.t))-Math.min(...values.map(p=>p.t));
    const tolerance=Math.max(0.01,span*0.04);
    if(!Number.isFinite(scale)||scale<=0||values.some(p=>Math.abs(p.s*scale+offset-p.t)>tolerance))throw new Error('SOURCE_LAYOUT_FRAME_MISMATCH: custom component bounds drift from a shared source frame; use source_layout:true or a consistent global scale/translation');
    for(const pair of pairs)pair.target.ports.forEach((port,i)=>{
      const original=pair.source!.ports[pair.target.source_terminals![i]!]!;
      if(!original||Math.abs(original[axis]!*scale+offset-port[axis]!)>tolerance)throw new Error('SOURCE_LAYOUT_FRAME_MISMATCH: source terminal and planned port frames differ');
    });
    return {scale,offset,tolerance};
  });
  const point=(p:number[])=>p.map((v,i)=>i<2?Number((v*axes[i]!.scale+axes[i]!.offset).toFixed(3)):v);
  const box=(b:number[][])=>b.map(point);
  return {...hints,frame:{kind:'source-global-axis-transform',axes},objects:hints.objects.map(o=>({...o,bounds:box(o.bounds),terminals:o.terminals.map(point),indexed_terminals:o.indexed_terminals.map(t=>({...t,position:point(t.position)}))})),
    visible_text:hints.visible_text.map(t=>{const bounds=box(t.bounds),width=bounds[1]![0]!-bounds[0]![0]!,height=bounds[1]![1]!-bounds[0]![1]!;return {...t,bounds,text_layout:{...t.text_layout,anchor:bounds[0],target_width:width,target_height:height,max_text_height:Number(Math.min(height*0.7,width/(Math.max(1,[...t.text].length)*0.9)).toFixed(3))}};})};
}
