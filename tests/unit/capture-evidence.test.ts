import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createToolRuntime,invokeTool,captureEvidence} from '@cader/dsh-adapter';
import {ExecutionSession} from '@cader/profile';

// Real MCP transport and owner policy, deterministic native receipt fixture.
const server=String.raw`
import {createInterface} from 'node:readline';
const mode=process.argv[2];
const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
createInterface({input:process.stdin}).on('line',line=>{
 const msg=JSON.parse(line);if(msg.id===undefined)return;
 if(msg.method==='initialize')return reply(msg.id,{protocolVersion:msg.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'capture-fixture',version:'1'}});
 if(msg.method==='tools/list')return reply(msg.id,{tools:['new_drawing','query_entities','get_backend_status','export_current_view'].map(name=>({name,description:'Offline fixture',inputSchema:{type:'object',properties:name==='export_current_view'?{file_path:{type:'string'},request_id:{type:'string'}}:{},additionalProperties:false}}))});
 if(msg.method==='tools/call'){
   const {name,arguments:args}=msg.params;
   if(name==='export_current_view'){
     const layout={ConfigName:'',CanonicalMediaName:'original',PlotType:0,PlotRotation:0,UseStandardScale:true,StandardScale:0,CenterPlot:false,PaperUnits:1,PlotOrigin:[0,0],window:[[0,0],[1,1]],custom_scale:[1,1]};
     const state={layout,background:3,quiet:false,configurations:[]};
     const evidence={contract:'autocad-capture/1',request_id:mode==='mismatch'?'other':args.request_id,file_path:args.file_path,document:'Fixture.dwg',layout:'Model',stage:mode==='preflight'?'preflight':'artifact',capture_mutations_started:mode!=='preflight',mutation_uncertain:mode==='unknown',restoration_verified:mode!=='preflight',cleanup_verified:mode!=='preflight',before:mode==='preflight'?null:state,after:mode==='preflight'?null:structuredClone(state),backup_name:'_MCP_CAPTURE_'+'a'.repeat(32),actions:mode==='preflight'?[]:[{name:'plot_to_file',acknowledged:mode!=='unknown'}],restoration_errors:[],error:{type:'RuntimeError',message:'fixture capture failed',hresult:null,traceback:'fixture only'}};
     if(mode!=='preflight')evidence.actions=['backup_add','backup_copy','foreground','quiet','device','refresh_device','rotation','plot_type','standard_scale','fit','center','plot_to_file','restore_layout','restore_background','restore_quiet','delete_backup'].map(name=>({name,acknowledged:!(mode==='unknown'&&name==='plot_to_file')}));
     if(mode==='changed')evidence.after.background=0;
     if(mode==='wrong-document')evidence.document='Other.dwg';
     if(mode==='unidentified-preflight')Object.assign(evidence,{stage:'preflight',document:null,layout:null,capture_mutations_started:false,restoration_verified:false,cleanup_verified:false,before:null,after:null,actions:[]});
     return reply(msg.id,{isError:true,structuredContent:evidence,content:[{type:'text',text:mode==='legacy'?'CAD_PLOT_RESTORE_FAILED':JSON.stringify(evidence)}]});
   }
   const value=name==='new_drawing'?'Fixture.dwg':name==='query_entities'?[]:{backend:'com',connection_state:'not_probed'};
   return reply(msg.id,{content:[{type:'text',text:JSON.stringify(value)}]});
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}})+'\n');
});`;

for(const mode of ['preflight','unidentified-preflight','restored','unknown','mismatch','changed','wrong-document','legacy'])test(`capture receipt through actual stdio preserves unknown safety: ${mode}`,async()=>{
  const parent=resolve('.cader/tests');await mkdir(parent,{recursive:true});const directory=await mkdtemp(join(parent,'capture-'));
  const path=join(directory,'server.mjs'),config=join(directory,'mcp.json');await writeFile(path,server);
  await writeFile(config,JSON.stringify({version:1,server_name:'autocad',transport:'stdio',command:process.execPath,args:[path,mode],cwd:directory,startup_timeout_ms:10000,tool_timeout_ms:10000}));
  const owner=new ExecutionSession(directory,join(directory,'.cader/runs/test'));const ctx=await createToolRuntime();
  try{
    const runner=process.env.NODE_TEST_CONTEXT;delete process.env.NODE_TEST_CONTEXT;
    try{await owner.connect(config);}finally{if(runner!==undefined)process.env.NODE_TEST_CONTEXT=runner;}
    owner.mode='workspace-write';for(const tool of owner.definitions())ctx.tools.register(tool);
    assert.equal((await invokeTool(ctx,'mcp__autocad__new_drawing',{})).isError,false);
    await assert.rejects(owner.captureView(new AbortController().signal));
    const preflight=mode==='preflight'||mode==='unidentified-preflight';
    const safe=preflight||mode==='restored';
    assert.equal(owner.facts().frozen,!safe);
    const record=owner.facts().operations.at(-1)!;
    assert.equal(record.outcome,safe?preflight?'failed_before_dispatch':'committed_observation_failed':'unknown');
    if(!safe){assert.equal((await invokeTool(ctx,'mcp__autocad__new_drawing',{})).isError,true);assert.equal(owner.facts().session_counts.unknown,1);}
  }finally{await owner.dispose();await ctx.fiber.dispose();assert.ok(directory.startsWith(parent));await rm(directory,{recursive:true});}
});

test('partial or prose capture evidence is never trusted',()=>{
  for(const value of [null,'restored',{}, {contract:'autocad-capture/1',restoration_verified:true}])assert.equal(captureEvidence(value,'nonce','file.png'),undefined);
});
