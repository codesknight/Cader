import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InteractiveSession } from './interactive.js';
import {createToolRuntime,invokeTool} from '@cader/dsh-adapter';
/** One original user request, real models and real AutoCAD. No operation sequence. */
export async function runQualitySmoke(root: string, mcpPath: string, task = '画一个带有 5V 电源和一个灯泡的串联电路图。') {
  const workspace = resolve(root, '.cader/runs', `quality-${randomUUID()}`);
  await mkdir(workspace, { recursive: true });
  const session = await InteractiveSession.create(root, workspace);
  const events: unknown[] = [];
  let approvals = 0;
  try {
    await session.execute(`/mcp use ${resolve(root, mcpPath)}`);
    await session.execution.connect(resolve(root,mcpPath));
    await session.execute('/model MainAgent');
    // Deterministic negative input against the actually discovered MCP schema,
    // distinct from the autonomous real-model drawing below.
    const probe=await createToolRuntime();
    let schemaPreflight:unknown;
    try{
      const textTool=session.execution.definitions().find(tool=>tool.name.endsWith('__draw_text'));
      if(!textTool)throw new Error('DRAW_TEXT_UNAVAILABLE');
      probe.tools.register(textTool);const mark=session.execution.mark();
      const invalid=await invokeTool(probe,textTool.name,{position_x:0,position_y:0,position_z:0,text:'5V'});
      const facts=session.execution.facts(mark);
      schemaPreflight={kind:'deterministic-negative-input-real-MCP-schema',rejected:invalid.isError,
        dispatched:facts.operations.some(op=>op.dispatched),frozen:facts.frozen,operations:facts.operations};
      if(!invalid.isError||facts.frozen||facts.operations.some(op=>op.dispatched))throw new Error('SCHEMA_PREFLIGHT_REGRESSION');
    }finally{await probe.fiber.dispose();}
    const reply = await session.execute(task, {
      confirm: async (description) => {
        if(!description.startsWith('CAD '))
          return false; approvals++; return true;
      },
      onEvent: event => {
        if(event.type !== 'assistant.delta')
          events.push(event);
      }
    });
    const reports = events as {
      type: string;
      phase?: string;
      review_valid?: boolean;
      structured?: unknown;
    }[];
    const checks = {
      completed: !reply.error && reports.some(e => e.type === 'task.phase' && e.phase === 'complete'),
      autonomousVision: reports.some(e => e.type === 'cad.review' && e.review_valid === true),
      realImageRequest: reports.some(e => e.type === 'image.request'), taskApproval: approvals >= 1
    };
    const report = {
      ok: Object.values(checks).every(Boolean), kind: 'real-model-real-CAD-autonomous-quality', request: task, checks, reply, approvals,schemaPreflight,
      limits: ['Native COM revision and pixel-to-CAD transform are not available; entities are re-queried by ID, never edited from pixels alone.'], runDirectory: workspace
    };
    await writeFile(resolve(workspace, 'verification.json'), session.clean(JSON.stringify(report, null, 2)));
    await writeFile(resolve(workspace, 'events.jsonl'), session.clean(events.map(e => JSON.stringify(e)).join('\n')));
    return report;
  }
  finally {
    await session.dispose();
  }
}
