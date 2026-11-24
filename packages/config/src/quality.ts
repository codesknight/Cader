import { z } from 'zod';
const Text = z.string().min(1).max(800);
export const VisualReport = z.object({
  verdict: z.enum(['pass', 'fail', 'uncertain']),
  defects: z.array(z.object({
    type: Text, severity: z.enum(['minor', 'major', 'critical']),
    location: Text, evidence: Text, suggestion: Text, entity_ids: z.array(z.number().int().positive()).max(20)
  }).strict()).max(8),
  checklist: z.array(z.object({ requirement_id: z.string().max(64), status: z.enum(['pass', 'fail', 'uncertain']), evidence: Text }).strict()).max(32),
  uncertainties: z.array(Text).max(8)
}).strict().superRefine((report, ctx) => {
  if(report.verdict === 'pass' && (report.uncertainties.length || report.defects.some(d => d.severity !== 'minor') || report.checklist.some(c => c.status !== 'pass')))
    ctx.addIssue({ code: 'custom', message: 'Pass conflicts with unresolved evidence' });
  if(report.verdict==='uncertain'&&report.checklist.length&&report.checklist.every(c=>c.status==='pass')&&!report.defects.length)
    ctx.addIssue({code:'custom',message:'UNCERTAINTY_MUST_AFFECT_REQUIRED_CHECK: every required checklist item passed; remove unrelated/already-proven uncertainty or mark the specific affected requirement uncertain with evidence'});
});
export type VisualReview = z.infer<typeof VisualReport>;
export const visualReportSchema = JSON.parse(JSON.stringify(z.toJSONSchema(VisualReport)));
export function parseVisualReport(value: unknown): VisualReview { return VisualReport.parse(value); }
const NormalPoint=z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)]);
const NormalBox=z.tuple([NormalPoint,NormalPoint]).refine(([a,b])=>a[0]<b[0]&&a[1]<b[1],'Positive normalized image bounds required');
const SourceLabel=z.object({text:Text,bounds:NormalBox,certainty:z.enum(['clear','uncertain'])}).strict();
const ReferenceLabelInventory=z.object({visible_text:z.array(SourceLabel).max(32)}).strict();
export const referenceLabelInventorySchema=JSON.parse(JSON.stringify(z.toJSONSchema(ReferenceLabelInventory)));
export function parseReferenceLabelInventory(value:unknown){return ReferenceLabelInventory.parse(value);}
const ObservedNet=z.object({id:z.string().min(1).max(64),pins:z.array(z.object({object:z.string().max(32),terminal:z.number().int().min(0).max(7)}).strict()).min(1).max(64),evidence:z.string().min(1).max(400).optional(),certainty:z.enum(['clear','uncertain']).optional()}).strict();
const SourceObject=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/),kind:Text,category:z.enum(['component','wire','annotation']).optional(),bounds:NormalBox,terminals:z.array(NormalPoint).max(8),certainty:z.enum(['clear','uncertain'])}).strict();
const ReferenceNets=z.object({nets:z.array(ObservedNet).min(1).max(64),missing_objects:z.array(SourceObject).max(8).optional()}).strict();
export const referenceNetsSchema=JSON.parse(JSON.stringify(z.toJSONSchema(ReferenceNets)));
export function parseReferenceNets(value:unknown){return ReferenceNets.parse(value);}
export const ReferenceObservation=z.object({
  version:z.literal(1),drawing_kind:z.enum(['schematic','layout','other','uncertain']),summary:Text,
  coordinate_system:z.literal('normalized-image-top-left-y-down'),content_bounds:NormalBox,
  objects:z.array(SourceObject).max(32),
  visible_text:z.array(SourceLabel).max(32),
  connections:z.array(z.object({from:z.string().max(32),to:z.string().max(32),description:Text}).strict()).max(64),
  nets:z.array(ObservedNet).max(64).optional(),
  unknowns:z.array(Text).max(12)
}).strict().superRefine((value,ctx)=>{
  if(new Set(value.objects.map(o=>o.id)).size!==value.objects.length)ctx.addIssue({code:'custom',message:'Duplicate observed object IDs'});
  if(value.connections.some(c=>![c.from,c.to].every(id=>value.objects.some(o=>o.id===id))))ctx.addIssue({code:'custom',message:'Unknown observed connection endpoint'});
  if(value.nets){
    const pins=value.nets.flatMap(n=>n.pins.map(p=>`${p.object}:${p.terminal}`));
    const expected=value.objects.flatMap(o=>o.terminals.map((_,i)=>`${o.id}:${i}`));
    const missing=expected.filter(p=>!pins.includes(p)),unknown=pins.filter(p=>!expected.includes(p)),duplicate=[...new Set(pins.filter((p,i)=>pins.indexOf(p)!==i))];
    if(missing.length||unknown.length||duplicate.length||new Set(value.nets.map(n=>n.id)).size!==value.nets.length)ctx.addIssue({code:'custom',message:'Observed terminal partition invalid; include every actual terminal exactly once. '+JSON.stringify({missing,unknown,duplicate,duplicate_net_ids:new Set(value.nets.map(n=>n.id)).size!==value.nets.length})});
  }
});
export type ReferenceObservationData=z.infer<typeof ReferenceObservation>;
export const referenceObservationSchema=JSON.parse(JSON.stringify(z.toJSONSchema(ReferenceObservation)));
export function parseReferenceObservation(value:unknown){return ReferenceObservation.parse(value);}
const SourceMembership=z.object({membership:z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,32}:[0-7]$/),z.string().min(1).max(64)),
  nets:z.array(ObservedNet.omit({pins:true})).min(1).max(64),missing_objects:z.array(SourceObject).max(8).optional()}).strict();
/** Require each known terminal as an object key. The model cannot list the same
 * terminal in several groups; group arrays are derived, never guessed/repaired. */
export function referenceMembershipSchema(source:ReferenceObservationData){
  const schema=JSON.parse(JSON.stringify(z.toJSONSchema(SourceMembership)));
  const required=source.objects.flatMap(o=>o.terminals.map((_,i)=>`${o.id}:${i}`));
  schema.properties.membership={type:'object',properties:Object.fromEntries(required.map(pin=>[pin,{type:'string',minLength:1,maxLength:64}])),required,
    additionalProperties:{type:'string',minLength:1,maxLength:64},maxProperties:256,description:'Each original object:terminal appears exactly once as a key; value is its external net ID. Add keys for any missing_objects terminals too.'};
  return schema;
}
export function parseReferenceMembership(value:unknown,source:ReferenceObservationData){
  const parsed=SourceMembership.parse(value);
  const ids=new Set(parsed.nets.map(n=>n.id));
  if(ids.size!==parsed.nets.length||Object.values(parsed.membership).some(id=>!ids.has(id)))throw new Error('SOURCE_MEMBERSHIP_NET_ID_INVALID');
  const nets=parsed.nets.map(n=>({...n,pins:Object.entries(parsed.membership).filter(([,id])=>id===n.id).map(([address])=>{const [object,terminal]=address.split(':');return {object:object!,terminal:Number(terminal)};})}));
  const report=parseReferenceNets({nets,missing_objects:parsed.missing_objects});
  parseReferenceObservation({...source,objects:[...source.objects,...report.missing_objects??[]],nets:report.nets});
  return report;
}
const SourceConnectionReview=z.object({connections:z.array(z.object({pins:ObservedNet.shape.pins.min(2),source_quote:Text}).strict()).max(16),unconfirmed:z.array(z.object({source_quote:Text,reason:Text}).strict()).max(16).optional()}).strict();
export const sourceConnectionReviewSchema=JSON.parse(JSON.stringify(z.toJSONSchema(SourceConnectionReview)));
export function parseSourceConnectionReview(value:unknown){return SourceConnectionReview.parse(value);}
export type ConfirmedSourceConnection=z.infer<typeof SourceConnectionReview>['connections'][number];
/** Merge only explicitly confirmed source connections. Uncovered uncertainty
 * remains uncertain; this never splits nets or generates CAD operations. */
export function mergeConfirmedSourceConnections(nets:ReturnType<typeof parseReferenceNets>['nets'],confirmations:ConfirmedSourceConnection[]){
  const address=(p:{object:string;terminal:number})=>`${p.object}:${p.terminal}`;
  const pins=nets.flatMap(n=>n.pins),indices=new Map(pins.map((p,i)=>[address(p),i])),parent=pins.map((_,i)=>i),proof=pins.map((_,i)=>i),selected=new Set<string>();
  const root=(list:number[],i:number):number=>list[i]===i?i:(list[i]=root(list,list[i]!));
  const join=(list:number[],members:typeof pins)=>{const ids=members.map(p=>{const index=indices.get(address(p));if(index===undefined)throw new Error('SOURCE_CONNECTION_UNKNOWN_PIN');return index;});for(const index of ids)list[root(list,index)]=root(list,ids[0]!);};
  for(const net of nets){join(parent,net.pins);if(net.certainty==='clear')join(proof,net.pins);}
  for(const c of confirmations){if(c.pins.length<2||new Set(c.pins.map(address)).size!==c.pins.length)throw new Error('SOURCE_CONNECTION_DISTINCT_PINS_REQUIRED');join(parent,c.pins);join(proof,c.pins);c.pins.forEach(p=>selected.add(address(p)));}
  const groups=new Map<number,typeof pins>();pins.forEach((p,i)=>{const r=root(parent,i);groups.set(r,[...groups.get(r)??[],p]);});
  const ids=new Set(nets.map(n=>n.id));let serial=0;
  return [...groups.values()].map(members=>{
    const prior=nets.filter(n=>n.pins.some(p=>members.some(q=>address(q)===address(p)))),uncertain=prior.filter(n=>n.certainty!=='clear');
    const clear=!uncertain.length||uncertain.every(n=>n.pins.every(p=>selected.has(address(p))))&&new Set(members.map(p=>root(proof,indices.get(address(p))!))).size===1;
    let id=prior[0]!.id;if(prior.length>1){do{id=`cader_confirmed_${serial++}`;}while(ids.has(id));ids.add(id);}
    return {id,pins:members,certainty:clear?'clear' as const:'uncertain' as const,evidence:(prior.length>1?'Explicit user connection confirmation; original observations retained. ':prior[0]!.evidence??'Source observation').slice(0,400)};
  });
}
/** Unknown connectivity is not a proven disconnection. Retain the preliminary
 * candidate only where the independent review is explicitly uncertain; every
 * clear old-pin relation must agree. The final pixel-fidelity gate is mandatory. */
export function reconcileSourceNets(source:ReferenceObservationData,review:ReturnType<typeof parseReferenceNets>){
  parseReferenceObservation({...source,objects:[...source.objects,...review.missing_objects??[]],nets:review.nets});
  const uncertain=review.nets.filter(n=>n.certainty!=='clear');
  if((review.missing_objects??[]).some(o=>o.certainty!=='clear'||o.category!=='component'))return {valid:false,report:review,clear_consistent:false};
  const address=(p:{object:string;terminal:number})=>`${p.object}:${p.terminal}`;
  const old=source.objects.flatMap(o=>o.terminals.map((_,terminal)=>({object:o.id,terminal})));
  const original=new Map(source.nets?.flatMap(n=>n.pins.map(p=>[address(p),n.id] as const))??[]);
  const reviewed=new Map(review.nets.flatMap(n=>n.pins.map(p=>[address(p),n.id] as const)));
  const unknown=new Set(uncertain.flatMap(n=>n.pins.map(address)));
  const originallyUnknown=new Set(source.nets?.filter(n=>n.certainty!=='clear').flatMap(n=>n.pins.map(address))??[]);
  const known=old.filter(p=>!unknown.has(address(p))&&!originallyUnknown.has(address(p)));
  let consistent=Boolean(source.nets?.length);
  for(let i=0;i<known.length;i++)for(let j=i+1;j<known.length;j++)if((original.get(address(known[i]!))===original.get(address(known[j]!)))!==(reviewed.get(address(known[i]!))===reviewed.get(address(known[j]!))))consistent=false;
  if(!uncertain.length)return {valid:true,report:review,clear_consistent:consistent};
  if(!consistent)return {valid:false,report:review,clear_consistent:false};
  const pins=[...old,...(review.missing_objects??[]).flatMap(o=>o.terminals.map((_,terminal)=>({object:o.id,terminal})))];
  const parent=pins.map((_,i)=>i),indices=new Map(pins.map((p,i)=>[address(p),i]));
  const root=(i:number):number=>parent[i]===i?i:(parent[i]=root(parent[i]!));
  // A clear rereading can replace an initially uncertain relation, even while
  // another group stays unresolved. Retain old candidate relations only where
  // the rereading is still uncertain; never bridge two newly clear groups.
  const retained=(source.nets??[]).filter(n=>n.pins.some(p=>unknown.has(address(p)))&&new Set(n.pins.filter(p=>!unknown.has(address(p))).map(p=>reviewed.get(address(p)))).size<=1);
  for(const net of [...retained,...review.nets.filter(n=>n.certainty==='clear')]){
    const ids=net.pins.map(p=>indices.get(address(p))!);for(const i of ids)parent[root(i)]=root(ids[0]!);
  }
  const groups=new Map<number,typeof pins>();pins.forEach((p,i)=>{const id=root(i);groups.set(id,[...groups.get(id)??[],p]);});
  const nets=[...groups.values()].map((pins,i)=>({id:`observed_net_${i}`,pins,certainty:pins.some(p=>unknown.has(address(p)))?'uncertain' as const:'clear' as const,
    evidence:review.nets.filter(n=>n.pins.some(p=>pins.some(q=>address(q)===address(p)))).map(n=>n.evidence??'').join(' | ').slice(0,400)||'Consistent clear relations; uncertain source membership retained for final pixel review'}));
  parseReferenceObservation({...source,objects:[...source.objects,...review.missing_objects??[]],nets});
  return {valid:true,clear_consistent:true,report:{...review,nets}};
}
const ReferenceLabels=z.object({labels:z.array(z.object({index:z.number().int().nonnegative(),text:Text,certainty:z.enum(['clear','uncertain']),bounds:NormalBox.optional()}).strict()).min(1).max(4)}).strict();
export const referenceLabelsSchema=JSON.parse(JSON.stringify(z.toJSONSchema(ReferenceLabels)));
export function parseReferenceLabels(value:unknown){return ReferenceLabels.parse(value);}
const Point = z.tuple([z.number().finite(), z.number().finite()]);
export const AcceptancePlan = z.object({
  version: z.literal(1), domain: z.enum(['generic', 'electrical-schematic']),
  wire_layer: z.string().min(1).max(80).optional(),
  requirements: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), source_quote: Text, description: Text,
    check: z.enum(['entity_count', 'text', 'series_cycle', 'netlist', 'no_wire_through_component', 'text_clearance', 'visual','new_document','saved_dwg']),
    entity_type: z.enum(['AcDbLine', 'AcDbCircle', 'AcDbArc', 'AcDbPolyline', 'AcDb2dPolyline', 'AcDb3dPolyline', 'AcDbText', 'AcDbMText', 'AcDbHatch', 'AcDbBlockReference', 'AcDbRotatedDimension', 'AcDbAlignedDimension']).optional(), min: z.number().int().nonnegative().optional(), max: z.number().int().nonnegative().optional(),
    text: z.string().max(80).optional(), component: z.string().max(64).optional(),layer:z.string().min(1).max(80).optional()
  }).strict()).min(1).max(24),
  components: z.array(z.object({
    id: z.string().max(64), kind: z.string().max(64),
    ports: z.array(Point).min(1).max(8), bounds: z.tuple([Point, Point]),
    pin_names:z.array(z.string().min(1).max(32)).min(1).max(8).optional(),
    source_id:z.string().max(32).optional(),source_terminals:z.array(z.number().int().min(0).max(7)).min(1).max(8).optional()
  }).strict()).max(32),
  nets:z.array(z.object({id:z.string().min(1).max(64),pins:z.array(z.object({component:z.string().max(64),pin:z.string().min(1).max(32)}).strict()).min(1).max(64)}).strict()).max(64).optional(),
  junctions:z.array(Point).max(128).optional(),
  visual_required: z.boolean()
}).strict().superRefine((plan, ctx) => {
  if(new Set(plan.requirements.map(r => r.id)).size !== plan.requirements.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate requirement IDs' });
  if(new Set(plan.components.map(c => c.id)).size !== plan.components.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate component IDs' });
  for(const r of plan.requirements) {
    if(r.check === 'text' && !r.text?.trim())
      ctx.addIssue({ code: 'custom', message: 'Text acceptance needs literal text' });
    if(r.component && !plan.components.some(c => c.id === r.component))
      ctx.addIssue({ code: 'custom', message: 'Unknown component reference' });
    if(r.min !== undefined && r.max !== undefined && r.min > r.max)
      ctx.addIssue({ code: 'custom', message: 'Invalid count range' });
  }
  for(const component of plan.components) {
    if(new Set(component.ports.map(p=>JSON.stringify(p))).size!==component.ports.length)
      ctx.addIssue({ code: 'custom', message: 'Distinct ports required' });
    if(component.pin_names&&(component.pin_names.length!==component.ports.length||new Set(component.pin_names).size!==component.pin_names.length))ctx.addIssue({code:'custom',message:'Unique pin_names must correspond to ports'});
    if(component.source_terminals&&(component.source_terminals.length!==component.ports.length||new Set(component.source_terminals).size!==component.source_terminals.length))ctx.addIssue({code:'custom',message:'source_terminals must correspond one-to-one to ports'});
  }
  if(plan.requirements.some(r=>r.check==='series_cycle')&&plan.components.some(c=>c.ports.length!==2))ctx.addIssue({code:'custom',message:'series_cycle supports only two-terminal components; use netlist for branches/multi-pin devices'});
  if(plan.requirements.some(r=>r.check==='netlist')){
    const pins=plan.nets?.flatMap(n=>n.pins.map(p=>`${p.component}:${p.pin}`))??[];
    if(!plan.nets?.length||new Set(plan.nets.map(n=>n.id)).size!==plan.nets.length||new Set(pins).size!==pins.length||plan.components.some(c=>!c.pin_names||c.pin_names.some(pin=>!pins.includes(`${c.id}:${pin}`)))||plan.nets.some(n=>n.pins.some(p=>!plan.components.some(c=>c.id===p.component&&c.pin_names?.includes(p.pin)))))ctx.addIssue({code:'custom',message:'Netlist must partition every named component pin exactly once'});
  }
  if(plan.domain === 'electrical-schematic' && (!plan.components.length || !plan.requirements.some(r => ['series_cycle','netlist'].includes(r.check))))
    ctx.addIssue({ code: 'custom', message: 'Schematic requires component ports and topology acceptance' });
  if(plan.domain === 'electrical-schematic' && !plan.wire_layer)
    ctx.addIssue({ code: 'custom', message: 'Schematic wire layer required' });
  if(plan.domain === 'electrical-schematic' && (!plan.visual_required || !['visual', 'no_wire_through_component', 'text_clearance'].every(check => plan.requirements.some(r => r.check === check))))
    ctx.addIssue({ code: 'custom', message: 'Schematic needs visual, component-interior and text-clearance checks' });
  for(const c of plan.components)
    if(c.bounds[0][0] >= c.bounds[1][0] || c.bounds[0][1] >= c.bounds[1][1] ||
      c.ports.some(p => p[0] < c.bounds[0][0] || p[0] > c.bounds[1][0] || p[1] < c.bounds[0][1] || p[1] > c.bounds[1][1]))
      ctx.addIssue({ code: 'custom', message: 'Positive component bounds containing ports required' });
  for(const c of plan.components)
    if(c.ports.some(p => !p.some((value, axis) => Math.abs(value - c.bounds[0][axis]!) < 1e-6 || Math.abs(value - c.bounds[1][axis]!) < 1e-6)))
      ctx.addIssue({ code: 'custom', message: 'Connection ports must lie on component boundary, not inside the forbidden wire region' });
  for(let i = 0;i < plan.components.length;i++)
    for(let j = i + 1;j < plan.components.length;j++) {
      const a = plan.components[i]!.bounds, b = plan.components[j]!.bounds;
      if(a[0][0] < b[1][0] && b[0][0] < a[1][0] && a[0][1] < b[1][1] && b[0][1] < a[1][1])
        ctx.addIssue({ code: 'custom', message: 'Component interiors overlap; use distinct absolute CAD coordinates for each component' });
    }
});
export type QualityPlan = z.infer<typeof AcceptancePlan>;
export const acceptancePlanSchema = JSON.parse(JSON.stringify(z.toJSONSchema(AcceptancePlan)));
export function parseAcceptancePlan(value: unknown): QualityPlan { return AcceptancePlan.parse(value); }
