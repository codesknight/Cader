import test from'node:test';import assert from'node:assert/strict';
import{mkdir,mkdtemp,writeFile,open,rm}from'node:fs/promises';import{join,resolve}from'node:path';
import{readQualityManifest,QUALITY_MANIFEST_MAX_BYTES,InteractiveSession}from'@cader/profile';
async function directory(){const root=resolve('.cader/tests');await mkdir(root,{recursive:true});return mkdtemp(join(root,'quality-size-'));}
function manifest(){return {version:1,task_id:'large-fixture',original_request:'画一个圆',request_sha256:'a'.repeat(64),phase:'pending_verification',round:0,checks:[],visual_calls:[],model_runs:[],plan:{version:1,domain:'generic',components:[],visual_required:true,requirements:[]},execution:{frozen:false,local_connection_id:null,scratch:null,operations:[],session_counts:{committed:0,unknown:0}},quality_accepted:false,padding:'x'.repeat(17_000_000)};}
test('large native evidence manifest remains complete and resumes through CLI without a duplicate parse or tool dispatch',async()=>{
 const root=await directory(),path=join(root,'quality.json'),saved=manifest();let calls=0,disposals=0;
 const session=await InteractiveSession.create(process.cwd(),root,async(_config,input)=>{calls++;assert.equal(input.qualityResume!.task_id,saved.task_id);assert.equal((input.qualityResume as any).padding.length,17_000_000);throw Error('FIXTURE_RUNNER_REACHED');});const owner=session.execution,dispose=owner.dispose.bind(owner);owner.dispose=async()=>{disposals++;await dispose();};
 try{await writeFile(path,JSON.stringify(saved));const loaded=await readQualityManifest(path);assert.deepEqual(loaded.saved,saved);assert.equal(loaded.raw.length,JSON.stringify(saved).length);session.state.qualityRun=path;
  const status=await session.execute('/quality');assert.equal(status.error,undefined);assert.ok(status.text.length<10000,'full native evidence never enters CLI/model status');
  await assert.rejects(session.execute('/quality resume'),/FIXTURE_RUNNER_REACHED/);assert.equal(calls,1);assert.equal(disposals,0);assert.equal(session.execution,owner);
 }finally{await session.dispose();await rm(root,{recursive:true,force:true});}
});
test('oversized and malformed private quality records return recoverable CLI errors without disposing the owner',async()=>{
 const root=await directory(),path=join(root,'quality.json'),session=await InteractiveSession.create(process.cwd(),root);const owner=session.execution;let disposals=0;const dispose=owner.dispose.bind(owner);owner.dispose=async()=>{disposals++;await dispose();};
 try{const file=await open(path,'w');try{await file.truncate(QUALITY_MANIFEST_MAX_BYTES+1);}finally{await file.close();}session.state.qualityRun=path;
  const tooLarge=await session.execute('/quality');assert.equal(tooLarge.error,true);assert.match(tooLarge.text,/QUALITY_MANIFEST_TOO_LARGE/);assert.equal(disposals,0);assert.equal(session.execution,owner);assert.ok((await session.execute('/help')).text.includes('/quality'));
  await writeFile(path,'{"broken":');const invalid=await session.execute('/quality resume');assert.equal(invalid.error,true);assert.match(invalid.text,/QUALITY_MANIFEST_INVALID/);assert.equal(disposals,0);
 }finally{await session.dispose();await rm(root,{recursive:true,force:true});}
});
test('bounded manifest reader enforces its byte budget while retaining the original file',async()=>{
 const root=await directory(),path=join(root,'quality.json');try{await writeFile(path,'{"value":"'+'x'.repeat(500)+'"}');await assert.rejects(readQualityManifest(path,128),/QUALITY_MANIFEST_TOO_LARGE/);assert.equal((await readQualityManifest(path)).saved.value.length,500);}finally{await rm(root,{recursive:true,force:true});}
});
