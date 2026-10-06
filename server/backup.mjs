import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openDb} from './db.mjs';

export const columns={
 users:['id','email','name','password','role','verified','created'],
 events:['id','payload'],instructors:['id','payload'],
 applications:['user_id','plan','cycle','motivation','support','status','created'],
 memberships:['user_id','plan','cycle','status','until','subscription','customer','cancel_end','started'],
 bookings:['id','user_id','event_id','status','price','attended','benefit','created','expires'],
 orders:['id','user_id','kind','target','amount','status','session','payment','created','expires'],
 subscribers:['email','name','status','consent','token','created'],
 webhook_events:['id','created'],mail:['id','email','subject','body','status','created'],
 badges:['user_id','badge','created'],requests:['id','user_id','kind','target','status','reason','created'],
 audit:['id','actor','action','target','created']
};
export async function exportData(db){
 return db.transaction(async()=>{
  const tables={};for(const [table,fields] of Object.entries(columns))tables[table]=await db.all('SELECT '+fields.map(f=>'`'+f+'`').join(',')+' FROM '+table);
  return {format:'astra-portable-backup',schema:1,created:new Date().toISOString(),codeRevision:process.env.CODE_REVISION||null,tables};
 });
}
export async function restoreData(db,backup){
 if(backup?.format!=='astra-portable-backup'||backup.schema!==1||!backup.tables)throw new Error('Unsupported backup format.');
 if(Object.keys(backup.tables).sort().join(',')!==Object.keys(columns).sort().join(','))throw new Error('Backup tables do not match schema.');
 for(const [table,fields] of Object.entries(columns)){
  if(!Array.isArray(backup.tables[table]))throw new Error('Invalid backup table.');
  for(const row of backup.tables[table])if(!row||Object.keys(row).sort().join(',')!==[...fields].sort().join(','))throw new Error('Invalid backup columns: '+table);
 }
 await db.transaction(async()=>{
  for(const table of [...Object.keys(columns),'sessions','tokens'])if((await db.get('SELECT COUNT(*) count FROM '+table)).count)throw new Error('Restore requires a new empty database. Existing records are never overwritten.');
  for(const [table,fields] of Object.entries(columns))for(const row of backup.tables[table]){
   await db.run('INSERT INTO '+table+' ('+fields.map(f=>'`'+f+'`').join(',')+') VALUES('+fields.map(()=>'?').join(',')+')',...fields.map(f=>row[f]));
  }
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command,filename,confirmation]=process.argv.slice(2);
 if(!['export','restore'].includes(command)||!filename)throw new Error('Usage: npm run backup -- export /private/file.json OR restore /private/file.json --confirm-empty');
 if(command==='restore'&&confirmation!=='--confirm-empty')throw new Error('Restore requires --confirm-empty and a new empty database.');
 const file=path.resolve(filename),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 if(file===root||file.startsWith(path.join(root,'assets')+path.sep))throw new Error('Keep backups outside publicly served assets.');
 const db=await openDb(process.env.DB_PATH||path.join(root,'data/astra.sqlite'),{seed:false});
 try{
  if(command==='export'){const data=await exportData(db);await writeFile(file,JSON.stringify(data,null,2),{flag:'wx',mode:0o600});console.log('Private portable backup saved. Keep it encrypted and outside GitHub.');}
  else{await restoreData(db,JSON.parse(await readFile(file,'utf8')));console.log('Restored to empty database. Sessions and account-recovery links were not copied; members must sign in again.');}
 }finally{await db.close();}
}
