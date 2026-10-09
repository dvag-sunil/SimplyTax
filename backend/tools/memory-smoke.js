#!/usr/bin/env node
/* =============================================================================
   Memory smoke test for the backend: runs the REAL server in-process (fake database, mocked ERiC) and fires thousands of mixed
   authenticated requests, then forces garbage collection and compares memory and open handles with the start.
   A growing number means something is kept forever (an unbounded cache, a timer that is never cleared, ...).
     node --expose-gc tools/memory-smoke.js [requests]          (default 4000)
   It needs test/harness.js and the dev dependencies. Not part of CI: it is a diagnostic you run before big changes.
============================================================================= */
process.env.AUTH_RATE_MAX = '100000000'; process.env.ERIC_HERSTELLER_ID = 'TEST1';
process.chdir(require('path').join(__dirname, '..'));
if (!global.gc) { console.error('Run with:  node --expose-gc tools/memory-smoke.js'); process.exit(2); }
const request = require('supertest'); const N = parseInt(process.argv[2] || '4000', 10);
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
const settle = async () => { for (let i = 0; i < 3; i++) { global.gc(); await new Promise(r => setTimeout(r, 50)); } return process.memoryUsage().heapUsed; };
(async () => {
  const { app } = require('./../test/harness.js');
  const users = [];
  for (let i = 0; i < 25; i++) { const r = await request(app).post('/api/auth/register').send({ name: 'M' + i, email: `m${i}@mem.test`, password: 'passw0rd-long-enough' }); users.push({ t: r.body.token, id: r.body.user.id }); }
  const round = async (count) => {
    for (let i = 0; i < count; i++) {
      const u = users[i % users.length], A = (q) => q.set('Authorization', 'Bearer ' + u.t);
      switch (i % 4) {
        case 0: await A(request(app).get('/api/clients')); break;
        case 1: await A(request(app).put('/api/clients/bulk')).send({ clients: [{ id: 'c' + (i % 40) + u.id.slice(0, 4), taxYear: 2025, p: { firstName: 'x'.repeat(200) } }] }); break;
        case 2: await A(request(app).get('/api/auth/me')); break;
        case 3: await request(app).get('/api/health'); break;
      }
    }
  };
  const logins = async (count) => { for (let i = 0; i < count; i++) await request(app).post('/api/auth/login').set('X-Forwarded-For', `9.${i % 250}.${(i >> 8) % 250}.1`).send({ email: `m${i % 5}@mem.test`, password: 'wrong' }); };   // many different sources against 5 accounts (each costs a deliberate password hash)
  await round(300);                                                     // warm-up (module caches, JIT)
  const base = await settle(), handles0 = process._getActiveHandles().length;
  await round(N); await logins(100);
  const after = await settle(), handles1 = process._getActiveHandles().length;
  const growth = after - base;
  console.log(`requests: ${N}   heap before: ${mb(base)}   after: ${mb(after)}   growth: ${mb(growth)}   open handles: ${handles0} -> ${handles1}`);
  const ok = growth < 20 * 1048576 && handles1 <= handles0 + 2;
  console.log(ok ? 'RESULT: no leak detected (growth under 20 MB, handles stable)' : 'RESULT: INVESTIGATE - memory or handles grew');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
