import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,rm,readFile,cp } from 'node:fs/promises';
import { resolve,join,sep } from 'node:path';
import { assertToolArguments,ToolArgumentsError,createToolRuntime,invokeTool,createLiveRuntime } from '@cader/dsh-adapter';
import type { ToolDefinition,createMcpClient,StreamChunk,PublicEvent } from '@cader/dsh-adapter';
import { ExecutionSession,toolResultLine,InteractiveSession,runTask,replyTextAfterStreaming,SafeTextStream } from '@cader/profile';
import type { TaskRunner } from '@cader/profile';
import { loadConfig } from '@cader/config';
const textSchema={
  type: 'object',properties: {
    text: { type: 'string' },height: { type: 'number',exclusiveMinimum: 0 },
    position: { type: 'array',items: { type: 'number' },minItems: 3,maxItems: 3 },layer: { type: 'string',enum: ['TEXT','NOTES'] }
  },
  required: ['text','height'],additionalProperties: false
};
const raw=(name: string,parameters: Record<string,unknown>,execute: ToolDefinition['execute']): ToolDefinition => ({
  name: `mcp__autocad__${name}`,description: 'Raw MCP-compatible fixture; no AutoCAD',parameters,
  output: { schema: { type: 'string' },render: (_a,v) => [{ type: 'text',text: String(v) }] },execute
});
test('original raw schemas enforce required/type/enum/nested constraints without changing arguments',() => {
  const tool=raw('draw_text',textSchema,async () => { throw new Error('not invoked'); });
  for(const args of [{ text: '5V' },{ text: '5V',height: '2' },{ text: '5V',height: 0 },{ text: '5V',height: 2,layer: 'BAD' },
  { text: '5V',height: 2,position: [0,0] },{ text: '5V',height: 2,extra: true }])
    assert.throws(() => assertToolArguments(tool,args),ToolArgumentsError);
  const valid=Object.freeze({ text: '5V',height: 2 });
  assert.doesNotThrow(() => assertToolArguments(tool,valid));
  const defaults=raw('defaults',{ type: 'object',properties: { height: { type: 'number',default: 2 } },required: ['height'] },async () => 'unused');
  const empty={};
  assert.throws(() => assertToolArguments(defaults,empty));
  assert.deepEqual(empty,{});
  const referenced=raw('refs',{
    $schema: 'https://json-schema.org/draft/2020-12/schema',type: 'object',properties: { point: { $ref: '#/$defs/point' } },required: ['point'],
    $defs: { point: { type: 'array',items: { type: 'number' },minItems: 3,maxItems: 3 } }
  },async () => 'unused');
  assert.doesNotThrow(() => assertToolArguments(referenced,{ point: [1,2,3] }));
  assert.throws(() => assertToolArguments(referenced,{ point: [1,2] }));
  assert.throws(() => assertToolArguments(raw('unsupported',{ type: 'object',unsupportedAssertion: true },async () => 'unused'),{}));
});
async function fixture(error?: Error) {
  const parent=resolve('.cader/tests');
  await mkdir(parent,{ recursive: true });
  const root=await mkdtemp(join(parent,'schema-'));
  const calls: string[]=[];
  const entities: {
    type: string;
    object_id: number;
  }[]=[];
  const definitions=[raw('new_drawing',{ type: 'object' },async () => 'unused'),raw('draw_text',textSchema,async () => 'unused'),
  raw('query_entities',{ type: 'object',properties: { entity_type: { type: 'string' } } },async () => 'unused'),raw('get_entity',{ type: 'object' },async () => 'unused'),raw('get_backend_status',{ type: 'object' },async () => 'unused'),
  raw('export_current_view',{ type: 'object',properties: { file_path: { type: 'string' } },required: ['file_path'] },async () => 'unused')];
  const factory: typeof createMcpClient=async () => ({
    definitions: () => definitions,toolNames: () => definitions.map(d => d.name.split('__').at(-1)!),
    async call(name,args) {
      calls.push(name);
      if(name==='export_current_view'&&error)
        throw error;
      if(name==='draw_text') {
        if(error)
          throw error;
        entities.push({ type: 'AcDbText',object_id: 42 });
        return 'draw_text ok, object_id=42';
      }
      if(name==='new_drawing')
        return 'Scratch';
      if(name==='query_entities')
        return args.entity_type? entities.filter(e => e.type===args.entity_type):entities.slice();
      if(name==='get_entity')
        return entities[0];
      return { backend: 'com',connection_state: 'not_probed',documents: [] };
    },async dispose() { }
  });
  const owner=new ExecutionSession(root,join(root,'.cader/runs/test'),undefined,factory);
  owner.mode='workspace-write';
  await owner.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
  const ctx=await createToolRuntime();
  for(const tool of [...owner.definitions(),...owner.controlTools()])
    ctx.tools.register(tool);
  return { root,owner,ctx,calls,factory,async cleanup() { await owner.dispose(); await ctx.fiber.dispose(); assert.ok(root.startsWith(parent+sep)); await rm(root,{ recursive: true }); } };
}
test('missing raw MCP argument is not dispatched or frozen, corrected call runs once, counts and freshness have scope',async () => {
  const f=await fixture();
  try {
    const missing=await invokeTool(f.ctx,'mcp__autocad__draw_text',{ text: '5V' });
    assert.equal(missing.isError,true);
    assert.equal(f.calls.includes('draw_text'),false);
    assert.equal(f.owner.facts().frozen,false);
    assert.equal(f.owner.facts().operations.at(-1)?.outcome,'failed_before_dispatch');
    assert.equal(f.owner.facts().operations.at(-1)?.dispatched,false);
    await invokeTool(f.ctx,'mcp__autocad__new_drawing',{});
    assert.equal((await invokeTool(f.ctx,'mcp__autocad__draw_text',{ text: '5V',height: 2 })).isError,false);
    assert.equal(f.calls.filter(n => n==='draw_text').length,1);
    const mark=f.owner.mark(),facts=f.owner.facts(mark);
    assert.equal(facts.counts.committed,0);
    assert.equal(facts.session_counts.committed,2);
    assert.equal(facts.counts_scope,'since_operation_mark');
    assert.equal(facts.cad_observation.entity_count,0);
    assert.equal(facts.cad_observation.stale_due_to_mutations,true);
    await invokeTool(f.ctx,'mcp__autocad__query_entities',{ entity_type: 'AcDbCircle' });
    assert.equal(f.owner.facts().cad_observation.stale_due_to_mutations,true);
    await invokeTool(f.ctx,'mcp__autocad__query_entities',{});
    assert.equal(f.owner.facts().cad_observation.entity_count,1);
    assert.equal(f.owner.facts().cad_observation.stale_due_to_mutations,false);
    const before=f.calls.length;
    assert.equal((await invokeTool(f.ctx,'mcp__autocad__query_entities',{ entity_type: 42 })).isError,true);
    assert.equal(f.calls.length,before);
    assert.match(await readFile(join(f.root,'.cader/runs/test/execution.jsonl'),'utf8'),/TOOL_ARGUMENTS_INVALID/);
  }
  finally {
    await f.cleanup();
  }
});
test('only trusted local rejection is undispatched; validation-looking remote errors remain frozen',async () => {
  for(const error of [new ToolArgumentsError('draw_text',[{ path: '/height',keyword: 'required',message: 'fixture client-side rejection' }]),
  Object.assign(new Error('remote validation error; height required'),{ code: 'TOOL_ARGUMENTS_INVALID',dispatched: false })]) {
    const f=await fixture(error);
    try {
      await invokeTool(f.ctx,'mcp__autocad__new_drawing',{});
      await invokeTool(f.ctx,'mcp__autocad__draw_text',{ text: '5V',height: 2 });
      const local=error instanceof ToolArgumentsError;
      assert.equal(f.owner.facts().frozen,!local);
      assert.equal(f.owner.facts().operations.at(-1)?.outcome,local? 'failed_before_dispatch':'unknown');
      if(!local) {
        const facts=f.owner.facts(f.owner.mark());
        assert.equal(facts.counts.unknown,0);
        assert.equal(facts.session_counts.unknown,1);
        assert.equal(facts.freeze_operation?.tool,'draw_text');
        assert.equal(facts.recovery.eligible,false);
        assert.equal((await f.owner.recover()).recovered,false);
        assert.match(f.owner.diagnosticSummary(),/受控只读查询仍可用/);
        await f.owner.dispose();
        const restarted=new ExecutionSession(f.root,join(f.root,'.cader/runs/restarted'),undefined,f.factory);
        try {
          await restarted.connect(resolve('configs/mcp/AutoCAD.example.yaml'));
          assert.equal(restarted.facts().freeze_evidence?.source,'persisted_barrier');
          assert.equal(restarted.facts().recovery.eligible,false);
          assert.match(restarted.diagnosticSummary(),/历史操作不计入本会话累计/);
          assert.match(restarted.diagnosticSummary(),/remote validation error/);
        }
        finally {
          await restarted.dispose();
        }
      }
    }
    finally {
      await f.cleanup();
    }
  }
});
test('real DSH prevalidates the entire raw patch and lets the model correct parameters without partial writes',async () => {
  process.env.CADER_RAW_SCHEMA_FIXTURE='offline-only';
  const config=await loadConfig(process.cwd());
  const calls: string[]=[];
  let step=0;
  const events: PublicEvent[]=[];
  const tools: ToolDefinition[]=[raw('draw_circle',{ type: 'object',properties: { radius: { type: 'number' } },required: ['radius'] },async () => { calls.push('circle'); return 'fixture'; }),
  raw('draw_text',textSchema,async () => { calls.push('text'); return 'fixture'; }),
  { name: 'cader_cad_recover',description: 'Fixture refusal',parameters: { type: 'object' },output: { schema: { type: 'string' },render: (_a: unknown,v: unknown) => [{ type: 'text' as const,text: String(v) }] },async execute() { return JSON.stringify({ recovered: false,recovery: { reason: 'DISPATCH_OUTCOME_UNCONFIRMED' } }); } }];
  const runtime=await createLiveRuntime({
    root: process.cwd(),runDirectory: resolve('.cader/tests/raw-patch'),...config,
    profiles: config.profiles.map(p => ({ ...p,api_key_env: 'CADER_RAW_SCHEMA_FIXTURE' })),executionTools: tools,onEvent: e => events.push(e)
  });
  runtime.ctx.on('llm/stream',async function*(): AsyncGenerator<StreamChunk> {
    if(step<2) {
      if(step===1)
        assert.deepEqual(calls,[]);
      const id=`fixture-${step}` as Extract<StreamChunk,{
        type: 'tool-call-delta';
      }>['id'];
      const args=JSON.stringify({ operations: [{ tool: tools[0]!.name,arguments: { radius: 1 } },{ tool: tools[1]!.name,arguments: step++===0? { text: '5V' }:{ text: '5V',height: 2 } }] });
      yield { type: 'block-start',index: 0,blockType: 'tool-call' };
      yield { type: 'tool-call-delta',index: 0,id,name: 'cader_apply_cad_patch',argumentsDelta: args };
      yield { type: 'block-end',index: 0,block: { type: 'tool-call',id,name: 'cader_apply_cad_patch',arguments: args } };
      yield { type: 'finish',reason: { kind: 'tool-calls' } };
      return;
    }
    if(step++===2) {
      const id='recover-fixture' as Extract<StreamChunk,{
        type: 'tool-call-delta';
      }>['id'];
      yield { type: 'block-start',index: 0,blockType: 'tool-call' };
      yield { type: 'tool-call-delta',index: 0,id,name: 'cader_cad_recover',argumentsDelta: '{}' };
      yield { type: 'block-end',index: 0,block: { type: 'tool-call',id,name: 'cader_cad_recover',arguments: '{}' } };
      yield { type: 'finish',reason: { kind: 'tool-calls' } };
      return;
    }
    yield { type: 'block-start',index: 0,blockType: 'text' };
    yield { type: 'text-delta',index: 0,text: 'Fixture corrected' };
    yield { type: 'block-end',index: 0,block: { type: 'text',text: 'Fixture corrected' } };
    yield { type: 'finish',reason: { kind: 'stop' } };
  });
  try {
    const result=await runtime.run('MainAgent','Fixture');
    assert.equal(result.status,'succeeded');
    assert.deepEqual(calls,['circle','text']);
    const failures=events.filter(e => e.type==='tool.result'&&e.isError);
    assert.equal(failures.length,1);
    assert.match(JSON.stringify(failures),/height/);
    assert.equal(events.filter(e => e.type==='cad.patch_preflight').length,1);
    const refused=events.find(e => e.type==='tool.result'&&e.tool==='cader_cad_recover')!;
    assert.deepEqual(refused.businessOutcome,{ status: 'refused',reason: 'DISPATCH_OUTCOME_UNCONFIRMED' });
    assert.doesNotMatch(toolResultLine(refused),/✓/);
    assert.match(toolResultLine(refused),/未恢复/);
  }
  finally {
    await runtime.dispose();
    delete process.env.CADER_RAW_SCHEMA_FIXTURE;
  }
});
test('capture client-side rejection is undispatched while unproven export failure still freezes',async () => {
  for(const error of [new ToolArgumentsError('export_current_view',[{ path: '/',keyword: 'schema',message: 'local fixture' }]),new Error('remote validation text')]) {
    const f=await fixture(error);
    try {
      await invokeTool(f.ctx,'mcp__autocad__new_drawing',{});
      await assert.rejects(f.owner.captureView(new AbortController().signal));
      const local=error instanceof ToolArgumentsError;
      assert.equal(f.owner.facts().frozen,!local);
      assert.equal(f.owner.facts().operations.at(-1)?.dispatched,!local);
    }
    finally {
      await f.cleanup();
    }
  }
});
test('frozen informational replies stream once, append status once and diagnose/recover without model speculation',async () => {
  process.env.CADER_STATUS_FIXTURE='offline-only';
  const f=await fixture(new Error('response lost'));
  let modelRuns=0;
  const runner: TaskRunner=(root,input) => runTask(root,input,async (options) => {
    modelRuns++;
    const runtime=await createLiveRuntime({ ...options,profiles: options.profiles.map(p => ({ ...p,api_key_env: 'CADER_STATUS_FIXTURE' })) });
    runtime.ctx.on('llm/stream',async function*(): AsyncGenerator<StreamChunk> {
      const text='本轮说明回复';
      yield { type: 'block-start',index: 0,blockType: 'text' };
      yield { type: 'text-delta',index: 0,text };
      yield { type: 'block-end',index: 0,block: { type: 'text',text } };
      yield { type: 'finish',reason: { kind: 'stop' } };
    });
    return runtime;
  });
  try {
    await cp('configs',join(f.root,'configs'),{ recursive: true,filter: path => !path.includes('.local.') });
    await invokeTool(f.ctx,'mcp__autocad__new_drawing',{});
    await invokeTool(f.ctx,'mcp__autocad__draw_text',{ text: '5V',height: 2 });
    const chat=await InteractiveSession.create(f.root,f.root,runner);
    chat.execution=f.owner;
    let rendered='';
    const stream=new SafeTextStream([],chunk => rendered+=chunk);
    const reply=await chat.execute('说明一下当前情况',{
      onEvent: event => {
        if(event.type==='assistant.delta')
          stream.push(String(event.text));
      }
    });
    stream.finish();
    rendered+=replyTextAfterStreaming(reply,true);
    assert.equal(rendered.split('本轮说明回复').length-1,1);
    assert.equal(rendered.split('CAD_WRITE_FROZEN').length-1,1);
    assert.match(reply.note!,/本轮确认 0/);
    assert.match(reply.note!,/会话确认 1 \/ 未知 1/);
    const diagnostic=await chat.execute('为什么阻塞了');
    assert.equal(diagnostic.error,undefined);
    assert.match(diagnostic.text,/不可自动恢复/);
    assert.match(diagnostic.text,/已过时/);
    const recovery=await chat.execute('恢复');
    assert.equal(recovery.error,true);
    assert.match(recovery.text,/未恢复/);
    assert.equal(modelRuns,1);
    assert.equal(f.owner.facts().frozen,true);
    await chat.dispose();
  }
  finally {
    await f.cleanup();
    delete process.env.CADER_STATUS_FIXTURE;
  }
});
