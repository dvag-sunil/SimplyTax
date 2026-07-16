# SimplyTax Backend — Setup & Architecture

REST API (Node.js/Express) + PostgreSQL. Client data is stored as **JSONB**, so new frontend
fields require **no schema migration** — the JSON simply carries them.

## Architecture
GitHub Pages (static frontend, BACKEND.enabled=true) → HTTPS → Caddy/nginx reverse proxy
→ Node API (JWT auth, rate-limited, CORS-locked) → PostgreSQL (EU server). Portable: runs
identically on Hetzner, IONOS, Railway, Render, or Supabase-hosted Postgres.

## Deploy on Hetzner (~€5/month, EU/GDPR)
1. Create Ubuntu 24 server (Falkenstein/Nürnberg). `apt install postgresql nodejs npm caddy`
2. DB: `sudo -u postgres createuser simplytax -P && sudo -u postgres createdb simplytax -O simplytax`
   then `psql -U simplytax -d simplytax -f schema.sql`
3. App: copy `backend/`, `cp .env.example .env` (set DATABASE_URL, a long random JWT_SECRET,
   ALLOWED_ORIGIN=https://dvag-sunil.github.io), `npm install`, run via systemd:
   `ExecStart=/usr/bin/node server.js` (Restart=always).
4. HTTPS: Caddyfile → `api.your-domain.de { reverse_proxy localhost:3000 }` (auto Let's Encrypt).
5. Frontend: in index.html set `BACKEND = { enabled:true, baseUrl:'https://api.your-domain.de' }`.
6. Backups: `pg_dump` daily via cron + Hetzner snapshots.

## Security model
HTTPS only · bcrypt(12) password hashes · JWT 12h expiry (Authorization header) · Helmet ·
CORS restricted to the Pages origin · rate limiting (30/15min on auth) · parameterized queries ·
audit_log of logins & syncs. Real .env never committed.

## Prepared for later stages
- **Roles:** users.role (admin/consultant/assistant) + `requireRole()` middleware ready.
- **Monitoring:** `GET /api/health` (checks DB) → point Uptime Kuma / Grafana / Better Stack at it.
- **2FA:** users.two_fa flag reserved.
- **Documents (Belege):** stage 2 — S3-compatible object storage (Hetzner), not in DB.
- **ERiC adapter:** consumes the same API; the canonical ELSTER dataset comes from the frontend export.

## API
POST /api/auth/register {name,email,password} · POST /api/auth/login · GET /api/auth/me ·
PUT /api/auth/settings · GET /api/clients · PUT /api/clients/bulk {clients:[…]} ·
DELETE /api/clients/:id · GET /api/health
