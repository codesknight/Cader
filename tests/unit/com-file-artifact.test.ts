import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {ExecutionSession,runQualityTask,InteractiveSession} from '@cader/profile';
import {createToolRuntime,invokeTool} from '@cader/dsh-adapter';

// Real stdio and DSH owner boundary; synthetic file/header/native receipts are
// deliberate offline fixtures, never evidence of an actual AutoCAD drawing.
const server=String.raw`
import {createInterface} from 'node:readline';
import {appendFileSync,writeFileSync,mkdirSync,copyFileSync,readFileSync} from 'node:fs';
import {join,basename} from 'node:path';import {createHash} from 'node:crypto';
const [mode,log,audit]=process.argv.slice(2),records=new Map();let artifact,verification,opens=0,queries=0,label='Work.dwg';
const row={object_id:42,type:'AcDbLine',layer:'0',start_point:[0,0,0],end_point:[5,0,0],bounding_box:{min:[0,0,0],max:[5,0,0]}};
const cap={contract:'autocad-backend-evidence/1',document_identity:{supported:true,scope:'python_com_session',mechanism:'canonical_iunknown_lifecycle',entity_ids_scope:'document'},revision:{authoritative:false,manual_edits_observed:false,mode:'unsupported'},execution_receipts:{supported:true,contract:'autocad-execution/1',entrypoint:'execute_observed_operation',native_action_ack:true,automatic_write_replay:false,operations:['new_document','draw_line','query_entities','get_entity','save_document_artifact','reopen_document_artifact','query_verification_entities']},reconciliation:{supported:true,scope:'python_backend_lifetime',survives_python_restart:false,missing_record_proves_not_executed:false},readonly_reopen:{supported:true,scope:'python_backend_owned_artifacts'},file_artifacts:{contract:'autocad-file-artifact/1',persistent:false,source_revision_authoritative:false,save_semantics:'save_as_renames_source',output_namespace:'unique_artifact_subdirectory',overwrite:false,atomic_with_entities:false}};
if(mode==='bad-cap')cap.file_artifacts.save_semantics='copy_save';
const fields={new_drawing:{},draw_line:Object.fromEntries(['start_x','start_y','start_z','end_x','end_y','end_z'].map(k=>[k,{type:'number'}])),save_drawing:{file_path:{type:'string'},overwrite:{type:'boolean'}},query_entities:{entity_type:{type:'string'}},get_entity:{object_id:{type:'integer'}}};
const names=[...Object.keys(fields),'get_backend_status','get_document_binding','execute_observed_operation','get_execution_status'];
function reply(m,v,error=false){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{isError:error,structuredContent:v,content:[{type:'text',text:JSON.stringify(v)}]}})+'\n');}
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 if(m.method==='initialize')return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'offline-file-fixture',version:'1'}}})+'\n');
 if(m.method==='tools/list')return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:names.map(name=>({name,description:'Offline file fixture',inputSchema:{type:'object',properties:fields[name]??{}}}))}})+'\n');
 if(m.method!=='tools/call')return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Not found'}})+'\n');
 const {name,arguments:a}=m.params;
 if(name==='get_backend_status')return reply(m,{backend:'com',instance_id:'instance-A',capabilities:{evidence_support:cap}});
 if(name==='get_document_binding')return reply(m,{instance_id:'instance-A',document_id:'work-A',name:label,managed:true,read_only:false,revision:null,revision_mode:'unsupported'});
 if(name==='get_execution_status')return reply(m,records.get(a.request_id));
 if(name!=='execute_observed_operation'){appendFileSync(log,JSON.stringify({legacy:name})+'\n');return reply(m,{unexpected:true},true);}
 const prepared=readFileSync(audit,'utf8').split('\n').filter(Boolean).some(l=>{const p=JSON.parse(l);return p.request_json===JSON.stringify(a)&&p.request_sha256===createHash('sha256').update(JSON.stringify(a)).digest('hex');});
 const reading=['query_entities','get_entity','query_verification_entities'].includes(a.operation);
 const r={contract:'autocad-execution/1',backend:'com',instance_id:'instance-A',request_instance_id:a.instance_id,request_id:a.request_id,operation:a.operation,request_document_id:a.document_id,result_document_id:a.operation==='new_document'?'work-A':a.document_id,status:'succeeded',stage:'completed',revision:null,revision_mode:'unsupported',native_invoked:!reading,native_acknowledged:!reading,native_actions:reading?[]:[{name:a.operation,acknowledged:true}],observation:'succeeded',affected_entities:{created:a.operation==='draw_line'?['42']:[],modified:[],deleted:[],complete:true},service_request_fingerprint:'a'.repeat(64),fingerprint_algorithm:'sha256-canonical-com-request-v1',retention:{scope:'python_backend_lifetime',terminal_ttl_seconds:600,capacity:2048},error:null};
 let v=a.operation==='new_document'?label:a.operation==='draw_line'?42:a.operation==='get_entity'?row:[row];
 const fail=(stage,invoked)=>{r.status='failed';r.stage=stage;r.observation='failed';r.native_invoked=invoked;r.native_acknowledged=invoked&&stage==='observation_failed';r.native_actions=invoked?[{name:a.operation,acknowledged:r.native_acknowledged}]:[];r.result_document_id=null;r.affected_entities.complete=false;r.error={message:mode};v=null;};
 if(a.operation==='save_document_artifact'){
  const dir=join(a.arguments.output_directory,'artifact-offline1'),path=join(dir,a.arguments.file_name);mkdirSync(dir);const data=Buffer.from('AC1032 offline fixture, not a DWG');writeFileSync(path,data);label=basename(path);
  artifact={contract:'autocad-file-artifact/1',artifact_id:'offline1',instance_id:'instance-A',source_document_id:'work-A',output_directory:a.arguments.output_directory,path,sha256:createHash('sha256').update(data).digest('hex'),byte_size:data.length,revision:null,revision_mode:'unsupported',state:'saved',saved_at:'2026-11-26T00:00:00Z',save_semantics:'save_as_renames_source',verification:'not_performed'};v=artifact;r.file_progress={operation:a.operation,state:'saved'};
  if(mode==='save-unknown')fail('result_unknown',true);if(mode==='save-ack-failed')fail('observation_failed',true);
 }
 if(a.operation==='reopen_document_artifact'){
  opens++;r.file_progress={operation:a.operation,state:'prepared'};
  if(mode==='reopen-refused'&&opens===1)fail('not_dispatched',false);
  else{const dir=join(artifact.path,'..','verification-copy');mkdirSync(dir);const path=join(dir,'verification-copy.dwg');copyFileSync(artifact.path,path);verification={contract:'autocad-verification-document/1',instance_id:'instance-A',document_id:'verify-A',source_document_id:'work-A',source_artifact_id:artifact.artifact_id,path,sha256:artifact.sha256,byte_size:artifact.byte_size,revision:null,revision_mode:'unsupported',read_only:true,managed:false,verification:'content_not_yet_compared'};v=verification;r.result_document_id='verify-A';r.file_progress={operation:a.operation,state:'readonly_opened'};if(mode==='reopen-unknown')fail('result_unknown',true);if(mode==='reopen-ack-failed')fail('observation_failed',true);if(mode==='foreign-instance')r.instance_id='foreign';}
 }
 if(a.operation==='query_verification_entities'){
  queries++;v={...verification,contract:'autocad-verification-query/1',items:[{...row,object_id:142}],geometry_scope:'legacy_summary_partial',snapshot_revision:null};r.file_progress=null;
  if(mode==='summary-mismatch')v.items[0].end_point=[9,0,0];if(mode==='query-wrong-id')v.document_id='foreign';if(mode==='query-fail-once'&&queries===1)fail('not_dispatched',false);
 }
 if(['save_document_artifact','reopen_document_artifact','query_verification_entities'].includes(a.operation)&&r.stage==='completed')r.file_result=structuredClone(v);
 records.set(a.request_id,r);appendFileSync(log,JSON.stringify({request:a,prepared,receipt:r})+'\n');reply(m,{receipt:r,result:v},r.status==='failed');
});`;
async function fixture(mode:string){
 const parent=resolve('.cader/tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'file-artifact-')),audit=join(root,'.cader/runs/test/execution.jsonl'),log=join(root,'calls.jsonl');
 await writeFile(join(root,'server.mjs'),server);const config=join(root,'mcp.json');await writeFile(config,JSON.stringify({version:1,server_name:'autocad',transport:'stdio',command:process.execPath,args:[join(root,'server.mjs'),mode,log,audit],cwd:root,startup_timeout_ms:10000,tool_timeout_ms:10000}));
 const owner=new ExecutionSession(root,join(root,'.cader/runs/test'));owner.mode='workspace-write';const ctx=await createToolRuntime(),path=join(root,'deliver.dwg');
 const connect=async()=>{const old=process.env.NODE_TEST_CONTEXT;delete process.env.NODE_TEST_CONTEXT;try{await owner.connect(config);}finally{if(old!==undefined)process.env.NODE_TEST_CONTEXT=old;}};
 return {root,path,owner,ctx,connect,calls:async()=>(await readFile(log,'utf8')).trim().split('\n').map(l=>JSON.parse(l)),async start(){await connect();for(const t of [...owner.definitions(),...owner.controlTools()])ctx.tools.register(t);await owner.authorizeTask('task',{version:1,domain:'generic',components:[],requirements:[],visual_required:false},undefined,{freshDrawing:true,outputPath:path});assert.equal((await invokeTool(ctx,'mcp__autocad__new_drawing',{})).isError,false);assert.equal((await invokeTool(ctx,'mcp__autocad__draw_line',{start_x:0,start_y:0,start_z:0,end_x:5,end_y:0,end_z:0})).isError,false);},async cleanup(){await owner.dispose();await ctx.fiber.dispose();assert.ok(root.startsWith(parent));await rm(root,{recursive:true});}};
}
test('P1 delivery uses returned exclusive path and a distinct readonly identity; repeated verification never reopens',async()=>{
 const f=await fixture('ok');try{await f.start();await writeFile(f.path,'Existing file must remain');const result=await f.owner.saveTaskArtifact('task',f.path);assert.notEqual(result.path,f.path);assert.equal(await readFile(f.path,'utf8'),'Existing file must remain');assert.equal(result.file_verification!.document.document_id,'verify-A');assert.equal(result.file_verification!.geometry_scope,'legacy_summary_partial');assert.equal(f.owner.facts().native_target!.document_id,'work-A');await f.owner.verifyTaskArtifact('task');const status=await f.owner.executionStatus();assert.equal((status.receipt!.file_result as any).contract,'autocad-verification-query/1');const calls=await f.calls();assert.ok(calls.every(c=>c.prepared));assert.equal(calls.filter(c=>c.request.operation==='save_document_artifact').length,1);assert.equal(calls.filter(c=>c.request.operation==='reopen_document_artifact').length,1);assert.equal(calls.filter(c=>c.request.operation==='query_verification_entities').length,2);assert.equal(f.owner.facts().operations.at(-1)!.tool,'save_drawing');}finally{await f.cleanup();}
});
for(const mode of ['save-unknown','save-ack-failed','reopen-unknown','reopen-ack-failed','foreign-instance'])test(`P1 unknown/failed observation preserves separate save evidence and freezes without replay: ${mode}`,async()=>{
 const f=await fixture(mode);try{await f.start();await assert.rejects(f.owner.saveTaskArtifact('task',f.path));assert.equal(f.owner.facts().frozen,true);assert.match(f.owner.facts().recovery.reason,/^FILE_/);assert.equal((await f.owner.recover()).recovered,false);if(mode.startsWith('reopen')||mode==='foreign-instance')assert.equal(f.owner.facts().operations.at(-1)!.outcome,'committed');await assert.rejects(f.owner.verifyTaskArtifact('task'));const calls=await f.calls();assert.equal(calls.filter(c=>c.request.operation==='save_document_artifact').length,1);assert.equal(calls.filter(c=>c.request.operation==='reopen_document_artifact').length,mode.startsWith('save')?0:1);}finally{await f.cleanup();}
});
for(const mode of ['reopen-refused','query-fail-once'])test(`P1 bounded retry reuses confirmed artifact and readonly document: ${mode}`,async()=>{
 const f=await fixture(mode);try{await f.start();await assert.rejects(f.owner.saveTaskArtifact('task',f.path));assert.equal(f.owner.facts().frozen,false);const result=await f.owner.saveTaskArtifact('task',f.path);assert.equal(result.file_verification!.status,'verified');const calls=await f.calls();assert.equal(calls.filter(c=>c.request.operation==='save_document_artifact').length,1);assert.equal(calls.filter(c=>c.request.operation==='reopen_document_artifact'&&c.receipt.native_invoked).length,1);}finally{await f.cleanup();}
});
for(const mode of ['summary-mismatch','query-wrong-id'])test(`P1 mismatched verification data cannot pass or adopt a document: ${mode}`,async()=>{
 const f=await fixture(mode);try{await f.start();await assert.rejects(f.owner.saveTaskArtifact('task',f.path));assert.equal(f.owner.facts().artifact!.file_verification,undefined);assert.equal(f.owner.facts().native_target!.document_id,'work-A');assert.equal(f.owner.facts().frozen,false);}finally{await f.cleanup();}
});
test('advertised malformed P1 capability refuses connection without fallback',async()=>{const f=await fixture('bad-cap');try{await assert.rejects(f.connect(),/CAPABILITIES_INVALID/);}finally{await f.cleanup();}});

for(const mode of ['ok','summary-mismatch'])test(`Scheduler cannot finish before independent artifact delivery: ${mode}`,async()=>{
 const f=await fixture(mode),events:any[]=[],states:any[]=[];try{await f.connect();for(const t of f.owner.definitions())f.ctx.tools.register(t);
 const task='绘制一条直线并保存为 '+f.path;
 const runtime={completed:()=>[],reviewStats:()=>({capture_attempts:1,model_calls:1}),async reviewCadView(){return {review_valid:true,structured:{verdict:'pass',defects:[],uncertainties:[],checklist:[{requirement_id:'v',status:'pass',evidence:'Offline visual fixture'}]},evidence:{sha256:'f'.repeat(64)},image_ref:'offline-capture',attempts:[{id:'offline-vision',status:'succeeded',valid:true,text:'Fixture'}]};},async run(_profile:string,_instruction:string,request:any){
  const submit=request?.extraTools?.find((t:any)=>t.name==='cader_submit_acceptance_plan');
  if(submit)await submit.execute({version:1,domain:'generic',components:[],visual_required:true,requirements:[{id:'v',check:'visual',source_quote:task,description:'Fixture visual condition'},{id:'new',check:'new_document',source_quote:task,description:'New document'},{id:'saved',check:'saved_dwg',source_quote:task,description:'Saved DWG'}]},{concludeTurn(){}});
  else for(const [name,args] of [['new_drawing',{}],['draw_line',{start_x:0,start_y:0,start_z:0,end_x:5,end_y:0,end_z:0}],['save_drawing',{file_path:f.path}]] as const){const reply=await invokeTool(f.ctx,'mcp__autocad__'+name,args);assert.equal(reply.isError,false,JSON.stringify({name,reply}));}
  return {id:'offline-scheduler',profile:'fixture',status:'succeeded',tools:[],text:'Offline deterministic model fixture'};
 }};
 const result=await runQualityTask({runtime:runtime as never,owner:f.owner,task,profile:'fixture',emit:e=>events.push(e),persist:async s=>{states.push(structuredClone(s));}});
 assert.equal(result.quality_accepted,mode==='ok',JSON.stringify({phase:result.phase,failure:result.failure,visual:result.visual,checks:result.checks}));assert.equal(result.phase,mode==='ok'?'complete':'blocked',JSON.stringify({failure:result.failure,visual:result.visual,checks:result.checks}));
 assert.ok(states.every(s=>!s.quality_accepted||s.phase==='complete'));
 const phases=result.transitions.map(e=>e.phase);assert.ok(!phases.includes('complete')||mode==='ok');
 assert.equal((await f.calls()).filter(c=>c.request.operation==='reopen_document_artifact').length,1);
 if(mode==='ok')assert.equal(result.artifact!.file_verification!.status,'verified');else assert.ok(result.checks.some(c=>c.id==='artifact_delivery'&&c.status==='not_run'));
 }finally{await f.cleanup();}
});

for(const path of ['\\\\server\\share\\file.dwg','../file.dwg'])test(`P1 rejects unsafe original path before normalized dispatch: ${path}`,async()=>{
 const f=await fixture('ok');try{await f.start();const result=await invokeTool(f.ctx,'mcp__autocad__save_drawing',{file_path:path});assert.equal(result.isError,true);assert.equal(f.owner.facts().frozen,false);assert.equal((await f.calls()).filter(c=>c.request.operation==='save_document_artifact').length,0);}finally{await f.cleanup();}
});
test('changed verification copy invalidates proof before native query without replay',async()=>{
 const f=await fixture('ok');try{await f.start();const saved=await f.owner.saveTaskArtifact('task',f.path);const count=(await f.calls()).length;await writeFile(saved.file_verification!.document.path,'AC1032 changed evidence');await assert.rejects(f.owner.verifyTaskArtifact('task'),/FINGERPRINT/);assert.equal(f.owner.facts().artifact!.file_verification,undefined);const calls=(await f.calls()).slice(count);assert.equal(calls.filter(c=>['save_document_artifact','reopen_document_artifact','query_verification_entities'].includes(c.request.operation)).length,0);}finally{await f.cleanup();}
});

test('P1 namespace never bypasses workspace permissions for an external parent (including other drives)',async()=>{
 const f=await fixture('ok');try{await f.start();const path=join(tmpdir(),'cader-no-dispatch-'+Date.now()+'.dwg');const result=await invokeTool(f.ctx,'mcp__autocad__save_drawing',{file_path:path});assert.equal(result.isError,true);assert.equal(f.owner.facts().frozen,false);assert.equal((await f.calls()).filter(c=>c.request.operation==='save_document_artifact').length,0);}finally{await f.cleanup();}
});

test('continuing a completed redraw reports the actual P1 artifact path, never the old requested path',async()=>{
 const f=await fixture('ok');await cp('configs',join(f.root,'configs'),{recursive:true,filter:p=>!(/\.local\.(yaml|json)$/.test(p))});
 const chat=await InteractiveSession.create(f.root,f.root,async()=>{throw new Error('Completed task must not execute');});
 try{const actual=join(f.root,'artifact-existing','deliver.dwg'),manifest=join(f.root,'quality.json');await writeFile(manifest,JSON.stringify({task_id:'completed',phase:'complete',original_request:'复现参考图',round:0,checks:[],artifact:{path:actual}}));chat.state.qualityRun=manifest;chat.state.redrawTask={request:'复现参考图',outputPath:f.path,freshDrawing:true,image:{path:join(f.root,'source.png'),sha256:'f'.repeat(64),width:100,height:100},qualityRun:manifest};const result=await chat.execute('继续');assert.ok(result.text.includes(actual));assert.ok(!result.text.includes('DWG：'+f.path+'；'));}finally{await chat.dispose();await f.cleanup();}
});

for(const extra of [{overwrite:true},{backup_format:'dxf'}])test(`P1 never silently changes overwrite intent or drops unmapped arguments: ${JSON.stringify(extra)}`,async()=>{
 const f=await fixture('ok');try{await f.start();const result=await invokeTool(f.ctx,'mcp__autocad__save_drawing',{file_path:f.path,...extra});assert.equal(result.isError,true);assert.equal(f.owner.facts().frozen,false);assert.equal((await f.calls()).filter(c=>c.request.operation==='save_document_artifact').length,0);}finally{await f.cleanup();}
});
