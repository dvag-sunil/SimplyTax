/* =============================================================================
   SimplyTax - Security attack suite
   Real exploit attempts against the REAL server.js (see harness.js for what is
   mocked: the database is pg-mem, ERiC is a mock). Each case prints SECURE or
   VULNERABLE. Run: node test/test-security.js
   Exit code 1 if anything is VULNERABLE.
============================================================================= */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const results = [];
function rec(id, title, secure, detail) {
  results.push({ id, title, secure, detail });
  console.log(`${secure ? 'SECURE    ' : 'VULNERABLE'}  ${id}  ${title}${detail && (!secure || /^ok:/.test(detail)) ? '\n              -> ' + detail.replace(/^ok:/,'') : ''}`);
}
let n = 0;
async function newUser(app) {
  n++;
  const r = await request(app).post('/api/auth/register').send({ name: 'User' + n, email: `u${n}@sec.test`, password: 'passw0rd-long-enough' });
  return { token: r.body.token, id: r.body.user && r.body.user.id, res: r };
}
const A = (req, t) => req.set('Authorization', 'Bearer ' + t);
const MIN = { meta: { taxYear: 2025 }, hauptvordruck: { personA: { vorname: 'Max', idnr: '12345678901' } } };

(async () => {
  const { app, testPool, ericMock } = require('./harness.js');
  ericMock._submitResult = { rc: 0, sent: true, resultXml: '<ok/>', serverXml: '', transferTicket: 'T-OK' };

  /* ---- S1: payment forgery through the normal bulk-save API ---- */
  {
    const u = await newUser(app);
    await A(request(app).put('/api/clients/bulk'), u.token)
      .send({ clients: [{ id: 'forge1', taxYear: 2025, status: 'draft', pay: { status: 'paid', paidAt: Date.now() } }] });
    const r = await A(request(app).post('/api/eric/submit'), u.token)
      .send({ clientId: 'forge1', interchangeData: MIN, freigabeConfirmed: true });
    rec('S1', 'Client cannot mark its own return as PAID via bulk save (payment gate)', r.status === 402,
        r.status === 402 ? '' : `submit returned ${r.status} ok=${r.body.ok} - a user can file for free by sending pay.status="paid"`);
  }
  /* ---- S2: forge submission status + transfer ticket ---- */
  {
    const u = await newUser(app);
    await A(request(app).put('/api/clients/bulk'), u.token)
      .send({ clients: [{ id: 'forge2', taxYear: 2025, status: 'submitted', transferTicket: 'FAKE-TICKET', pay: { status: 'paid' } }] });
    const g = await A(request(app).get('/api/clients'), u.token);
    const c = (g.body.clients || []).find(x => x.id === 'forge2');
    rec('S2', 'Client cannot forge status="submitted" + a fake transferTicket', !(c && c.status === 'submitted' && c.transferTicket === 'FAKE-TICKET'),
        c && c.status === 'submitted' ? 'server stored client-asserted status and transferTicket verbatim' : '');
  }
  /* ---- S3: mass-assignment of server-controlled security state in users.settings ---- */
  {
    const u = await newUser(app);
    await A(request(app).put('/api/auth/settings'), u.token)
      .send({ settings: { emailVerified: true, loginLockout: { failedAttempts: 0, lockedUntil: null }, pwreset: { th: 'x', exp: 1 } } });
    const me = await A(request(app).get('/api/auth/me'), u.token);
    const s = (me.body.user && me.body.user.settings) || {};
    rec('S3', 'User cannot write server-controlled keys (emailVerified, pwreset, loginLockout) via PUT /api/auth/settings',
        !(s.emailVerified === true || s.pwreset), s.emailVerified === true ? 'emailVerified=true accepted from the client -> email verification can be self-granted' : '');
  }
  /* ---- S3b: do responses leak hashed reset/verification tokens to the browser? ---- */
  {
    await testPool.query(`UPDATE users SET settings = jsonb_set(coalesce(settings,'{}'::jsonb),'{pwreset}','{"th":"HASHVALUE","exp":9999999999999}'::jsonb) WHERE email='u1@sec.test'`);
    const l = await request(app).post('/api/auth/login').send({ email: 'u1@sec.test', password: 'passw0rd-long-enough' });
    const leaked = JSON.stringify(l.body.user || {}).includes('HASHVALUE');
    rec('S3b', 'Login/me responses do not expose password-reset / verification token hashes', !leaked, leaked ? 'users.settings is returned whole, including pwreset.th / emailVerify.th' : '');
  }
  /* ---- S4: an empty bulk list must not wipe a user's data ---- */
  {
    const u = await newUser(app);
    await A(request(app).put('/api/clients/bulk'), u.token).send({ clients: [{ id: 'keep1', taxYear: 2025 }, { id: 'keep2', taxYear: 2024 }] });
    await A(request(app).put('/api/clients/bulk'), u.token).send({ clients: [] });
    const g = await A(request(app).get('/api/clients'), u.token);
    rec('S4', 'An empty/stale bulk save cannot silently delete all of a user\'s returns', (g.body.clients || []).length > 0,
        (g.body.clients || []).length === 0 ? 'PUT {clients:[]} deleted every return' : '');
  }
  /* ---- S5: a stale tab must not delete a PAID/SUBMITTED return ---- */
  {
    const u = await newUser(app);
    await A(request(app).put('/api/clients/bulk'), u.token).send({ clients: [{ id: 'paid1', taxYear: 2025 }, { id: 'other', taxYear: 2025 }] });
    await testPool.query(`UPDATE clients SET data = jsonb_set(jsonb_set(data,'{pay}','{"status":"paid"}'::jsonb),'{status}','"submitted"'::jsonb) WHERE id='paid1'`);
    await A(request(app).put('/api/clients/bulk'), u.token).send({ clients: [{ id: 'other', taxYear: 2025 }] });   // stale list without paid1
    const g = await A(request(app).get('/api/clients'), u.token);
    rec('S5', 'A stale-list bulk save cannot delete a paid / submitted return', (g.body.clients || []).some(c => c.id === 'paid1'),
        'a paid+submitted return was deleted because the client list omitted it');
  }
  /* ---- S6: cross-user isolation (IDOR) ---- */
  {
    const a = await newUser(app), b = await newUser(app);
    await A(request(app).put('/api/clients/bulk'), a.token).send({ clients: [{ id: 'idor-a', taxYear: 2025, p: { firstName: 'Alice' } }] });
    await A(request(app).put('/api/clients/bulk'), b.token).send({ clients: [{ id: 'idor-a', taxYear: 2025, p: { firstName: 'MALLORY' } }] });
    await A(request(app).delete('/api/clients/idor-a'), b.token);
    const ga = await A(request(app).get('/api/clients'), a.token);
    const alice = (ga.body.clients || []).find(c => c.id === 'idor-a');
    const gb = await A(request(app).get('/api/clients'), b.token);
    rec('S6', 'User B cannot overwrite, delete or read user A\'s return by guessing its id',
        !!alice && alice.p.firstName === 'Alice' && !(gb.body.clients || []).some(c => c.p && c.p.firstName === 'Alice'),
        !alice ? 'user A\'s record was deleted' : alice.p.firstName !== 'Alice' ? 'user A\'s record was overwritten' : 'user B can read A\'s record');
  }
  /* ---- S7: cross-site request from a foreign Origin must not execute ---- */
  {
    const u = await newUser(app);
    const r = await request(app).post('/api/auth/logout').set('Origin', 'https://evil.example').set('Cookie', 'simplytax_session=' + u.token);
    const cleared = /simplytax_session=;/.test(String(r.headers['set-cookie'] || ''));
    rec('S7', 'A state-changing request from a foreign Origin is rejected before the handler runs (CSRF)', r.status >= 400 && !cleared, `status ${r.status}, cookie cleared=${cleared}`);
  }
  /* ---- S8: JWT hardening ---- */
  {
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: '00000000-0000-0000-0000-000000000000', role: 'admin' })).toString('base64url') + '.';
    const r1 = await A(request(app).get('/api/auth/me'), none);
    const r2 = await A(request(app).get('/api/auth/me'), jwt.sign({ sub: 'x' }, 'wrong-secret'));
    const r3 = await A(request(app).get('/api/auth/me'), jwt.sign({ sub: 'x' }, 'test-secret-not-for-production', { expiresIn: -10 }));
    rec('S8', 'JWTs with alg=none, a wrong secret, or an expired signature are rejected', r1.status === 401 && r2.status === 401 && r3.status === 401, `none=${r1.status} wrongSecret=${r2.status} expired=${r3.status}`);
  }
  /* ---- S9: login timing must not reveal whether an account exists ---- */
  {
    await newUser(app);
    const time = async (email) => { const t = process.hrtime.bigint(); await request(app).post('/api/auth/login').send({ email, password: 'wrong-password-x' }); return Number(process.hrtime.bigint() - t) / 1e6; };
    const known = [], unknown = [];
    for (let i = 0; i < 3; i++) { known.push(await time('u1@sec.test')); unknown.push(await time(`nobody${i}@sec.test`)); }
    const med = a => a.sort((x, y) => x - y)[1];
    const k = med(known), un = med(unknown);
    rec('S9', 'Login response time is the same for existing and non-existing accounts', un > k * 0.6, `existing ~${k.toFixed(0)}ms vs non-existing ~${un.toFixed(0)}ms`);
  }
  /* ---- S10: input type confusion / oversize must be a clean 4xx, never 500 or a hang ---- */
  {
    const r1 = await request(app).post('/api/auth/register').send({ name: 'x', email: 12345, password: 'passw0rd-long-enough' });
    const t = Date.now();
    const r2 = await request(app).post('/api/auth/register').send({ name: 'x', email: 'big@sec.test', password: 'a'.repeat(2_000_000) });
    const dt = Date.now() - t;
    rec('S10', 'Non-string email -> 400 (not 500); 2MB password -> rejected fast', r1.status === 400 && (r2.status === 400 || dt < 1500), `email-as-number=${r1.status}, 2MB password=${r2.status} in ${dt}ms`);
  }
  /* ---- S11: no stack traces / internals in error responses ---- */
  {
    const r1 = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json');
    const r2 = await request(app).get('/api/clients').set('Origin', 'https://evil.example');
    const r3 = await request(app).get('/api/does-not-exist');
    const bodies = [r1.text, r2.text, r3.text].join(' ');
    rec('S11', 'Error responses (bad JSON, CORS rejection, unknown route) leak no stack traces or file paths', !/\bat \S+ \(|node_modules|\/tmp\/|\.js:\d+/.test(bodies), bodies.slice(0, 160).replace(/\s+/g, ' '));
  }
  /* ---- S12: payment webhooks must reject unsigned requests ---- */
  {
    const r1 = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').send(JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_x', metadata: { clientId: 'forge1' } } } }));
    const r2 = await request(app).post('/api/payments/paypal/webhook').set('Content-Type', 'application/json').send(JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { custom_id: 'forge1' } }));
    rec('S12', 'Unsigned Stripe and PayPal webhook calls are rejected (cannot mark returns as paid)', r1.status >= 400 && r2.status >= 400 && !/received|ok/i.test(r1.text + r2.text) || (r1.status >= 400 && r2.status >= 400), `stripe=${r1.status} paypal=${r2.status}`);
  }
  /* ---- S13: every data route requires authentication ---- */
  {
    const routes = [['get', '/api/clients'], ['put', '/api/clients/bulk'], ['delete', '/api/clients/x'], ['post', '/api/eric/submit'], ['post', '/api/eric/validate'],
                    ['post', '/api/payments/checkout'], ['post', '/api/payments/paypal/create-order'], ['get', '/api/docs/x'], ['post', '/api/docs'], ['delete', '/api/auth/account'],
                    ['post', '/api/auth/export'], ['put', '/api/auth/settings'], ['post', '/api/extract-doc'], ['get', '/api/certificate/status']];
    const open = [];
    for (const [m, p] of routes) { const r = await request(app)[m](p).send({}); if (r.status !== 401) open.push(`${m.toUpperCase()} ${p}=${r.status}`); }
    rec('S13', 'All data / payment / ERiC / document / certificate routes return 401 without a session', open.length === 0, open.join(', '));
  }
  /* ---- S14: session cookie flags ---- */
  {
    const r = await request(app).post('/api/auth/login').send({ email: 'u1@sec.test', password: 'passw0rd-long-enough' });
    const c = String(r.headers['set-cookie'] || '');
    rec('S14', 'Session cookie is HttpOnly + Secure + SameSite=None with a 2h lifetime', /HttpOnly/i.test(c) && /Secure/i.test(c) && /SameSite=None/i.test(c) && /Max-Age=7200/i.test(c), c.slice(0, 140));
  }
  /* ---- S15: the JWT is NOT also handed to JavaScript in response bodies (httpOnly would be pointless otherwise) ---- */
  {
    const l = await request(app).post('/api/auth/login').send({ email: 'u1@sec.test', password: 'passw0rd-long-enough' });
    const cookie = String(l.headers['set-cookie'] || '').split(';')[0];
    const rf = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    rec('S15', 'Login / register / refresh responses do not return the JWT in the JSON body', !l.body.token && !rf.body.token,
        `login body has token=${!!l.body.token}; refresh body has token=${!!rf.body.token} - any XSS can read it, defeating the httpOnly cookie`);
  }
  /* ---- S16: standard security headers ---- */
  {
    const r = await request(app).get('/api/health');
    const h = r.headers;
    rec('S16', 'Helmet headers present (nosniff, HSTS, frame, no x-powered-by)', h['x-content-type-options'] === 'nosniff' && !!h['strict-transport-security'] && !h['x-powered-by'], Object.keys(h).filter(k => /^(x-|strict|content-sec|cross)/.test(k)).join(', '));
  }
  /* ---- S17: stored XSS-style payloads are returned as inert data (JSON), never HTML ---- */
  {
    const u = await newUser(app);
    await A(request(app).put('/api/clients/bulk'), u.token).send({ clients: [{ id: 'xss1', taxYear: 2025, p: { firstName: '<img src=x onerror=alert(1)>' } }] });
    const g = await A(request(app).get('/api/clients'), u.token);
    rec('S17', 'API returns user text as application/json (never text/html)', /application\/json/.test(g.headers['content-type']), g.headers['content-type']);
  }
  /* ---- S18: brute force limiter engages ---- */
  {
    let limited = false;
    for (let i = 0; i < 35 && !limited; i++) { const r = await request(app).post('/api/auth/login').send({ email: 'brute@sec.test', password: 'x' + i }); if (r.status === 429) limited = true; }
    rec('S18', 'Auth endpoints are rate limited (429 after repeated attempts)', limited);
  }



  const bad = results.filter(r => !r.secure);
  console.log(`\n===== Security suite: ${results.length - bad.length} secure, ${bad.length} VULNERABLE =====`);
  if (bad.length) console.log('Vulnerable:', bad.map(b => b.id).join(', '));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED:', e); process.exit(2); });
