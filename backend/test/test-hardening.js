/* =============================================================================
   SimplyTax - hardening suite: sign-in throttling, password length, cron secret, storage quota, account-deletion file cleanup
   Run: node test/test-hardening.js
============================================================================= */
process.env.AUTH_RATE_MAX = '100000'; process.env.REMINDER_CRON_SECRET = 'cron-test-secret';
process.env.SUPABASE_URL = 'https://sb.test'; process.env.SUPABASE_SERVICE_KEY = 'svc'; process.env.DOC_USER_MAX_FILES = '3'; process.env.DOC_USER_MAX_MB = '0.001';
const request = require('supertest'), bcrypt = require('bcryptjs'), crypto = require('crypto');
/* ---- fake Supabase storage. Like the real one it returns only 100 entries per list call unless a limit is given. ---- */
const store = new Map(); let failDelete = false;
global.fetch = async (url, opts = {}) => {
  const u = String(url); if (!u.startsWith('https://sb.test')) throw new Error('unexpected fetch ' + u);
  const json = (o, ok = true, status = 200) => ({ ok, status, json: async () => o, text: async () => JSON.stringify(o) });
  if (u.endsWith('/storage/v1/object/list/belege')) { const b = JSON.parse(opts.body); const lim = b.limit || 100, off = b.offset || 0;
    return json([...store.keys()].filter(k => k.startsWith(b.prefix)).sort().map(k => ({ name: k.slice(b.prefix.length), id: 'o', metadata: { size: store.get(k).size } })).slice(off, off + lim)); }
  if (opts.method === 'DELETE' && u.endsWith('/storage/v1/object/belege')) { if (failDelete) return json({}, false, 500); JSON.parse(opts.body).prefixes.forEach(p => store.delete(p)); return json([]); }
  const m = u.match(/\/storage\/v1\/object\/belege\/(.+)$/); if (m && opts.method === 'POST') { store.set(m[1], { size: opts.body.length }); return json({}); }
  return json({ error: 'unexpected ' + u }, false, 500);
};
const results = []; const rec = (id, title, ok, d) => { results.push({ id, ok }); console.log(`${ok ? 'OK        ' : 'FAILED    '}  ${id}  ${title}${!ok && d ? '\n              -> ' + d : ''}`); };
const PW = 'passw0rd-long-enough'; let n = 0;
(async () => {
  const { app, testPool } = require('./harness.js');
  const mk = async (pw = PW) => { n++; const r = await request(app).post('/api/auth/register').send({ name: 'H' + n, email: `h${n}@hd.test`, password: pw }); return { t: r.body.token, id: r.body.user && r.body.user.id, email: `h${n}@hd.test`, status: r.status, body: r.body }; };
  const login = (u, ip, pw = PW) => request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email: u.email, password: pw });
  const wrong = async (u, ip, times) => { for (let i = 0; i < times; i++) await login(u, ip, 'wrong-password-' + i); };

  /* ---------------- sign-in throttling ---------------- */
  { const V = await mk(); await wrong(V, '10.0.0.1', 5);
    const attackerCorrect = await login(V, '10.0.0.1'), owner = await login(V, '10.0.0.2');
    rec('H1', 'An attacker who fails 5 times is blocked, but the REAL OWNER signing in from another address is NOT locked out', attackerCorrect.status === 401 && owner.status === 200, `attacker(correct pw)=${attackerCorrect.status} owner=${owner.status}`); }
  { const V = await mk(); await wrong(V, '10.1.0.1', 4); const ok = await login(V, '10.1.0.1'); await wrong(V, '10.1.0.1', 4); const still = await login(V, '10.1.0.1');
    rec('H2', 'Failures must be consecutive: a successful sign-in resets that source\'s counter', ok.status === 200 && still.status === 200, `${ok.status}/${still.status}`); }
  { const W = await mk(); await login(W, '20.0.0.1');                                  // the owner signs in from their usual place (it becomes a trusted source)
    for (let i = 0; i < 30; i++) await login(W, `30.0.${Math.floor(i / 200)}.${i + 1}`, 'wrong-' + i);   // 30 failures from 30 DIFFERENT addresses
    const stranger = await login(W, '20.0.0.99'), usual = await login(W, '20.0.0.1');
    rec('H3', 'A many-address attack puts the account "under attack": unknown sources are refused, the owner\'s usual source still works', stranger.status === 401 && usual.status === 200, `stranger(correct pw)=${stranger.status} usual=${usual.status}`);
    const tok = crypto.randomBytes(32).toString('hex'), th = crypto.createHash('sha256').update(tok).digest('hex');
    await testPool.query(`UPDATE users SET settings=jsonb_set(settings,'{pwreset}',$2::jsonb) WHERE id=$1`, [W.id, JSON.stringify({ th, exp: Date.now() + 600000 })]);
    const rs = await request(app).post('/api/auth/reset').send({ email: W.email, token: tok, password: 'a-brand-new-password-1' }); const after = await login(W, '20.0.0.99', 'a-brand-new-password-1');
    rec('H4', 'Completing a password reset CLEARS the lockout (before: the owner stayed locked out even after resetting)', rs.status === 200 && after.status === 200, `reset=${rs.status} login from the new address=${after.status}`); }
  { const L = await mk(); await testPool.query(`UPDATE users SET settings=jsonb_set(settings,'{loginLockout}',$2::jsonb) WHERE id=$1`, [L.id, JSON.stringify({ failedAttempts: 0, lockedUntil: Date.now() + 600000 })]);
    const blocked = await login(L, '40.0.0.1'); await testPool.query(`UPDATE users SET settings=jsonb_set(settings,'{loginLockout}',$2::jsonb) WHERE id=$1`, [L.id, JSON.stringify({ failedAttempts: 0, lockedUntil: Date.now() - 1000 })]);
    const free = await login(L, '40.0.0.1'); rec('H5', 'A lock written in the OLD format is still honoured until it expires (no crash, no early release)', blocked.status === 401 && free.status === 200, `${blocked.status}/${free.status}`); }
  { const V = await mk(); await wrong(V, '55.66.77.88', 5); const st = JSON.stringify((await testPool.query(`SELECT settings FROM users WHERE id=$1`, [V.id])).rows[0].settings);
    const me = await request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + V.t);
    rec('H6', 'No raw IP address is stored, and the lockout state is not exposed to the browser', !st.includes('55.66.77.88') && st.includes('sources') && !('loginLockout' in ((me.body.user || {}).settings || {})), st.slice(0, 160)); }

  /* ---------------- password length (bcrypt cuts at 72 BYTES) ---------------- */
  { const p73 = 'a'.repeat(73), p72 = 'b'.repeat(72), euro25 = '€'.repeat(25), euro24 = '€'.repeat(24);
    const r = [await mk(p73), await mk(p72), await mk(euro25), await mk(euro24)].map(x => x.status);
    rec('P1', 'A new password over 72 BYTES is refused with a clear code; 72 bytes (also with multi-byte characters) is accepted', r[0] === 400 && r[1] === 200 && r[2] === 400 && r[3] === 200 && (await mk(p73)).body.error === 'password_too_long', JSON.stringify(r)); }
  { const U = await mk(); const tok = crypto.randomBytes(32).toString('hex'), th = crypto.createHash('sha256').update(tok).digest('hex');
    await testPool.query(`UPDATE users SET settings=jsonb_set(settings,'{pwreset}',$2::jsonb) WHERE id=$1`, [U.id, JSON.stringify({ th, exp: Date.now() + 600000 })]);
    const r = await request(app).post('/api/auth/reset').send({ email: U.email, token: tok, password: 'c'.repeat(80) }); const old = await login(U, '60.0.0.1');
    rec('P2', 'A reset to an over-long password is refused (400 password_too_long) and the old password keeps working', r.status === 400 && r.body.error === 'password_too_long' && old.status === 200, `${r.status} ${JSON.stringify(r.body)} old=${old.status}`); }
  { n++; const email = `h${n}@hd.test`, long = 'z'.repeat(100); await testPool.query(`INSERT INTO users(email,name,password_hash) VALUES ($1,'Old',$2)`, [email, await bcrypt.hash(long, 4)]);
    const r = await request(app).post('/api/auth/login').set('X-Forwarded-For', '61.0.0.1').send({ email, password: long });
    rec('P3', 'An EXISTING account whose password is longer than 72 bytes can still sign in', r.status === 200, 'status ' + r.status); }

  /* ---------------- cron secret ---------------- */
  { const c = (h) => request(app).post('/api/reminders/run').set(h || {}).send({});
    const r = [await c(), await c({ 'x-cron-secret': 'wrong' }), await c({ 'x-cron-secret': 'cron-test-secret-but-longer' }), await c({ 'x-cron-secret': 'cron-test-secret' })].map(x => x.status);
    rec('C1', 'The cron endpoint accepts only the exact secret (missing, wrong and different-length secrets are all 401; the right one passes the check)', r[0] === 401 && r[1] === 401 && r[2] === 401 && r[3] === 501, r.join(',')); }

  /* ---------------- storage quota + deletion cleanup ---------------- */
  const pdf = (len) => 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n' + 'x'.repeat(len)).toString('base64');
  const up = (u, id, len = 20) => request(app).post('/api/docs').set('Authorization', 'Bearer ' + u.t).send({ id, dataUrl: pdf(len) });
  { const Q = await mk(); const a = [await up(Q, 'd1'), await up(Q, 'd2'), await up(Q, 'd3')].map(x => x.status), fourth = await up(Q, 'd4'), replace = await up(Q, 'd2', 30), other = await mk(), otherUp = await up(other, 'd1');
    rec('Q1', 'Per-user file limit (3 in this test): the 4th new file is refused (413), replacing an existing one is allowed, and another user is not affected', a.join() === '200,200,200' && fourth.status === 413 && fourth.body.error === 'storage_quota_exceeded' && replace.status === 200 && otherUp.status === 200, `${a.join()} 4th=${fourth.status} replace=${replace.status} other=${otherUp.status}`); }
  { const R = await mk(); const first = await up(R, 'b1', 700), second = await up(R, 'b2', 700);
    rec('Q2', 'Per-user size limit (about 1 KB in this test): a second file that would exceed it is refused (413)', first.status === 200 && second.status === 413, `${first.status}/${second.status}`); }
  { const T = await mk(), O = await mk(); for (let i = 0; i < 250; i++) store.set(`${T.id}/f${String(i).padStart(3, '0')}`, { size: 10 }); for (let i = 0; i < 5; i++) store.set(`${O.id}/keep${i}`, { size: 10 });
    const del = await request(app).delete('/api/auth/account').set('Authorization', 'Bearer ' + T.t).send({ password: PW });
    const left = [...store.keys()].filter(k => k.startsWith(T.id + '/')).length, others = [...store.keys()].filter(k => k.startsWith(O.id + '/')).length;
    rec('Q3', 'Deleting an account removes ALL its stored files, not just the first 100 (250 here); other users\' files are untouched', del.status === 200 && left === 0 && others === 5, `status=${del.status} left=${left} (before the fix: 150) others=${others}`); }
  { const F = await mk(); store.set(`${F.id}/x1`, { size: 10 }); failDelete = true; const del = await request(app).delete('/api/auth/account').set('Authorization', 'Bearer ' + F.t).send({ password: PW }); failDelete = false;
    const gone = (await testPool.query(`SELECT 1 FROM users WHERE id=$1`, [F.id])).rows.length === 0;
    rec('Q4', 'If the storage delete fails, the account is still deleted (it is logged, and no longer ignored silently)', del.status === 200 && gone, `status=${del.status} userGone=${gone}`); }


  /* ---------------- cross-site access (CORS): the real website is allowed, everything else is not ---------------- */
  { const pre = (origin) => request(app).options('/api/auth/login').set('Origin', origin).set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type');
    const ok = await pre('https://www.taxfile24.com');
    rec('X1', 'The real website (https://www.taxfile24.com) is allowed to call the API, with cookies', ok.headers['access-control-allow-origin'] === 'https://www.taxfile24.com' && ok.headers['access-control-allow-credentials'] === 'true', JSON.stringify({ s: ok.status, h: ok.headers['access-control-allow-origin'], c: ok.headers['access-control-allow-credentials'] }));
    const bad = [];
    for (const o of ['https://dvag-sunil.github.io', 'https://www.taxfile24.com.evil.example', 'http://www.taxfile24.com', 'https://evil-www.taxfile24.com', 'https://taxfile24.com', 'null']) { const r = await pre(o); if (r.headers['access-control-allow-origin']) bad.push(o + ' -> ' + r.headers['access-control-allow-origin']); }
    rec('X2', 'The old github.io address and look-alikes (extra domain suffix, http, other subdomain, null) are NOT allowed', bad.length === 0, bad.join('; '));
    const simple = await request(app).get('/api/health').set('Origin', 'https://www.taxfile24.com'), none = await request(app).get('/api/health');
    rec('X3', 'A normal request from the real website carries the CORS answer; a request without any Origin (curl, monitoring) still works', simple.headers['access-control-allow-origin'] === 'https://www.taxfile24.com' && none.status !== 403, `${simple.headers['access-control-allow-origin']} / ${none.status}`); }

  const bad = results.filter(r => !r.ok);
  console.log(`\n===== Hardening suite: ${results.length - bad.length} ok, ${bad.length} FAILED =====`); if (bad.length) console.log('Failed:', bad.map(b => b.id).join(', '));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED:', e); process.exit(2); });
