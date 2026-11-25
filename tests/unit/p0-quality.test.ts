import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseReferenceObservation} from '@cader/config';
import type {QualityPlan} from '@cader/config';
import {sourcePlanLayout,referencePlanHints,acceptQualityByUser,userReviewStatus,ExecutionSession,InteractiveSession} from '@cader/profile';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const source=parseReferenceObservation({version:1,drawing_kind:'schematic',summary:'Synthetic two-part frame',coordinate_system:'normalized-image-top-left-y-down',content_bounds:[[0,0],[1,1]],objects:[0,1].map(i=>({id:String(i),kind:'two-pin fixture',category:'component',bounds:[[0.1+i*0.5,0.2],[0.3+i*0.5,0.5]],terminals:[[0.2+i*0.5,0.2],[0.2+i*0.5,0.5]],certainty:'clear'})),visible_text:[{text:'7mF',bounds:[[0.31,0.25],[0.44,0.3]],certainty:'clear'}],connections:[],nets:[0,1].flatMap(i=>[0,1].map(terminal=>({id:`n${i}${terminal}`,pins:[{object:String(i),terminal}]}))),unknowns:[]});
function framePlan(){return {version:1,domain:'electrical-schematic',visual_required:true,wire_layer:'WIRE',requirements:[],...sourcePlanLayout(source,{width:100,height:100})} as QualityPlan;}
test('custom source coordinates transform labels and ports in the same frame; local component drift is denied',()=>{
  const p=framePlan();for(const c of p.components){c.bounds=c.bounds.map(v=>[v[0]*2+17,v[1]*3+9]) as typeof c.bounds;c.ports=c.ports.map(v=>[v[0]*2+17,v[1]*3+9]);}
  const h=referencePlanHints(source,{width:100,height:100},p);assert.deepEqual(h.visible_text[0]!.text_layout.anchor,[637,2109]);assert.equal(h.visible_text[0]!.text,'7mF');
  for(const c of p.components)assert.deepEqual(h.objects.find(o=>o.id===c.source_id)!.indexed_terminals.map(t=>t.position),c.ports);
  const wrong=structuredClone(p);wrong.components[1]!.bounds.forEach(v=>v[1]+=500);wrong.components[1]!.ports.forEach(v=>v[1]+=500);assert.throws(()=>referencePlanHints(source,{width:100,height:100},wrong),/SOURCE_LAYOUT_FRAME_MISMATCH/);
});
async function fixture(){const parent=resolve('.cader/tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'user-quality-'));await cp('configs',join(root,'configs'),{recursive:true,filter:p=>!/\.local\.(yaml|json)$/.test(p)});const bytes='AC1032 synthetic fixture, not a real DWG',file=join(root,'fixture.dwg'),path=join(root,'quality.json');await writeFile(file,bytes);const state={task_id:'test-task',phase:'pending_verification',quality_accepted:false,original_request:'Fixture only',round:1,plan:{requirements:[{id:'v',check:'visual'},{id:'g',check:'text'}]},checks:[{id:'v',status:'not_run'},{id:'g',status:'pass'},{id:'visual_uncertainty',status:'not_run'}],artifact:{path:file,sha256:sha(bytes)},execution:{frozen:false,operations:[{tool:'new_drawing',outcome:'committed'},{tool:'save_drawing',outcome:'committed'}]}};await writeFile(path,JSON.stringify(state));const owner=new ExecutionSession(root,join(root,'.cader/runs/owner'));return {root,file,path,state,owner,async cleanup(){await owner.dispose();assert.ok(root.startsWith(parent));await rm(root,{recursive:true});}};}
test('human approval is explicit, immutable, file-bound and cannot modify automatic quality',async()=>{
  const f=await fixture();try{const before=await readFile(f.path);await assert.rejects(acceptQualityByUser(f.root,f.path,f.owner,async()=>false),/NOT_CONFIRMED/);const review=await acceptQualityByUser(f.root,f.path,f.owner,async description=>{assert.match(description,/不解除写屏障/);return true;},'Actual user fixture review');assert.equal((await userReviewStatus(f.root,f.path,review)).accepted,true);assert.deepEqual(await readFile(f.path),before);await writeFile(f.file,'AC1032 changed');assert.equal((await userReviewStatus(f.root,f.path,review)).accepted,false);}finally{await f.cleanup();}
});
test('changed confirmation, structural failure and unknown writes cannot be approved by the user-review entry',async()=>{
  const f=await fixture();try{await assert.rejects(acceptQualityByUser(f.root,f.path,f.owner,async()=>{await writeFile(f.file,'AC1032 changed during confirmation');return true;}),/CHANGED/);await writeFile(f.file,'AC1032 synthetic fixture, not a real DWG');f.state.checks[1]!.status='fail';await writeFile(f.path,JSON.stringify(f.state));await assert.rejects(acceptQualityByUser(f.root,f.path,f.owner,async()=>true),/DETERMINISTIC/);f.state.checks[1]!.status='pass';f.state.execution.frozen=true;await writeFile(f.path,JSON.stringify(f.state));await assert.rejects(acceptQualityByUser(f.root,f.path,f.owner,async()=>true),/UNCERTAIN_WRITE/);}finally{await f.cleanup();}
});
test('interactive accept survives session storage and invalidates when the accepted file changes',async()=>{
  const f=await fixture();const chat=await InteractiveSession.create(f.root,f.root);try{chat.state.qualityRun=f.path;assert.equal((await chat.execute('我已人工检查这张图，没有问题',{confirm:async()=>true})).error,undefined);const id=chat.state.id;await chat.execute('/clear');await chat.execute('/resume '+id);assert.equal(JSON.parse((await chat.execute('/quality')).text).acceptance,'accepted_by_user');assert.match((await chat.execute('是否使用了视觉验证？')).text,/accepted_by_user/);assert.match((await chat.execute('继续')).text,/人工验收/);await writeFile(f.file,'AC1032 edited');assert.equal(JSON.parse((await chat.execute('/quality')).text).user_review.accepted,false);assert.equal(JSON.parse(await readFile(f.path,'utf8')).quality_accepted,false);}finally{await chat.dispose();await f.cleanup();}
});

for(const accepted of [false,true])test(`pending visual task proactively asks for scoped human review: ${accepted}`,async()=>{
 const f=await fixture();const events:any[]=[];
 const report={ok:false,runDirectory:f.root,quality:f.state,text:'Fixture visual uncertainty',run_status:'succeeded',blocked_reasons:['QUALITY_NOT_ACCEPTED'],errorCode:'QUALITY_NOT_ACCEPTED'};
 const chat=await InteractiveSession.create(f.root,f.root,async()=>report as never);
 try{let asked=0;const reply=await chat.execute('画一个需要视觉检查的图',{onEvent:e=>events.push(e),review:async description=>{asked++;assert.match(description,/人工图纸复核/);return accepted;},confirm:async()=>{throw new Error('CAD permission is not a human quality decision');}});assert.equal(asked,1);assert.ok(events.some(e=>e.type==='task.user_review_required'));assert.equal(reply.error,!accepted);assert.equal(Boolean(chat.state.qualityReview),accepted);assert.equal(JSON.parse(await readFile(f.path,'utf8')).quality_accepted,false);}finally{await chat.dispose();await f.cleanup();}
});

test('active persistent barriers cannot be overridden by manual file acceptance',async()=>{
 const f=await fixture();try{const lock=join(f.root,'.cader/locks/managed-write.json');await mkdir(join(f.root,'.cader/locks'),{recursive:true});await writeFile(lock,JSON.stringify({frozen:true,request:'unknown',outcome:'unknown',stage:'dispatch'}));await f.owner.loadPersistedBarrier();const before=await readFile(lock);await assert.rejects(acceptQualityByUser(f.root,f.path,f.owner,async()=>true),/WRITE_BARRIER/);assert.deepEqual(await readFile(lock),before);}finally{await f.cleanup();}
});
test('image evidence mutation invalidates a human receipt; verified-restored capture failures are not unknown writes',async()=>{
 const f=await fixture();try{const image=join(f.root,'evidence.png');await writeFile(image,'fixture pixels only');const saved={...f.state,visual:{evidence:{sha256:sha('fixture pixels only'),capture_receipt:{file_path:image}}},execution:{frozen:false,operations:[{tool:'new_drawing',outcome:'committed'},{tool:'export_current_view',outcome:'committed_observation_failed',stage:'capture_restored'},{tool:'save_drawing',outcome:'committed'}]}};await writeFile(f.path,JSON.stringify(saved));const review=await acceptQualityByUser(f.root,f.path,f.owner,async()=>true);assert.equal((await userReviewStatus(f.root,f.path,review)).accepted,true);await writeFile(image,'changed pixels');assert.equal((await userReviewStatus(f.root,f.path,review)).reason,'HUMAN_REVIEW_IMAGE_CHANGED');}finally{await f.cleanup();}
});

test('source wire-junction terminals normalize to symbol bodies without swallowing neighbouring components',()=>{
 const observed=parseReferenceObservation({...source,objects:[{...source.objects[0]!,id:'a',bounds:[[0.2,0.2],[0.3,0.3]],terminals:[[0.25,0.1],[0.25,0.7]]},{...source.objects[1]!,id:'b',bounds:[[0.2,0.5],[0.3,0.6]],terminals:[[0.25,0.4],[0.25,0.7]]}],nets:[{id:'n0',pins:[{object:'a',terminal:0}]},{id:'n1',pins:[{object:'a',terminal:1},{object:'b',terminal:0}]},{id:'n2',pins:[{object:'b',terminal:1}]}]});
 const layout=sourcePlanLayout(observed,{width:100,height:100});
 assert.deepEqual(layout.components.map(c=>c.bounds),[[[200,700],[300,800]],[[200,400],[300,500]]]);
 assert.deepEqual(layout.components[0]!.ports,[[250,800],[250,700]]);
 assert.equal(layout.normalized_ports.length,4);assert.equal(layout.nets[1]!.pins.length,2);
});

test('missing deterministic evidence cannot be replaced by manual visual acceptance',async()=>{
 const f=await fixture();try{f.state.checks=f.state.checks.filter(c=>c.id!=='g');await writeFile(f.path,JSON.stringify(f.state));await assert.rejects(acceptQualityByUser(f.root,f.path,f.owner,async()=>true),/DETERMINISTIC/);}finally{await f.cleanup();}
});

test('source approximate touching margins are recorded; material body overlap is rejected',()=>{
 const make=(y:number)=>parseReferenceObservation({...source,objects:[{...source.objects[0]!,bounds:[[0.1,0.1],[0.3,0.31]],terminals:[[0.2,0.1],[0.2,0.31]]},{...source.objects[1]!,bounds:[[0.1,y],[0.3,0.5]],terminals:[[0.2,y],[0.2,0.5]]}]});
 const observed=make(0.3),raw=JSON.stringify(observed),layout=sourcePlanLayout(observed,{width:100,height:100});assert.equal(layout.normalized_bounds.length,1);assert.equal(layout.components[0]!.bounds[0][1],layout.components[1]!.bounds[1][1]);assert.equal(JSON.stringify(observed),raw);assert.throws(()=>sourcePlanLayout(make(0.2),{width:100,height:100}),/SOURCE_SYMBOL_BOUNDS_OVERLAP/);
});
