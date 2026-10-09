-- =============================================================================
-- SimplyTax database schema, v2 - PostgreSQL 14+ (Supabase)
--
-- THE single source of truth for the database. Every statement is idempotent (IF NOT EXISTS), so this file is safe to run on an
-- EMPTY database to build everything, AND on the live database (it changes nothing that already exists, only adds what is missing).
--
-- History: v1 had users, clients, audit_log, payments. The server then grew three more database objects that it creates ITSELF
-- when it starts (submission_approvals, user_certificates, clients.submitted_snapshot_sha256) - they were never written down here,
-- so a database rebuilt from the old file was broken. They are all listed below now. The startup code stays as a safety net;
-- test/test-schema.js proves that this file and that startup code describe exactly the same tables.
--
-- Check a live database against this file:   DATABASE_URL=postgres://... node tools/check-live-schema.js
-- Client data is JSONB on purpose: new frontend fields need NO migration.
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() is built in from PostgreSQL 13; kept for older versions
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'consultant',   -- admin | consultant | assistant (role system, later stage)
  settings      jsonb NOT NULL DEFAULT '{}',          -- letterhead etc. PLUS server-owned state: emailVerified, emailVerify, pwreset, loginLockout, tokenVersion
  two_fa        boolean NOT NULL DEFAULT false,       -- 2FA flag (later stage)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id         text PRIMARY KEY,                        -- frontend-generated id (uid)
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       jsonb NOT NULL,                          -- the complete tax-return object (flexible)
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_snapshot_sha256 text                      -- baseline hash captured when the return is filed (immutability check)
);
CREATE INDEX IF NOT EXISTS clients_user_idx ON clients(user_id);
CREATE INDEX IF NOT EXISTS clients_year_idx ON clients ((data->>'taxYear'));

CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,                           -- login | register | clients_sync | eric_submit | doc_extracted ...
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_user_action_idx ON audit_log (user_id, action, created_at DESC);   -- daily extraction quota, per-user lookups

CREATE TABLE IF NOT EXISTS payments (                 -- the payment LEDGER: the server's own record of what was paid / refunded
  id           bigserial PRIMARY KEY,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,    -- kept (anonymised) when an account is deleted: financial record
  client_id    text,
  session_id   text UNIQUE NOT NULL,                  -- Stripe session id, or 'pp_' + PayPal order id
  amount_cents integer NOT NULL,
  currency     text NOT NULL DEFAULT 'eur',
  status       text NOT NULL DEFAULT 'paid',          -- paid | refunded
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_user_client_idx ON payments (user_id, client_id);

-- Written BEFORE ERiC is called and completed AFTER: the server-side evidence of what was approved and what happened (§87d).
-- user_id is TEXT with no foreign key ON PURPOSE (an INTEGER/uuid foreign key once failed to create at startup and went unnoticed);
-- it therefore does NOT cascade on account deletion. Retention of these rows is a legal decision, see the status document.
CREATE TABLE IF NOT EXISTS submission_approvals (
  id                        SERIAL PRIMARY KEY,
  client_id                 TEXT NOT NULL,
  user_id                   TEXT NOT NULL,
  tax_year                  INTEGER,
  approved_payload_sha256   TEXT NOT NULL,
  approved_payload_snapshot JSONB NOT NULL,           -- the exact payload that was approved (complete tax data)
  xml_sha256                TEXT,
  server_received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  eric_rc                   INTEGER,                  -- NULL = ERiC never reported back (outcome unknown)
  submitted                 BOOLEAN NOT NULL DEFAULT false,
  transfer_ticket           TEXT
);
CREATE INDEX IF NOT EXISTS submission_approvals_lookup_idx ON submission_approvals (user_id, client_id, id DESC);

-- The customer's own ELSTER certificate, AES-256-GCM encrypted (the certificate password is never stored).
-- user_id is TEXT with no foreign key (same reason as above), so account deletion removes this row EXPLICITLY (server.js).
CREATE TABLE IF NOT EXISTS user_certificates (
  id                SERIAL PRIMARY KEY,
  user_id           TEXT NOT NULL,
  pfx_encrypted     TEXT NOT NULL,
  pfx_iv            TEXT NOT NULL,
  pfx_auth_tag      TEXT NOT NULL,
  original_filename TEXT,
  subject_cn        TEXT,
  valid_until       TIMESTAMPTZ,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
