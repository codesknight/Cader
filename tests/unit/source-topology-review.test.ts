import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {loadConfig} from '@cader/config';
import {createLiveRuntime} from '@cader/dsh-adapter';
import type {StreamChunk} from '@cader/dsh-adapter';

for(const mode of ['verified-cad-pixel-gap','different-original','uncertain-original','native-unverified'] as const)test(`source topology review compares original pin groups to native evidence: ${mode}`,async()=>{
  process.env.CADER_SOURCE_REVIEW_FIXTURE='offline-source-review';
  const c=await loadConfig(process.cwd()),path=resolve('benchmark/fixtures/vision-calibration.png'),sha256=createHash('sha256').update(await readFile(path)).digest('hex');let steps=0;
  const nativeVerified=mode!=='native-unverified';
  const question={requirements:[{id:'source_topology_fidelity',check:'visual'}],entity_snapshot:[],
    source_terminal_index:{sha256,objects:[{id:'Q',bounds:[[0,0],[1,1]],terminals:[[0,0.5],[1,0],[1,1]]}]},
    cad_external_netlist:{verified:nativeVerified,components:[{id:'CAD-Q',source_id:'Q',source_terminals:[0,1,2],pin_names:['B','C','E']}],nets:[{id:'a',pins:[{component:'CAD-Q',pin:'B'}]},{id:'b',pins:[{component:'CAD-Q',pin:'C'},{component:'CAD-Q',pin:'E'}]}]}};
  const runtime=await createLiveRuntime({...c,root:process.cwd(),runDirectory:resolve(`.cader/tests/source-topology-${mode}`),profiles:c.profiles.map(p=>({...p,api_key_env:'CADER_SOURCE_REVIEW_FIXTURE'})),captureCadView:async()=>({path,evidence:{document:'fixture.dwg'}})});
  runtime.ctx.on('llm/stream',async function*(request):AsyncGenerator<StreamChunk>{
    steps++;const schema=request.tools!.find(t=>t.name==='cader_submit_visual_report')!.parameters as any;
    assert.deepEqual(schema.properties.source_topology.properties.membership.required,['Q:0','Q:1','Q:2']);
    assert.match(JSON.stringify(request.messages),/source_terminal_index/);assert.match(JSON.stringify(request.messages),/cad_external_netlist/);
    if(steps===2)assert.match(JSON.stringify(request.messages),/SOURCE_TOPOLOGY_REPORT_CONFLICT/);
    const mismatch=mode==='different-original',uncertain=mode==='uncertain-original',pixelGap=mode==='verified-cad-pixel-gap'&&steps===1;
    const status=mismatch?'fail':uncertain||!nativeVerified||pixelGap?'uncertain':'pass';
    const args={verdict:status,defects:[],uncertainties:status==='uncertain'?[pixelGap?'CAD pixels have no visible junction dot':uncertain?'Original A path is genuinely uncertain':'Native proof is still pending']:[],
      checklist:[{requirement_id:'source_topology_fidelity',status,evidence:pixelGap?'Cannot re-prove a microscopic CAD gap from B':'Synthetic original-A group trace; not a real image interpretation'}],
      source_topology:{membership:{'Q:0':'a','Q:1':mismatch?'a':'b','Q:2':'b'},nets:[{id:'a',evidence:'Synthetic original A path only',certainty:'clear'},{id:'b',evidence:'Synthetic original A path only',certainty:uncertain?'uncertain':'clear'}]}};
    const id=`report-${steps}` as Extract<StreamChunk,{type:'tool-call-delta'}>['id'],json=JSON.stringify(args);
    yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name:'cader_submit_visual_report',argumentsDelta:json};
    yield {type:'block-end',index:0,block:{type:'tool-call',id,name:'cader_submit_visual_report',arguments:json}};yield {type:'finish',reason:{kind:'tool-calls'}};
  });
  try{
    const report=await runtime.reviewCadView(JSON.stringify(question),undefined,path);
    assert.equal(report.review_valid,true);assert.equal(report.structured!.verdict,mode==='verified-cad-pixel-gap'?'pass':mode==='different-original'?'fail':'uncertain');
    assert.equal(report.source_topology_evidence!.source_sha256,sha256);assert.equal(report.source_topology_evidence!.matches_cad_groups,mode!=='different-original');
    assert.equal(report.source_topology_evidence!.all_clear,mode!=='uncertain-original');assert.equal(report.source_topology_evidence!.native_verified,nativeVerified);
    assert.equal(steps,mode==='verified-cad-pixel-gap'?2:1);
  }finally{await runtime.dispose();delete process.env.CADER_SOURCE_REVIEW_FIXTURE;}
});
