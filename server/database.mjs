import {AsyncLocalStorage} from 'node:async_hooks';
import {readFile} from 'node:fs/promises';
import {events,instructors} from './config.mjs';
import {mysqlSql} from './dialect.mjs';

export async function openDb(filename,options={}) {
 const driver=options.driver||process.env.DB_DRIVER||'sqlite';
 if(!['sqlite','mysql'].includes(driver))throw new Error('DB_DRIVER must be mysql or sqlite.');
 if(driver==='sqlite'){
  const {openDb:openLocal}=await import('./sqlite.mjs');
  const local=openLocal(filename,{seed:options.seed!==false}),context=new AsyncLocalStorage();let tail=Promise.resolve(),closed=false;
  const exclusive=fn=>{const result=tail.then(fn);tail=result.catch(()=>{});return result;};
  const operation=fn=>context.getStore()?Promise.resolve().then(fn):exclusive(fn);
  return {
   driver,prepare:sql=>local.prepare(sql),
   get:(sql,...args)=>operation(()=>local.prepare(sql).get(...args)),
   all:(sql,...args)=>operation(()=>local.prepare(sql).all(...args)),
   run:(sql,...args)=>operation(()=>local.prepare(sql).run(...args)),
   transaction:fn=>exclusive(()=>context.run(true,async()=>{
    local.exec('BEGIN IMMEDIATE');try{const value=await fn();local.exec('COMMIT');return value;}catch(e){local.exec('ROLLBACK');throw e;}
   })),
   close:async()=>{await tail;if(!closed){closed=true;local.close();}}
  };
 }
 const {default:mysql}=await import('mysql2/promise');
 const settings=options.mysql||{
  host:process.env.MYSQL_HOST||'localhost',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,
  ...(process.env.MYSQL_SSL_CA?{ssl:{ca:await readFile(process.env.MYSQL_SSL_CA,'utf8'),rejectUnauthorized:true}}:{})
 };
 if(!settings.user||!settings.database)throw new Error('Configure MYSQL_USER and MYSQL_DATABASE on the host.');
 const pool=mysql.createPool({...settings,charset:'utf8mb4',connectionLimit:5,supportBigNumbers:true,bigNumberStrings:false,multipleStatements:false,connectTimeout:10000});
 const context=new AsyncLocalStorage();
 const execute=async(sql,args)=>{
  const [result]=await (context.getStore()||pool).execute(mysqlSql(sql),args);
  return result;
 };
 const db={
  driver,
  get:async(sql,...args)=>(await execute(sql,args))[0],
  all:(sql,...args)=>execute(sql,args),
  run:async(sql,...args)=>{const r=await execute(sql,args);return {changes:r.affectedRows,lastInsertRowid:r.insertId};},
  transaction:async fn=>{
   if(context.getStore())throw new Error('Nested database transaction is not supported.');
   const connection=await pool.getConnection();
   try{
    await connection.beginTransaction();
    // Serialize capacity, benefits and webhook replay across app processes.
    await connection.execute('SELECT id FROM app_lock WHERE id=1 FOR UPDATE');
    const value=await context.run(connection,fn);await connection.commit();return value;
   }catch(e){await connection.rollback();throw e;}finally{connection.release();}
  },
  close:()=>pool.end()
 };
 try{
  const schema=await readFile(new URL('./schema.mysql.sql',import.meta.url),'utf8');
  for(const sql of schema.split(';').map(s=>s.trim()).filter(Boolean))await pool.query(sql);
  if(options.seed!==false)await db.transaction(async()=>{
   for(const [table,seeds] of [['events',events],['instructors',instructors]]){
    if(!await db.get('SELECT id FROM '+table+' LIMIT 1'))for(const entry of seeds)await db.run('INSERT INTO '+table+' VALUES(?,?)',entry.id,JSON.stringify(entry));
   }
  });
  return db;
 }catch(e){await pool.end();throw e;}
}
