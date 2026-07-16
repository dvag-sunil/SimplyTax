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
app.use(express.json({ limit: '10mb' }));
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

app.listen(PORT, () => console.log(`SimplyTax API listening on :${PORT}`));
