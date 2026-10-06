import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {createApp} from '../server/server.mjs';
import {verifyWebhook} from '../server/payments.mjs';

test('application, acceptance, membership, booking, attendance and refunds persist',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'astra-tests-'));
 const dbPath=join(directory,'test.sqlite'),origin='http://127.0.0.1:4175';
 let app=await createApp({demo:true,dbPath,baseUrl:origin});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 let target='http://127.0.0.1:'+app.server.address().port;
 const actors={guest:{},member:{},admin:{},second:{}};
 async function call(route,body,actor=actors.guest,headers={}){
  const response=await fetch(target+route,{method:body?'POST':'GET',headers:{...(body?{Origin:origin,'Content-Type':'application/json'}:{}),...(actor.cookie?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrf||''}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const cookie=response.headers.get('set-cookie');if(cookie)actor.cookie=cookie.split(';')[0];
  const data=await response.json();if(data.csrf)actor.csrf=data.csrf;
  return {status:response.status,data};
 }
 try{
  let r=await call('/api/admin');assert.equal(r.status,401);
  assert.equal((await call('/api/demo-login',{role:'admin'},actors.guest,{'X-Forwarded-For':'203.0.113.5'})).status,403,'demo admin cannot be exposed through a public proxy');
  r=await call('/api/demo-login',{role:'member'},actors.member);assert.equal(r.status,200);const userId=r.data.user.id;
  assert.equal((await call('/api/admin',undefined,actors.member)).status,403);
  assert.equal((await call('/api/checkout',{kind:'membership',terms:true},actors.member)).status,403);
  await call('/api/demo-login',{role:'admin'},actors.admin);
  assert.equal((await call('/api/admin/application',{userId,status:'accepted'},actors.admin)).status,200);
  r=await call('/api/checkout',{kind:'membership',terms:true},actors.member);assert.equal(r.status,200);assert.equal(r.data.amount,2900);const membershipOrder=r.data.orderId;
  assert.equal((await call('/api/demo-pay',{orderId:membershipOrder},actors.admin)).status,400,'cannot pay someone else’s order');
  assert.equal((await call('/api/demo-pay',{orderId:membershipOrder},actors.member)).status,200);
  assert.equal((await call('/api/demo-pay',{orderId:membershipOrder},actors.member)).status,400,'payment is not replayable');
  r=await call('/api/me',undefined,actors.member);assert.equal(r.data.membership.status,'active');assert.equal(r.data.user.password,undefined);
  assert.equal((await call('/api/checkout',{kind:'membership',terms:true},actors.member)).status,400,'no duplicate active subscription');
  r=await call('/api/checkout',{kind:'event',eventId:'hike',terms:true},actors.member);assert.equal(r.data.amount,2250,'community discount is calculated on server');
  await call('/api/demo-pay',{orderId:r.data.orderId},actors.member);
  let booking=app.db.prepare("SELECT * FROM bookings WHERE user_id=? AND event_id='hike'").get(userId);
  await call('/api/admin/attendance',{bookingId:booking.id,attended:true},actors.admin);
  assert.equal((await call('/api/me',undefined,actors.member)).data.badges[0].badge,'Pirmasis žingsnis');
  assert.equal((await call('/api/checkout',{kind:'event',eventId:'hike',terms:true},actors.member)).status,400,'no duplicate booking');
  await call('/api/admin/attendance',{bookingId:booking.id,attended:false},actors.admin);
  assert.equal((await call('/api/me',undefined,actors.member)).data.badges.length,0,'attendance correction removes earned badge');
  r=await call('/api/requests',{kind:'booking_refund',target:booking.id,reason:'Nebegaliu dalyvauti.'},actors.member);assert.equal(r.status,200);
  const request=app.db.prepare("SELECT * FROM requests WHERE target=?").get(booking.id);
  assert.equal((await call('/api/admin/request',{requestId:request.id,action:'refund',amount:999999},actors.admin)).status,400);
  assert.equal((await call('/api/admin/request',{requestId:request.id,action:'refund',amount:2250},actors.admin)).status,200);
  assert.equal(app.db.prepare('SELECT status FROM bookings WHERE id=?').get(booking.id).status,'refunded');
  await call('/api/membership/cancel',{},actors.member);
  assert.equal((await call('/api/me',undefined,actors.member)).data.membership.cancel_end,1);
  const email='applicant@example.test';
  r=await call('/api/register',{name:'Test applicant',email,password:'correct horse battery staple',adultMale:true,privacy:true,role:'admin'},actors.second);assert.equal(r.status,200);
  const verification=new URL(r.data.demoLink).searchParams.get('verify');
  assert.equal((await call('/api/verify',{token:verification},actors.second)).status,200);
  assert.equal((await call('/api/verify',{token:verification},actors.second)).status,400);
  await call('/api/login',{email,password:'correct horse battery staple'},actors.second);
  assert.equal((await call('/api/me',undefined,actors.second)).data.user.role,'member','registration cannot escalate a role');
  r=await call('/api/apply',{plan:'support',cycle:'year',support:'student',motivation:'Noriu prisijungti prie veiklų.',adultMale:true},actors.second);assert.equal(r.status,200);
  assert.equal((await call('/api/checkout',{kind:'membership',terms:true},actors.second)).status,403);
  const secondId=(await call('/api/me',undefined,actors.second)).data.user.id;
  await call('/api/admin/application',{userId:secondId,status:'accepted'},actors.admin);
  r=await call('/api/checkout',{kind:'membership',terms:true},actors.second);
  assert.equal(r.data.amount,15000,'accepted student annual price comes from the server plan');
  await call('/api/demo-pay',{orderId:r.data.orderId},actors.second);
  assert.equal((await call('/api/me',undefined,actors.second)).data.membership.cycle,'year');
  assert.equal((await call('/api/profile',{name:'Forged'},actors.second,{Origin:'https://attacker.test'})).status,403);
  assert.equal((await call('/api/profile',{name:'Forged'},actors.second,{'X-CSRF-Token':'wrong'})).status,403);
  r=await call('/api/newsletter',{name:'Reader',email:'reader@example.test',consent:true});assert.equal(r.status,200);
  const confirmation=new URL(r.data.demoLink).searchParams.get('confirm');
  assert.equal(app.db.prepare('SELECT status FROM subscribers WHERE email=?').get('reader@example.test').status,'pending');
  await call('/api/newsletter/confirm',{token:confirmation});
  assert.equal(app.db.prepare('SELECT status FROM subscribers WHERE email=?').get('reader@example.test').status,'active');
  await call('/api/newsletter/unsubscribe',{token:confirmation});
  assert.equal(app.db.prepare('SELECT status FROM subscribers WHERE email=?').get('reader@example.test').status,'unsubscribed');
  await call('/api/admin/instructor',{id:'field',name:'Edited placeholder',specialty:'Outdoor',bio:'Test profile',placeholder:true},actors.admin);
  await new Promise(resolve=>app.server.close(resolve));
  app=await createApp({demo:true,dbPath,baseUrl:origin});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));target='http://127.0.0.1:'+app.server.address().port;
  assert.equal((await call('/api/me',undefined,actors.member)).data.membership.cancel_end,1,'membership persists after restart');
  assert.equal((await call('/api/config')).data.instructors.find(i=>i.id==='field').name,'Edited placeholder','admin edits persist after restart');
  assert.equal((await fetch(target+'/.env')).status,404);
  assert.equal((await fetch(target+'/server/server.mjs')).status,404);
 }finally{await new Promise(resolve=>app.server.close(resolve));await rm(directory,{recursive:true,force:true});}
});

test('capacity and free benefit cannot be overbooked',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'astra-capacity-')),origin='http://127.0.0.1:4176';
 const app=await createApp({demo:true,dbPath:join(directory,'test.sqlite'),baseUrl:origin});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const target='http://127.0.0.1:'+app.server.address().port;
 const request=async(route,body,actor={})=>{
  const r=await fetch(target+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:actor.cookie||'','X-CSRF-Token':actor.csrf||''},body:JSON.stringify(body)});
  if(r.headers.get('set-cookie'))actor.cookie=r.headers.get('set-cookie').split(';')[0];
  const data=await r.json();if(data.csrf)actor.csrf=data.csrf;return {status:r.status,data};
 };
 try{
  const member={};const login=await request('/api/demo-login',{role:'member'},member);
  const event={id:'one-seat',title:'Capacity test',date:new Date(Date.now()+86400000).toISOString(),place:'Test',description:'Test',price:0,capacity:1,category:'intro',instructor:'field',published:true};
  app.db.prepare('INSERT INTO events VALUES(?,?)').run(event.id,JSON.stringify(event));
  const user=login.data.user;
  const r=await request('/api/checkout',{kind:'event',eventId:event.id,terms:true},member);assert.equal(r.status,200);assert.equal(r.data.free,true);
  const admin={};await request('/api/demo-login',{role:'admin'},admin);
  assert.equal((await request('/api/checkout',{kind:'event',eventId:event.id,terms:true},admin)).status,400);
  app.db.prepare("INSERT INTO memberships(user_id,plan,cycle,status,until,started) VALUES(?,?,?,'active',?,?)").run(user.id,'practice','month',Date.now()+30*86400000,Date.now());
  for(const eventId of ['hike-one','hike-two']){
   app.db.prepare('INSERT INTO events VALUES(?,?)').run(eventId,JSON.stringify({...event,id:eventId,price:2500,capacity:10,category:'hike'}));
  }
  assert.equal((await request('/api/checkout',{kind:'event',eventId:'hike-one',terms:true},member)).data.free,true);
  assert.equal((await request('/api/checkout',{kind:'event',eventId:'hike-two',terms:true},member)).data.amount,2000,'second monthly hike gets discount, not a second free place');
 }finally{await new Promise(resolve=>app.server.close(resolve));await rm(directory,{recursive:true,force:true});}
});

test('webhook authentication rejects forged and stale signatures',()=>{
 const secret='test-secret',raw=Buffer.from('{"id":"evt_test"}'),timestamp=Math.floor(Date.now()/1000);
 const signature=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex');
 assert.equal(verifyWebhook(raw,'t='+timestamp+',v1='+signature,secret),true);
 assert.equal(verifyWebhook(Buffer.from('altered'),'t='+timestamp+',v1='+signature,secret),false);
 assert.equal(verifyWebhook(raw,'t='+timestamp+',v1=00',secret),false);
 assert.equal(verifyWebhook(raw,'t='+timestamp+',v1='+signature,secret,Date.now()+600000),false);
});

test('signed payment notifications enforce amount and are idempotent',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'astra-webhook-')),origin='http://127.0.0.1:4177';
 const secret='local-test-webhook-secret',previous=process.env.STRIPE_WEBHOOK_SECRET;
 process.env.STRIPE_WEBHOOK_SECRET=secret;
 const app=await createApp({demo:true,dbPath:join(directory,'test.sqlite'),baseUrl:origin});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const target='http://127.0.0.1:'+app.server.address().port;
 try{
  const user=app.db.prepare("SELECT * FROM users WHERE email='member@example.test'").get();
  const created=Date.now(),booking='test-booking',order='test-order';
  app.db.prepare('INSERT INTO bookings(id,user_id,event_id,status,price,created,expires) VALUES(?,?,?,?,?,?,?)').run(booking,user.id,'hike','pending',2500,created,created+1800000);
  app.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)').run(order,user.id,'event',booking,2500,'pending','cs_test',null,created,created+1800000);
  const post=async(event,signature=true)=>{
   const raw=JSON.stringify(event),t=Math.floor(Date.now()/1000);
   const sig=createHmac('sha256',secret).update(t+'.'+raw).digest('hex');
   const response=await fetch(target+'/api/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':signature?'t='+t+',v1='+sig:'t='+t+',v1=00'},body:raw});
   return response.status;
  };
  const event={id:'evt_good',created:Math.floor(Date.now()/1000),type:'checkout.session.completed',data:{object:{id:'cs_test',mode:'payment',payment_status:'paid',currency:'eur',amount_total:2500,payment_intent:'pi_test',metadata:{order_id:order}}}};
  assert.equal(await post(event,false),400);
  assert.equal(app.db.prepare('SELECT status FROM orders WHERE id=?').get(order).status,'pending');
  assert.equal(await post({...event,id:'evt_wrong_amount',data:{object:{...event.data.object,amount_total:1}}}),200);
  assert.equal(app.db.prepare('SELECT status FROM orders WHERE id=?').get(order).status,'pending');
  assert.equal(await post(event),200);
  assert.equal(app.db.prepare('SELECT status FROM bookings WHERE id=?').get(booking).status,'confirmed');
  assert.equal(await post(event),200);
  assert.equal(app.db.prepare("SELECT COUNT(*) count FROM webhook_events WHERE id='evt_good'").get().count,1);
  const adminUser=app.db.prepare("SELECT * FROM users WHERE email='admin@example.test'").get();
  const canceled=JSON.parse(app.db.prepare("SELECT payload FROM events WHERE id='hike'").get().payload);
  canceled.canceled=true;app.db.prepare("UPDATE events SET payload=? WHERE id='hike'").run(JSON.stringify(canceled));
  app.db.prepare('INSERT INTO bookings(id,user_id,event_id,status,price,created,expires) VALUES(?,?,?,?,?,?,?)').run('booking-late',adminUser.id,'hike','pending',2500,created,created+1800000);
  app.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)').run('order-late',adminUser.id,'event','booking-late',2500,'pending','cs_late',null,created,created+1800000);
  await post({...event,id:'evt_late',data:{object:{...event.data.object,id:'cs_late',payment_intent:'pi_late',metadata:{order_id:'order-late'}}}});
  assert.equal(app.db.prepare("SELECT status FROM bookings WHERE id='booking-late'").get().status,'refund_requested','payment after organizer cancellation creates a refund request');
 }finally{
  if(previous===undefined)delete process.env.STRIPE_WEBHOOK_SECRET;else process.env.STRIPE_WEBHOOK_SECRET=previous;
  await new Promise(resolve=>app.server.close(resolve));await rm(directory,{recursive:true,force:true});
 }
});
