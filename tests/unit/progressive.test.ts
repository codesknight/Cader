import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadSkills,progressiveDrawingSelection,parseProgressivePlan,parseProgressivePartition,readReferenceImage} from '@cader/config';
import {runTask,runProgressiveTask,progressiveFrame,verifyProgressiveBatch,taskIntent,qualityTaskContext,validateDraftOperation,verifyDraftGeometry} from '@cader/profile';
const task='分区绘制多个部件';
const overview={version:1,content_bounds:[[0,0],[1,1]],units:'relative-layout-units',regions:[{id:'left',bounds:[[0,0],[0.5,1]],description:'Left independent part',depends_on:[]},{id:'right',bounds:[[0.5,0],[1,1]],description:'Right independent part',depends_on:[]}],anchors:[]};
test('registered progressive guidance is role scoped, resources are lazy and simple tasks remain short',async()=>{
  const registry=await loadSkills(process.cwd());
  assert.match(await registry.read('progressive-drawing','main'),/Plan globally/);
  assert.match(await registry.read('progressive-drawing','vision','checkpoint-and-recovery'),/must not be replayed/);
  await assert.rejects(registry.read('progressive-drawing','subagent'));
  assert.equal(progressiveDrawingSelection('画一个半径15的圆').selected,false);
  assert.equal(progressiveDrawingSelection('画一个圆，保存为 C:\\tmp\\progressive.dwg').selected,false);
  assert.equal(progressiveDrawingSelection('画一个房子，旁边有棵树').selected,false);
  assert.equal(progressiveDrawingSelection('复现这张图纸',{width:4967,height:3509}).selected,true);
  assert.equal(progressiveDrawingSelection('复现 C:\\tmp\\img.png，保存为 C:\\tmp\\progressive.dwg',{width:4967,height:3509}).reason,'large-reference');
  assert.equal(progressiveDrawingSelection('渐进式绘制机械多视图').selected,true);
  assert.equal(progressiveDrawingSelection('只分析这张复杂图纸',{width:4967,height:3509}).selected,false);
  assert.equal(taskIntent('先做布局分析，暂不绘图'),'analysis');
  assert.equal(taskIntent('先分析，然后不要绘制'),'analysis');
  assert.equal(taskIntent('先分析后绘制复杂图纸'),'drawing');
  assert.equal(taskIntent('先分析图纸，绘制到新画布'),'drawing');
  assert.equal(taskIntent('先分析图纸，说明如何绘制'),'analysis');
  assert.notEqual(taskIntent('先画房子再分析'),'analysis');
  assert.notEqual(taskIntent('先分析布局，然后移动已有实体'),'analysis');
  assert.notEqual(taskIntent('规划绘制复杂图纸'),'analysis');
});
test('scope contracts reject gaps, duplicate ownership, invalid dependencies and invented boundary locations',()=>{
  const plan=parseProgressivePlan(overview);assert.deepEqual(progressiveFrame(plan,{width:1000,height:500}).point([0.25,0.75]),[250,125]);
  assert.throws(()=>parseProgressivePlan({...overview,regions:[overview.regions[0],{...overview.regions[1],bounds:[[0.6,0],[1,1]]}]}),/COVERAGE/);
  assert.throws(()=>parseProgressivePlan({...overview,regions:[overview.regions[0],{...overview.regions[1],bounds:[[0.4,0],[1,1]]}]}),/OVERLAP/);
  assert.throws(()=>parseProgressivePlan({...overview,anchors:[{id:'a',position:[0.3,0.3],regions:['left','right'],relation:'connected',certainty:'clear',evidence:'fixture'}]}),/BOUNDARY/);
  assert.deepEqual(parseProgressivePlan({...overview,regions:[{...overview.regions[0],depends_on:['right']},overview.regions[1]]}).regions.map(r=>r.id),['right','left']);
  assert.deepEqual(parseProgressivePlan({...overview,regions:[{...overview.regions[0],priority:10},{...overview.regions[1],priority:90}]}).regions.map(r=>r.id),['right','left']);
  assert.deepEqual(parseProgressivePlan({...overview,regions:[{...overview.regions[0],priority:10},{...overview.regions[1],priority:90,depends_on:['left']}]}).regions.map(r=>r.id),['left','right']);
  assert.throws(()=>parseProgressivePlan({...overview,regions:[{...overview.regions[0],depends_on:['right']},{...overview.regions[1],depends_on:['left']}]}),/CYCLE/);
});
test('model cut authoring generates complete shared boundaries without accepting omitted or duplicate cells',()=>{
  const input={version:1,content_bounds:[[0.1,0.2],[0.9,1]],x_cuts:[0.47],y_cuts:[],regions:overview.regions.map((r,column)=>({id:r.id,row:0,column,description:r.description,priority:column?90:10,depends_on:[]})),anchors:[]};
  const plan=parseProgressivePartition(input);assert.deepEqual(plan.regions.map(r=>r.id),['right','left']);
  assert.deepEqual(plan.regions[0]!.bounds,[[0.47,0.2],[0.9,1]]);assert.deepEqual(plan.regions[1]!.bounds,[[0.1,0.2],[0.47,1]]);
  assert.throws(()=>parseProgressivePartition({...input,x_cuts:[0.47,0.3]}),/SORTED/);
  assert.throws(()=>parseProgressivePartition({...input,x_cuts:[0.1]}),/INTERIOR/);
  assert.throws(()=>parseProgressivePartition({...input,regions:[input.regions[0],{...input.regions[1],column:0}]}),/DUPLICATE/);
  assert.throws(()=>parseProgressivePartition({...input,y_cuts:[0.6]}),/EVERY_CELL/);
  assert.throws(()=>parseProgressivePartition({...input,anchors:[{id:'fake',position:[0.4,0.5],regions:['left','right'],relation:'connected',certainty:'clear',evidence:'not actually shared'}]}),/BOUNDARY/);
});

test('batch checks reject out-of-region effects and duplicate geometry independently of visual opinion',()=>{
  const e={object_id:1,type:'AcDbCircle',layer:'A',center:[10,10,0],radius:2,bounding_box:{min:[8,8,0],max:[12,12,0]}};
  assert.ok(verifyProgressiveBatch([e],[[0,0],[20,20]]).every(c=>c.status==='pass'));
  assert.equal(verifyProgressiveBatch([e],[[0,0],[5,5]])[0]!.status,'fail');
  assert.equal(verifyProgressiveBatch([{...e,object_id:2}],[[0,0],[20,20]],[e])[1]!.status,'fail');
  const context=qualityTaskContext({task_id:'fixture',phase:'blocked',original_request:'fixture',round:0,checks:[],failure:{code:'SOURCE_COMPONENT_INVENTORY_FAILED',stage:'reference'}});
  assert.deepEqual(context.pending_reasons,['SOURCE_COMPONENT_INVENTORY_FAILED']);
});
// Scheduler fixture, not model or native AutoCAD evidence.
async function fixture(extra:{badBatch?:boolean;pause?:boolean;partial?:boolean;taskReport?:boolean;sharedLayerCase?:boolean;readOnlySlices?:number;scopeReconcile?:boolean;alwaysVisualFailure?:boolean;uncertain?:boolean;taskText?:string;priorNative?:boolean}={}){
  const requestTask=extra.taskText??task;let factories=0;
  let scratch:string|null=null,grant=false,draws=0,views=0,inspections=0,saved:any,paused=false,bad=extra.badBatch;
  const entities:Record<string,any>[]=[];const operations:any[]=[];const states:any[]=[];const events:any[]=[];
  if(extra.priorNative){scratch='prior-fixture.dwg';operations.push({operation_id:'old-new',outcome:'committed'});}
  const reads=new Map<string,number>();
  const pixels=await readReferenceImage(process.cwd(),'benchmark/fixtures/vision-calibration.png');
  const sourceHash=createHash('sha256').update(pixels.data).digest('hex');
  const scope=()=>({owned:!!scratch||grant,target:scratch,connection:'fixture-connection',new_drawing_confirmed:!!scratch,geometry_confirmed:draws,entity_ids:entities.map(e=>e.object_id)});
  const facts=()=>({frozen:false,transport:'connected',local_connection_id:'fixture-connection',scratch,operations,session_counts:{committed:operations.length,unknown:0}});
  const owner={workspace:process.cwd(),facts,taskScope:scope,endTask(){grant=false;},async authorizeTask(){grant=true;return true;},async refineTaskPlan(){},async saveTaskArtifact(){return {path:'fixture-only-not-a-real-DWG',bytes:0,sha256:'fixture-only'};},async snapshot(){return {document:scratch,entities:structuredClone(entities)};},definitions(){return ['new_drawing','draw_circle','move_entity','delete_entity'].map(n=>({name:'mcp__autocad__'+n}));}};
  const runtime={visionProfileId:'VisionAgent',setVerificationScope(){},enableTaskBudget(){},dispose:async()=>{},completed:()=>extra.taskReport?[{id:'fixture-old-failed-stage',profile:'MainAgent',status:'failed',text:'',tools:[],errorCode:'OUTPUT_TRUNCATED'},{id:'fixture-final-stage',profile:'MainAgent',status:'succeeded',text:'fixture',tools:[]}]:[],reviewStats:()=>({capture_attempts:views,model_calls:views}),budgetState:()=>({}),
    async inspectReference(){inspections++;return {valid:false,structured:null,evidence:{path:'benchmark/fixtures/vision-calibration.png',sha256:sourceHash,width:pixels.width,height:pixels.height}};},
    async inspectProgressiveDraft(_path:string,region:any){return {valid:true,coverage:'partial',scope:region,source_sha256:sourceHash,agreements:[{trace:{id:'known_circle',kind:'circle',certainty:'clear',evidence:'fixture only',center:[(region.bounds[0][0]+region.bounds[1][0])/2,0.5],radius:0.01},independent_id:'fixture-second-read'}]};},
    async run(_profile:string,_text:string,req:any){
      const tool=req.extraTools?.[0];const exec={concludeTurn(){}};
      if(tool?.name==='cader_submit_progressive_plan')await tool.execute(overview,exec);
      else if(tool?.name==='cader_split_progressive_region'){const r=saved.progressive.plan.regions.find((r:any)=>r.id===saved.progressive.active_region);await tool.execute({axis:0,position:(r.bounds[0][0]+r.bounds[1][0])/2,descriptions:['first fixture subset','second fixture subset'],anchors:[]},exec);}
      else if(tool?.name==='cader_submit_acceptance_plan')await tool.execute({version:1,domain:'generic',components:[],visual_required:true,requirements:[{id:'visual',source_quote:requestTask,description:'Current part',check:'visual'},{id:'count',source_quote:requestTask,description:'One circle',check:'entity_count',entity_type:'AcDbCircle',min:1}]},exec);
      else if(req.onlyTools?.some((n:string)=>n.endsWith('__new_drawing'))){scratch='fixture.dwg';operations.push({operation_id:'new',outcome:'committed'});}
      else{
        const region=req.taskState().progressive.active_region;
        const count=reads.get(region)??0;if(count<(extra.readOnlySlices??0)){reads.set(region,count+1);return {status:'succeeded',tools:[],text:'Read-only preparation fixture',handoff:{kind:'verification',code:'MODEL_SLICE_COMPLETE'}};}
        if(extra.sharedLayerCase&&region==='right')await assert.rejects(req.beforeCadOperation('mcp__autocad__set_layer_properties',{name:'LEFT',color:1}),/REGION_SHARED_LAYER_PROTECTED/);
        if(extra.pause&&region==='right'&&!paused){paused=true;return {status:'succeeded',tools:[],text:'',handoff:{kind:'budget',code:'TASK_TOKEN_BUDGET_EXCEEDED',renewable:false}};}
        if(!entities.some(e=>e.region===region)){
          draws++;const d=(saved?.progressive.plan??overview).regions.find((r:any)=>r.id===region),x=(d.bounds[0][0]+d.bounds[1][0])*500,y=extra.partial?500*pixels.height/pixels.width:100;
          entities.push({object_id:draws,type:'AcDbCircle',layer:region,region,center:[x,y,0],radius:10,bounding_box:{min:[x-10,y-10,0],max:[x+10,y+10,0]}});operations.push({operation_id:'draw-'+draws,outcome:'committed'});
          try{await req.afterCadBatch();}catch{return {status:'succeeded',tools:[],text:'',handoff:{kind:'verification',code:'BATCH_VERIFICATION_PENDING'}};}
        }
        await tool.execute({unit_id:region},exec);
      }
      return {status:'succeeded',text:'fixture',tools:[],id:'fixture'};
    },async reviewCadView(question:string){views++;const q=JSON.parse(question);if(q.partial_batch){assert.notEqual(q.original_request,requestTask);assert.equal(q.verification_scope,'affected-batch');assert.equal(q.region.description,undefined);assert.deepEqual(q.entity_snapshot.map((e:any)=>e.object_id),q.affected_entity_ids);}else assert.equal(q.original_request,requestTask);const fail=extra.alwaysVisualFailure||bad&&q.partial_batch;bad=false;return {image_ref:'fixture-'+views,evidence:{document:scratch,sha256:'fixture',reference:{sha256:sourceHash},image_bounds:{possible_clipping:false}},review_valid:true,structured:{verdict:extra.uncertain?'uncertain':fail?'fail':'pass',defects:[],uncertainties:extra.uncertain?['Synthetic unresolved pixels']:[],checklist:q.requirements.map((r:any)=>({requirement_id:r.id,status:extra.uncertain?'uncertain':fail?'fail':'pass',evidence:'fixture only'}))},attempts:[]};}};
  let reconciliations=0;
  if(extra.scopeReconcile)(runtime as any).reassessCadView=async(question:string,imageRef:string)=>{reconciliations++;const result=await runtime.reviewCadView(question);return {...result,image_ref:imageRef};};
  const options:any={runtime,owner,task:requestTask,root:process.cwd(),profile:'MainAgent',persist:async(s:unknown)=>{saved=structuredClone(s);states.push(saved);},emit:(e:unknown)=>events.push(e)};
  if(extra.partial)options.referenceTask={request:requestTask,image:{path:'benchmark/fixtures/vision-calibration.png',sha256:sourceHash,width:pixels.width,height:pixels.height},outputPath:'.cader/tests/fixture-pending.dwg',freshDrawing:true};
  const report=extra.taskReport?await runTask(process.cwd(),{task:requestTask,referenceTask:options.referenceTask,executionOwner:owner as never,executionTools:owner.definitions() as never,executionState:facts as never,permissionMode:'ask'},async()=>{factories++;return runtime as never;}):undefined;
  const result=report?.quality??await runProgressiveTask(options);
  return {result:result!,report,states,events,options,owner,entities,draws:()=>draws,views:()=>views,inspections:()=>inspections,reconciliations:()=>reconciliations,factories:()=>factories,saved:()=>saved};
}

test('independent complete acceptance supersedes an intermediate truncated model stage without erasing its history',async()=>{
  const f=await fixture({taskReport:true});assert.equal(f.report!.ok,true,JSON.stringify(f.report));assert.equal(f.report!.quality!.quality_accepted,true);assert.equal(f.report!.errorCode,undefined);
});

test('small-image global Gate failure selects progressive workflow once on the same live task and runtime',async()=>{
  const f=await fixture({taskReport:true,partial:true,taskText:'复现这张图纸并保存DWG。'});assert.ok(f.report!.quality!.progressive);assert.equal(f.factories(),1);assert.equal(f.draws(),0);assert.ok(f.inspections()>1);assert.ok(f.report!.quality!.progressive!.plan);
  const initial=JSON.parse(await readFile(resolve(f.report!.runDirectory,'quality-global-attempt.json'),'utf8'));assert.equal(initial.task_id,f.report!.quality!.task_id);assert.equal(initial.failure.code,'REFERENCE_INSPECTION_FAILED');assert.equal(initial.execution.operations.length,0);assert.equal(f.report!.quality!.quality_accepted,false);
  const existing=await fixture({taskReport:true,partial:true,taskText:'复现这张图纸并保存DWG。',priorNative:true});assert.equal(existing.report!.quality!.progressive,null);assert.equal(existing.draws(),0);
});
test('Harness creates a shared drawing, verifies every meaningful batch and then independently accepts all regions',async()=>{
  const f=await fixture();assert.equal(f.result.phase,'complete',JSON.stringify(f.result.progressive));assert.equal(f.draws(),2);assert.ok(f.views()>=5);
  assert.equal(f.result.progressive?.regions.length,2);assert.ok(f.result.progressive?.regions.every(r=>r.status==='verified'&&r.batches.every(b=>b.status==='pass')));
  assert.equal(f.events.filter(e=>e.type==='task.batch_verified').length,2);
});
test('a failed visual batch returns control to Scheduler and remains in evidence',async()=>{
  const f=await fixture({badBatch:true});assert.ok(f.result.progressive?.regions[0]?.batches.some(b=>b.status==='fail'));
  assert.equal(f.draws(),2);assert.ok(f.result.quality_accepted); // fresh final region review can certify a repaired/unchanged candidate, never dispatch success
});

test('a later region cannot change a prior region layer through a case alias',async()=>{
  const f=await fixture({sharedLayerCase:true});assert.equal(f.result.quality_accepted,true);assert.equal(f.draws(),2);
});

test('batch scope reconciliation retains the failed original, and a second failure cannot be forced to pass',async()=>{
  const fixed=await fixture({badBatch:true,scopeReconcile:true});assert.equal(fixed.reconciliations(),1);assert.equal(fixed.result.quality_accepted,true);
  const history=fixed.result.progressive!.regions[0]!.batches[0]!.review_history!;assert.equal(history[0]!.structured!.verdict,'fail');assert.equal(history[1]!.structured!.verdict,'pass');assert.equal(history[0]!.image_ref,history[1]!.image_ref);
  const failed=await fixture({scopeReconcile:true,alwaysVisualFailure:true});assert.equal(failed.result.quality_accepted,false);assert.ok(failed.result.progressive!.regions.every(r=>r.repairs<=3));
});

test('bounded read-only preparation is allowed, but three unchanged model slices cannot drain the task budget',async()=>{
  const ready=await fixture({readOnlySlices:2});assert.equal(ready.result.quality_accepted,true);assert.equal(ready.draws(),2);
  const stalled=await fixture({readOnlySlices:3});assert.equal(stalled.result.quality_accepted,false);assert.equal(stalled.draws(),0);assert.ok(stalled.result.progressive!.regions.every(r=>r.failure==='REGION_NO_PROGRESS'));
});
test('same-connection checkpoint resumes only unfinished regions, rejects altered evidence and never repeats confirmed geometry',async()=>{
  const f=await fixture({pause:true});assert.equal(f.draws(),1);assert.equal(f.result.phase,'pending_verification');
  const resume=structuredClone(f.result);const continued=await runProgressiveTask({...f.options,resume});assert.equal(continued.phase,'complete',JSON.stringify(continued.failure));assert.equal(f.draws(),2);
  const changed=await runProgressiveTask({...f.options,resume:{...continued,request_sha256:'foreign',progressive:{...continued.progressive!,scope_sha256:'foreign'}}});assert.equal(changed.quality_accepted,false);assert.equal(changed.failure?.code,'CONTINUATION_BINDING_CHANGED');assert.equal(f.draws(),2);
});
test('unknown native outcome blocks progressive planning, splitting, saving and all automatic replay',async()=>{
  let modelCalls=0,authorization=0,ended=false;
  const owner={workspace:process.cwd(),facts:()=>({frozen:true,local_connection_id:'original',scratch:'preserved.dwg',operations:[{operation_id:'unknown',outcome:'unknown'}]}),taskScope:()=>({geometry_confirmed:1}),authorizeTask:async()=>{authorization++;return true;},endTask(){ended=true;}};
  const runtime={enableTaskBudget(){},reviewStats:()=>({capture_attempts:0,model_calls:0}),budgetState:()=>({}),run:async()=>{modelCalls++;throw new Error('Must not run');}};
  const result=await runProgressiveTask({runtime,owner,task,profile:'MainAgent',emit(){},async persist(){}} as never);
  assert.equal(result.phase,'blocked');assert.equal(result.failure?.code,'CAD_WRITE_FROZEN');assert.equal(modelCalls,0);assert.equal(authorization,0);assert.equal(ended,true);
});
test('independently verified partial drafts can advance CAD but never satisfy complete source coverage or global acceptance',async()=>{
  const f=await fixture({partial:true});assert.ok(f.draws()>1);assert.equal(f.result.quality_accepted,false);assert.equal(f.result.phase,'pending_verification');
  assert.ok(f.result.progressive!.regions.every(r=>r.status==='partial_verified'));
  assert.ok(!f.events.some(e=>e.type==='task.phase'&&e.phase==='complete'));
  assert.ok(f.result.checks.some(c=>c.id==='coverage'&&c.status!=='pass'));
});

test('partial-region resume refreshes a failed source Gate without discarding old evidence or redrawing confirmed geometry',async()=>{
  const f=await fixture({partial:true});const inspections=f.inspections(),draws=f.draws();const continued=await runProgressiveTask({...f.options,resume:structuredClone(f.result)});
  assert.ok(f.inspections()>inspections);assert.equal(f.draws(),draws);assert.equal(continued.quality_accepted,false);assert.ok(continued.progressive!.regions.every(r=>r.source_history?.length===1&&r.entity_ids.length===1));
});
test('partial source contracts reject guessed geometry and verify native endpoints rather than polyline bounding boxes',()=>{
  const traces=[{id:'path',kind:'path' as const,points:[[10,10],[20,10]],closed:false}];
  assert.doesNotThrow(()=>validateDraftOperation('mcp__autocad__draw_line',{start_x:10,start_y:10,end_x:20,end_y:10},traces));
  assert.throws(()=>validateDraftOperation('mcp__autocad__draw_circle',{center_x:10,center_y:10,radius:1},traces),/TRACE_REQUIRED/);
  assert.throws(()=>validateDraftOperation('mcp__autocad__draw_line',{start_x:10,start_y:10,end_x:30,end_y:10},traces),error=>error instanceof Error&&error.message.includes('allowed_traces')&&error.message.includes('Do not add trace/trace_id'));
  assert.equal(verifyDraftGeometry(traces,[{type:'AcDb2dPolyline',bounding_box:{min:[10,10],max:[20,10]}}])[0]!.status,'fail');
  assert.equal(verifyDraftGeometry(traces,[{type:'AcDbLine',start_point:[10,10,0],end_point:[20,10,0]}])[0]!.status,'pass');
  const a={object_id:1,type:'AcDbLine',layer:'A',start_point:[10,10,0],end_point:[20,10,0],bounding_box:{min:[10,10],max:[20,10]}};
  assert.equal(verifyProgressiveBatch([{...a,object_id:2,start_point:a.end_point,end_point:a.start_point}],[[0,0],[30,30]],[a])[1]!.status,'fail');
});

test('unobservable batch pixels with passing native checks do not trigger blind geometry repair loops',async()=>{
  const f=await fixture({uncertain:true});assert.equal(f.result.quality_accepted,false);assert.equal(f.draws(),2);assert.ok(f.result.progressive!.regions.every(r=>r.repairs===0&&r.failure==='REGION_VISUAL_EVIDENCE_UNCERTAIN'));assert.ok(!f.states.some(s=>s.phase==='correcting'));
});
