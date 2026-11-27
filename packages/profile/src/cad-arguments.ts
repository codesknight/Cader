import type {QualityPlan} from '@cader/config';
import type {ToolDefinition} from '@cader/dsh-adapter';

/** Advertise the same point contract already enforced before native dispatch.
 * Preserve the server schema and its references; never silently invent Z. */
export function publishCadInputContract(tool:ToolDefinition):ToolDefinition{
  const name=tool.name.split('__').at(-1)!;if(!['draw_polyline','draw_hatch'].includes(name))return tool;
  const parameters=structuredClone(tool.parameters) as Record<string,any>,properties=parameters.properties??parameters,points=properties.points;
  if(!points||typeof points!=='object')return tool;
  properties.points={...points,description:String(points.description??'')+' Cader requires every point as [x,y,z]; use explicit z=0 for XY drawings.',allOf:[...points.allOf??[],{type:'array',minItems:name==='draw_hatch'?3:2,maxItems:10000,items:{type:'array',minItems:3,maxItems:3,items:{type:'number'}}}]};
  return {...tool,parameters};
}

/** Exact slab clipping against an open rectangle, including very long segments. */
export function crossesInterior(a:number[],b:number[],box:number[][]){
  let lo=0,hi=1;
  for(let axis=0;axis<2;axis++){
    const delta=b[axis]!-a[axis]!,min=box[0]![axis]!+1e-5,max=box[1]![axis]!-1e-5;
    if(Math.abs(delta)<1e-10){if(a[axis]!<=min||a[axis]!>=max)return false;continue;}
    const t1=(min-a[axis]!)/delta,t2=(max-a[axis]!)/delta;
    lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));
  }
  return lo<hi;
}
/** Reject a known forbidden segment before native mutation; incomplete networks
 * remain allowed so the Agent can construct them incrementally. */
export function validatePlannedWire(tool:string,args:Record<string,unknown>,plan:QualityPlan){
  if((args.layer??'0')===plan.wire_layer&&tool.startsWith('draw_')&&tool!=='draw_line'&&plan.requirements.some(r=>['series_cycle','netlist'].includes(r.check)))throw new Error('TOPOLOGY_REQUIRES_LINE_SEGMENTS: this MCP query exposes endpoints only for AcDbLine; draw wire segments as lines. Other symbol/text layers may use their normal primitives');
  if(tool!=='draw_line'||(args.layer??'0')!==plan.wire_layer||!plan.requirements.some(r=>r.check==='no_wire_through_component'))return;
  const a=[Number(args.start_x),Number(args.start_y)],b=[Number(args.end_x),Number(args.end_y)];
  const blocked=plan.components.find(component=>crossesInterior(a,b,component.bounds));
  if(blocked)throw new Error(`WIRE_CROSSES_COMPONENT: ${blocked.id}; route outside frozen component bounds and end at planned ports`);
}
/** Check constraints absent from the discovered legacy MCP schema before dispatch.
 * Do not silently repair coordinate arity or infer a physical unit. */
export function validateCadArguments(tool: string, args: Record<string, unknown>) {
  const visit = (value: unknown): void => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('CAD_NONFINITE_COORDINATE');
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(args);
  if (['draw_polyline', 'draw_hatch'].includes(tool)) {
    const points = args.points;
    if (!Array.isArray(points) || points.length < (tool === 'draw_hatch' ? 3 : 2) || points.length > 10000 ||
      !points.every(point => Array.isArray(point) && point.length === 3 && point.every(v => typeof v === 'number' && Number.isFinite(v))))
      throw new Error('CAD_POINTS_REQUIRE_XYZ');
  }
  if (tool === 'draw_line' && ['x','y','z'].every(axis => args[`start_${axis}`] !== undefined && args[`start_${axis}`] === args[`end_${axis}`]))
    throw new Error('CAD_ZERO_LENGTH_LINE');
  for (const key of ['radius', 'height', 'scale_factor']) {
    if (key in args && (typeof args[key] !== 'number' || (args[key] as number) <= 0)) throw new Error('CAD_POSITIVE_VALUE_REQUIRED');
  }
}
