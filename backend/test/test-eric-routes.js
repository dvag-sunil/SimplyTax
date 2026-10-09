/* =============================================================================
   SimplyTax - ERiC route suite: validate-fields / validate / inquiry-message (sends a REAL message to the tax office)
   Run: node test/test-eric-routes.js   (own process: limits are read from env at server start)
============================================================================= */
process.env.ERIC_HERSTELLER_ID = 'TEST1'; process.env.ERIC_VALIDATE_PER_MINUTE = '6';
const request = require('supertest');
const results = []; const rec = (id, title, ok, d) => { results.push({ id, ok }); console.log(`${ok ? 'SECURE    ' : 'VULNERABLE'}  ${id}  ${title}${!ok && d ? '\n              -> ' + d : ''}`); };
let n = 0; const mk = async (app) => { n++; const r = await request(app).post('/api/auth/register').send({ name: 'E' + n, email: `e${n}@er.test`, password: 'passw0rd-long-enough' });
  return { t: r.body.token, id: r.body.user.id }; };
const post = (app, u, url, body) => { const q = request(app).post(url); if (u) q.set('Authorization', 'Bearer ' + u.t); return q.send(body); };
const pdfB64 = Buffer.from('%PDF-1.4\n%fake but starts like a pdf\n').toString('base64');
const FILED = { personA: { vorname: 'Filed', nachname: 'Person', idnr: '12345678901' }, steuernummer: '1111111111', finanzamt: { bufaNr: '9181' } };
const FORGED = { personA: { vorname: 'Forged', nachname: 'Victim', idnr: '99999999999' }, steuernummer: '9999999999', finanzamt: { bufaNr: '9181' } };

(async () => {
  const { app, testPool, ericMock } = require('./harness.js');
  let sentXml = null; ericMock.submit = async (xml) => { sentXml = xml; return { rc: 0, sent: true, resultXml: '<ok/>', serverXml: '', transferTicket: 'T-MSG' }; };
  ericMock._validateFieldsResult = { iban: { valid: true } };
  const A = await mk(app), B = await mk(app), C = await mk(app), D = await mk(app);

  /* ---- validate-fields: input reaches a native library, so it must be plain short strings ---- */
  const v1 = await post(app, A, '/api/eric/validate-fields', { iban: 'DE89370400440532013000' });
  const v2 = await post(app, A, '/api/eric/validate-fields', { steuernummer: '12345', bufaNr: 9181, bundesland: 'HE' });
  rec('R1', 'validate-fields accepts normal strings (and a numeric Finanzamt number, as before)', v1.status === 200 && v2.status === 200, `${v1.status}/${v2.status}`);
  const bad = [{ iban: { $ne: 1 } }, { iban: ['DE89'] }, { iban: 'D'.repeat(5000) }, { steuernummer: 'x'.repeat(31) }, { taxId: true }];
  const codes = []; for (const b of bad) codes.push((await post(app, A, '/api/eric/validate-fields', b)).status);
  rec('R2', 'Objects, arrays, booleans and oversized strings are rejected (400) before reaching ERiC', codes.every(c => c === 400), codes.join(','));

  /* ---- inquiry-message ---- */
  const save = async (u, id) => { await request(app).put('/api/clients/bulk').set('Authorization', 'Bearer ' + u.t).send({ clients: [{ id, taxYear: 2025, inq: [{ id: 'q1', text: 'Rückfrage' }], datenlieferant: { name: 'X' } }] }); };
  const msg = (u, id, extra = {}) => post(app, u, '/api/eric/inquiry-message', { clientId: id, inquiryId: 'q1', text: 'Antwort', hauptvordruck: FORGED, ...extra });
  await save(B, 'nb1');
  const m1 = await msg(B, 'nb1'); sentXml = null;
  rec('R3', 'Message for a return that was NEVER filed through the app is refused (403) - no impersonation via a self-made inquiry', m1.status === 403 && m1.body.error === 'return_not_submitted' && sentXml === null, `${m1.status} ${JSON.stringify(m1.body)}`);
  await save(C, 'nc1');
  await testPool.query(`INSERT INTO submission_approvals(client_id,user_id,tax_year,approved_payload_sha256,approved_payload_snapshot,submitted) VALUES ('nc1',$1,2025,'h',$2::jsonb,true)`, [C.id, JSON.stringify({ meta: { taxYear: 2025 }, hauptvordruck: FILED })]);
  sentXml = null; const m2 = await msg(C, 'nc1');
  rec('R4', 'For a filed return the message is sent (200)', m2.status === 200 && m2.body.ok === true, `${m2.status} ${JSON.stringify(m2.body).slice(0, 160)}`);
  rec('R5', 'The identity in the XML is the FILED return\'s, not the one in the request body', !!sentXml && sentXml.includes('Filed') && !sentXml.includes('Forged') && !sentXml.includes('99999999999'), sentXml ? (sentXml.includes('Forged') ? 'forged identity was sent to ERiC' : 'filed identity missing') : 'nothing sent');
  const other = await msg(D, 'nc1');
  rec('R6', "User D cannot send a message for user C's return", other.status === 404 || other.status === 403, 'status ' + other.status);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
  const a1 = await msg(C, 'nc1', { attachment: { base64: png, filename: 'scan.pdf' } });
  rec('R7', 'An attachment named .pdf whose bytes are not a PDF is rejected (400)', a1.status === 400, 'status ' + a1.status);
  sentXml = null; const a2 = await msg(C, 'nc1', { attachment: { base64: pdfB64, filename: '../../Bescheid 2025.pdf' } });
  const fn = sentXml && /<Dateiname>([^<]*)</.exec(sentXml);
  rec('R8', 'A real PDF is accepted and path characters in its filename are neutralised', a2.status === 200 && (!fn || !/[\\/]/.test(fn[1])), `status ${a2.status} filename=${fn ? fn[1] : '(not in xml)'}`);
  const a3 = await msg(C, 'nc1', { attachment: { base64: { length: 99 }, filename: 'x.pdf' } });
  rec('R9', 'A non-string attachment is rejected (400), not crashed on', a3.status === 400, 'status ' + a3.status);
  process.env.ERIC_SUBMISSION_MODE = 'production'; process.env.REQUIRE_CUSTOMER_CERTIFICATE = 'true';
  const pol = await msg(C, 'nc1');
  process.env.ERIC_SUBMISSION_MODE = 'test'; delete process.env.REQUIRE_CUSTOMER_CERTIFICATE;
  rec('R10', 'In production with customer certificates required, this certificate-less route fails closed (501)', pol.status === 501 && pol.body.error === 'inquiry_requires_customer_certificate', `${pol.status} ${JSON.stringify(pol.body)}`);

  /* ---- init error disclosure ---- */
  ericMock._ready = false; ericMock._initError = 'cannot load /opt/render/project/src/backend/eric-linux/lib/libericapi.so';
  process.env.ERIC_SUBMISSION_MODE = 'production'; const p1 = await post(app, A, '/api/eric/validate-fields', { iban: 'DE89370400440532013000' });
  process.env.ERIC_SUBMISSION_MODE = 'test'; const p2 = await post(app, A, '/api/eric/validate-fields', { iban: 'DE89370400440532013000' });
  ericMock._ready = true;
  rec('R11', 'In production the ERiC init error (server paths) is NOT shown to users; in test mode it still is, for debugging', p1.status === 501 && !JSON.stringify(p1.body).includes('/opt/') && JSON.stringify(p2.body).includes('/opt/'), `prod=${JSON.stringify(p1.body)} test=${JSON.stringify(p2.body).slice(0, 80)}`);

  /* ---- per-user limit on the heavy route (6/min in this test) ---- */
  const st = []; for (let i = 0; i < 8; i++) st.push((await post(app, A, '/api/eric/validate', { clientId: 'zz' + i, interchangeData: { meta: { taxYear: 2025 }, hauptvordruck: { personA: { vorname: 'X', idnr: '12345678901' } } } })).status);
  rec('R12', 'Full validation is limited per user per minute (429 after the limit)', st.indexOf(429) === 6, st.join(','));   // calls 1-6 pass the limiter, the 7th is refused
  const r13 = await post(app, B, '/api/eric/validate', { clientId: 'zzz', interchangeData: { meta: { taxYear: 2025 }, hauptvordruck: { personA: { vorname: 'X', idnr: '12345678901' } } } });
  rec('R13', "One user's limit does not block another user", r13.status !== 429, 'status ' + r13.status);
  rec('R14', 'All four ERiC routes (submit, validate-fields, validate, inquiry-message) require login (401)', (await Promise.all([request(app).post('/api/eric/submit').send({}), request(app).post('/api/eric/validate-fields').send({}), request(app).post('/api/eric/validate').send({}), request(app).post('/api/eric/inquiry-message').send({})])).every(r => r.status === 401));

  const badr = results.filter(r => !r.ok);
  console.log(`\n===== ERiC route suite: ${results.length - badr.length} secure, ${badr.length} VULNERABLE =====`); if (badr.length) console.log('Vulnerable:', badr.map(b => b.id).join(', '));
  process.exit(badr.length ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED:', e); process.exit(2); });
