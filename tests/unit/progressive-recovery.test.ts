import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {ExecutionSession,atomicPrivateState} from '@cader/profile';
import {createToolRuntime,defineTool,invokeTool,sourceCoordinates} from '@cader/dsh-adapter';
import type {createMcpClient} from '@cader/dsh-adapter';
import {parseProgressivePlan,rasterizeProgressivePlan} from '@cader/config';
test('trusted BASE-crop transform maps every geometry/label location and leaves source pin identity intact',()=>{
  const local={coordinate_system:'normalized-crop-top-left-y-down',objects:[{id:'a',bounds:[[0.25,0.25],[0.75,0.75]],terminals:[[0.5,0.25]]}],visible_text:[{text:'1µF',bounds:[[0,0],[0.25,0.25]]}],nets:[{id:'n',pins:[{object:'a',terminal:0}]}]};
  const global=sourceCoordinates(local,[[0.2,0.3],[0.6,0.9]],'to-source');
  assert.ok(Math.abs(global.objects[0]!.bounds[0]![0]!-0.3)<1e-12);assert.ok(Math.abs(global.objects[0]!.bounds[0]![1]!-0.45)<1e-12);assert.deepEqual(global.nets,local.nets);
  const restored=sourceCoordinates(global,[[0.2,0.3],[0.6,0.9]],'to-crop');assert.ok(Math.abs(restored.objects[0]!.terminals[0]![0]!-0.5)<1e-12);
  const plan=parseProgressivePlan({version:1,content_bounds:[[0,0],[1,1]],units:'relative-layout-units',regions:[{id:'a',bounds:[[0,0],[0.3333,1]],description:'a',depends_on:[]},{id:'b',bounds:[[0.3333,0],[1,1]],description:'b',depends_on:[]}],anchors:[{id:'p',position:[0.3333,0.5],regions:['a','b'],relation:'coincident',certainty:'clear',evidence:'fixture'}]});
  const snapped=rasterizeProgressivePlan(plan,{width:4967,height:3509});assert.equal(snapped.regions[0]!.bounds[1][0],snapped.regions[1]!.bounds[0][0]);assert.equal(snapped.anchors[0]!.position[0],snapped.regions[0]!.bounds[1][0]);
});
test('atomic checkpoint replacement retains old content on rename failure and leaves new evidence recoverable',async()=>{
  const parent=resolve('.cader/tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'atomic-progressive-'));
  try{
    const path=join(root,'quality.json');await atomicPrivateState(path,'{"step":1}');await atomicPrivateState(path,'{"step":2}');assert.equal(JSON.parse(await readFile(path,'utf8')).step,2);
    const blocked=join(root,'blocked');await mkdir(blocked);await writeFile(join(blocked,'old'),'preserved');await assert.rejects(atomicPrivateState(blocked,'{"step":3}'));assert.equal(await readFile(join(blocked,'old'),'utf8'),'preserved');assert.ok((await readdir(root)).some(name=>name.startsWith('.write-')));
  }finally{assert.ok(root.startsWith(parent+sep));await rm(root,{recursive:true});}
});
test('execution ledger prevents replay of a confirmed progressive creation before native dispatch, but permits missing geometry after a recorded move/delete',async()=>{
  const parent=resolve('.cader/tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'progressive-replay-'));let next=41,writes=0;
  const entities:any[]=[];
  const names=['new_drawing','draw_circle','move_entity','delete_entity','get_entity','query_entities','get_backend_status'];
  const defs=names.map(name=>defineTool({name:'mcp__autocad__'+name,description:'Offline execution fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){throw new Error('Execution owner required');}}));
  const factory:typeof createMcpClient=async()=>({definitions:()=>defs,toolNames:()=>names,async dispose(){},async call(name,args){
    if(name==='new_drawing')return 'fixture.dwg';
    if(name==='draw_circle'){writes++;const object_id=++next;entities.push({object_id,type:'AcDbCircle',layer:'0',center:[args.center_x,args.center_y,0],radius:args.radius,bounding_box:{min:[0,0,0],max:[1,1,0]}});return 'object_id='+object_id;}
    if(name==='query_entities')return structuredClone(entities);
    if(name==='get_entity')return structuredClone(entities.find(e=>e.object_id===args.object_id));
    if(name==='move_entity'){entities.find(e=>e.object_id===args.object_id).center[0]+=Number(args.offset_x);return 'moved';}
    if(name==='delete_entity'){entities.splice(entities.findIndex(e=>e.object_id===args.object_id),1);return 'deleted';}return {};
  }});
  const owner=new ExecutionSession(root,join(root,'.cader/runs/owner'),undefined,factory),ctx=await createToolRuntime();owner.mode='workspace-write';
  const plan={version:1 as const,domain:'generic' as const,components:[],visual_required:true,requirements:[{id:'visual',source_quote:'fixture',description:'fixture only',check:'visual' as const}]};
  try{
    await owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));await owner.authorizeTask('task',plan);await owner.refineTaskPlan('task',plan);for(const tool of owner.definitions())ctx.tools.register(tool);
    assert.equal((await invokeTool(ctx,'mcp__autocad__new_drawing',{})).isError,false);
    const args={center_x:10,center_y:10,center_z:0,radius:1};assert.equal((await invokeTool(ctx,'mcp__autocad__draw_circle',args)).isError,false);
    const duplicate=await invokeTool(ctx,'mcp__autocad__draw_circle',{radius:1,center_z:0,center_y:10,center_x:10});assert.equal(duplicate.isError,true);assert.match(JSON.stringify(duplicate),/CAD_CREATION_ALREADY_COMMITTED/);assert.equal(writes,1);assert.equal(owner.facts().frozen,false);
    assert.equal((await invokeTool(ctx,'mcp__autocad__move_entity',{object_id:42,offset_x:5,offset_y:0,offset_z:0})).isError,false);assert.equal((await invokeTool(ctx,'mcp__autocad__draw_circle',args)).isError,false);assert.equal(writes,2);
    assert.equal((await invokeTool(ctx,'mcp__autocad__delete_entity',{object_id:43})).isError,false);assert.equal((await invokeTool(ctx,'mcp__autocad__draw_circle',args)).isError,false);assert.equal(writes,3);
  }finally{await ctx.fiber.dispose();await owner.dispose();assert.ok(root.startsWith(parent+sep));await rm(root,{recursive:true});}
});
