/* =============================================================================
   SimplyTax - process lifecycle: crash handling and graceful shutdown (real child processes)
   Run: node test/test-lifecycle.js
============================================================================= */
const { spawn } = require('child_process'); const path = require('path');
const BACKEND = path.join(__dirname, '..');
const ENV = { PATH: process.env.PATH, HOME: '/tmp', DATABASE_URL: 'postgres://x:x@127.0.0.1:1/x', JWT_SECRET: 'lifecycle-test-secret-not-real-0123456789', ALLOWED_ORIGIN: 'https://www.taxfile24.com',
  FRONTEND_URL: 'https://www.taxfile24.com/', CERT_ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', ERIC_HERSTELLER_ID: 'TEST1', PORT: '39117' };
const results = []; const rec = (id, title, ok, d) => { results.push({ id, ok }); console.log(`${ok ? 'OK        ' : 'FAILED    '}  ${id}  ${title}${!ok && d ? '\n              -> ' + d : ''}`); };
function run(args, { onOutput, killAfter = 15000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now(), p = spawn(process.execPath, args, { cwd: BACKEND, env: ENV }); let out = '';
    const take = (d) => { out += d; if (onOutput) onOutput(out, p); };
    p.stdout.on('data', take); p.stderr.on('data', take);
    const guard = setTimeout(() => { out += '\n[test] KILLED: did not exit in time'; p.kill('SIGKILL'); }, killAfter);
    p.on('exit', (code, sig) => { clearTimeout(guard); resolve({ code, sig, out, ms: Date.now() - t0 }); });
  });
}
(async () => {
  const a = await run(['-e', "require('./server.js'); setTimeout(() => { throw new Error('boom-test-exception'); }, 100); setTimeout(() => process.exit(99), 8000);"]);
  rec('P1', 'An uncaught exception is logged and the process EXITS with code 1 (it no longer carries on in an unknown state)', a.code === 1 && /boom-test-exception/.test(a.out) && /\[shutdown\] uncaught exception/.test(a.out) && a.ms < 6000, `code=${a.code} ms=${a.ms}\n${a.out.slice(-300)}`);
  const b = await run(['-e', "require('./server.js'); Promise.reject(new Error('rejected-test')); setTimeout(() => process.exit(7), 700);"]);
  rec('P2', 'An unhandled promise rejection is logged loudly but does NOT restart the server (deliberate)', b.code === 7 && /rejected-test/.test(b.out) && /process kept running/.test(b.out), `code=${b.code}\n${b.out.slice(-250)}`);
  let sent = false;
  const c = await run(['server.js'], { onOutput: (o, p) => { if (!sent && /listening on :39117/.test(o)) { sent = true; setTimeout(() => p.kill('SIGTERM'), 300); } } });
  rec('P3', 'SIGTERM (what Render sends on every deploy) stops the real, listening server cleanly: exit code 0, with the shutdown logged', sent && c.code === 0 && /\[shutdown\] SIGTERM/.test(c.out) && c.ms < 10000, `sent=${sent} code=${c.code} sig=${c.sig} ms=${c.ms}\n${c.out.slice(-300)}`);
  const bad = results.filter(r => !r.ok);
  console.log(`\n===== Lifecycle suite: ${results.length - bad.length} ok, ${bad.length} FAILED =====`); if (bad.length) console.log('Failed:', bad.map(x => x.id).join(', '));
  process.exit(bad.length ? 1 : 0);
})();
