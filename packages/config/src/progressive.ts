import {z} from 'zod';
const point=z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)]);
const box=z.tuple([point,point]).refine(([a,b])=>a[0]<b[0]&&a[1]<b[1]);
const id=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/);
export const ProgressivePlan=z.object({version:z.literal(1),content_bounds:box,units:z.literal('relative-layout-units'),
  regions:z.array(z.object({id,bounds:box,description:z.string().min(1).max(800),depends_on:z.array(id).max(64),priority:z.int().min(0).max(100).optional().describe('Higher priority executes earlier among dependency-ready regions. Prioritize requested drawing content before frames or presentation metadata. Default 50 for legacy plans.')} ).strict()).min(2).max(64),
  anchors:z.array(z.object({id,position:point,regions:z.array(id).min(2).max(4),relation:z.enum(['connected','coincident']).describe('connected is functional network continuity; coincident is geometric continuity such as frames, edges and grids.'),certainty:z.enum(['clear','uncertain']),evidence:z.string().min(1).max(400)}).strict()).max(128)
}).strict().superRefine((v,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  const ids=v.regions.map(r=>r.id);
  if(new Set(ids).size!==ids.length||new Set(v.anchors.map(a=>a.id)).size!==v.anchors.length)fail('PROGRESSIVE_DUPLICATE_ID');
  let area=0;
  for(const [i,r] of v.regions.entries()){
    if(r.bounds[0].some((x,a)=>x<v.content_bounds[0][a]!-1e-8)||r.bounds[1].some((x,a)=>x>v.content_bounds[1][a]!+1e-8))fail('REGION_OUTSIDE_SCOPE');
    area+=(r.bounds[1][0]-r.bounds[0][0])*(r.bounds[1][1]-r.bounds[0][1]);
    if(new Set(r.depends_on).size!==r.depends_on.length||r.depends_on.some(d=>!ids.includes(d)||d===r.id))fail('REGION_DEPENDENCY_INVALID: '+r.id);
    if(v.regions.slice(0,i).some(p=>[0,1].every(a=>Math.min(p.bounds[1][a]!,r.bounds[1][a]!)-Math.max(p.bounds[0][a]!,r.bounds[0][a]!)>1e-8)))fail('REGION_INTERIORS_OVERLAP');
  }
  const visited=new Set<string>(),active=new Set<string>();
  const walk=(name:string)=>{if(active.has(name)){fail('REGION_DEPENDENCY_CYCLE: '+name);return;}if(visited.has(name))return;active.add(name);for(const dep of v.regions.find(r=>r.id===name)?.depends_on??[])walk(dep);active.delete(name);visited.add(name);};
  for(const name of ids)walk(name);
  const expected=(v.content_bounds[1][0]-v.content_bounds[0][0])*(v.content_bounds[1][1]-v.content_bounds[0][1]);
  if(Math.abs(area-expected)>1e-7)fail('REGION_COVERAGE_INCOMPLETE');
  for(const a of v.anchors){
    if(new Set(a.regions).size!==a.regions.length||a.regions.some(id=>!ids.includes(id)))fail('ANCHOR_REGION_INVALID');
    for(const rid of a.regions){const r=v.regions.find(r=>r.id===rid);if(!r)continue;
      if(a.position.some((x,i)=>x<r.bounds[0][i]!-1e-7||x>r.bounds[1][i]!+1e-7)||!a.position.some((x,i)=>Math.min(Math.abs(x-r.bounds[0][i]!),Math.abs(x-r.bounds[1][i]!))<1e-7))fail('ANCHOR_NOT_ON_SHARED_BOUNDARY: '+JSON.stringify({anchor:a.id,position:a.position,region:r.id,region_bounds:r.bounds,action:'Correct the source location or membership: it must lie on a boundary shared by EVERY listed region, not a distant point on the same long wire.'}));
    }
  }
});
export type ProgressivePlanData=z.infer<typeof ProgressivePlan>;
export const progressivePlanSchema=JSON.parse(JSON.stringify(z.toJSONSchema(ProgressivePlan)));
progressivePlanSchema.properties.regions.maxItems=16;
export function parseProgressivePlan(value:unknown){
  const plan=ProgressivePlan.parse(value),ordered:typeof plan.regions=[],seen=new Set<string>();
  const walk=(id:string)=>{if(seen.has(id))return;const region=plan.regions.find(r=>r.id===id)!;for(const dep of region.depends_on)walk(dep);seen.add(id);ordered.push(region);};
  for(const region of [...plan.regions].sort((a,b)=>(b.priority??50)-(a.priority??50)))walk(region.id);plan.regions=ordered;return plan;
}
/** Model chooses cuts and contents; the program derives shared bounds. This is
 * an alternative authoring form, never a repair of an invalid submitted plan. */
const Partition=z.object({version:z.literal(1),content_bounds:box,
  x_cuts:z.array(z.number().min(0).max(1)).max(7),y_cuts:z.array(z.number().min(0).max(1)).max(7),
  regions:z.array(z.object({id,row:z.int().min(0).max(7),column:z.int().min(0).max(7),description:z.string().min(1).max(800),depends_on:z.array(id).max(16),priority:z.int().min(0).max(100)}).strict()).min(2).max(16),
  anchors:ProgressivePlan.shape.anchors
}).strict();
export const progressivePartitionSchema=JSON.parse(JSON.stringify(z.toJSONSchema(Partition)));
export function parseProgressivePartition(value:unknown){
  const p=Partition.parse(value);
  const axes=[p.x_cuts,p.y_cuts].map((cuts,axis)=>{
    const start=p.content_bounds[0][axis]!,end=p.content_bounds[1][axis]!;
    if(cuts.some((cut,i)=>cut<=start||cut>=end||i>0&&cut<=cuts[i-1]!))throw new Error('PARTITION_CUTS_REQUIRE_SORTED_INTERIOR_COORDINATES');
    return [start,...cuts,end];
  });
  const columns=axes[0]!.length-1,rows=axes[1]!.length-1;
  if(columns*rows>16||p.regions.length!==columns*rows)throw new Error('PARTITION_REQUIRES_EVERY_CELL_EXACTLY_ONCE: '+JSON.stringify({rows,columns,expected:rows*columns}));
  const cells=new Set<string>();
  const regions=p.regions.map(({row,column,...region})=>{
    const key=`${row}:${column}`;
    if(row>=rows||column>=columns||cells.has(key))throw new Error('PARTITION_CELL_INVALID_OR_DUPLICATE: '+key);
    cells.add(key);
    return {...region,bounds:[[axes[0]![column]!,axes[1]![row]!],[axes[0]![column+1]!,axes[1]![row+1]!]]};
  });
  return parseProgressivePlan({version:1,content_bounds:p.content_bounds,units:'relative-layout-units',regions,anchors:p.anchors});
}
/** Pixel-aligned shared edges keep outward-rounded crops from introducing
 * different coordinate origins in adjacent regions. No physical scale inferred. */
export function rasterizeProgressivePlan(value:ProgressivePlanData,image:{width:number;height:number}){
  const plan=structuredClone(value),snap=(point:number[])=>point.map((v,i)=>Math.round(v*(i?image.height:image.width))/(i?image.height:image.width)) as [number,number];
  plan.content_bounds=plan.content_bounds.map(snap) as typeof plan.content_bounds;
  plan.regions=plan.regions.map(r=>({...r,bounds:r.bounds.map(snap) as typeof r.bounds}));
  for(const anchor of plan.anchors)for(let axis=0;axis<2;axis++)if(value.regions.some(r=>r.bounds.some(p=>Math.abs(p[axis]!-anchor.position[axis]!)<1e-7)))anchor.position[axis]=snap(anchor.position)[axis]!;
  return parseProgressivePlan(plan);
}
const traceBase={id,evidence:z.string().min(1).max(400),certainty:z.enum(['clear','uncertain'])};
const Trace=z.discriminatedUnion('kind',[
  z.object({...traceBase,kind:z.literal('path'),points:z.array(point).min(2).max(12),closed:z.boolean()}).strict(),
  z.object({...traceBase,kind:z.literal('circle'),center:point,radius:z.number().positive().max(1)}).strict(),
  z.object({...traceBase,kind:z.literal('text'),text:z.string().min(1).max(80),bounds:box}).strict()
]);
const Draft=z.object({coordinate_system:z.enum(['normalized-crop-top-left-y-down','normalized-image-top-left-y-down']),coverage:z.literal('partial'),traces:z.array(Trace).max(12),omitted:z.array(z.string().min(1).max(400)).min(1).max(12)}).strict().superRefine((value,ctx)=>{
  if(new Set(value.traces.map(t=>t.id)).size!==value.traces.length||value.traces.some(t=>t.kind==='path'&&(t.closed&&t.points.length<3||t.points.some((p,i)=>i>0&&Math.hypot(p[0]-t.points[i-1]![0],p[1]-t.points[i-1]![1])<1e-8))))ctx.addIssue({code:'custom',message:'Unique trace IDs and nonzero path segments required; closed paths need at least 3 vertices'});
});
export type ProgressiveDraftData=z.infer<typeof Draft>;
export type ProgressiveTrace=ProgressiveDraftData['traces'][number];
export const progressiveDraftSchema=JSON.parse(JSON.stringify(z.toJSONSchema(Draft)));
export const parseProgressiveDraft=(value:unknown)=>Draft.parse(value);
/** Routing hints never certify recognized image contents. */
export function isAnalysisOnlyRequest(task:string){
  const declaration=/(?:只|仅|先).{0,8}(?:分析|清点|识别|规划|说明|看图)|^\s*(?:请)?\s*(?:分析|清点|识别|规划|analy[sz]e\b|inspect\b|plan\b)|analysis[- ]only|only analy[sz]e/i.exec(task);
  if(!declaration)return false;
  if(/画|绘|新建|创建|移动|修改|编辑|保存|生成|修复/.test(declaration[0].replace(/分析|清点|识别|规划|说明|看图/g,'')))return false;
  if(/^\s*(?:请)?\s*(?:规划|设计)(?:并)?(?:绘制|画|生成)/.test(task))return false;
  const actions=[...task.matchAll(/(?:然后|并且|同时|接着|并|再|之后|后|[,，]|\bthen\b|\band\b)([^。；;\n]{0,12}?)(?:绘制|画|重绘|修改|移动|编辑|修复|新建|生成|保存|创建|设计|draw\b|edit\b|move\b|save\b|create\b|repair\b|fix\b)/gi)];
  return !actions.some(a=>!/不要|别|不必|无需|禁止|不再|不能|不是|不进行|不做|说明|解释|如何|怎么|是否|会不会|do not|don't|never|explain|how|whether/i.test(a[1]!));
}
export function progressiveDrawingSelection(task:string,image?:{width:number;height:number}){
  task=task.replace(/["“][^"”\r\n]+\.(?:png|jpe?g|dwg)["”]/gi,' ').replace(/[a-z]:[\\/][^\s"'<>，。；;]*?\.(?:png|jpe?g|dwg)\b/gi,' ').replace(/(?:^|\s)[^\s"'<>，。；;:：]+?\.(?:png|jpe?g|dwg)\b/gi,' ');
  if(isAnalysisOnlyRequest(task))return {selected:false,reason:'analysis-only'};
  const explicit=/渐进|分批|分区|逐区|逐步|分阶段|分步骤|一步步|progressive|incremental|draw in stages/i.test(task);
  const complex=/复杂|密集|多视图|多区域|多个房间|总平面|多部件|complex|dense|multi[- ](?:part|view|region)/i.test(task);
  const large=Boolean(image&&image.width*image.height>=8_000_000);
  return {selected:explicit||complex||large,reason:explicit?'explicit-stages':complex?'complex-task':large?'large-reference':'short-workflow'};
}
