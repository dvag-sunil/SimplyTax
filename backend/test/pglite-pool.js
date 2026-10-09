/* =============================================================================
   A pg-compatible Pool backed by PGlite = REAL PostgreSQL (compiled to run inside Node), built from the real schema.sql.
   Enabled with TEST_DB=pglite (see testdb.js). The default test database (pg-mem) is faster but is only an imitation: it
   implements transactions loosely, lacks some SQL, and returns different row counts. Running a suite on this adapter as well
   shows what real PostgreSQL does.
   Limitation: PGlite has ONE connection, so concurrent transactions are not isolated from each other. Use it for sequential tests.
============================================================================= */
const fs = require('fs'), path = require('path');
function createPglitePool() {
  const { PGlite } = require('@electric-sql/pglite'); const { citext } = require('@electric-sql/pglite/contrib/citext');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8').replace(/^CREATE EXTENSION IF NOT EXISTS pgcrypto;.*$/m, '');   // gen_random_uuid() is built in
  const db = new PGlite({ extensions: { citext } });
  const ready = (async () => { await db.waitReady; await db.exec(schema); })();
  const run = async (q, params) => {
    await ready;
    const text = typeof q === 'string' ? q : q.text, values = params !== undefined ? params : (q && q.values) || [];
    const r = await db.query(text, values);
    const write = /^\s*(insert|update|delete)\b/i.test(text);
    return { rows: r.rows, rowCount: write ? (r.affectedRows != null ? r.affectedRows : r.rows.length) : r.rows.length, fields: r.fields, command: (text.trim().split(/\s+/)[0] || '').toUpperCase() };
  };
  const pool = { query: (q, p) => run(q, p), connect: async () => ({ query: (q, p) => run(q, p), release() {} }), end: async () => {}, on() { return pool; } };
  return pool;
}
module.exports = { createPglitePool };
