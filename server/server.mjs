import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,randomUUID,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {openDb} from './db.mjs';
import {plans} from './config.mjs';
import {stripe,verifyWebhook} from './payments.mjs';
const scrypt=promisify(scryptCallback);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=s=>createHash('sha256').update(s).digest('hex');
const now=()=>Date.now();
const id=()=>randomUUID();
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const clean=(value,max=500)=>typeof value==='string'?value.trim().slice(0,max):'';
const email=value=>{const e=clean(value,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail('Įrašyk galiojantį el. paštą.');return e;};
async function passwordHash(password) {
  if(typeof password!=='string'||password.length<12||password.length>256) fail('Slaptažodis turi būti 12–256 simbolių.');
  const salt=randomBytes(16).toString('hex');
  return salt+':'+(await scrypt(password,salt,64)).toString('hex');
}
async function passwordValid(password,stored) {
  const [salt,key]=stored.split(':');
  if(!salt||!key||typeof password!=='string'||password.length>256) return false;
  const candidate=await scrypt(password,salt,64);
  const expected=Buffer.from(key,'hex');
  return candidate.length===expected.length&&timingSafeEqual(candidate,expected);
}
export async function createApp(options={}) {
 const mode=options.mode||(options.demo!==undefined?(options.demo?'demo':'production'):process.env.APP_MODE||(process.env.DEMO_MODE==='false'?'production':'demo'));
 if(!['demo','preview','production'].includes(mode))fail('APP_MODE must be demo, preview or production.');
 const demo=mode==='demo',preview=mode==='preview';
 const base=options.baseUrl||process.env.BASE_URL||'http://127.0.0.1:4173';
 if(!demo&&!base.startsWith('https://')) fail('Public BASE_URL must use HTTPS.');
 if(mode==='production'&&(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM))fail('Configure transactional email before public account registration.');
 if(!demo&&(options.database?.driver||process.env.DB_DRIVER||'sqlite')!=='mysql')fail('Public hosting requires DB_DRIVER=mysql; SQLite remains available for local work.');
 const db=await openDb(options.dbPath||process.env.DB_PATH||path.join(root,'data/astra.sqlite'),options.database);
 const query=(sql,...args)=>db.get(sql,...args);
 const all=(sql,...args)=>db.all(sql,...args);
 const run=(sql,...args)=>db.run(sql,...args);
 const transaction=fn=>db.transaction(fn);
 const audit=async (actor,action,target)=>(await run('INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)',actor,action,target,now()));
 const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,verified:!!u.verified});
 const entities=async table=>(await all('SELECT payload FROM '+table)).map(x=>JSON.parse(x.payload));
 const activeMembership=async u=>{
  const m=(await query('SELECT * FROM memberships WHERE user_id=?',u.id));
  return m&&m.status==='active'&&m.until>now()?m:null;
 };
 const canDemo=req=>{
  if(!demo||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return false;
  try{
   const host=new URL('http://'+req.headers.host).hostname;
   if(!['127.0.0.1','localhost','[::1]'].includes(host))return false;
   const forwarded=req.headers['x-forwarded-for'];
   return !forwarded||forwarded.split(',').every(ip=>['127.0.0.1','::1'].includes(ip.trim()));
  }catch{return false;}
 };
 async function queueMail(to,subject,body) {
  const mailId=id();(await run('INSERT INTO mail(id,email,subject,body,created) VALUES(?,?,?,?,?)',mailId,to,subject,body,now()));
  if(!demo&&process.env.RESEND_API_KEY&&process.env.EMAIL_FROM) {
   try{
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':mailId},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[to],subject,text:body}),signal:AbortSignal.timeout(15000)});
    (await run('UPDATE mail SET status=? WHERE id=?',r.ok?'sent':'failed',mailId));
   }catch{(await run('UPDATE mail SET status=? WHERE id=?','failed',mailId));}
  }
 }
 async function tokenLink(user,kind) {
  const token=randomBytes(32).toString('hex');
  (await run('INSERT INTO tokens VALUES(?,?,?,?,?)',hash(token),user.id,kind,user.email,now()+3600000));
  return base+'/prisijungti.html?'+kind+'='+token;
 }
 async function login(res,user) {
  const token=randomBytes(32).toString('hex');
  (await run('INSERT INTO sessions VALUES(?,?,?)',hash(token),user.id,now()+7*86400000));
  res.setHeader('Set-Cookie','astra='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800'+(!demo?'; Secure':''));
  return {user:publicUser(user),csrf:hash('csrf:'+token)};
 }
 const limits=new Map();
 function rate(req,key,max=15) {
  const k=req.socket.remoteAddress+':'+key,t=now(),entry=limits.get(k);
  const bucket=!entry||entry.until<t?{count:0,until:t+600000}:entry;
  bucket.count++;limits.set(k,bucket);
  if(bucket.count>max) fail('Per daug bandymų. Pabandyk po kelių minučių.',429);
  if(limits.size>10000) for(const [k,v] of limits) if(v.until<t) limits.delete(k);
 }
 if(!preview&&process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD&&!(await query('SELECT id FROM users WHERE email=?',process.env.ADMIN_EMAIL.toLowerCase()))){
  const key=await passwordHash(process.env.ADMIN_PASSWORD);
  (await run('INSERT INTO users VALUES(?,?,?,?,?,?,?)',id(),email(process.env.ADMIN_EMAIL),'Administratorius',key,'admin',1,now()));
 }
 if(demo) for(const [role,address,name] of [['admin','admin@example.test','Astra administratorius'],['member','member@example.test','Bandomasis narys']]){
  if(!(await query('SELECT id FROM users WHERE email=?',address))){
   const userId=id();(await run('INSERT INTO users VALUES(?,?,?,?,?,?,?)',userId,address,name,await passwordHash(randomBytes(32).toString('hex')),role,1,now()));
   if(role==='member')(await run('INSERT INTO applications(user_id,plan,cycle,motivation,created) VALUES(?,?,?,?,?)',userId,'community','month','Noriu prisijungti prie žygių ir bendruomenės.',now()));
  }
 }
 async function expireReservations(){
  if(!demo)return;
  (await run("UPDATE bookings SET status='expired' WHERE status='pending' AND expires<?",now()));
  (await run("UPDATE orders SET status='expired' WHERE status='pending' AND expires<?",now()));
 }
 function membershipDays(cycle){return cycle==='year'?365:30;}
 async function fulfill(order,payment,subscription,customer,until){
  if(order.status!=='pending') return;
  (await run("UPDATE orders SET status='paid',payment=? WHERE id=?",payment||null,order.id));
  if(order.kind==='membership'){
   const target=JSON.parse(order.target);
   (await run(`INSERT INTO memberships(user_id,plan,cycle,status,until,subscription,customer,started) VALUES(?,?,?,'active',?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan,cycle=excluded.cycle,status='active',until=excluded.until,subscription=excluded.subscription,customer=excluded.customer,cancel_end=0,started=excluded.started`,order.user_id,target.plan,target.cycle,until||now()+membershipDays(target.cycle)*86400000,subscription||null,customer||null,now()));
  }else{
   const booking=(await query('SELECT * FROM bookings WHERE id=?',order.target));
   const canceled=(await entities('events')).find(e=>e.id===booking.event_id)?.canceled;
   (await run('UPDATE bookings SET status=? WHERE id=?',canceled?'refund_requested':'confirmed',order.target));
   if(canceled)(await run('INSERT INTO requests(id,user_id,kind,target,reason,created) VALUES(?,?,?,?,?,?)',id(),order.user_id,'booking_refund',order.target,'Mokėjimas gautas po renginio atšaukimo. Visos sumos grąžinimas.',now()));
  }
 }
 async function webhook(raw,header) {
  if(!verifyWebhook(raw,header,process.env.STRIPE_WEBHOOK_SECRET)) fail('Invalid signature',400);
  const event=JSON.parse(raw.toString('utf8'));
  if((await query('SELECT id FROM webhook_events WHERE id=?',event.id)))return;
  const object=event.data.object;
  let subscription,paymentIntent=object.payment_intent;
  const subscriptionId=object.subscription||object.parent?.subscription_details?.subscription;
  if(event.type==='checkout.session.completed'&&object.mode==='subscription'&&object.payment_status==='paid') subscription=await stripe('subscriptions/'+object.subscription,null,'GET');
  if(event.type==='invoice.paid'&&subscriptionId) subscription=await stripe('subscriptions/'+subscriptionId,null,'GET');
  if(event.type==='customer.subscription.updated')subscription=await stripe('subscriptions/'+object.id,null,'GET');
  const invoiceId=event.type==='invoice.paid'?object.id:subscription?.latest_invoice?.id||subscription?.latest_invoice;
  if(invoiceId&&(event.type==='invoice.paid'||event.type==='checkout.session.completed')){
   const payments=await stripe('invoice_payments?invoice='+encodeURIComponent(invoiceId)+'&status=paid',null,'GET');
   paymentIntent=payments.data.find(p=>p.payment?.type==='payment_intent')?.payment.payment_intent||paymentIntent;
  }
  (await transaction(async ()=>{
   if((await query('SELECT id FROM webhook_events WHERE id=?',event.id)))return;
   const end=s=>1000*(s.current_period_end||s.items?.data?.[0]?.current_period_end||0);
   if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
    const order=(await query('SELECT * FROM orders WHERE id=?',object.metadata?.order_id||''));
    if(order&&order.session===object.id&&order.status==='pending'&&object.payment_status==='paid'&&object.currency==='eur'&&object.amount_total===order.amount&&event.created*1000<=order.expires){
     (await fulfill(order,paymentIntent,object.subscription,object.customer,subscription?end(subscription):undefined));
    }
   }
   if(event.type==='invoice.paid'&&subscription){
    const membership=(await query('SELECT * FROM memberships WHERE subscription=?',subscription.id));
    if(membership){
     (await run('UPDATE memberships SET status=?,until=? WHERE subscription=?',subscription.status,end(subscription),subscription.id));
     if(paymentIntent&&!(await query('SELECT id FROM orders WHERE payment=?',paymentIntent)))(await run('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)','invoice-'+object.id,membership.user_id,'membership',JSON.stringify({plan:membership.plan,cycle:membership.cycle}),object.amount_paid,'paid',null,paymentIntent,object.created*1000,now()));
    }
   }
   if(event.type==='invoice.payment_failed'&&subscriptionId)(await run("UPDATE memberships SET status='past_due' WHERE subscription=?",subscriptionId));
   if(event.type==='customer.subscription.updated')(await run('UPDATE memberships SET status=?,until=?,cancel_end=? WHERE subscription=?',subscription.status,end(subscription),subscription.cancel_at_period_end?1:0,subscription.id));
   if(event.type==='customer.subscription.deleted')(await run("UPDATE memberships SET status='canceled',until=0 WHERE subscription=?",object.id));
   if(event.type==='checkout.session.expired'){
    const order=(await query('SELECT * FROM orders WHERE session=?',object.id));
    if(order?.status==='pending'){(await run("UPDATE orders SET status='expired' WHERE id=?",order.id));if(order.kind==='event')(await run("UPDATE bookings SET status='expired' WHERE id=?",order.target));}
   }
   if(event.type==='charge.refunded'){
    const order=(await query('SELECT * FROM orders WHERE payment=?',object.payment_intent||''));
    if(order&&object.amount_refunded>=order.amount){(await run("UPDATE orders SET status='refunded' WHERE id=?",order.id));if(order.kind==='event')(await run("UPDATE bookings SET status='refunded' WHERE id=?",order.target));}
   }
   (await run('INSERT INTO webhook_events VALUES(?,?)',event.id,now()));
  }));
 }
 async function api(req,res,url,raw) {
  const route=url.pathname,method=req.method;
  if(route==='/api/health'&&method==='GET'){
   await query('SELECT 1 healthy');return {ok:true,mode};
  }
  if(preview){
   if(method!=='GET'||!['/api/config','/api/events','/api/me'].includes(route))fail('Registracija dar neatidaryta.',503);
   if(route==='/api/me')return {user:null};
  }
  const cookie=/astra=([a-f0-9]{64})/.exec(req.headers.cookie||'')?.[1];
  const session=cookie?(await query('SELECT * FROM sessions WHERE token=? AND expires>?',hash(cookie),now())):null;
  const user=session?(await query('SELECT * FROM users WHERE id=?',session.user_id)):null;
  const auth=()=>{if(!user)fail('Pirmiausia prisijunk.',401);if(!user.verified)fail('Patvirtink savo el. paštą.',403);return user;};
  const admin=()=>{auth();if(user.role!=='admin')fail('Reikalinga administratoriaus prieiga.',403);};
  const json=()=>{try{return JSON.parse(raw.toString('utf8')||'{}');}catch{fail('Neteisinga užklausa.');}};
  if(route==='/api/webhook'&&method==='POST'){await webhook(raw,req.headers['stripe-signature']);return {received:true};}
  if(method!=='GET'){
   if(req.headers.origin!==base) fail('Užklausa iš kito puslapio neleidžiama.',403);
   if(!req.headers['content-type']?.startsWith('application/json')) fail('Reikalinga JSON užklausa.',415);
   if(user&&req.headers['x-csrf-token']!==hash('csrf:'+cookie))fail('Atnaujink puslapį ir bandyk dar kartą.',403);
  }
  if(route==='/api/config'&&method==='GET') return {plans,demo,preview,instructors:(await entities('instructors')),seller:{name:process.env.SELLER_NAME||'',address:process.env.SELLER_ADDRESS||'',code:process.env.SELLER_CODE||''}};
  if(route==='/api/events'&&method==='GET'){
   (await expireReservations());const result=[];
   for(const e of (await entities('events')).filter(e=>e.published))result.push({...e,available:Math.max(0,e.capacity-(await query("SELECT COUNT(*) count FROM bookings WHERE event_id=? AND status IN ('pending','confirmed','refund_requested')",e.id)).count)});
   return result;
  }
  if(route==='/api/me'&&method==='GET') return user?{user:publicUser(user),csrf:hash('csrf:'+cookie),application:(await query('SELECT * FROM applications WHERE user_id=?',user.id)),membership:(await query('SELECT * FROM memberships WHERE user_id=?',user.id)),bookings:(await all('SELECT * FROM bookings WHERE user_id=? ORDER BY created DESC',user.id)),badges:(await all('SELECT badge FROM badges WHERE user_id=?',user.id)),requests:(await all('SELECT * FROM requests WHERE user_id=?',user.id)),discord:(await activeMembership(user))?process.env.DISCORD_INVITE_URL||'':null}:{user:null};
  if(route==='/api/register'&&method==='POST'){
   rate(req,'register',10);const body=json(),address=email(body.email),name=clean(body.name,80);
   if(!name||body.adultMale!==true||body.privacy!==true)fail('Patvirtink 18+ vyrų dalyvavimo sąlygą ir privatumo informaciją.');
   const key=await passwordHash(body.password);
   if((await query('SELECT id FROM users WHERE email=?',address)))fail('Šis el. paštas jau naudojamas. Prisijunk arba atkurk slaptažodį.');
   const userId=id();(await run('INSERT INTO users VALUES(?,?,?,?,?,?,?)',userId,address,name,key,'member',0,now()));
   const verify=(await tokenLink({id:userId,email:address},'verify'));
   await queueMail(address,'Patvirtink Astra paskyrą',verify);
   return {message:'Patikrink el. paštą ir patvirtink paskyrą.',demoLink:canDemo(req)?verify:undefined};
  }
  if(route==='/api/verify'&&method==='POST'){
   rate(req,'verify',20);const token=(await query("SELECT * FROM tokens WHERE token=? AND kind='verify' AND expires>?",hash(clean(json().token,100)),now()));
   if(!token)fail('Nuoroda nebegalioja.');
   (await transaction(async ()=>{(await run('UPDATE users SET verified=1 WHERE id=?',token.user_id));(await run('DELETE FROM tokens WHERE token=?',token.token));}));
   return {message:'El. paštas patvirtintas. Gali prisijungti.'};
  }
  if(route==='/api/login'&&method==='POST'){
   rate(req,'login',20);const body=json(),u=(await query('SELECT * FROM users WHERE email=?',email(body.email)));
   if(!u||!await passwordValid(body.password,u.password))fail('Neteisingas el. paštas arba slaptažodis.',401);
   return (await login(res,u));
  }
  if(route==='/api/demo-login'&&method==='POST'){
   if(!canDemo(req))fail('Neprieinama.',404);
   const role=json().role==='admin'?'admin':'member';
   return (await login(res,(await query('SELECT * FROM users WHERE email=?',role+'@example.test'))));
  }
  if(route==='/api/logout'&&method==='POST'){
   if(session)(await run('DELETE FROM sessions WHERE token=?',session.token));
   res.setHeader('Set-Cookie','astra=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(!demo?'; Secure':''));
   return {ok:true};
  }
  if(route==='/api/password/request'&&method==='POST'){
   rate(req,'reset',5);const u=(await query('SELECT * FROM users WHERE email=?',email(json().email)));
   const link=u?(await tokenLink(u,'reset')):null;
   if(link)await queueMail(u.email,'Atkurk Astra slaptažodį',link);
   return {message:'Jei paskyra yra, atsiuntėme atkūrimo nuorodą.',demoLink:canDemo(req)?link:undefined};
  }
  if(route==='/api/password/reset'&&method==='POST'){
   rate(req,'reset-confirm',15);const body=json(),token=(await query("SELECT * FROM tokens WHERE token=? AND kind='reset' AND expires>?",hash(clean(body.token,100)),now()));
   if(!token)fail('Nuoroda nebegalioja.');
   const key=await passwordHash(body.password);
   (await transaction(async ()=>{(await run('UPDATE users SET password=? WHERE id=?',key,token.user_id));(await run('DELETE FROM sessions WHERE user_id=?',token.user_id));(await run('DELETE FROM tokens WHERE user_id=? AND kind=?',token.user_id,'reset'));}));
   return {message:'Slaptažodis pakeistas. Prisijunk iš naujo.'};
  }
  if(route==='/api/profile'&&method==='POST'){
   auth();const name=clean(json().name,80);if(!name)fail('Įrašyk vardą.');(await run('UPDATE users SET name=? WHERE id=?',name,user.id));return {ok:true};
  }
  if(route==='/api/apply'&&method==='POST'){
   auth();const body=json(),plan=plans.find(p=>p.id===body.plan);
   if(!plan||!['month','year'].includes(body.cycle)||clean(body.motivation).length<10||body.adultMale!==true)fail('Pasirink narystę ir trumpai papasakok, kodėl nori prisijungti.');
   if((await query('SELECT user_id FROM applications WHERE user_id=?',user.id)))fail('Paraiška jau pateikta. Jos būseną rasi paskyroje.');
   if(plan.id==='support'&&!['student','budget'].includes(body.support))fail('Pasirink Atramos narystės pagrindą.');
   (await run('INSERT INTO applications(user_id,plan,cycle,motivation,support,created) VALUES(?,?,?,?,?,?)',user.id,plan.id,body.cycle,clean(body.motivation),plan.id==='support'?body.support:'',now()));
   await queueMail(user.email,'Gavome tavo paraišką','Paraiškos būseną rasi savo paskyroje: '+base+'/paskyra.html');
   return {message:'Paraiška pateikta. Sprendimą rasi savo paskyroje.'};
  }
  if(route==='/api/newsletter'&&method==='POST'){
   rate(req,'newsletter',8);const body=json(),address=email(body.email);
   if(body.consent!==true)fail('Pažymėk, kad nori gauti laiškus.');
   const existing=(await query('SELECT * FROM subscribers WHERE email=?',address));
   if(existing?.status==='active')return {message:'Šiuo adresu naujienlaiškis jau užsakytas.'};
   const token=randomBytes(32).toString('hex');
   (await run("INSERT INTO subscribers VALUES(?,?,'pending',?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,status='pending',consent=excluded.consent,token=excluded.token,created=excluded.created",address,clean(body.name,80),now(),hash(token),now()));
   const link=base+'/naujienlaiskis.html?confirm='+token;
   await queueMail(address,'Patvirtink Astra naujienlaiškį',link);
   return {message:canDemo(req)?'Demonstracijoje patvirtink prenumeratą žemiau esančia nuoroda. Laiškas nesiunčiamas.':'Patvirtinimo nuorodos ieškok savo el. pašte.',demoLink:canDemo(req)?link:undefined};
  }
  if(route==='/api/newsletter/confirm'&&method==='POST'){
   const subscriber=(await query("SELECT * FROM subscribers WHERE token=? AND status='pending' AND created>?",hash(clean(json().token,100)),now()-86400000));
   if(!subscriber)fail('Patvirtinimo nuoroda nebegalioja.');
   (await run("UPDATE subscribers SET status='active' WHERE email=?",subscriber.email));return {message:'Prenumerata patvirtinta.'};
  }
  if(route==='/api/newsletter/unsubscribe'&&method==='POST'){
   const subscriber=(await query('SELECT * FROM subscribers WHERE token=?',hash(clean(json().token,100))));
   if(!subscriber)fail('Nuoroda nebegalioja.');
   (await run("UPDATE subscribers SET status='unsubscribed' WHERE email=?",subscriber.email));return {message:'Prenumerata nutraukta.'};
  }
  if(route==='/api/checkout'&&method==='POST'){
   auth();(await expireReservations());const body=json();
   if(body.terms!==true)fail('Patvirtink dalyvavimo ir atsiskaitymo sąlygas.');
   if(!demo&&(!process.env.STRIPE_SECRET_KEY||!process.env.STRIPE_WEBHOOK_SECRET||!process.env.RESEND_API_KEY||!process.env.SELLER_NAME||!process.env.SELLER_ADDRESS||!process.env.SELLER_CODE||process.env.LIVE_PAYMENTS_ENABLED!=='true'))fail('Mokėjimai dar neatidaryti.',503);
   const orderId=id();let amount,target,kind=body.kind;
   (await transaction(async ()=>{
    if(kind==='membership'){
     const application=(await query('SELECT * FROM applications WHERE user_id=?',user.id));
     if(application?.status!=='accepted')fail('Narystę gali apmokėti tik gavęs priėmimą.',403);
     if((await activeMembership(user))||(await query("SELECT id FROM orders WHERE user_id=? AND kind='membership' AND status='pending'",user.id)))fail('Narystė jau aktyvi arba mokėjimas pradėtas.');
     const plan=plans.find(p=>p.id===application.plan);
     amount=application.cycle==='year'?plan.annual:plan.monthly;target=JSON.stringify({plan:plan.id,cycle:application.cycle});
    }else if(kind==='event'){
     const event=(await entities('events')).find(e=>e.id===body.eventId&&e.published);
     if(!event||event.canceled||new Date(event.date).getTime()<now())fail('Šio renginio registracija uždaryta.');
     if((await query("SELECT id FROM bookings WHERE user_id=? AND event_id=? AND status IN ('pending','confirmed','refund_requested')",user.id,event.id)))fail('Jau esi užsiregistravęs.');
     if((await query("SELECT COUNT(*) count FROM bookings WHERE event_id=? AND status IN ('pending','confirmed','refund_requested')",event.id)).count>=event.capacity)fail('Visos vietos užimtos.');
     const membership=(await activeMembership(user)),plan=membership?plans.find(p=>p.id===membership.plan):null;
     amount=event.price;let benefit='';
     const month=event.date.slice(0,7),benefitType=event.category==='community'?'community':event.category==='hike'&&plan?.id==='practice'?'hike':'';
     if(plan&&membership.until>=Date.parse(event.date)&&benefitType&&!(await query("SELECT id FROM bookings WHERE user_id=? AND benefit=? AND status IN ('confirmed','pending','refund_requested')",user.id,benefitType+':'+month))){
      amount=0;benefit=benefitType+':'+month;
     }else if(plan)amount=Math.round(amount*(100-plan.discount)/100);
     target=id();
     (await run('INSERT INTO bookings(id,user_id,event_id,status,price,benefit,created,expires) VALUES(?,?,?,?,?,?,?,?)',target,user.id,event.id,amount?'pending':'confirmed',amount,benefit,now(),now()+30*60000));
    }else fail('Nežinomas pirkinys.');
    (await run('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)',orderId,user.id,kind,target,amount,amount?'pending':'paid',null,null,now(),now()+30*60000));
   }));
   if(!amount)return {free:true,message:'Vieta patvirtinta.',url:'/paskyra.html'};
   if(demo)return {demo:true,orderId,amount,url:'/mokejimas.html?order='+orderId};
   let membership=(await query('SELECT * FROM memberships WHERE user_id=?',user.id)),customer=membership?.customer;
   try{
    if(!customer){
     const created=await stripe('customers',{email:user.email,name:user.name,'metadata[user_id]':user.id},'POST',undefined,'customer-'+user.id);
     customer=created.id;
     if(membership)(await run('UPDATE memberships SET customer=? WHERE user_id=?',customer,user.id));
    }
    const params={mode:kind==='membership'?'subscription':'payment',customer,'payment_method_types[0]':'card','line_items[0][price_data][currency]':'eur','line_items[0][price_data][unit_amount]':String(amount),'line_items[0][price_data][product_data][name]':kind==='membership'?plans.find(p=>p.id===JSON.parse(target).plan).name:(await entities('events')).find(e=>e.id===body.eventId).title,'line_items[0][quantity]':'1',success_url:base+'/paskyra.html?payment=processing',cancel_url:base+'/paskyra.html?payment=canceled','metadata[order_id]':orderId,expires_at:String(Math.floor((now()+30*60000)/1000))};
    if(kind==='membership'){params['line_items[0][price_data][recurring][interval]']=JSON.parse(target).cycle;params['subscription_data[metadata][user_id]']=user.id;}
    const checkout=await stripe('checkout/sessions',params,'POST',undefined,orderId);
    (await run('UPDATE orders SET session=? WHERE id=?',checkout.id,orderId));return {url:checkout.url};
   }catch(e){(await transaction(async ()=>{(await run("UPDATE orders SET status='failed' WHERE id=?",orderId));if(kind==='event')(await run("UPDATE bookings SET status='failed' WHERE id=?",target));}));throw e;}
  }
  if(route==='/api/order'&&method==='GET'){auth();const order=(await query('SELECT id,kind,amount,status,target FROM orders WHERE id=? AND user_id=?',url.searchParams.get('id'),user.id));if(!order)fail('Nerasta.',404);return order;}
  if(route==='/api/orders'&&method==='GET'){
   auth();(await expireReservations());return (await all("SELECT id,kind,amount,status FROM orders WHERE user_id=? AND status='pending'",user.id));
  }
  if(route==='/api/order/resume'&&method==='POST'){
   auth();const order=(await query("SELECT * FROM orders WHERE id=? AND user_id=? AND status='pending'",json().orderId,user.id));
   if(!order)fail('Užsakymas nebegalioja.');
   if(demo)return {url:'/mokejimas.html?order='+order.id};
   const session=await stripe('checkout/sessions/'+order.session,null,'GET');
   return {url:session.status==='open'?session.url:'/paskyra.html?payment=processing'};
  }
  if(route==='/api/order/cancel'&&method==='POST'){
   auth();const order=(await query("SELECT * FROM orders WHERE id=? AND user_id=? AND status='pending'",json().orderId,user.id));
   if(!order)fail('Užsakymas nebegalioja.');
   if(!demo&&order.session)await stripe('checkout/sessions/'+order.session+'/expire',{});
   (await transaction(async ()=>{(await run("UPDATE orders SET status='expired' WHERE id=?",order.id));if(order.kind==='event')(await run("UPDATE bookings SET status='expired' WHERE id=?",order.target));}));
   return {message:'Neapmokėtas užsakymas atšauktas.'};
  }
  if(route==='/api/demo-pay'&&method==='POST'){
   auth();if(!canDemo(req))fail('Neprieinama.',404);
   const order=(await query('SELECT * FROM orders WHERE id=? AND user_id=?',clean(json().orderId,100),user.id));
   if(!order||order.status!=='pending'||order.expires<now())fail('Užsakymas nebegalioja.');
   if(order.kind==='membership'&&(await query('SELECT status FROM applications WHERE user_id=?',user.id))?.status!=='accepted')fail('Paraiška nepriimta.',403);
   (await transaction(async ()=>(await fulfill(order,'demo-'+order.id))));return {message:'Demonstracinis mokėjimas atliktas. Pinigai nenuskaičiuoti.'};
  }
  if(route==='/api/membership/cancel'&&method==='POST'){
   auth();const m=(await activeMembership(user));if(!m)fail('Aktyvios narystės nėra.');
   if(!demo&&m.subscription)await stripe('subscriptions/'+m.subscription,{cancel_at_period_end:'true'});
   (await run('UPDATE memberships SET cancel_end=1 WHERE user_id=?',user.id));return {message:'Pratęsimas išjungtas. Narystė galios iki apmokėto laikotarpio pabaigos.'};
  }
  if(route==='/api/billing/portal'&&method==='POST'){
   auth();const m=(await query('SELECT * FROM memberships WHERE user_id=?',user.id));
   if(demo)return {url:'/paskyra.html?portal=demo'};
   if(!m?.customer)fail('Mokėjimų paskyros dar nėra.');
   const portal=await stripe('billing_portal/sessions',{customer:m.customer,return_url:base+'/paskyra.html'});return {url:portal.url};
  }
  if(route==='/api/requests'&&method==='POST'){
   auth();const body=json();
   if(!['booking_refund','membership_refund'].includes(body.kind))fail('Neteisinga užklausa.');
   let target=body.target;
   if(body.kind==='booking_refund'){
    const b=(await query("SELECT * FROM bookings WHERE id=? AND user_id=? AND status='confirmed'",target,user.id));
    if(!b)fail('Registracija nerasta.');
    (await run("UPDATE bookings SET status='refund_requested' WHERE id=?",b.id));
   }else{
    const m=(await query('SELECT * FROM memberships WHERE user_id=?',user.id));
    if(!m)fail('Narystė nerasta.');target=user.id;
   }
   if((await query("SELECT id FROM requests WHERE user_id=? AND kind=? AND target=? AND status='pending'",user.id,body.kind,target)))fail('Prašymas jau pateiktas.');
   (await run('INSERT INTO requests(id,user_id,kind,target,reason,created) VALUES(?,?,?,?,?,?)',id(),user.id,body.kind,target,clean(body.reason),now()));return {message:'Prašymas perduotas administratoriui.'};
  }
  if(route==='/api/admin'&&method==='GET'){
   admin();return {users:(await all('SELECT id,email,name,role,verified,created FROM users')),applications:(await all('SELECT a.*,u.name,u.email FROM applications a JOIN users u ON u.id=a.user_id')),memberships:(await all('SELECT * FROM memberships')),events:(await entities('events')),instructors:(await entities('instructors')),bookings:(await all('SELECT b.*,u.name,u.email FROM bookings b JOIN users u ON u.id=b.user_id')),subscribers:(await all('SELECT email,name,status,consent,created FROM subscribers')),requests:(await all('SELECT r.*,u.name FROM requests r JOIN users u ON u.id=r.user_id')),mail:demo?(await all('SELECT * FROM mail ORDER BY created DESC LIMIT 50')):(await all('SELECT id,email,subject,status,created FROM mail ORDER BY created DESC LIMIT 50'))};
  }
  if(route==='/api/admin/application'&&method==='POST'){
   admin();const body=json();if(!['accepted','declined'].includes(body.status))fail('Neteisinga būsena.');
   if(!(await query('SELECT user_id FROM applications WHERE user_id=?',body.userId)))fail('Paraiška nerasta.');
   (await run('UPDATE applications SET status=? WHERE user_id=?',body.status,body.userId));(await audit(user.id,'application:'+body.status,body.userId));
   const recipient=(await query('SELECT email FROM users WHERE id=?',body.userId));
   await queueMail(recipient.email,body.status==='accepted'?'Kviečiame prisijungti prie Astra':'Astra paraiškos atsakymas',body.status==='accepted'?'Tavo paraiška priimta. Narystę gali aktyvuoti paskyroje: '+base+'/paskyra.html':'Paraiška šiuo metu nepriimta. Jei nori pasikalbėti, parašyk info@astra-academy.net.');
   return {ok:true};
  }
  if(route==='/api/admin/subscriber'&&method==='POST'){
   admin();const address=email(json().email);
   (await run("UPDATE subscribers SET status='unsubscribed' WHERE email=?",address));
   (await audit(user.id,'newsletter:unsubscribe',address));return {ok:true};
  }
  if(route==='/api/admin/event'&&method==='POST'){
   return transaction(async()=>{
   admin();const b=json(),previous=(await entities('events')).find(e=>e.id===b.id);
   if(!/^[a-z0-9-]{1,50}$/.test(b.id)||!clean(b.title,100)||!Number.isSafeInteger(b.price)||b.price<0||!Number.isSafeInteger(b.capacity)||b.capacity<1||b.capacity>1000||!Number.isFinite(Date.parse(b.date))||!['hike','seminar','community','intro','camp'].includes(b.category))fail('Patikrink renginio laukus.');
   const count=(await query("SELECT COUNT(*) count FROM bookings WHERE event_id=? AND status IN ('confirmed','pending','refund_requested')",b.id)).count;
   if(b.capacity<count)fail('Talpa mažesnė už esamų registracijų skaičių.');
   if(count&&previous&&(b.date!==previous.date||b.price!==previous.price))fail('Renginio data ir kaina nekeičiama, kai yra registracijų. Atšauk renginį ir sukurk naują.');
   const event={id:b.id,title:clean(b.title,100),description:clean(b.description,1000),date:b.date,place:clean(b.place,150),price:b.price,capacity:b.capacity,category:b.category,instructor:clean(b.instructor,50),published:!!b.published,prototype:!!b.prototype,canceled:previous?.canceled||false};
   (await run('INSERT INTO events VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',event.id,JSON.stringify(event)));(await audit(user.id,'event:save',event.id));return {ok:true};
   });
  }
  if(route==='/api/admin/event/cancel'&&method==='POST'){
   return transaction(async()=>{
   admin();const event=(await entities('events')).find(e=>e.id===json().eventId);if(!event)fail('Nerasta.');
   event.canceled=true;(await run('UPDATE events SET payload=? WHERE id=?',JSON.stringify(event),event.id));
   for(const b of (await all("SELECT * FROM bookings WHERE event_id=? AND status='confirmed'",event.id))){
    (await run("UPDATE bookings SET status='refund_requested' WHERE id=?",b.id));
    if(!(await query("SELECT id FROM requests WHERE target=? AND kind='booking_refund' AND status='pending'",b.id)))(await run('INSERT INTO requests(id,user_id,kind,target,reason,created) VALUES(?,?,?,?,?,?)',id(),b.user_id,'booking_refund',b.id,'Renginį atšaukė organizatorius. Visos sumos grąžinimas.',now()));
   }(await audit(user.id,'event:cancel',event.id));return {message:'Renginys atšauktas. Grąžinimo prašymai sukurti.'};
   });
  }
  if(route==='/api/admin/instructor'&&method==='POST'){
   admin();const b=json();if(!/^[a-z0-9-]{1,50}$/.test(b.id)||!clean(b.name,80))fail('Patikrink profilį.');
   const instructor={id:b.id,name:clean(b.name,80),specialty:clean(b.specialty,100),bio:clean(b.bio,1000),placeholder:!!b.placeholder};
   (await run('INSERT INTO instructors VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',b.id,JSON.stringify(instructor)));(await audit(user.id,'instructor:save',b.id));return {ok:true};
  }
  if(route==='/api/admin/attendance'&&method==='POST'){
   return transaction(async()=>{
   admin();const b=json(),booking=(await query("SELECT * FROM bookings WHERE id=? AND status='confirmed'",b.bookingId));if(!booking)fail('Patvirtinta registracija nerasta.');
   const event=(await entities('events')).find(e=>e.id===booking.event_id);
   if(!demo&&Date.parse(event.date)>now())fail('Renginys dar neįvyko.');
   (await run('UPDATE bookings SET attended=? WHERE id=?',b.attended?1:0,booking.id));
   const count=(await query("SELECT COUNT(*) count FROM bookings WHERE user_id=? AND attended=1 AND status='confirmed'",booking.user_id)).count;
   (await run("DELETE FROM badges WHERE user_id=? AND badge IN ('Pirmasis žingsnis','Trys susitikimai')",booking.user_id));
   if(count>=1)(await run('INSERT OR IGNORE INTO badges VALUES(?,?,?)',booking.user_id,'Pirmasis žingsnis',now()));
   if(count>=3)(await run('INSERT OR IGNORE INTO badges VALUES(?,?,?)',booking.user_id,'Trys susitikimai',now()));
   (await audit(user.id,'attendance',booking.id));return {ok:true};
   });
  }
  if(route==='/api/admin/request'&&method==='POST'){
   admin();const body=json(),request=(await query("SELECT * FROM requests WHERE id=? AND status='pending'",body.requestId));if(!request)fail('Prašymas nerastas.');
   if(body.action==='decline'){
    (await run("UPDATE requests SET status='declined' WHERE id=?",request.id));
    if(request.kind==='booking_refund')(await run("UPDATE bookings SET status='confirmed' WHERE id=?",request.target));
   }else if(body.action==='refund'){
    const order=request.kind==='booking_refund'?(await query("SELECT * FROM orders WHERE target=? AND status='paid'",request.target)):(await query("SELECT * FROM orders WHERE user_id=? AND kind='membership' AND status='paid' ORDER BY created DESC LIMIT 1",request.user_id));
    if(!order)fail('Apmokėtas užsakymas nerastas.');
    const amount=body.amount;
    if(!Number.isSafeInteger(amount)||amount<0||amount>order.amount)fail('Patikrink grąžinamą sumą centais.');
    const m=request.kind==='membership_refund'?(await query('SELECT * FROM memberships WHERE user_id=?',request.user_id)):null;
    if(!demo&&amount&&!order.payment)fail('Mokėjimo identifikatorius dar nepatvirtintas. Patikrink Stripe webhook įrašus prieš grąžindamas.');
    if(!demo&&amount)await stripe('refunds',{payment_intent:order.payment,amount:String(amount)},'POST',undefined,'refund-'+request.id);
    if(!demo&&m?.subscription)await stripe('subscriptions/'+m.subscription,null,'DELETE');
    (await transaction(async ()=>{
     (await run("UPDATE requests SET status='refunded' WHERE id=?",request.id));
     (await run('UPDATE orders SET status=? WHERE id=?',amount===order.amount?'refunded':'partially_refunded',order.id));
     if(request.kind==='booking_refund')(await run("UPDATE bookings SET status='refunded' WHERE id=?",request.target));
     else (await run("UPDATE memberships SET status='canceled',until=0 WHERE user_id=?",request.user_id));
    }));
   }else fail('Neteisingas veiksmas.');
   (await audit(user.id,'request:'+body.action,request.id));return {ok:true};
  }
  fail('Nerasta.',404);
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
  res.setHeader('X-Frame-Options','DENY');
  try{
   if(demo&&!canDemo(req))fail('Demo is local only.',403);
   const url=new URL(req.url,base);
   if(url.pathname.startsWith('/api/')){
    res.setHeader('Cache-Control','no-store');
    let raw=Buffer.alloc(0);for await(const chunk of req){raw=Buffer.concat([raw,chunk]);if(raw.length>65536)fail('Užklausa per didelė.',413);}
    const result=await api(req,res,url,raw);
    res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(result));
   }else{
    if(!['GET','HEAD'].includes(req.method))fail('Metodas neleidžiamas.',405);
    const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    if(!(/^\/[a-z0-9-]+\.(html|css|js)$/.test(pathname)||/^\/assets\/[a-z0-9-]+\.(png|webp|jpg|svg)$/.test(pathname)))fail('Nerasta.',404);
    const file=path.join(root,pathname.slice(1)),body=await readFile(file);
    const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml'};
    res.setHeader('Content-Type',types[path.extname(file)]);res.end(req.method==='HEAD'?undefined:body);
   }
  }catch(e){res.statusCode=e.status||500;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({error:e.status?e.message:'Užklausa nepavyko. Bandyk dar kartą.'}));if(!e.status)console.error(e.message);}
 });
 const close=async()=>{if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await db.close();};
 // Existing local test callers close the HTTP server directly.
 if(db.driver==='sqlite')server.on('close',()=>db.close());
 return {server,db,mode,close};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const app=await createApp(),demo=app.mode==='demo';
 const host=process.env.HOST||(demo?'127.0.0.1':'0.0.0.0');
 if(demo&&host!=='127.0.0.1'&&host!=='::1')throw new Error('Demo mode must bind to loopback.');
 app.server.listen(Number(process.env.PORT||4173),host,()=>console.log('Astra preview: '+(process.env.BASE_URL||'http://127.0.0.1:4173')));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0),()=>process.exit(1)));
}
