/* =============================================================================
   SimplyTax - stuck "submitting" recovery
   A deploy/crash while ERiC is working used to leave a return locked as "submitting" FOREVER. The recovery must never
   cause a DOUBLE FILING, so it acts on what submission_approvals says really happened.
   Run: node test/test-submit-recovery.js
============================================================================= */
process.env.ERIC_HERSTELLER_ID = 'TEST1';
const request = require('supertest');
const results = []; const rec = (id, title, ok, d) => { results.push({ id, ok }); console.log(`${ok ? 'OK        ' : 'FAILED    '}  ${id}  ${title}${!ok && d ? '\n              -> ' + d : ''}`); };
const MIN = { meta: { taxYear: 2025 }, hauptvordruck: { personA: { vorname: 'Max', idnr: '12345678901' } } };
const MIN_AGO = (m) => Date.now() - m * 60 * 1000;
(async () => {
  const { app, testPool, ericMock } = require('./harness.js');
  let calls = 0, during = null, delay = 0, result = { rc: 0, sent: true, resultXml: '<ok/>', serverXml: '', transferTicket: 'T-NEW' }, watch = null;
  ericMock.submit = async () => { calls++; if (watch) during = (await testPool.query(`SELECT data->>'submittingSince' s, data->>'status' st FROM clients WHERE id=$1`, [watch])).rows[0]; if (delay) await new Promise(r => setTimeout(r, delay)); return result; };
  const r = await request(app).post('/api/auth/register').send({ name: 'R', email: 'rec@t.test', password: 'passw0rd-long-enough' });
  const T = r.body.token, UID = r.body.user.id; const A = (q) => q.set('Authorization', 'Bearer ' + T);
  let n = 0;
  const mkReturn = async () => { const id = 'rc' + (++n); await A(request(app).put('/api/clients/bulk')).send({ clients: [{ id, taxYear: 2025, p: { firstName: 'Rec' } }] });
    await testPool.query(`UPDATE clients SET data=jsonb_set(data,'{pay}','{"status":"paid"}'::jsonb) WHERE id=$1`, [id]); return id; };
  const lock = (id, since) => since === null
    ? testPool.query(`UPDATE clients SET data=jsonb_set(data,'{status}','"submitting"'::jsonb) WHERE id=$1`, [id])                       // legacy lock: no timestamp
    : testPool.query(`UPDATE clients SET data=jsonb_set(jsonb_set(data,'{status}','"submitting"'::jsonb),'{submittingSince}',$2::jsonb) WHERE id=$1`, [id, JSON.stringify(since)]);
  const attempt = (id, { rc = null, sent = false, ticket = null }) => testPool.query(`INSERT INTO submission_approvals(client_id,user_id,tax_year,approved_payload_sha256,approved_payload_snapshot,submitted,eric_rc,transfer_ticket) VALUES ($1,$2,2025,'h','{}'::jsonb,$3,$4,$5)`, [id, UID, sent, rc, ticket]);
  const state = async (id) => (await testPool.query(`SELECT data->>'status' st, data->>'transferTicket' tt, data->>'submittingSince' ss, submitted_snapshot_sha256 snap FROM clients WHERE id=$1`, [id])).rows[0];
  const submit = (id, extra = {}) => A(request(app).post('/api/eric/submit')).send({ clientId: id, interchangeData: MIN, freigabeConfirmed: true, ...extra });

  { const id = await mkReturn(); watch = id; during = null; calls = 0; const s = await submit(id); watch = null; const st = await state(id);
    rec('L1', 'A normal submit records the lock time while ERiC runs, and clears it when done', s.body.ok === true && !!during && during.st === 'submitting' && !!during.s && st.st === 'submitted' && st.ss === null, JSON.stringify({ during, st })); }
  { const id = await mkReturn(); await lock(id, MIN_AGO(1)); calls = 0; const s = await submit(id);
    rec('L2', 'A FRESH lock (1 minute) is a genuinely running submission: refused (409), ERiC not called', s.status === 409 && s.body.error === 'already_submitted_or_in_progress' && calls === 0, `${s.status} calls=${calls}`); }
  { const id = await mkReturn(); await lock(id, MIN_AGO(11)); await attempt(id, { rc: 0, sent: true, ticket: 'T-SENT' }); calls = 0; const s = await submit(id); const st = await state(id);
    rec('L3', 'Stale lock + the attempt WAS sent: recorded as submitted with its ticket, NOT sent a second time', s.body.ok === true && s.body.recovered === true && s.body.transferTicket === 'T-SENT' && calls === 0 && st.st === 'submitted' && st.tt === 'T-SENT' && !!st.snap, JSON.stringify({ body: s.body, calls, st })); }
  { const id = await mkReturn(); await lock(id, MIN_AGO(11)); await attempt(id, { rc: 610301200, sent: false }); calls = 0; const s = await submit(id); const st = await state(id);
    rec('L4', 'Stale lock + ERiC had REJECTED the attempt (provably not sent): unlocked and the retry goes through', s.body.ok === true && calls === 1 && st.st === 'submitted', `${JSON.stringify(s.body).slice(0, 100)} calls=${calls} ${st.st}`); }
  { const id = await mkReturn(); await lock(id, MIN_AGO(11)); calls = 0; const s = await submit(id);
    rec('L5', 'Stale lock + no attempt record (died before anything was sent): unlocked and submitted', s.body.ok === true && calls === 1, `${s.status} calls=${calls}`); }
  { const id = await mkReturn(); await lock(id, MIN_AGO(11)); await attempt(id, {}); calls = 0; const s = await submit(id); const st = await state(id);
    rec('L6', 'Stale lock + attempt with NO outcome (may or may not have reached the tax office): refused until the customer confirms (409)', s.status === 409 && s.body.error === 'submission_outcome_unknown' && calls === 0 && st.st === 'submitting', `${s.status} ${JSON.stringify(s.body)} calls=${calls} ${st.st}`); }
  { const id = await mkReturn(); await lock(id, MIN_AGO(11)); await attempt(id, {}); calls = 0; const s = await submit(id, { acknowledgeUnknownOutcome: true });
    rec('L7', '...and after the customer explicitly confirms, it is sent', s.body.ok === true && calls === 1, `${s.status} calls=${calls}`); }
  { const id = await mkReturn(); await lock(id, null); calls = 0; const s = await submit(id);
    rec('L8', 'A leftover lock from BEFORE this feature (no timestamp) is treated as stale, not stuck forever', s.body.ok === true && calls === 1, `${s.status} calls=${calls}`); }
  { const id = await mkReturn(); await lock(id, MIN_AGO(11)); calls = 0; delay = 60;
    const both = await Promise.all([submit(id), submit(id)]); delay = 0; const codes = both.map(x => x.status).sort().join(',');
    rec('L9', 'Two simultaneous recoveries of the same stale lock send EXACTLY ONCE', calls === 1 && codes === '200,409', `calls=${calls} statuses=${codes}`); }
  { const id = await mkReturn(); await lock(id, MIN_AGO(1)); const d1 = await A(request(app).delete('/api/clients/' + id));
    const still = (await state(id)); const id2 = await mkReturn(); await lock(id2, MIN_AGO(11)); await A(request(app).delete('/api/clients/' + id2)); const gone = await state(id2);
    rec('L10', 'A running submission cannot be deleted; a STALE lock no longer makes a return undeletable', !!still && !gone, `fresh survived=${!!still} stale deleted=${!gone}`); }
  { await A(request(app).put('/api/clients/bulk')).send({ clients: [{ id: 'forge-lock', taxYear: 2025, submittingSince: 1 }] }); const st = await state('forge-lock');
    rec('L11', 'The browser cannot write the lock timestamp', st && st.ss === null, JSON.stringify(st)); }
  { const id = await mkReturn(); calls = 0; const saved = result; result = { rc: 610301200, sent: false, resultXml: '<err/>', serverXml: '' }; const s = await submit(id); result = saved; const st = await state(id);
    rec('L12', 'A rejected submission (ERiC says not sent) unlocks the return and clears the marker, as before', s.body.ok === false && st.st === 'draft' && st.ss === null, `${JSON.stringify(s.body).slice(0, 80)} ${JSON.stringify(st)}`); }

  const bad = results.filter(x => !x.ok);
  console.log(`\n===== Submit-recovery suite: ${results.length - bad.length} ok, ${bad.length} FAILED =====`); if (bad.length) console.log('Failed:', bad.map(b => b.id).join(', '));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED:', e); process.exit(2); });
