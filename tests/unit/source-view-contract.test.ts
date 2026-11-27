import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32,deflateSync} from 'node:zlib';
import {resolve,join,sep} from 'node:path';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {loadConfig,referenceObservationSchema} from '@cader/config';
import {sourceViewContract,sourceCoordinates,createLiveRuntime} from '@cader/dsh-adapter';
import type {StreamChunk,PublicEvent} from '@cader/dsh-adapter';
const base={left:100,top:200,width:800,height:400},detail={left:500,top:300,width:400,height:200};
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);

test('named source items map their own view to BASE and canonical coordinates without changing input or topology',()=>{
 const contract=sourceViewContract(referenceObservationSchema,base,[detail],true);
 const input={content_bounds:[[0,0],[1,1]],objects:[{id:'part',view_ref:'DETAIL_0',bounds:[[0,0],[1,1]],terminals:[[0.2,0.3]]}],visible_text:[{view_ref:'DETAIL_0',text:'A',bounds:[[0.2,0.2],[0.8,0.6]]}],nets:[{id:'n',pins:[{object:'part',terminal:0}]}]};
 const snapshot=JSON.stringify(input),value=contract.normalize(input);
 close(value.visible_text[0].bounds[0][0],0.6);close(value.visible_text[0].bounds[0][1],0.35);close(value.visible_text[0].bounds[1][0],0.9);close(value.visible_text[0].bounds[1][1],0.55);
 close(value.objects[0].terminals[0][0],0.6);close(value.objects[0].terminals[0][1],0.4);assert.deepEqual(value.nets,input.nets);assert.deepEqual(value.content_bounds,input.content_bounds);assert.ok(!('view_ref' in value.objects[0]));assert.equal(JSON.stringify(input),snapshot);
 const canonical=sourceCoordinates(value,[[0.1,0.2],[0.9,0.6]],'to-source');close(canonical.visible_text[0].bounds[0][0],0.58);close(canonical.visible_text[0].bounds[0][1],0.34);
 assert.ok(contract.parameters.properties.visible_text.items.required.includes('view_ref'));assert.equal(referenceObservationSchema.properties.visible_text.items.properties.view_ref,undefined);
});

test('source view references and normalized points fail closed rather than accepting a transform from the model',()=>{
 const contract=sourceViewContract(referenceObservationSchema,base,[detail],true);
 for(const item of [{bounds:[[0,0],[1,1]]},{view_ref:'OLD_REGION',bounds:[[0,0],[1,1]]}])assert.throws(()=>contract.normalize({objects:[item]}),/VIEW_REFERENCE_REQUIRED/);
 for(const bounds of [[[0,0],[1.1,1]],[[0,NaN],[1,1]],[[0,0,0],[1,1]]])assert.throws(()=>contract.normalize({objects:[{view_ref:'DETAIL_0',bounds}]}),/POINT_OUTSIDE_FRAME/);
});

test('legacy BASE reports stay compatible and index OCR gets no new position authority',()=>{
 const contract=sourceViewContract(referenceObservationSchema,base,[],false);
 assert.deepEqual(contract.normalize({objects:[{bounds:[[0.2,0.3],[0.4,0.5]],terminals:[]}]}),{objects:[{bounds:[[0.2,0.3],[0.4,0.5]],terminals:[]}]});
 const ocr={type:'object',properties:{labels:{type:'array',items:{type:'object',properties:{index:{type:'integer'},text:{type:'string'}},required:['index','text']}}}};
 const frozen=sourceViewContract(ocr,base,[detail],true);assert.equal(frozen.parameters.properties.labels.items.properties.view_ref,undefined);assert.deepEqual(frozen.normalize({labels:[{index:2,text:'10kΩ'}]}),{labels:[{index:2,text:'10kΩ'}]});
});

test('untrusted source view bindings cannot expand BASE pixels',()=>{
 assert.throws(()=>sourceViewContract(referenceObservationSchema,base,[{...detail,left:0}],true),/BINDING_OUTSIDE_BASE/);
});

test('lookup view slots require trusted bounded immutable crop registration',()=>{
 const contract=sourceViewContract(referenceObservationSchema,base,[],true,2);
 const report={objects:[{view_ref:'LOOKUP_0',bounds:[[0,0],[1,1]],terminals:[]}]};
 assert.throws(()=>contract.normalize(report),/VIEW_REFERENCE_REQUIRED/);
 assert.throws(()=>contract.registerView('LOOKUP_2',detail),/SLOT_DENIED/);
 assert.throws(()=>contract.registerView('LOOKUP_0',{...detail,left:0}),/BINDING_OUTSIDE_BASE/);
 contract.registerView('LOOKUP_0',detail);contract.registerView('LOOKUP_0',{...detail});
 assert.deepEqual(contract.normalize(report).objects[0].bounds,[[0.5,0.25],[1,0.75]]);
 assert.throws(()=>contract.registerView('LOOKUP_0',{...detail,width:200}),/REBIND_DENIED/);
 assert.throws(()=>contract.registerView('BASE',base),/SLOT_DENIED/);
});

test('actual DSH source inventory declares detail IDs and stores canonical label positions with no CAD calls',async()=>{
 const parent=resolve('.cader/tests');await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'source-views-'));
 const chunk=(name:string,data:Buffer)=>{const type=Buffer.from(name),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([size,type,data,crc]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(6400,0);header.writeUInt32BE(400,4);header[8]=8;header[9]=2;const row=Buffer.alloc(6400*3+1,255);row[0]=0;const file=join(dir,'synthetic-wide.png');await writeFile(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:400},()=>row)))),chunk('IEND',Buffer.alloc(0))]));
 const config=await loadConfig(process.cwd());process.env.CADER_VIEW_PROTOCOL='offline-fixture';config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_VIEW_PROTOCOL'}));const events:PublicEvent[]=[];let step=0,initial=0,cropDone=false;
 const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:dir,onEvent:e=>events.push(e)});
 runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
  step++;const names=request.tools?.map(t=>t.name)??[],first=names.includes('cader_submit_reference_observation'),inventory=names.includes('cader_submit_reference_label_inventory');let name:string,args:unknown;
  if(first||inventory){
   name=first?'cader_submit_reference_observation':'cader_submit_reference_label_inventory';const schema=request.tools!.find(t=>t.name===name)!.parameters as any;assert.ok(schema.properties.visible_text.items.required.includes('view_ref'));
   const sourceState=JSON.stringify(request.messages);
   assert.ok(!sourceState.includes('original_pixels'));assert.ok(!sourceState.includes('crop_original_pixels'));assert.ok(!sourceState.includes('base_crop_normalized_original'));
   const cropTool=request.tools!.find(t=>t.name==='cader_view_image')!;if(first)assert.equal((cropTool.parameters as any).properties.left.type,'number');
   if(first&&!cropDone){cropDone=true;const cropId=('lookup-fixture-'+step) as Extract<StreamChunk,{type:'tool-call-delta'}>['id'];const cropArgs=JSON.stringify({image_ref:(cropTool.parameters as any).properties.image_ref.enum[0],left:0.5,top:0,width:0.25,height:1});yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:cropId,name:'cader_view_image',argumentsDelta:cropArgs};yield {type:'block-end',index:0,block:{type:'tool-call',id:cropId,name:'cader_view_image',arguments:cropArgs}};yield {type:'finish',reason:{kind:'tool-calls'}};return;}
   const label={text:'A',bounds:[[0.25,0.2],[0.5,0.4]],certainty:'clear',view_ref:first&&++initial===1?'OLD_REGION':'DETAIL_3'};
   args=first?{version:1,drawing_kind:'layout',summary:'Synthetic view protocol fixture',coordinate_system:'normalized-crop-top-left-y-down',content_bounds:[[0,0],[1,1]],objects:[],visible_text:[label],connections:[],unknowns:[]}:{coordinate_system:'normalized-crop-top-left-y-down',visible_text:[label]};
  }else{name='cader_submit_reference_labels';args={coordinate_system:'normalized-crop-top-left-y-down',labels:[{index:0,text:'A',certainty:'clear'}]};}
  const id=('view-fixture-'+step) as Extract<StreamChunk,{type:'tool-call-delta'}>['id'],text=JSON.stringify(args);yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:text};yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:text}};yield {type:'finish',reason:{kind:'tool-calls'}};
 });
 try{
  runtime.enableTaskBudget();const report=await runtime.inspectReference(file,'Synthetic protocol test',undefined,{id:'wide',bounds:[[0,0],[1,1]]});assert.equal(report.valid,true);assert.equal(initial,2);assert.equal(events.filter(e=>e.type==='source.view_registered').length,1);
  const contract=events.find(e=>e.type==='source.view_contract')!;const d=(contract.details as {view_ref:string;crop:{left:number;width:number}}[]).find(d=>d.view_ref==='DETAIL_3')!;
  close(report.structured!.visible_text[0]!.bounds[0][0],(d.crop.left+0.25*d.crop.width)/6400);close(report.structured!.visible_text[0]!.bounds[0][1],0.2);assert.ok(!('view_ref' in report.structured!.visible_text[0]!));assert.ok(events.some(e=>e.type==='tool.result'&&e.isError));assert.ok(!events.some(e=>e.type==='tool.dispatch'&&String(e.tool).startsWith('mcp__')));
 }finally{await runtime.dispose();assert.ok(dir.startsWith(parent+sep));await rm(dir,{recursive:true});}
});
