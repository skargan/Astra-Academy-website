import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('hosting entry starts when imported by an external loader',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'astra-start-'));
 const entry=new URL('../server/start.mjs',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(entry)+')'],{env:{...process.env,APP_MODE:'demo',DB_DRIVER:'sqlite',DB_PATH:join(folder,'test.sqlite'),HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
 try{
  const deadline=Date.now()+5000;
  while(!/listening on port (\d+)/.test(log)&&Date.now()<deadline&&child.exitCode===null)await new Promise(resolve=>setTimeout(resolve,25));
  const port=/listening on port (\d+)/.exec(log)?.[1];assert.ok(port,log);
  assert.equal((await fetch('http://127.0.0.1:'+port+'/api/health')).status,200);
 }finally{if(child.exitCode===null){child.kill();await once(child,'exit');}await rm(folder,{recursive:true,force:true});}
});
