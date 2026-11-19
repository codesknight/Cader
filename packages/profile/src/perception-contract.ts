import { z } from 'zod';
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Value = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const Kinds = z.enum(['OR', 'XOR', 'AND', 'NOT', 'RESISTOR', 'CAPACITOR', 'BJT', 'OTHER', 'UNKNOWN']);
export const Assessment = z.object({
  version: z.literal(1), source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  coordinate_mode: z.enum(['schematic', 'physical']), layout_units: z.string().min(1),
  physical_scale: z.object({ units: z.string().min(1), source_fact: Id }).strict().nullable(),
  regions: z.array(z.object({ id: Id, left: z.number().nonnegative(), top: z.number().nonnegative(),
    width: z.number().positive(), height: z.number().positive() }).strict()).min(1),
  facts: z.array(z.object({ id: Id, kind: z.enum(['symbol', 'label', 'voltage_kv', 'drawing_id', 'crossing', 'scale']),
    raw: z.string().nullable(), value: Value, status: z.enum(['observed', 'derived', 'unknown', 'conflict']),
    region_id: Id }).strict()),
  nodes: z.array(Id),
  symbols: z.array(z.object({ id: Id, kind: Kinds, fact_id: Id,
    ports: z.array(z.object({ id: Id, node_id: Id }).strict()).min(1) }).strict()),
  wires: z.array(z.object({ id: Id, from_node: Id, to_node: Id, region_id: Id }).strict()),
  crossings: z.array(z.object({ wire_a: Id, wire_b: Id, kind: z.enum(['junction', 'bridge', 'unresolved']),
    node_id: Id.nullable(), fact_id: Id }).strict()),
}).strict();
export type RedrawAssessment = z.infer<typeof Assessment>;
export const IndependentFactsSchema = z.object({ source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.int().positive(), height: z.int().positive(), values: z.record(Id, Value), symbol_kinds: z.record(Id, Kinds),
  connected: z.array(z.tuple([Id, Id])), disconnected: z.array(z.tuple([Id, Id])), required_labels: z.array(z.string()) }).strict();
export type IndependentFacts = z.infer<typeof IndependentFactsSchema>;
export function assessmentSchemas() {
  return { assessment: z.toJSONSchema(Assessment), independent_facts: z.toJSONSchema(IndependentFactsSchema) };
}

/** Deterministic evidence/graph gate. No model confidence or free-text caveat grants acceptance. */
export function validateAssessment(input: unknown, independent: unknown) {
  const expectedResult = IndependentFactsSchema.safeParse(independent);
  if (!expectedResult.success) return { ok: false, task_status: 'blocked', issues: ['INDEPENDENT_EXPECTATIONS_INVALID'], assessment: null };
  const expected = expectedResult.data;
  const parsed = Assessment.safeParse(input);
  if (!parsed.success) return { ok: false, task_status: 'blocked', issues: ['ASSESSMENT_SCHEMA_INVALID'], assessment: null };
  const value = parsed.data, issues: string[] = [];
  const add = (code: string) => { if (!issues.includes(code)) issues.push(code); };
  const unique = (ids: string[], code: string) => { if (new Set(ids).size !== ids.length) add(code); };
  unique(value.regions.map(region => region.id), 'REGION_ID_DUPLICATE'); unique(value.facts.map(fact => fact.id), 'FACT_ID_DUPLICATE');
  unique(value.nodes, 'NODE_ID_DUPLICATE'); unique(value.wires.map(wire => wire.id), 'WIRE_ID_DUPLICATE');
  unique(value.symbols.map(symbol => symbol.id), 'SYMBOL_ID_DUPLICATE');
  unique(value.symbols.flatMap(symbol => symbol.ports.map(port => port.id)), 'PORT_ID_DUPLICATE');
  if (value.source_sha256 !== expected.source_sha256) add('SOURCE_IDENTITY_MISMATCH');
  const regions = new Set(value.regions.map(region => region.id));
  for (const region of value.regions) if (region.left + region.width > expected.width || region.top + region.height > expected.height) add('REGION_OUTSIDE_SOURCE');
  for (const fact of value.facts) {
    if (!regions.has(fact.region_id)) add('FACT_REGION_MISSING');
    if (fact.status === 'unknown' && fact.value !== null) add('UNKNOWN_MUST_BE_NULL');
    if (fact.status === 'unknown' || fact.status === 'conflict' || fact.value === null) add('FACT_UNRESOLVED');
    if (fact.status === 'observed' && !fact.raw?.trim()) add('OBSERVATION_WITHOUT_RAW');
    if (!Object.hasOwn(expected.values, fact.id)) add('FACT_NOT_INDEPENDENTLY_VERIFIED');
    else if (expected.values[fact.id] !== fact.value) add('FACT_EXPECTATION_MISMATCH');
    if (fact.kind === 'voltage_kv') {
      const raw = fact.raw?.match(/^\s*(\d+(?:\.\d+)?)\s*kV\s*$/i);
      if (!raw || typeof fact.value !== 'number' || Number(raw[1]) !== fact.value) add('VOLTAGE_NORMALIZATION_CONFLICT');
    }
    if ((fact.kind === 'label' || fact.kind === 'drawing_id') && fact.status === 'observed'
      && fact.raw?.replace(/\s/g, '') !== String(fact.value).replace(/\s/g, '')) add('TEXT_NORMALIZATION_CONFLICT');
  }
  for (const id of Object.keys(expected.values)) if (!value.facts.some(fact => fact.id === id)) add('REQUIRED_FACT_MISSING');
  const labels = value.facts.filter(fact => fact.kind === 'label').map(fact => fact.value);
  if (expected.required_labels.some(label => !labels.includes(label))) add('REQUIRED_LABEL_MISSING');
  if (value.coordinate_mode === 'physical') {
    const anchor = value.facts.find(fact => fact.id === value.physical_scale?.source_fact);
    if (!value.physical_scale || !anchor || anchor.kind !== 'scale' || anchor.status !== 'observed'
      || !Object.hasOwn(expected.values, anchor.id)) add('PHYSICAL_SCALE_UNESTABLISHED');
  }
  const parents = new Map(value.nodes.map(node => [node, node]));
  const find = (node: string): string | undefined => {
    if (!parents.has(node)) return undefined;
    let current: string = node;
    for (let i = 0; i <= parents.size; i++) {
      const next: string | undefined = parents.get(current); if (!next) return undefined;
      if (next === current) return current; current = next;
    }
    return undefined;
  };
  const join = (a: string, b: string) => { const x = find(a), y = find(b); if (!x || !y) add('TOPOLOGY_NODE_MISSING'); else parents.set(x, y); };
  for (const wire of value.wires) {
    if (!regions.has(wire.region_id)) add('WIRE_REGION_MISSING'); join(wire.from_node, wire.to_node);
  }
  for (const crossing of value.crossings) {
    const a = value.wires.find(wire => wire.id === crossing.wire_a), b = value.wires.find(wire => wire.id === crossing.wire_b);
    const fact = value.facts.find(item => item.id === crossing.fact_id);
    if (!a || !b || a.id === b.id || !fact || fact.kind !== 'crossing' || fact.value !== crossing.kind) add('CROSSING_EVIDENCE_INVALID');
    if (crossing.kind === 'unresolved') add('CROSSING_UNRESOLVED');
    if (crossing.kind === 'junction') {
      if (!crossing.node_id || !a || !b) add('JUNCTION_NODE_MISSING');
      else { join(a.from_node, crossing.node_id); join(b.from_node, crossing.node_id); }
    } else if (crossing.node_id !== null) add('BRIDGE_MUST_NOT_JOIN');
  }
  const ports = new Map<string, string>();
  for (const symbol of value.symbols) {
    const fact = value.facts.find(item => item.id === symbol.fact_id);
    if (!fact || fact.kind !== 'symbol' || fact.value !== symbol.kind || expected.symbol_kinds[symbol.id] !== symbol.kind || symbol.kind === 'UNKNOWN') add('SYMBOL_TYPE_UNVERIFIED');
    for (const port of symbol.ports) {
      if (!parents.has(port.node_id)) add('PORT_NODE_MISSING'); ports.set(port.id, port.node_id);
    }
  }
  for (const id of Object.keys(expected.symbol_kinds)) if (!value.symbols.some(symbol => symbol.id === id)) add('REQUIRED_SYMBOL_MISSING');
  const connected = (a: string, b: string) => ports.has(a) && ports.has(b) && find(ports.get(a)!) === find(ports.get(b)!);
  if (expected.connected.some(([a, b]) => !connected(a, b))) add('TOPOLOGY_CONNECTION_MISSING');
  if (expected.disconnected.some(([a, b]) => !ports.has(a) || !ports.has(b) || connected(a, b))) add('TOPOLOGY_FALSE_CONNECTION');
  return { ok: issues.length === 0, task_status: issues.length ? 'blocked' : 'succeeded', issues, assessment: value };
}
