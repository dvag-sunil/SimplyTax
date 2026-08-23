/* SimplyTax Backend — REST API (Node.js + Express + PostgreSQL)
   Security: JWT auth, bcrypt, Helmet, CORS locked to the frontend origin, rate limiting, parameterized queries.
   Flexibility: client data stored as JSONB — new frontend fields need no schema change. */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
/* Certificate loading - prefers ERIC_CERT_B64 (a base64-encoded copy of
   the .pfx, set as a plain env var) over ERIC_CERT_PATH directly.
   CONFIRMED real reason: uploading the raw binary .pfx via Render's
   Secret Files produced a corrupted copy (23,888 bytes vs the real
   13,175 - the classic signature of binary data being mangled by a
   text/UTF-8 reinterpretation somewhere in the upload path). Base64 is
   plain ASCII and can't be corrupted this way, so it's decoded back
   into a real binary file fresh at every startup instead. */
if (process.env.ERIC_CERT_B64) {
  const certPath = path.join('/tmp', 'certificate.pfx');
  fs.writeFileSync(certPath, Buffer.from(process.env.ERIC_CERT_B64, 'base64'));
  process.env.ERIC_CERT_PATH = certPath;
  const stats = fs.statSync(certPath);
  console.log('[debug] decoded certificate file size:', stats.size, 'bytes');
} else if (process.env.ERIC_CERT_PATH) {
  try {
    const stats = fs.statSync(process.env.ERIC_CERT_PATH);
    console.log('[debug] certificate file size:', stats.size, 'bytes');
  } catch (e) {
    console.log('[debug] could not read certificate file:', e.message);
  }
}
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const ericService = require('./eric/eric-service');
const { buildEStXML, InterchangeDataError, classifySkippedSections } = require('./eric/xml-builder');

const { DATABASE_URL, JWT_SECRET, ALLOWED_ORIGIN = 'https://dvag-sunil.github.io', PORT = 3000 } = process.env;
if (!DATABASE_URL || !JWT_SECRET) { console.error('Missing DATABASE_URL or JWT_SECRET in .env'); process.exit(1); }

/* CORRECTED: hardened CORS setup, added directly in response to a real
   reported outage where login failed with a CORS error in the browser.
   Two real, separate improvements here:
   1) .trim() on each allowed origin - a genuine, common cause of silent
      CORS mismatches is a trailing space or newline accidentally left
      in the ALLOWED_ORIGIN environment variable on the hosting
      platform, which makes the string comparison fail even though the
      value looks correct when viewed in a dashboard.
   2) An explicit origin-check function that logs any rejected origin
      directly to the server's own logs. Without this, a genuine
      mismatch is only ever visible as an opaque "CORS policy" message
      in the browser - the server-side log is what actually shows
      whether the incoming origin matched what's configured, which is
      the real, direct way to diagnose this class of issue instead of
      guessing from the browser error alone. */
const allowedOrigins = ALLOWED_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
/* CORRECTED: real, confirmed vulnerability found while investigating a
   reported login failure with the service itself reporting healthy -
   JavaScript's default-parameter syntax above (ALLOWED_ORIGIN = '...')
   only ever applies when the variable is genuinely undefined, never
   when it's an empty string. If ALLOWED_ORIGIN is set to an empty
   value on the hosting platform - not unset, but literally blank, an
   easy accidental dashboard state - the default never kicks in,
   silently producing zero allowed origins here and rejecting every
   single request. That matches a consistent, repeated CORS failure
   with the service itself still reporting up exactly, since the
   server genuinely started fine - only this one list ended up empty.
   Explicit fallback added for this case, plus a startup log printing
   the actual, effective list, so this is directly checkable in the
   server's own logs instead of guessed at from the browser side. */
if (allowedOrigins.length === 0) allowedOrigins.push('https://dvag-sunil.github.io');
console.log('[cors] allowed origins:', allowedOrigins);
const corsOptions = {
  origin: (origin, callback) => {
    // Server-to-server requests (no Origin header at all, e.g. curl or the health check) are allowed through.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    console.error(`[cors] rejected request from origin "${origin}" - allowed origins are: ${allowedOrigins.join(', ')}`);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-cron-secret'],
  credentials: false,
};

/* Process-level crash visibility - server.js requires several other
   files at startup (eric-service, xml-builder) and connects to the
   database immediately after. Any uncaught error in that startup path,
   or a database connection failure, would otherwise kill the process
   with no clear trace in the logs - and from the browser, a server
   that never comes up looks identical to a CORS error, since no
   response (preflight included) ever comes back at all. These
   handlers make sure the actual cause is always visible in the logs
   rather than a silent exit. */
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled rejection:', reason);
});

const pool = new Pool({ connectionString: DATABASE_URL });
const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors(corsOptions));
/* Explicit preflight handling for every route - the cors middleware
   above already does this automatically in most cases, but making it
   explicit here means an OPTIONS request can never silently fall
   through to a route handler that doesn't expect it. */
app.options('*', cors(corsOptions));

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
/* IMPLEMENTED: a generic security-notification email, reusing the exact
   same Resend API call already established above for reminder emails -
   same dormant-until-configured behavior, same best-effort semantics
   (a failed notification never blocks the actual action the user
   requested, since this is an FYI, not compliance evidence the way the
   submission_approvals record is). Addresses a real gap the audit
   implies throughout its security section: sensitive account actions
   currently happen with no awareness mechanism for the account owner
   if someone else were ever the one actually performing them. */
async function sendSecurityEmail(to, subject, html){
  if(!RESEND_API_KEY || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method:'POST', headers:{ Authorization:'Bearer '+RESEND_API_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ from: REMINDER_FROM, to, subject, html })
    });
    return r.ok;
  } catch (e) {
    console.error('[security email] send failed:', e.message);
    return false;
  }
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
const PRICE_CENTS = parseInt(process.env.PRICE_CENTS || '1799', 10);
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
/* Operator-only control, not a user-facing setting - explicitly requested to live here rather
   than as a UI toggle. Independent of ANTHROPIC_API_KEY, so this can be switched off in
   production without touching credentials (e.g. to temporarily disable auto-fill while keeping
   the key configured for later), the same explicit-opt-out pattern already used for
   SKIP_PAYMENT_CHECK elsewhere in this file. Defaults to enabled unless explicitly set to
   'false', so existing deployments that never touch this variable see no behavior change. */
const AI_AUTOFILL_ENABLED = process.env.AI_AUTOFILL_ENABLED !== 'false';
app.post('/api/extract-doc', auth, async (req, res) => {
  if(!AI_AUTOFILL_ENABLED) return res.status(501).json({ error: 'extraction_disabled', note: 'AI_AUTOFILL_ENABLED is set to false' });
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

 /* CORRECTED: real gap the audit flags directly (§11) - failures here
   were completely silent before, not even logged to the server's own
   console. Kept best-effort/non-blocking for ordinary events (login,
   routine syncs) - the audit itself distinguishes routine logging
   from legally-critical records, and blocking something like a
   normal login over a logging hiccup would be a disproportionate
   regression for a minor observability gap. This makes failures
   visible everywhere without changing behavior for routine events;
   see the account-deletion route and the submission route above for
   where genuinely critical events are instead made blocking. */
const audit = (userId, action, detail = {}) =>
  pool.query('INSERT INTO audit_log(user_id, action, detail) VALUES ($1,$2,$3)', [userId, action, detail])
    .catch(e => console.error(`[audit] failed to record '${action}' for user ${userId}:`, e.message));

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
    /* IMPLEMENTED: addresses a real gap the audit flagged directly -
       email verification was listed as "at minimum" production scope,
       not something to defer. Mirrors the exact proven pattern already
       used for password reset below (random 256-bit token, stored only
       as a SHA-256 hash, no schema change) rather than inventing a
       second mechanism. Dormant gracefully if RESEND_API_KEY isn't set,
       same as password reset - registration never fails because email
       sending isn't configured. */
    if (RESEND_API_KEY) {
      try {
        const token = cryptoNode.randomBytes(32).toString('hex');
        const emailVerify = { th: sha256(token), exp: Date.now() + 24*60*60*1000 };
        await pool.query(`UPDATE users SET settings = jsonb_set(coalesce(settings,'{}'::jsonb),'{emailVerify}',$1::jsonb) WHERE id=$2`,
          [JSON.stringify(emailVerify), u.id]);
        const link = FRONTEND_URL + '?verifyEmail=' + token + '&email=' + encodeURIComponent(u.email);
        await fetch('https://api.resend.com/emails', { method:'POST',
          headers:{ Authorization:'Bearer '+RESEND_API_KEY, 'Content-Type':'application/json' },
          body: JSON.stringify({ from: REMINDER_FROM, to: u.email, subject: 'Confirm your SimplyTax email address',
            html: `<p>Hi ${u.name},</p><p>Please confirm your email address to unlock submitting tax returns:</p><p><a href="${link}">${link}</a></p><p>This link is valid for 24 hours. You can still prepare and calculate your return before confirming - this is only needed before submission.</p><p>— SimplyTax</p>` }) });
      } catch (e) { console.error('[register] verification email failed:', e.message); }
    }
    res.json({ token: sign(u), user: pubUser(u) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'email_exists' });
    console.error(e); res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const q = await pool.query('SELECT * FROM users WHERE email=$1', [normalizedEmail]);
  const u = q.rows[0];

  /* IMPLEMENTED: real per-account brute-force protection, addressing a
     genuine gap in the existing IP-based rate limit - many different
     IPs, each staying under that limit, could still combine to try
     unlimited passwords against one specific account. Tracked in
     users.settings, the same no-schema-change pattern already used
     for password-reset tokens above. Deliberately returns the
     identical generic error below whether the account doesn't exist,
     the password is wrong, or the account is genuinely locked -
     consistent with the same no-account-enumeration principle this
     file already documents for password reset. An attacker learns
     nothing from the response either way; the real owner is notified
     by email instead, which only they can see. */
  const MAX_FAILED_ATTEMPTS = 5;
  const LOCKOUT_MS = 15 * 60 * 1000;

  if (u) {
    const lockout = u.settings?.loginLockout;
    if (lockout?.lockedUntil && lockout.lockedUntil > Date.now()) {
      return res.status(401).json({ error: 'bad_credentials' });
    }
  }

  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) {
    if (u) {
      const prevAttempts = (u.settings?.loginLockout?.failedAttempts || 0) + 1;
      const newLockout = prevAttempts >= MAX_FAILED_ATTEMPTS
        ? { failedAttempts: 0, lockedUntil: Date.now() + LOCKOUT_MS }
        : { failedAttempts: prevAttempts, lockedUntil: null };
      await pool.query(
        `UPDATE users SET settings = jsonb_set(settings, '{loginLockout}', $1::jsonb) WHERE id=$2`,
        [JSON.stringify(newLockout), u.id]
      ).catch(e => console.error('[login] could not record failed attempt:', e.message));
      if (prevAttempts >= MAX_FAILED_ATTEMPTS) {
        audit(u.id, 'account_locked_brute_force', {});
        sendSecurityEmail(u.email, 'Multiple failed sign-in attempts on your SimplyTax account',
          `<p>Hi ${u.name || ''},</p><p>There have been several failed sign-in attempts on your SimplyTax account. As a precaution, sign-in has been temporarily disabled for 15 minutes.</p><p>If this wasn't you, your password is still safe - no one has signed in - but consider changing it once you're back in.</p><p>— SimplyTax</p>`
        ).catch(()=>{});
      }
    }
    return res.status(401).json({ error: 'bad_credentials' });
  }

  if (u.settings?.loginLockout?.failedAttempts) {
    await pool.query(
      `UPDATE users SET settings = jsonb_set(settings, '{loginLockout}', $1::jsonb) WHERE id=$2`,
      [JSON.stringify({ failedAttempts: 0, lockedUntil: null }), u.id]
    ).catch(()=>{});
  }

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
  const { rows } = await pool.query('SELECT id, name, settings FROM users WHERE email=$1', [String(email).toLowerCase()]);
  const pr = rows[0]?.settings?.pwreset;
  if(!pr || pr.th !== sha256(String(token)) || pr.exp < Date.now()) return res.status(400).json({ error: 'invalid_or_expired' });
  const hash = await bcrypt.hash(String(password), 12);
  await pool.query(`UPDATE users SET password_hash=$1, settings = settings - 'pwreset' WHERE id=$2`, [hash, rows[0].id]);
   audit(rows[0].id, 'pw_reset_done', {});
  /* IMPLEMENTED: real security-awareness gap - the flow above sends the
     initial reset link, but never confirmed afterward that the
     password actually changed. Without this, the real owner would have
     no way to notice if their account had been compromised via a
     leaked reset token and reset by someone else. Best-effort. */
  sendSecurityEmail(String(email).toLowerCase(), 'Your SimplyTax password was changed',
    `<p>Hi ${rows[0].name || ''},</p><p>Your SimplyTax password was just changed.</p><p>If this was you, no action is needed. If you did not make this change, please contact us immediately.</p><p>— SimplyTax</p>`
  ).catch(()=>{});
  res.json({ ok: true });
});

/* ---------- Email verification (mirrors the password-reset pattern above) ---------- */
app.post('/api/auth/verify-email', async (req, res) => {
  const { email, token } = req.body || {};
  if (!email || !token) return res.status(400).json({ error: 'invalid_input' });
  const { rows } = await pool.query('SELECT id, settings FROM users WHERE email=$1', [String(email).toLowerCase()]);
  const ev = rows[0]?.settings?.emailVerify;
  if (!rows.length || !ev || ev.th !== sha256(String(token)) || ev.exp < Date.now())
    return res.status(400).json({ error: 'invalid_or_expired' });
  await pool.query(
    `UPDATE users SET settings = jsonb_set(settings - 'emailVerify', '{emailVerified}', 'true') WHERE id=$1`,
    [rows[0].id]
  );
  audit(rows[0].id, 'email_verified', {});
  res.json({ ok: true });
});
app.post('/api/auth/resend-verification', auth, async (req, res) => {
  if (!RESEND_API_KEY) return res.status(501).json({ error: 'email_disabled' });
  const { rows } = await pool.query('SELECT id, name, email, settings FROM users WHERE id=$1', [req.user.sub]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  if (rows[0].settings?.emailVerified) return res.json({ ok: true, alreadyVerified: true });
  const token = cryptoNode.randomBytes(32).toString('hex');
  const emailVerify = { th: sha256(token), exp: Date.now() + 24*60*60*1000 };
  await pool.query(`UPDATE users SET settings = jsonb_set(settings,'{emailVerify}',$1::jsonb) WHERE id=$2`,
    [JSON.stringify(emailVerify), rows[0].id]);
  const link = FRONTEND_URL + '?verifyEmail=' + token + '&email=' + encodeURIComponent(rows[0].email);
  await fetch('https://api.resend.com/emails', { method:'POST',
    headers:{ Authorization:'Bearer '+RESEND_API_KEY, 'Content-Type':'application/json' },
    body: JSON.stringify({ from: REMINDER_FROM, to: rows[0].email, subject: 'Confirm your SimplyTax email address',
      html: `<p>Hi ${rows[0].name},</p><p>Please confirm your email address to unlock submitting tax returns:</p><p><a href="${link}">${link}</a></p><p>This link is valid for 24 hours.</p><p>— SimplyTax</p>` }) });
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, async (req, res) => {
  const q = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.sub]);
  if (!q.rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json({ user: pubUser(q.rows[0]) });
});

/* ---------- change account email (requires current password re-authentication) ---------- */
app.put('/api/auth/email', auth, async (req, res) => {
  const { newEmail, password } = req.body || {};
  const email = String(newEmail||'').trim().toLowerCase();
  if(!email || !password) return res.status(400).json({ error: 'invalid_input' });
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'invalid_email' });
  const { rows } = await pool.query('SELECT email, name, password_hash FROM users WHERE id=$1', [req.user.sub]);
  if(!rows.length || !(await bcrypt.compare(String(password), rows[0].password_hash)))
    return res.status(401).json({ error: 'wrong_password' });
  const oldEmail = rows[0].email;
  try{
    await pool.query('UPDATE users SET email=$1 WHERE id=$2', [email, req.user.sub]);
  }catch(e){
    if(e.code==='23505') return res.status(409).json({ error: 'email_taken' });   // unique violation
    throw e;
  }
   audit(req.user.sub, 'email_changed', { to: email });
  /* IMPLEMENTED: real security-awareness gap - notify the OLD address,
     not the new one. If this change was ever made by someone other
     than the real account owner, the old inbox is the one they still
     control; the new one likely belongs to whoever made the change.
     Best-effort - does not block the change itself on send failure. */
  sendSecurityEmail(oldEmail, 'Your SimplyTax sign-in email was changed',
    `<p>Hi ${rows[0].name || ''},</p><p>The email address on your SimplyTax account was just changed to <b>${email}</b>.</p><p>If this was you, no action is needed. If you did not make this change, please contact us immediately.</p><p>— SimplyTax</p>`
  ).catch(()=>{});
  res.json({ ok: true, email });
});

/* ---------- delete account (requires current password re-authentication) ----------
   IMPLEMENTED: addresses a real, direct gap from the production audit -
   "I did not find a complete user-facing 'Delete my account' workflow."
   Requires password re-entry first, the same standard already used for
   changing email, since this is irreversible.
   Deliberately deletes all *working* data - draft/unsubmitted tax return
   records, and any uploaded documents in storage - but does NOT touch
   submission_approvals. Those rows are the §87d-mandated 5-year
   compliance evidence for any returns that were actually submitted;
   deleting them on account closure would remove exactly the legal
   retention record the law requires to survive it. This is the same
   separation the audit itself recommended: working user data kept
   separate from mandatory legal retention records, not everything
   retained indefinitely and not everything wiped on request either. */
app.delete('/api/auth/account', auth, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'password_required' });
  const { rows } = await pool.query('SELECT email, name, password_hash FROM users WHERE id=$1', [req.user.sub]);
  if (!rows.length || !(await bcrypt.compare(String(password), rows[0].password_hash)))
    return res.status(401).json({ error: 'wrong_password' });

   /* CORRECTED: made this genuinely blocking, matching the same
     principle already applied to the submission route above - this
     is an irreversible action, and the audit's own recommendation
     (§11) is that failure to create the compliance record for
     something this significant should mean the action doesn't
     proceed, not "log and continue anyway" the way an ordinary,
     routine event correctly does elsewhere in this file. */
  try {
    await pool.query('INSERT INTO audit_log(user_id, action, detail) VALUES ($1,$2,$3)', [req.user.sub, 'account_deletion_requested', {}]);
  } catch (e) {
    console.error('[account deletion] could not record audit event, refusing to proceed:', e.message);
    return res.status(500).json({ error: 'audit_log_failed' });
  }
  /* IMPLEMENTED: real security-awareness gap - must be sent before the
     user row is deleted below, since there's no email address left to
     notify at afterward. Best-effort, does not block the deletion. */
  sendSecurityEmail(rows[0].email, 'Your SimplyTax account is being deleted',
    `<p>Hi ${rows[0].name || ''},</p><p>Your SimplyTax account and all draft tax returns are being permanently deleted, as requested.</p><p>If you did not request this, please contact us immediately - this cannot be undone once complete.</p><p>— SimplyTax</p>`
  ).catch(()=>{});

  if (storageOn()) {
    try {
      const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BELEGE_BUCKET}`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: `${req.user.sub}/` }),
      });
      if (listRes.ok) {
        const files = await listRes.json();
        const paths = (files || []).map(f => `${req.user.sub}/${f.name}`);
        if (paths.length) {
          await fetch(`${SUPABASE_URL}/storage/v1/object/${BELEGE_BUCKET}`, {
            method: 'DELETE',
            headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefixes: paths }),
          });
        }
      }
    } catch (e) {
      console.error('[account deletion] could not clear uploaded documents:', e.message);
      /* Do not block account deletion on a storage cleanup failure - the
         database data (below) is the primary record; an orphaned storage
         object without any account or client to reference it is a
         cleanup task, not a reason to refuse the person's deletion
         request. */
    }
  }

   await pool.query('DELETE FROM clients WHERE user_id=$1', [req.user.sub]);
  try {
    await pool.query('DELETE FROM users WHERE id=$1', [req.user.sub]);
  } catch (e) {
    /* Defensive fallback - audit_log is an existing table whose exact
       schema isn't fully known here; if it has a foreign key on
       user_id referencing users(id), a hard delete would fail rather
       than leave the account genuinely closed. Anonymize the row
       instead of leaving the request half-completed. */
    console.error('[account deletion] hard delete failed, anonymizing instead:', e.message);
    await pool.query(
      `UPDATE users SET email=$2, password_hash=$3, name=NULL WHERE id=$1`,
      [req.user.sub, `deleted-${req.user.sub}@deleted.invalid`, await bcrypt.hash(cryptoNode.randomUUID(), 10)]
    );
  }

   res.json({ ok: true });
});

/* ---------- export all of a user's own data (GDPR Article 15/20) ----------
   IMPLEMENTED: addresses a real gap the audit flagged directly under its
   "Data subject controls are missing" finding - "download my information"
   and "download my tax returns" were both listed as absent. This is the
   actual right of access / data portability GDPR gives every user, not
   just a nice-to-have feature. The audit also names "downloading all tax
   records" specifically as an example of something that should require
   stronger authentication than simply holding a valid session token -
   this uses the same password re-confirmation pattern already used for
   account deletion and email change, for the same reason. Includes the
   person's own submission_approvals rows too - the §87d retention
   requirement means those specific records can't be deleted on request,
   but that's a retention rule, not a reason to hide the person's own
   data from them. */
app.post('/api/auth/export', auth, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'password_required' });
  const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.sub]);
  if (!userRows.length || !(await bcrypt.compare(String(password), userRows[0].password_hash)))
    return res.status(401).json({ error: 'wrong_password' });

  const { rows: clients } = await pool.query('SELECT * FROM clients WHERE user_id=$1', [req.user.sub]);
  const { rows: approvals } = await pool.query(
    'SELECT id, client_id, tax_year, approved_payload_sha256, xml_sha256, server_received_at, eric_rc, submitted, transfer_ticket FROM submission_approvals WHERE user_id=$1',
    [req.user.sub]
  ).catch(() => ({ rows: [] }));

   audit(req.user.sub, 'data_export', {});
  /* IMPLEMENTED: real security-awareness gap - a bulk export of tax
     data is a sensitive event worth the account owner knowing about,
     not something that happens silently. Best-effort. */
  sendSecurityEmail(userRows[0].email, 'Your SimplyTax data was exported',
    `<p>Hi ${userRows[0].name || ''},</p><p>A full export of your SimplyTax data (account details, tax returns, and submission records) was just downloaded.</p><p>If this was you, no action is needed. If you did not request this, please change your password immediately and contact us.</p><p>— SimplyTax</p>`
  ).catch(()=>{});

  res.json({
    exportedAt: new Date().toISOString(),
    account: pubUser(userRows[0]),
    taxReturns: clients.map(c => c.data),
    submissionEvidence: approvals,
  });
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

    /* IMPLEMENTED: real gap the audit flags directly - fetch existing
       stored state first, before anything is overwritten below, so
       each client's previous status is known. Without this, there's
       no way to tell whether a record is newly becoming "submitted"
       (capture its snapshot) or was already submitted (check for
       drift) versus every other ordinary save. */
    const existingRows = ids.length
      ? (await db.query('SELECT id, data, submitted_snapshot_sha256 FROM clients WHERE user_id=$1 AND id = ANY($2)', [req.user.sub, ids])).rows
      : [];
    const existingById = new Map(existingRows.map(r => [r.id, r]));
    /* Fields deliberately excluded from the content hash - these are
       genuinely legitimate to keep editing after submission (an
       inquiry log entry, an uploaded document, a timestamp, the
       transfer ticket itself), so including them would make ordinary,
       expected post-submission activity look like drift. */
    const contentOnly = (c) => {
      const { updatedAt, inq, docs, transferTicket, status, submittedAt, freigabe, ...content } = c;
      return JSON.stringify(content);
    };
    const driftDetected = [];

    for (const c of clients) {
      if (!c.id) continue;
      const existing = existingById.get(c.id);
      let snapshotHash = existing?.submitted_snapshot_sha256 || null;

      if (existing) {
        const wasSubmitted = existing.data?.status === 'submitted';
        const isSubmitted = c.status === 'submitted';
        if (!wasSubmitted && isSubmitted) {
          // Transition moment - capture the approved content as the baseline.
          snapshotHash = sha256(contentOnly(c));
        } else if (wasSubmitted && existing.submitted_snapshot_sha256) {
          const currentHash = sha256(contentOnly(c));
          if (currentHash !== existing.submitted_snapshot_sha256) {
            driftDetected.push(c.id);
          }
        }
      }

      await db.query(
        `INSERT INTO clients(id, user_id, data, updated_at, submitted_snapshot_sha256) VALUES ($1,$2,$3,now(),$4)
         ON CONFLICT (id) DO UPDATE SET data=$3, updated_at=now(), submitted_snapshot_sha256=$4 WHERE clients.user_id=$2`,
        [c.id, req.user.sub, c, snapshotHash]);
    }
    await db.query('COMMIT');
    audit(req.user.sub, 'clients_sync', { count: clients.length });
    if (driftDetected.length) {
      /* Compliance-relevant, not an ordinary sync event - a submitted
         return's actual content changed after the fact. Logged for
         visibility rather than blocked, per the reasoning above. */
      audit(req.user.sub, 'submitted_return_content_drift', { clientIds: driftDetected });
    }
    res.json({ ok: true, count: clients.length });
  } catch (e) { await db.query('ROLLBACK'); console.error(e); res.status(500).json({ error: 'server_error' });
  } finally { db.release(); }
});

app.delete('/api/clients/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.user.sub]);
  res.json({ ok: true });
});

/* create a Checkout session for one return */
/* Discount codes - server-side source of truth. Must be kept in sync with the DISCOUNTS
   table in index.html if you also run the 'simulated' payment mode; for real Stripe
   payments THIS table is the only one that actually determines the amount charged. */
const DISCOUNTS = {
  WELCOME10: { type: 'percent', value: 10 },
  SAVE5: { type: 'fixed', value: 5 },
};
function discountedCents(code) {
  const d = DISCOUNTS[String(code || '').trim().toUpperCase()];
  if (!d) return { cents: PRICE_CENTS, code: null };
  const off = d.type === 'percent' ? Math.round(PRICE_CENTS * d.value / 100) : Math.round(d.value * 100);
  return { cents: Math.max(50, PRICE_CENTS - off), code: String(code).trim().toUpperCase() };  // never below 0.50 EUR
}

app.post('/api/payments/checkout', auth, async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'stripe_disabled' });
  const { clientId, discountCode } = req.body || {};
  if (!clientId) return res.status(400).json({ error: 'invalid_input' });
  /* IMPLEMENTED: real, different problem found while checking this
     route for the same thing as eric/validate - clientId ownership
     was never verified before creating the Stripe session. If it were
     ever wrong, stale, or tampered with, the customer's real payment
     would still go through via Stripe, but the final database update
     in markPaid (correctly scoped to id+user_id) would silently match
     zero rows - unlocking nothing for anyone, and leaving the
     customer's money effectively lost with no return to show for it.
     Same allowance as eric/validate for a genuinely new, not-yet-saved
     record (only rejects an actual conflict with someone else's
     existing record), since checkout can plausibly be reached shortly
     after creating a new return, before the debounced save completes. */
  const { rows: ownershipRows } = await pool.query('SELECT user_id FROM clients WHERE id=$1', [clientId]);
  if (ownershipRows.length && ownershipRows[0].user_id !== req.user.sub) {
    return res.status(404).json({ error: 'not_found' });
  }
  const { cents, code } = discountedCents(discountCode);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: cents,
      product_data: { name: 'SimplyTax — Freischaltung Steuererklärung' + (code ? ` (${code})` : '') } } }],
    client_reference_id: clientId,
    metadata: { userId: req.user.sub, clientId, discountCode: code || '' },
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
/* ---------- ERiC integration (Phase 5) ---------- */
/* Stage 1 (raw client -> "simplytax-interchange" JSON) already runs
   client-side via buildElsterDataset(c) in index.html - see that
   function's own comment: "handover format for the ERiC backend
   adapter". These two routes are that adapter's other half: Stage 2
   (interchange JSON -> real XML) runs here via xml-builder.js, then the
   isolated eric-worker.js process (see eric-service.js) calls the actual
   ERiC library. A crash inside that native library can never take this
   API down - eric-service.js detects it and restarts the worker. */

/* Lightweight real-time field validation - checks a single field (or a
   few) against ERiC's own checksum validators, WITHOUT needing a full
   client/XML. Meant to be called from the wizard as the user types
   (e.g. onblur on the Steuer-ID / IBAN fields), catching a typo'd but
   still-11-digit ID before the user ever reaches payment. */
/* Admin/export route - fetches the full official Finanzamt directory
   live from ERiC. Not called by the wizard on every keystroke (that
   would depend on the backend being awake and ERiC configured for a
   purely informational lookup) - used instead by a one-time export
   script (see tools/export-finanzaemter.js) that generates a static
   JSON file bundled with the frontend. Re-run the export whenever the
   directory needs refreshing (ELSTER updates this rarely). */
app.get('/api/eric/finanzaemter', auth, async (req, res) => {
  if (!ericService.isReady()) {
    return res.status(501).json({ error: 'eric_unavailable', detail: ericService.getInitError() });
  }
  try {
    const result = await ericService.getFinanzaemter();
    res.json(result);
  } catch (e) {
    console.error('[eric/finanzaemter]', e.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/eric/validate-fields', auth, async (req, res) => {
  if (!ericService.isReady()) {
    return res.status(501).json({ error: 'eric_unavailable', detail: ericService.getInitError() });
  }
  const { taxId, iban, bic, steuernummer, bufaNr, bundesland } = req.body || {};
  if (taxId == null && iban == null && bic == null && steuernummer == null) return res.status(400).json({ error: 'invalid_input' });
  try {
    const result = await ericService.validateFields({ taxId, iban, bic, steuernummer, bufaNr, bundesland });
    res.json(result);
  } catch (e) {
    console.error('[eric/validate-fields]', e.message);
    res.status(500).json({ error: 'server_error' });
  }
});

/* Real bug found via actual ERiC validation (Fehlercode 10010
   "Bundesfinanzamtsnummer und die ersten 4 Stellen der Steuernummer
   unterscheiden sich", plus "ungueltigeSteuernummer"): xml-builder.js
   was sending the raw, regionally-formatted Steuernummer directly (just
   digit-stripped), never converted into the required unified 13-digit
   ELSTER format (which encodes the issuing Finanzamt in its own
   structure, confirmed via the real example: StNr "9181081508155" for
   BuFa "9181" - first 4 digits match by design, "0" fixed at position
   5). This means ANY real customer's regionally-formatted Steuernummer
   would have failed this exact validation in production, not just in
   this test. The real conversion function (EricMtMakeElsterStnr) was
   already built and working for the live checksum-indicator feature -
   this reuses it for the actual submission path, where it was missing. */
async function convertSteuernummerForSubmission(interchangeData) {
  const h = interchangeData.hauptvordruck;
  if (!h || !h.steuernummer || !h.finanzamt?.bufaNr) return interchangeData;
  try {
    const result = await ericService.validateFields({ steuernummer: h.steuernummer, bufaNr: h.finanzamt.bufaNr, bundesland: h.bundesland });
    if (result?.steuernummer?.valid && result.steuernummer.elsterFormat) {
      return { ...interchangeData, hauptvordruck: { ...h, steuernummer: result.steuernummer.elsterFormat } };
    }
    /* conversion failed or the Steuernummer+Finanzamt combination is
       genuinely invalid - pass through unconverted rather than silently
       hide the problem; buildEStXML/ERiC will surface it clearly, same
       as before this fix, rather than mask a real data problem */
    return interchangeData;
  } catch (e) {
    console.error('[steuernummer conversion]', e.message);
    return interchangeData;
  }
}

app.post('/api/eric/validate', auth, async (req, res) => {
  if (!ericService.isReady()) {
    return res.status(501).json({ error: 'eric_unavailable', detail: ericService.getInitError() });
  }
  const { clientId, interchangeData } = req.body || {};
  if (!clientId || !interchangeData) return res.status(400).json({ error: 'invalid_input' });
   /* IMPLEMENTED: real gap found via a direct route-by-route review,
     specifically the test the audit itself names as something to
     check relentlessly - "can User A ever retrieve any element of
     User B's tax return?" This route never actually fetches tax data
     using clientId (interchangeData comes straight from the request
     body), so it couldn't leak another user's actual return content -
     but without this check, a caller could still supply a completely
     fabricated or mismatched clientId, and the audit log below would
     record it as fact.
     CORRECTED from an earlier version of this same fix: only rejects a
     genuine conflict (an id that already exists and belongs to someone
     else), not simply an id that doesn't exist in the database yet -
     the frontend's import feature deliberately jumps straight to this
     validate step right after creating a brand-new client, and the
     actual save to the database is debounced by 600ms, so the record
     often genuinely isn't there yet at the moment this is called. The
     real thing worth protecting against is someone supplying an id
     they don't own, not a legitimately new one that hasn't saved yet. */
  const { rows: ownershipRows } = await pool.query('SELECT user_id FROM clients WHERE id=$1', [clientId]);
  if (ownershipRows.length && ownershipRows[0].user_id !== req.user.sub) {
    return res.status(404).json({ error: 'not_found' });
  }
  try {
    const convertedData = await convertSteuernummerForSubmission(interchangeData);
    const { xml, skippedSections } = buildEStXML(convertedData, {
      herstellerID: process.env.ERIC_HERSTELLER_ID,
    });
    const result = await ericService.validate(xml, 'ESt_' + (convertedData.meta?.taxYear || 2025));
    audit(req.user.sub, 'eric_validate', { clientId, rc: result.rc, ok: result.rc === 0 });
    /* IMPLEMENTED: same real classification used to block /api/eric/submit
       below, surfaced here too (informational only - this is a preview
       call) so the UI can flag it and let the customer fix the gap
       before they ever reach the Freigabe approval screen, rather than
       only discovering it at the final, blocking submit step. */
    const { materialGaps } = classifySkippedSections(skippedSections);
    res.json({
      ok: result.rc === 0,
      rc: result.rc,
      resultXml: result.resultXml,
      skippedSections,
      materialGaps,
      /* CORRECTED: real bug found via direct feedback - this response
         was built naming only specific fields, silently dropping
         ericLogTail even though the worker already returns it
         correctly. The worker-side and frontend-side fixes were both
         genuinely deployed and correct; this route in between was the
         actual break. */
      ...(result.ericLogTail ? { ericLogTail: result.ericLogTail } : {}),
    });
  } catch (e) {
    if (e instanceof InterchangeDataError) return res.status(400).json({ error: 'invalid_interchange_data', detail: e.message });
    console.error('[eric/validate]', e.message);
    res.status(500).json({ error: 'server_error' });
  }
});

/* Submission requires: payment already completed for this client, AND an
   explicit § 87d Freigabe confirmation in the request body (the actual
   Freigabe UI - showing the user their final data and capturing this
   confirmation with a timestamp - is a separate, not-yet-built frontend
   piece; this route enforces that the flag is present, it does not itself
   constitute compliant Freigabe UX). */
app.post('/api/eric/submit', auth, async (req, res) => {
  if (!ericService.isReady()) {
    return res.status(501).json({ error: 'eric_unavailable', detail: ericService.getInitError() });
  }
  const { clientId, interchangeData, freigabeConfirmed } = req.body || {};
   if (!clientId || !interchangeData) return res.status(400).json({ error: 'invalid_input' });
  if (!freigabeConfirmed) return res.status(400).json({ error: 'freigabe_required' });

  /* IMPLEMENTED: addresses the audit's own specific example - "submitting
     to ELSTER should require stronger authentication than simply
     possessing an old 12-hour JWT." A verified email is the minimum bar
     for something this consequential. Only enforced when RESEND_API_KEY
     is genuinely configured, matching the same graceful-dormancy
     principle already used for password reset, so this can never lock
     every user out simply because a given deployment hasn't set up
     email sending yet. */
   if (RESEND_API_KEY) {
    const { rows: verifyRows } = await pool.query('SELECT settings FROM users WHERE id=$1', [req.user.sub]);
    const s = verifyRows[0]?.settings || {};
    /* Grandfather accounts that predate this feature entirely - if
       neither emailVerified nor a pending emailVerify token was ever
       set for this account, it registered before verification existed
       at all, and shouldn't be retroactively locked out for a step
       that didn't exist when they signed up. Only accounts that
       genuinely went through (or were sent) verification and haven't
       completed it are actually blocked. */
    const predatesFeature = s.emailVerified === undefined && s.emailVerify === undefined;
    if (!predatesFeature && !s.emailVerified) {
      return res.status(403).json({ error: 'email_not_verified' });
    }
  }

  const { rows } = await pool.query('SELECT data FROM clients WHERE id=$1 AND user_id=$2', [clientId, req.user.sub]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  const stored = rows[0].data;
  /* TEMPORARY, testing-only bypass - gated behind an explicit env var so
     it requires deliberate configuration to enable and can never be
     silently left on in production. Set SKIP_PAYMENT_CHECK=true only
     while testing the ERiC pipeline end-to-end; remove this block (and
     the env var) once real payment enforcement is needed again. */
  const skipPayment = process.env.SKIP_PAYMENT_CHECK === 'true';
   if (!skipPayment && (!stored.pay || stored.pay.status !== 'paid')) {
    return res.status(402).json({ error: 'payment_required' });
  }

  /* IMPLEMENTED: real duplicate-submission protection, addressing a
     genuine gap the audit flagged - a double-click, browser retry, or
     two open tabs could all previously trigger the same return being
     sent to ELSTER twice, since nothing here ever checked whether this
     client was already submitted. A plain "if already submitted,
     reject" check on its own would still have a race: two simultaneous
     requests could both read "not yet submitted" before either writes.
     This claims a "submitting" lock atomically via a conditional
     UPDATE - only one concurrent request can ever have its WHERE
     clause match, confirmed by checking rowCount (how many rows the
     database actually changed), not just re-reading the value
     afterward. Every exit path below releases the lock so a genuine
     failure never permanently locks the client out of retrying. */
   const claim = await pool.query(
    `UPDATE clients SET data = jsonb_set(data, '{status}', '"submitting"')
     WHERE id=$1 AND user_id=$2
       AND (data->>'status' IS DISTINCT FROM 'submitted')
       AND (data->>'status' IS DISTINCT FROM 'submitting')
     RETURNING id`,
    [clientId, req.user.sub]
  );
  if (claim.rowCount === 0) {
    return res.status(409).json({ error: 'already_submitted_or_in_progress' });
  }
  const previousStatus = stored.status || 'draft';
  const releaseLock = async (newStatus) => {
    await pool.query(
      `UPDATE clients SET data = jsonb_set(data, '{status}', $3::jsonb) WHERE id=$1 AND user_id=$2`,
      [clientId, req.user.sub, JSON.stringify(newStatus)]
    ).catch(e => console.error('[eric/submit] could not release submission lock:', e.message));
  };

   try {
    const convertedData = await convertSteuernummerForSubmission(interchangeData);
    const { xml, skippedSections } = buildEStXML(convertedData, {
      herstellerID: process.env.ERIC_HERSTELLER_ID,
    });

    /* IMPLEMENTED: the production audit's own headline recommendation
       (its §3) - "ERiC accepted the XML" does not mean the return is
       correct. Real money the customer entered, or a legal basis
       actively contradicting what they selected, being silently
       dropped from what's actually transmitted is not something a
       checkbox should be able to wave through. Checked before the
       approval-evidence record is even written, so a blocked
       submission is never recorded as an attempted one and never
       reaches ERiC at all. */
     const { materialGaps } = classifySkippedSections(skippedSections);
    if (materialGaps.length > 0) {
      await releaseLock(previousStatus);
      return res.status(422).json({ error: 'material_gaps', materialGaps });
    }

    /* CORRECTED: real gap found in the production audit - the durable
       approval record is now written here, BEFORE the ERiC call, using
       a real server-computed SHA-256 (never the client's own checksum,
       which could be forged or simply wrong). This row exists the
       moment the server accepts the request, independent of whether
       ERiC succeeds or the response ever reaches the browser. */
    const approvedPayloadSha256 = sha256(JSON.stringify(convertedData));
    const xmlSha256 = sha256(xml);
    let approvalId = null;
    try {
      const approvalInsert = await pool.query(
        `INSERT INTO submission_approvals
           (client_id, user_id, tax_year, approved_payload_sha256, approved_payload_snapshot, xml_sha256)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [clientId, req.user.sub, convertedData.meta?.taxYear || null, approvedPayloadSha256, JSON.stringify(convertedData), xmlSha256]
      );
      approvalId = approvalInsert.rows[0]?.id || null;
     } catch (approvalErr) {
      /* Per the audit's own recommendation: failure to durably record
         approval evidence means do not submit - this is not a "log
         and continue" failure the way ordinary audit events are. */
      console.error('[eric/submit] could not write approval evidence, refusing to submit:', approvalErr.message);
      await releaseLock(previousStatus);
      return res.status(500).json({ error: 'approval_evidence_failed' });
    }

    const result = await ericService.submit(xml, 'ESt_' + (convertedData.meta?.taxYear || 2025));
    audit(req.user.sub, 'eric_submit', { clientId, rc: result.rc, sent: result.sent, transferTicket: result.transferTicket || null });

    if (approvalId) {
      await pool.query(
        `UPDATE submission_approvals SET eric_rc=$2, submitted=$3, transfer_ticket=$4 WHERE id=$1`,
        [approvalId, result.rc ?? null, !!result.sent, result.transferTicket || null]
      ).catch(e => console.error('[eric/submit] could not update approval record with outcome:', e.message));
    }

     if (result.sent) {
      /* CORRECTED: extractServerAnswer() in the worker was already
         writing a real transferTicket into the result object, but this
         endpoint never persisted or returned it - the TODO here was
         stale, the worker-side piece it was waiting on now exists
         (confirmed via the real ERiC API reference, EricMt
         GetErrormessagesFromXMLAnswer). Stored on the client record
         alongside status, not just a bare "submitted" flag. */
      await pool.query(
        `UPDATE clients SET data = jsonb_set(
           jsonb_set(data, '{status}', '"submitted"'),
           '{transferTicket}', $3::jsonb
         ) WHERE id=$1 AND user_id=$2`,
        [clientId, req.user.sub, JSON.stringify(result.transferTicket || null)]
      );
    } else {
      /* CORRECTED: real gap - previously nothing released the
         "submitting" lock when ERiC itself rejected the return (as
         opposed to a server-side exception, which the outer catch
         already handles). Without this, a genuine ERiC-level failure
         left the client permanently stuck, unable to ever retry. */
      await releaseLock(previousStatus);
    }

    res.json({
      ok: result.sent,
      rc: result.rc,
      resultXml: result.resultXml,
      serverXml: result.serverXml,
      transferTicket: result.transferTicket || null,
      returncodeTH: result.returncodeTH || null,
      fehlertextTH: result.fehlertextTH || null,
      skippedSections,
      /* Same real fix as /api/eric/validate above - ericLogTail was
         being silently dropped here too. */
      ...(result.ericLogTail ? { ericLogTail: result.ericLogTail } : {}),
    });
   } catch (e) {
    await releaseLock(previousStatus);
    if (e instanceof InterchangeDataError) return res.status(400).json({ error: 'invalid_interchange_data', detail: e.message });
    console.error('[eric/submit]', e.message);
    res.status(500).json({ error: 'server_error' });
  }
});

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

/* Global error handler - found during testing that a malformed JSON body
   correctly resulted in a 400 (body-parser's own default behavior works),
   but printed a raw, unhandled-looking stack trace to the logs. This
   catches it explicitly for a clean one-line log instead, and is a
   general safety net for any other error that reaches this point without
   its own handler - ensures the app always responds with SOMETHING valid
   rather than hanging or dropping the connection. */
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    console.warn(`[body-parser] malformed JSON from ${req.ip} on ${req.path}`);
    return res.status(400).json({ error: 'invalid_json' });
  }
  console.error('[unhandled]', err && err.message, err && err.stack);
  res.status(500).json({ error: 'server_error' });
});

/* Guarded so requiring this file (e.g. from a test suite via supertest)
   never binds a real port - only `node server.js` directly does, exactly
   as before. Zero production behavior change. */
if (require.main === module) {
  /* Added directly in response to a real gap found in the production
     audit (§7, §12 in the audit's own numbering): approval ("Freigabe")
     evidence previously only existed as a client-side, non-cryptographic
     checksum, persisted to the backend only AFTER a successful
     submission - a crash in that window left ERiC holding an accepted
     return with no durable record the customer ever approved it.
     This table is the immutable, server-written record §87d actually
     calls for: written BEFORE the ERiC call is ever made, using a
     real SHA-256 hash computed server-side (never trusting a
     client-supplied hash), holding the exact approved payload so it
     can be verified independently of whatever the client record later
     becomes. CREATE TABLE IF NOT EXISTS makes this self-installing -
     no separate migration step needed before this code can run. */
  pool.query(`CREATE TABLE IF NOT EXISTS submission_approvals (
    id SERIAL PRIMARY KEY,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    tax_year INTEGER,
    approved_payload_sha256 TEXT NOT NULL,
    approved_payload_snapshot JSONB NOT NULL,
    xml_sha256 TEXT,
    server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    eric_rc INTEGER,
    submitted BOOLEAN NOT NULL DEFAULT false,
     transfer_ticket TEXT
  )`).catch(e => console.error('[startup] could not ensure submission_approvals table:', e.message));

  /* IMPLEMENTED: addresses a real gap the audit calls out directly
     (its §10) - "once a taxpayer approves a return, the approved
     version should become immutable." The bulk-sync route below
     currently overwrites a client's entire data unconditionally,
     regardless of whether it was already submitted. Purely additive -
     a new nullable column never breaks any existing row or query -
     used to detect when a submitted return's actual content changes
     afterward. Deliberately detection, not yet a hard block: real
     uncertainty about which fields are legitimately still editable
     after submission (e.g. logging a Finanzamt inquiry response)
     means blocking outright risks breaking a feature that's supposed
     to keep working, which is a worse outcome than flagging drift for
     now and revisiting a full immutable-revision model later. */
  pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS submitted_snapshot_sha256 TEXT`)
    .catch(e => console.error('[startup] could not ensure submitted_snapshot_sha256 column:', e.message));

  app.listen(PORT, () => console.log(`SimplyTax API listening on :${PORT}`));
}
module.exports = app;
