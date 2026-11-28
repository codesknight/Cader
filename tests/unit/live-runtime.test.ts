import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { loadConfig } from '@cader/config';
import { createLiveRuntime } from '@cader/dsh-adapter';
import type { StreamChunk } from '@cader/dsh-adapter';

test('actual DSH loop loads configs Static/Skill, isolates worker tools and enforces shared budget without provider I/O', async () => {
  const prior = process.env.CADER_FIXTURE_KEY;
  process.env.CADER_FIXTURE_KEY = 'sk-fixture-not-a-live-key';
  const config = await loadConfig(process.cwd());
  config.profiles = config.profiles.map(profile => ({ ...profile, api_key_env: 'CADER_FIXTURE_KEY' }));
  config.runtime.max_model_steps = 3;
  const runtime = await createLiveRuntime({ ...config, root: process.cwd(),
    runDirectory: resolve('.cader/tests/runtime-fixture') });
  const requests: { model: string; tools: string[]; messages: string }[] = [];
  runtime.ctx.on('llm/stream', async function* (options): AsyncGenerator<StreamChunk> {
    requests.push({ model: options.model, tools: options.tools?.map(tool => tool.name) ?? [],
      messages: JSON.stringify(options.messages) });
    if (requests.length === 1) {
      const id = 'fixture-load-skill' as Extract<StreamChunk, { type: 'tool-call-delta' }>['id'];
      const args = JSON.stringify({ name: 'cad-inspection' });
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id, name: 'cader_load_skill', argumentsDelta: args };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'cader_load_skill', arguments: args } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'Fixture result' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Fixture result' } };
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  });
  try {
    const child = await runtime.run('SubAgent', 'Return a fixture result.');
    const main = await runtime.run('MainAgent', 'Return a fixture result without using tools.');
    assert.equal(child.status, 'succeeded');
    assert.equal(main.status, 'succeeded');
    assert.equal(requests.length, 3);
    assert.deepEqual(child.tools, ['cader_load_skill']);
    assert.ok(requests[0]?.messages.includes("You are a bounded Cader child agent"));
    assert.ok(!requests[0]?.messages.includes('Do not draw, save, delete, or retarget'));
    assert.ok(requests[1]?.messages.includes('Do not draw, save, delete, or retarget'));
    assert.ok(requests[2]?.messages.includes("You are Cader's main CAD agent"));
    assert.ok(!requests[0]?.tools.includes('cader_delegate'));
    assert.ok(!requests[1]?.tools.includes('cader_delegate'));
    assert.ok(requests[2]?.tools.includes('cader_delegate'));
    assert.ok(requests[2]?.messages.includes('worker_profiles'));
    assert.ok(requests[2]?.messages.includes('capabilities'));
    assert.ok(requests[2]?.messages.includes('when_to_use'));
    assert.ok(requests[2]?.messages.includes('ENTRY_NOT_AVAILABLE_IN_THIS_ROLE_OR_PHASE'));
    assert.ok(requests[2]?.messages.includes('deepseek-v4-pro'));
    assert.ok(requests.every(request => request.messages.includes('remaining_model_steps')));
    assert.ok(requests.every(request => !request.messages.includes('sk-fixture-not-a-live-key')));
    await assert.rejects(runtime.run('SubAgent', 'Read image.', { image: 'anything.png' }), /UNSUPPORTED_IMAGE_INPUT/);
    const overBudget = await runtime.run('SubAgent', 'This must not dispatch a model request.');
    assert.equal(overBudget.status, 'failed');
    assert.equal(overBudget.errorCode, 'MODEL_STEP_BUDGET_EXCEEDED');
    assert.equal(requests.length, 3);
  } finally {
    await runtime.dispose();
    if (prior === undefined) delete process.env.CADER_FIXTURE_KEY; else process.env.CADER_FIXTURE_KEY = prior;
  }
});

test('scheduled main tools/vision use task deadline while ordinary turns keep profile timeout',async()=>{
  const old=process.env.CADER_DEADLINE_FIXTURE;process.env.CADER_DEADLINE_FIXTURE='offline-deadline-fixture';
  const config=await loadConfig(process.cwd());config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_DEADLINE_FIXTURE',timeout_ms:1000}));
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/task-deadline')});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{
    await new Promise(resolve=>setTimeout(resolve,1200));
    yield {type:'block-start',index:0,blockType:'text'};
    yield {type:'text-delta',index:0,text:'Fixture result'};
    yield {type:'block-end',index:0,block:{type:'text',text:'Fixture result'}};
    yield {type:'finish',reason:{kind:'stop'}};
  });
  try{
    assert.equal((await runtime.run('MainAgent','Scheduled fixture',{harnessTask:true})).status,'succeeded');
    assert.equal((await runtime.run('MainAgent','Ordinary fixture')).status,'cancelled');
  }finally{await runtime.dispose();if(old===undefined)delete process.env.CADER_DEADLINE_FIXTURE;else process.env.CADER_DEADLINE_FIXTURE=old;}
});

test('controlled quality review yields to Scheduler without spending another main model step',async()=>{
  const old=process.env.CADER_HANDOFF_FIXTURE;process.env.CADER_HANDOFF_FIXTURE='offline-handoff-fixture';
  const config=await loadConfig(process.cwd());config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_HANDOFF_FIXTURE'}));
  let steps=0,reviewed=false;
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/review-handoff'),captureCadView:async()=>{throw new Error('No raw capture');}});
  runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{
    steps++;
    const id='handoff-review' as Extract<StreamChunk,{type:'tool-call-delta'}>['id'];
    const args=JSON.stringify({question:'Review fixture'});
    yield {type:'block-start',index:0,blockType:'tool-call'};
    yield {type:'tool-call-delta',index:0,id,name:'cader_review_cad_view',argumentsDelta:args};
    yield {type:'block-end',index:0,block:{type:'tool-call',id,name:'cader_review_cad_view',arguments:args}};
    yield {type:'finish',reason:{kind:'tool-calls'}};
  });
  try{
    const result=await runtime.run('MainAgent','Review fixture',{reviewEndsTurn:true,controlledReview:async()=>{reviewed=true;return {review_valid:true};},resultText:()=>reviewed?'Evidence handed to Scheduler; not completion':undefined});
    assert.equal(result.status,'succeeded');assert.equal(steps,1);assert.equal(reviewed,true);
    assert.deepEqual(result.tools,['cader_review_cad_view']);
  }finally{await runtime.dispose();if(old===undefined)delete process.env.CADER_HANDOFF_FIXTURE;else process.env.CADER_HANDOFF_FIXTURE=old;}
});

test('actual model requests expose controlled visual routing, phase capabilities and refreshed task evidence',async()=>{
  const prior=process.env.CADER_ROUTE_FIXTURE;process.env.CADER_ROUTE_FIXTURE='sk-route-fixture-no-network';
  const config=await loadConfig(process.cwd());config.profiles=config.profiles.map(p=>({...p,api_key_env:'CADER_ROUTE_FIXTURE'}));
  const requests:{tools:string[];messages:string}[]=[];let controlled=0,captures=0;
  const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve('.cader/tests/route-fixture'),
    captureCadView:async()=>{captures++;throw new Error('Raw capture must not bypass task controller');},
    toolAvailable:name=>name!=='cader_delegate'});
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    requests.push({tools:request.tools?.map(t=>t.name)??[],messages:JSON.stringify(request.messages)});
    if(requests.length===1){
      const id='review-through-controller' as Extract<StreamChunk,{type:'tool-call-delta'}>['id'];
      const args=JSON.stringify({question:'Review current drawing'});
      yield {type:'block-start',index:0,blockType:'tool-call'};
      yield {type:'tool-call-delta',index:0,id,name:'cader_review_cad_view',argumentsDelta:args};
      yield {type:'block-end',index:0,block:{type:'tool-call',id,name:'cader_review_cad_view',arguments:args}};
      yield {type:'finish',reason:{kind:'tool-calls'}};return;
    }
    yield {type:'block-start',index:0,blockType:'text'};
    yield {type:'text-delta',index:0,text:'Fixture evidence observed; acceptance remains Harness-owned.'};
    yield {type:'block-end',index:0,block:{type:'text',text:'Fixture result'}};
    yield {type:'finish',reason:{kind:'stop'}};
  });
  try{
    const result=await runtime.run('MainAgent','Use controlled review.',{taskState:()=>({phase:'drawing',visual_call_count:controlled,last_image:controlled?'fixture-sha':null}),
      controlledReview:async()=>{controlled++;return {review_valid:true,evidence:{sha256:'fixture-sha'},structured:{verdict:'pass'}};}});
    assert.equal(result.status,'succeeded');assert.equal(controlled,1);assert.equal(captures,0);
    assert.ok(requests[0]!.tools.includes('cader_review_cad_view'));assert.ok(!requests[0]!.tools.includes('cader_delegate'));
    assert.match(requests[0]!.messages,/schema_ref/);assert.match(requests[0]!.messages,/when_to_use/);
    assert.match(requests[0]!.messages,/ENTRY_NOT_AVAILABLE_IN_THIS_ROLE_OR_PHASE/);
    assert.ok(!requests[0]!.messages.includes('fixture-sha'));assert.ok(requests[1]!.messages.includes('fixture-sha'));
    assert.match(requests[1]!.messages,/visual_call_count/);
  }finally{await runtime.dispose();if(prior===undefined)delete process.env.CADER_ROUTE_FIXTURE;else process.env.CADER_ROUTE_FIXTURE=prior;}
});
