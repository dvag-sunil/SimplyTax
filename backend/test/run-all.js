#!/usr/bin/env node
/* =============================================================================
   Runs every backend suite, each in its OWN process (several need their own environment, rate limiter or port).
     node test/run-all.js              the normal run (fast in-memory test database)
     node test/run-all.js --real-db    the same suites against REAL PostgreSQL (PGlite) built from schema.sql
     node test/run-all.js --only=sessions,payments     a subset (substring match)
   Exit code 0 only if every suite succeeded.
============================================================================= */
const { spawn } = require('child_process'); const path = require('path');
const REAL = process.argv.includes('--real-db');
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const SUITES = ['test-api', 'test-payments', 'test-extract', 'test-eric-routes', 'test-submit-recovery', 'test-sessions', 'test-session-abuse',
  'test-account-deletion', 'test-hardening', 'test-security-state', 'test-lifecycle', 'test-security', 'test-schema'];
const run = (name) => new Promise((resolve) => {
  const t0 = Date.now(); let out = '';
  const p = spawn(process.execPath, [path.join(__dirname, name + '.js')], { cwd: path.join(__dirname, '..'), env: { PATH: process.env.PATH, HOME: process.env.HOME || '/tmp', ...(REAL ? { TEST_DB: 'pglite' } : {}) } });
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const guard = setTimeout(() => { out += '\n[run-all] killed after 280 s'; p.kill('SIGKILL'); }, 280000);
  p.on('exit', (code) => { clearTimeout(guard); const line = (out.split('\n').filter(l => l.startsWith('=====')).pop() || '(no summary line)').replace(/=/g, '').trim(); resolve({ name, code, line, secs: ((Date.now() - t0) / 1000).toFixed(0), out }); });
});
(async () => {
  console.log(`Backend test run on ${REAL ? 'REAL PostgreSQL (PGlite)' : 'the in-memory test database'}\n`);
  let failed = 0;
  for (const s of SUITES.filter(s => !only.length || only.some(o => s.includes(o)))) {
    const r = await run(s); if (r.code !== 0) failed++;
    console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name.padEnd(24)} ${String(r.secs).padStart(3)}s  ${r.line}`);
    if (r.code !== 0) console.log(r.out.split('\n').filter(l => /FAILED|VULNERABLE|CRASH|Error/.test(l)).slice(0, 8).map(l => '        ' + l.slice(0, 200)).join('\n'));
  }
  console.log(failed ? `\n${failed} suite(s) FAILED` : '\nAll suites passed.');
  process.exit(failed ? 1 : 0);
})();
