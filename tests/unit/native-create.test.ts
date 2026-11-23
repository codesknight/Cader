import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,writeFile,rm,readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { ExecutionSession,toolResultLine } from '@cader/profile';
import { createToolRuntime,invokeTool } from '@cader/dsh-adapter';

// Real stdio transport/DSH adapter; deterministic server, never real CAD.
const server=String.raw`
import {createInterface} from 'node:readline';
let calls=0;
const mode=process.argv[2];
const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
createInterface({input:process.stdin}).on('line',line=>{
 const msg=JSON.parse(line);if(msg.id===undefined)return;
 if(msg.method==='initialize')return reply(msg.id,{protocolVersion:msg.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'offline-native-fixture',version:'1'}});
 if(msg.method==='tools/list')return reply(msg.id,{tools:['new_drawing','query_entities','get_backend_status'].map(name=>({name,description:'Offline native boundary fixture',inputSchema:{type:'object',properties:name==='new_drawing'?{request_id:{type:'string'}}:{},additionalProperties:false}}))});
 if(msg.method==='tools/call'){
  const {name,arguments:args}=msg.params;
  if(name==='new_drawing'&&++calls===1){
   const evidence={contract:'autocad-native-create/1',operation:'new_document',request_id:mode==='mismatch'?'stale-request':args.request_id,stage:mode==='binding'?'binding':mode==='native'?'native_call':'preflight',native_invoked:['native','binding'].includes(mode),native_acknowledged:mode==='binding',implicit_creates:mode==='implicit'?1:0,before_documents:[],exception:{type:'AttributeError',message:'<unknown>.Add',hresult:null,traceback:'fixture only'}};
   return reply(msg.id,{isError:true,structuredContent:evidence,content:[{type:'text',text:mode==='legacy'?'Error executing tool new_drawing: <unknown>.Add':JSON.stringify(evidence)}]});
  }
  const value=name==='new_drawing'?'Fixture.dwg':name==='query_entities'?[]:{backend:'com',connection_state:'not_probed',fixture_calls:calls};
  return reply(msg.id,{content:[{type:'text',text:JSON.stringify(value)}]});
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}})+'\n');
});
`;

for(const mode of ['preflight','native','binding','mismatch','implicit','legacy'])test(`native creation evidence across real stdio: ${mode}`,async()=>{
  const parent=resolve('.cader/tests');await mkdir(parent,{recursive:true});const directory=await mkdtemp(join(parent,'native-create-'));
  const config=join(directory,'mcp.json');await writeFile(join(directory,'server.mjs'),server);
  await writeFile(config,JSON.stringify({version:1,server_name:'autocad',transport:'stdio',command:process.execPath,args:[join(directory,'server.mjs'),mode],cwd:directory,startup_timeout_ms:10000,tool_timeout_ms:10000}));
  const owner=new ExecutionSession(directory,join(directory,'.cader/runs/fixture'));const ctx=await createToolRuntime();
  try{
    // A Node subprocess must not inherit the test runner's binary stdout mode.
    const runnerContext=process.env.NODE_TEST_CONTEXT;delete process.env.NODE_TEST_CONTEXT;
    try{await owner.connect(config);}finally{if(runnerContext!==undefined)process.env.NODE_TEST_CONTEXT=runnerContext;}
    owner.mode='workspace-write';
    for(const tool of owner.definitions())ctx.tools.register(tool);
    const first=await invokeTool(ctx,'mcp__autocad__new_drawing',{request_id:'model-must-not-select-correlation'});
    assert.equal(first.isError,true);
    const record=owner.facts().operations.at(-1)!;
    assert.equal(record.transport_dispatched,true);
    if(mode==='preflight'){
      assert.equal(owner.facts().frozen,false);assert.equal(record.native_dispatched,false);
      assert.equal(record.stage,'native_preflight');assert.equal(record.outcome,'failed_before_dispatch');
      assert.equal(record.dispatched,false);
      const audit=await readFile(join(directory,'.cader/runs/fixture/execution.jsonl'),'utf8');
      assert.ok(audit.includes(record.operation_id));assert.ok(audit.includes('autocad-native-create/1'));
      assert.equal((await invokeTool(ctx,'mcp__autocad__new_drawing',{})).isError,false);
      assert.equal(owner.facts().session_counts.committed,1);
      assert.match(toolResultLine({type:'tool.result',tool:'new_drawing',isError:true,cadFailure:{code:'CAD_FAILED_BEFORE_DISPATCH',stage:'native_preflight',dispatched:false,transport_dispatched:true,native_dispatched:false}}),/MCP已送达，原生未调用/);
    }else{
      assert.equal(owner.facts().frozen,true);assert.equal(record.outcome,'unknown');
      assert.equal((await invokeTool(ctx,'mcp__autocad__new_drawing',{})).isError,true);
      assert.equal(owner.facts().operations.filter(r=>r.dispatched).length,1);
    }
  }finally{await owner.dispose();await ctx.fiber.dispose();assert.ok(directory.startsWith(parent));await rm(directory,{recursive:true});}
});
