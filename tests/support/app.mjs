import {after} from 'node:test';
import {createHash} from 'node:crypto';
import {createApp as actualCreateApp} from '../../server/server.mjs';
import {openDb} from '../../server/db.mjs';
const schemas=new Set();let manager;
const settings={host:'127.0.0.1',port:Number(process.env.ASTRA_TEST_MYSQL_PORT||33307),user:'root',password:process.env.ASTRA_TEST_MYSQL_PASSWORD||''};
async function databaseOptions(filename){
 if(process.env.ASTRA_TEST_MYSQL==='true'){
  const {default:mysql}=await import('mysql2/promise');manager||=await mysql.createConnection(settings);
  const schema='astra_test_'+createHash('sha256').update(filename).digest('hex').slice(0,16);
  await manager.query('CREATE DATABASE IF NOT EXISTS `'+schema+'` CHARACTER SET utf8mb4');schemas.add(schema);
  return {driver:'mysql',mysql:{...settings,database:schema}};
 }
 return {driver:'sqlite'};
}
export async function openTestDb(filename,options={}){return openDb(filename,{...await databaseOptions(filename),...options});}
export async function createApp(options){
 if(process.env.ASTRA_TEST_MYSQL==='true')options={...options,database:await databaseOptions(options.dbPath)};
 const app=await actualCreateApp(options);
 // Keep test setup code independent of the selected storage engine.
 app.db.prepare=sql=>({get:(...args)=>app.db.get(sql,...args),run:(...args)=>app.db.run(sql,...args),all:(...args)=>app.db.all(sql,...args)});
 return app;
}
after(async()=>{
 if(manager){for(const schema of schemas)await manager.query('DROP DATABASE `'+schema+'`');await manager.end();}
});
