import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readReferenceImage} from '@cader/config';
import {sourceLiteralKey,reviewIndexedSource} from '@cader/dsh-adapter';
import type {ReferenceIndex,SourceItem} from '@cader/dsh-adapter';

test('literal evidence ignores repeated whitespace, never case, units, decimal marks or missing separators',()=>{
 assert.equal(sourceLiteralKey(' 40kA  3S '),'40kA 3S');
 for(const [a,b] of [['10KΩ','10kΩ'],['1µF','1mF'],['0.1','0,1'],['A B','AB']])assert.notEqual(sourceLiteralKey(a!),sourceLiteralKey(b!));
});

test('the bounded target queue leaves an unreviewed ninth disputed label uncertain even if broad workers agree',async()=>{
 const file='benchmark/fixtures/vision-calibration.png',image=await readReferenceImage(process.cwd(),file),items:SourceItem[]=Array.from({length:9},(_,i)=>({id:'label_'+i,kind:'text',status:'proposal',text:'producer',bounds:[10,10,40,20],quad:[[10,10],[40,10],[40,20],[10,20]],score:1,alternatives:[]}));
 const index={source:{sha256:createHash('sha256').update(image.data).digest('hex'),width:image.width,height:image.height}} as ReferenceIndex;let calls=0;
 const run=async(_profile:string,_instruction:string,request:any)=>{calls++;const ids=request.extraTools[0].parameters.properties.items.items.properties.id.enum;await request.extraTools[0].execute({items:ids.map((id:string)=>({id,status:'clear',text:calls<=2?'same broad mistake':'target literal',rotation:0,evidence:'Offline bounded proof fixture',semantic_pending:true}))},{concludeTurn(){}});return{id:'fixture-'+calls,status:'succeeded'}as any;};
 const report=await reviewIndexedSource(run,'fixture',process.cwd(),file,index,items,'fixture');assert.equal(calls,18);assert.equal(report.items.filter(i=>i.status==='clear').length,8);assert.equal(report.items[8]!.status,'uncertain');assert.equal(report.complete_source_accepted,false);
});
for(const scenario of ['spacing','target-correction','broad-same-wrong','real-conflict'] as const)test('bounded source reading evidence: '+scenario,async()=>{
 // Deterministic worker + calibration pixels; no real model or CAD claim.
 const file='benchmark/fixtures/vision-calibration.png',image=await readReferenceImage(process.cwd(),file);
 const item:SourceItem={id:'label',kind:'text',status:'proposal',text:'40kA 3S',bounds:[10,10,40,20],quad:[[10,10],[40,10],[40,20],[10,20]],score:1,alternatives:[]};
 const index={source:{sha256:createHash('sha256').update(image.data).digest('hex'),width:image.width,height:image.height}} as ReferenceIndex;
 let calls=0;const crops:any[]=[];
 const run=async(_profile:string,_instruction:string,request:any)=>{
  calls++;crops.push(request.imageView.crop);if(calls>=3){assert.equal(request.skill,undefined);assert.deepEqual(request.onlyTools,['cader_submit_indexed_source_review']);assert.doesNotMatch(_instruction,/coordinate_system|normalized-BASE|bounds|40kA 3S 100kA/);assert.equal(request.imageView.display_scale,8);}
  const texts=scenario==='spacing'?['40kA  3S']:scenario==='target-correction'?['40kA 3S 100kA','40kA 3S','40kA  3S','40kA 3S']:scenario==='broad-same-wrong'?['40kA 3S 100kA','40kA 3S 100kA','40kA 3S','40kA 3S']:['40KA 3S','40kA 3S','40KA 3S','40kA 3S'];
  await request.extraTools[0].execute({items:[{id:'label',status:'clear',text:texts[calls-1],rotation:0,evidence:'Deterministic source fixture',semantic_pending:true}]},{concludeTurn(){}});
  return {id:'fixture-'+calls,status:'succeeded'} as any;
 };
 const report=await reviewIndexedSource(run,'fixture',process.cwd(),file,index,[item],'fixture');
 assert.equal(report.items[0]!.status,scenario==='real-conflict'?'uncertain':'clear');assert.equal(report.attempts.length,scenario==='spacing'?1:4);
 if(scenario!=='spacing'){assert.deepEqual(crops[2],{left:9,top:9,width:33,height:13});assert.deepEqual(crops[3],crops[2]);assert.equal(report.attempts[0]!.items[0]!.text,scenario==='target-correction'||scenario==='broad-same-wrong'?'40kA 3S 100kA':'40KA 3S');}
 assert.equal(report.complete_source_accepted,false);
});
