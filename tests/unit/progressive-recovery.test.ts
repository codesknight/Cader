import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {ExecutionSession,atomicPrivateState,draftAcceptancePlan,progressiveReviewScope,scopedNativeWindowContainsTargets} from '@cader/profile';
import {createToolRuntime,defineTool,invokeTool,sourceCoordinates,sourceRegionView,clipSourceView,sourceAspectViews} from '@cader/dsh-adapter';
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

test('source details preserve original pixels but never expand a BASE region',()=>{
  const base=sourceRegionView([[0.5,0.5],[1,1]],{width:1000,height:800});
  assert.deepEqual(clipSourceView({crop:{left:450,top:390,width:200,height:100}},base).crop,{left:500,top:400,width:150,height:90});
  assert.throws(()=>clipSourceView({crop:{left:0,top:0,width:100,height:100}},base),/OUTSIDE_BASE/);
  assert.throws(()=>clipSourceView({rotation:90},base),/ROTATION/);
});

test('draft acceptance is compiled only from agreed traces, with no model-invented coverage requirements',()=>{
  const plan=draftAcceptancePlan('复现源图',[{id:'edge',kind:'path',points:[[10,10],[20,10]],closed:false},{id:'tag',kind:'text',text:'A',bounds:[[1,1],[2,2]],max_text_height:0.5}]);
  assert.equal(plan.components.length,0);assert.deepEqual(plan.requirements.map(r=>r.id),['draft_appearance','draft_text_0']);
  assert.equal(plan.requirements.find(r=>r.check==='text')!.text,'A');assert.match(plan.requirements[0]!.description,/edge, tag/);
  assert.throws(()=>draftAcceptancePlan('复现源图',[]),/UNAVAILABLE/);
});

test('native review windows and small-text closeups are bound to actual target IDs and source coordinates',()=>{
  const entities=[{object_id:7,type:'AcDbLine',start_point:[100,200,0],end_point:[700,200,0],bounding_box:{min:[100,200,0],max:[700,200,0]}},{object_id:8,type:'AcDbText',text_string:'A',height:1,bounding_box:{min:[200,201,0],max:[202,202,0]}},{object_id:9,type:'AcDbLine',start_point:[240,201,0],end_point:[242,201,0],bounding_box:{min:[240,201,0],max:[242,201,0]}}];
  const args={region:'one',mode:'affected-batch' as const,document:'fixture',snapshot_hash:'snapshot-1',source_sha256:'source-1',entities,bounds:[[0,0],[1000,1000]] as [[number,number],[number,number]],image:{width:1000,height:1000},source_bounds:[[0,0],[1,1]] as [[number,number],[number,number]],toSource:(p:number[])=>[p[0]!/1000,1-p[1]!/1000]};
  const review=progressiveReviewScope(args);assert.deepEqual(review.binding.entity_ids,[7,8,9]);assert.equal(review.view.min_long_edge,2048);assert.equal(review.view.details!.length,2);assert.deepEqual(review.view.details!.map(d=>d.entity_ids),[[8],[9]]);
  assert.ok(review.view.details![0]!.request.world_window[2]-review.view.details![0]!.request.world_window[0]<10);
  assert.notEqual(progressiveReviewScope({...args,snapshot_hash:'changed'}).binding.id,review.binding.id);assert.ok(review.view.sourceView!.crop!.top>700);
});
test('local border pixels cannot reject native-contained targets, but unverified or mismatched windows and clipped targets remain uncertain',()=>{
  const evidence={image_bounds:{possible_clipping:true,foreground_border_pixels:4},review_scope:{mode:'affected-batch',view:{world_window:[0,0,10,10]},entity_ids:[7],targets:[{entity_id:7,native_geometry:{object_id:7,bounding_box:{min:[1,1,0],max:[9,9,0]}}}]},view_request:{world_window:[0,0,10,10]},view_evidence:{configuration_verified:true,projection:'WCS_XY_TOP',world_window:[0,0,10,10]}};
  assert.equal(scopedNativeWindowContainsTargets(evidence),true);
  const changed=structuredClone(evidence);changed.review_scope.targets[0]!.native_geometry.bounding_box.max[0]=11;assert.equal(scopedNativeWindowContainsTargets(changed),false);
  const wrong=structuredClone(evidence);wrong.view_evidence.world_window[2]=12;assert.equal(scopedNativeWindowContainsTargets(wrong),false);
  const unverified=structuredClone(evidence);unverified.view_evidence.configuration_verified=false;assert.equal(scopedNativeWindowContainsTargets(unverified),false);
  const foreign=structuredClone(evidence);foreign.review_scope.targets[0]!.native_geometry.object_id=8;assert.equal(scopedNativeWindowContainsTargets(foreign),false);
  assert.equal(scopedNativeWindowContainsTargets({image_bounds:{possible_clipping:true}}),false);
});

test('native line width supplies context for a tiny closeup while large views retain normal framing',()=>{
 const args={region:'fixture',mode:'affected-batch' as const,document:'owned',snapshot_hash:'s',source_sha256:null,bounds:[[0,0],[100,100]] as [[number,number],[number,number]],image:{width:1000,height:1000},source_bounds:[[0,0],[1,1]] as [[number,number],[number,number]],toSource:(p:number[])=>p};
 const tiny={object_id:1,type:'AcDb2dPolyline',constant_width:2,bounding_box:{min:[50,50,0],max:[50.1,50,0]}},large={object_id:2,type:'AcDbLine',bounding_box:{min:[0,0,0],max:[100,100,0]}};
 const one=progressiveReviewScope({...args,entities:[tiny]});assert.deepEqual(one.view.world_window,[46,46,54.1,54]);
 const both=progressiveReviewScope({...args,entities:[tiny,large]});assert.deepEqual(both.view.world_window,[-8,-8,108,108]);assert.deepEqual(both.view.details![0]!.entity_ids,[1]);assert.deepEqual(both.view.details![0]!.request.world_window,[46,46,54.1,54]);
 assert.deepEqual(tiny.bounding_box,{min:[50,50,0],max:[50.1,50,0]});
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


for(const vertical of [false,true])test(`source aspect tiles preserve pixel scope and legible magnification without changing BASE coordinates: vertical=${vertical}`,()=>{
 const base={crop:{left:31,top:47,width:vertical?400:4967,height:vertical?4967:400}};const tiles=sourceAspectViews(base);assert.equal(tiles.length,4);assert.deepEqual(clipSourceView(tiles[0]!,base),tiles[0]);const axis=vertical?'top':'left',size=vertical?'height':'width';assert.equal(tiles[0]!.crop[axis],base.crop[axis]);assert.equal(tiles.at(-1)!.crop[axis]+tiles.at(-1)!.crop[size],base.crop[axis]+base.crop[size]);
 for(let i=0;i<tiles.length;i++){assert.deepEqual(clipSourceView(tiles[i]!,base),tiles[i]);assert.ok(tiles[i]!.crop[size]<1536);if(i)assert.ok(tiles[i]!.crop[axis]<=tiles[i-1]!.crop[axis]+tiles[i-1]!.crop[size]);}
 assert.deepEqual(sourceAspectViews({crop:{left:0,top:0,width:512,height:512}}),[]);assert.deepEqual(sourceAspectViews({crop:{left:0,top:0,width:800,height:100}}),[]);
});
