import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readReferenceImage, workspacePath } from '@cader/config';
import type { ReferenceObservationData } from '@cader/config';

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
    visible_text:source.visible_text.map(t=>({...t,bounds:box(t.bounds)})),connections:source.nets?.length?[]:source.connections,nets:source.nets,unknowns:source.unknowns};
}
