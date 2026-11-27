import {createHash} from 'node:crypto';
import type {ReferenceIndex,SourceItem} from '@cader/dsh-adapter';
import type {CadOperationRecord} from './execution.js';
import type {CheckResult} from './quality.js';
import {cadRequestDigest} from './cad-arguments.js';
export {cadRequestDigest} from './cad-arguments.js';

type Entity=Record<string,any>;
export type SourceState={status:'pending'|'accepted'|'committed'|'verified'|'uncertain'|'unknown';entity_ids:number[];operation_ids:string[];text?:string;rotation?:number;source_evidence?:unknown;native_checks?:CheckResult[];visual_evidence?:unknown;history?:unknown[]};
export interface SourceWorklist {version:1;index_path:string;index_sha256:string;source_sha256:string;items:Record<string,SourceState>;active_batch?:{root_call_id:string;ids:string[];operation_mark:number;arguments_sha256:string[]}|null;rounds:number;residual_reviews:unknown[]}
export const sourceDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createSourceWorklist(index:ReferenceIndex,path:string):SourceWorklist{
 return {version:1,index_path:path,index_sha256:sourceDigest(index),source_sha256:index.source.sha256,items:Object.fromEntries(index.items.map(i=>[i.id,{status:'pending' as const,entity_ids:[],operation_ids:[]}])),rounds:0,residual_reviews:[]};
}
export function assertSourceWorklist(index:ReferenceIndex,work:SourceWorklist){
 if(work.source_sha256!==index.source.sha256||work.index_sha256!==sourceDigest(index)||Object.keys(work.items).length!==index.items.length||index.items.some(i=>!Object.hasOwn(work.items,i.id)))throw new Error('SOURCE_WORKLIST_INDEX_CHANGED');
}
export function sourceItemOwner(index:ReferenceIndex,item:SourceItem){
 const x=(item.bounds[0]+item.bounds[2])/2,y=(item.bounds[1]+item.bounds[3])/2;
 const found=index.tiles.findIndex(({owner:[a,b,c,d]})=>x>=a&&x<c&&y>=b&&y<d);
 if(found<0)throw new Error('SOURCE_ITEM_OWNER_MISSING');return found;
}
export function sourceSelection(index:ReferenceIndex,work:SourceWorklist,ids:string[]){
 assertSourceWorklist(index,work);
 if(!ids.length||ids.length>32||new Set(ids).size!==ids.length)throw new Error('SOURCE_BATCH_IDS_INVALID');
 return ids.map(id=>{const item=index.items.find(i=>i.id===id);if(!item)throw new Error('SOURCE_ITEM_UNKNOWN');const state=work.items[id]!;if(['committed','verified','unknown'].includes(state.status))throw new Error('SOURCE_ITEM_NOT_REPLAYABLE: '+id);return item;});
}
export function sourceItemOperation(index:ReferenceIndex,item:SourceItem,state:SourceState){
 const scale=1000/index.source.width,point=([x,y]:number[])=>[Number((x!*scale).toFixed(6)),Number(((index.source.height-y!)*scale).toFixed(6)),0];
 if(item.kind==='path')return {tool:'mcp__autocad__draw_polyline',arguments:{points:item.points.map(point),closed:item.closed,layer:'CADER_SOURCE_GEOMETRY',width:Number(((item.stroke_width??1)*scale).toFixed(6))}};
 const [x,y,a,b]=item.bounds,rotation=state.rotation??(a-x>=b-y?0:90),box=[x*scale,(index.source.height-b)*scale,a*scale,(index.source.height-y)*scale].map(v=>Number(v.toFixed(6)));
 return {tool:'mcp__autocad__draw_text',arguments:{position_x:box[0],position_y:box[1],position_z:0,text:state.text??item.text,height:Math.max(.001,Math.min(a-x,b-y)*scale),rotation,layer:'CADER_SOURCE_TEXT',fit_box:box}};
}
/** Bind exact acknowledged leaves to source IDs. No missing/failed native result
 * becomes a completed feature; only explicit undispatched outcomes may retry. */
export function reconcileSourceBatch(work:SourceWorklist,operations:CadOperationRecord[]){
 const batch=work.active_batch;if(!batch)return;
 for(const [i,id] of batch.ids.entries()){
  const state=work.items[id]!,op=operations.find(o=>o.tool_call_id===`${batch.root_call_id}:patch:${i}`);
  if(!op)continue;
  if(op.request_arguments_sha256!==batch.arguments_sha256[i])throw new Error('SOURCE_BATCH_ARGUMENT_BINDING_MISMATCH');
  if(state.operation_ids.includes(op.operation_id))continue;
  state.operation_ids.push(op.operation_id);
  if(op.outcome==='committed'&&op.created_entity_ids?.length){state.entity_ids=[...new Set(op.created_entity_ids)];state.status='committed';}
  else if(['unknown','committed_observation_failed'].includes(op.outcome))state.status='unknown';
 }
}
export function verifySourceItem(index:ReferenceIndex,item:SourceItem,state:SourceState,entities:Entity[]):CheckResult[]{
 const owned=entities.filter(e=>state.entity_ids.includes(e.object_id)),operation=sourceItemOperation(index,item,state),a=operation.arguments as Record<string,any>;
 const near=(x:number[],y:number[])=>x.length===y.length&&x.every((n,i)=>Number.isFinite(y[i])&&Math.abs(n-y[i]!)<=1e-5);
 let pass=false,actual:unknown=owned;
 if(item.kind==='path'){
  pass=owned.length===1&&['AcDb2dPolyline','AcDbPolyline'].includes(owned[0]!.type)&&owned[0]!.closed===a.closed&&Array.isArray(owned[0]!.coordinates)&&Array.isArray(owned[0]!.normal)&&near(owned[0]!.normal,[0,0,1])&&Math.abs(owned[0]!.elevation??Infinity)<=1e-7&&Math.abs(owned[0]!.constant_width-a.width)<=1e-5;
  if(pass){const stride=owned[0]!.coordinate_dimension,expected=a.points.flatMap((p:number[])=>stride===2?p.slice(0,2):p);pass=[2,3].includes(stride)&&near(expected,owned[0]!.coordinates)&&Array.isArray(owned[0]!.bulges)&&owned[0]!.bulges.length===a.points.length&&owned[0]!.bulges.every((v:number)=>Number.isFinite(v)&&Math.abs(v)<1e-10);}
  actual=owned.map(e=>({object_id:e.object_id,coordinates:e.coordinates,closed:e.closed,normal:e.normal,constant_width:e.constant_width}));
 }else{
  const box=a.fit_box;
  pass=owned.length===1&&owned[0]!.type==='AcDbText'&&owned[0]!.text_string===a.text&&owned[0]!.bounding_box&&near([...owned[0]!.bounding_box.min.slice(0,2),...owned[0]!.bounding_box.max.slice(0,2)],box);
  actual=owned.map(e=>({object_id:e.object_id,text:e.text_string,bounds:e.bounding_box}));
 }
 return [{id:'source_'+item.id,status:pass?'pass':'fail',evidence:JSON.stringify({source_sha256:index.source.sha256,item_id:item.id,expected:operation,actual,scope:'native coordinates/literal text only; image and complete coverage remain separate'})}];
}
export function sourceWorklistSummary(index:ReferenceIndex,work:SourceWorklist){
 const counts:Record<string,number>={},tiles=index.tiles.map((t,id)=>({id:'source_tile_'+id,bounds:t.owner,total:0,pending:0}));
 for(const item of index.items){const state=work.items[item.id]!;counts[state.status]=(counts[state.status]??0)+1;const tile=tiles[sourceItemOwner(index,item)]!;tile.total++;if(state.status!=='verified')tile.pending++;}
 return {source_sha256:index.source.sha256,index_sha256:work.index_sha256,total:index.items.length,counts,all_verified:index.items.length>0&&index.items.every(i=>work.items[i.id]!.status==='verified'),semantics:'requires final independent source/CAD comparison',tiles};
}
export function sourceWorklistPage(index:ReferenceIndex,work:SourceWorklist,region:number,cursor=0){
 const rank=(i:SourceItem)=>['accepted','pending','committed','uncertain','unknown'].indexOf(work.items[i.id]!.status);
 const items=index.items.filter(i=>sourceItemOwner(index,i)===region&&work.items[i.id]!.status!=='verified').sort((a,b)=>rank(a)-rank(b)||a.kind.localeCompare(b.kind)||a.bounds[1]-b.bounds[1]||a.bounds[0]-b.bounds[0]);
 const page=items.slice(cursor,cursor+32);
 const recommended:SourceItem[]=[];
 for(const item of page.filter(i=>['accepted','pending'].includes(work.items[i.id]!.status))){
  if(!recommended.length){recommended.push(item);continue;}
  if(item.kind!==recommended[0]!.kind)continue;
  const all=[...recommended,item],width=Math.max(...all.map(i=>i.bounds[2]))-Math.min(...all.map(i=>i.bounds[0])),height=Math.max(...all.map(i=>i.bounds[3]))-Math.min(...all.map(i=>i.bounds[1]));
  if(width<=800&&height<=800)recommended.push(item);
 }
 return {summary:sourceWorklistSummary(index,work),region:'source_tile_'+region,cursor,next_cursor:cursor+page.length<items.length?cursor+page.length:null,recommended_ids:recommended.map(i=>i.id),recommendation:'Spatially bounded proposal, Agent may choose a different subset/order; no geometry has been dispatched.',items:page.map(i=>({id:i.id,kind:i.kind,bounds:i.bounds,status:work.items[i.id]!.status,entity_ids:work.items[i.id]!.entity_ids,...(i.kind==='text'?{text:i.text,score:i.score,alternatives:i.alternatives}:{vertices:i.points.length,pixel_length:i.pixel_length})})),notice:'Stable source hypotheses, not completed CAD. Agent selects IDs. Confirmed and unknown items must never be replayed.'};
}
