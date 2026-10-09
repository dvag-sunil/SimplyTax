/* =============================================================================
   SimplyTax - account deletion (GDPR erasure): what must go, what must stay, and what happens when something fails
   Run: node test/test-account-deletion.js
============================================================================= */
process.env.AUTH_RATE_MAX = '100000';
const request = require('supertest');
const results = []; const rec = (id, title, ok, d) => { results.push({ id, ok }); console.log(`${ok ? 'OK        ' : 'FAILED    '}  ${id}  ${title}${!ok && d ? '\n              -> ' + d : ''}`); };
const REAL_DB = process.env.TEST_DB === 'pglite';
let n = 0;
(async () => {
  const { app, testPool } = require('./harness.js');
  const mk = async () => { n++; const r = await request(app).post('/api/auth/register').send({ name: 'Del' + n, email: `del${n}@d.test`, password: 'passw0rd-long-enough' }); return { t: r.body.token, id: r.body.user.id, email: `del${n}@d.test` }; };
  const del = (u, pw = 'passw0rd-long-enough') => request(app).delete('/api/auth/account').set('Authorization', 'Bearer ' + u.t).send({ password: pw });
  const q = async (sql, p) => (await testPool.query(sql, p)).rows;
  const seed = async (u) => {
    await request(app).put('/api/clients/bulk').set('Authorization', 'Bearer ' + u.t).send({ clients: [{ id: 'k' + u.id.slice(0, 6), taxYear: 2025 }] });
    await testPool.query(`INSERT INTO user_certificates(user_id,pfx_encrypted,pfx_iv,pfx_auth_tag,original_filename) VALUES ($1,'enc','iv','tag','my.pfx')`, [u.id]);
    await testPool.query(`INSERT INTO submission_approvals(client_id,user_id,approved_payload_sha256,approved_payload_snapshot,submitted) VALUES ('c1',$1,'h','{"hauptvordruck":{}}'::jsonb,true)`, [u.id]);
    await testPool.query(`INSERT INTO payments(user_id,client_id,session_id,amount_cents) VALUES ($1,'c1',$2,1799)`, [u.id, 'S-' + u.id]);
  };
  const A = await mk(), B = await mk(); await seed(A); await seed(B);
  const r1 = await del(A);
  const certA = (await q(`SELECT 1 FROM user_certificates WHERE user_id=$1`, [A.id])).length, certB = (await q(`SELECT 1 FROM user_certificates WHERE user_id=$1`, [B.id])).length;
  rec('A1', "Deleting an account removes the customer's stored (encrypted) ELSTER certificate - and nobody else's", r1.status === 200 && certA === 0 && certB === 1, `status=${r1.status} certA=${certA} certB=${certB}`);
  const pay = await q(`SELECT user_id FROM payments WHERE session_id=$1`, ['S-' + A.id]);
  rec('A2', 'The payment ledger is kept (anonymised: user_id becomes NULL)', pay.length === 1 && pay[0].user_id === null, JSON.stringify(pay));
  const apr = (await q(`SELECT 1 FROM submission_approvals WHERE user_id=$1`, [A.id])).length;
  rec('A3', 'Filing records (submission_approvals) are deliberately KEPT, pending the legal decision on retention', apr === 1, 'approvals=' + apr);
  rec('A4', 'The deleted account cannot log in and its old token is dead', (await request(app).post('/api/auth/login').send({ email: A.email, password: 'passw0rd-long-enough' })).status === 401 && (await request(app).get('/api/clients').set('Authorization', 'Bearer ' + A.t)).status === 401);

  /* a NON-missing-table failure while removing the certificate must abort the WHOLE deletion, changing nothing */
  const C = await mk(); await seed(C);
  const origConnect = testPool.connect.bind(testPool); let failOn = null;
  testPool.connect = async (...a) => { const c = await origConnect(...a); const oq = c.query.bind(c);
    c.query = (sql, ...r) => (failOn && typeof sql === 'string' && failOn.test(sql)) ? Promise.reject(Object.assign(new Error('simulated disk failure'), { code: 'XX000' })) : oq(sql, ...r); return c; };
  failOn = /DELETE FROM user_certificates/; const r5 = await del(C); failOn = null;
  const stillC = { u: (await q(`SELECT 1 FROM users WHERE id=$1`, [C.id])).length, k: (await q(`SELECT 1 FROM clients WHERE user_id=$1`, [C.id])).length, c: (await q(`SELECT 1 FROM user_certificates WHERE user_id=$1`, [C.id])).length };
  rec('A5', 'If the certificate cannot be removed the deletion FAILS as a whole (500) and nothing is changed - key material is never silently left behind', r5.status === 500 && stillC.u === 1 && stillC.c === 1 && (stillC.k === 1 || !REAL_DB), `status=${r5.status} ${JSON.stringify(stillC)}`);   // 'returns restored' is only asserted on real PostgreSQL: the pg-mem imitation does not roll a DELETE back
  const r5b = await del(C); rec('A6', '...and the customer can simply try again', r5b.status === 200 && (await q(`SELECT 1 FROM users WHERE id=$1`, [C.id])).length === 0, 'retry status=' + r5b.status);

  /* if the hard delete of the user row fails the account is ANONYMISED instead; users.name is NOT NULL in the real schema */
  const D = await mk(); await seed(D); failOn = /DELETE FROM users WHERE id/; const r7 = await del(D); failOn = null;
  const row = (await q(`SELECT email, name FROM users WHERE id=$1`, [D.id]))[0];
  rec('A7', 'Fallback: if the user row cannot be deleted it is anonymised (name set to empty, NOT NULL respected), the certificate and returns are still removed, and sessions end',
      r7.status === 200 && !!row && /^deleted-.*@deleted\.invalid$/.test(row.email) && row.name === '' && (await q(`SELECT 1 FROM user_certificates WHERE user_id=$1`, [D.id])).length === 0
        && (await q(`SELECT 1 FROM clients WHERE user_id=$1`, [D.id])).length === 0 && (await request(app).get('/api/clients').set('Authorization', 'Bearer ' + D.t)).status === 401, `status=${r7.status} row=${JSON.stringify(row)}`);

  /* the certificate table is created at startup: if it is missing the deletion must still work */
  await testPool.query('DROP TABLE user_certificates'); const E = await mk(); const r8 = await del(E);
  rec('A8', 'If the certificate table does not exist, deletion still succeeds (nothing to remove)', r8.status === 200 && (await q(`SELECT 1 FROM users WHERE id=$1`, [E.id])).length === 0, `status=${r8.status} ${JSON.stringify(r8.body)}`);
  const bad = results.filter(x => !x.ok);
  console.log(`\n===== Account-deletion suite: ${results.length - bad.length} ok, ${bad.length} FAILED =====`); if (bad.length) console.log('Failed:', bad.map(x => x.id).join(', '));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED:', e); process.exit(2); });
