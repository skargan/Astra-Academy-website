import {createHmac,timingSafeEqual} from 'node:crypto';
export async function stripe(path,params,method='POST',key=process.env.STRIPE_SECRET_KEY,idempotency) {
  if(!key) throw new Error('Mokėjimų teikėjas dar neprijungtas.');
  const headers={Authorization:'Bearer '+key};
  if(params) headers['Content-Type']='application/x-www-form-urlencoded';
  if(idempotency) headers['Idempotency-Key']=idempotency;
  const response=await fetch('https://api.stripe.com/v1/'+path,{method,headers,body:params?new URLSearchParams(params):undefined,signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok) throw new Error('Mokėjimo užklausa nepavyko. Bandyk dar kartą arba parašyk mums.');
  return data;
}
export function verifyWebhook(raw,header,secret,now=Date.now()) {
  if(!secret||!header) return false;
  const pairs=header.split(',').map(p=>p.split('='));
  const timestamp=pairs.find(p=>p[0]==='t')?.[1];
  if(!timestamp||Math.abs(now/1000-Number(timestamp))>300) return false;
  const expected=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();
  return pairs.filter(p=>p[0]==='v1').some(p=>{
    const received=Buffer.from(p[1]||'','hex');
    return received.length===expected.length&&timingSafeEqual(received,expected);
  });
}
