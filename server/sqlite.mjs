import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {events,instructors} from './config.mjs';
export function openDb(filename,{seed=true}={}) {
  mkdirSync(dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT DEFAULT 'member',verified INTEGER DEFAULT 0,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tokens(token TEXT PRIMARY KEY,user_id TEXT,kind TEXT NOT NULL,email TEXT,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS applications(user_id TEXT PRIMARY KEY REFERENCES users(id),plan TEXT NOT NULL,cycle TEXT NOT NULL,motivation TEXT NOT NULL,support TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships(user_id TEXT PRIMARY KEY REFERENCES users(id),plan TEXT NOT NULL,cycle TEXT NOT NULL,status TEXT NOT NULL,until INTEGER NOT NULL DEFAULT 0,subscription TEXT,customer TEXT,cancel_end INTEGER DEFAULT 0,started INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS instructors(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),event_id TEXT NOT NULL REFERENCES events(id),status TEXT NOT NULL,price INTEGER NOT NULL,attended INTEGER DEFAULT 0,benefit TEXT DEFAULT '',created INTEGER NOT NULL,expires INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking ON bookings(user_id,event_id) WHERE status IN ('pending','confirmed','refund_requested');
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,target TEXT NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,session TEXT,payment TEXT,created INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS subscribers(email TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL,consent INTEGER NOT NULL,token TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mail(id TEXT PRIMARY KEY,email TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,status TEXT DEFAULT 'queued',created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS badges(user_id TEXT NOT NULL REFERENCES users(id),badge TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(user_id,badge));
    CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,target TEXT NOT NULL,status TEXT DEFAULT 'pending',reason TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created INTEGER NOT NULL);
  `);
  if(seed&&!db.prepare('SELECT id FROM events LIMIT 1').get()){
    for(const event of events) db.prepare('INSERT INTO events VALUES(?,?)').run(event.id,JSON.stringify(event));
    for(const instructor of instructors) db.prepare('INSERT INTO instructors VALUES(?,?)').run(instructor.id,JSON.stringify(instructor));
  }
  return db;
}
