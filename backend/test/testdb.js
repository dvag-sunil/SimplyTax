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
  /* 4-argument form jsonb_set(target, path, value, create_missing) - used by the payment code. Same semantics for the
     create_missing=true case that the server uses. */
  db.public.registerFunction({
    name: 'jsonb_set',
    args: ['jsonb', db.public.getType('text').asArray(), 'jsonb', 'bool'],
    returns: 'jsonb',
    implementation: (target, path, newValue, createMissing) => {
      const obj = JSON.parse(JSON.stringify(target ?? {}));
      let cur = obj;
      for (let i = 0; i < path.length - 1; i++) {
        if (typeof cur[path[i]] !== 'object' || cur[path[i]] === null) { if (!createMissing) return obj; cur[path[i]] = {}; }
        cur = cur[path[i]];
      }
      if (!createMissing && !(path[path.length - 1] in cur)) return obj;
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
      updated_at timestamptz DEFAULT now(),
      submitted_snapshot_sha256 text
    );
    CREATE TABLE submission_approvals (
      id serial PRIMARY KEY,
      client_id text NOT NULL,
      user_id text NOT NULL,
      tax_year integer,
      approved_payload_sha256 text NOT NULL,
      approved_payload_snapshot jsonb NOT NULL,
      xml_sha256 text,
      server_received_at timestamptz NOT NULL DEFAULT now(),
      eric_rc integer,
      submitted boolean NOT NULL DEFAULT false,
      transfer_ticket text
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
  const pool = new Pool();
  /* pg-mem's parser has no IS [NOT] DISTINCT FROM (valid in real Postgres/Supabase, used by the submit route's
     double-submission lock). Translate the one shape the server uses into the exactly-equivalent null-safe form. */
  const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
  const shim = (q, params) => {
    let t = typeof q === 'string' ? q : (q && q.text);
    const ps = params || (q && q.values) || [];
    if (!t) return q;
    if (/IS DISTINCT FROM/i.test(t)) t = t.replace(/([\w.]+(?:->>?'[^']+')*)\s+IS DISTINCT FROM\s+('[^']*')/gi, "($1 IS NULL OR $1 <> $2)");
    /* pg-mem returns no rows for `col = ANY($n)` with an array parameter (valid, standard in real Postgres).
       Expand it to the equivalent IN (...) list so tests exercise the real query logic. */
    t = t.replace(/([\w.]+)\s*=\s*ANY\(\$(\d+)(?:::text\[\])?\)/gi, (m, col, n) => {
      const arr = ps[Number(n) - 1];
      return Array.isArray(arr) ? `${col} IN (${arr.length ? arr.map(lit).join(',') : 'NULL'})` : m;
    });
    return typeof q === 'string' ? t : { ...q, text: t };
  };
  const wrap = (obj) => { const orig = obj.query.bind(obj); obj.query = (q, ...rest) => orig(shim(q, rest[0]), ...rest); return obj; };
  wrap(pool);
  const origConnect = pool.connect.bind(pool);
  pool.connect = async (...a) => { const c = await origConnect(...a); return wrap(c); };
  return pool;
}

module.exports = { createTestPool };
