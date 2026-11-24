import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {loadConfig} from '@cader/config';
import {createLiveRuntime} from '@cader/dsh-adapter';
import type {PublicEvent,StreamChunk} from '@cader/dsh-adapter';
import {toolResultLine,qualityTaskContext} from '@cader/profile';

for(const mode of ['capture-failed','invalid','fail','uncertain','clipped','pass'] as const){
  test(`actual DSH reports visual business outcome separately from handoff: ${mode}`,async()=>{
    process.env.CADER_VISUAL_OUTCOME_FIXTURE='offline-visual-outcome';
    const config=await loadConfig(process.cwd());const events:PublicEvent[]=[];let steps=0;
    const runtime=await createLiveRuntime({...config,root:process.cwd(),runDirectory:resolve(`.cader/tests/visual-${mode}`),
      profiles:config.profiles.map(p=>({...p,api_key_env:'CADER_VISUAL_OUTCOME_FIXTURE'})),onEvent:e=>events.push(e),
      captureCadView:async()=>{throw new Error('No raw capture allowed');}});
    runtime.ctx.on('llm/stream',async function*():AsyncGenerator<StreamChunk>{
      steps++;
      const id='visual-outcome' as Extract<StreamChunk,{type:'tool-call-delta'}>['id'];
      const args=JSON.stringify({question:'Fixture review'});
      yield {type:'block-start',index:0,blockType:'tool-call'};
      yield {type:'tool-call-delta',index:0,id,name:'cader_review_cad_view',argumentsDelta:args};
      yield {type:'block-end',index:0,block:{type:'tool-call',id,name:'cader_review_cad_view',arguments:args}};
      yield {type:'finish',reason:{kind:'tool-calls'}};
    });
    try{
      await runtime.run('MainAgent','Review fixture',{reviewEndsTurn:true,controlledReview:async()=>{
        if(mode==='capture-failed')throw new Error('Native capture or readback failed');
        return {review_valid:mode!=='invalid',structured:{verdict:mode==='clipped'?'pass':mode},evidence:{image_bounds:{possible_clipping:mode==='clipped'}}};
      }});
      const event=events.find(e=>e.type==='tool.result'&&e.tool==='cader_review_cad_view')!;
      assert.equal(event.isError,false); // Successful Scheduler handoff.
      const line=toolResultLine(event);
      if(mode==='pass')assert.match(line,/✓.*视觉报告通过/);
      else {assert.doesNotMatch(line,/✓/);assert.match(line,mode==='fail'?/×.*视觉未通过/:/!.*视觉待验证/);}
      assert.equal(steps,1);
      assert.equal(runtime.reviewStats().model_calls,0); // No actual vision model in this fixture.
    }finally{await runtime.dispose();}
  });
}

test('failed capture attempt does not count as a vision model call',()=>{
  const context=qualityTaskContext({task_id:'test',phase:'blocked',original_request:'画房子',round:0,checks:[],
    visual_attempt_count:1,visual_model_call_count:0,visual_calls:[],visual_error:'capture failure'});
  assert.equal(context.capture_attempt_count,1);assert.equal(context.visual_call_count,0);
  assert.doesNotMatch(toolResultLine({type:'tool.result',tool:'cader_review_cad_view',isError:false}),/✓/);
});
