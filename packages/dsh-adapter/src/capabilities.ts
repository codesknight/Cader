import type { ModelProfile } from '@cader/config';

/** A projection of the actual scoped registry, not a second tool registry. Schema
 * references point to the exact function definitions supplied in this request. */
export function capabilityCatalog(input: {
  tools: { name: string; description?: string; outputSchema?: unknown }[];
  availableTools: string[];
  skills: { name: string; description: string; when_to_use: string; resources: string[] }[];
  workers: ModelProfile[];
  canDelegate: boolean;
  disabled: boolean;
}) {
  const names = new Set(input.availableTools);
  const available = (entry: string) => !input.disabled && names.has(entry);
  const status = (entry: string) => ({ available: available(entry),
    unavailable_reason: available(entry) ? null : input.disabled ? 'TOOLS_DISABLED' : 'ENTRY_NOT_AVAILABLE_IN_THIS_ROLE_OR_PHASE' });
  return [
    ...input.tools.map(tool => ({ kind: 'tool', name: tool.name,
      purpose: tool.description ?? tool.name,
      when_to_use: tool.description ?? 'Use when the task requires this operation.',
      input: available(tool.name) ? { schema_ref: `tools.${tool.name}.parameters` } : { schema_ref: null, note: 'Schema is withheld in this role or phase.' },
      output: { schema: tool.outputSchema, contract: 'Actual tool result or explicit error; inspect its evidence and business status before continuing.' },
      entry: { tool: tool.name }, ...status(tool.name) })),
    ...input.skills.map(skill => ({ kind: 'skill', name: skill.name, purpose: skill.description,
      when_to_use: skill.when_to_use, input: { name: skill.name, resource: skill.resources },
      output: 'Registered Markdown guidance; grants no tools or permissions.',
      entry: { tool: 'cader_load_skill', arguments: { name: skill.name } }, ...status('cader_load_skill') })),
    ...input.workers.map(worker => {
      // CAD visual acceptance always uses the controlled capture/review route.
      const entry = worker.role === 'vision' ? 'cader_review_cad_view' : 'cader_delegate';
      return { kind: 'subagent', name: worker.id,
        purpose: worker.description ?? (worker.role === 'vision' ? 'Review actual image evidence.' : 'Analyze a bounded independent text task.'),
        when_to_use: worker.when_to_use ?? (worker.role === 'vision' ? 'Check drawing appearance, symbols, labels or reference fidelity.' : 'Independent analysis that benefits from a separate worker.'),
        input: worker.role === 'vision' ? { question: 'Required visual conditions; Harness binds CAD evidence.' } : { profile: worker.id, instruction: 'Bounded task', image_ref: worker.input.includes('image') ? 'Optional authorized image ID' : null },
        output: worker.role === 'vision' ? 'Schema-validated visual report, image hash and uncertainty; not final acceptance.' : 'Findings, evidence and uncertainty; no writes or delegation.',
        entry: { tool: entry, ...(worker.role === 'vision' ? {} : { arguments: { profile: worker.id } }) },
        ...status(entry),
        ...(!input.canDelegate ? { available: false, unavailable_reason: 'CHILD_DELEGATION_DENIED' } : {}),
      };
    }),
  ];
}
