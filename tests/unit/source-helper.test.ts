import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {spawn} from 'node:child_process';
import {runSourceHelper,sourceHelperEnvironment,sourceHelperFailureCode} from '@cader/dsh-adapter';

test('local CV environment omits provider credentials and bounds numerical-library threads',()=>{
 const prior=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='fixture-not-for-child';
 try{const env=sourceHelperEnvironment();assert.equal(env.DEEPSEEK_API_KEY,undefined);for(const k of ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'])assert.equal(env[k],'1');}finally{if(prior===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=prior;}
 for(const code of [0xc0000017,0xc000012d,-1073741801])assert.equal(sourceHelperFailureCode(code,''),'SOURCE_HELPER_RESOURCE_EXHAUSTED');
 assert.equal(sourceHelperFailureCode(null,'','ENOMEM'),'SOURCE_HELPER_RESOURCE_EXHAUSTED');assert.equal(sourceHelperFailureCode(null,'','ENOENT'),'SOURCE_RESIDUAL_HELPER_FAILED');assert.equal(sourceHelperFailureCode(null,'killed by operator'),'SOURCE_RESIDUAL_HELPER_FAILED');
});
for(const memory of [false,true])test('fixed helper failure records bounded private stderr and never returns a quality result: memory='+memory,async()=>{
 const root=await mkdtemp(join(tmpdir(),'cader-helper-')),path=join(root,'failure.json');let called=0;
 const fake=((_python:any,_args:any,options:any)=>{called++;assert.equal(options.windowsHide,true);assert.equal(options.env.OMP_NUM_THREADS,'1');assert.deepEqual(options.stdio,['ignore','ignore','pipe']);const child=new EventEmitter() as any;child.stderr=new PassThrough();queueMicrotask(()=>{child.stderr.write('x'.repeat(20000)+(memory?'MemoryError: allocation failed':'ValueError: invalid worker data'));child.stderr.end();child.emit('close',1,null);});return child;}) as typeof spawn;
 try{await assert.rejects(runSourceHelper({python:'fixed-fixture',args:['fixed'],root,signal:new AbortController().signal,diagnostic:path,metadata:{input_sha256:'bound-input',source_sha256:'bound-source'}},fake),error=>{assert.equal((error as Error).message,memory?'SOURCE_HELPER_RESOURCE_EXHAUSTED':'SOURCE_RESIDUAL_HELPER_FAILED');assert.equal(((error as Error).cause as any).diagnostic_written,true);return true;});const report=JSON.parse(await readFile(path,'utf8'));assert.equal(called,1);assert.ok(report.stderr.length<=8192);assert.equal(report.input_sha256,'bound-input');assert.equal(report.cad_dispatched,false);assert.equal(report.quality_accepted,false);assert.equal(report.code,memory?'SOURCE_HELPER_RESOURCE_EXHAUSTED':'SOURCE_RESIDUAL_HELPER_FAILED');}finally{await rm(root,{recursive:true,force:true});}
});
