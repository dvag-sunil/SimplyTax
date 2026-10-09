#!/usr/bin/env node
/* =============================================================================
   Compares a LIVE database with schema.sql and reports what is missing or different. Read-only: it only reads
   information_schema and never changes anything.

     DATABASE_URL=postgres://user:pass@host:5432/postgres  node tools/check-live-schema.js

   schema.sql is applied to a throwaway in-memory PostgreSQL (PGlite) to learn what the tables SHOULD look like, then compared
   with the real database. Exit code 0 = they match, 1 = differences found.
============================================================================= */
const fs = require('fs'), path = require('path');
const COLS = `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`;
const IDX = `SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public'`;
const key = (r) => `${r.table_name}.${r.column_name}`;
const norm = (t) => String(t).toLowerCase().replace('character varying', 'text').replace('timestamp with time zone', 'timestamptz');
/* expected/actual: arrays of rows from COLS. Only tables that schema.sql defines are compared (a live database may hold other things). */
function diffColumns(expected, actual) {
  const out = { missingTables: [], missingColumns: [], typeMismatch: [], nullMismatch: [], extraColumns: [] };
  const exTables = new Set(expected.map(r => r.table_name)), acTables = new Set(actual.map(r => r.table_name));
  for (const t of exTables) if (!acTables.has(t)) out.missingTables.push(t);
  const acMap = new Map(actual.map(r => [key(r), r]));
  for (const r of expected) {
    if (!acTables.has(r.table_name)) continue;
    const a = acMap.get(key(r));
    if (!a) { out.missingColumns.push(key(r)); continue; }
    if (norm(a.data_type) !== norm(r.data_type)) out.typeMismatch.push(`${key(r)}: live=${a.data_type} expected=${r.data_type}`);
    if (a.is_nullable !== r.is_nullable) out.nullMismatch.push(`${key(r)}: live nullable=${a.is_nullable} expected=${r.is_nullable}`);
  }
  const exMap = new Set(expected.map(key));
  for (const a of actual) if (exTables.has(a.table_name) && !exMap.has(key(a))) out.extraColumns.push(key(a));
  out.ok = !out.missingTables.length && !out.missingColumns.length && !out.typeMismatch.length;   // null/extra differences are reported but do not fail
  return out;
}
const diffIndexes = (expected, actual) => expected.filter(e => !actual.some(a => a.indexname === e.indexname)).map(e => e.indexname).filter(n => !/_pkey$|_key$/.test(n));
async function expectedFromSchema(file) {
  const { PGlite } = require('@electric-sql/pglite'); const { citext } = require('@electric-sql/pglite/contrib/citext');
  const db = new PGlite({ extensions: { citext } }); await db.waitReady;
  await db.exec(fs.readFileSync(file, 'utf8').replace(/^CREATE EXTENSION IF NOT EXISTS pgcrypto;.*$/m, ''));   // pgcrypto is not needed on PostgreSQL 13+ and is not bundled in PGlite
  return { cols: (await db.query(COLS)).rows, idx: (await db.query(IDX)).rows, db };
}
module.exports = { COLS, IDX, diffColumns, diffIndexes, expectedFromSchema };
if (require.main === module) (async () => {
  if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2); }
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /supabase|render|amazonaws/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined });
  const ex = await expectedFromSchema(path.join(__dirname, '..', 'schema.sql'));
  const live = (await pool.query(COLS)).rows, liveIdx = (await pool.query(IDX)).rows; await pool.end();
  const d = diffColumns(ex.cols, live), mi = diffIndexes(ex.idx, liveIdx);
  const show = (t, a) => console.log(`${a.length ? 'x' : 'ok'}  ${t}${a.length ? ':\n     ' + a.join('\n     ') : ''}`);
  console.log(`Live database vs schema.sql (${new Set(ex.cols.map(c => c.table_name)).size} tables expected)\n`);
  show('tables missing in the live database', d.missingTables); show('columns missing in the live database', d.missingColumns);
  show('column types that differ', d.typeMismatch); show('indexes missing (performance only, safe to add: run schema.sql)', mi);
  if (d.nullMismatch.length) show('NOT NULL differences (informational)', d.nullMismatch);
  if (d.extraColumns.length) show('extra columns live that schema.sql does not know (informational)', d.extraColumns);
  console.log(d.ok ? '\nRESULT: the live database has everything the application needs.' : '\nRESULT: DIFFERENCES FOUND - running schema.sql on the live database adds what is missing (it never alters or drops existing data).');
  process.exit(d.ok ? 0 : 1);
})().catch(e => { console.error('Check failed:', e.message); process.exit(2); });
