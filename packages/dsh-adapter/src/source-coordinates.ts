type Box=[[number,number],[number,number]];
/** Exact trusted crop transform. Never ask a model to repeatedly do affine
 * arithmetic for every component, label and terminal. IDs/topology stay intact. */
export function sourceCoordinates<T>(value:T,bounds:Box,direction:'to-source'|'to-crop'):T{
  const point=(p:number[])=>p.map((v,i)=>i>1?v:direction==='to-source'?bounds[0][i]!+v*(bounds[1][i]!-bounds[0][i]!):(v-bounds[0][i]!)/(bounds[1][i]!-bounds[0][i]!));
  const visit=(v:any,key=''):any=>{
    if(Array.isArray(v)){
      if(['bounds','content_bounds','terminals','points'].includes(key))return v.map(point);
      if(key==='center')return point(v);
      return v.map(x=>visit(x));
    }
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='coordinate_system'?(direction==='to-source'?'normalized-image-top-left-y-down':'normalized-crop-top-left-y-down'):k==='radius'&&typeof x==='number'?(direction==='to-source'?x*(bounds[1][0]-bounds[0][0]):x/(bounds[1][0]-bounds[0][0])):visit(x,k)]));
    return v;
  };
  return visit(value);
}
