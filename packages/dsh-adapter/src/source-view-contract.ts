import {sourceCoordinates} from './source-coordinates.js';
type Box=[[number,number],[number,number]];
type Crop={left:number;top:number;width:number;height:number};
/** A report may use one named attachment per positional item. Only the
 * Harness owns these crop bindings; the model never supplies a transform. */
export function sourceViewContract(parameters:Record<string,any>,base:Crop,details:Crop[],required:boolean,lookupSlots=0){
 const crops:Record<string,Crop>={BASE:base,...Object.fromEntries(details.map((crop,i)=>['DETAIL_'+i,crop]))};
 const frames:Record<string,Box>=Object.fromEntries(Object.entries(crops).map(([id,c])=>[id,[[(c.left-base.left)/base.width,(c.top-base.top)/base.height],[(c.left+c.width-base.left)/base.width,(c.top+c.height-base.top)/base.height]]]));
 if(Object.values(frames).some(([a,b])=>a.some((x,i)=>!Number.isFinite(x)||x<0||x>=b[i]!)||b.some(x=>!Number.isFinite(x)||x>1)))throw new Error('SOURCE_VIEW_BINDING_OUTSIDE_BASE');
 const names=[...Object.keys(frames),...Array.from({length:lookupSlots},(_,i)=>'LOOKUP_'+i)];
 const registerView=(id:string,crop:Crop)=>{
  if(!names.includes(id)||!id.startsWith('LOOKUP_'))throw new Error('SOURCE_VIEW_SLOT_DENIED');
  if(Object.hasOwn(crops,id)){if(JSON.stringify(crops[id])!==JSON.stringify(crop))throw new Error('SOURCE_VIEW_REBIND_DENIED');return;}
  const frame:Box=[[(crop.left-base.left)/base.width,(crop.top-base.top)/base.height],[(crop.left+crop.width-base.left)/base.width,(crop.top+crop.height-base.top)/base.height]];
  if(frame[0].some((x,i)=>!Number.isFinite(x)||x<0||x>=frame[1][i]!)||frame[1].some(x=>!Number.isFinite(x)||x>1))throw new Error('SOURCE_VIEW_BINDING_OUTSIDE_BASE');
  crops[id]={...crop};frames[id]=frame;
 };
 const schema=structuredClone(parameters);
 const positional=(properties:Record<string,unknown>)=>['bounds','points','center'].some(k=>k in properties);
 const annotate=(node:any):void=>{
  if(!node||typeof node!=='object')return;
  if(node.properties&&positional(node.properties)){
   node.properties.view_ref={type:'string',enum:names,description:'Image whose own normalized 0..1 coordinates this item uses. LOOKUP names are usable only after the crop tool returns that exact name. Prefer the named DETAIL that shows the complete feature; Harness maps to BASE. Root content_bounds remains BASE.'};
   if(required)node.required=[...new Set([...(node.required??[]),'view_ref'])];
  }
  for(const value of Object.values(node))if(value&&typeof value==='object')Array.isArray(value)?value.forEach(annotate):annotate(value);
 };
 annotate(schema);
 const validatePoints=(item:Record<string,any>)=>{
  const point=(p:any)=>{if(!Array.isArray(p)||p.length!==2||p.some(x=>!Number.isFinite(x)||x<0||x>1))throw new Error('SOURCE_VIEW_POINT_OUTSIDE_FRAME');};
  for(const key of ['bounds','terminals','points'])if(item[key]!==undefined){if(!Array.isArray(item[key]))throw new Error('SOURCE_VIEW_POINTS_INVALID');item[key].forEach(point);}
  if(item.center!==undefined)point(item.center);
  if(item.radius!==undefined&&(!Number.isFinite(item.radius)||item.radius<=0||item.radius>1))throw new Error('SOURCE_VIEW_RADIUS_INVALID');
 };
 const normalize=(input:unknown):any=>{
  if(Array.isArray(input))return input.map(normalize);
  if(!input||typeof input!=='object')return input;
  const item=input as Record<string,any>;
  if(positional(item)){
   const id=item.view_ref??(required?undefined:'BASE');
   if(typeof id!=='string'||!Object.hasOwn(frames,id))throw new Error('SOURCE_VIEW_REFERENCE_REQUIRED: each positional item must name one current frame: '+Object.keys(frames).join(', '));
   validatePoints(item);const {view_ref,...value}=item;
   return sourceCoordinates(value,frames[id]!, 'to-source');
  }
  return Object.fromEntries(Object.entries(item).map(([key,value])=>[key,normalize(value)]));
 };
 return {parameters:schema,normalize,crops,frames,required,registerView};
}
