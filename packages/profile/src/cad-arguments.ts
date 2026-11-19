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
