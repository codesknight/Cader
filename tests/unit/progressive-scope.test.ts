import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {loadConfig} from '@cader/config';
import {createLiveRuntime} from '@cader/dsh-adapter';
import type {StreamChunk,PublicEvent} from '@cader/dsh-adapter';

// Actual DSH assembly with deterministic model/capture fixtures. No real CAD.
async function* tool(name:string,args:unknown,n:number):AsyncGenerator<StreamChunk>{
  const id=('scope-fixture-'+n) as Extract<StreamChunk,{type:'tool-call-delta'}>['id'],text=JSON.stringify(args);
  yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:text};yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:text}};yield {type:'finish',reason:{kind:'tool-calls'}};
}

test('scoped label OCR freezes location on both passes, clips details, and converts BASE coordinates once',async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_SCOPE_FIXTURE='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_SCOPE_FIXTURE'}));
  const events:PublicEvent[]=[];let steps=0,ocr=0,checkingMain=false;
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/source-label-scope'),taskState:()=>({last_visual:'STALE_MAIN_REVIEW_SENTINEL'}),executionState:()=>({operations:[{tool:'STALE_CAD_OPERATION_SENTINEL'}]}),onEvent:e=>events.push(e)});
  const label={text:'SOURCE_LABEL_CANDIDATE_SENTINEL',bounds:[[0.1,0.1],[0.2,0.2]],certainty:'uncertain'};
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    if(checkingMain){assert.match(JSON.stringify(request.messages),/STALE_MAIN_REVIEW_SENTINEL/);yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'Offline main context retained'};yield {type:'block-end',index:0,block:{type:'text',text:'Offline main context retained'}};yield {type:'finish',reason:{kind:'stop'}};return;}
    assert.doesNotMatch(JSON.stringify(request.messages),/STALE_MAIN_REVIEW_SENTINEL|STALE_CAD_OPERATION_SENTINEL/);
    steps++;const names=request.tools?.map(t=>t.name)??[];
    if(names.includes('cader_submit_reference_observation'))yield* tool('cader_submit_reference_observation',{version:1,drawing_kind:'layout',summary:'Synthetic label fixture',coordinate_system:'normalized-crop-top-left-y-down',content_bounds:[[0,0],[1,1]],objects:[],visible_text:[label],connections:[],unknowns:[]},steps);
    else if(names.includes('cader_submit_reference_label_inventory')){assert.doesNotMatch(JSON.stringify(request.messages),/SOURCE_LABEL_CANDIDATE_SENTINEL/);yield* tool('cader_submit_reference_label_inventory',{coordinate_system:'normalized-crop-top-left-y-down',visible_text:[label]},steps);}
    else{ocr++;assert.ok(!JSON.stringify(request.tools?.find(t=>t.name==='cader_submit_reference_labels')).includes('"bounds":'));assert.ok(!JSON.stringify(request.messages).includes('单项可按原图归一化坐标修正bounds'));yield* tool('cader_submit_reference_labels',{coordinate_system:'normalized-crop-top-left-y-down',labels:[{index:0,text:'A',certainty:ocr===1?'uncertain':'clear'}]},steps);}
  });
  try{runtime.enableTaskBudget();const report=await runtime.inspectReference('benchmark/fixtures/vision-calibration.png','Synthetic scoped OCR',undefined,{id:'bottom-right',bounds:[[0.5,0.5],[1,1]]});assert.equal(report.valid,true);assert.equal(ocr,2);assert.deepEqual(report.structured!.visible_text[0]!.bounds,[[0.55,0.55],[0.6,0.6]]);assert.equal(report.structured!.visible_text[0]!.certainty,'clear');
    const views=events.filter(e=>e.type==='image.attached');assert.ok(views.length>3);for(const e of views){const c=e.crop as {left:number;top:number};assert.ok(c.left>=(e.source_width as number)*0.5&&c.top>=(e.source_height as number)*0.5);}
    assert.ok(!events.some(e=>e.type==='tool.result'&&JSON.stringify(e).includes('SOURCE_LABEL_BOUNDS_OUTSIDE_CROP')));
    checkingMain=true;assert.equal((await runtime.run('MainAgent','Offline context retention',{onlyTools:[],maxModelSteps:1})).status,'succeeded');
  }finally{await runtime.dispose();}
});

for(const bad of ['scope','entity','empty-defect','unverified-style'])test(`bound native local review rejects ${bad} mismatch and reuses all registered detail pixels`,async()=>{
  const config=await loadConfig(process.cwd());process.env.CADER_SCOPE_REVIEW='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_SCOPE_REVIEW'}));
  const parent=resolve('.cader/tests');await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'bound-review-'));const primary=join(dir,'primary.png'),detail=join(dir,'detail.png');await copyFile('benchmark/fixtures/vision-calibration.png',primary);await copyFile(primary,detail);const sha=createHash('sha256').update(await readFile(primary)).digest('hex');
  let captures=0,steps=0;const events:PublicEvent[]=[];
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:dir,taskState:()=>({last_visual:'STALE_FOREIGN_SCOPE_SENTINEL'}),executionState:()=>({operations:[{arguments:'STALE_NATIVE_ARGUMENTS_SENTINEL'}]}),onEvent:e=>events.push(e),captureCadView:async(_signal,request)=>{captures++;assert.equal(request?.min_long_edge,2048);return {path:captures===1?primary:detail,evidence:{source:'synthetic capture fixture',sha256:sha,document:'fixture.dwg'}};}});
  const question=JSON.stringify({review_scope:{id:'scope-1',mode:'affected-batch',geometry_only:true,entity_ids:[7]},entity_snapshot:[{object_id:7,type:'AcDbText',text_string:'A'}],requirements:[{id:'appearance'}]});
  const view={world_window:[0,0,10,10] as [number,number,number,number],min_long_edge:2048,details:[{request:{world_window:[1,1,2,2] as [number,number,number,number],min_long_edge:2048},entity_ids:[7]}]};
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{steps++;assert.match(JSON.stringify(request.messages),/review_scope指定/);assert.doesNotMatch(JSON.stringify(request.messages),/STALE_FOREIGN_SCOPE_SENTINEL|STALE_NATIVE_ARGUMENTS_SENTINEL/);const invalid=steps===1;
    const defect=invalid&&['empty-defect','unverified-style'].includes(bad);
    yield* tool('cader_submit_visual_report',{scope_id:invalid&&bad==='scope'?'foreign-scope':'scope-1',checked_entity_ids:invalid&&bad==='entity'?[8]:[7],verdict:defect?'fail':'pass',defects:defect?[{type:bad==='unverified-style'?'stroke_width_mismatch':'Missing unrelated feature',severity:'major',location:'fixture',evidence:'fixture',suggestion:'fixture',entity_ids:bad==='empty-defect'?[]:[7]}]:[],checklist:[{requirement_id:'appearance',status:defect?'fail':'pass',evidence:'Synthetic local pixels'}],uncertainties:[]},steps);
  });
  try{const report=await runtime.reviewCadView(question,undefined,undefined,undefined,view);assert.equal(report.review_valid,true);assert.equal(report.structured!.verdict,'pass');assert.equal(captures,2);assert.ok(events.some(e=>e.type==='tool.result'&&e.isError===true));
    const repeated=await runtime.reassessCadView(question,report.image_ref,undefined,undefined,undefined,view);assert.equal(repeated.review_valid,true);assert.equal(captures,2);assert.equal(await runtime.isCadReviewCurrent(report),true);await writeFile(detail,'changed fixture bytes');assert.equal(await runtime.isCadReviewCurrent(report),false);
  }finally{await runtime.dispose();await rm(dir,{recursive:true});}
});
