# SimplyTax — Project Structure

```
SimplyTax/
├── index.html          Frontend (single-file app) — served by GitHub Pages
│                       Backend toggle at the top: BACKEND = { enabled, baseUrl }
├── README.md           Product overview & feature list
├── docs/               Concepts & specifications
│   ├── requirements_v1.md            ELSTER/ERiC research, § 87d duties
│   ├── data_hosting_concept_v1.md    GDPR hosting, backups, retention
│   └── eric_integration_spec_v1.md   Field mapping & ERiC call sequence
└── backend/            REST API source (runs on your EU server, NOT on GitHub)
    ├── server.js       Express API: JWT auth, clients sync, health endpoint
    ├── schema.sql      PostgreSQL schema (users, clients JSONB, audit_log)
    ├── package.json    Dependencies (express, pg, bcryptjs, jsonwebtoken…)
    ├── .env.example    Config template — the real .env lives ONLY on the server
    └── README.md       Deploy guide (Hetzner, systemd, Caddy/HTTPS, backups)
```

## Rules
1. GitHub = code storage. GitHub Pages serves index.html; the backend runs on a server.
2. Never commit a real `.env` (secrets). `.gitignore` excludes it; only `.env.example` is committed.
3. Client data lives ONLY in PostgreSQL on the server (or browser storage while the toggle is off) —
   never in the repository.

## Deployment flow
Push to GitHub → Pages updates the frontend automatically.
On the server: `git pull` in the cloned repo → restart the API service (`systemctl restart simplytax`).
Frontend switch: set `BACKEND.enabled = true` + your API URL in index.html, push.
