/* =============================================================================
   SimplyTax - session revocation: ABUSE cases (complements test-sessions.js)
   One user's logout/reset must never affect another user; a failed or forged request must never end someone's session.
   Run: node test/test-session-abuse.js
============================================================================= */
process.env.AUTH_RATE_MAX='100000';
const request=require('supertest'), crypto=require('crypto');
(async()=>{ const {app,testPool}=require('./harness.js'); const res=[]; const rec=(id,t,ok,d)=>{res.push(ok);console.log((ok?'OK        ':'FAILED    ')+id+'  '+t+(ok?'':'\n   -> '+d));};
  let n=0; const mk=async()=>{n++; const r=await request(app).post('/api/auth/register').send({name:'U'+n,email:`u${n}@rev.test`,password:'passw0rd-long-enough'}); return {t:r.body.token,id:r.body.user.id,email:`u${n}@rev.test`};};
  const me=(u)=>request(app).get('/api/clients').set('Authorization','Bearer '+u.t);
  const A=await mk(), B=await mk();
  await request(app).post('/api/auth/logout').set('Authorization','Bearer '+A.t);
  const a=(await me(A)).status, b=(await me(B)).status;
  rec('X1',"User A logging out does NOT end user B's session",a===401&&b===200,`A=${a} B=${b}`);
  const C=await mk(), D=await mk();
  // an attacker spams password-reset requests / wrong tokens against victim C
  await request(app).post('/api/auth/forgot').send({email:C.email});
  const bad=await request(app).post('/api/auth/reset').send({email:C.email,token:'x'.repeat(64),password:'attacker-password-1'});
  const after=(await me(C)).status;
  rec('X2',"Requesting a reset or sending a WRONG reset token does not log the victim out",bad.status>=400&&after===200,`reset=${bad.status} session=${after}`);
  // complete a valid reset: sessions of that user die, other users unaffected
  const tok=crypto.randomBytes(32).toString('hex'), th=crypto.createHash('sha256').update(tok).digest('hex');
  await testPool.query(`UPDATE users SET settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{pwreset}',$2::jsonb) WHERE id=$1`,[C.id,JSON.stringify({th,exp:Date.now()+600000})]);
  const ok=await request(app).post('/api/auth/reset').send({email:C.email,token:tok,password:'brand-new-password-9'});
  const c2=(await me(C)).status, d2=(await me(D)).status;
  rec('X3','A valid reset ends THAT user\'s old sessions only',ok.status===200&&c2===401&&d2===200,`reset=${ok.status} C=${c2} D=${d2}`);
  const li=await request(app).post('/api/auth/login').send({email:C.email,password:'brand-new-password-9'}); 
  const fresh=await request(app).get('/api/clients').set('Authorization','Bearer '+li.body.token);
  rec('X4','Logging in with the new password gives a working session right away',li.status===200&&fresh.status===200,`login=${li.status} use=${fresh.status}`);
  // cookie-only path: log out with ONLY the cookie, then the bearer copy of the same token must be dead
  const E=await mk(); const lo=await request(app).post('/api/auth/login').send({email:E.email,password:'passw0rd-long-enough'});
  const cookie=String(lo.headers['set-cookie']||'').split(';')[0];
  await request(app).post('/api/auth/logout').set('Cookie',cookie);
  const viaBearer=(await request(app).get('/api/clients').set('Authorization','Bearer '+lo.body.token)).status;
  rec('X5','Logging out through the cookie also kills a copied Bearer token',viaBearer===401,'bearer copy status '+viaBearer);
  // logout from a foreign origin must not revoke (CSRF)
  const F=await mk(); await request(app).post('/api/auth/logout').set('Authorization','Bearer '+F.t).set('Origin','https://evil.example');
  rec('X6','A logout request forged from a foreign website does not end the session',(await me(F)).status===200,'session killed by foreign origin');
  const nBad=res.filter(x=>!x).length; console.log(`\n===== Session abuse suite: ${res.length-nBad} ok, ${nBad} FAILED =====`); process.exit(nBad?1:0); })();
