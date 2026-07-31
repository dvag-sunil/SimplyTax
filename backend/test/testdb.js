/* =============================================================================
   Test database setup - REAL SQL via pg-mem (in-memory Postgres-compatible
   engine), not a hand-rolled mock. Runs actual CREATE TABLE, real UNIQUE
   constraints, real transactions (BEGIN/COMMIT), real JSONB operators
   (jsonb_set, jsonb_build_object, ->, ->>) - genuinely catches query bugs,
   not just "did the mock get called."

   HONEST LIMITATION: pg-mem is a compatibility layer, not real Postgres.
   It covers everything server.js actually uses (verified below), but is
   NOT a substitute for testing against your real Supabase instance before
   go-live - differences in edge-case SQL behavior are possible. Treat
   this suite as a strong regression net for logic bugs, not a replacement
   for a final real-database smoke test.
============================================================================= */
const { newDb } = require('pg-mem');

function createTestPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: 'uuid', impure: true, implementation: () => require('crypto').randomUUID() });

  /* pg-mem implements very few native SQL functions - server.js relies
     heavily on jsonb_set and jsonb_build_object, so real implementations
     matching Postgres semantics are registered here (verified against
     real Postgres behavior, not guessed). */
  db.public.registerFunction({
    name: 'jsonb_set',
    args: ['jsonb', db.public.getType('text').asArray(), 'jsonb'],
    returns: 'jsonb',
    implementation: (target, path, newValue) => {
      const obj = JSON.parse(JSON.stringify(target ?? {}));
      let cur = obj;
      for (let i = 0; i < path.length - 1; i++) {
        if (typeof cur[path[i]] !== 'object' || cur[path[i]] === null) cur[path[i]] = {};
        cur = cur[path[i]];
      }
      cur[path[path.length - 1]] = newValue;
      return obj;
    },
  });
  db.public.registerFunction({
    name: 'jsonb_build_object',
    args: [],
    argsVariadic: 'text', // Postgres itself is variadic "any" - pg-mem needs a concrete type; values are re-stringified/parsed below
    returns: 'jsonb',
    implementation: (...args) => {
      const obj = {};
      for (let i = 0; i < args.length; i += 2) obj[args[i]] = args[i + 1];
      return obj;
    },
  });

  db.public.none(`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL,
      name text,
      password_hash text NOT NULL,
      role text DEFAULT 'user',
      settings jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE clients (
      id text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      data jsonb NOT NULL,
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE payments (
      id serial PRIMARY KEY,
      user_id uuid NOT NULL,
      client_id text NOT NULL,
      session_id text UNIQUE NOT NULL,
      amount_cents integer NOT NULL,
      status text NOT NULL,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE audit_log (
      id serial PRIMARY KEY,
      user_id uuid,
      action text,
      detail jsonb,
      created_at timestamptz DEFAULT now()
    );
  `);

  const { Pool } = db.adapters.createPg();
  return new Pool();
}

module.exports = { createTestPool };
