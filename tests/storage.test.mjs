import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openTestDb} from './support/app.mjs';
import {openDb} from '../server/db.mjs';
import {exportData,restoreData} from '../server/backup.mjs';
import {createApp as actualCreateApp} from '../server/server.mjs';
import {createApp} from './support/app.mjs';
import {mysqlSql} from '../server/dialect.mjs';

test('portable backup restores records and frozen purchase prices, but no login sessions',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'astra-backup-'));
 const source=await openTestDb(join(folder,'source.sqlite'));
 const target=await openTestDb(join(folder,'target.sqlite'),{seed:false});
 try{
  await source.run('INSERT INTO users VALUES(?,?,?,?,?,?,?)','u','man@example.test','Vyras','hashed','member',1,Date.now());
  await source.run('INSERT INTO sessions VALUES(?,?,?)','session','u',Date.now()+10000);
  await source.run('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)','o','u','event','b',2000,'paid','cs','pi',Date.now(),Date.now());
  const event=JSON.parse((await source.get("SELECT payload FROM events WHERE id='hike'")).payload);event.price=3000;
  await source.run("UPDATE events SET payload=? WHERE id='hike'",JSON.stringify(event));
  const backup=await exportData(source);assert.equal(backup.tables.sessions,undefined);
  await restoreData(target,backup);
  assert.equal((await target.get("SELECT amount FROM orders WHERE id='o'")).amount,2000);
  assert.equal(JSON.parse((await target.get("SELECT payload FROM events WHERE id='hike'")).payload).price,3000);
  assert.equal((await target.get('SELECT COUNT(*) count FROM sessions')).count,0);
  await assert.rejects(restoreData(target,backup),/empty database/);
  await assert.rejects(restoreData(target,{...backup,schema:99}),/Unsupported/);
  await target.transaction(async()=>{await target.run("UPDATE users SET name='Keistas' WHERE id='u'");throw new Error('rollback');}).catch(()=>{});
  assert.equal((await target.get("SELECT name FROM users WHERE id='u'")).name,'Vyras');
 }finally{await source.close();await target.close();await rm(folder,{recursive:true,force:true});}
});

test('public modes require separate MySQL and preview is explicit',async()=>{
 await assert.rejects(actualCreateApp({mode:'preview',baseUrl:'https://example.test'}),/DB_DRIVER=mysql/);
 await assert.rejects(actualCreateApp({mode:'preview',baseUrl:'http://example.test'}),/HTTPS/);
 await assert.rejects(actualCreateApp({mode:'wrong'}),/APP_MODE/);
});

test('hosted preview exposes public pages but cannot collect data or grant demo access',{skip:process.env.ASTRA_TEST_MYSQL!=='true'},async()=>{
 const folder=await mkdtemp(join(tmpdir(),'astra-preview-'));
 const app=await createApp({mode:'preview',baseUrl:'https://preview.example.test',dbPath:join(folder,'preview')});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 try{
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await (await fetch(base+'/api/config')).json()).preview,true);
  assert.deepEqual(await (await fetch(base+'/api/me')).json(),{user:null});
  assert.equal((await (await fetch(base+'/api/health')).json()).ok,true);
  for(const route of ['register','newsletter','demo-login','checkout','webhook'])assert.equal((await fetch(base+'/api/'+route,{method:'POST',body:'{}'})).status,503);
  assert.equal((await fetch(base+'/api/admin')).status,503);
  assert.equal((await app.db.get('SELECT COUNT(*) count FROM users')).count,0);
  assert.equal((await fetch(base+'/.env')).status,404);
 }finally{await app.close();await rm(folder,{recursive:true,force:true});}
});

test('SQL adapter converts upserts and preserves quoted column names',()=>{
 assert.match(mysqlSql('INSERT INTO memberships(user_id,until) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET until=excluded.until'),/ON DUPLICATE KEY UPDATE `until`=VALUES\(`until`\)/);
 assert.equal(mysqlSql('SELECT `until` FROM memberships'),'SELECT `until` FROM memberships');
 assert.match(mysqlSql('INSERT OR IGNORE INTO badges VALUES(?,?,?)'),/ON DUPLICATE KEY UPDATE/);
});

test('local SQLite export can move directly into standard MySQL',{skip:process.env.ASTRA_TEST_MYSQL!=='true'},async()=>{
 const folder=await mkdtemp(join(tmpdir(),'astra-cross-storage-'));
 const local=await openDb(join(folder,'local.sqlite'),{driver:'sqlite'});
 const hosted=await openTestDb(join(folder,'hosted'),{seed:false});
 try{
  await local.run('INSERT INTO users VALUES(?,?,?,?,?,?,?)','owner','owner@example.test','Džiugas','hash','admin',1,1760000000000);
  await local.run('INSERT INTO memberships VALUES(?,?,?,?,?,?,?,?,?)','owner','support','year','active',1893456000000,'sub_keep','cus_keep',0,1760000000000);
  await restoreData(hosted,await exportData(local));
  assert.equal((await hosted.get("SELECT name FROM users WHERE id='owner'")).name,'Džiugas');
  assert.equal((await hosted.get("SELECT * FROM memberships WHERE user_id='owner'")).until,1893456000000);
  assert.equal((await hosted.get("SELECT * FROM memberships WHERE user_id='owner'")).subscription,'sub_keep');
 }finally{await local.close();await hosted.close();await rm(folder,{recursive:true,force:true});}
});
