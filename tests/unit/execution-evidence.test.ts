import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {crc32,deflateSync} from 'node:zlib';
import {ExecutionSession,toolResultLine} from '@cader/profile';
import {createToolRuntime,invokeTool,observedArguments} from '@cader/dsh-adapter';

// Actual stdio + DSH + owner boundary. Server/native data are deterministic fixtures, NOT CAD.
const server=String.raw`
import {createInterface} from 'node:readline';
import {appendFileSync,readFileSync,copyFileSync} from 'node:fs';
const [mode,log,audit,png]=process.argv.slice(2);let bindings=0,label='Fixture.dwg',count=0,readFail=false;const records=new Map();
const identity={instance_id:'instance-A',document_id:'document-A'};
const cap={contract:'autocad-backend-evidence/1',document_identity:{supported:true,scope:'python_com_session',mechanism:'canonical_iunknown_lifecycle',entity_ids_scope:'document'},revision:{authoritative:false,manual_edits_observed:false,mode:'unsupported'},execution_receipts:{supported:true,contract:'autocad-execution/1',entrypoint:'execute_observed_operation',native_action_ack:true,automatic_write_replay:false,operations:['new_document','draw_line','draw_circle','draw_text','move_entity','delete_entity','save_drawing','get_entity','query_entities','export_current_view']},reconciliation:{supported:true,scope:'python_backend_lifetime',survives_python_restart:false,missing_record_proves_not_executed:false}};
if(mode==='bad-cap')cap.contract='invented/9';
const fields={new_drawing:{request_id:{type:'string'}},draw_line:Object.fromEntries(['start_x','start_y','start_z','end_x','end_y','end_z'].map(k=>[k,{type:'number'}])),draw_polyline:{points:{type:'array'},closed:{type:'boolean'}},query_entities:{entity_type:{type:'string'}},get_entity:{object_id:{type:'integer'}},move_entity:{object_id:{type:'integer'},offset_x:{type:'number'},offset_y:{type:'number'},offset_z:{type:'number'}},delete_entity:{object_id:{type:'integer'}},execute_observed_operation:{instance_id:{type:'string'},request_id:{type:'string'},operation:{type:'string'},arguments:{type:'object'},document_id:{anyOf:[{type:'string'},{type:'null'}]}},export_current_view:{file_path:{type:'string'},request_id:{type:'string'}},get_execution_status:{instance_id:{type:'string'},request_id:{type:'string'}}};
const names=['new_drawing','draw_line','draw_polyline','move_entity','delete_entity','query_entities','get_entity','get_backend_status','get_document_binding','execute_observed_operation','get_execution_status','export_current_view'];
if(mode.startsWith('capture-local')&&mode!=='capture-local-legacy')Object.assign(fields.export_current_view,{world_window:{type:'array',minItems:4,maxItems:4,items:{type:'number'}},min_long_edge:{type:'integer'}});
const binding=()=>{bindings++;return {...identity,name:label,managed:!(mode==='unmanaged'&&bindings>2),read_only:mode==='readonly'&&bindings>2,revision:null,revision_mode:'unsupported',...(mode==='changed'&&bindings>2?{document_id:'document-B'}:{}),...(mode==='instance-changed'&&bindings>2?{instance_id:'instance-B'}:{})};};
const result=(q,data,error=false)=>q({isError:error,...(data&&typeof data==='object'&&!Array.isArray(data)?{structuredContent:data}:{}),content:[{type:'text',text:JSON.stringify(data)}]});
const receipt=(a)=>{const reading=['query_entities','get_entity'].includes(a.operation);return {contract:'autocad-execution/1',backend:'com',instance_id:'instance-A',request_instance_id:a.instance_id,request_id:a.request_id,operation:a.operation,request_document_id:a.document_id,result_document_id:'document-A',status:'succeeded',stage:'completed',revision:null,revision_mode:'unsupported',native_actions:reading?[]:[{name:'native-'+a.operation,acknowledged:true}],native_invoked:!reading,native_acknowledged:!reading,observation:'succeeded',affected_entities:{created:a.operation==='draw_line'?['42']:[],modified:a.operation==='move_entity'?[String(a.arguments.object_id)]:[],deleted:a.operation==='delete_entity'?[String(a.arguments.object_id)]:[],complete:true},service_request_fingerprint:'a'.repeat(64),fingerprint_algorithm:'sha256-canonical-com-request-v1',retention:{scope:'python_backend_lifetime',terminal_ttl_seconds:600,capacity:2048},error:null};};
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;const reply=v=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:v})+'\n');
 if(m.method==='initialize')return reply({protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'offline-evidence-fixture',version:'1'}});
 if(m.method==='tools/list')return reply({tools:names.filter(n=>mode!=='missing-tool'||n!=='get_execution_status').map(name=>({name,description:'Offline evidence fixture',inputSchema:{type:'object',properties:{...(fields[name]??{}),...(['draw_line','draw_polyline'].includes(name)?{layer:{type:'string'}}:{})},additionalProperties:false}}))});
 if(m.method!=='tools/call')return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}})+'\n');
 const {name,arguments:a}=m.params;let prepared=false;
 if(name==='execute_observed_operation')try{prepared=readFileSync(audit,'utf8').split('\n').filter(Boolean).some(l=>{const r=JSON.parse(l);return r.request_json===JSON.stringify(a)&&r.request===a.request_id||r.request_json===JSON.stringify(a)&&['evidence_request_prepared','capture_prepared'].includes(r.phase);});}catch{}
 appendFileSync(log,JSON.stringify({name,args:a,prepared})+'\n');
 if(name==='get_backend_status')return result(reply,{backend:'com',instance_id:'instance-A',capabilities:mode==='legacy'?{}:{evidence_support:cap},connection_state:'not_probed',documents:[]});
 if(name==='get_document_binding')return result(reply,binding());
 if(name==='get_execution_status'){
   if(mode==='expired')return result(reply,{contract:'autocad-execution/1',backend:'com',instance_id:a.instance_id,request_id:a.request_id,status:'unresolved',reason:'RECORD_NOT_AVAILABLE',replay_safe:false});
   const r=structuredClone(records.get(a.request_id));if(mode==='wrong-status')r.request_id='unrelated';if(mode==='fingerprint')r.service_request_fingerprint='b'.repeat(64);return result(reply,r);
 }
 if(name==='execute_observed_operation'){
   const r=receipt(a);let value=a.operation==='new_document'?'Fixture.dwg':a.operation==='query_entities'?[]:a.operation==='get_entity'?{object_id:a.arguments.object_id,type:'AcDbLine'}:a.operation==='draw_line'?42:null;
   if(a.operation==='new_document'&&mode==='new-unbound'){r.status='failed';r.stage='observation_failed';r.result_document_id=null;r.observation='failed';r.affected_entities.complete=false;r.error={message:'binding read failed'};records.set(a.request_id,r);return result(reply,{receipt:r,result:null},true);}
   if(a.operation==='draw_line'){
     count++;
     if(mode==='rename')label='Renamed.dwg';
     if(['refused','ack-failed','unknown','expired','wrong-status','fingerprint','pending'].includes(mode)){r.status='failed';r.stage=mode==='refused'?'not_dispatched':mode==='ack-failed'?'observation_failed':'result_unknown';r.native_invoked=mode!=='refused';r.native_acknowledged=mode==='ack-failed';r.native_actions=mode==='refused'?[]:[{name:'AddLine',acknowledged:mode==='ack-failed'}];r.result_document_id=mode==='refused'?null:'document-A';r.observation='failed';r.affected_entities.complete=false;r.error={message:'fixture refused/binding/ACK loss'};if(mode==='refused')r.affected_entities.created=[];}
     if(['read-busy','read-terminal'].includes(mode))readFail=true;
     if(mode==='wrong-request')r.request_id='unrelated';if(mode==='wrong-document')r.result_document_id='document-B';if(mode==='wrong-instance')r.instance_id='instance-B';if(mode==='wrong-operation')r.operation='delete_entity';if(mode==='missing-ack')delete r.native_actions;if(mode==='contradiction')r.native_invoked=false;if(mode==='false-effects'){r.stage='not_dispatched';r.status='failed';r.result_document_id=null;r.native_invoked=false;r.native_acknowledged=false;r.native_actions=[];r.observation='failed';r.affected_entities.complete=false;r.error={message:'contradictory refusal'};}if(mode==='incomplete')r.affected_entities.complete=false;if(mode==='wrong-effect')r.affected_entities.modified=['99'];
   }
   if(a.operation==='get_entity'&&readFail){readFail=false;r.status='failed';r.stage='observation_failed';r.observation='failed';r.affected_entities.complete=false;r.error={message:'readback failed',hresult:mode==='read-busy'?-2147418111:null};}
   if(a.operation==='export_current_view'){
     const layout={ConfigName:'',CanonicalMediaName:'original',PlotType:0,PlotRotation:0,UseStandardScale:true,StandardScale:0,CenterPlot:false,PaperUnits:1,PlotOrigin:[0,0],window:[[0,0],[1,1]],custom_scale:[1,1]};const state={layout,background:3,quiet:false,configurations:[]};
     const capture={contract:'autocad-capture/1',request_id:a.request_id,file_path:a.arguments.file_path,document:label,layout:'Model',stage:'complete',capture_mutations_started:true,mutation_uncertain:false,restoration_verified:true,cleanup_verified:true,before:state,after:structuredClone(state),backup_name:'_MCP_CAPTURE_'+'a'.repeat(32),actions:['backup_add','backup_copy','foreground','quiet','device','refresh_device','rotation','window','plot_type','standard_scale','fit','center','plot_to_file','restore_layout','restore_background','restore_quiet','delete_backup'].map(name=>({name,acknowledged:true})),restoration_errors:[],error:null};
     if(mode.startsWith('capture-local')){capture.requested_view={world_window:a.arguments.world_window,min_long_edge:a.arguments.min_long_edge};capture.view_evidence={world_window:mode==='capture-local-window'?[1,1,2,2]:a.arguments.world_window,dcs_window:[[0,0],[10,10]],canonical_media:'Synthetic_512',configuration_verified:mode!=='capture-local-unverified',expected_pixels:mode==='capture-local-size'?[1024,512]:[512,512],projection:'WCS_XY_TOP',pixel_to_world:null,mapping_mode:'window_and_fit; exact pixel mapping unsupported'};capture.actions.push({name:'media',acknowledged:true});}
     copyFileSync(png,a.arguments.file_path);value=mode==='capture-no-proof'?a.arguments.file_path:{result:a.arguments.file_path,capture};
     if(['capture-safe','capture-unknown'].includes(mode)){r.status='failed';r.stage=mode==='capture-safe'?'observation_failed':'result_unknown';r.native_acknowledged=mode==='capture-safe';r.native_actions=[{name:'plot',acknowledged:mode==='capture-safe'}];r.observation='failed';r.affected_entities.complete=false;r.error={message:'fixture final observation failed'};r.native_detail=capture;}

   }
   records.set(a.request_id,structuredClone(r));
   if(mode==='lost'&&a.operation==='draw_line')return reply({isError:true,content:[{type:'text',text:'transport returned no native proof'}]});
   return result(reply,{receipt:r,result:r.status==='failed'?null:value},r.status==='failed');
 }
 if(name==='draw_polyline'&&mode==='legacy-failure')return reply({isError:true,content:[{type:'text',text:'legacy mutation returned no ACK'}]});
 // Old interfaces are callable to detect accidental fallback; never evidence-qualified.
 return result(reply,name==='new_drawing'?'Legacy.dwg':name==='query_entities'?[]:['draw_line','draw_polyline'].includes(name)?'object_id=43':name==='get_entity'?{object_id:a.object_id}:null);
});`;
async function fixture(mode:string){
  const parent=resolve('.cader/tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'evidence-')),audit=join(root,'.cader/runs/test/execution.jsonl'),log=join(root,'calls.jsonl');
  let png=resolve('benchmark/fixtures/vision-calibration.png');
  if(mode.startsWith('capture-local')){
    const chunk=(name:string,data:Buffer)=>{const type=Buffer.from(name),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([size,type,data,crc]);};
    const header=Buffer.alloc(13);header.writeUInt32BE(512,0);header.writeUInt32BE(512,4);header[8]=8;header[9]=2;const line=Buffer.alloc(1537,255);line[0]=0;png=join(root,'synthetic-local.png');await writeFile(png,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:512},()=>line)))),chunk('IEND',Buffer.alloc(0))]));
  }
  await writeFile(join(root,'server.mjs'),server);const config=join(root,'mcp.json');await writeFile(config,JSON.stringify({version:1,server_name:'autocad',transport:'stdio',command:process.execPath,args:[join(root,'server.mjs'),mode,log,audit,png],cwd:root,startup_timeout_ms:10000,tool_timeout_ms:10000}));
  const owner=new ExecutionSession(root,join(root,'.cader/runs/test')),ctx=await createToolRuntime();owner.mode='workspace-write';
  const connect=async()=>{const old=process.env.NODE_TEST_CONTEXT;delete process.env.NODE_TEST_CONTEXT;try{return await owner.connect(config);}finally{if(old!==undefined)process.env.NODE_TEST_CONTEXT=old;}};
  const calls=async()=>(await readFile(log,'utf8')).split('\n').filter(Boolean).map(l=>JSON.parse(l));
  const install=()=>{for(const t of [...owner.definitions(),...owner.controlTools()])ctx.tools.register(t);};
  return {root,audit,owner,ctx,connect,calls,install,async cleanup(){await owner.dispose();await ctx.fiber.dispose();assert.ok(root.startsWith(parent));await rm(root,{recursive:true});}};
}
const line={start_x:0,start_y:0,start_z:0,end_x:10,end_y:0,end_z:0};
for(const mode of ['capture-local-ok','capture-local-window','capture-local-size','capture-local-unverified','capture-local-legacy'])test(`actual stdio local capture maps window arguments, verifies pixels and never bypasses evidence: ${mode}`,async()=>{
  const f=await fixture(mode);try{await f.connect();f.install();await invokeTool(f.ctx,'mcp__autocad__new_drawing',{});
    const view={world_window:[0,0,10,10] as [number,number,number,number],min_long_edge:512};
    if(mode==='capture-local-ok'){const captured=await f.owner.captureView(new AbortController().signal,undefined,view);assert.equal(captured.evidence.width,512);assert.equal(captured.evidence.view,'native WCS window plot');}
    else await assert.rejects(f.owner.captureView(new AbortController().signal,undefined,view),mode==='capture-local-legacy'?/UNSUPPORTED/:/PENDING_VERIFICATION/);
    assert.equal(f.owner.facts().frozen,false);assert.equal(f.owner.facts().session_counts.unknown,0);const calls=await f.calls(),captures=calls.filter(c=>c.name==='execute_observed_operation'&&c.args.operation==='export_current_view');assert.equal(captures.length,mode==='capture-local-legacy'?0:1);if(captures.length){assert.deepEqual(captures[0].args.arguments.world_window,view.world_window);assert.equal(captures[0].args.arguments.min_long_edge,512);assert.ok(captures[0].prepared);}
    assert.equal(calls.filter(c=>c.name==='export_current_view').length,0);
  }finally{await f.cleanup();}
});
for(const mode of ['ok','refused','ack-failed','unknown','lost','wrong-request','wrong-document','wrong-instance','wrong-operation','missing-ack','contradiction','false-effects','incomplete','wrong-effect','read-busy','read-terminal','rename'])test(`real stdio receipt grading without fallback/replay: ${mode}`,async()=>{
  const f=await fixture(mode);try{
    await f.connect();f.install();assert.equal(f.ctx.tools.get('mcp__autocad__execute_observed_operation'),undefined);
    assert.equal((await invokeTool(f.ctx,'mcp__autocad__new_drawing',{})).isError,false);
    const result=await invokeTool(f.ctx,'mcp__autocad__draw_line',line),facts=f.owner.facts(),last=facts.operations.at(-1)!;
    const success=['ok','read-busy','rename'].includes(mode);assert.equal(result.isError,!success,JSON.stringify(result));
    if(success){assert.equal(last.outcome,'committed');assert.equal(facts.frozen,false);assert.equal(last.execution_receipt!.request_id,last.operation_id);assert.equal(facts.native_target!.document_id,'document-A');}
    else if(mode==='refused'){assert.equal(last.outcome,'failed_before_dispatch');assert.equal(last.transport_dispatched,true);assert.equal(last.native_dispatched,false);assert.equal(facts.frozen,false);}
    else if(['ack-failed','read-terminal'].includes(mode)){assert.equal(last.outcome,'committed_observation_failed');assert.equal(last.execution_receipt!.operation,'draw_line');assert.equal(last.execution_receipt!.request_id,last.operation_id);assert.equal(facts.frozen,true);assert.equal((await f.owner.recover()).recovered,true);}
    else{assert.equal(last.outcome,'unknown');assert.equal(facts.frozen,true);assert.equal((await f.owner.recover()).recovered,false);assert.equal((await invokeTool(f.ctx,'mcp__autocad__draw_line',line)).isError,true);}
    const calls=await f.calls();assert.equal(calls.filter(c=>c.name==='draw_line').length,0);assert.equal(calls.filter(c=>c.name==='execute_observed_operation'&&c.args.operation==='draw_line').length,1);assert.ok(calls.filter(c=>c.name==='execute_observed_operation').every(c=>c.prepared));
    const dispatch=calls.find(c=>c.name==='execute_observed_operation'&&c.args.operation==='draw_line');assert.deepEqual(dispatch.args.arguments,{start:[0,0,0],end:[10,0,0]});
    if(mode==='read-busy'){const reads=calls.filter(c=>c.name==='execute_observed_operation'&&c.args.operation==='get_entity');assert.equal(reads.length,2);assert.notEqual(reads[0].args.request_id,reads[1].args.request_id);}
    if(mode==='rename'){assert.equal(facts.native_binding!.name,'Renamed.dwg');assert.equal(facts.scratch,'Fixture.dwg');}
    const audit=(await readFile(f.audit,'utf8')).split('\n').filter(Boolean).map(l=>JSON.parse(l));for(const p of audit.filter(e=>e.request_json))assert.equal(createHash('sha256').update(p.request_json).digest('hex'),p.request_sha256);
  }finally{await f.cleanup();}
});
for(const mode of ['changed','instance-changed','readonly','unmanaged'])test(`same-name/foreign/nonworking identity blocks before native dispatch: ${mode}`,async()=>{
  const f=await fixture(mode);try{await f.connect();f.install();await invokeTool(f.ctx,'mcp__autocad__new_drawing',{});assert.equal((await invokeTool(f.ctx,'mcp__autocad__draw_line',line)).isError,true);assert.equal(f.owner.facts().operations.at(-1)!.outcome,'failed_before_dispatch');assert.equal(f.owner.facts().frozen,false);assert.equal((await f.calls()).filter(c=>c.name==='execute_observed_operation'&&c.args.operation==='draw_line').length,0);}finally{await f.cleanup();}
});
for(const mode of ['bad-cap','missing-tool'])test(`advertised broken evidence cannot silently downgrade: ${mode}`,async()=>{const f=await fixture(mode);try{await assert.rejects(f.connect(),/CAPABILITIES_INVALID/);assert.equal(f.owner.facts().transport,'disconnected');assert.equal((await f.calls()).filter(c=>c.name==='execute_observed_operation').length,0);}finally{await f.cleanup();}});
for(const mode of ['unknown','expired','wrong-status','fingerprint','lost'])test(`journal lookup is current-request-only and never clears a barrier: ${mode}`,async()=>{
  const f=await fixture(mode);try{await f.connect();f.install();await invokeTool(f.ctx,'mcp__autocad__new_drawing',{});await invokeTool(f.ctx,'mcp__autocad__draw_line',line);const count=(await f.calls()).length;
    if(['wrong-status','fingerprint'].includes(mode))await assert.rejects(f.owner.executionStatus(),/MISMATCH|CHANGED/);else{const s=await f.owner.executionStatus();assert.equal(s.recovered,false);if(mode==='expired')assert.equal(s.reason,'RECORD_UNRESOLVED');}
    assert.equal(f.owner.facts().frozen,true);const after=(await f.calls()).slice(count);assert.equal(after.length,1);assert.equal(after[0].name,'get_execution_status');assert.equal(after[0].args.request_id,f.owner.facts().freeze!.operation_id);
  }finally{await f.cleanup();}
});
test('ACK without new-document result binding cannot recover or adopt the active document',async()=>{const f=await fixture('new-unbound');try{await f.connect();f.install();assert.equal((await invokeTool(f.ctx,'mcp__autocad__new_drawing',{})).isError,true);assert.equal(f.owner.facts().freeze!.outcome,'committed_observation_failed');assert.equal(f.owner.facts().scratch,null);assert.equal(f.owner.facts().native_target,null);assert.equal((await f.owner.recover()).recovered,false);}finally{await f.cleanup();}});
test('uncovered legacy operations keep identity guards; additive capture keeps plot receipt checks',async()=>{const f=await fixture('ok');try{await f.connect();f.install();await invokeTool(f.ctx,'mcp__autocad__new_drawing',{});assert.equal((await invokeTool(f.ctx,'mcp__autocad__draw_polyline',{points:[[0,0,0],[2,3,0]]})).isError,false);const capture=await f.owner.captureView(new AbortController().signal);assert.equal(capture.evidence.capture_receipt!.restoration_verified,true);assert.equal((await f.calls()).filter(c=>c.name==='draw_polyline').length,1);assert.equal((await f.calls()).filter(c=>c.name==='execute_observed_operation'&&c.args.operation==='export_current_view').length,1);}finally{await f.cleanup();}});
test('old servers continue legacy behavior without invented native identity',async()=>{const f=await fixture('legacy');try{await f.connect();f.install();assert.equal((await invokeTool(f.ctx,'mcp__autocad__new_drawing',{})).isError,false);assert.equal((await invokeTool(f.ctx,'mcp__autocad__draw_line',line)).isError,false);assert.equal(f.owner.facts().native_target,null);assert.equal((await f.calls()).some(c=>c.name==='execute_observed_operation'),false);}finally{await f.cleanup();}});
test('argument mappings preserve text angle/offset/overwrite and refuse unmapped fields',()=>{
  assert.deepEqual(observedArguments('draw_text',{position_x:1,position_y:2,position_z:0,text:'Fixture',height:2,rotation:90,layer:'TEXT'}),{operation:'draw_text',arguments:{position:[1,2,0],text:'Fixture',height:2,rotation:90,layer:'TEXT'}});
  assert.deepEqual(observedArguments('move_entity',{object_id:42,offset_x:1,offset_y:2,offset_z:0})!.arguments,{object_id:42,offset:[1,2,0]});
  assert.equal(observedArguments('save_drawing',{file_path:'fixture.dwg',overwrite:false})!.arguments.overwrite,false);
  assert.deepEqual(observedArguments('export_current_view',{file_path:'fixture.png',request_id:'request',world_window:[1,2,3,4],min_long_edge:2048})!.arguments,{file_path:'fixture.png',request_id:'request',world_window:[1,2,3,4],min_long_edge:2048});
  assert.deepEqual(observedArguments('export_current_view',{file_path:'fixture.png',request_id:'legacy'})!.arguments,{file_path:'fixture.png',request_id:'legacy'});
  assert.throws(()=>observedArguments('draw_line',{...line,unmapped:'lost'}),/TOOL_ARGUMENTS_INVALID/);
  assert.match(toolResultLine({type:'tool.result',tool:'cader_cad_execution_status',isError:false}),/写屏障状态不变/);
});

test('read-only and declined approval never dispatch an observed mutation',async()=>{
  for(const mode of ['read-only','ask'] as const){const f=await fixture('ok');try{await f.connect();f.owner.mode=mode;f.install();const result=await invokeTool(f.ctx,'mcp__autocad__new_drawing',{});assert.equal(result.isError,true);assert.equal((await f.calls()).filter(c=>c.name==='execute_observed_operation').length,0);assert.equal(f.owner.facts().frozen,false);}finally{await f.cleanup();}}
});
test('a reconnect preserves the unknown barrier and cannot query or adopt its old request',async()=>{
  const f=await fixture('unknown');try{await f.connect();f.install();await invokeTool(f.ctx,'mcp__autocad__new_drawing',{});await invokeTool(f.ctx,'mcp__autocad__draw_line',line);const lock=join(f.root,'.cader/locks/managed-write.json'),before=await readFile(lock);await f.connect();assert.deepEqual(await readFile(lock),before);assert.equal(f.owner.facts().native_target,null);assert.equal((await f.owner.executionStatus()).reason,'NO_CURRENT_OBSERVED_REQUEST');assert.equal(f.owner.facts().frozen,true);}finally{await f.cleanup();}
});

for(const mode of ['capture-safe','capture-unknown','capture-no-proof'])test(`capture restoration cannot bypass execution evidence: ${mode}`,async()=>{
  const f=await fixture(mode);try{await f.connect();f.install();await invokeTool(f.ctx,'mcp__autocad__new_drawing',{});await assert.rejects(f.owner.captureView(new AbortController().signal));assert.equal(f.owner.facts().frozen,mode!=='capture-safe');if(mode==='capture-unknown')assert.equal(f.owner.facts().freeze!.outcome,'unknown');}finally{await f.cleanup();}
});
test('uncovered legacy dispatch errors remain unknown; no observed fallback is invented',async()=>{
  const f=await fixture('legacy-failure');try{await f.connect();f.install();await invokeTool(f.ctx,'mcp__autocad__new_drawing',{});assert.equal((await invokeTool(f.ctx,'mcp__autocad__draw_polyline',{points:[[0,0,0],[2,3,0]]})).isError,true);assert.equal(f.owner.facts().freeze!.outcome,'unknown');assert.equal((await f.calls()).filter(c=>c.name==='draw_polyline').length,1);assert.equal((await f.calls()).filter(c=>c.name==='execute_observed_operation'&&c.args.operation==='draw_polyline').length,0);}finally{await f.cleanup();}
});
