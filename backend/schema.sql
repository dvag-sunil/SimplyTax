-- SimplyTax schema v1 — PostgreSQL 14+
-- Flexible by design: client data is JSONB, so new frontend fields need NO migration.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'consultant',   -- admin | consultant | assistant (role system, later stage)
  settings      jsonb NOT NULL DEFAULT '{}',          -- practice letterhead etc.
  two_fa        boolean NOT NULL DEFAULT false,       -- 2FA flag (later stage)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id         text PRIMARY KEY,                        -- frontend-generated id (uid)
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       jsonb NOT NULL,                          -- the complete client/return object (flexible)
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clients_user_idx ON clients(user_id);
CREATE INDEX IF NOT EXISTS clients_year_idx ON clients ((data->>'taxYear'));

CREATE TABLE IF NOT EXISTS audit_log (                -- prepared for the monitoring/roles stage
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,                           -- login | register | clients_sync | submit ...
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id           bigserial PRIMARY KEY,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  client_id    text,
  session_id   text UNIQUE NOT NULL,
  amount_cents integer NOT NULL,
  currency     text NOT NULL DEFAULT 'eur',
  status       text NOT NULL DEFAULT 'paid',
  created_at   timestamptz NOT NULL DEFAULT now()
);
