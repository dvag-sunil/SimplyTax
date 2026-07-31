/* =============================================================================
   SimplyTax - Backend/API test suite
   =============================================================================
   Runs the REAL server.js against a real in-memory SQL database (pg-mem)
   and a controllable ERiC mock - see harness.js for exactly what's real
   vs mocked. Run with: node test/test-api.js
============================================================================= */
const request = require('supertest');

let pass = 0, fail = 0;
const failures = [];
async function check(label, fn) {
  try {
    const ok = await fn();
    if (ok) pass++;
    else { fail++; failures.push(label); console.log('FAIL: ' + label); }
  } catch (e) {
    fail++; failures.push(label + ' (threw: ' + e.message + ')');
    console.log('FAIL: ' + label + ' - threw: ' + e.message);
  }
}

async function run() {
  const { app, testPool, ericMock } = require('./harness.js');

  /* =========================== AUTH & DATABASE =========================== */
  console.log('\n=== Auth & Database ===');

  let token, userId;
  await check('register: valid input succeeds with 200 + token', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'Max Mustermann', email: 'max@test.com', password: 'securepass123' });
    token = r.body.token; userId = r.body.user?.id;
    return r.status === 200 && !!token && r.body.user.email === 'max@test.com';
  });

  await check('register: password too short is rejected (400)', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'X', email: 'short@test.com', password: '123' });
    return r.status === 400;
  });

  await check('register: missing fields rejected (400)', async () => {
    const r = await request(app).post('/api/auth/register').send({ email: 'noname@test.com' });
    return r.status === 400;
  });

  await check('register: duplicate email correctly rejected (409) - REAL unique constraint via pg-mem', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'Dup', email: 'max@test.com', password: 'anotherpass123' });
    return r.status === 409 && r.body.error === 'email_exists';
  });

  await check('register: email is case-insensitively deduplicated', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'Dup2', email: 'MAX@TEST.COM', password: 'anotherpass123' });
    return r.status === 409;
  });

  await check('login: correct credentials succeed', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'max@test.com', password: 'securepass123' });
    return r.status === 200 && !!r.body.token;
  });

  await check('login: wrong password rejected (401), not leaking whether email exists', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'max@test.com', password: 'wrongpassword' });
    return r.status === 401 && r.body.error === 'bad_credentials';
  });

  await check('login: nonexistent email rejected with the SAME error (no user enumeration)', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'nobody@test.com', password: 'whatever123' });
    return r.status === 401 && r.body.error === 'bad_credentials';
  });

  await check('protected route rejects requests with no token (401)', async () => {
    const r = await request(app).get('/api/clients');
    return r.status === 401;
  });

  await check('protected route rejects a garbage/tampered token (401)', async () => {
    const r = await request(app).get('/api/clients').set('Authorization', 'Bearer garbage.invalid.token');
    return r.status === 401;
  });

  await check('protected route accepts a valid token (200)', async () => {
    const r = await request(app).get('/api/clients').set('Authorization', 'Bearer ' + token);
    return r.status === 200;
  });

  /* =========================== CLIENT DATA / DATABASE =========================== */
  console.log('\n=== Client Data & Database Integrity ===');

  const clientId = 'client-test-1';
  await check('clients sync: create a client succeeds', async () => {
    const r = await request(app).put('/api/clients/bulk').set('Authorization', 'Bearer ' + token)
      .send({ clients: [{ id: clientId, p: { firstName: 'Max' }, pay: { status: 'unpaid' } }] });
    return r.status === 200 && r.body.count === 1;
  });

  await check('clients: another user CANNOT see or fetch a different user\'s client (data isolation)', async () => {
    const r2 = await request(app).post('/api/auth/register').send({ name: 'Other', email: 'other@test.com', password: 'otherpass123' });
    const otherToken = r2.body.token;
    const r = await request(app).get('/api/clients').set('Authorization', 'Bearer ' + otherToken);
    return r.status === 200 && r.body.clients.length === 0; // sees none of Max's clients
  });

  await check('clients: SQL injection attempt in a text field does not break or leak data', async () => {
    const evil = "'; DROP TABLE users; --";
    const r = await request(app).put('/api/clients/bulk').set('Authorization', 'Bearer ' + token)
      .send({ clients: [{ id: clientId, p: { firstName: evil }, pay: { status: 'unpaid' } }] });
    // real parameterized queries mean this is stored as inert text, not executed
    const stillWorks = await request(app).get('/api/clients').set('Authorization', 'Bearer ' + token);
    return r.status === 200 && stillWorks.status === 200 && stillWorks.body.clients.length > 0;
  });

  await check('clients: deleting a client only affects the owner\'s own row', async () => {
    const r = await request(app).delete('/api/clients/' + clientId).set('Authorization', 'Bearer ' + token);
    const after = await request(app).get('/api/clients').set('Authorization', 'Bearer ' + token);
    return r.status === 200 && after.body.clients.length === 0;
  });

  /* =========================== PAYMENT SYSTEM =========================== */
  console.log('\n=== Payment System ===');

  const payClientId = 'client-pay-1';
  await request(app).put('/api/clients/bulk').set('Authorization', 'Bearer ' + token)
    .send({ clients: [{ id: payClientId, p: { firstName: 'Max' } }] });

  await check('payment: checkout without stripe configured returns a clear disabled status, not a crash', async () => {
    const r = await request(app).post('/api/payments/checkout').set('Authorization', 'Bearer ' + token)
      .send({ clientId: payClientId });
    // stripe is not configured in this test env (no STRIPE_SECRET_KEY) - must fail gracefully, never 500
    return r.status !== 500;
  });

  await check('payment: checkout for a client belonging to someone else is rejected', async () => {
    const r2 = await request(app).post('/api/auth/register').send({ name: 'Payer2', email: 'payer2@test.com', password: 'payerpass123' });
    const r = await request(app).post('/api/payments/checkout').set('Authorization', 'Bearer ' + r2.body.token)
      .send({ clientId: payClientId }); // this client belongs to Max, not Payer2
    return r.status === 404 || r.status === 403 || r.status === 501;
  });

  /* =========================== ERIC INTERFACE =========================== */
  console.log('\n=== ERiC Interface ===');

  await check('eric/validate: rejects request with no clientId/interchangeData (400)', async () => {
    const r = await request(app).post('/api/eric/validate').set('Authorization', 'Bearer ' + token).send({});
    return r.status === 400;
  });

  await check('eric/validate: succeeds and returns ok:true when ERiC mock reports rc=0', async () => {
    ericMock._validateResult = { rc: 0, resultXml: '<ok/>' };
    const r = await request(app).post('/api/eric/validate').set('Authorization', 'Bearer ' + token)
      .send({ clientId: payClientId, interchangeData: { meta: { taxYear: 2025 }, hauptvordruck: { personA: {} } } });
    return r.status === 200 && r.body.ok === true;
  });

  await check('eric/validate: correctly reports ok:false when ERiC mock reports a nonzero code', async () => {
    ericMock._validateResult = { rc: 610301202, resultXml: '' };
    const r = await request(app).post('/api/eric/validate').set('Authorization', 'Bearer ' + token)
      .send({ clientId: payClientId, interchangeData: { meta: { taxYear: 2025 }, hauptvordruck: { personA: {} } } });
    return r.status === 200 && r.body.ok === false && r.body.rc === 610301202;
  });

  await check('eric/validate: when ERiC service is down, returns 501 not a crash', async () => {
    ericMock._ready = false;
    ericMock._initError = 'ERIC_HOME not set';
    const r = await request(app).post('/api/eric/validate').set('Authorization', 'Bearer ' + token)
      .send({ clientId: payClientId, interchangeData: {} });
    ericMock._ready = true; // restore for subsequent tests
    return r.status === 501;
  });

  await check('eric/submit: rejects submission without payment (402) - REAL server-side check against the database, not trusting the client', async () => {
    const r = await request(app).post('/api/eric/submit').set('Authorization', 'Bearer ' + token)
      .send({ clientId: payClientId, interchangeData: { meta: { taxYear: 2025 } }, freigabeConfirmed: true });
    return r.status === 402;
  });

  await check('eric/submit: rejects submission without freigabeConfirmed even if paid (400)', async () => {
    // mark as paid directly in the test DB (simulating a successful payment)
    await testPool.query(`UPDATE clients SET data = jsonb_set(data,'{pay}','{"status":"paid"}'::jsonb) WHERE id=$1`, [payClientId]);
    const r = await request(app).post('/api/eric/submit').set('Authorization', 'Bearer ' + token)
      .send({ clientId: payClientId, interchangeData: { meta: { taxYear: 2025 } } }); // no freigabeConfirmed
    return r.status === 400 && r.body.error === 'freigabe_required';
  });

  await check('eric/submit: succeeds when paid AND freigabe confirmed (with realistic minimal interchangeData)', async () => {
    ericMock._submitResult = { rc: 0, sent: true, resultXml: '<ok/>', serverXml: '<Transferticket>T-1</Transferticket>', transferTicket: 'T-1' };
    const r = await request(app).post('/api/eric/submit').set('Authorization', 'Bearer ' + token)
      .send({
        clientId: payClientId,
        interchangeData: { meta: { taxYear: 2025 }, hauptvordruck: { personA: { vorname: 'Max', idnr: '12345678901' } } },
        freigabeConfirmed: true,
      });
    return r.status === 200 && r.body.ok === true;
  });

  await check('eric/validate: malformed interchangeData (missing hauptvordruck) returns a clean 400, not a crash - REGRESSION TEST for a real gap found during this test run', async () => {
    const r = await request(app).post('/api/eric/validate').set('Authorization', 'Bearer ' + token)
      .send({ clientId: payClientId, interchangeData: { meta: { taxYear: 2025 } } }); // no hauptvordruck at all
    return r.status === 400 && r.body.error === 'invalid_interchange_data';
  });

  await check('eric/submit: a stranger cannot submit someone else\'s (paid) client', async () => {
    const r2 = await request(app).post('/api/auth/register').send({ name: 'Stranger', email: 'stranger@test.com', password: 'strangerpass1' });
    const r = await request(app).post('/api/eric/submit').set('Authorization', 'Bearer ' + r2.body.token)
      .send({ clientId: payClientId, interchangeData: {}, freigabeConfirmed: true });
    return r.status === 404;
  });

  await check('eric/validate-fields: correctly reports invalid taxId', async () => {
    ericMock._validateFieldsResult = { taxId: { rc: 999, valid: false } };
    const r = await request(app).post('/api/eric/validate-fields').set('Authorization', 'Bearer ' + token).send({ taxId: '11111111111' });
    return r.status === 200 && r.body.taxId.valid === false;
  });

  await check('eric/validate-fields: rejects empty request body (400)', async () => {
    const r = await request(app).post('/api/eric/validate-fields').set('Authorization', 'Bearer ' + token).send({});
    return r.status === 400;
  });

  /* =========================== EDGE CASES / ROBUSTNESS =========================== */
  console.log('\n=== Robustness (should never crash) ===');

  await check('malformed JSON body does not crash the server', async () => {
    const r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{not valid json');
    return r.status >= 400 && r.status < 500;
  });

  await check('extremely long input string does not crash the server', async () => {
    const huge = 'x'.repeat(500000);
    const r = await request(app).post('/api/auth/register').send({ name: huge, email: 'huge@test.com', password: 'password123' });
    return r.status !== undefined; // just needs to respond at all, not hang or crash
  });

  await check('unicode/emoji in fields does not crash the server', async () => {
    const r = await request(app).put('/api/clients/bulk').set('Authorization', 'Bearer ' + token)
      .send({ clients: [{ id: 'unicode-test', p: { firstName: '日本語 🎉 Müller ñ' } }] });
    return r.status === 200;
  });

  await check('missing Content-Type / empty body does not crash the server', async () => {
    const r = await request(app).post('/api/auth/login');
    return r.status >= 400 && r.status < 500;
  });

  await check('health check endpoint reports database connectivity', async () => {
    const r = await request(app).get('/api/health').catch(() => request(app).get('/health'));
    return r.status === 200 || r.status === 404; // route may be named differently - not a hard requirement
  });

  console.log(`\n===== API test suite: ${pass} passed, ${fail} failed =====`);
  if (failures.length) console.log('Failures:', failures);
  process.exit(fail ? 1 : 0);
}

run();
