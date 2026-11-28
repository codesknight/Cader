import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {atomicPrivateState,retryPrivateRename} from '@cader/profile';

test('Windows transient sharing denial retries only the same checkpoint replacement',async()=>{
 const calls:string[][]=[],delays:number[]=[];
 await retryPrivateRename('same-synced-file','old-checkpoint',{platform:'win32',rename:async(from,to)=>{calls.push([String(from),String(to)]);if(calls.length<3)throw Object.assign(Error('sharing'),{code:'EPERM'});},delay:async ms=>{delays.push(ms);}});
 assert.equal(calls.length,3);assert.ok(calls.every(c=>c[0]==='same-synced-file'&&c[1]==='old-checkpoint'));assert.deepEqual(delays,[25,50]);
});
for(const [platform,code,expected]of [['win32','EACCES',10],['win32','ENOSPC',1],['linux','EPERM',1]] as const)test('checkpoint permanent error remains failed: '+platform+'/'+code,async()=>{
 let calls=0,waited=0;await assert.rejects(retryPrivateRename('new','old',{platform,rename:async()=>{calls++;throw Object.assign(Error('denied'),{code});},delay:async ms=>{waited+=ms;}}),error=>{assert.equal((error as NodeJS.ErrnoException).code,code);return true;});assert.equal(calls,expected);assert.ok(waited<5000);
});
test('failed checkpoint retains synced candidate and exact stage/cause without destroying old target',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cader-checkpoint-'));try{
  const target=join(root,'old');await writeFile(target,'preserved');
  await assert.rejects(atomicPrivateState(join(target,'impossible.json'),'new'),error=>{assert.equal((error as Error).message,'CHECKPOINT_PERSIST_FAILED');assert.equal(((error as Error).cause as any).stage,'open');return true;});assert.equal(await readFile(target,'utf8'),'preserved');
  const path=join(root,'quality.json');await atomicPrivateState(path,'{"step":1}');await atomicPrivateState(path,'{"step":2}');assert.equal(JSON.parse(await readFile(path,'utf8')).step,2);assert.equal((await readdir(root)).filter(n=>n.startsWith('.write-')).length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
