import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAcceptancePlan,parseReferenceObservation} from '@cader/config';
import {verifyQuality} from '@cader/profile';
const plan=parseAcceptancePlan({version:1,domain:'electrical-schematic',wire_layer:'WIRE',visual_required:true,
  components:[{id:'Q',kind:'three-pin',ports:[[0,5],[10,10],[10,0]],pin_names:['B','C','E'],bounds:[[0,0],[10,10]]},
    {id:'A',kind:'two-pin',ports:[[-20,5],[-10,5]],pin_names:['1','2'],bounds:[[-20,0],[-10,10]]},
    {id:'B',kind:'two-pin',ports:[[20,10],[30,10]],pin_names:['1','2'],bounds:[[20,0],[30,10]]}],
  nets:[{id:'branch',pins:[{component:'Q',pin:'B'},{component:'A',pin:'2'},{component:'B',pin:'1'}]},
    ...[['Q','C'],['Q','E'],['A','1'],['B','2']].map(([component,pin],i)=>({id:`open${i}`,pins:[{component,pin}]}))],
  requirements:['netlist','visual','no_wire_through_component','text_clearance'].map(check=>({id:check,check,source_quote:'fixture',description:check}))});
const wire=(a:number[],b:number[],i=1)=>({object_id:i,type:'AcDbLine',layer:'WIRE',start_point:[...a,0],end_point:[...b,0]});
const leads=(components:typeof plan.components)=>components.flatMap(c=>c.ports.map((p,i)=>({object_id:100+i,type:'AcDbLine',layer:'SYMBOL',start_point:[...p,0],end_point:[(c.bounds[0][0]+c.bounds[1][0])/2,(c.bounds[0][1]+c.bounds[1][1])/2,0],bounding_box:{min:c.bounds[0],max:c.bounds[1]}})));
const symbols=leads(plan.components);
const wires=[wire([0,5],[-5,5]),wire([-5,5],[-5,15],2),wire([-5,15],[20,15],3),wire([20,15],[20,10],4),wire([-10,5],[-5,5],5)];
const check=(items:Record<string,any>[],p=plan)=>verifyQuality(p,[...symbols,...items]).find(c=>c.id==='netlist')!;
test('external net partitions support a three-pin component and T branches without shorting the device',()=>{
  assert.equal(check(wires).status,'pass');
  assert.equal(check(wires.slice(1)).status,'fail');
  assert.equal(check([...wires,wires[0]!]).status,'fail');
  const duplicate=check([...wires,{...wires[0]!,object_id:999}]);
  assert.ok((duplicate.details as {overlapping_wire_pairs:{wire_ids:number[];interval:number[]}[]}).overlapping_wire_pairs.some(pair=>pair.wire_ids.includes(999)&&pair.interval[1]!>pair.interval[0]!));
  assert.equal(check([...wires,wire([10,0],[10,10])]).status,'fail');
  assert.equal(check([...wires,wire([20,15],[25,15])]).status,'fail');
  assert.equal(check([...wires,wire([100,100],[110,100])]).status,'fail');
  assert.equal(check(wires.map(w=>({...w,end_point:[...w.end_point.slice(0,2),1]}))).status,'fail');
  assert.equal(check(wires.map(w=>({...w,start_point:[...w.start_point.slice(0,2),1],end_point:[...w.end_point.slice(0,2),1]}))).status,'fail');
  assert.throws(()=>parseAcceptancePlan({...plan,requirements:[...plan.requirements,{id:'invalid-series',check:'series_cycle',source_quote:'fixture',description:'Wrong verifier'}]}),/two-terminal/);
  assert.throws(()=>parseAcceptancePlan({...plan,nets:plan.nets!.slice(1)}),/partition/);
});
test('interior crossings remain disconnected unless a junction is explicitly declared',()=>{
  const p=parseAcceptancePlan({version:1,domain:'electrical-schematic',wire_layer:'WIRE',visual_required:true,
    components:[[-10,0],[10,0],[0,-10],[0,10]].map(([x,y],i)=>({id:String(i),kind:'terminal',ports:[[x,y]],pin_names:['p'],bounds:[[x!-1,y!-1],[x!,y!]]})),
    nets:[{id:'horizontal',pins:[{component:'0',pin:'p'},{component:'1',pin:'p'}]},{id:'vertical',pins:[{component:'2',pin:'p'},{component:'3',pin:'p'}]}],requirements:plan.requirements});
  const e=[wire([-10,0],[10,0]),wire([0,-10],[0,10])];
  const s=leads(p.components);
  const result=(q:typeof p)=>verifyQuality(q,[...s,...e]).find(c=>c.id==='netlist')!.status;
  assert.equal(result(p),'pass');assert.equal(result({...p,junctions:[[0,0]]}),'fail');
  const joined={...p,junctions:[[0,0]] as [number,number][],nets:[{id:'joined',pins:p.nets!.flatMap(n=>n.pins)}]};
  assert.equal(result(joined),'fail'); // a declared junction alone is not CAD evidence
  assert.equal(verifyQuality(joined,[...s,...e,{type:'AcDbCircle',layer:'JUNCTION',center:[0,0,0],radius:0.5}]).find(c=>c.id==='netlist')!.status,'pass');
});
test('source net schema rejects lost pins and duplicated/unknown terminals',()=>{
  const source={version:1,drawing_kind:'schematic',summary:'fixture',coordinate_system:'normalized-image-top-left-y-down',content_bounds:[[0,0],[1,1]],objects:[{id:'Q',kind:'three-pin',bounds:[[0,0],[1,1]],terminals:[[0,0],[1,0],[1,1]],certainty:'clear'}],visible_text:[],connections:[],unknowns:[]};
  assert.throws(()=>parseReferenceObservation({...source,nets:[{id:'n',pins:[{object:'Q',terminal:0},{object:'Q',terminal:1}]}]}),/partition/);
  assert.throws(()=>parseReferenceObservation({...source,nets:[{id:'n',pins:[0,1,3].map(terminal=>({object:'Q',terminal}))}]}),/partition/);
  assert.doesNotThrow(()=>parseReferenceObservation({...source,nets:[0,1,2].map(terminal=>({id:String(terminal),pins:[{object:'Q',terminal}]}))}));
});

test('coincident ports connect through observed symbol leads, never metadata or an impossible zero-length wire',()=>{
  const p=parseAcceptancePlan({version:1,domain:'electrical-schematic',wire_layer:'WIRE',visual_required:true,requirements:plan.requirements,
    components:[{id:'A',kind:'two-pin',bounds:[[0,0],[10,10]],ports:[[0,5],[10,5]],pin_names:['1','2']},{id:'B',kind:'two-pin',bounds:[[10,0],[20,10]],ports:[[10,5],[20,5]],pin_names:['1','2']}],
    nets:[{id:'touch',pins:[{component:'A',pin:'2'},{component:'B',pin:'1'}]},{id:'left',pins:[{component:'A',pin:'1'}]},{id:'right',pins:[{component:'B',pin:'2'}]}]});
  const rows=leads(p.components),status=(q= p,observed=rows)=>verifyQuality(q,observed).find(c=>c.id==='netlist')!;
  assert.equal(status().status,'pass');
  assert.equal(status(p,rows.filter((_,i)=>i!==1)).status,'fail');
  assert.equal(status({...p,junctions:[[999,999]]}).status,'pass'); // unused annotation does not invent a connection
  const separated={...p,nets:p.components.flatMap(c=>c.pin_names!.map(pin=>({id:`${c.id}-${pin}`,pins:[{component:c.id,pin}]})))};
  assert.equal(status(separated).status,'fail'); // actual touching pins cannot be declared independent
});
