/* =============================================================================
   SimplyTax - ERiC service manager (runs inside the main API process)
   =============================================================================
   Spawns eric-worker.js as a child process and manages request/response
   correlation over IPC. If the worker crashes (e.g. a genuine native
   segfault, which IS possible with any FFI-bound C library despite our
   best efforts), this manager detects the exit and restarts it - the
   crash never reaches Express, so the rest of the API keeps serving
   requests the whole time.
============================================================================= */

const { fork } = require('child_process');
const path = require('path');

let worker = null;
let ready = false;
let initError = null;
const pending = new Map(); // requestId -> { resolve, reject, timeout }
let nextId = 1;

const WORKER_PATH = path.join(__dirname, 'eric-worker.js');
const REQUEST_TIMEOUT_MS = 30000; // ERiC calls involve network I/O on submit; generous timeout

function spawnWorker() {
  ready = false;
  initError = null;
  worker = fork(WORKER_PATH, [], {
    env: process.env, // ERIC_HOME / ERIC_HERSTELLER_ID / ERIC_CERT_PATH / ERIC_CERT_PIN pass through
    silent: false,
  });

  worker.on('message', (msg) => {
    if (msg.id === '__ready__') {
      ready = msg.result.ready;
      initError = msg.result.initError;
      if (!ready) console.error('[eric-service] worker failed to initialize:', initError);
      else console.log('[eric-service] worker ready');
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return; // late response after our own timeout already rejected it
    pending.delete(msg.id);
    clearTimeout(p.timeout);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  });

  worker.on('exit', (code, signal) => {
    console.error(`[eric-service] worker exited (code=${code}, signal=${signal}) - this is exactly what the`,
      'worker-process isolation is for: the main API is unaffected. Restarting worker in 2s.');
    ready = false;
    // fail every request that was waiting on the now-dead worker
    for (const [id, p] of pending) {
      clearTimeout(p.timeout);
      p.reject(new Error('ERiC worker crashed before responding'));
    }
    pending.clear();
    setTimeout(spawnWorker, 2000);
  });

  worker.on('error', (e) => {
    console.error('[eric-service] worker process error:', e.message);
  });
}

function callWorker(action, payload) {
  return new Promise((resolve, reject) => {
    if (!worker) return reject(new Error('ERiC worker not started'));
    if (!ready) return reject(new Error('ERiC worker not ready: ' + (initError || 'still initializing')));
    const id = String(nextId++);
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('ERiC worker request timed out'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timeout });
    worker.send({ id, action, ...payload });
  });
}

function isReady() { return ready; }
function getInitError() { return initError; }

function validate(xml, datenartVersion) {
  return callWorker('validate', { xml, datenartVersion });
}
function submit(xml, datenartVersion) {
  return callWorker('submit', { xml, datenartVersion });
}
function validateFields(fields) {
  // fields: { taxId?, iban?, bic? } - only the keys present get checked
  return callWorker('validateFields', fields);
}
function getFinanzaemter() {
  return callWorker('finanzaemter', {});
}

/* start the worker as soon as this module is required by server.js.
   If ERIC_HOME is not configured (e.g. local dev without the package),
   the worker will report initError and every validate/submit call will
   cleanly reject rather than crash anything. */
if (process.env.ERIC_HOME) {
  spawnWorker();
} else {
  console.log('[eric-service] ERIC_HOME not set - ERiC features disabled (routes will return 501)');
}

module.exports = { validate, submit, validateFields, getFinanzaemter, isReady, getInitError };
