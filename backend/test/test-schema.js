/* =============================================================================
   SimplyTax - database schema suite, run on REAL PostgreSQL (PGlite = PostgreSQL compiled to run inside Node)
   1. schema.sql is idempotent  2. it equals the OLD schema + the DDL the server creates itself at startup (no drift)
   3. EVERY SQL statement in server.js / certificate-store.js is valid against it  4. the fake test database models the same columns
   5. the live-database checker works  6. facts about real PostgreSQL the server relies on (and one the server must handle itself)
   Run: node test/test-schema.js
============================================================================= */
const fs = require('fs'), path = require('path');
const { PGlite } = require('@electric-sql/pglite'); const { citext } = require('@electric-sql/pglite/contrib/citext');
const { COLS, diffColumns, diffIndexes, IDX } = require('../tools/check-live-schema.js');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const results = []; const rec = (id, title, ok, d) => { results.push({ id, ok }); console.log(`${ok ? 'OK        ' : 'FAILED    '}  ${id}  ${title}${!ok && d ? '\n              -> ' + String(d).split('\n').join('\n                 ') : ''}`); };
const noPgcrypto = (sql) => sql.replace(/^CREATE EXTENSION IF NOT EXISTS pgcrypto;.*$/m, '');         // gen_random_uuid() is built in; pgcrypto is not bundled in PGlite
const fresh = async () => { const db = new PGlite({ extensions: { citext } }); await db.waitReady; return db; };

/* ---- a small JS scanner: every string / template literal, skipping comments and regex literals (apostrophes in comments must not confuse it) ---- */
function stringLiterals(src) {
  const out = []; let i = 0, prev = '';
  const skipExpr = () => { let d = 1; while (i < src.length && d > 0) { const c = src[i]; if (c === '{') d++; else if (c === '}') d--; else if (c === '`') { i++; scanTemplate(true); continue; } else if (c === "'" || c === '"') { scanQuoted(c, true); continue; } i++; } };
  const scanTemplate = (nested) => { let s = ''; while (i < src.length) { const c = src[i]; if (c === '\\') { s += src[i + 1]; i += 2; continue; } if (c === '`') { i++; if (!nested) out.push(s); return s; } if (c === '$' && src[i + 1] === '{') { i += 2; skipExpr(); s += 'TRUE'; continue; } s += c; i++; } return s; };
  const scanQuoted = (q, nested) => { i++; let s = ''; while (i < src.length) { const c = src[i]; if (c === '\\') { s += src[i + 1]; i += 2; continue; } if (c === q) { i++; if (!nested) out.push(s); return; } if (c === '\n') return; s += c; i++; } };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? src.length : i + 2; continue; }
    if (c === '`') { i++; scanTemplate(false); prev = '`'; continue; }
    if (c === "'" || c === '"') { scanQuoted(c, false); prev = c; continue; }
    if (c === '/' && /[(,=:[!&|?{};]|^$/.test(prev)) { i++; let cls = false; while (i < src.length) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) { i++; break; } else if (d === '\n') break; i++; } while (/[a-z]/.test(src[i] || '')) i++; prev = '/'; continue; }
    if (!/\s/.test(c)) prev = c; i++;
  }
  return out;
}
const SQL_RE = /^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH)\b[\s\S]*\b(FROM|INTO|SET|WHERE)\b/i;

(async () => {
  const schema = noPgcrypto(read('schema.sql'));
  /* 1 --------------------------------------------------------------------------------------------- */
  const A = await fresh(); let err1 = null; try { await A.exec(schema); await A.exec(schema); } catch (e) { err1 = e.message; }
  rec('D1', 'schema.sql builds an empty database and can be run again without errors (idempotent)', !err1, err1);
  const colsA = (await A.query(COLS)).rows, tables = [...new Set(colsA.map(c => c.table_name))].sort();
  /* 2 --------------------------------------------------------------------------------------------- */
  const B = await fresh(); await B.exec(noPgcrypto(fs.readFileSync(path.join(__dirname, 'fixtures', 'schema.v1.sql'), 'utf8')));
  const code = read('server.js') + '\n' + read('eric/certificate-store.js');
  const startupDdl = stringLiterals(code).filter(s => /^\s*(CREATE TABLE IF NOT EXISTS|ALTER TABLE)\b/i.test(s));
  let err2 = null; try { for (const s of startupDdl) await B.exec(s); } catch (e) { err2 = e.message; }
  const colsB = (await B.query(COLS)).rows, d2 = diffColumns(colsA, colsB), d2r = diffColumns(colsB, colsA);
  const sig = (r) => `${r.table_name}.${r.column_name} ${r.data_type} ${r.is_nullable}`;
  const onlyA = colsA.map(sig).filter(x => !colsB.map(sig).includes(x)), onlyB = colsB.map(sig).filter(x => !colsA.map(sig).includes(x));
  rec('D2', `schema.sql equals the OLD schema + the ${startupDdl.length} DDL statements the server runs itself at startup: same tables, columns, types, NOT NULL (no drift)`, !err2 && !onlyA.length && !onlyB.length && tables.length === 6,
      err2 || `only in schema.sql: ${onlyA.join('; ') || '-'}\nonly in old schema + startup code: ${onlyB.join('; ') || '-'}`);
  /* 3 --------------------------------------------------------------------------------------------- */
  const idx = (await A.query(IDX)).rows.map(r => r.indexname);
  const wantIdx = ['clients_user_idx', 'clients_year_idx', 'audit_log_user_action_idx', 'payments_user_client_idx', 'submission_approvals_lookup_idx'];
  rec('D3', 'The indexes the queries rely on exist (client lists, daily extraction quota, payment ledger, submission lookups)', wantIdx.every(w => idx.includes(w)), 'missing: ' + wantIdx.filter(w => !idx.includes(w)).join(', '));
  /* 4 --------------------------------------------------------------------------------------------- */
  const sqls = [...new Set(stringLiterals(code).filter(s => SQL_RE.test(s)).map(s => s.trim()))];
  const fails = [], skipped = []; let ok = 0, n = 0;
  for (const s of sqls) { n++; try { await A.query(`PREPARE q${n} AS ${s}`); await A.query(`DEALLOCATE q${n}`); ok++; }
    catch (e) { if (['42P01', '42703', '42883'].includes(e.code)) fails.push(`${e.code} ${e.message}\n     in: ${s.replace(/\s+/g, ' ').slice(0, 130)}`); else skipped.push(e.code); } }
  const sites = (code.match(/\.query\(/g) || []).length;
  rec('D4', `Every SQL statement in server.js and certificate-store.js is valid on real PostgreSQL against this schema (${ok} distinct statements verified from ${sites} query calls; ${skipped.length} dynamic/untyped skipped; the rest are BEGIN/COMMIT/SAVEPOINT and DDL)`, fails.length === 0 && ok >= 45, `${fails.length} problem(s):\n` + fails.join('\n'));
  /* 5 --------------------------------------------------------------------------------------------- */
  let mockDrift = '';
  try {
    const { createTestPool } = require('./testdb.js'); const mock = createTestPool();
    const mr = (await mock.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`)).rows;
    const have = new Set(mr.map(r => `${r.table_name}.${r.column_name}`)); const want = colsA.map(r => `${r.table_name}.${r.column_name}`);
    const missing = want.filter(w => !have.has(w)); const extra = [...have].filter(h => !want.includes(h));
    mockDrift = (missing.length ? 'the fake test database LACKS: ' + missing.join(', ') : '') + (extra.length ? '\nthe fake test database has columns the real schema does not: ' + extra.join(', ') : '');
  } catch (e) { mockDrift = 'could not inspect the fake test database: ' + e.message; }
  rec('D5', 'The fake test database (used by the other suites) models every table and column of the real schema', mockDrift === '', mockDrift);
  /* 6 --------------------------------------------------------------------------------------------- */
  const live = colsA.filter(c => !(c.table_name === 'clients' && c.column_name === 'submitted_snapshot_sha256')).map(c => c.table_name === 'payments' && c.column_name === 'status' ? { ...c, data_type: 'integer' } : c);
  const dd = diffColumns(colsA, live);
  rec('D6', 'The live-database checker detects a missing column and a wrong column type, and passes an identical database', dd.missingColumns.join() === 'clients.submitted_snapshot_sha256' && dd.typeMismatch.length === 1 && !dd.ok && diffColumns(colsA, colsA).ok && diffColumns(colsA, colsA.filter(c => c.table_name !== 'payments')).missingTables.join() === 'payments',
      JSON.stringify(dd));
  /* 7 --------------------------------------------------------------------------------------------- */
  const uid = '11111111-1111-1111-1111-111111111111';
  await A.query(`INSERT INTO users(id,email,name,password_hash) VALUES ($1,'a@b.c','A','h')`, [uid]);
  await A.query(`INSERT INTO clients(id,user_id,data) VALUES ('c1',$1,'{}')`, [uid]);
  await A.query(`INSERT INTO audit_log(user_id,action) VALUES ($1,'x')`, [uid]);
  await A.query(`INSERT INTO payments(user_id,client_id,session_id,amount_cents) VALUES ($1,'c1','S1',1799)`, [uid]);
  await A.query(`INSERT INTO user_certificates(user_id,pfx_encrypted,pfx_iv,pfx_auth_tag) VALUES ($1,'e','i','t')`, [uid]);
  await A.query(`INSERT INTO submission_approvals(client_id,user_id,approved_payload_sha256,approved_payload_snapshot) VALUES ('c1',$1,'h','{}')`, [uid]);
  await A.query(`DELETE FROM users WHERE id=$1`, [uid]);
  const c = async (t, w = '') => (await A.query(`SELECT count(*)::int n FROM ${t} ${w}`)).rows[0].n;
  rec('D7', 'Deleting a user in the database: returns are removed (cascade), audit rows and the payment ledger are kept anonymised (user_id becomes NULL)',
      await c('clients') === 0 && await c('audit_log', 'WHERE user_id IS NULL') === 1 && await c('payments', 'WHERE user_id IS NULL') === 1, `clients=${await c('clients')} audit=${await c('audit_log')} payments=${await c('payments')}`);
  rec('D8', 'FACT the server must handle itself: certificates and approvals do NOT cascade (text user_id, no foreign key) - they survive a user delete unless the server removes them',
      await c('user_certificates') === 1 && await c('submission_approvals') === 1, `certificates=${await c('user_certificates')} approvals=${await c('submission_approvals')}`);
  await A.query(`INSERT INTO payments(user_id,client_id,session_id,amount_cents) VALUES (NULL,'c9','DUP',1)`);
  const dup = await A.query(`INSERT INTO payments(user_id,client_id,session_id,amount_cents) VALUES (NULL,'c9','DUP',1) ON CONFLICT (session_id) DO NOTHING RETURNING session_id`);
  rec('D9', 'FACT: on real PostgreSQL a conflicting INSERT ... ON CONFLICT DO NOTHING RETURNING returns no row (the payment code reads the ledger back instead of depending on this)', dup.rows.length === 0, `rows=${dup.rows.length}`);
  const bad = results.filter(r => !r.ok);
  console.log(`\n===== Schema suite (real PostgreSQL ${(await A.query('SHOW server_version')).rows[0].server_version}): ${results.length - bad.length} ok, ${bad.length} FAILED =====`); if (bad.length) console.log('Failed:', bad.map(b => b.id).join(', '));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED:', e); process.exit(2); });
