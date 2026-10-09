/* =============================================================================
   SimplyTax - Payment security suite
   Runs the REAL server.js with STRIPE and PAYPAL enabled against fakes:
     - 'stripe' is the real library (real webhook signature code) with only the network calls replaced
     - global fetch is replaced to emulate PayPal's API
   Run: node test/test-payments.js     (own process: needs env set before the server loads)
============================================================================= */
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';
process.env.PAYPAL_CLIENT_ID = 'pp_client'; process.env.PAYPAL_CLIENT_SECRET = 'pp_secret'; process.env.PAYPAL_WEBHOOK_ID = 'WH-1';
const Module = require('module'); const request = require('supertest');
const RealStripe = require('stripe');
const fakeSessions = {};                                   // sessionId -> session object the "Stripe API" would return
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'stripe') return (key) => { const s = RealStripe(key);
    s.checkout.sessions.retrieve = async (id) => fakeSessions[id];
    s.checkout.sessions.list = async ({ payment_intent }) => ({ data: Object.values(fakeSessions).filter(x => x.payment_intent === payment_intent) });
    return s; };
  return origLoad.call(this, req, ...rest);
};
/* ---- PayPal fake ---- */
const pp = { orders: {}, verify: 'SUCCESS' };               // orderId -> { custom, cents, currency, status, captured }
global.fetch = async (url, opts = {}) => {
  const u = String(url), json = (o, ok = true, status = 200) => ({ ok, status, json: async () => o, text: async () => JSON.stringify(o) });
  if (u.endsWith('/v1/oauth2/token')) return json({ access_token: 'tok', expires_in: 3600 });
  if (u.includes('/v1/notifications/verify-webhook-signature')) return json({ verification_status: pp.verify });
  let m = u.match(/\/v2\/checkout\/orders\/([^/]+)\/capture$/);
  if (m) { const o = pp.orders[m[1]]; if (!o) return json({ name: 'RESOURCE_NOT_FOUND' }, false, 404);
    if (o.captured) return json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }, false, 422);
    o.captured = true; return json(orderBody(m[1])); }
  m = u.match(/\/v2\/checkout\/orders\/([^/?]+)$/);
  if (m && pp.orders[m[1]]) return json(orderBody(m[1]));
  return json({ error: 'unexpected fetch ' + u }, false, 500);
};
const orderBody = (id) => { const o = pp.orders[id]; return { id, status: 'COMPLETED', purchase_units: [{ custom_id: JSON.stringify(o.custom),
  payments: { captures: [{ id: 'CAP-' + id, status: o.capStatus || 'COMPLETED', custom_id: JSON.stringify(o.custom), amount: { currency_code: o.currency || 'EUR', value: (o.cents / 100).toFixed(2) } }] } }] }; };

const results = []; const rec = (id, title, secure, d) => { results.push({ id, secure }); console.log(`${secure ? 'SECURE    ' : 'VULNERABLE'}  ${id}  ${title}${!secure && d ? '\n              -> ' + d : ''}`); };
let n = 0; const mk = async (app) => { n++; const r = await request(app).post('/api/auth/register').send({ name: 'P' + n, email: `p${n}@pay.test`, password: 'passw0rd-long-enough' });
  const t = r.body.token, id = r.body.user.id; return { t, id, A: (q) => q.set('Authorization', 'Bearer ' + t) }; };
const payOf = async (testPool, cid) => (await testPool.query(`SELECT data->'pay'->>'status' s FROM clients WHERE id=$1`, [cid])).rows[0]?.s;
const stripeEvent = (stripe, type, obj) => { const payload = JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2), object: 'event', type, data: { object: obj } });
  return { payload, sig: stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) }; };
const wh = (app, e) => request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', e.sig).send(e.payload);

(async () => {
  const { app, testPool } = require('./harness.js'); const stripe = RealStripe('sk_test_dummy');
  const cents = 1799;
  /* ---------- Stripe ---------- */
  { const u = await mk(app); await u.A(request(app).put('/api/clients/bulk')).send({ clients: [{ id: 'st1', taxYear: 2025 }] });
    const bad = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', 't=1,v1=deadbeef').send('{"type":"checkout.session.completed"}');
    rec('P1', 'Stripe webhook with a forged signature is rejected (400)', bad.status === 400, 'status ' + bad.status);
    const sess = { id: 'cs_1', object: 'checkout.session', payment_status: 'paid', amount_total: cents, payment_intent: 'pi_1', metadata: { userId: u.id, clientId: 'st1' } };
    fakeSessions.cs_1 = sess;
    const ok = await wh(app, stripeEvent(stripe, 'checkout.session.completed', sess));
    rec('P2', 'A correctly signed Stripe "completed" webhook marks the return paid', ok.status === 200 && await payOf(testPool, 'st1') === 'paid', `http ${ok.status}, pay=${await payOf(testPool, 'st1')}`);
    const r1 = await wh(app, stripeEvent(stripe, 'charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', amount: cents, amount_refunded: cents }));
    rec('P3', 'Stripe refund webhook marks the return refunded', await payOf(testPool, 'st1') === 'refunded', 'pay=' + await payOf(testPool, 'st1'));
    await u.A(request(app).post('/api/payments/verify')).send({ sessionId: 'cs_1' });          // customer replays their old payment reference
    rec('P4', 'REFUND REPLAY: re-calling /payments/verify with the old session must NOT make a refunded return paid again', await payOf(testPool, 'st1') === 'refunded', 'pay=' + await payOf(testPool, 'st1') + ' (customer got a refund AND kept filing)');
    await wh(app, stripeEvent(stripe, 'checkout.session.completed', sess));                      // late / duplicate delivery of the original event
    rec('P5', 'A late duplicate "completed" webhook after a refund must NOT re-mark it paid', await payOf(testPool, 'st1') === 'refunded', 'pay=' + await payOf(testPool, 'st1'));
    const sess2 = { ...sess, id: 'cs_2', payment_intent: 'pi_2' }; fakeSessions.cs_2 = sess2;
    await u.A(request(app).post('/api/payments/verify')).send({ sessionId: 'cs_2' });
    rec('P6', 'A genuinely NEW payment after a refund (new session) does unlock the return again', await payOf(testPool, 'st1') === 'paid', 'pay=' + await payOf(testPool, 'st1'));
    const other = await mk(app); fakeSessions.cs_3 = { ...sess, id: 'cs_3', metadata: { userId: u.id, clientId: 'st1' } };
    const steal = await other.A(request(app).post('/api/payments/verify')).send({ sessionId: 'cs_3' });
    rec('P7', "User B cannot claim user A's payment session via /payments/verify", steal.body.paid === false, JSON.stringify(steal.body));
  }
  /* ---------- PayPal ---------- */
  { const u = await mk(app); await u.A(request(app).put('/api/clients/bulk')).send({ clients: [{ id: 'pp1', taxYear: 2025 }, { id: 'pp2', taxYear: 2025 }, { id: 'pp3', taxYear: 2025 }] });
    pp.orders.O1 = { custom: { userId: u.id, clientId: 'pp1', discountCode: '' }, cents };
    const c1 = await u.A(request(app).post('/api/payments/paypal/capture')).send({ orderId: 'O1' });
    rec('P8', 'PayPal capture of a normal order marks the return paid', c1.body.paid === true && await payOf(testPool, 'pp1') === 'paid', JSON.stringify(c1.body));
    pp.orders.O1.captured = true;
    const ref = { id: 'CAP-O1', custom_id: JSON.stringify(pp.orders.O1.custom), amount: { value: '17.99', currency_code: 'EUR' } };
    pp.verify = 'SUCCESS'; await request(app).post('/api/payments/paypal/webhook').set('Content-Type', 'application/json').send(JSON.stringify({ event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: ref }));
    rec('P9', 'PayPal refund webhook marks the return refunded', await payOf(testPool, 'pp1') === 'refunded', 'pay=' + await payOf(testPool, 'pp1'));
    await u.A(request(app).post('/api/payments/paypal/capture')).send({ orderId: 'O1' });       // replay the old order id
    rec('P10', 'REFUND REPLAY: re-calling /paypal/capture with the old order id must NOT make a refunded return paid again', await payOf(testPool, 'pp1') === 'refunded', 'pay=' + await payOf(testPool, 'pp1'));
    pp.orders.O2 = { custom: { userId: u.id, clientId: 'pp2', discountCode: '' }, cents: 1 };                    // forged/cheap order: 1 cent
    const c2 = await u.A(request(app).post('/api/payments/paypal/capture')).send({ orderId: 'O2' });
    rec('P11', 'A PayPal order captured for 0.01 EUR does NOT unlock a return (amount is checked against the price)', c2.body.paid !== true && await payOf(testPool, 'pp2') !== 'paid', 'pay=' + await payOf(testPool, 'pp2'));
    pp.orders.O3 = { custom: { userId: u.id, clientId: 'pp3', discountCode: '' }, cents, currency: 'HUF' };     // 17.99 HUF is only a few cents
    const c3 = await u.A(request(app).post('/api/payments/paypal/capture')).send({ orderId: 'O3' });
    rec('P12', 'A PayPal order paid in another currency (HUF) does NOT unlock a return', c3.body.paid !== true && await payOf(testPool, 'pp3') !== 'paid', 'pay=' + await payOf(testPool, 'pp3'));
    pp.verify = 'FAILURE';
    const uw = await request(app).post('/api/payments/paypal/webhook').set('Content-Type', 'application/json').send(JSON.stringify({ event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'O1' } }));
    rec('P13', 'PayPal webhook that PayPal itself does not verify is rejected (400)', uw.status === 400, 'status ' + uw.status); pp.verify = 'SUCCESS';
    const d = await u.A(request(app).post('/api/payments/discount-preview')).send({ code: 'NOPE' });
    rec('P14', 'Discount preview does not reveal or accept unknown codes', d.body.valid === false, JSON.stringify(d.body));
  }

  /* ---------- edge cases ---------- */
  { const u = await mk(app); await u.A(request(app).put('/api/clients/bulk')).send({ clients: [{ id: 'e1', taxYear: 2025 }, { id: 'e2', taxYear: 2025 }, { id: 'e3', taxYear: 2025 }] });
    pp.orders.O4 = { custom: { userId: u.id, clientId: 'e1', discountCode: '' }, cents, capStatus: 'PENDING' };
    const c = await u.A(request(app).post('/api/payments/paypal/capture')).send({ orderId: 'O4' });
    rec('P15', 'A PENDING PayPal capture (money not received yet) does not unlock the return', c.body.paid === false && await payOf(testPool, 'e1') !== 'paid', JSON.stringify(c.body) + ' pay=' + await payOf(testPool, 'e1'));
    pp.verify = 'SUCCESS';
    const cap = { id: 'CAP-O4', status: 'COMPLETED', custom_id: JSON.stringify(pp.orders.O4.custom), amount: { value: '17.99', currency_code: 'EUR' }, supplementary_data: { related_ids: { order_id: 'O4' } } };
    await request(app).post('/api/payments/paypal/webhook').set('Content-Type', 'application/json').send(JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: cap }));
    rec('P16', 'The later PAYMENT.CAPTURE.COMPLETED webhook unlocks that return', await payOf(testPool, 'e1') === 'paid', 'pay=' + await payOf(testPool, 'e1'));
    const before = (await testPool.query(`SELECT data->'pay'->>'paidAt' t FROM clients WHERE id='e1'`)).rows[0].t;
    await new Promise(r => setTimeout(r, 25));
    await request(app).post('/api/payments/paypal/webhook').set('Content-Type', 'application/json').send(JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: cap }));
    const after = (await testPool.query(`SELECT data->'pay'->>'paidAt' t FROM clients WHERE id='e1'`)).rows[0].t;
    rec('P17', 'A duplicate delivery of the same payment is a no-op (paidAt is not rewritten)', before === after, `${before} -> ${after}`);
    pp.orders.O5 = { custom: { userId: u.id, clientId: 'e2', discountCode: '' }, cents: 5 };
    await request(app).post('/api/payments/paypal/webhook').set('Content-Type', 'application/json').send(JSON.stringify({ event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'O5' } }));
    rec('P18', 'A 0.05 EUR order approved via the webhook backup-capture path does not unlock a return', await payOf(testPool, 'e2') !== 'paid', 'pay=' + await payOf(testPool, 'e2'));
    pp.orders.O6 = { custom: { userId: u.id, clientId: 'e3', discountCode: '' }, cents };
    await request(app).post('/api/payments/paypal/webhook').set('Content-Type', 'application/json').send(JSON.stringify({ event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'O6' } }));
    rec('P19', 'A normal order approved via the webhook backup-capture path (customer never returned to the site) is unlocked', await payOf(testPool, 'e3') === 'paid', 'pay=' + await payOf(testPool, 'e3'));
  }

  const bad = results.filter(r => !r.secure);
  console.log(`\n===== Payment suite: ${results.length - bad.length} secure, ${bad.length} VULNERABLE =====`); if (bad.length) console.log('Vulnerable:', bad.map(b => b.id).join(', '));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED:', e); process.exit(2); });
