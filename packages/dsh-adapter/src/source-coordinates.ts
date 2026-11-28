type Box=[[number,number],[number,number]];
export function sourceRegionView(bounds:Box,image:{width:number;height:number}){
  const left=Math.round(bounds[0][0]*image.width),top=Math.round(bounds[0][1]*image.height),right=Math.round(bounds[1][0]*image.width),bottom=Math.round(bounds[1][1]*image.height);
  if(left<0||top<0||right>image.width||bottom>image.height||right<=left||bottom<=top)throw new Error('SOURCE_REGION_INVALID');
  return {crop:{left,top,width:right-left,height:bottom-top}};
}
/** Very wide/tall BASE images lose small labels when fitted to a model's image
 * edge limit. Supply bounded real-pixel tiles; they do not broaden the scope. */
export function sourceAspectViews(base:ReturnType<typeof sourceRegionView>){
  const b=base.crop,horizontal=b.width>=b.height,long=horizontal?b.width:b.height,short=horizontal?b.height:b.width;
  if(long<=1536||long/short<=3)return [];
  const count=Math.min(4,Math.max(2,Math.ceil(long/Math.max(1024,short*2))));
  return Array.from({length:count},(_,i)=>{
    const start=Math.max(0,Math.floor(i*long/count)-Math.ceil(long/count*0.05)),end=Math.min(long,Math.ceil((i+1)*long/count)+Math.ceil(long/count*0.05));
    return {crop:{left:b.left+(horizontal?start:0),top:b.top+(horizontal?0:start),width:horizontal?end-start:b.width,height:horizontal?b.height:end-start}};
  });
}
/** Supplemental pixels never broaden an analysis scope. They retain ORIGINAL
 * pixel coordinates; only the report uses the BASE region normalized frame. */
export function clipSourceView(view:{crop?:{left:number;top:number;width:number;height:number};rotation?:number},base:ReturnType<typeof sourceRegionView>){
  if(view.rotation)throw new Error('SOURCE_REGION_ROTATION_UNSUPPORTED');
  const a=view.crop??base.crop,b=base.crop,left=Math.max(a.left,b.left),top=Math.max(a.top,b.top),right=Math.min(a.left+a.width,b.left+b.width),bottom=Math.min(a.top+a.height,b.top+b.height);
  if(right<=left||bottom<=top)throw new Error('SOURCE_DETAIL_OUTSIDE_BASE');
  return {crop:{left,top,width:right-left,height:bottom-top}};
}
/** Exact trusted crop transform. Never ask a model to repeatedly do affine
 * arithmetic for every component, label and terminal. IDs/topology stay intact. */
export function sourceCoordinates<T>(value:T,bounds:Box,direction:'to-source'|'to-crop'):T{
  const point=(p:number[])=>p.map((v,i)=>i>1?v:direction==='to-source'?bounds[0][i]!+v*(bounds[1][i]!-bounds[0][i]!):(v-bounds[0][i]!)/(bounds[1][i]!-bounds[0][i]!));
  const visit=(v:any,key=''):any=>{
    if(Array.isArray(v)){
      if(['bounds','content_bounds','terminals','points'].includes(key))return v.map(point);
      if(key==='center'||key==='position')return point(v);
      return v.map(x=>visit(x));
    }
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='coordinate_system'?(direction==='to-source'?'normalized-image-top-left-y-down':'normalized-crop-top-left-y-down'):k==='radius'&&typeof x==='number'?(direction==='to-source'?x*(bounds[1][0]-bounds[0][0]):x/(bounds[1][0]-bounds[0][0])):visit(x,k)]));
    return v;
  };
  return visit(value);
}
