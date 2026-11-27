import type { QualityPlan } from '@cader/config';

type Point=number[];
const gap=(a:Point,b:Point)=>Math.hypot(a[0]!-b[0]!,a[1]!-b[1]!);
const on=(p:Point,a:Point,b:Point)=>{
  const length=gap(a,b);
  return length>1e-5&&Math.abs((b[0]!-a[0]!)*(p[1]!-a[1]!)-(b[1]!-a[1]!)*(p[0]!-a[0]!))/length<=1e-5&&
    (p[0]!-a[0]!)*(p[0]!-b[0]!)+(p[1]!-a[1]!)*(p[1]!-b[1]!)<=1e-5;
};
/** Symbol geometry must actually reach its declared ports. Bounding boxes alone
 * cannot prove a polyline endpoint, so such symbols need explicit lead lines. */
export function missingSymbolPorts(component:QualityPlan['components'][number],entities:Record<string,any>[],wireLayer?:string){
  const [min,max]=component.bounds;
  const local=entities.filter(e=>e.layer!==wireLayer&&!['AcDbText','AcDbMText'].includes(e.type)&&e.bounding_box&&e.bounding_box.min[0]>=min[0]-1e-5&&e.bounding_box.min[1]>=min[1]-1e-5&&e.bounding_box.max[0]<=max[0]+1e-5&&e.bounding_box.max[1]<=max[1]+1e-5);
  return component.ports.filter(p=>!local.some(e=>
    [e.start_point,e.end_point].some(end=>Array.isArray(end)&&gap(p,end)<1e-5&&Math.abs(end[2]??0)<1e-5)||
    e.type==='AcDbCircle'&&Array.isArray(e.center)&&Math.abs((e.center[2]??0))<1e-5&&Math.abs(gap(e.center,p)-e.radius)<1e-5));
}
/** External conductor connectivity only. A transistor is not an internal short.
 * Crossings join only at an endpoint, a pin or an explicitly declared junction. */
export function verifyNetlist(plan:QualityPlan,entities:Record<string,any>[],boundaryPins:{name:string;position:number[];net:string}[]=[]){
  const all=entities.filter(e=>e.layer===plan.wire_layer);
  const wires=all.filter(e=>e.type==='AcDbLine'&&Array.isArray(e.start_point)&&Array.isArray(e.end_point));
  const pins=[...plan.components.flatMap(c=>c.ports.map((position,i)=>({component:c.id,name:`${c.id}:${c.pin_names?.[i]??i}`,position}))),...boundaryPins.map(p=>({component:'__boundary__',name:p.name,position:p.position}))];
  const missingContacts=plan.components.flatMap(c=>missingSymbolPorts(c,entities,plan.wire_layer).map(position=>({component:c.id,position})));
  const parents=Array.from({length:wires.length+pins.length},(_,i)=>i);
  const root=(i:number):number=>parents[i]===i?i:(parents[i]=root(parents[i]!));
  const join=(a:number,b:number)=>{parents[root(a)]=root(b);};
  const endpoints=(w:typeof wires[number])=>[w.start_point,w.end_point] as Point[];
  let overlap=false;
  const overlappingPairs:{wire_ids:unknown[];axis:number;interval:number[];segments:Point[][]}[]=[];
  for(let i=0;i<wires.length;i++)for(let j=i+1;j<wires.length;j++){
    const a=wires[i]!,b=wires[j]!;
    const touching=endpoints(a).some(p=>on(p,b.start_point,b.end_point))||endpoints(b).some(p=>on(p,a.start_point,a.end_point));
    if(touching)join(i,j);
    // Positive collinear overlap (including duplicates), rather than a shared endpoint.
    const axis=Math.abs(a.end_point[0]-a.start_point[0])>=Math.abs(a.end_point[1]-a.start_point[1])?0:1;
    const collinear=[b.start_point,b.end_point].every(p=>Math.abs((a.end_point[0]-a.start_point[0])*(p[1]-a.start_point[1])-(a.end_point[1]-a.start_point[1])*(p[0]-a.start_point[0]))<1e-5*Math.max(1,gap(a.start_point,a.end_point)));
    const low=Math.max(Math.min(a.start_point[axis],a.end_point[axis]),Math.min(b.start_point[axis],b.end_point[axis])),high=Math.min(Math.max(a.start_point[axis],a.end_point[axis]),Math.max(b.start_point[axis],b.end_point[axis]));
    if(collinear&&high-low>1e-5){overlap=true;overlappingPairs.push({wire_ids:[a.object_id,b.object_id],axis,interval:[low,high],segments:[endpoints(a),endpoints(b)]});}
  }
  const missingJunctions:Point[]=[];
  for(const p of plan.junctions??[]){
    const ids=wires.flatMap((w,i)=>on(p,w.start_point,w.end_point)?[i]:[]);
    const scale=Math.min(...ids.map(i=>gap(wires[i]!.start_point,wires[i]!.end_point)));
    const observed=ids.length>=2&&(ids.some(i=>endpoints(wires[i]!).some(endpoint=>gap(endpoint,p)<1e-5))||entities.some(e=>e.type==='AcDbCircle'&&e.layer!==plan.wire_layer&&Array.isArray(e.center)&&gap(e.center,p)<1e-5&&e.radius>1e-5&&e.radius<=scale*0.15));
    if(!observed&&ids.length>=2)missingJunctions.push(p);
    else for(const i of ids)join(ids[0]!,i);
  }
  pins.forEach((pin,i)=>wires.forEach((w,j)=>{if(on(pin.position,w.start_point,w.end_point))join(wires.length+i,j);}));
  const contact=(pin:typeof pins[number])=>!missingContacts.some(m=>m.component===pin.component&&gap(m.position,pin.position)<1e-5);
  for(let i=0;i<pins.length;i++)for(let j=i+1;j<pins.length;j++)if(gap(pins[i]!.position,pins[j]!.position)<1e-5&&contact(pins[i]!)&&contact(pins[j]!))join(wires.length+i,wires.length+j);
  const expected=new Map<string,string>([...plan.nets?.flatMap(n=>n.pins.map(p=>[`${p.component}:${p.pin}`,n.id] as const))??[],...boundaryPins.map(p=>[p.name,p.net] as const)]);
  const mismatches:unknown[]=[];
  for(let i=0;i<pins.length;i++)for(let j=i+1;j<pins.length;j++){
    const connected=root(wires.length+i)===root(wires.length+j),wanted=expected.get(pins[i]!.name)===expected.get(pins[j]!.name);
    if(connected!==wanted)mismatches.push({pins:[pins[i]!.name,pins[j]!.name],expected_connected:wanted,actual_connected:connected});
  }
  const unconnected=pins.filter(p=>(plan.nets?.find(n=>n.id===expected.get(p.name))?.pins.length??0)>1&&!wires.some(w=>on(p.position,w.start_point,w.end_point))&&!pins.some(other=>other!==p&&gap(other.position,p.position)<1e-5&&contact(p)&&contact(other)));
  const dangling=wires.flatMap((w,i)=>endpoints(w).filter(p=>!pins.some(pin=>gap(pin.position,p)<1e-5)&&!wires.some((other,j)=>i!==j&&on(p,other.start_point,other.end_point))).map(position=>({wire_id:w.object_id,position})));
  const orphan=wires.filter((_,i)=>!pins.some((_,j)=>root(i)===root(wires.length+j))).map(w=>w.object_id);
  // The acceptance coordinates are XY; symbol contacts are checked in Z=0.
  const plane=0;
  const supported=all.length===wires.length&&wires.every(w=>gap(w.start_point,w.end_point)>1e-5&&endpoints(w).every(p=>Math.abs((p[2]??0)-plane)<1e-5));
  const schemaComplete=pins.length>0&&expected.size===pins.length&&pins.every(p=>expected.has(p.name));
  const pass=schemaComplete&&supported&&!overlap&&!unconnected.length&&!dangling.length&&!orphan.length&&!mismatches.length&&!missingJunctions.length&&!missingContacts.length;
  return {pass,evidence:`external net partition=${pass}; supported=${supported}; overlapping=${overlap}; mismatches=${mismatches.length}; disconnected pins=${unconnected.length}; dangling=${dangling.length}; orphan=${orphan.length}`,
    details:{tolerance:1e-5,mismatches,unconnected_ports:unconnected,missing_symbol_contacts:missingContacts,dangling_endpoints:dangling,orphan_wire_ids:orphan,missing_junction_markers:missingJunctions,overlapping_wire_pairs:overlappingPairs.slice(0,32),overlapping_wire_pair_count:overlappingPairs.length,overlap,supported}};
}
