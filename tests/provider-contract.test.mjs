import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {createApp} from './support/app.mjs';

test('production checkout uses provider expiry and cancellation cannot overwrite payment',{skip:process.env.ASTRA_TEST_MYSQL!=='true'},async t=>{
 const originalFetch=globalThis.fetch,oldEnv={...process.env};
 Object.assign(process.env,{RESEND_API_KEY:'test-only',EMAIL_FROM:'test@example.test',STRIPE_SECRET_KEY:'test-only',STRIPE_WEBHOOK_SECRET:'test-only-secret',SELLER_NAME:'Test',SELLER_ADDRESS:'Test',SELLER_CODE:'Test',LIVE_PAYMENTS_ENABLED:'true'});
 const folder=await mkdtemp(join(tmpdir(),'astra-provider-')),baseUrl='https://astra.example.test';
 const app=await createApp({mode:'production',baseUrl,dbPath:join(folder,'db'),sendMail:async()=>{}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port;
 t.after(async()=>{globalThis.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv);await app.close();await rm(folder,{recursive:true,force:true});});
 let checkoutParams,checkoutId=0,paidDuringCancel=false;
 globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(!url.startsWith('https://api.stripe.com/'))return originalFetch(input,init);
  if(url.endsWith('/customers'))return Response.json({id:'cus_contract'});
  if(url.endsWith('/checkout/sessions')){
   checkoutParams=new URLSearchParams(init.body);checkoutId++;
   return Response.json({id:'cs_contract_'+checkoutId,url:'https://checkout.stripe.com/test-only',expires_at:Number(checkoutParams.get('expires_at'))});
  }
  if(url.endsWith('/expire')){
   if(paidDuringCancel){const order=await app.db.get("SELECT * FROM orders WHERE session='cs_contract_2'");await app.db.transaction(async()=>{await app.db.run("UPDATE orders SET status='paid' WHERE id=?",order.id);await app.db.run("UPDATE bookings SET status='confirmed' WHERE id=?",order.target);});}
   return Response.json({status:'expired'});
  }
  throw Error('Unexpected provider request '+url);
 };
 let cookie='',csrf='';
 const call=async(route,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Origin:baseUrl,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();if(data.csrf)csrf=data.csrf;return {status:r.status,data};};
 await call('/api/register',{name:'Test',email:'provider@example.test',password:'test-only long passphrase',adultMale:true,privacy:true});
 await app.db.run("UPDATE users SET verified=1 WHERE email='provider@example.test'");
 await call('/api/login',{email:'provider@example.test',password:'test-only long passphrase'});
 for(const id of ['hike','strategy']){const e=JSON.parse((await app.db.get('SELECT payload FROM events WHERE id=?',id)).payload);e.date='2099-01-01T10:00:00+02:00';await app.db.run('UPDATE events SET payload=? WHERE id=?',JSON.stringify(e),id);}
 assert.equal((await call('/api/checkout',{kind:'event',eventId:'hike',terms:true})).status,200);
 const order=await app.db.get("SELECT * FROM orders WHERE session='cs_contract_1'");
 assert.equal(order.expires,Number(checkoutParams.get('expires_at'))*1000);
 assert.equal((await app.db.get('SELECT expires FROM bookings WHERE id=?',order.target)).expires,order.expires);
 assert.ok(order.expires>Date.now()+30*60000);
 const event={id:'evt_contract',type:'checkout.session.completed',created:Math.floor((order.expires-1000)/1000),data:{object:{id:'cs_contract_1',metadata:{order_id:order.id},payment_status:'paid',payment_intent:'pi_contract',currency:'eur',amount_total:order.amount,mode:'payment'}}};
 const raw=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000),sig=createHmac('sha256','test-only-secret').update(timestamp+'.'+raw).digest('hex');
 assert.equal((await fetch(base+'/api/webhook',{method:'POST',headers:{'stripe-signature':`t=${timestamp},v1=${sig}`},body:raw})).status,200);
 assert.equal((await app.db.get('SELECT status FROM orders WHERE id=?',order.id)).status,'paid');
 assert.equal((await call('/api/checkout',{kind:'event',eventId:'strategy',terms:true})).status,200);
 const second=await app.db.get("SELECT * FROM orders WHERE session='cs_contract_2'");paidDuringCancel=true;
 assert.equal((await call('/api/order/cancel',{orderId:second.id})).status,400);
 assert.equal((await app.db.get('SELECT status FROM orders WHERE id=?',second.id)).status,'paid');
 assert.equal((await app.db.get('SELECT status FROM bookings WHERE id=?',second.target)).status,'confirmed');
});
