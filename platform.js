/* Page behavior remains plain JavaScript; forms use the same-origin Node API. */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>new Intl.NumberFormat('lt-LT',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(c/100);
const date=s=>new Intl.DateTimeFormat('lt-LT',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Vilnius'}).format(new Date(s));
const states={pending:'Laukiama',accepted:'Priimta',declined:'Nepriimta',active:'Aktyvi',inactive:'Neaktyvi',canceled:'Nutraukta',past_due:'Reikia atnaujinti mokėjimą',confirmed:'Patvirtinta',expired:'Pasibaigė',failed:'Nepavyko',refund_requested:'Prašoma grąžinimo',refunded:'Grąžinta',unsubscribed:'Atsisakyta',sent:'Išsiųsta',queued:'Eilėje',paid:'Apmokėta'};
const state=s=>states[s]||s;
let config,me={user:null},events=[];
async function api(url,body){
 const res=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-CSRF-Token':me.csrf||''}:{},body:body?JSON.stringify(body):undefined});
 const data=await res.json();
 if(!res.ok)throw new Error(data.error||'Nepavyko. Bandyk dar kartą.');
 return data;
}
function showStatus(message,error=false,element=$('#status')){
 if(!element)return; element.textContent=message;element.classList.toggle('error',error);
}
function result(form,data){
 const element=form.querySelector('.form-status')||$('#status');
 showStatus(data.message||'Išsaugota.',false,element);
 if(data.demoLink&&element){
  const a=document.createElement('a');a.href=data.demoLink;a.textContent=' Atidaryti demonstracinę patvirtinimo nuorodą';element.append(a);
 }
}
function formData(form){
 const result=Object.fromEntries(new FormData(form));
 form.querySelectorAll('input[type=checkbox]').forEach(i=>result[i.name]=i.checked);
 return result;
}
function bindForm(selector,url,after,transform=x=>x){
 const form=$(selector);if(!form)return;
 form.addEventListener('submit',async e=>{
  e.preventDefault();const button=form.querySelector('button[type=submit],button');
  if(button)button.disabled=true;
  try{const data=await api(url,transform(formData(form)));result(form,data);if(after)await after(data,form);}
  catch(error){showStatus(error.message,true,form.querySelector('.form-status')||$('#status'));}
  finally{if(button)button.disabled=false;}
 });
}
function action(selector,callback){
 document.querySelectorAll(selector).forEach(button=>button.addEventListener('click',async()=>{
  button.disabled=true;
  try{await callback(button);}catch(e){showStatus(e.message,true);}
  finally{button.disabled=false;}
 }));
}
const planName=id=>config.plans.find(p=>p.id===id)?.name||id;
function eventCards(list){
 return list.map(e=>`<article class="event-card"><p class="event-state">${esc(e.canceled?'Atšauktas':date(e.date))}</p><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p><div class="event-meta"><span>${esc(e.place)}</span><span>${e.price?esc(money(e.price)):'Nemokamai'}</span></div><a class="button secondary event-action" href="renginys.html?id=${encodeURIComponent(e.id)}">Peržiūrėti renginį ↗</a></article>`).join('');
}
function renderPlans(){
 const container=$('#plan-list');if(!container)return;
 const cycle=$('input[name=cycle]:checked')?.value||'month';
 container.innerHTML=config.plans.map(p=>`<article class="plan-card ${p.id==='practice'?'featured':''}"><p class="tag">${p.id==='support'?'VIENODA VIETA BENDRUOMENĖJE':p.id==='practice'?'DAUGIAU PRAKTIKOS':'TAVO RATAS'}</p><h2>${esc(p.name)}</h2><p class="price">${esc(money(cycle==='year'?p.annual:p.monthly))}<small> / ${cycle==='year'?'metus':'mėn.'}</small></p>${cycle==='year'?`<p class="muted">${esc(money(Math.round(p.annual/12)))} per mėnesį, mokant už metus.</p>`:''}<ul>${p.features.map(f=>`<li>${esc(f)}</li>`).join('')}</ul><a class="button ${p.id==='practice'?'primary':'secondary'}" href="paraiska.html?plan=${p.id}&cycle=${cycle}">Pateikti paraišką ↗</a><small class="muted">Mokėjimas po priėmimo.</small></article>`).join('');
}
function requireLogin(container){
 if(me.user)return false;
 container.innerHTML='<div class="panel"><h2>Prisijunk prie savo paskyros.</h2><a class="button primary" href="prisijungti.html">Prisijungti</a> <a class="button secondary" href="registracija.html">Sukurti paskyrą</a></div>';
 return true;
}
function nextPage(){const n=new URLSearchParams(location.search).get('next');return ['paraiska.html','paskyra.html'].includes(n)||/^renginys\.html\?id=[a-z0-9-]+$/.test(n||'')?n:'paskyra.html';}
function checkoutButton(kind,eventId){
 return `<form class="checkout-form form-panel"><label class="check"><input name="terms" type="checkbox" required> Susipažinau su <a href="taisykles.html">dalyvavimo ir grąžinimo sąlygomis</a>${kind==='membership'?' ir suprantu, kad narystė bus automatiškai pratęsiama pagal pasirinktą periodą.':'.'}</label><button class="button primary" type="submit">${kind==='membership'?'Aktyvuoti narystę':'Registruotis'} ↗</button><p class="form-status" role="status"></p><input type="hidden" name="kind" value="${kind}">${eventId?`<input type="hidden" name="eventId" value="${esc(eventId)}">`:''}</form>`;
}
function bindCheckout(){
 document.querySelectorAll('.checkout-form').forEach(form=>form.addEventListener('submit',async e=>{
  e.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try{const data=await api('/api/checkout',formData(form));location.href=data.url;}
  catch(err){showStatus(err.message,true,form.querySelector('.form-status'));button.disabled=false;}
 }));
}
function eventDetail(){
 const container=$('#event-detail');if(!container)return;
 const event=events.find(e=>e.id===new URLSearchParams(location.search).get('id'));
 if(!event){container.innerHTML='<h1>Renginys nerastas.</h1>';return;}
 const instructor=config.instructors.find(i=>i.id===event.instructor);
 document.title=event.title+' — Astra Academy';
 container.innerHTML=`<div class="detail-layout"><div><p class="section-label">ASTRA RENGINYS</p><h1>${esc(event.title)}</h1><p class="hero-lead">${esc(event.description)}</p><div class="detail-meta"><div><strong>Kada</strong> · ${esc(date(event.date))}</div><div><strong>Kur</strong> · ${esc(event.place)}</div><div><strong>Grupė</strong> · iki ${event.capacity} dalyvių</div><div><strong>Vedėjas</strong> · <a class="notice-link" href="instruktorius.html?id=${encodeURIComponent(event.instructor)}">${esc(instructor?.name||'Bus paskelbtas')}</a></div></div><h2>Ką verta žinoti</h2><p>Skirta vyrams nuo 18 metų. Tiksli susitikimo vieta ir pasiruošimo informacija pateikiama prieš renginį. Kilus klausimų, parašyk info@astra-academy.net.</p><a class="text-link" href="taisykles.html">Atšaukimo sąlygos ↗</a></div><aside class="panel"><p class="tag">DALYVAVIMAS</p><p class="price">${event.price?esc(money(event.price)):'Nemokamai'}</p><p>${event.available} laisvų vietų</p><p class="muted">Aktyvios narystės privalumai pritaikomi registruojantis. Galutinę sumą matysi prieš mokėjimą.</p>${event.canceled?'<p>Renginys atšauktas.</p>':event.available===0?'<p>Visos vietos užimtos.</p>':me.user?checkoutButton('event',event.id):`<a class="button primary" href="prisijungti.html?next=renginys.html%3Fid%3D${encodeURIComponent(event.id)}">Prisijungti ir registruotis ↗</a><p class="muted">Narystė neprivaloma.</p>`}</aside></div>`;
 bindCheckout();
}
function instructorCards(){
 const list=$('#instructor-list');if(!list)return;
 list.innerHTML=config.instructors.map(i=>`<article class="instructor-card"><img src="assets/instructor-placeholder.svg" width="480" height="480" alt="Vieta instruktoriaus nuotraukai">${i.placeholder?'<span class="pill-tag">Profilio vieta</span>':''}<h2>${esc(i.name)}</h2><p class="tag">${esc(i.specialty)}</p><p>${esc(i.bio)}</p><a class="text-link" href="instruktorius.html?id=${encodeURIComponent(i.id)}">Peržiūrėti profilį ↗</a></article>`).join('');
}
function instructorDetail(){
 const container=$('#instructor-detail');if(!container)return;
 const i=config.instructors.find(i=>i.id===new URLSearchParams(location.search).get('id'));
 if(!i){container.innerHTML='<h1>Profilis nerastas.</h1>';return;}
 container.innerHTML=`<div class="profile-layout"><img src="assets/instructor-placeholder.svg" width="480" height="480" alt="Vieta instruktoriaus nuotraukai"><div><p class="section-label">${esc(i.specialty)}</p><h1>${esc(i.name)}</h1>${i.placeholder?'<p class="pill-tag">Prototipo profilis</p>':''}<p class="hero-lead">${esc(i.bio)}</p></div></div><section class="page-section"><h2>Šio vedėjo veiklos</h2><div class="event-grid">${eventCards(events.filter(e=>e.instructor===i.id))}</div></section>`;
}
async function account(){
 const container=$('#account-content');if(!container||requireLogin(container))return;
 if(!me.user.verified){container.innerHTML='<div class="panel"><p>Patvirtink el. paštą pagal registracijos laiške gautą nuorodą.</p></div>';return;}
 const a=me.application,m=me.membership,active=m?.status==='active'&&m.until>Date.now();
 const pending=await api('/api/orders');
 const chosenPlan=a?config.plans.find(p=>p.id===a.plan):null;
 const application=a?`<p>Paraiška: <strong>${esc(state(a.status))}</strong></p><p>${esc(planName(a.plan))} · ${a.cycle==='year'?'Metinis':'Mėnesinis'} apmokėjimas</p>${a.status==='accepted'&&!active?`<p class="price">${esc(money(a.cycle==='year'?chosenPlan.annual:chosenPlan.monthly))}<small> / ${a.cycle==='year'?'metus':'mėn.'}</small></p>${checkoutButton('membership')}`:''}`:'<p>Dar nepateikei narystės paraiškos.</p><a class="button primary" href="paraiska.html">Pateikti paraišką ↗</a>';
 container.innerHTML=`<div class="dashboard-actions"><p>Sveikas, <strong>${esc(me.user.name)}</strong>.</p><button class="button secondary" id="logout">Atsijungti</button>${me.user.role==='admin'?'<a class="button secondary" href="administravimas.html">Administravimas ↗</a>':''}</div><div class="dashboard-grid"><section class="panel"><h2>Tavo narystė</h2>${active?`<p>${esc(planName(m.plan))} · ${esc(state(m.status))}</p><p>Galioja iki ${esc(date(m.until))}</p><p class="muted">${m.cancel_end?'Pratęsimas išjungtas.':'Pratęsiama '+(m.cycle==='year'?'kas metus':'kas mėnesį')+'.'}</p><div class="dashboard-actions"><button class="button secondary" id="billing">Mokėjimai</button>${!m.cancel_end?'<button class="button secondary" id="cancel-membership">Išjungti pratęsimą</button>':''}</div><details><summary>Prašyti narystės grąžinimo</summary><form id="membership-refund-form"><label>Trumpa žinutė<textarea name="reason" maxlength="500" rows="3"></textarea></label><button class="button secondary">Pateikti prašymą</button><p class="form-status" role="status"></p></form></details>${me.discord?`<a class="text-link" href="${esc(me.discord)}" rel="noopener">Į Discord bendruomenę ↗</a>`:'<p class="muted">Discord kvietimą paskelbsime čia.</p>'}`:`${m?`<p>Narystė: ${esc(state(m.status))}</p>`:''}${application}`}</section><section class="panel"><h2>Tavo kelias</h2><div class="badges">${me.badges.length?me.badges.map(b=>`<div class="badge"><span aria-hidden="true">✦</span>${esc(b.badge)}</div>`).join(''):'<p>Pirmasis ženklelis — po pirmo dalyvavimo. Lankomumą patvirtina renginio vedėjas.</p>'}</div></section></div><section class="page-section"><h2>Tavo renginiai</h2>${me.bookings.length?me.bookings.map(b=>{const e=events.find(e=>e.id===b.event_id);return `<div class="booking-row"><h3>${esc(e?.title||b.event_id)}</h3><small>${esc(e?date(e.date):'')} · ${esc(state(b.status))} · ${esc(money(b.price))}${b.attended?' · Dalyvauta':''}</small>${b.status==='confirmed'?`<button class="button secondary" data-refund-booking="${b.id}">Prašyti atšaukimo / grąžinimo</button>`:''}</div>`;}).join(''):'<p>Dar nėra registracijų. <a class="text-link" href="renginiai.html">Rask savo renginį ↗</a></p>'}</section><section class="page-section"><h2>Tavo profilis</h2><form id="profile-form" class="form-panel"><label>Vardas<input name="name" value="${esc(me.user.name)}" maxlength="80" required></label><p class="muted">${esc(me.user.email)} · Profilis matomas tik tau ir administratoriams.</p><button class="button secondary">Išsaugoti</button><p class="form-status" role="status"></p></form></section>${me.requests.length?`<section class="page-section"><h2>Prašymai</h2>${me.requests.map(r=>`<p>${esc(r.kind==='membership_refund'?'Narystės grąžinimas':'Renginio grąžinimas')} · ${esc(state(r.status))}</p>`).join('')}</section>`:''}`;
 bindCheckout();
 if(pending.length){
  const box=document.createElement('div');box.className='panel';
  box.innerHTML='<h2>Nebaigti mokėjimai</h2>'+pending.map(o=>`<p>${esc(o.kind==='membership'?'Narystė':'Renginio bilietas')} · ${esc(money(o.amount))}</p><div class="dashboard-actions"><button class="button primary" data-resume-order="${o.id}">Tęsti mokėjimą</button><button class="button secondary" data-cancel-order="${o.id}">Atšaukti užsakymą</button></div>`).join('');
  container.prepend(box);
  action('[data-resume-order]',async b=>{location.href=(await api('/api/order/resume',{orderId:b.dataset.resumeOrder})).url;});
  action('[data-cancel-order]',async b=>{const data=await api('/api/order/cancel',{orderId:b.dataset.cancelOrder});showStatus(data.message);me=await api('/api/me');await account();});
 }
 bindForm('#profile-form','/api/profile',async()=>{me=await api('/api/me');});
 bindForm('#membership-refund-form','/api/requests',undefined,body=>({...body,kind:'membership_refund',target:me.user.id}));
 action('#logout',async()=>{await api('/api/logout',{});location.href='prisijungti.html';});
 action('#billing',async()=>{const data=await api('/api/billing/portal',{});if(config.demo)showStatus('Demonstracijoje gali išjungti pratęsimą čia. Tikri mokėjimai bus valdomi Stripe portale.');else location.href=data.url;});
 action('#cancel-membership',async()=>{if(!confirm('Išjungti automatinį narystės pratęsimą? Narystė liks aktyvi iki apmokėto laikotarpio pabaigos.'))return;const data=await api('/api/membership/cancel',{});showStatus(data.message);me=await api('/api/me');await account();});
 action('[data-refund-booking]',async button=>{const reason=prompt('Trumpai parašyk dėl atšaukimo ar grąžinimo:');if(reason===null)return;const data=await api('/api/requests',{kind:'booking_refund',target:button.dataset.refundBooking,reason});showStatus(data.message);me=await api('/api/me');await account();});
}
function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>'<th>'+esc(h)+'</th>').join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;}
async function admin(){
 const container=$('#admin-content');if(!container||requireLogin(container))return;
 if(me.user.role!=='admin'){container.innerHTML='<p>Šiam puslapiui reikia administratoriaus prieigos.</p>';return;}
 const data=await api('/api/admin');
 const applications=table(['Narys','Narystė','Prisistatymas','Sprendimas'],data.applications.map(a=>`<tr><td>${esc(a.name)}<br>${esc(a.email)}</td><td>${esc(planName(a.plan))}<br>${a.cycle==='year'?'Metinė':'Mėnesinė'}${a.support?'<br>'+esc(a.support==='student'?'Studentas':'Ribotas biudžetas'):''}</td><td>${esc(a.motivation)}</td><td>${esc(state(a.status))}${a.status==='pending'?`<br><button class="button primary" data-accept="${a.user_id}">Priimti</button><button class="button secondary" data-decline="${a.user_id}">Nepriimti</button>`:''}</td></tr>`));
 const members=table(['Vardas','Kontaktas','Narystė'],data.users.map(u=>{const m=data.memberships.find(m=>m.user_id===u.id);return `<tr><td>${esc(u.name)}<br>${esc(u.role)}</td><td>${esc(u.email)}</td><td>${m?esc(planName(m.plan))+' · '+esc(state(m.status)):'Be narystės'}</td></tr>`;}));
 const bookings=table(['Renginys','Dalyvis','Būsena','Lankomumas'],data.bookings.map(b=>`<tr><td>${esc(data.events.find(e=>e.id===b.event_id)?.title||b.event_id)}</td><td>${esc(b.name)}<br>${esc(b.email)}</td><td>${esc(state(b.status))}<br>${esc(money(b.price))}</td><td>${b.status==='confirmed'?`<button class="button secondary" data-attend="${b.id}" data-value="${b.attended?'false':'true'}">${b.attended?'Atšaukti pažymėjimą':'Pažymėti dalyvavimą'}</button>`:''}</td></tr>`));
 const subscribers=table(['Vardas','El. paštas','Būsena','Veiksmas'],data.subscribers.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.email)}</td><td>${esc(state(s.status))}</td><td>${s.status!=='unsubscribed'?`<button class="button secondary" data-unsubscribe="${esc(s.email)}">Nutraukti prenumeratą</button>`:''}</td></tr>`));
 const eventOptions=data.events.map(e=>`<option value="${e.id}">${esc(e.title)}</option>`).join('');
 container.innerHTML=`<div class="dashboard-actions"><a class="button secondary" href="paskyra.html">Mano paskyra</a><a class="button secondary" href="#admin-events">Renginiai</a><a class="button secondary" href="#admin-attendance">Lankomumas</a><a class="button secondary" href="#admin-mail">Laiškai</a></div><section class="admin-section"><h2>Paraiškos</h2>${applications}</section><section class="admin-section"><h2>Nariai</h2>${members}</section><section class="admin-section" id="admin-events"><h2>Renginiai</h2><label>Redaguoti renginį<select id="event-edit"><option value="">Naujas renginys</option>${eventOptions}</select></label><form id="event-form" class="form-panel"><label>Identifikatorius<input name="id" required pattern="[a-z0-9-]+" maxlength="50"></label><label>Pavadinimas<input name="title" required maxlength="100"></label><label>Aprašymas<textarea name="description" maxlength="1000"></textarea></label><label>Data ir laikas su laiko juosta<input name="date" placeholder="2026-11-05T19:00:00+02:00" required></label><label>Vieta<input name="place" maxlength="150"></label><label>Kaina eurais<input name="price" type="number" min="0" step="0.01" required></label><label>Vietų skaičius<input name="capacity" type="number" min="1" max="1000" required></label><label>Kategorija<select name="category"><option value="hike">Žygis</option><option value="seminar">Seminaras</option><option value="community">Bendruomenė</option><option value="intro">Įvadas</option><option value="camp">Stovykla</option></select></label><label>Vedėjas<select name="instructor">${config.instructors.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select></label><label class="check"><input name="published" type="checkbox"> Rodyti viešai</label><label class="check"><input name="prototype" type="checkbox"> Prototipo renginys</label><button class="button primary">Išsaugoti renginį</button><p class="form-status" role="status"></p></form><div class="dashboard-actions">${data.events.filter(e=>!e.canceled).map(e=>`<button class="button secondary" data-cancel-event="${e.id}">Atšaukti: ${esc(e.title)}</button>`).join('')}</div></section><section class="admin-section"><h2>Instruktoriai</h2><label>Profilis<select id="instructor-edit">${config.instructors.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select></label><form id="instructor-form" class="form-panel"><input name="id" type="hidden"><label>Vardas<input name="name" maxlength="80" required></label><label>Sritis<input name="specialty" maxlength="100"></label><label>Pristatymas<textarea name="bio" maxlength="1000"></textarea></label><label class="check"><input name="placeholder" type="checkbox"> Profilio vieta</label><button class="button primary">Išsaugoti profilį</button><p class="form-status" role="status"></p></form></section><section class="admin-section" id="admin-attendance"><h2>Registracijos ir lankomumas</h2>${bookings}</section><section class="admin-section"><h2>Naujienlaiškio prenumeratoriai</h2>${subscribers}<p class="muted">Sąraše atskirtos nepatvirtintos ir aktyvios prenumeratos. Šiame prototipe masinis laiškų siuntimas dar neįjungtas.</p></section><section class="admin-section"><h2>Grąžinimo prašymai</h2>${data.requests.map(r=>`<div class="booking-row"><p>${esc(r.name)} · ${esc(r.kind==='membership_refund'?'Narystė':'Renginys')} · ${esc(state(r.status))}</p><p>${esc(r.reason)}</p>${r.status==='pending'?`<form class="refund-form" data-id="${r.id}"><label>Grąžinti eurais<input name="amount" type="number" min="0" step="0.01" required></label><button class="button primary">Patvirtinti grąžinimą</button><button type="button" class="button secondary" data-decline-request="${r.id}">Atmesti</button><p class="form-status" role="status"></p></form>`:''}</div>`).join('')||'<p>Prašymų nėra.</p>'}</section><section class="admin-section" id="admin-mail"><h2>Operaciniai laiškai</h2>${data.mail.map(m=>`<details><summary>${esc(m.subject)} · ${esc(m.email)} · ${esc(state(m.status))}</summary>${m.body?`<p>${esc(m.body)}</p>`:''}</details>`).join('')||'<p>Laiškų nėra.</p>'}</section>`;
 const refresh=async()=>{me=await api('/api/me');config=await api('/api/config');await admin();};
 action('[data-accept]',async b=>{await api('/api/admin/application',{userId:b.dataset.accept,status:'accepted'});await refresh();});
 action('[data-decline]',async b=>{await api('/api/admin/application',{userId:b.dataset.decline,status:'declined'});await refresh();});
 action('[data-attend]',async b=>{await api('/api/admin/attendance',{bookingId:b.dataset.attend,attended:b.dataset.value==='true'});await refresh();});
 action('[data-unsubscribe]',async b=>{await api('/api/admin/subscriber',{email:b.dataset.unsubscribe});await refresh();});
 action('[data-cancel-event]',async b=>{if(!confirm('Atšaukti renginį ir sukurti dalyvių grąžinimo prašymus?'))return;await api('/api/admin/event/cancel',{eventId:b.dataset.cancelEvent});await refresh();});
 action('[data-decline-request]',async b=>{await api('/api/admin/request',{requestId:b.dataset.declineRequest,action:'decline'});await refresh();});
 document.querySelectorAll('.refund-form').forEach(form=>form.addEventListener('submit',async e=>{e.preventDefault();if(!confirm(config.demo?'Patvirtinti demonstracinį grąžinimą?':'Atlikti pinigų grąžinimą?'))return;try{await api('/api/admin/request',{requestId:form.dataset.id,action:'refund',amount:Math.round(Number(form.elements.namedItem("amount").value)*100)});await refresh();}catch(err){showStatus(err.message,true,form.querySelector('.form-status'));}}));
 function fill(form,record){Object.entries(record).forEach(([k,v])=>{const f=form.elements.namedItem(k);if(f){if(f.type==='checkbox')f.checked=!!v;else f.value=k==='price'?v/100:v;}});}
 $('#event-edit').addEventListener('change',()=>{const record=data.events.find(e=>e.id===$('#event-edit').value);if(record)fill($('#event-form'),record);else $('#event-form').reset();});
 $('#instructor-edit').addEventListener('change',()=>fill($('#instructor-form'),config.instructors.find(i=>i.id===$('#instructor-edit').value)));
 fill($('#instructor-form'),config.instructors[0]);
 bindForm('#event-form','/api/admin/event',refresh,b=>({...b,price:Math.round(Number(b.price)*100),capacity:Number(b.capacity)}));
 bindForm('#instructor-form','/api/admin/instructor',refresh);
}
async function main(){
 try{
  [config,me,events]=await Promise.all([api('/api/config'),api('/api/me'),api('/api/events')]);
  if(config.demo){const banner=$('#prototype-banner');if(banner){banner.hidden=false;banner.textContent='Prototipas · pavyzdinės kainos ir datos · demonstraciniai mokėjimai, pinigai nenuskaičiuojami';}}
  const year=$('#year');if(year)year.textContent=new Date().getFullYear();
  if($('#event-list'))$('#event-list').innerHTML=eventCards(events.slice(0,3));
  if($('#events-page'))$('#events-page').innerHTML=eventCards(events);
  renderPlans();document.querySelectorAll('input[name=cycle]').forEach(i=>i.addEventListener('change',renderPlans));
  instructorCards();instructorDetail();eventDetail();
  bindForm('#register-form','/api/register');
  bindForm('#login-form','/api/login',data=>{me=data;location.href=nextPage();});
  bindForm('#reset-request-form','/api/password/request');
  bindForm('#reset-form','/api/password/reset',undefined,b=>({...b,token:new URLSearchParams(location.search).get('reset')}));
  bindForm('#newsletter-form','/api/newsletter');
  const params=new URLSearchParams(location.search);
  if(config.plans.some(p=>p.id===params.get('plan'))&&['month','year'].includes(params.get('cycle'))){
   sessionStorage.setItem('astra-plan',JSON.stringify({plan:params.get('plan'),cycle:params.get('cycle')}));
  }
  if(params.has('verify')){
   const panel=$('#token-action');if(panel){panel.hidden=false;panel.innerHTML='<button class="button primary" id="verify-email">Patvirtinti el. paštą</button><p class="form-status" role="status"></p>';action('#verify-email',async()=>{const data=await api('/api/verify',{token:params.get('verify')});showStatus(data.message,false,panel.querySelector('.form-status'));});}
  }
  if(params.has('reset')&&$('#reset-form')){$('#reset-form').hidden=false;$('#login-form').hidden=true;$('#reset-details').hidden=true;}
  if((params.has('confirm')||params.has('unsubscribe'))&&$('#newsletter-confirm')){
   const kind=params.has('confirm')?'confirm':'unsubscribe',panel=$('#newsletter-confirm');
   panel.hidden=false;panel.innerHTML=`<button class="button primary" id="newsletter-token">${kind==='confirm'?'Patvirtinti prenumeratą':'Nutraukti prenumeratą'}</button><p class="form-status" role="status"></p>`;
   action('#newsletter-token',async()=>{const data=await api('/api/newsletter/'+kind,{token:params.get(kind)});showStatus(data.message,false,panel.querySelector('.form-status'));});
  }
  if(config.demo&&$('#demo-login')){$('#demo-login').hidden=false;action('[data-demo-role]',async b=>{const data=await api('/api/demo-login',{role:b.dataset.demoRole});me=data;location.href=b.dataset.demoRole==='admin'?'administravimas.html':'paskyra.html';});}
  const application=$('#application-form');
  if(application){
   if(!me.user)$('#login-prompt').hidden=false;
   else if(me.application){$('#application-existing').innerHTML=`<div class="panel"><p>Paraiška jau pateikta: ${esc(state(me.application.status))}.</p><a class="button primary" href="paskyra.html">Į paskyrą ↗</a></div>`;}
   else{
    application.hidden=false;$('#application-plan').innerHTML=config.plans.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
    let remembered={};try{remembered=JSON.parse(sessionStorage.getItem('astra-plan')||'{}');}catch{}
    const chosenPlan=params.get('plan')||remembered.plan,chosenCycle=params.get('cycle')||remembered.cycle;
    if(config.plans.some(p=>p.id===chosenPlan))application.elements.plan.value=chosenPlan;
    if(['month','year'].includes(chosenCycle))application.elements.cycle.value=chosenCycle;
    const support=()=>{$('#support-field').hidden=application.elements.plan.value!=='support';application.elements.support.required=application.elements.plan.value==='support';};
    support();$('#application-plan').addEventListener('change',support);
    bindForm('#application-form','/api/apply',()=>{location.href='paskyra.html';});
   }
  }
  await account();await admin();
  if($('#payment-content')){
   if(requireLogin($('#payment-content')))return;
   const order=await api('/api/order?id='+encodeURIComponent(params.get('order')||''));
   $('#payment-content').innerHTML=`<div class="panel"><p>${order.kind==='membership'?'Narystė':'Renginio bilietas'}</p><p class="price">${esc(money(order.amount))}</p><p>${esc(state(order.status))}</p>${config.demo&&order.status==='pending'?'<p>Demonstracinis atsiskaitymas. Kortelės duomenų nereikia, pinigai nenuskaičiuojami.</p><button class="button primary" id="demo-pay">Atlikti demonstracinį mokėjimą</button>':''}<a class="text-link" href="paskyra.html">Į paskyrą ↗</a></div>`;
   action('#demo-pay',async()=>{await api('/api/demo-pay',{orderId:order.id});location.href='paskyra.html';});
  }
 }catch(error){
  showStatus(error.message,true);
  if(!$('#status')){const p=document.createElement('p');p.className='notice';p.textContent='Šiai funkcijai reikia veikiančio Astra serverio. '+error.message;document.querySelector('main')?.append(p);}
 }
}
main();
