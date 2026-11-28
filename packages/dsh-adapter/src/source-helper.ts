import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';

/** Fixed local CV workers receive no provider credentials and use bounded
 * numerical-library parallelism. This is not an Agent Shell entry. */
export function sourceHelperEnvironment():NodeJS.ProcessEnv{
  const env:NodeJS.ProcessEnv={PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',MKL_NUM_THREADS:'1',NUMEXPR_NUM_THREADS:'1'};
  for(const key of ['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','HOME','LOCALAPPDATA','APPDATA'])if(process.env[key])env[key]=process.env[key];
  return env;
}
export function sourceHelperFailureCode(code:number|null,stderr:string,spawnCode?:string){
  const native=code===null?null:code>>>0;
  return spawnCode==='ENOMEM'||native===0xc0000017||native===0xc000012d||/MemoryError|OutOfMemory|bad_alloc|failed to allocate|not enough memory|insufficient memory|paging file.*small/i.test(stderr)?'SOURCE_HELPER_RESOURCE_EXHAUSTED':'SOURCE_RESIDUAL_HELPER_FAILED';
}
export async function runSourceHelper(input:{python:string;args:string[];root:string;signal:AbortSignal;diagnostic:string;metadata:Record<string,unknown>},spawnWorker:typeof spawn=spawn){
  let stderr='',spawnError:{code?:string;message:string}|null=null;
  const result=await new Promise<{code:number|null;signal:string|null}>(accept=>{
    try{
      const child=spawnWorker(input.python,input.args,{cwd:input.root,env:sourceHelperEnvironment(),windowsHide:true,signal:input.signal,stdio:['ignore','ignore','pipe']});
      child.stderr!.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-8192);});
      child.once('error',error=>{spawnError={code:(error as NodeJS.ErrnoException).code,message:error.message.slice(0,2000)};accept({code:null,signal:null});});
      child.once('close',(code,signal)=>accept({code,signal}));
    }catch(error){const e=error as NodeJS.ErrnoException;spawnError={code:e.code,message:e.message.slice(0,2000)};accept({code:null,signal:null});}
  });
  input.signal.throwIfAborted();
  if(result.code===0&&!spawnError)return;
  const startup=spawnError as {code?:string;message:string}|null,code=sourceHelperFailureCode(result.code,stderr,startup?.code);
  const report={version:1,code,exit_code:result.code,signal:result.signal,spawn_error:startup,stderr,...input.metadata,cad_dispatched:false,quality_accepted:false};
  let written=false;try{await writeFile(input.diagnostic,JSON.stringify(report,null,2),{flag:'wx'});written=true;}catch{/* Preserve the original failure even if memory/disk also prevents diagnostics. */}
  throw new Error(code,{cause:{diagnostic_path:input.diagnostic,diagnostic_written:written,exit_code:result.code,signal:result.signal}});
}
