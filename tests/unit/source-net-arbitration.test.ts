import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReferenceObservation,parseReferenceNets,reconcileSourceNets,referenceMembershipSchema,parseReferenceMembership,mergeConfirmedSourceConnections} from '@cader/config';
const source=parseReferenceObservation({version:1,drawing_kind:'schematic',summary:'Synthetic reference only',coordinate_system:'normalized-image-top-left-y-down',content_bounds:[[0,0],[1,1]],objects:[{id:'Q',kind:'three-pin',category:'component',bounds:[[0,0],[1,1]],terminals:[[0,0],[1,0],[1,1]],certainty:'clear'}],visible_text:[],connections:[],unknowns:[],nets:[{id:'original',pins:[0,1,2].map(terminal=>({object:'Q',terminal})),certainty:'clear'}]});
const net=(terminal:number,certainty:'clear'|'uncertain')=>({id:`n${terminal}`,pins:[{object:'Q',terminal}],certainty,evidence:'Synthetic confidence fixture only'});

test('source review schema requires every known pin; membership derives exact nonduplicated groups',()=>{
  const schema=referenceMembershipSchema(source);
  assert.deepEqual(schema.properties.membership.required,['Q:0','Q:1','Q:2']);
  const report={membership:{'Q:0':'a','Q:1':'b','Q:2':'b'},nets:[{id:'a',certainty:'clear',evidence:'fixture'},{id:'b',certainty:'uncertain',evidence:'fixture'}]};
  assert.deepEqual(parseReferenceMembership(report,source).nets.map(n=>n.pins.length),[1,2]);
  assert.throws(()=>parseReferenceMembership({...report,membership:{'Q:0':'a','Q:1':'b'}},source),/missing/);
  assert.throws(()=>parseReferenceMembership({...report,membership:{...report.membership,'Q:3':'b'}},source),/unknown/);
  assert.throws(()=>parseReferenceMembership({...report,membership:{...report.membership,'Q:2':'absent'}},source),/NET_ID_INVALID/);
  assert.throws(()=>parseReferenceMembership({...report,nets:[...report.nets,report.nets[0]]},source),/NET_ID_INVALID/);
});
test('uncertainty is not a proven disconnection; candidate and unresolved status are both preserved',()=>{
  const original=JSON.stringify(source),review=parseReferenceNets({nets:[net(0,'clear'),net(1,'uncertain'),net(2,'uncertain')]});
  const result=reconcileSourceNets(source,review);
  assert.equal(result.valid,true);assert.equal(result.clear_consistent,true);assert.equal(result.report.nets.length,1);assert.equal(result.report.nets[0]!.pins.length,3);assert.equal(result.report.nets[0]!.certainty,'uncertain');assert.equal(JSON.stringify(source),original);
});
test('known clear contradictions cannot be hidden by uncertainty elsewhere',()=>{
  const result=reconcileSourceNets(source,parseReferenceNets({nets:[net(0,'clear'),net(1,'clear'),net(2,'uncertain')]}));
  assert.equal(result.valid,false);assert.equal(result.clear_consistent,false);
});
test('clear rereading corrects initial uncertainty without resolving an unrelated uncertain group',()=>{
  const original=parseReferenceObservation({...source,nets:[{id:'tentative',pins:[{object:'Q',terminal:0},{object:'Q',terminal:1}],certainty:'uncertain'},net(2,'clear')]});
  const result=reconcileSourceNets(original,parseReferenceNets({nets:[net(0,'clear'),net(1,'clear'),net(2,'uncertain')]}));
  assert.equal(result.valid,true);assert.equal(result.report.nets.length,3);
  assert.equal(result.report.nets.find(n=>n.pins.some(p=>p.terminal===0))!.certainty,'clear');
  assert.equal(result.report.nets.find(n=>n.pins.some(p=>p.terminal===2))!.certainty,'uncertain');
  assert.equal(original.nets![0]!.pins.length,2,'the original observation is not rewritten');
});
test('independently clear new-device connection extends a compatible candidate without inventing a wire component',()=>{
  const review=parseReferenceNets({missing_objects:[{id:'X',kind:'合法连接符号，描述中提及邻近导线',category:'component',bounds:[[0.1,0.1],[0.2,0.2]],terminals:[[0.15,0.1]],certainty:'clear'}],nets:[{...net(0,'clear'),pins:[{object:'Q',terminal:0},{object:'X',terminal:0}]},net(1,'uncertain'),net(2,'uncertain')]});
  const result=reconcileSourceNets(source,review);assert.equal(result.valid,true);assert.equal(result.report.nets[0]!.pins.length,4);assert.equal(result.report.nets[0]!.certainty,'uncertain');
  assert.equal(reconcileSourceNets(source,{...review,missing_objects:[{...review.missing_objects![0]!,kind:'wire',category:'wire'}]}).valid,false);
});
test('a fully clear changed interpretation still records disagreement; missing pins fail validation',()=>{
  const result=reconcileSourceNets(source,parseReferenceNets({nets:[net(0,'clear'),net(1,'clear'),net(2,'clear')]}));
  assert.equal(result.valid,true);assert.equal(result.clear_consistent,false);
  assert.throws(()=>reconcileSourceNets(source,parseReferenceNets({nets:[net(0,'clear')]})),/missing/);
});

test('explicit source connection merges resolve only covered uncertainty and preserve the original report',()=>{
  const groups=parseReferenceNets({nets:[net(0,'uncertain'),{...net(1,'clear'),pins:[{object:'Q',terminal:1},{object:'Q',terminal:2}]}]}).nets,before=JSON.stringify(groups);
  const confirmation={pins:[{object:'Q',terminal:0},{object:'Q',terminal:1}],source_quote:'确认两个源端子连通'};
  const merged=mergeConfirmedSourceConnections(groups,[confirmation]);assert.equal(merged.length,1);assert.equal(merged[0]!.certainty,'clear');assert.equal(merged[0]!.pins.length,3);assert.equal(JSON.stringify(groups),before);
  const untouched=mergeConfirmedSourceConnections(groups,[{...confirmation,pins:[{object:'Q',terminal:1},{object:'Q',terminal:2}]}]);assert.equal(untouched[0]!.certainty,'uncertain');
  assert.throws(()=>mergeConfirmedSourceConnections(groups,[{...confirmation,pins:[{object:'Q',terminal:0},{object:'missing',terminal:0}]}]),/UNKNOWN_PIN/);
  const bridge=parseReferenceNets({nets:[net(0,'clear'),{...net(1,'uncertain'),pins:[{object:'Q',terminal:1},{object:'Q',terminal:2}]},net(3,'clear')]}).nets;
  const unproven=mergeConfirmedSourceConnections(bridge,[confirmation,{...confirmation,pins:[{object:'Q',terminal:2},{object:'Q',terminal:3}]}]);assert.equal(unproven[0]!.certainty,'uncertain','two separate confirmations cannot prove an uncertain bridge between them');
});
