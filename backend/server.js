/* SimplyTax Backend — REST API (Node.js + Express + PostgreSQL)
   Security: JWT auth, bcrypt, Helmet, CORS locked to the frontend origin, rate limiting, parameterized queries.
   Flexibility: client data stored as JSONB — new frontend fields need no schema change. */
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { DATABASE_URL, JWT_SECRET, ALLOWED_ORIGIN = 'https://dvag-sunil.github.io', PORT = 3000 } = process.env;
if (!DATABASE_URL || !JWT_SECRET) { console.error('Missing DATABASE_URL or JWT_SECRET in .env'); process.exit(1); }

const pool = new Pool({ connectionString: DATABASE_URL });
const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGIN.split(','), credentials: false }));

/* ---------- Reminder emails: paid-but-not-submitted returns (Resend, EU-capable) ---------- */
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const REMINDER_FROM = process.env.REMINDER_FROM || 'SimplyTax <reminders@your-domain.de>';
const REMINDER_DAYS = parseInt(process.env.REMINDER_DAYS || '3', 10);
const REMINDER_CRON_SECRET = process.env.REMINDER_CRON_SECRET || '';
async function sendReminderEmail(to, name, taxYear){
  if(!RESEND_API_KEY || !to) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method:'POST', headers:{ Authorization:'Bearer '+RESEND_API_KEY, 'Content-Type':'application/json' },
    body: JSON.stringify({ from: REMINDER_FROM, to,
      subject: `Your ${taxYear} tax return is paid but not yet submitted`,
      html: `<p>Hi ${name},</p><p>Your ${taxYear} tax return with SimplyTax was paid but has not yet been submitted to the Finanzamt. Please log in to review and submit, or reply if you need help.</p><p>— SimplyTax</p>` })
  });
  return r.ok;
}
/* Cron entry point: call this daily from Render Cron Job / cron-job.org / GitHub Actions,
   with header x-cron-secret matching REMINDER_CRON_SECRET. Finds clients paid >= REMINDER_DAYS
   ago and still not submitted, emails them once (marks reminded_at to avoid repeat sends). */
app.post('/api/reminders/run', async (req, res) => {
  if(!REMINDER_CRON_SECRET || req.headers['x-cron-secret'] !== REMINDER_CRON_SECRET)
    return res.status(401).json({ error: 'unauthorized' });
  if(!RESEND_API_KEY) return res.status(501).json({ error: 'email_disabled', note: 'set RESEND_API_KEY to activate' });
  const cutoff = Date.now() - REMINDER_DAYS*86400000;
  const { rows } = await pool.query(
    `SELECT id, user_id, data FROM clients
     WHERE data->'pay'->>'status' = 'paid'
       AND data->>'status' != 'submitted'
       AND (data->'pay'->>'paidAt')::bigint <= $1
       AND (data->>'reminded_at' IS NULL)`, [cutoff]);
  let sent = 0;
  for(const row of rows){
    const c = row.data; const email = c.contactEmail || '';   // populate this field if/when collected
    const ok = await sendReminderEmail(email, (c.p?.firstName||'')+' '+(c.p?.lastName||''), c.taxYear);
    if(ok){ sent++;
      await pool.query(`UPDATE clients SET data = jsonb_set(data,'{reminded_at}', to_jsonb(extract(epoch from now())*1000)) WHERE id=$1`, [row.id]);
      audit(row.user_id, 'reminder_sent', { clientId: row.id });
    }
  }
  res.json({ checked: rows.length, sent });
});

/* ---------- Stripe (Level B: Checkout + webhook, tamper-proof) ---------- */
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const PRICE_CENTS = parseInt(process.env.PRICE_CENTS || '995', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://dvag-sunil.github.io/SimplyTax/';

/* ---------- Supabase Storage for Belege (private bucket, service key server-side only) ---------- */
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BELEGE_BUCKET = 'belege';
const DOC_MAX_BYTES = 5 * 1024 * 1024;
const DOC_MIME_OK = m => /^image\//.test(m) || m === 'application/pdf'
  || m === 'application/msword'
  || m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const sbHeaders = () => ({ Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, apikey: SUPABASE_SERVICE_KEY });
const storageOn = () => !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
async function sbEnsureBucket(){
  if (!storageOn()) return;
  try {
    const r = await fetch(SUPABASE_URL + '/storage/v1/bucket', {
      method: 'POST', headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: BELEGE_BUCKET, name: BELEGE_BUCKET, public: false, file_size_limit: DOC_MAX_BYTES }) });
    if (!r.ok && r.status !== 409) console.error('bucket create:', r.status, await r.text());
  } catch (e) { console.error('bucket create failed:', e.message); }
}
sbEnsureBucket();
async function markPaid(userId, clientId, sessionId, amountCents){
  await pool.query(
    `INSERT INTO payments(user_id, client_id, session_id, amount_cents, status)
     VALUES ($1,$2,$3,$4,'paid') ON CONFLICT (session_id) DO NOTHING`,
    [userId, clientId, sessionId, amountCents]);
  await pool.query(
    `UPDATE clients SET data = jsonb_set(data, '{pay}',
       jsonb_build_object('status','paid','paidAt', (extract(epoch from now())*1000)::bigint,
                          'amount', $3::numeric/100, 'txId', $4::text), true),
       updated_at = now()
     WHERE id=$1 AND user_id=$2`,
    [clientId, userId, amountCents, sessionId.slice(0,24)]);
}
/* webhook uses the RAW body for signature verification — registered before express.json */
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(501).json({ error: 'stripe_disabled' });
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch (e) { return res.status(400).json({ error: 'bad_signature' }); }
  if (event.type === 'checkout.session.completed') {
    const sess = event.data.object;
    if (sess.payment_status === 'paid' && sess.metadata?.userId && sess.metadata?.clientId) {
      await markPaid(sess.metadata.userId, sess.metadata.clientId, sess.id, sess.amount_total || PRICE_CENTS);
      audit(sess.metadata.userId, 'payment_webhook', { clientId: sess.metadata.clientId, session: sess.id });
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));

/* ---------- AI document extraction (Lohnsteuerbescheinigung -> structured fields) ----------
   The API key lives ONLY here, server-side. The frontend never talks to api.anthropic.com
   directly — doing so from a static GitHub Pages site would require exposing the secret key
   in public JS, which is why the earlier direct-fetch version silently failed once deployed. */
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const EXTRACT_MODEL = process.env.EXTRACT_MODEL || 'claude-haiku-4-5-20251001';   // cheapest current tier, plenty for structured OCR-style extraction
app.post('/api/extract-doc', auth, async (req, res) => {
  if(!ANTHROPIC_API_KEY) return res.status(501).json({ error: 'extraction_disabled', note: 'set ANTHROPIC_API_KEY to activate' });
  const { dataUrl, prompt } = req.body || {};
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if(!m || !prompt) return res.status(400).json({ error: 'invalid_input' });
  const mime = m[1].toLowerCase(), b64 = m[2];
  const block = mime==='application/pdf'
    ? { type:'document', source:{ type:'base64', media_type:'application/pdf', data:b64 } }
    : { type:'image', source:{ type:'base64', media_type:mime, data:b64 } };
  try{
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key':ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:EXTRACT_MODEL, max_tokens:1000,
        messages:[{ role:'user', content:[block, {type:'text', text:prompt}] }] })
    });
    if(!r.ok){ const t=await r.text(); console.error('extract-doc:', r.status, t); return res.status(502).json({ error:'ai_provider_error' }); }
    const data = await r.json();
    audit(req.user.sub, 'doc_extracted', { mime });
    res.json(data);   // frontend parses .content the same way it always did
  }catch(e){ console.error('extract-doc failed:', e.message); res.status(502).json({ error:'ai_provider_error' }); }
});

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));   // brute-force protection
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));

const sign = (u) => jwt.sign({ sub: u.id, role: u.role }, JWT_SECRET, { expiresIn: '12h' });
const pubUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, settings: u.settings, twoFA: u.two_fa });

/* auth middleware — every data route requires a valid token */
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'auth_required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'invalid_token' }); }
}
/* role guard — prepared for the roles stage: use requireRole('admin') on future admin routes */
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'forbidden' });

const audit = (userId, action, detail = {}) =>
  pool.query('INSERT INTO audit_log(user_id, action, detail) VALUES ($1,$2,$3)', [userId, action, detail]).catch(() => {});

/* ---------- health (for monitoring tools like Uptime Kuma / Grafana) ---------- */
app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: true, ts: new Date().toISOString() }); }
  catch { res.status(500).json({ ok: false, db: false }); }
});

/* ---------- auth ---------- */
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'invalid_input' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const q = await pool.query(
      'INSERT INTO users(email, name, password_hash) VALUES ($1,$2,$3) RETURNING *',
      [email.toLowerCase().trim(), name.trim(), hash]);
    const u = q.rows[0];
    audit(u.id, 'register');
    res.json({ token: sign(u), user: pubUser(u) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'email_exists' });
    console.error(e); res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const q = await pool.query('SELECT * FROM users WHERE email=$1', [String(email || '').toLowerCase().trim()]);
  const u = q.rows[0];
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash)))
    return res.status(401).json({ error: 'bad_credentials' });
  audit(u.id, 'login');
  res.json({ token: sign(u), user: pubUser(u) });
});

/* ---------- Password reset via emailed link (Resend; dormant until RESEND_API_KEY is set) ----------
   Security model: response never reveals whether an account exists; token is random 256-bit,
   stored only as a SHA-256 hash inside users.settings (no schema change), 1-hour expiry, single-use. */
const cryptoNode = require('crypto');
const sha256 = s => cryptoNode.createHash('sha256').update(s).digest('hex');
app.post('/api/auth/forgot', async (req, res) => {
  const { email } = req.body || {};
  res.json({ ok: true, emailEnabled: !!RESEND_API_KEY });   // identical shape whether or not the account exists
  if(!email || !RESEND_API_KEY) return;
  try{
    const { rows } = await pool.query('SELECT id, name FROM users WHERE email=$1', [String(email).toLowerCase()]);
    if(!rows.length) return;
    const token = cryptoNode.randomBytes(32).toString('hex');
    const pwreset = { th: sha256(token), exp: Date.now() + 60*60*1000 };
    await pool.query(`UPDATE users SET settings = jsonb_set(settings,'{pwreset}',$1::jsonb) WHERE id=$2`,
      [JSON.stringify(pwreset), rows[0].id]);
    const link = FRONTEND_URL + '?reset=' + token + '&email=' + encodeURIComponent(String(email).toLowerCase());
    await fetch('https://api.resend.com/emails', { method:'POST',
      headers:{ Authorization:'Bearer '+RESEND_API_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ from: REMINDER_FROM, to: email, subject: 'Reset your SimplyTax password',
        html: `<p>Hi ${rows[0].name},</p><p>Use the link below to set a new password (valid for 1 hour, one use only):</p><p><a href="${link}">${link}</a></p><p>If you did not request this, simply ignore this email — your password stays unchanged.</p><p>— SimplyTax</p>` }) });
    audit(rows[0].id, 'pw_reset_requested', {});
  }catch(e){ console.error('forgot failed:', e.message); }
});
app.post('/api/auth/reset', async (req, res) => {
  const { email, token, password } = req.body || {};
  if(!email || !token || !password || String(password).length < 8) return res.status(400).json({ error: 'invalid_input' });
  const { rows } = await pool.query('SELECT id, settings FROM users WHERE email=$1', [String(email).toLowerCase()]);
  const pr = rows[0]?.settings?.pwreset;
  if(!pr || pr.th !== sha256(String(token)) || pr.exp < Date.now()) return res.status(400).json({ error: 'invalid_or_expired' });
  const hash = await bcrypt.hash(String(password), 12);
  await pool.query(`UPDATE users SET password_hash=$1, settings = settings - 'pwreset' WHERE id=$2`, [hash, rows[0].id]);
  audit(rows[0].id, 'pw_reset_done', {});
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, async (req, res) => {
  const q = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.sub]);
  if (!q.rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json({ user: pubUser(q.rows[0]) });
});

app.put('/api/auth/settings', auth, async (req, res) => {
  await pool.query('UPDATE users SET settings=$1 WHERE id=$2', [req.body?.settings || {}, req.user.sub]);
  res.json({ ok: true });
});

/* ---------- clients (each row = one client/return, full object as JSONB) ---------- */
app.get('/api/clients', auth, async (req, res) => {
  const q = await pool.query('SELECT data FROM clients WHERE user_id=$1 ORDER BY updated_at DESC', [req.user.sub]);
  res.json({ clients: q.rows.map(r => r.data) });
});

/* bulk sync: upsert everything the frontend sends, delete what it no longer has */
app.put('/api/clients/bulk', auth, async (req, res) => {
  const clients = Array.isArray(req.body?.clients) ? req.body.clients : null;
  if (!clients) return res.status(400).json({ error: 'invalid_input' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const ids = clients.map(c => c.id).filter(Boolean);
    if (ids.length) await db.query('DELETE FROM clients WHERE user_id=$1 AND NOT (id = ANY($2))', [req.user.sub, ids]);
    else await db.query('DELETE FROM clients WHERE user_id=$1', [req.user.sub]);
    for (const c of clients) {
      if (!c.id) continue;
      await db.query(
        `INSERT INTO clients(id, user_id, data, updated_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (id) DO UPDATE SET data=$3, updated_at=now() WHERE clients.user_id=$2`,
        [c.id, req.user.sub, c]);
    }
    await db.query('COMMIT');
    audit(req.user.sub, 'clients_sync', { count: clients.length });
    res.json({ ok: true, count: clients.length });
  } catch (e) { await db.query('ROLLBACK'); console.error(e); res.status(500).json({ error: 'server_error' });
  } finally { db.release(); }
});

app.delete('/api/clients/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.user.sub]);
  res.json({ ok: true });
});

/* create a Checkout session for one return */
app.post('/api/payments/checkout', auth, async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'stripe_disabled' });
  const { clientId } = req.body || {};
  if (!clientId) return res.status(400).json({ error: 'invalid_input' });
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: PRICE_CENTS,
      product_data: { name: 'SimplyTax — Freischaltung Steuererklärung' } } }],
    client_reference_id: clientId,
    metadata: { userId: req.user.sub, clientId },
    success_url: FRONTEND_URL + '?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: FRONTEND_URL,
  });
  res.json({ url: session.url });
});

/* frontend verification after redirect (webhook remains the source of truth) */
app.post('/api/payments/verify', auth, async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'stripe_disabled' });
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'invalid_input' });
  const sess = await stripe.checkout.sessions.retrieve(sessionId);
  const paid = sess.payment_status === 'paid' && sess.metadata?.userId === req.user.sub;
  if (paid) await markPaid(req.user.sub, sess.metadata.clientId, sess.id, sess.amount_total || PRICE_CENTS);
  res.json({ paid, clientId: sess.metadata?.clientId || null });
});

/* ---------- Belege (documents) ---------- */
app.post('/api/docs', auth, async (req, res) => {
  if (!storageOn()) return res.status(501).json({ error: 'storage_disabled' });
  const { id, dataUrl } = req.body || {};
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!id || !m) return res.status(400).json({ error: 'invalid_input' });
  const mime = m[1].toLowerCase();
  if (!DOC_MIME_OK(mime)) return res.status(415).json({ error: 'bad_type' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > DOC_MAX_BYTES) return res.status(413).json({ error: 'too_large' });
  const path = `${req.user.sub}/${encodeURIComponent(id)}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BELEGE_BUCKET}/${path}`, {
    method: 'POST', headers: { ...sbHeaders(), 'Content-Type': mime, 'x-upsert': 'true' }, body: buf });
  if (!r.ok) { console.error('doc upload:', r.status, await r.text()); return res.status(502).json({ error: 'storage_error' }); }
  audit(req.user.sub, 'doc_upload', { id, bytes: buf.length, mime });
  res.json({ ok: true });
});

app.get('/api/docs/:id', auth, async (req, res) => {
  if (!storageOn()) return res.status(501).json({ error: 'storage_disabled' });
  const path = `${req.user.sub}/${encodeURIComponent(req.params.id)}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BELEGE_BUCKET}/${path}`, {
    method: 'POST', headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 600 }) });
  if (!r.ok) return res.status(404).json({ error: 'not_found' });
  const j = await r.json();
  res.json({ url: SUPABASE_URL + '/storage/v1' + j.signedURL });
});

app.delete('/api/docs/:id', auth, async (req, res) => {
  if (!storageOn()) return res.status(501).json({ error: 'storage_disabled' });
  const path = `${req.user.sub}/${encodeURIComponent(req.params.id)}`;
  await fetch(`${SUPABASE_URL}/storage/v1/object/${BELEGE_BUCKET}/${path}`, { method: 'DELETE', headers: sbHeaders() });
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`SimplyTax API listening on :${PORT}`));
