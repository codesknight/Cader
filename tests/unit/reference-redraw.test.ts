import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { InteractiveSession, ExecutionSession, runTask, runQualityTask, requiresQuality, referencedPaths,referenceLayoutHints,sourcePlanLayout } from '@cader/profile';
import { createLiveRuntime, prepareImageView, createToolRuntime, invokeTool } from '@cader/dsh-adapter';
import type { ToolDefinition, createMcpClient, StreamChunk, PublicEvent, ImageView } from '@cader/dsh-adapter';
import {readReferenceImage,parseReferenceObservation,parseAcceptancePlan} from '@cader/config';

const observation={version:1,drawing_kind:'other',summary:'Synthetic source fixture',coordinate_system:'normalized-image-top-left-y-down',content_bounds:[[0,0],[1,1]],objects:[{id:'object',kind:'fixture',bounds:[[0.2,0.2],[0.8,0.8]],terminals:[],certainty:'clear'}],visible_text:[],connections:[],unknowns:[]};

test('source layout hints invert image Y while preserving rectangular pixel aspect ratio',()=>{
  const source=parseReferenceObservation({...observation,objects:[{...observation.objects[0],terminals:[[0.5,0.2],[0.5,0.8]]}]});
  const hints=referenceLayoutHints(source,{width:100,height:200});
  assert.deepEqual(hints.objects[0]!.bounds,[[200,400],[800,1600]]);
  assert.deepEqual(hints.objects[0]!.terminals,[[500,1600],[500,400]]);
});

test('source text placement hints bound font size to its original box and preserve SI text',()=>{
  const source=parseReferenceObservation({...observation,visible_text:[{text:'2µF',bounds:[[0.2,0.2],[0.4,0.3]],certainty:'clear'}]});
  const label=referenceLayoutHints(source,{width:100,height:200}).visible_text[0]!;
  assert.equal(label.text,'2µF');assert.deepEqual(label.text_layout.anchor,[200,1400]);
  assert.equal(label.text_layout.target_width,200);assert.equal(label.text_layout.target_height,200);
  assert.ok(label.text_layout.max_text_height*3*0.9<=200.001);assert.ok(label.text_layout.max_text_height<=140);
});

test('compact source layout preserves observed pin groups and records boundary normalization without CAD operations',()=>{
  const source=parseReferenceObservation({...observation,drawing_kind:'schematic',objects:[{id:'X',kind:'three-pin fixture',category:'component',bounds:[[0,0],[1,1]],terminals:[[0.3,0.5],[1,0],[1,1]],certainty:'clear'}],nets:[{id:'a',pins:[{object:'X',terminal:0}]},{id:'b',pins:[{object:'X',terminal:1},{object:'X',terminal:2}]}]});
  const before=JSON.stringify(source),layout=sourcePlanLayout(source,{width:100,height:200});
  assert.deepEqual(layout.components[0]!.source_terminals,[0,1,2]);assert.deepEqual(layout.nets[1]!.pins,[{component:'X',pin:'p1'},{component:'X',pin:'p2'}]);assert.equal(layout.normalized_ports.length,1);assert.deepEqual(layout.normalized_ports[0]!.original,[300,1000]);assert.deepEqual(layout.normalized_ports[0]!.planned,[0,1000]);assert.equal(JSON.stringify(source),before);
  const plan=parseAcceptancePlan({version:1,domain:'electrical-schematic',wire_layer:'WIRE',visual_required:true,components:layout.components,nets:layout.nets,requirements:['visual','netlist','no_wire_through_component','text_clearance'].map(check=>({id:check,check,description:'Fixture',source_quote:'Fixture'}))});assert.equal(plan.components.length,1);
});

async function setup(){
  await mkdir('.cader/tests',{recursive:true});
  const root=await mkdtemp(resolve('.cader/tests/redraw-'));
  await cp('configs',join(root,'configs'),{recursive:true,filter:path=>! /\.local\.(yaml|json)$/.test(path)});
  await cp('benchmark/fixtures/vision-calibration.png',join(root,'reference.png'));
  return {root,async cleanup(){await rm(root,{recursive:true});}};
}

test('explicit external image is imported as pixels without extending workspace scope; pending request survives selection',async()=>{
  const f=await setup();await mkdir(join(f.root,'work'));
  let input:Parameters<typeof runTask>[1]|undefined;
  const chat=await InteractiveSession.create(f.root,join(f.root,'work'),async(_root,task)=>{input=task;throw new Error('STOP_BEFORE_MODEL');});
  try{
    const request=`新建一个图层，帮我复现这张图：${join(f.root,'reference.png')} 保存为 result.dwg`;
    await assert.rejects(chat.execute(request),/STOP_BEFORE_MODEL/);
    assert.ok(input?.image?.startsWith(join(f.root,'work','.cader','references')));
    assert.equal(input?.referenceTask?.request,request);
    assert.equal(input?.referenceTask?.outputPath,join(f.root,'work','result.dwg'));
    const selected=await readFile(input!.image!);await writeFile(join(f.root,'reference.png'),'changed original');
    assert.deepEqual(await readFile(input!.image!),selected,'selected snapshot is immutable even when the source changes');
    assert.equal(chat.state.workspace,join(f.root,'work'));
    await chat.execute('/clear');
    assert.equal((await chat.execute('根据手稿复现成DWG')).error,true);
    assert.equal(chat.state.pendingRedrawRequest,'根据手稿复现成DWG');
    await cp('benchmark/fixtures/vision-calibration.png',join(f.root,'work','next.png'));
    await chat.execute('/open next.png');
    await assert.rejects(chat.execute('继续'),/STOP_BEFORE_MODEL/);
    assert.equal(input!.originalTask,'根据手稿复现成DWG');
    assert.ok(input!.image);assert.equal(requiresQuality('新建一个图层，帮我复现这张图'),true);
  }finally{await chat.dispose();await f.cleanup();}
});

test('Windows quoted and plain reference paths are extracted without turning the whole request into a file name',()=>{
  assert.deepEqual(referencedPaths('帮我复现这张图：D:\\photos\\draft.jpg'),['D:\\photos\\draft.jpg']);
  assert.deepEqual(referencedPaths('根据 "D:\\my photos\\draft.jpg" 画图'),['D:\\my photos\\draft.jpg']);
  assert.deepEqual(referencedPaths('根据 @"drawing with space.png" 重绘'),['drawing with space.png']);
});

test('a successful model answer with no new drawing or geometry cannot inspect or accept the old drawing',async()=>{
  const f=await setup();let drawingAttempts=0,queries=0;
  const client:typeof createMcpClient=async()=>({definitions:()=>[],toolNames:()=>[],async dispose(){},async call(name){if(name!=='get_backend_status')queries++;return {};}});
  const owner=new ExecutionSession(f.root,join(f.root,'.cader/runs/noop'),undefined,client);owner.mode='full-access';
  await owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
  const image=await readFile(join(f.root,'reference.png'));
  const runtime={async inspectReference(path:string){const pixels=await readReferenceImage(f.root,path);return {valid:true,structured:{...observation,visible_text:[{text:'2μF',certainty:'clear',bounds:[[0.2,0.2],[0.8,0.4]]}]},evidence:{path,sha256:createHash('sha256').update(pixels.data).digest('hex'),width:pixels.width,height:pixels.height}};},async run(_profile:string,_instruction:string,request?:{extraTools?:ToolDefinition[]}){
    if(request?.extraTools){
      const proposed={version:1,domain:'generic',requirements:[{id:'v',source_quote:'复现',description:'source appearance',check:'visual'},{id:'unit',source_quote:'复现',description:'Source unit',check:'text',text:'2MF'}],components:[],visual_required:true};
      await assert.rejects(request.extraTools[0]!.execute(proposed,{concludeTurn(){}} as never),/SOURCE_LABEL_ACCEPTANCE_REQUIRED/);
      proposed.requirements[1]!.text='2μF';await request.extraTools[0]!.execute(proposed,{concludeTurn(){}} as never);
    }
    else drawingAttempts++;
    return {status:'succeeded',text:'Model claims it drew; fixture has no operations',tools:[]};
  },async reviewCadView(){throw new Error('MUST_NOT_REVIEW_OLD_DRAWING');}};
  try{
    const q=await runQualityTask({runtime:runtime as never,owner,task:'复现参考图',profile:'fixture',emit(){},persist:async()=>{},referenceTask:{request:'复现参考图',image:{path:join(f.root,'reference.png'),sha256:createHash('sha256').update(image).digest('hex'),width:640,height:480},outputPath:join(f.root,'no.dwg'),freshDrawing:true}});
    assert.equal(q.phase,'blocked');assert.equal(q.failure?.code,'TASK_EXECUTION_REQUIRED');
    assert.equal(queries,0);assert.equal(drawingAttempts,2);assert.equal(q.artifact,null);
    assert.equal(owner.facts().frozen,false);
  }finally{await owner.dispose();await f.cleanup();}
});

test('Agent open_image emits pixels and enables crop tools without a prior CLI image reference',async()=>{
  const f=await setup();process.env.CADER_OPEN_IMAGE_FIXTURE='offline-image-only';let steps=0,sawPixels=false;
  const config=await import('@cader/config').then(m=>m.loadConfig(f.root));
  const runtime=await createLiveRuntime({root:f.root,workspaceRoot:f.root,runDirectory:join(f.root,'.cader/runs/open'),...config,
    profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_OPEN_IMAGE_FIXTURE'}))});
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    if(steps++===0){yield* call('cader_open_image',{path:'reference.png'},'open');return;}
    const blocks=JSON.parse(JSON.stringify(request.messages)).flatMap((m:{content:unknown[]})=>m.content);
    sawPixels=blocks.some((b:{type:string})=>b.type==='image');
    assert.ok(request.tools?.some(t=>t.name==='cader_view_image'));
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'Image pixels received'};
    yield {type:'block-end',index:0,block:{type:'text',text:'Image pixels received'}};yield {type:'finish',reason:{kind:'stop'}};
  });
  try{const result=await runtime.run('MainAgent','Inspect workspace reference.png');assert.equal(result.status,'succeeded');assert.equal(sawPixels,true);}
  finally{await runtime.dispose();delete process.env.CADER_OPEN_IMAGE_FIXTURE;await f.cleanup();}
});

function* call(name:string,args:unknown,id:string):Generator<StreamChunk>{
  const typed=id as Extract<StreamChunk,{type:'tool-call-delta'}>['id']; const json=JSON.stringify(args);
  yield {type:'block-start',index:0,blockType:'tool-call'};
  yield {type:'tool-call-delta',index:0,id:typed,name,argumentsDelta:json};
  yield {type:'block-end',index:0,block:{type:'tool-call',id:typed,name,arguments:json}};
  yield {type:'finish',reason:{kind:'tool-calls'}};
}

test('planning image views have an enforced dynamic allowance, including forged calls after hiding',async()=>{
  const f=await setup(),events:PublicEvent[]=[];process.env.CADER_IMAGE_VIEW_BUDGET='offline-crop-budget';
  const c=await import('@cader/config').then(m=>m.loadConfig(f.root));let step=0,ref='';
  const runtime=await createLiveRuntime({...c,root:f.root,workspaceRoot:f.root,runDirectory:join(f.root,'.cader/runs/crop-budget'),images:{'source-fixture':join(f.root,'reference.png')},onEvent:e=>events.push(e),profiles:c.profiles.map(p=>({...p,api_key_env:'CADER_IMAGE_VIEW_BUDGET'}))});
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    step++;const tool=request.tools?.find(t=>t.name==='cader_view_image');
    if(step<=2){assert.ok(tool);ref=(tool.parameters as any).properties.image_ref.enum[0];yield* call('cader_view_image',{image_ref:ref,left:0,top:0,width:128,height:128},`view-${step}`);return;}
    assert.ok(!tool);assert.match(JSON.stringify(request.messages),/remaining_image_views.{0,12}0/);
    if(step===3){yield* call('cader_view_image',{image_ref:ref,left:0,top:0,width:128,height:128},'forged-hidden-view');return;}
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'Fixture returned to planning'};yield {type:'block-end',index:0,block:{type:'text',text:'Fixture returned to planning'}};yield {type:'finish',reason:{kind:'stop'}};
  });
  try{const result=await runtime.run('MainAgent','Inspect briefly',{image:'reference.png',onlyTools:['cader_view_image'],maxImageViews:2});assert.equal(result.status,'succeeded',JSON.stringify({step,result,events:events.filter(e=>e.type==='tool.result'||e.type==='agent.error'||e.type==='model.error')}));assert.equal(step,4);assert.equal(events.filter(e=>e.type==='image.attached').length,3);assert.ok(events.some(e=>e.type==='tool.result'&&e.callId==='forged-hidden-view'&&e.isError));}
  finally{await runtime.dispose();delete process.env.CADER_IMAGE_VIEW_BUDGET;await f.cleanup();}
});

test('reference schematic units retain all source pins/nets and share the same authorization before independent acceptance',async()=>{
  const f=await setup(),raw=await readFile(join(f.root,'reference.png')),sha256=createHash('sha256').update(raw).digest('hex');
  const pixels=await readReferenceImage(f.root,'reference.png');let target:string|null=null,created=false,approvals=0;const entities:any[]=[],unitIds:string[]=[];
  const recoveredRuns:any[]=[],attempts=new Map<string,number>();
  const source=parseReferenceObservation({...observation,drawing_kind:'schematic',objects:[{id:'Q',kind:'three-pin',bounds:[[0,0],[0.4,0.4]],terminals:[[0,0],[0,0.2],[0.4,0.4]],certainty:'clear'},{id:'R',kind:'two-pin',bounds:[[0.6,0],[1,0.4]],terminals:[[0.6,0],[1,0.4]],certainty:'clear'}],nets:[{id:'joint',pins:[{object:'Q',terminal:0},{object:'R',terminal:0}]},...['Q:1','Q:2','R:1'].map(id=>({id,pins:[{object:id.split(':')[0],terminal:Number(id.split(':')[1])}]}))]});
  const proposed={version:1,domain:'electrical-schematic',wire_layer:'WIRE',visual_required:true,components:[{id:'Q',source_id:'Q',source_terminals:[0,1,2],kind:'three-pin',bounds:[[-2,0],[0,4]],ports:[[0,0],[-2,2],[0,4]],pin_names:['B','C','E']},{id:'R',source_id:'R',source_terminals:[0,1],kind:'two-pin',bounds:[[10,0],[12,4]],ports:[[10,0],[12,4]],pin_names:['1','2']}],nets:[{id:'joint',pins:[{component:'Q',pin:'B'},{component:'R',pin:'1'}]},...['Q:C','Q:E','R:2'].map(id=>({id,pins:[{component:id.split(':')[0],pin:id.split(':')[1]}]}))],requirements:['netlist','visual','no_wire_through_component','text_clearance','new_document','saved_dwg','source_topology_fidelity'].map(check=>({id:check,check:check==='source_topology_fidelity'?'visual':check,description:check,source_quote:'复现电路'}))};
  const facts=()=>({frozen:false,local_connection_id:'original',scratch:target,session_counts:{committed:entities.length+(created?1:0),unknown:0}});
  const runtime={completed:()=>recoveredRuns,async inspectReference(){return {valid:true,structured:source,net_review:{id:'fixture-source-review',valid:true,changed:false,consensus:true,uncertain_nets:[{...source.nets![0]!,evidence:'PRELIMINARY_OPINION_MUST_NOT_PRIME_REVIEW'}]},evidence:{path:join(f.root,'reference.png'),sha256,width:pixels.width,height:pixels.height}};},async run(_profile:string,_instruction:string,request:any){
    if(request.onlyTools?.includes('cader_submit_acceptance_plan')){
      await assert.rejects(request.extraTools[0].execute({...proposed,requirements:proposed.requirements.filter(r=>r.id!=='source_topology_fidelity')},{concludeTurn(){}}),/SOURCE_TOPOLOGY_VISUAL_RESOLUTION_REQUIRED/);
      await assert.rejects(request.extraTools[0].execute({...proposed,requirements:[...proposed.requirements,{id:'invented-style',check:'visual',source_quote:'复现电路',description:'手绘风格深色笔触与手写字体'}]},{concludeTurn(){}}),/UNREQUESTED_SOURCE_STYLE/);
      const lost=structuredClone(proposed);lost.components[0]!.ports.pop();lost.components[0]!.pin_names.pop();lost.components[0]!.source_terminals.pop();lost.nets=lost.nets.filter(n=>n.id!=='Q:E');
      await assert.rejects(request.extraTools[0].execute(lost,{concludeTurn(){}}),/SOURCE_TERMINALS_MUST_BE_PRESERVED/);
      const wrong=structuredClone(proposed);wrong.components[0]!.source_terminals=[1,0,2];await assert.rejects(request.extraTools[0].execute(wrong,{concludeTurn(){}}),/SOURCE_NETLIST_MISMATCH/);
      await request.extraTools[0].execute(proposed,{concludeTurn(){}});return {status:'succeeded',text:'plan',tools:[]};
    }
    const finish=request.extraTools.find((t:ToolDefinition)=>t.name==='cader_finish_drawing_unit');assert.ok(finish);assert.equal(request.keepExecutionRound,true);
    const id=finish.parameters.properties.unit_id.const;unitIds.push(id);
    const attempt=(attempts.get(id)??0)+1;attempts.set(id,attempt);
    if(id.startsWith('component:')&&attempt<=2){const failed={id:`${id}-failed-${attempt}`,status:'failed',errorCode:attempt===1?'MALFORMED_RESPONSE':'OUTPUT_TRUNCATED',text:'',tools:[]};recoveredRuns.push(failed);return failed;}
    if(id.startsWith('component:')){assert.match(_instruction,/Scheduler响应恢复/);assert.doesNotMatch(_instruction,/old-ledger-sentinel/);}
    if(id==='setup'){assert.equal(created,false);created=true;target='New.dwg';}
    if(id.startsWith('component:')){const c=proposed.components.find(c=>`component:${c.id}`===id)!;for(const port of c.ports)entities.push({object_id:entities.length+1,type:'AcDbLine',layer:'SYMBOL',start_point:[...port,0],end_point:[(c.bounds[0]![0]!+c.bounds[1]![0]!)/2,(c.bounds[0]![1]!+c.bounds[1]![1]!)/2,0],bounding_box:{min:c.bounds[0],max:c.bounds[1]}});}
    if(id==='net:joint')entities.push({object_id:entities.length+1,type:'AcDbLine',layer:'WIRE',start_point:[0,0,0],end_point:[10,0,0]});
    await finish.execute({unit_id:id},{concludeTurn(){}});const success={id:`${id}-ok`,status:'succeeded',text:request.resultText(),tools:[finish.name]};recoveredRuns.push(success);return success;
  },async reviewCadView(_question:string,_signal?:AbortSignal,_reference?:string,details?:{path:string;view:ImageView;label:string}[]){assert.doesNotMatch(_question,/PRELIMINARY_OPINION_MUST_NOT_PRIME_REVIEW/);assert.equal(details?.length,1);assert.equal(details![0]!.path,join(f.root,'reference.png'));assert.match(details![0]!.label,/ORIGINAL Image A detail/);assert.ok(details![0]!.view.crop!.width>0);return {review_valid:true,attempts:[],structured:{verdict:'pass',defects:[],uncertainties:[],checklist:[{requirement_id:'visual',status:'pass',evidence:'Fixture only'},{requirement_id:'source_topology_fidelity',status:'pass',evidence:'Synthetic source connection fidelity only'}]},evidence:{reference:{sha256},document:target}};}};
  const owner={workspace:f.root,facts:()=>({...facts(),operations:Array.from({length:24},(_,i)=>({operation_id:i===0?'old-ledger-sentinel':`ledger-${i}`,outcome:'committed'}))}),definitions:()=>[],taskScope:()=>({owned:true,target,connection:'original',new_drawing_confirmed:created,geometry_confirmed:entities.length,entity_ids:entities.map(e=>e.object_id)}),async snapshot(){return {document:target,entities};},async authorizeTask(){approvals++;return true;},endTask(){},async saveTaskArtifact(){return {kind:'local-dwg',path:join(f.root,'result.dwg'),sha256:'fixture-only',bytes:100};}};
  try{
    const result=await runQualityTask({runtime,owner,task:'新建并复现电路',profile:'fixture',emit(){},persist:async()=>{},referenceTask:{freshDrawing:true,outputPath:join(f.root,'result.dwg'),request:'新建并复现电路',image:{path:join(f.root,'reference.png'),sha256,bytes:raw.length,width:pixels.width,height:pixels.height,kind:'image'}}} as unknown as Parameters<typeof runQualityTask>[0]);
    assert.equal(result.phase,'complete');assert.equal(approvals,1);assert.equal(result.checkpoints.length,4);assert.equal(recoveredRuns.filter(r=>r.status==='failed'&&r.recovered_by).length,4);assert.equal(unitIds.filter(id=>id==='setup').length,1);assert.equal(result.drawing_units.length,7);assert.ok(result.drawing_units.every(u=>u.status==='checked_in'&&u.snapshot_sha256));
  }finally{await f.cleanup();}
});

test('source label clarification requires an explicit literal user quote and preserves uncertain OCR evidence',async()=>{
  const f=await setup(),pixels=await readReferenceImage(f.root,'reference.png'),sha256=createHash('sha256').update(pixels.data).digest('hex');
  const quote='补充确认：10kΩ',task='复现手稿。'+quote;
  const runtime={completed:()=>[],async inspectReference(){return {valid:true,structured:structuredClone({...observation,visible_text:[{text:'10K',certainty:'uncertain',bounds:[[0.2,0.2],[0.8,0.4]]}]}),evidence:{path:join(f.root,'reference.png'),sha256,width:pixels.width,height:pixels.height}};},async run(_profile:string,_instruction:string,request:any){
    const proposed={version:1,domain:'generic',components:[],visual_required:true,requirements:[{id:'visual',source_quote:'复现手稿',description:'Source appearance',check:'visual'},{id:'literal',source_quote:quote,description:'User clarified value',check:'text',text:'10kΩ',min:1}]};
    await assert.rejects(request.extraTools[0].execute(proposed,{concludeTurn(){}}),/EXPLICIT_SOURCE_CLARIFICATIONS_UNREVIEWED/);
    const confirm=request.extraTools.find((t:ToolDefinition)=>t.name==='cader_confirm_source_labels');assert.ok(confirm);
    await assert.rejects(confirm.execute({labels:[{index:0,text:'5kΩ',source_quote:quote}]}),/EXPLICIT_USER_CONFIRMATION_REQUIRED/);
    await assert.rejects(confirm.execute({labels:[{index:0,text:'10kΩ',source_quote:'伪造确认10kΩ'}]}),/EXPLICIT_USER_CONFIRMATION_REQUIRED/);
    await assert.rejects(confirm.execute({labels:[{index:99,text:'10kΩ',source_quote:quote}]}),/EXPLICIT_USER_CONFIRMATION_REQUIRED/);
    await confirm.execute({labels:[{index:0,text:'10kΩ',source_quote:quote}]});
    await request.extraTools[0].execute({version:1,domain:'generic',components:[],visual_required:true,requirements:[{id:'visual',source_quote:'复现手稿',description:'Source appearance',check:'visual'},{id:'literal',source_quote:quote,description:'User clarified value',check:'text',text:'10kΩ',min:1}]},{concludeTurn(){}});return {status:'succeeded',text:'plan',tools:[]};
  }};
  const owner={workspace:f.root,facts:()=>({frozen:false,local_connection_id:'fixture',scratch:null}),async authorizeTask(){return false;},endTask(){}};
  try{
    const result=await runQualityTask({runtime,owner,task,profile:'fixture',emit(){},persist:async()=>{},referenceTask:{request:task,freshDrawing:true,outputPath:join(f.root,'result.dwg'),image:{path:join(f.root,'reference.png'),sha256,kind:'image',bytes:pixels.data.length,width:pixels.width,height:pixels.height}}} as unknown as Parameters<typeof runQualityTask>[0]);
    assert.equal(result.phase,'blocked');assert.equal(result.label_confirmations.length,1);assert.equal((result.label_confirmations[0]!.original_reading as {certainty:string}).certainty,'uncertain');assert.equal(result.label_confirmations[0]!.image_sha256,sha256);assert.equal(result.reference_observation!.structured!.visible_text[0]!.text,'10kΩ');
  }finally{await f.cleanup();}
});

test('an inapplicable user clarification is reviewed without clearing a different uncertain source label',async()=>{
  const f=await setup(),pixels=await readReferenceImage(f.root,'reference.png'),sha256=createHash('sha256').update(pixels.data).digest('hex'),task='复现手稿。确认另一处为10kΩ';
  const runtime={completed:()=>[],async inspectReference(){return {valid:true,structured:structuredClone({...observation,visible_text:[{text:'7?',certainty:'uncertain',bounds:[[0.2,0.2],[0.8,0.4]]}]}),evidence:{path:join(f.root,'reference.png'),sha256,width:pixels.width,height:pixels.height}};},async run(_p:string,_i:string,request:any){
    const plan={version:1,domain:'generic',components:[],visual_required:true,requirements:[{id:'visual',source_quote:'复现手稿',description:'Source appearance',check:'visual'}]};
    await assert.rejects(request.extraTools[0].execute(plan,{concludeTurn(){}}),/EXPLICIT_SOURCE_CLARIFICATIONS_UNREVIEWED/);
    const review=request.extraTools.find((t:ToolDefinition)=>t.name==='cader_confirm_source_labels');
    await review.execute({labels:[],unconfirmed:[{index:0,reason:'User confirmation refers to a different source position; this reading remains uncertain.'}]});
    await request.extraTools[0].execute(plan,{concludeTurn(){}});return {status:'succeeded',text:'fixture plan',tools:[]};
  }};
  const owner={workspace:f.root,facts:()=>({frozen:false,local_connection_id:'fixture',scratch:null}),async authorizeTask(){return false;},endTask(){}};
  try{const q=await runQualityTask({runtime,owner,task,profile:'fixture',emit(){},persist:async()=>{},referenceTask:{request:task,freshDrawing:true,outputPath:join(f.root,'result.dwg'),image:{path:join(f.root,'reference.png'),sha256,width:pixels.width,height:pixels.height}}} as never);assert.equal(q.label_confirmations.length,0);assert.equal(q.unconfirmed_label_reviews.length,1);assert.equal(q.reference_observation!.structured!.visible_text[0]!.certainty,'uncertain');assert.equal(q.quality_accepted,false);}
  finally{await f.cleanup();}
});

for(const persistFails of [false,true])test(`source connection confirmation precedes sealing and rolls back failed persistence: ${persistFails}`,async()=>{
  const f=await setup(),pixels=await readReferenceImage(f.root,'reference.png'),sha256=createHash('sha256').update(pixels.data).digest('hex'),quote='连接确认：A与B连通',task='复现参考电路。'+quote;let grants=0;
  const source=parseReferenceObservation({...observation,drawing_kind:'schematic',objects:['A','B'].map((id,i)=>({id,kind:'terminal',category:'component',bounds:[[i*0.5,0],[i*0.5+0.4,0.4]],terminals:[[i*0.5,0]],certainty:'clear'})),nets:['A','B'].map(object=>({id:object,pins:[{object,terminal:0}],certainty:object==='A'?'clear':'uncertain'}))});
  const plan={version:1,domain:'electrical-schematic',wire_layer:'WIRE',visual_required:true,components:['A','B'].map((id,i)=>({id,source_id:id,source_terminals:[0],kind:'terminal',bounds:[[i*3,0],[i*3+1,1]],ports:[[i*3,0]],pin_names:['p']})),nets:[{id:'joined',pins:['A','B'].map(component=>({component,pin:'p'}))}],requirements:['visual','netlist','no_wire_through_component','text_clearance'].map(check=>({id:check,check,description:'Synthetic condition',source_quote:'复现参考电路'}))};
  const runtime={completed:()=>[],async inspectReference(){return {valid:true,structured:structuredClone(source),evidence:{path:join(f.root,'reference.png'),sha256,width:pixels.width,height:pixels.height}};},async run(_p:string,_i:string,request:any){
    if(request.onlyTools[0]==='cader_submit_acceptance_plan'){await request.extraTools[0].execute(plan,{concludeTurn(){}});return {status:'succeeded',text:'fixture plan',tools:[]};}
    await assert.rejects(request.extraTools[0].execute(plan,{concludeTurn(){}}),/EXPLICIT_SOURCE_CONNECTIONS_UNREVIEWED/);
    const confirm=request.extraTools.find((t:ToolDefinition)=>t.name==='cader_confirm_source_connections'),pins=['A','B'].map(object=>({object,terminal:0}));assert.ok(confirm);
    await assert.rejects(confirm.execute({connections:[{pins,source_quote:'伪造连接确认'}]}),/EXPLICIT_USER_CONNECTION_QUOTE_REQUIRED/);
    await assert.rejects(confirm.execute({connections:[{pins:[pins[0],{object:'absent',terminal:0}],source_quote:quote}]}),/UNKNOWN_PIN/);
    if(persistFails){await assert.rejects(confirm.execute({connections:[{pins,source_quote:quote}]}),/fixture persist/);await assert.rejects(request.extraTools[0].execute(plan,{concludeTurn(){}}),/EXPLICIT_SOURCE_CONNECTIONS_UNREVIEWED/);return {status:'failed',errorCode:'FIXTURE_PERSIST_FAILED',tools:[],text:''};}
    await confirm.execute({connections:[{pins,source_quote:quote}]},{concludeTurn(){}});return {status:'succeeded',text:'fixture plan',tools:[]};
  }};
  const owner={workspace:f.root,facts:()=>({frozen:false,local_connection_id:'fixture',scratch:null}),taskScope:()=>({owned:false,new_drawing_confirmed:false,geometry_confirmed:0}),async authorizeTask(){grants++;return false;},endTask(){}};
  try{const q=await runQualityTask({runtime,owner,task,profile:'fixture',emit(){},persist:async(state:any)=>{if(persistFails&&state.connection_confirmations.length)throw new Error('fixture persist failure');},referenceTask:{request:task,freshDrawing:true,outputPath:join(f.root,'fixture.dwg'),image:{path:join(f.root,'reference.png'),sha256,width:pixels.width,height:pixels.height}}} as never);assert.equal(q.connection_confirmations.length,persistFails?0:1);assert.equal(q.reference_observation!.structured!.nets!.length,persistFails?2:1);assert.equal(grants,persistFails?0:1);if(!persistFails){assert.equal((q.connection_confirmations[0]!.original_nets as unknown[]).length,2);assert.equal(q.connection_confirmations[0]!.image_sha256,sha256);}assert.equal(q.quality_accepted,false);}
  finally{await f.cleanup();}
});

test('source label reread gets original pixels plus a real crop and replaces the earlier unverified unit',async()=>{
  const f=await setup();process.env.CADER_LABEL_FIXTURE='offline-label-only';let reads=0;const events:PublicEvent[]=[];
  const config=await import('@cader/config').then(m=>m.loadConfig(f.root));
  const runtime=await createLiveRuntime({root:f.root,workspaceRoot:f.root,runDirectory:join(f.root,'.cader/runs/labels'),...config,onEvent:e=>events.push(e),profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_LABEL_FIXTURE'}))});
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    if(request.tools?.some(t=>t.name==='cader_submit_reference_observation')){yield* call('cader_submit_reference_observation',{...observation,visible_text:[{text:'2MF',certainty:'clear',bounds:[[0.2,0.2],[0.8,0.4]]}]},'initial-label');return;}
    if(request.tools?.some(t=>t.name==='cader_submit_reference_label_inventory')){yield* call('cader_submit_reference_label_inventory',{visible_text:[{text:'2MF',certainty:'clear',bounds:[[0.2,0.2],[0.8,0.4]]}]},'inventory');return;}
    assert.ok(request.tools?.some(t=>t.name==='cader_submit_reference_labels'));
    const images=JSON.parse(JSON.stringify(request.messages)).flatMap((m:{content:unknown[]})=>m.content).filter((b:{type:string})=>b.type==='image');
    assert.equal(images.length,2);assert.match(JSON.stringify(request.messages),/label crop index=0/);assert.match(JSON.stringify(request.messages),/normalized_view_to_original/);assert.match(JSON.stringify(request.messages),/Target ORIGINAL normalized bounds/);
    const blocks=JSON.parse(JSON.stringify(request.messages)).flatMap((m:{content:{type:string;text?:string}[]})=>m.content) as {type:string;text?:string}[];const audits=blocks.filter(b=>b.text?.startsWith('Image coordinate evidence: ')).map(b=>JSON.parse(b.text!.slice('Image coordinate evidence: '.length)));assert.equal(audits.length,2);assert.deepEqual(audits[0].normalized_view_to_original,[1,0,0,0,1,0]);assert.deepEqual(audits[1].normalized_view_to_original,[audits[1].crop_original_pixels.width/audits[1].original_pixels.width,0,audits[1].crop_original_pixels.left/audits[1].original_pixels.width,0,audits[1].crop_original_pixels.height/audits[1].original_pixels.height,audits[1].crop_original_pixels.top/audits[1].original_pixels.height]);
    if(reads++===0){yield* call('cader_submit_reference_labels',{labels:[{index:0,text:'2μF',certainty:'clear',bounds:[[0,0],[1,1]]}]},'bad-bounds');return;}
    assert.match(JSON.stringify(request.messages),/SOURCE_LABEL_BOUNDS_OUTSIDE_CROP/);yield* call('cader_submit_reference_labels',{labels:[{index:0,text:'2μF',certainty:'clear'}]},'refined-label');
  });
  try{const result=await runtime.inspectReference('reference.png','Read synthetic label');assert.equal(result.valid,true);assert.equal(result.structured!.visible_text[0]!.text,'2μF');assert.equal(result.attempts.length,3);result.structured!.visible_text[0]!.text='Later user clarification';assert.equal((events.find(e=>e.type==='reference.inspected')!.structured as typeof result.structured)!.visible_text[0]!.text,'2μF','later clarification must not rewrite the captured OCR event');}
  finally{await runtime.dispose();delete process.env.CADER_LABEL_FIXTURE;await f.cleanup();}
});

for(const scenario of ['clear','conflict','consensus','reread-stability','missing-component','restore-original','three-way-conflict'] as const)test(`independent source-net tracing preserves uncertainty and partitions: ${scenario}`,async()=>{
  const uncertain=!['clear','missing-component','restore-original','three-way-conflict'].includes(scenario),same=['consensus','restore-original'].includes(scenario);let sourceReviewCalls=0;
  const f=await setup();process.env.CADER_NET_REVIEW_FIXTURE='offline-net-review';
  const config=await import('@cader/config').then(m=>m.loadConfig(f.root));
  const runtime=await createLiveRuntime({root:f.root,workspaceRoot:f.root,runDirectory:join(f.root,'.cader/runs/net-review'),...config,profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_NET_REVIEW_FIXTURE'}))});
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    if(request.tools?.some(t=>t.name==='cader_submit_reference_observation')){yield* call('cader_submit_reference_observation',{...observation,drawing_kind:'schematic',objects:[{id:'Q',kind:'three-pin',category:'component',bounds:[[0,0],[1,1]],terminals:[[0,0],[1,0],[1,1]],certainty:'clear'}],nets:same?[0,1,2].map(terminal=>({id:String(terminal),pins:[{object:'Q',terminal}],certainty:'clear'})):[{id:'prior-short',pins:[0,1,2].map(terminal=>({object:'Q',terminal})),certainty:scenario==='reread-stability'?'uncertain':'clear'}]},'observation');return;}
    if(request.tools?.some(t=>t.name==='cader_submit_reference_component_inventory')){yield* call('cader_submit_reference_component_inventory',{objects:[{id:'inventory-Q',kind:'three-pin',category:'component',bounds:[[0,0],[1,1]],terminals:[[0,0],[1,0],[1,1]],certainty:'clear'},...(scenario==='missing-component'?[{id:'X',kind:'unlabelled one-pin component',category:'component',bounds:[[0.1,0.1],[0.2,0.2]],terminals:[[0.15,0.1]],certainty:'clear'}]:[])]},'components');return;}
    if(request.tools?.some(t=>t.name==='cader_submit_reference_nets')){const pass=sourceReviewCalls++;const regress=scenario==='reread-stability'&&pass>0||scenario==='restore-original'&&pass===0||scenario==='three-way-conflict'&&pass>0;assert.match(JSON.stringify(request.messages),/禁止按常见电路知识补全/);assert.match(JSON.stringify(request.messages),/Read synthetic branched source/);yield* call('cader_submit_reference_nets',{missing_objects:scenario==='missing-component'?[]:[{id:'X',kind:'one-pin marker',category:'component',bounds:[[0.1,0.1],[0.2,0.2]],terminals:[[0.15,0.1]],certainty:'clear'}],membership:{'Q:0':'0','Q:1':regress?'0':'1','Q:2':'2','X:0':'new-marker'},nets:[...[0,1,2].filter(terminal=>!regress||terminal!==1).map(terminal=>({id:String(terminal),evidence:'Synthetic test evidence only',certainty:uncertain&&terminal===2?'uncertain':'clear'})),{id:'new-marker',evidence:'Synthetic independently inventoried marker only',certainty:'clear'}]},'net-review');return;}
    if(request.tools?.some(t=>t.name==='cader_submit_reference_label_inventory')){yield* call('cader_submit_reference_label_inventory',{visible_text:[]},'inventory');return;}
    throw new Error('No CAD calls in source inspection');
  });
  try{const result=await runtime.inspectReference('reference.png','Read synthetic branched source');const accepted=!['conflict','three-way-conflict'].includes(scenario);assert.equal(result.valid,accepted);assert.equal(result.net_review?.changed,true);assert.equal(result.net_review?.valid,accepted);if(scenario==='missing-component'){assert.deepEqual(result.component_inventory!.added,['X']);assert.equal(result.component_inventory!.valid,true);}if(scenario==='reread-stability'){assert.equal(sourceReviewCalls,2);assert.notEqual(result.structured!.nets!.find(n=>n.pins.some(p=>p.object==='Q'&&p.terminal===0))!.id,result.structured!.nets!.find(n=>n.pins.some(p=>p.object==='Q'&&p.terminal===1))!.id);}if(same){assert.equal(result.net_review?.consensus,true);assert.ok(result.net_review?.uncertain_nets?.length);}if(accepted){assert.equal(result.structured?.nets?.length,4);assert.equal(result.structured?.objects.length,2);}}
  finally{await runtime.dispose();delete process.env.CADER_NET_REVIEW_FIXTURE;await f.cleanup();}
});

test('label review covers beyond the first four, prioritizes uncertainty and only retries unresolved original indices',async()=>{
  const f=await setup();process.env.CADER_LABEL_BATCH_FIXTURE='offline-label-batches';
  const config=await import('@cader/config').then(m=>m.loadConfig(f.root));
  const runtime=await createLiveRuntime({root:f.root,workspaceRoot:f.root,runDirectory:join(f.root,'.cader/runs/label-batches'),...config,runtime:{...config.runtime,max_delegations:1},captureCadView:async()=>({path:join(f.root,'reference.png'),evidence:{document:'fixture.dwg'}}),profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_LABEL_BATCH_FIXTURE'}))});
  const batches:number[][]=[];
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    if(request.tools?.some(t=>t.name==='cader_submit_reference_observation')){
      yield* call('cader_submit_reference_observation',{...observation,visible_text:Array.from({length:8},(_,i)=>({text:`${i}MF`,certainty:'clear',bounds:[[0.1+(i%3)*0.25,0.1+Math.floor(i/3)*0.25],[0.25+(i%3)*0.25,0.2+Math.floor(i/3)*0.25]]}))},'initial');return;
    }
    if(request.tools?.some(t=>t.name==='cader_submit_reference_label_inventory')){yield* call('cader_submit_reference_label_inventory',{visible_text:Array.from({length:9},(_,i)=>({text:`${i}MF`,certainty:i===8?'uncertain':'clear',bounds:[[0.1+(i%3)*0.25,0.1+Math.floor(i/3)*0.25],[0.25+(i%3)*0.25,0.2+Math.floor(i/3)*0.25]]}))},'inventory');return;}
    if(request.tools?.some(t=>t.name==='cader_submit_visual_report')){yield* call('cader_submit_visual_report',{verdict:'pass',defects:[],uncertainties:[],checklist:[]},'reserved-final-review');return;}
    const raw=JSON.stringify(request.messages),indices=[...raw.matchAll(/label crop index=(\d+)/g)].map(m=>Number(m[1]));
    const selected=[...new Set(indices)];batches.push(selected);if(selected.length>1){const schema=request.tools!.find(t=>t.name==='cader_submit_reference_labels')!.parameters as any;assert.equal(schema.properties.labels.items.properties.bounds,undefined);}
    assert.ok(selected.length<=4&&selected.length>0);
    if(batches.length===1){assert.equal(selected[0],8);yield* call('cader_submit_reference_labels',{labels:[...selected.slice(1),99].map(index=>({index,text:'bad',certainty:'clear'}))},'wrong-index');return;}
    yield* call('cader_submit_reference_labels',{labels:selected.map(index=>({index,text:`${index}μF`,certainty:index===8&&batches.length===2?'uncertain':'clear'}))},`batch-${batches.length}`);
  });
  try{
    const result=await runtime.inspectReference('reference.png','Read ALL synthetic labels');
    assert.equal(result.valid,true);assert.equal(result.structured!.visible_text.length,9);
    assert.ok(result.structured!.visible_text.every((l,i)=>l.text===`${i}μF`&&l.certainty==='clear'));
    assert.deepEqual(result.label_reviews.map(r=>r.indices),[[8,0,1,2],[3,4,5,6],[7],[8]]);
    assert.ok(runtime.reviewStats().source_review_reservations>1);assert.equal(runtime.reviewStats().agent_delegations,0);assert.equal((await runtime.reviewCadView('Synthetic budget check')).review_valid,true);assert.equal(runtime.reviewStats().model_calls,1);
  }finally{await runtime.dispose();delete process.env.CADER_LABEL_BATCH_FIXTURE;await f.cleanup();}
});

test('source label formatting has bounded repair and remains uncertain without actual confirmation',async()=>{
  const f=await setup();process.env.CADER_REPAIR_FIXTURE='offline-source-repair';const config=await import('@cader/config').then(m=>m.loadConfig(f.root));let reads=0;
  const runtime=await createLiveRuntime({root:f.root,workspaceRoot:f.root,runDirectory:join(f.root,'.cader/runs/repair'),...config,profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_REPAIR_FIXTURE'}))});
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    if(request.tools?.some(t=>t.name==='cader_submit_reference_observation')){yield* call('cader_submit_reference_observation',{...observation,visible_text:[{text:'7?',bounds:[[0.2,0.2],[0.4,0.3]],certainty:'uncertain'}]},'source');return;}
    if(request.tools?.some(t=>t.name==='cader_submit_reference_label_inventory')){yield* call('cader_submit_reference_label_inventory',{visible_text:[{text:'7?',bounds:[[0.2,0.2],[0.4,0.3]],certainty:'uncertain'}]},'inventory');return;}
    reads++;yield* call('cader_submit_reference_labels',{labels:[{index:99,text:'7F',certainty:'clear'}]},`invalid-${reads}`);
  });
  try{const result=await runtime.inspectReference('reference.png','Synthetic bounded repair');assert.equal(reads,6);assert.equal(result.structured!.visible_text[0]!.certainty,'uncertain');assert.equal(result.label_reviews.every(r=>!r.valid),true);assert.equal(runtime.completed().filter(r=>r.errorCode==='INVOCATION_MODEL_STEP_BUDGET_EXCEEDED').length,2);assert.equal(runtime.completed().filter(r=>r.recovered_by).length,0);}
  finally{await runtime.dispose();delete process.env.CADER_REPAIR_FIXTURE;await f.cleanup();}
});

for(const kind of ['complete','pending','quota','source-uncertain','budget','capture-error'])test(`actual DSH reference task binds fresh CAD and verified DWG: ${kind}`,async()=>{
  const initiallyPending=kind==='pending';
  const f=await setup(); const previous=process.env.CADER_REDRAW_FIXTURE;process.env.CADER_REDRAW_FIXTURE='offline-redraw-only';
  const events:PublicEvent[]=[],calls:string[]=[];let target='Old.dwg',steps=0,planningImages=0,reviewImages=0,reviewCalls=0,reportAttempts=0;
  const old=[{object_id:7,type:'AcDbCircle',layer:'0'}];let entities:Record<string,unknown>[]=old;
  const snapshot=Buffer.from((await prepareImageView(f.root,'reference.png',{rotation:90})).data);
  const defs:ToolDefinition[]=['new_drawing','draw_line','save_drawing','list_layers','query_entities','get_entity','get_backend_status','export_current_view'].map(name=>({
    name:`mcp__autocad__${name}`,description:'Synthetic MCP; no real CAD',parameters:{type:'object'},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},execute:async()=>{throw new Error('owner required');}
  }));
  const client:typeof createMcpClient=async()=>({definitions:()=>defs,toolNames:()=>defs.map(t=>t.name.split('__').at(-1)!),async dispose(){},
    async call(name,args){calls.push(name);
      if(name==='new_drawing'){target='Fresh.dwg';entities=[];return target;}
      if(name==='draw_line'){entities.push({object_id:42,type:'AcDbLine',layer:'0',start_point:[0,0,0],end_point:[10,0,0]});return 'draw_line ok, object_id=42';}
      if(name==='list_layers')return ['0'];
      if(name==='query_entities')return structuredClone(entities);
      if(name==='get_entity')return structuredClone(entities.find(e=>e.object_id===args.object_id));
      if(name==='save_drawing'){await writeFile(String(args.file_path),'AC1032 synthetic test only, not a usable DWG');return 'saved fixture';}
      if(name==='export_current_view'){await writeFile(String(args.file_path),snapshot);return args.file_path;}
      return {backend:'com'};
    }});
  const factory:typeof createLiveRuntime=async options=>{
    const runtime=await createLiveRuntime({...options,...(kind==='capture-error'?{captureCadView:async()=>{throw new Error('FIXTURE_CAPTURE_EXCEPTION');}}:{}),profiles:options.profiles.map(p=>({...p,api_key_env:'CADER_REDRAW_FIXTURE'}))});
    runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
      const images=JSON.parse(JSON.stringify(request.messages)).flatMap((m:{content:unknown[]})=>m.content).filter((b:{type:string})=>b.type==='image');
      if(request.tools?.some(t=>t.name==='cader_submit_reference_observation')){
        assert.ok(images.length);yield* call('cader_submit_reference_observation',kind==='source-uncertain'?{...observation,visible_text:[{text:'2mF',bounds:[[0.2,0.2],[0.8,0.4]],certainty:'uncertain'}]}:observation,'observation');return;
      }
      if(request.tools?.some(t=>t.name==='cader_submit_reference_label_inventory')){yield* call('cader_submit_reference_label_inventory',{visible_text:[{text:'2mF',bounds:[[0.2,0.2],[0.8,0.4]],certainty:'uncertain'}]},'inventory');return;}
      if(request.tools?.some(t=>t.name==='cader_submit_reference_labels')){assert.equal(images.length,2);yield* call('cader_submit_reference_labels',{labels:[{index:0,text:'2mF',certainty:'uncertain'}]},'labels');return;}
      if(request.tools?.some(t=>t.name==='cader_submit_acceptance_plan')){
        planningImages=images.length;assert.ok(planningImages>=1);
        yield* call('cader_submit_acceptance_plan',{version:1,domain:'generic',requirements:[{id:'appearance',source_quote:'复现',description:'Match the supplied synthetic source',check:'visual'},{id:'new',source_quote:'新建空白图纸',description:'New task drawing',check:'new_document'},{id:'saved',source_quote:'result.dwg',description:'Requested file',check:'saved_dwg'}],components:[],visual_required:true},'plan');return;
      }
      if(request.tools?.some(t=>t.name==='cader_submit_visual_report')){
        reviewImages=images.length;assert.equal(reviewImages,2);assert.match(JSON.stringify(request.messages),/ORIGINAL USER REFERENCE/);
        if(reportAttempts++===0){yield* call('cader_submit_visual_report',{verdict:'fail',defects:[{type:'fixture',severity:'major',location:'unknown',evidence:'Synthetic nonexistent ID',suggestion:'Query actual IDs',entity_ids:[9999]}],uncertainties:[],checklist:[]},'bad-id');return;}
        if(reportAttempts===2){assert.match(JSON.stringify(request.messages),/UNKNOWN_REVIEW_ENTITY_ID/);yield* call('cader_submit_visual_report',{verdict:'pass',defects:[],uncertainties:[],checklist:[{requirement_id:'invented-condition',status:'pass',evidence:'Must be rejected'}]},'bad-checklist');return;}
        if(reportAttempts===3){assert.match(JSON.stringify(request.messages),/REVIEW_CHECKLIST_MISMATCH/);yield* call('cader_submit_visual_report',{verdict:'uncertain',defects:[],uncertainties:['Unrequested reference missing'],checklist:[{requirement_id:'appearance',status:'pass',evidence:'All required observations passed'}]},'global-uncertainty');return;}
        if(reportAttempts===4)assert.match(JSON.stringify(request.messages),/UNCERTAINTY_MUST_AFFECT_REQUIRED_CHECK/);
        const pending=initiallyPending&&reviewCalls++===0;
        yield* call('cader_submit_visual_report',{verdict:pending?'uncertain':'pass',defects:[],uncertainties:pending?['Synthetic unresolved appearance']:[],checklist:[{requirement_id:'appearance',status:pending?'uncertain':'pass',evidence:'Synthetic report only, not a real visual judgement'}]},'review');return;
      }
      assert.ok(!request.tools?.some(t=>t.name.endsWith('__save_drawing')),'model cannot choose another output path');
      const n=steps++;
      if(n===0){yield* call('mcp__autocad__draw_line',{start_x:0,start_y:0,start_z:0,end_x:10,end_y:0,end_z:0},'old-write');return;}
      if(n===1){assert.match(JSON.stringify(request.messages),/NEW_TASK_DRAWING_REQUIRED/);yield* call('mcp__autocad__new_drawing',{},'new');return;}
      if(n===2){yield* call('mcp__autocad__draw_line',{start_x:0,start_y:0,start_z:0,end_x:10,end_y:0,end_z:0},'line');return;}
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'Synthetic geometry ready'};
      yield {type:'block-end',index:0,block:{type:'text',text:'Synthetic geometry ready'}};yield {type:'finish',reason:{kind:'stop'}};
    });
    if(kind==='budget'){const run=runtime.run;runtime.run=async(...args)=>{const result=await run(...args);if(!args[2]?.onlyTools&&calls.includes('draw_line'))return {...result,status:'succeeded',handoff:{kind:'budget',code:'TASK_TOKEN_BUDGET_EXCEEDED',renewable:false}};return result;};}
    if(kind==='quota'){
      const run=runtime.run;
      runtime.run=async(...args)=>{const result=await run(...args);if(!args[2]?.onlyTools&&calls.includes('draw_line'))Object.assign(result,{status:'failed',errorCode:'QUOTA'});return result;};
    }
    return runtime;
  };
  const chat=await InteractiveSession.create(f.root,f.root,(root,input)=>runTask(root,input,factory));
  await chat.execution.dispose();chat.execution=new ExecutionSession(f.root,join(f.root,'.cader/runs/owner'),undefined,client);
  await chat.execution.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
  chat.state.mcp=join(f.root,'configs/mcp/AutoCAD.example.yaml');
  let approvals=0;
  try{
    const callbacks={confirm:async()=>{approvals++;return true;},onEvent:(e:PublicEvent)=>events.push(e)};
    let result=await chat.execute('根据 reference.png 复现图形，新建空白图纸并保存为 result.dwg',callbacks);
    if(kind==='capture-error'){const saved=JSON.parse(await readFile(chat.state.qualityRun!,'utf8'));assert.equal(result.error,true);assert.equal(saved.phase,'pending_verification');assert.equal(saved.quality_accepted,false);assert.ok(saved.artifact);assert.equal(saved.visual_error,'FIXTURE_CAPTURE_EXCEPTION');assert.equal(saved.execution.frozen,false);assert.equal(calls.filter(n=>n==='save_drawing').length,1);return;}
    if(kind==='source-uncertain'){
      const uncertain=JSON.parse(await readFile(chat.state.qualityRun!,'utf8'));
      assert.equal(result.error,true);assert.equal(uncertain.phase,'pending_verification');assert.ok(uncertain.artifact);assert.equal(uncertain.quality_accepted,false);assert.ok(uncertain.checks.some((c:{id:string;status:string})=>c.id==='source_labels_uncertain'&&c.status==='not_run'));assert.equal(calls.filter(n=>n==='new_drawing').length,1);return;
    }
    if(kind==='budget'){const paused=JSON.parse(await readFile(chat.state.qualityRun!,'utf8'));assert.equal(result.error,true);assert.equal(paused.phase,'pending_verification');assert.equal(paused.failure.code,'TASK_TOKEN_BUDGET_EXCEEDED');assert.equal(paused.quality_accepted,false);assert.ok(paused.artifact);assert.equal(calls.filter(n=>n==='save_drawing').length,1);assert.equal(paused.execution.frozen,false);return;}
    if(kind==='quota'){
      const interrupted=JSON.parse(await readFile(chat.state.qualityRun!,'utf8'));
      assert.equal(result.error,true);assert.match(result.text,/QUOTA/);assert.match(result.text,/待验稿/);
      assert.equal(interrupted.phase,'blocked');assert.equal(interrupted.failure.code,'QUOTA');assert.equal(interrupted.quality_accepted,false);
      assert.ok(interrupted.artifact);assert.equal(calls.filter(n=>n==='save_drawing').length,1);assert.equal(interrupted.execution.frozen,false);return;
    }
    if(initiallyPending){
      const pending=JSON.parse(await readFile(chat.state.qualityRun!,'utf8'));
      assert.equal(result.error,true);assert.equal(pending.phase,'pending_verification');assert.equal(pending.quality_accepted,false);assert.ok(pending.artifact);
      result=await chat.execute('继续',callbacks);
    }
    const manifest=JSON.parse(await readFile(chat.state.qualityRun!,'utf8'));
    assert.equal(result.error,false,result.text+'\n'+JSON.stringify(manifest.visual));assert.match(result.text,/DWG已生成并校验/);
    assert.ok(planningImages);assert.equal(reviewImages,2);assert.equal(approvals,initiallyPending?2:1);
    assert.equal(calls.filter(n=>n==='draw_line').length,1);assert.equal(calls.filter(n=>n==='new_drawing').length,1);
    assert.deepEqual(old,[{object_id:7,type:'AcDbCircle',layer:'0'}]);
    assert.equal(manifest.phase,'complete');assert.equal(manifest.execution.frozen,false);
    assert.equal(manifest.reviews[0].source_bound,true);assert.equal(manifest.artifact.path,join(f.root,'result.dwg'));
    assert.equal(manifest.artifact.sha256,createHash('sha256').update(await readFile(join(f.root,'result.dwg'))).digest('hex'));
    const mark=calls.length;await chat.execute('继续');assert.equal(calls.length,mark,'completed task must not replay');
    await writeFile(join(f.root,'replacement.png'),snapshot);await chat.execute('/open replacement.png');
    const switched=await chat.execute('继续');assert.equal(switched.error,true);assert.match(switched.text,/参考图已更换/);assert.equal(calls.length,mark,'a source change must not become an untracked CAD continuation');
  }finally{await chat.dispose();if(previous===undefined)delete process.env.CADER_REDRAW_FIXTURE;else process.env.CADER_REDRAW_FIXTURE=previous;await f.cleanup();}
});

test('semantic units receive sealed custom symbol and label layers rather than losing plan constraints',async()=>{
  const f=await setup(),path=join(f.root,'reference.png'),sha256=createHash('sha256').update(await readFile(path)).digest('hex');
  const task='复现参考图；补充确认：R8',rows:Record<string,any>[]=[],instructions:string[]=[];let target:string|null=null,committed=0,rejectConfirmationOnce=true,sealed:any=null;
  const plan={version:1,domain:'electrical-schematic',wire_layer:'WIRE',visual_required:true,
    components:[{id:'A',source_id:'source',source_terminals:[0],kind:'terminal',bounds:[[0,0],[1,1]],ports:[[0,0]],pin_names:['p']}],nets:[{id:'single',pins:[{component:'A',pin:'p'}]}],
    requirements:[{id:'appearance',check:'visual',source_quote:task,description:'Synthetic appearance'},{id:'net',check:'netlist',source_quote:task,description:'External conductor partition'},{id:'through',check:'no_wire_through_component',source_quote:task,description:'No interior wires'},{id:'clearance',check:'text_clearance',source_quote:task,description:'No text intersections'},
      {id:'text',check:'text',source_quote:task,description:'Source label',text:'R8',min:1,layer:'CUSTOM_LABELS'},{id:'symbol',check:'entity_count',entity_type:'AcDbLine',source_quote:task,description:'Observed symbol geometry',min:1,layer:'CUSTOM_SYMBOL'}]};
  const source=parseReferenceObservation({...observation,drawing_kind:'schematic',objects:[{id:'source',kind:'terminal',category:'component',bounds:[[0,0],[1,1]],terminals:[[0,0]],certainty:'clear'}],nets:[{id:'single',pins:[{object:'source',terminal:0}]}],visible_text:[{text:'R7',bounds:[[0.2,0.2],[0.4,0.3]],certainty:'clear'},{text:'+',bounds:[[0.0001,0.9995],[0.0005,0.9999]],certainty:'clear'}]});
  const owner={workspace:f.root,facts:()=>({frozen:false,local_connection_id:'fixture',scratch:target,session_counts:{committed,unknown:0},operations:[]}),
    taskScope:()=>({owned:Boolean(target),target,new_drawing_confirmed:Boolean(target),geometry_confirmed:rows.length,entity_ids:rows.map(r=>r.object_id)}),definitions:()=>[],async authorizeTask(_id:string,plan:any){sealed=plan;return true;},endTask(){},
    async snapshot(){return {document:target,entities:structuredClone(rows)};},async saveTaskArtifact(){committed++;return {kind:'local-dwg',path:join(f.root,'fixture.dwg'),bytes:100,sha256:'fixture',document:target};}};
  const completedRuns:any[]=[{id:'failed-source-label',profile:'vision',status:'failed',errorCode:'INVOCATION_MODEL_STEP_BUDGET_EXCEEDED',modelSteps:3,tools:[],text:''}];const runtime={completed:()=>completedRuns.slice(),async inspectReference(){return {valid:true,structured:source,label_reviews:[{id:'failed-source-label',indices:[0],valid:false,pass:0}],evidence:{path,sha256,width:640,height:480}};},async run(_profile:string,instruction:string,request:any){
    if(request.onlyTools[0]==='cader_confirm_source_labels'){assert.equal(request.keepExecutionRound,true);assert.equal(request.taskState().active_planning_unit,'labels:0');await assert.rejects(request.extraTools[0].execute(plan,{concludeTurn(){}}),/EXPLICIT_SOURCE_CLARIFICATIONS_UNREVIEWED/);const confirm=request.extraTools.find((t:ToolDefinition)=>t.name==='cader_confirm_source_labels');assert.equal(confirm.isConcurrencySafe(),false);await assert.rejects(confirm.execute({labels:[{index:0,text:'R8',source_quote:'补充确认：R8'}]},{concludeTurn(){}}),/TEST_CONFIRMATION_PERSIST_FAILED/);assert.equal(request.taskState().source_label_confirmations.length,0);await confirm.execute({labels:[{index:0,text:'R8',source_quote:'补充确认：R8'}]},{concludeTurn(){}});return {status:'succeeded',tools:[],text:'fixture confirmation',id:'confirmed-source-main'};}
    if(request.extraTools?.[0]?.name==='cader_submit_acceptance_plan'){await assert.rejects(request.extraTools[0].execute({...plan,requirements:[...plan.requirements,{id:'unrequested_blocks',check:'entity_count',entity_type:'AcDbBlockReference',source_quote:task,description:'Invented representation',min:1}]},{concludeTurn(){}}),/UNREQUESTED_BLOCK_REPRESENTATION/);await assert.rejects(request.extraTools[0].execute({...plan,requirements:[...plan.requirements,{id:'punctuation',check:'text',text:'+',source_quote:task,description:'Unrequested duplicate symbol mark'}]},{concludeTurn(){}}),/SYMBOL_MARK_NOT_LITERAL_TEXT/);await request.extraTools[0].execute({source_layout:true,wire_layer:'WIRE',requirements:plan.requirements},{concludeTurn(){}});return {status:'succeeded',tools:[],text:'fixture plan'};}
    instructions.push(instruction);assert.doesNotMatch(instruction,/原图已观察事实及统一CAD坐标提示/);const unit=request.taskState().active_drawing_unit;
    if(unit==='setup'){assert.match(instruction,/CUSTOM_LABELS/);assert.match(instruction,/CUSTOM_SYMBOL/);target='fixture.dwg';committed++;}
    if(unit==='component:source'){assert.match(instruction,/"source_appearance":\{"id":"source","kind":"terminal"/);assert.match(instruction,/"appearance_requirements":\[\{"id":"appearance","description":"Synthetic appearance"/);assert.match(instruction,/"source_symbol_marks":\[\{"text":"\+"/);rows.push({object_id:1,type:'AcDbLine',layer:instruction.includes('"layer":"CUSTOM_SYMBOL"')?'CUSTOM_SYMBOL':'SYMBOL',start_point:[...sealed.components[0].ports[0],0],end_point:[1,749,0],bounding_box:{min:[0,749,0],max:[1,750,0]}});committed++;}
    if(unit==='labels:0'){assert.match(instruction,/max_text_height/);assert.doesNotMatch(instruction,/"text":"\+"/);rows.push({object_id:2,type:'AcDbText',layer:instruction.includes('"layer":"CUSTOM_LABELS"')?'CUSTOM_LABELS':'TEXT',text_string:'R8',bounding_box:{min:[2,2,0],max:[3,3,0]}});committed++;}
    await request.completeDrawingUnit();return {status:'succeeded',tools:[],text:'fixture unit checkpoint'};
  },async reviewCadView(){return {review_valid:true,attempts:[],structured:{verdict:'pass',defects:[],uncertainties:[],checklist:[{requirement_id:'appearance',status:'pass',evidence:'Fixture only'}]},evidence:{document:target,reference:{path,sha256,width:640,height:480}}};}};
  try{
    const q=await runQualityTask({runtime,owner,task,profile:'fixture',emit(){},persist:async(state:any)=>{if(rejectConfirmationOnce&&state.label_confirmations.length){rejectConfirmationOnce=false;throw new Error('TEST_CONFIRMATION_PERSIST_FAILED');}},referenceTask:{request:task,image:{path,sha256,width:640,height:480},outputPath:join(f.root,'fixture.dwg'),freshDrawing:true}} as never);
    assert.ok(q.source_layout);assert.equal(q.source_layout!.components[0]!.id,'source');assert.equal(q.planning_units[0]!.status,'checked_in');assert.equal(q.phase,'complete',JSON.stringify({failure:q.failure,checks:q.checks}));assert.equal(q.quality_accepted,true);assert.equal(instructions.length,4);assert.equal(q.drawing_units.length,4);assert.equal(q.label_confirmations.length,1);assert.equal((q.label_confirmations[0]!.original_reading as {certainty:string}).certainty,'clear');assert.equal((q.label_confirmations[0]!.original_reading as {text:string}).text,'R7');assert.equal(q.label_confirmations[0]!.text,'R8');assert.equal(completedRuns[0].status,'failed');assert.equal(completedRuns[0].recovered_by,'confirmed-source-main');assert.equal(completedRuns[0].recovery_kind,'source_label_confirmation');assert.deepEqual(completedRuns[0].recovery_evidence.confirmed_indices,[0]);
    assert.ok(q.checks.every(c=>c.status==='pass'));
  }finally{await f.cleanup();}
});

test('a clear source partition conflict returns to Scheduler without geometric correction against a wrong frozen contract',async()=>{
  const f=await setup(),path=join(f.root,'reference.png'),pixels=await readReferenceImage(f.root,path),sha256=createHash('sha256').update(pixels.data).digest('hex');
  const task='复现电路',source=parseReferenceObservation({...observation,drawing_kind:'schematic',objects:['A','B'].map((id,i)=>({id,kind:'one-pin fixture',category:'component',bounds:[[0.1+i*0.5,0.2],[0.2+i*0.5,0.4]],terminals:[[0.1+i*0.5,0.2]],certainty:'clear'})),nets:[{id:'joined',pins:['A','B'].map(object=>({object,terminal:0})),certainty:'clear'}]});
  const plan={version:1,domain:'electrical-schematic',wire_layer:'WIRE',visual_required:true,components:['A','B'].map((id,i)=>({id,source_id:id,source_terminals:[0],kind:'fixture',bounds:[[i*3,0],[i*3+1,1]],ports:[[i*3,0]],pin_names:['p']})),nets:[{id:'joined',pins:['A','B'].map(component=>({component,pin:'p'}))}],requirements:['source_topology_fidelity','netlist','no_wire_through_component','text_clearance'].map(check=>({id:check,check:check==='source_topology_fidelity'?'visual':check,source_quote:task,description:'Synthetic contract'}))};
  let target:string|null=null,units=0,saves=0;const rows:any[]=[];
  const owner={workspace:f.root,facts:()=>({frozen:false,local_connection_id:'fixture',scratch:target,session_counts:{committed:units,unknown:0},operations:[]}),definitions:()=>[],taskScope:()=>({owned:Boolean(target),target,new_drawing_confirmed:Boolean(target),geometry_confirmed:rows.length,entity_ids:rows.map(r=>r.object_id)}),async authorizeTask(){return true;},endTask(){},async snapshot(){return {document:target,entities:structuredClone(rows)};},async saveTaskArtifact(){saves++;return {kind:'local-dwg',path:join(f.root,'fixture.dwg'),bytes:100,sha256:'fixture',document:target};}};
  const runtime={completed:()=>[],async inspectReference(){return {valid:true,structured:source,label_reviews:[],evidence:{path,sha256,width:pixels.width,height:pixels.height}};},async run(_p:string,_i:string,request:any){
    if(request.extraTools?.[0]?.name==='cader_submit_acceptance_plan'){await request.extraTools[0].execute(plan,{concludeTurn(){}});return {status:'succeeded',tools:[],text:'fixture plan'};}
    assert.ok(request.completeDrawingUnit,'must not enter a corrective model run for source semantic conflict');const unit=request.taskState().active_drawing_unit;units++;
    if(unit==='setup')target='fixture.dwg';if(unit==='component:A'||unit==='component:B'){const x=unit==='component:A'?0:3;rows.push({object_id:rows.length+1,type:'AcDbLine',layer:'SYMBOL',start_point:[x,0,0],end_point:[x,1,0],bounding_box:{min:[x,0,0],max:[x,1,0]}});}if(unit==='net:joined')rows.push({object_id:3,type:'AcDbLine',layer:'WIRE',start_point:[0,0,0],end_point:[2.5,0,0]});await request.completeDrawingUnit();return {status:'succeeded',tools:[],text:'fixture unit'};
  },async reviewCadView(){return {review_valid:true,attempts:[],structured:{verdict:'fail',defects:[],uncertainties:[],checklist:[{requirement_id:'source_topology_fidelity',status:'fail',evidence:'Synthetic independent A grouping differs from the frozen CAD grouping'}]},source_topology_evidence:{all_clear:true,matches_cad_groups:false,native_verified:false},evidence:{document:target,reference:{path,sha256,width:pixels.width,height:pixels.height}}};}};
  try{const q=await runQualityTask({runtime,owner,task,profile:'fixture',emit(){},persist:async()=>{},referenceTask:{request:task,image:{path,sha256,width:pixels.width,height:pixels.height},outputPath:join(f.root,'fixture.dwg'),freshDrawing:true}} as never);assert.equal(q.phase,'pending_verification');assert.equal(q.quality_accepted,false);assert.equal(units,4);assert.equal(saves,1,JSON.stringify({checks:q.checks,visual:q.visual,failure:q.failure,transitions:q.transitions}));assert.ok(q.checks.some(c=>c.id==='source_partition_conflict'));assert.equal(q.transitions.some(t=>t.phase==='correcting'),false);assert.equal(q.checks.find(c=>c.id==='netlist')!.status,'fail');}
  finally{await f.cleanup();}
});

test('frozen-plan wire intersections are rejected before native dispatch without a write barrier',async()=>{
  const f=await setup();let lines=0;
  const names=['new_drawing','draw_line','draw_polyline','list_layers'];
  const client:typeof createMcpClient=async()=>({definitions:()=>names.map(name=>({name:`mcp__autocad__${name}`,description:'Synthetic only',parameters:{type:'object'},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},execute:async()=>''})),toolNames:()=>names,async dispose(){},async call(name){if(name==='new_drawing')return 'Fresh.dwg';if(name==='draw_line'){lines++;return 'object_id=42';}if(name==='list_layers')return ['0','WIRE'];return [];}});
  const owner=new ExecutionSession(f.root,join(f.root,'.cader/runs/wire'),undefined,client);owner.mode='full-access';
  const ctx=await createToolRuntime();
  try{
    await owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
    await owner.authorizeTask('wire-test',{version:1,domain:'generic',wire_layer:'WIRE',requirements:[{id:'through',source_quote:'wires',description:'No crossing',check:'no_wire_through_component'},{id:'cycle',source_quote:'wires',description:'Closed cycle',check:'series_cycle'}],components:[{id:'component',kind:'generic',ports:[[0,1],[2,1]],bounds:[[0,0],[2,2]]}],visual_required:false});
    for(const tool of owner.definitions())ctx.tools.register(tool);
    assert.equal((await invokeTool(ctx,'mcp__autocad__new_drawing',{})).isError,false);
    const mark=owner.mark();
    assert.equal((await invokeTool(ctx,'mcp__autocad__draw_polyline',{layer:'WIRE',points:[[-1,1,0],[-1,4,0],[3,4,0]],closed:false})).isError,true);
    assert.equal((await invokeTool(ctx,'mcp__autocad__draw_line',{layer:'WIRE',start_x:-1,start_y:1,start_z:0,end_x:3,end_y:1,end_z:0})).isError,true);
    assert.equal(lines,0);assert.equal(owner.facts().frozen,false);assert.equal(owner.facts(mark).operations[0]?.dispatched,false);
    assert.equal((await invokeTool(ctx,'mcp__autocad__draw_line',{layer:'WIRE',start_x:-1,start_y:1,start_z:0,end_x:0,end_y:1,end_z:0})).isError,false);assert.equal(lines,1);
  }finally{await ctx.fiber.dispose();await owner.dispose();await f.cleanup();}
});
