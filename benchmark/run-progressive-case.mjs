import {appendFile,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {InteractiveSession,runTask} from '@cader/profile';

const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('pnpm build && node benchmark/run-progressive-case.mjs --live-smoke --approve-cad-task --mcp <config> --workspace <new-empty-directory> --task-file <UTF-8 request> [--checkpoint-pause-resume]');
  console.log('Uses configured real models and AutoCAD. Approves only CAD task requests, never Shell. Keeps all documents and evidence. Configured total budgets still apply.');
}else{
  const switches=new Set(['--live-smoke','--approve-cad-task','--checkpoint-pause-resume']);
  const values=new Set(['--mcp','--workspace','--task-file']),flags=new Map();
  for(let i=0;i<args.length;i++){
    const key=args[i];if(flags.has(key))throw new Error('Duplicate argument: '+key);
    if(switches.has(key))flags.set(key,true);
    else if(values.has(key)&&args[i+1]&&!args[i+1].startsWith('--'))flags.set(key,args[++i]);
    else throw new Error('Unknown or incomplete argument; use --help');
  }
  if(!flags.get('--live-smoke')||!flags.get('--approve-cad-task')||[...values].some(key=>!flags.get(key)))throw new Error('Explicit real-service/CAD approval and all paths required; use --help');
  const root=process.cwd(),workspace=resolve(flags.get('--workspace'));
  try{if((await readdir(workspace)).length)throw new Error('Regression workspace must be empty; existing evidence is never replaced');}catch(error){if(error.code!=='ENOENT')throw error;}
  const task=await readFile(resolve(flags.get('--task-file')),'utf8');if(!task.trim())throw new Error('Task file is empty');
  try{process.loadEnvFile(join(root,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(workspace,{recursive:true});
  const session=await InteractiveSession.create(root,workspace,(configRoot,input)=>runTask(configRoot,input));
  const abort=new AbortController();let paused=false,trace=Promise.resolve();
  const log=event=>{if(event.type!=='assistant.delta')trace=trace.then(()=>appendFile(join(workspace,'regression-events.jsonl'),session.clean(JSON.stringify(event))+'\n'));};
  const confirm=async description=>{const allowed=description.startsWith('CAD ');log({type:'regression.approval',allowed,description});return allowed;};
  try{
    const mcp=resolve(flags.get('--mcp'));await session.execute('/mcp use '+mcp);await session.execution.connect(mcp);
    const first=await session.execute(task,{signal:abort.signal,confirm,onEvent:event=>{
      log(event);
      if(flags.get('--checkpoint-pause-resume')&&!paused&&event.type==='task.batch_verified'&&event.status==='pass'){
        paused=true;log({type:'regression.controlled_checkpoint_pause',region:event.region,batch:event.batch,no_native_write_pending:true});abort.abort();
      }
    }});
    await trace;
    if(!session.state.qualityRun){await writeFile(join(workspace,'regression-preflight.json'),session.clean(JSON.stringify(first,null,2)),{flag:'wx'});throw new Error('No quality manifest; inspect regression-preflight.json');}
    const before=JSON.parse(await readFile(session.state.qualityRun,'utf8'));let second;
    if(paused&&!session.execution.facts().frozen)second=await session.execute('/quality resume',{confirm,onEvent:log});
    await trace;const after=JSON.parse(await readFile(session.state.qualityRun,'utf8'));
    const invariants={resume_exercised:Boolean(second),same_task:before.task_id===after.task_id,same_connection:before.execution.local_connection_id===after.execution.local_connection_id,
      same_document:before.execution.scratch===after.execution.scratch,no_unknown:after.execution.session_counts.unknown===0,
      native_identity_available:Boolean(before.execution.native_target?.document_id&&after.execution.native_target?.document_id),
      same_native_document:before.execution.native_target?.document_id&&after.execution.native_target?.document_id?before.execution.native_target.instance_id===after.execution.native_target.instance_id&&before.execution.native_target.document_id===after.execution.native_target.document_id:null,
      confirmed_new_drawing_count:after.execution.operations.filter(op=>op.tool==='new_drawing'&&op.outcome==='committed').length,
      token_budget_preserved:after.budget.reported_tokens>=before.budget.reported_tokens,started_at_preserved:after.budget.started_at===before.budget.started_at};
    const recoveryPass=second?invariants.same_task&&invariants.same_connection&&invariants.same_document&&invariants.no_unknown&&invariants.confirmed_new_drawing_count===1&&invariants.token_budget_preserved&&invariants.started_at_preserved&&invariants.same_native_document!==false:null;
    const report={kind:'real-model-real-AutoCAD-production-InteractiveSession',paused,invariants,recovery_accepted:recoveryPass,first,second,manifest:session.state.qualityRun,phase:after.phase,
      quality_accepted:after.quality_accepted,failure:after.failure,artifact:after.artifact,counts:after.execution.session_counts,budget:after.budget,
      regions:after.progressive?.regions.map(region=>({id:region.id,status:region.status,entities:region.entity_ids.length,batches:region.batches.length,failure:region.failure}))};
    await writeFile(join(workspace,'regression-result.json'),session.clean(JSON.stringify(report,null,2)),{flag:'wx'});
    console.log(JSON.stringify({workspace,manifest:session.state.qualityRun,phase:after.phase,accepted:after.quality_accepted,paused,invariants,failure:after.failure},null,2));
    if(!after.quality_accepted||flags.get('--checkpoint-pause-resume')&&recoveryPass!==true)process.exitCode=1;
  }finally{await trace;await session.dispose();}
}
