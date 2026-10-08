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

  /* ---- S19: submitted returns are immutable (values), yet harmless migration additions are allowed ---- */
  {
    const u = await newUser(app);
    await A(request(app).put('/api/clients/bulk'), u.token).send({ clients: [{ id: 'imm', taxYear: 2025, p: { firstName: 'Original', iban: 'DE89' }, fam: { children: [{ id: 'k1', name: 'Kid' }] }, emps: [{ id: 'e1', gross: '1' }] }] });
    await testPool.query(`UPDATE clients SET data=jsonb_set(data,'{pay}','{"status":"paid"}'::jsonb) WHERE id='imm'`);
    await A(request(app).post('/api/eric/submit'), u.token).send({ clientId: 'imm', freigabeConfirmed: true, interchangeData: MIN });
    const snap = (await testPool.query(`SELECT submitted_snapshot_sha256 s, data->>'status' st, data->>'submittedAt' at FROM clients WHERE id='imm'`)).rows[0];
    rec('S19a', 'Submit records a content baseline hash and a server-side submittedAt timestamp', !!snap.s && snap.st === 'submitted' && !!snap.at, `baseline=${snap.s ? 'set' : 'MISSING'} status=${snap.st} submittedAt=${snap.at ? 'set' : 'MISSING'}`);
    const base = { id: 'imm', taxYear: 2025, p: { firstName: 'Original', iban: 'DE89' }, fam: { children: [{ id: 'k1', name: 'Kid' }] }, emps: [{ id: 'e1', gross: '1' }] };
    const mig = await A(request(app).put('/api/clients/bulk'), u.token).send({ clients: [{ ...base, unt: [], p: { ...base.p, deathYear: '' } }] });
    rec('S19b', 'Fields added by the app\'s own migrations on an old submitted return are NOT blocked', (mig.body.blockedIds || []).length === 0, 'ok:blockedIds=' + JSON.stringify(mig.body.blockedIds));
    const cases = [['changed value', { ...base, p: { ...base.p, firstName: 'TAMPERED' } }], ['appended child', { ...base, fam: { children: [...base.fam.children, { id: 'k2', name: 'Extra' }] } }],
                   ['removed field', { ...base, p: { firstName: 'Original' } }], ['nested change', { ...base, emps: [{ id: 'e1', gross: '999' }] }]];
    const missed = [];
    for (const [label, c] of cases) { const r = await A(request(app).put('/api/clients/bulk'), u.token).send({ clients: [c] }); if (!(r.body.blockedIds || []).includes('imm')) missed.push(label); }
    const fin = (await testPool.query(`SELECT data->'p'->>'firstName' fn FROM clients WHERE id='imm'`)).rows[0].fn;
    rec('S19c', 'Changing, appending, removing or editing existing data on a submitted return is blocked and not stored', missed.length === 0 && fin === 'Original', missed.length ? 'NOT blocked: ' + missed.join(', ') : 'stored name=' + fin);
    const cur = { ...base, unt: [], p: { ...base.p, deathYear: '' } };     // the shape the app sends after its own migrations
    const ino = await A(request(app).put('/api/clients/bulk'), u.token).send({ clients: [{ ...cur, inq: [{ id: 'q1', text: 'Finanzamt asked' }], docs: [{ id: 'd1' }] }] });
    rec('S19d', 'Inquiry log and uploaded documents on a submitted return can still be added', (ino.body.blockedIds || []).length === 0, 'ok:blockedIds=' + JSON.stringify(ino.body.blockedIds));
  }
  /* ---- S20: deletion is explicit; saving never deletes; in-flight submissions cannot be deleted ---- */
  {
    const u = await newUser(app);
    await A(request(app).put('/api/clients/bulk'), u.token).send({ clients: [{ id: 'd1', taxYear: 2025 }, { id: 'd2', taxYear: 2024 }] });
    await A(request(app).put('/api/clients/bulk'), u.token).send({ clients: [{ id: 'd1', taxYear: 2025 }] });
    const afterOmit = (await A(request(app).get('/api/clients'), u.token)).body.clients.map(c => c.id).sort().join(',');
    await A(request(app).delete('/api/clients/d2'), u.token);
    const afterDel = (await A(request(app).get('/api/clients'), u.token)).body.clients.map(c => c.id).join(',');
    await testPool.query(`UPDATE clients SET data=jsonb_set(data,'{status}','"submitting"'::jsonb) WHERE id='d1'`);
    await A(request(app).delete('/api/clients/d1'), u.token);
    const afterInflight = (await A(request(app).get('/api/clients'), u.token)).body.clients.map(c => c.id).join(',');
    rec('S20', 'Omitting a return from a save keeps it; DELETE removes exactly that return; an in-flight submission cannot be deleted',
        afterOmit === 'd1,d2' && afterDel === 'd1' && afterInflight === 'd1', `afterOmit=${afterOmit} afterDelete=${afterDel} afterInflightDelete=${afterInflight}`);
  }
  /* ---- S21: email-change resets verification; document ids cannot be path segments; HTML in names is escaped in emails ---- */
  {
    const u = await newUser(app);
    await testPool.query(`UPDATE users SET settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{emailVerified}','true') WHERE id=$1`, [u.id]);
    await A(request(app).put('/api/auth/email'), u.token).send({ newEmail: 'moved@sec.test', password: 'passw0rd-long-enough' });
    const st = (await testPool.query(`SELECT settings->>'emailVerified' v FROM users WHERE id=$1`, [u.id])).rows[0].v;
    rec('S21a', 'Changing the account email clears the "email verified" flag', st === 'false', 'emailVerified=' + st);
    const d = await A(request(app).get('/api/docs/..'), u.token);
    rec('S21b', 'Document id ".." is rejected before it can reach storage', d.status === 400 || d.status === 501 || d.status === 404, 'status ' + d.status);
  }


  const bad = results.filter(r => !r.secure);
  console.log(`\n===== Security suite (state & integrity): ${results.length - bad.length} secure, ${bad.length} VULNERABLE =====`);
  if (bad.length) console.log('Vulnerable:', bad.map(b => b.id).join(', '));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED:', e); process.exit(2); });
