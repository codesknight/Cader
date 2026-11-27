import type {ProgressiveTrace} from '@cader/config';
import type {CheckResult} from './quality.js';
type Box=[[number,number],[number,number]];
type Frame={point:(p:number[])=>number[];box:(b:Box)=>Box};
export type DraftCadTrace={id:string;kind:'path';points:number[][];closed:boolean}|{id:string;kind:'circle';center:number[];radius:number}|{id:string;kind:'text';text:string;bounds:Box;max_text_height:number};
export function draftCadTrace(trace:ProgressiveTrace,frame:Frame,content:Box):DraftCadTrace{
  if(trace.kind==='path')return {id:trace.id,kind:'path',points:trace.points.map(frame.point),closed:trace.closed};
  if(trace.kind==='circle')return {id:trace.id,kind:'circle',center:frame.point(trace.center),radius:Number((trace.radius*1000/(content[1][0]-content[0][0])).toFixed(3))};
  const bounds=frame.box(trace.bounds),height=bounds[1][1]-bounds[0][1],width=bounds[1][0]-bounds[0][0];
  return {id:trace.id,kind:'text',text:trace.text,bounds,max_text_height:Number(Math.min(height*0.7,width/(Math.max(1,[...trace.text].length)*0.9)).toFixed(3))};
}
const near=(a:number[],b:number[],tol=0.015)=>Math.hypot(a[0]!-b[0]!,a[1]!-b[1]!)<=tol;
const literal=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'');
function segments(trace:Extract<DraftCadTrace,{kind:'path'}>){
  const points=trace.closed&&!near(trace.points[0]!,trace.points.at(-1)!)?[...trace.points,trace.points[0]!]:trace.points;
  return points.slice(1).map((point,i)=>[points[i]!,point]).filter(([a,b])=>!near(a!,b!,1e-5));
}
/** A partial source contract admits only independently agreed geometry. It does
 * not authorize tracing guessed content while semantic inspection is pending. */
export function validateDraftOperation(name:string,a:Record<string,any>,traces:DraftCadTrace[]){
  const tool=name.split('__').at(-1)!;
  if(!tool.startsWith('draw_'))return;
  let valid=false;
  if(tool==='draw_line')valid=traces.some(t=>t.kind==='path'&&segments(t).some(([p,q])=>near(p!,[a.start_x,a.start_y])&&near(q!,[a.end_x,a.end_y])||near(q!,[a.start_x,a.start_y])&&near(p!,[a.end_x,a.end_y])));
  if(tool==='draw_circle')valid=traces.some(t=>t.kind==='circle'&&near(t.center,[a.center_x,a.center_y])&&Math.abs(t.radius-a.radius)<=0.015);
  if(tool==='draw_text')valid=traces.some(t=>t.kind==='text'&&literal(t.text)===literal(String(a.text))&&a.height>0&&a.height<=t.max_text_height+0.015&&a.position_x>=t.bounds[0][0]-0.015&&a.position_x<=t.bounds[1][0]+0.015&&a.position_y>=t.bounds[0][1]-0.015&&a.position_y<=t.bounds[1][1]+0.015);
  if(!valid)throw new Error('VERIFIED_DRAFT_TRACE_REQUIRED');
}
/** COM's summary does not expose polyline vertices, so draft path segments use
 * independently readable AcDbLine endpoints, never a bounding-box substitute. */
export function verifyDraftGeometry(traces:DraftCadTrace[],entities:Record<string,any>[]):CheckResult[]{
  return traces.map(t=>{
    const pass=t.kind==='path'?segments(t).every(([p,q])=>entities.some(e=>e.type==='AcDbLine'&&Array.isArray(e.start_point)&&Array.isArray(e.end_point)&&(near(p!,e.start_point)&&near(q!,e.end_point)||near(q!,e.start_point)&&near(p!,e.end_point)))):
      t.kind==='circle'?entities.some(e=>e.type==='AcDbCircle'&&Array.isArray(e.center)&&near(t.center,e.center)&&Math.abs(t.radius-e.radius)<=0.015):
      entities.some(e=>typeof e.text_string==='string'&&literal(e.text_string)===literal(t.text)&&e.bounding_box&&e.bounding_box.min[0]>=t.bounds[0][0]-2&&e.bounding_box.min[1]>=t.bounds[0][1]-2&&e.bounding_box.max[0]<=t.bounds[1][0]+2&&e.bounding_box.max[1]<=t.bounds[1][1]+2);
    return {id:'draft_'+t.id,status:pass?'pass':'fail',evidence:'Actual native geometry/literal text against two independent source observations; partial only'};
  });
}
