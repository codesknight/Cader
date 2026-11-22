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
export const ReferenceObservation=z.object({
  version:z.literal(1),drawing_kind:z.enum(['schematic','layout','other','uncertain']),summary:Text,
  coordinate_system:z.literal('normalized-image-top-left-y-down'),content_bounds:NormalBox,
  objects:z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/),kind:Text,bounds:NormalBox,
    terminals:z.array(NormalPoint).max(8),certainty:z.enum(['clear','uncertain'])}).strict()).max(32),
  visible_text:z.array(z.object({text:Text,bounds:NormalBox,certainty:z.enum(['clear','uncertain'])}).strict()).max(32),
  connections:z.array(z.object({from:z.string().max(32),to:z.string().max(32),description:Text}).strict()).max(64),
  unknowns:z.array(Text).max(12)
}).strict().superRefine((value,ctx)=>{
  if(new Set(value.objects.map(o=>o.id)).size!==value.objects.length)ctx.addIssue({code:'custom',message:'Duplicate observed object IDs'});
  if(value.connections.some(c=>![c.from,c.to].every(id=>value.objects.some(o=>o.id===id))))ctx.addIssue({code:'custom',message:'Unknown observed connection endpoint'});
});
export type ReferenceObservationData=z.infer<typeof ReferenceObservation>;
export const referenceObservationSchema=JSON.parse(JSON.stringify(z.toJSONSchema(ReferenceObservation)));
export function parseReferenceObservation(value:unknown){return ReferenceObservation.parse(value);}
const ReferenceLabels=z.object({labels:z.array(z.object({index:z.number().int().nonnegative(),text:Text,certainty:z.enum(['clear','uncertain'])}).strict()).min(1).max(4)}).strict();
export const referenceLabelsSchema=JSON.parse(JSON.stringify(z.toJSONSchema(ReferenceLabels)));
export function parseReferenceLabels(value:unknown){return ReferenceLabels.parse(value);}
const Point = z.tuple([z.number().finite(), z.number().finite()]);
export const AcceptancePlan = z.object({
  version: z.literal(1), domain: z.enum(['generic', 'electrical-schematic']),
  wire_layer: z.string().min(1).max(80).optional(),
  requirements: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), source_quote: Text, description: Text,
    check: z.enum(['entity_count', 'text', 'series_cycle', 'no_wire_through_component', 'text_clearance', 'visual','new_document','saved_dwg']),
    entity_type: z.enum(['AcDbLine', 'AcDbCircle', 'AcDbArc', 'AcDbPolyline', 'AcDb2dPolyline', 'AcDb3dPolyline', 'AcDbText', 'AcDbMText', 'AcDbHatch', 'AcDbBlockReference', 'AcDbRotatedDimension', 'AcDbAlignedDimension']).optional(), min: z.number().int().nonnegative().optional(), max: z.number().int().nonnegative().optional(),
    text: z.string().max(80).optional(), component: z.string().max(64).optional()
  }).strict()).min(1).max(24),
  components: z.array(z.object({
    id: z.string().max(64), kind: z.string().max(64),
    ports: z.tuple([Point, Point]), bounds: z.tuple([Point, Point])
  }).strict()).max(32),
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
  for(const component of plan.components)
    if(component.ports[0].every((v, i) => v === component.ports[1][i]))
      ctx.addIssue({ code: 'custom', message: 'Distinct ports required' });
  if(plan.domain === 'electrical-schematic' && (!plan.components.length || !plan.requirements.some(r => r.check === 'series_cycle')))
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
