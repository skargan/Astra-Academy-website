import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from './support/app.mjs';

async function fixture(t,options={}){
 const folder=await mkdtemp(join(tmpdir(),'astra-audit-')),origin='http://127.0.0.1:4191';
 const app=await createApp({demo:true,dbPath:join(folder,'audit.sqlite'),baseUrl:origin,...options});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.close();await rm(folder,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const call=async(route,body,actor={})=>{const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(actor.cookie?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrf}: {})},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(r.headers.get('set-cookie'))actor.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)actor.csrf=data.csrf;return {status:r.status,data};};
 return {app,base,call};
}
test('missing public files and malformed JSON bodies are client errors',async t=>{
 const {base,call}=await fixture(t);
 assert.equal((await fetch(base+'/missing-page.html')).status,404);
 assert.equal((await fetch(base+'/assets/missing-image.png')).status,404);
 for(const body of [null,[],42,'hello'])assert.equal((await call('/api/login',body)).status,400);
});
test('published events are chronological regardless of storage insertion order',async t=>{
 const {app,call}=await fixture(t);
 const events=(await call('/api/events')).data;
 for(const e of events){e.date=e.id==='camp'?'2099-01-01T10:00:00+02:00':'2099-02-01T10:00:00+02:00';await app.db.run('UPDATE events SET payload=? WHERE id=?',JSON.stringify(e),e.id);}
 assert.equal((await call('/api/events')).data[0].id,'camp');
});
test('new prices preserve existing purchases while booked dates remain protected',async t=>{
 const {app,call}=await fixture(t),admin={},member={};
 await call('/api/demo-login',{role:'admin'},admin);await call('/api/demo-login',{role:'member'},member);
 const e=JSON.parse((await app.db.get("SELECT payload FROM events WHERE id='hike'")).payload);e.date='2099-01-01T10:00:00+02:00';
 assert.equal((await call('/api/admin/event',e,admin)).status,200);
 const order=(await call('/api/checkout',{kind:'event',eventId:'hike',terms:true},member)).data;
 await call('/api/demo-pay',{orderId:order.orderId},member);
 assert.equal((await call('/api/admin/event',{...e,price:3000},admin)).status,200);
 assert.equal((await app.db.get('SELECT amount FROM orders WHERE id=?',order.orderId)).amount,e.price);
 assert.equal((await app.db.get("SELECT price FROM bookings WHERE event_id='hike'")).price,e.price);
 assert.equal((await call('/api/admin/event',{...e,price:3000,date:'2099-01-02T10:00:00+02:00'},admin)).status,400);
});
test('a password reset token cannot be consumed by two concurrent requests',async t=>{
 const {call}=await fixture(t),actor={};
 await call('/api/register',{name:'Audit member',email:'reset@example.test',password:'original passphrase here',adultMale:true,privacy:true});
 const requested=await call('/api/password/request',{email:'reset@example.test'});
 const token=new URL(requested.data.demoLink).searchParams.get('reset');
 const results=await Promise.all([call('/api/password/reset',{token,password:'replacement passphrase one'}),call('/api/password/reset',{token,password:'replacement passphrase two'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
 assert.equal((await call('/api/password/reset',{token,password:'another long passphrase'},actor)).status,400);
});
test('verification links can be requested again after an expired or lost email',async t=>{
 const {app,call}=await fixture(t),actor={};
 await call('/api/register',{name:'Audit member',email:'verify@example.test',password:'original passphrase here',adultMale:true,privacy:true});
 await call('/api/login',{email:'verify@example.test',password:'original passphrase here'},actor);
 const r=await call('/api/verify/request',{},actor);assert.equal(r.status,200);
 const token=new URL(r.data.demoLink).searchParams.get('verify');
 assert.equal((await call('/api/verify',{token},actor)).status,200);
 assert.equal((await app.db.get("SELECT verified FROM users WHERE email='verify@example.test'")).verified,1);
});
test('email failure is reported and an unverified account can recover',async t=>{
 let unavailable=true;
 const {app,call}=await fixture(t,{sendMail:async()=>{if(unavailable)throw Error('Provider unavailable');}}),actor={};
 const signup=await call('/api/register',{name:'Audit member',email:'mail@example.test',password:'original passphrase here',adultMale:true,privacy:true});
 assert.equal(signup.status,503);
 assert.equal((await app.db.get("SELECT status FROM mail WHERE email='mail@example.test'")).status,'failed');
 assert.equal((await call('/api/login',{email:'mail@example.test',password:'original passphrase here'},actor)).status,200);
 unavailable=false;
 assert.equal((await call('/api/verify/request',{},actor)).status,200);
 assert.equal((await app.db.get("SELECT COUNT(*) count FROM mail WHERE email='mail@example.test' AND status='sent'")).count,1);
});
