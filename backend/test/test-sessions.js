/* =============================================================================
   SimplyTax - session revocation (a token used to stay valid for its full 2 hours whatever happened)
   Run: node test/test-sessions.js
============================================================================= */
const request = require('supertest'); const jwt = require('jsonwebtoken'); const crypto = require('crypto');
process.env.AUTH_RATE_MAX = '100000';   // this suite makes far more than 30 /api/auth calls; the brute-force limiter has its own test (test-security S18)
const SECRET = 'test-secret-not-for-production';
const results = []; const rec = (id, title, ok, d) => { results.push({ id, ok }); console.log(`${ok ? 'OK        ' : 'FAILED    '}  ${id}  ${title}${!ok && d ? '\n              -> ' + d : ''}`); };
let n = 0;
(async () => {
  const { app, testPool } = require('./harness.js');
  const mk = async () => { n++; const email = `s${n}@sess.test`; const r = await request(app).post('/api/auth/register').send({ name: 'S' + n, email, password: 'passw0rd-long-enough' }); return { email, token: r.body.token, id: r.body.user.id }; };
  const login = async (email) => (await request(app).post('/api/auth/login').send({ email, password: 'passw0rd-long-enough' })).body.token;
  const me = (t) => request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + t);

  { const u = await mk(); const before = (await me(u.token)).status; await request(app).post('/api/auth/logout').set('Authorization', 'Bearer ' + u.token); const after = await me(u.token);
    rec('T1', 'After logout the same token is refused at once (401, the code the frontend already turns into "please log in again"), though it has not expired', before === 200 && after.status === 401 && after.body.error === 'invalid_token' && after.body.reason === 'session_revoked', `before=${before} after=${after.status} ${JSON.stringify(after.body)}`); }
  { const u = await mk(); const second = await login(u.email); await request(app).post('/api/auth/logout').set('Authorization', 'Bearer ' + u.token);
    rec('T2', 'Logging out also ends the same account\'s other sessions (e.g. a stolen copy of the token)', (await me(second)).status === 401, 'other session still works'); }
  { const u = await mk(); await request(app).post('/api/auth/logout').set('Authorization', 'Bearer ' + u.token); const fresh = await login(u.email);
    rec('T3', 'A NEW login after logout works normally', (await me(fresh)).status === 200); }
  { const u = await mk(); const thief = await login(u.email); const tok = 'reset-token-123';
    await testPool.query(`UPDATE users SET settings = jsonb_set(coalesce(settings,'{}'::jsonb),'{pwreset}',$2::jsonb) WHERE id=$1`, [u.id, JSON.stringify({ th: crypto.createHash('sha256').update(tok).digest('hex'), exp: Date.now() + 600000 })]);
    const rs = await request(app).post('/api/auth/reset').send({ email: u.email, token: tok, password: 'brand-new-password-1' });
    rec('T4', 'A password reset ends every existing session (the thief\'s token dies), and the new password works', rs.status === 200 && (await me(thief)).status === 401 && (await me(u.token)).status === 401 && !!(await request(app).post('/api/auth/login').send({ email: u.email, password: 'brand-new-password-1' })).body.token, `reset=${rs.status}`); }
  { const u = await mk(); const old = jwt.sign({ sub: u.id, role: 'user' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    const ok = (await me(old)).status === 200; await request(app).post('/api/auth/logout').set('Authorization', 'Bearer ' + u.token); const gone = (await me(old)).status === 401;
    rec('T5', 'Tokens issued BEFORE this feature (no version) keep working until a revocation, then die: deploying it logs nobody out', ok && gone, `worksBefore=${ok} deadAfter=${gone}`); }
  { const u = await mk(); await request(app).delete('/api/auth/account').set('Authorization', 'Bearer ' + u.token).send({ password: 'passw0rd-long-enough' });
    rec('T6', "A deleted account's token is refused immediately", (await me(u.token)).status === 401, 'still accepted'); }
  { const u = await mk(); const rf = await request(app).post('/api/auth/refresh').set('Authorization', 'Bearer ' + u.token); const refreshed = rf.body.token;
    const rOk = rf.status === 200 && (await me(refreshed)).status === 200; await request(app).post('/api/auth/logout').set('Authorization', 'Bearer ' + u.token);
    rec('T7', 'A refreshed token works, and a revoked token cannot be used to get a new one', rOk && (await request(app).post('/api/auth/refresh').set('Authorization', 'Bearer ' + refreshed)).status === 401 && (await me(refreshed)).status === 401, `refresh=${rf.status}`); }
  { const u = await mk(); await request(app).put('/api/auth/settings').set('Authorization', 'Bearer ' + u.token).send({ settings: { tokenVersion: 5, theme: 'x' } });
    const row = (await testPool.query(`SELECT settings->>'tokenVersion' v FROM users WHERE id=$1`, [u.id])).rows[0].v; const pub = (await me(u.token)).body.user.settings;
    rec('T8', 'The browser can neither write nor see the session version', row === null && !('tokenVersion' in pub), `stored=${row} public=${JSON.stringify(pub)}`); }
  { const u = await mk(); let lookups = 0; const orig = testPool.query.bind(testPool);
    testPool.query = (q, ...r) => { if (typeof q === 'string' && q.includes("settings->>'tokenVersion'")) lookups++; return orig(q, ...r); };
    for (let i = 0; i < 25; i++) await me(u.token); testPool.query = orig;
    rec('T9', '25 requests cost at most 1 session lookup (cached), so this adds no per-request database load', lookups <= 1, 'lookups=' + lookups); }
  { const u = await mk(); await me(u.token); await new Promise(r => setTimeout(r, 0)); const orig = testPool.query.bind(testPool); const u2 = await mk(); let down = false;
    testPool.query = (q, ...r) => (down && typeof q === 'string' && q.includes("settings->>'tokenVersion'")) ? Promise.reject(new Error('db down')) : orig(q, ...r);
    down = true; const r2 = await me(u2.token); down = false; testPool.query = orig;
    rec('T10', 'If the session check cannot reach the database the request is REFUSED (503), never let through', r2.status === 503 && r2.body.error === 'auth_unavailable', `${r2.status} ${JSON.stringify(r2.body)}`); }
  { const r1 = await request(app).post('/api/auth/logout'); const r2 = await request(app).post('/api/auth/logout').set('Authorization', 'Bearer not.a.token'); const r3 = await request(app).post('/api/auth/logout').set('Authorization', 'Bearer ' + jwt.sign({ sub: 'x' }, SECRET, { expiresIn: -10 }));
    rec('T11', 'Logout with no token, a garbage token or an expired token still succeeds quietly (nothing to revoke)', [r1, r2, r3].every(r => r.status === 200 && r.body.ok === true), [r1, r2, r3].map(r => r.status).join(',')); }
  { const u = await mk(); await request(app).put('/api/clients/bulk').set('Authorization', 'Bearer ' + u.token).send({ clients: [{ id: 'gdpr1', taxYear: 2025, p: { firstName: 'Erase' } }, { id: 'gdpr2', taxYear: 2024 }] });
    const wrong = await request(app).delete('/api/auth/account').set('Authorization', 'Bearer ' + u.token).send({ password: 'not-my-password' });
    const stillThere = (await testPool.query(`SELECT count(*)::int n FROM clients WHERE user_id=$1`, [u.id])).rows[0].n;
    const del = await request(app).delete('/api/auth/account').set('Authorization', 'Bearer ' + u.token).send({ password: 'passw0rd-long-enough' });
    const left = { c: (await testPool.query(`SELECT count(*)::int n FROM clients WHERE user_id=$1`, [u.id])).rows[0].n, u: (await testPool.query(`SELECT count(*)::int n FROM users WHERE id=$1`, [u.id])).rows[0].n };
    rec('T12', 'Account deletion (never tested before): wrong password deletes nothing; the right one removes the user and all their returns', wrong.status === 401 && stillThere === 2 && del.status === 200 && left.c === 0 && left.u === 0, `wrong=${wrong.status} kept=${stillThere} del=${del.status} left=${JSON.stringify(left)}`); }

  const bad = results.filter(r => !r.ok);
  console.log(`\n===== Session suite: ${results.length - bad.length} ok, ${bad.length} FAILED =====`); if (bad.length) console.log('Failed:', bad.map(b => b.id).join(', '));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED:', e); process.exit(2); });
