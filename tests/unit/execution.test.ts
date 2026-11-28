import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ExecutionSession } from '@cader/profile';
import { createToolRuntime, defineTool, invokeTool } from '@cader/dsh-adapter';
import type { createMcpClient } from '@cader/dsh-adapter';

test('targeted native snapshots query only exact IDs and cannot replace full-document cache or accept a mismatched ID',async()=>{
 await mkdir('.cader/tests',{recursive:true});const root=await mkdtemp(resolve('.cader/tests/target-snapshot-')),calls:string[]=[];let wrong=false;
 const names=['new_drawing','query_entities','get_entity','get_backend_status'];const definitions=names.map(name=>defineTool({name:'mcp__autocad__'+name,description:'Offline scope fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){throw Error('Owner required');}}));
 const factory:typeof createMcpClient=async()=>({definitions:()=>definitions,toolNames:()=>names,async dispose(){},async call(name,args){calls.push(name);if(name==='new_drawing')return 'Fixture.dwg';if(name==='query_entities')return [{object_id:42},{object_id:99}];if(name==='get_entity')return {object_id:wrong?99:(args as {object_id:number}).object_id};return {};}});
 const owner=new ExecutionSession(root,join(root,'.cader/runs/owner'),undefined,factory),ctx=await createToolRuntime();owner.mode='workspace-write';
 try{await owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));for(const tool of owner.definitions())ctx.tools.register(tool);assert.equal((await invokeTool(ctx,'mcp__autocad__new_drawing',{})).isError,false);
  const full=await owner.snapshot();assert.equal(full.scope,'full_document');assert.equal(owner.facts().cad_observation.entity_count,2);calls.length=0;
  const partial=await owner.snapshot([42]);assert.equal(partial.scope,'entity_set');assert.deepEqual(partial.entities,[{object_id:42}]);assert.equal(calls.includes('query_entities'),false);assert.equal(calls.filter(n=>n==='get_entity').length,1);assert.equal(owner.facts().cad_observation.entity_count,2);
  for(const ids of [[],[42,42],[-1],Array.from({length:65},(_,i)=>i+1)])await assert.rejects(owner.snapshot(ids),/INVALID_ENTITY_SNAPSHOT_SCOPE/);
  wrong=true;await assert.rejects(owner.snapshot([42]),/ENTITY_SNAPSHOT_ID_MISMATCH/);assert.equal(owner.facts().cad_observation.entity_count,2);assert.equal(owner.facts().frozen,false);
 }finally{await owner.dispose();await ctx.fiber.dispose();await rm(root,{recursive:true});}
});

test('transient COM read rejection retries only readback, never the acknowledged mutation',async()=>{
  await mkdir('.cader/tests',{recursive:true});
  const root=await mkdtemp(resolve('.cader/tests/readback-retry-')),calls:string[]=[];let busy=0;
  const definitions=['new_drawing','draw_circle','query_entities','get_entity','get_backend_status'].map(name=>defineTool({name:`mcp__autocad__${name}`,description:'Offline readback fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},async execute(){throw new Error('owner required');}}));
  const client:typeof createMcpClient=async()=>({definitions:()=>definitions,toolNames:()=>definitions.map(t=>t.name.split('__').at(-1)!),async dispose(){},async call(name){calls.push(name);if(name==='new_drawing')return 'Fixture.dwg';if(name==='draw_circle'){busy=2;return 'object_id=42';}if(name==='get_entity'){if(busy-->0)throw Object.assign(new Error('fixture read rejected'),{failure:{error:{message:"(-2147418111, 'RPC_E_CALL_REJECTED', None, None)"}}});return {object_id:42,type:'AcDbCircle'};}return name==='query_entities'?[]:{};}});
  const owner=new ExecutionSession(root,join(root,'.cader/runs/owner'),undefined,client);owner.mode='workspace-write';await owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));const ctx=await createToolRuntime();for(const t of owner.definitions())ctx.tools.register(t);
  try{
    assert.equal((await invokeTool(ctx,'mcp__autocad__new_drawing',{})).isError,false);
    assert.equal((await invokeTool(ctx,'mcp__autocad__draw_circle',{})).isError,false);assert.equal(owner.facts().frozen,false);
    assert.equal(calls.filter(n=>n==='draw_circle').length,1);assert.equal(calls.filter(n=>n==='get_entity').length,3);
    const journal=await readFile(join(root,'.cader/runs/owner/execution.jsonl'),'utf8');assert.equal(journal.split('\n').filter(l=>l.includes('readonly_retry')).length,2);
  }finally{await ctx.fiber.dispose();await owner.dispose();await rm(root,{recursive:true});}
});

async function setup() {
  await mkdir('.cader/tests', { recursive: true });
  const root = await mkdtemp(resolve('.cader/tests/execution-'));
  const calls: string[] = []; let fail = false, postflightFailure = false, queryPending = false, slow = false;
  const definitions = ['new_drawing', 'draw_circle', 'delete_entity', 'query_entities', 'get_backend_status', 'unreviewed_write'].map(name => defineTool({
    name: `mcp__autocad__${name}`, description: name, parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() { throw new Error('must dispatch through owner'); } }));
  const factory: typeof createMcpClient = async () => ({ definitions: () => definitions, toolNames: () => definitions.map(d => d.name),
    async call(name) { calls.push(name); if (fail && name === 'draw_circle') throw Object.assign(new Error('response lost'), { code: 'TIMEOUT', failure: { hresult: -2147418111, message: 'RPC call rejected' } });
      if (name === 'draw_circle') { if (slow) await new Promise(resolve => setTimeout(resolve, 100)); queryPending = postflightFailure; }
      if ((name === 'query_entities'||name==='get_entity') && queryPending) { queryPending = false; throw new Error('readback temporarily failed'); }
      return name === 'new_drawing' ? 'Scratch.dwg' : name === 'query_entities' ? [] : name==='draw_circle'?'draw_circle ok, object_id=42':{}; }, async dispose() {} });
  const owner = new ExecutionSession(root, join(root, '.cader/runs/test'), undefined, factory);
  await owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
  const ctx = await createToolRuntime();
  return { root, owner, ctx, calls, setFail() { fail = true; },
    setPostflightFailure() { postflightFailure = true; }, setSlow() { slow = true; },
    install(confirm?: (description: string, cwd: string) => Promise<boolean>) {
      for (const tool of [...owner.definitions(confirm), ...owner.fileTools(confirm)]) ctx.tools.register(tool);
    }, async cleanup() { await owner.dispose(); await ctx.fiber.dispose(); await rm(root, { recursive: true }); } };
}

test('dynamic CAD dispatch enforces ask/read-only and a fresh scratch binding, with no invented capabilities', async () => {
  const f = await setup(); let approvals = 0; f.install(async () => { approvals++; return true; });
  try {
    assert.equal(f.ctx.tools.get('mcp__autocad__unreviewed_write'), undefined);
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__draw_circle', {})).isError, true);
    f.owner.mode = 'read-only'; assert.equal((await invokeTool(f.ctx, 'mcp__autocad__new_drawing', {})).isError, true);
    assert.equal(approvals, 0); f.owner.mode = 'ask';
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__new_drawing', {})).isError, false);
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__draw_circle', {})).isError, false);
    assert.equal(approvals, 2); assert.ok(f.calls.includes('query_entities'));
  } finally { await f.cleanup(); }
});

test('task approval covers owned entity patches, expires afterward and cannot delete other entities', async () => {
  const f=await setup();let approvals=0;
  const confirm=async()=>++approvals===1;
  f.install(confirm);
  try{
    assert.equal(await f.owner.authorizeTask('fixture-task',{requirements:[]} as never,confirm),true);
    assert.equal((await invokeTool(f.ctx,'mcp__autocad__new_drawing',{})).isError,false);
    assert.equal((await invokeTool(f.ctx,'mcp__autocad__draw_circle',{})).isError,false);
    assert.equal((await invokeTool(f.ctx,'mcp__autocad__delete_entity',{object_id:42})).isError,false);
    assert.equal(approvals,1);
    assert.equal((await invokeTool(f.ctx,'mcp__autocad__delete_entity',{object_id:99})).isError,true);
    assert.equal(f.calls.filter(name=>name==='delete_entity').length,1);
    f.owner.endTask();
    assert.equal((await invokeTool(f.ctx,'mcp__autocad__draw_circle',{})).isError,true);
    assert.equal(approvals,3);
    const connection=f.owner.facts().local_connection_id;
    await f.owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
    assert.notEqual(f.owner.facts().local_connection_id,connection);
  }finally{await f.cleanup();}
});

test('acknowledged write with failed readback reconciles on the original connection without replay', async () => {
  const f = await setup(); f.install(); f.owner.mode = 'workspace-write';
  try {
    await invokeTool(f.ctx, 'mcp__autocad__new_drawing', {}); f.setPostflightFailure();
    const result = await invokeTool(f.ctx, 'mcp__autocad__draw_circle', {});
    const snapshot = f.owner.facts();
    assert.equal(result.isError, true); assert.equal(f.owner.facts().freeze?.stage, 'postflight');
    assert.equal(f.owner.facts().operations.at(-1)?.outcome, 'committed_observation_failed');
    assert.equal(f.owner.toolAvailable('mcp__autocad__draw_circle'), false);
    const blocked = await invokeTool(f.ctx, 'mcp__autocad__draw_circle', {});
    assert.match(JSON.stringify(blocked), /blocked_not_dispatched/);
    const recovered = await f.owner.recover(); assert.equal(recovered.recovered, true);
    assert.equal(f.calls.filter(name => name === 'draw_circle').length, 1);
    assert.equal(f.owner.facts().frozen, false);
    assert.equal(snapshot.operations.at(-1)?.outcome, 'committed_observation_failed');
    assert.equal(f.owner.facts().operations.find(op => op.tool === 'draw_circle' && op.dispatched)?.stage, 'reconciled');
  } finally { await f.cleanup(); }
});

test('same-batch unknown dispatch stops all remaining writes and preserves first error details', async () => {
  const f = await setup(); f.install(); f.owner.mode = 'workspace-write';
  try {
    await invokeTool(f.ctx, 'mcp__autocad__new_drawing', {}); const mark = f.owner.mark(); f.setFail();
    const results = await Promise.all(Array.from({ length: 5 }, () => invokeTool(f.ctx, 'mcp__autocad__draw_circle', {})));
    assert.ok(results.every(result => result.isError)); assert.equal(f.calls.filter(name => name === 'draw_circle').length, 1);
    assert.equal(f.owner.facts(mark).counts.unknown, 1); assert.equal(f.owner.facts(mark).counts.blocked_not_dispatched, 4);
    f.owner.mode = 'full-access'; assert.equal(f.owner.toolAvailable('cader_shell'), false);
    assert.equal((await invokeTool(f.ctx, 'cader_shell', { command: 'echo must-not-execute' })).isError, true);
    const journal = await readFile(join(f.root, '.cader/runs/test/execution.jsonl'), 'utf8');
    assert.match(journal, /RPC call rejected/); assert.match(journal, /-2147418111/); assert.match(journal, /tool_call_id/);
    await f.owner.probe(); assert.equal((await f.owner.recover()).recovered, false);
    await f.owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
    assert.equal(f.owner.facts().frozen, true); assert.equal((await f.owner.recover()).recovered, false);
  } finally { await f.cleanup(); }
});

test('malformed coordinates fail before dispatch without freezing, and cancellation awaits a committed call', async () => {
  const f = await setup(); f.install(); f.owner.mode = 'workspace-write';
  try {
    await invokeTool(f.ctx, 'mcp__autocad__new_drawing', {});
    // Radius validation supplements the legacy discovered schema even when it omits this constraint.
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__draw_circle', { radius: -1 })).isError, true);
    assert.equal(f.calls.filter(name => name === 'draw_circle').length, 0); assert.equal(f.owner.facts().frozen, false);
    f.setSlow(); const cancel = new AbortController();
    const pending = invokeTool(f.ctx, 'mcp__autocad__draw_circle', {}, cancel.signal);
    setTimeout(() => cancel.abort(), 20); await pending;
    assert.equal(f.calls.filter(name => name === 'draw_circle').length, 1);
    assert.equal(f.owner.facts().operations.at(-1)?.outcome, 'committed');
    assert.equal(f.owner.facts().frozen, false);
  } finally { await f.cleanup(); }
});
test('workspace-write approves destructive CAD calls; unknown writes persist a freeze and never replay', async () => {
  const f = await setup(); f.install(); f.owner.mode = 'workspace-write';
  try {
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__new_drawing', {})).isError, false);
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__delete_entity', {})).isError, true);
    f.setFail(); assert.equal((await invokeTool(f.ctx, 'mcp__autocad__draw_circle', {})).isError, true);
    assert.equal((await invokeTool(f.ctx, 'mcp__autocad__draw_circle', {})).isError, true);
    assert.equal(f.calls.filter(name => name === 'draw_circle').length, 1);
    await f.owner.dispose(); assert.equal(JSON.parse(await readFile(join(f.root, '.cader/locks/managed-write.json'), 'utf8')).frozen, true);
  } finally { await f.cleanup(); }
});
test('agent files obey permissions, exact edits, glob boundaries and private/CAD file protection', async () => {
  const f = await setup(); f.install(); f.owner.mode = 'workspace-write';
  try {
    assert.equal((await invokeTool(f.ctx, 'cader_write_file', { path: 'note.txt', content: 'one' })).isError, false);
    assert.equal((await invokeTool(f.ctx, 'cader_write_file', { path: 'note.txt', content: 'two' })).isError, true);
    assert.equal((await invokeTool(f.ctx, 'cader_shell', { command: 'echo no' })).isError, true);
    f.owner.mode = 'full-access';
    assert.equal((await invokeTool(f.ctx, 'cader_edit_file', { path: 'note.txt', old_text: 'one', new_text: 'two' })).isError, false);
    assert.equal(await readFile(join(f.root, 'note.txt'), 'utf8'), 'two');
    await writeFile(join(f.root, '.env'), 'never read');
    assert.equal((await invokeTool(f.ctx, 'cader_read_file', { path: '.env' })).isError, true);
    assert.equal((await invokeTool(f.ctx, 'cader_write_file', { path: 'unsafe.dwg', content: 'bad' })).isError, true);
    assert.equal((await invokeTool(f.ctx, 'cader_read_file', { path: '../outside' })).isError, true);
    const glob = await invokeTool(f.ctx, 'cader_glob', { pattern: '**/*.txt' });
    assert.equal(glob.isError, false); assert.match(String(glob.value), /note.txt/); assert.doesNotMatch(String(glob.value), /\.env/);
  } finally { await f.cleanup(); }
});
