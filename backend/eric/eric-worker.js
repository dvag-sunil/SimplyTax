/* =============================================================================
   SimplyTax - ERiC worker process
   =============================================================================
   Runs as a SEPARATE Node process (spawned via child_process.fork from
   eric-service.js), per the original Phase 0 design decision: a native
   library crash must never take down the main Express API. This process
   loads libericapi ONCE at startup and answers validate/submit requests
   over IPC (process.send / process.on('message')).

   Every native call here uses the EXACT signatures already proven working
   in the standalone Phase 1/2/3 scripts on the real Mac (library load,
   instance creation, validate-only, and authenticated send with a real
   certificate). Nothing in this file is a new guess.

   Required environment variables (same names as the Phase 1-3 scripts):
     ERIC_HOME          - path to the unpacked ERiC package
     ERIC_HERSTELLER_ID - your real Hersteller-ID (once received)
     ERIC_CERT_PATH     - path to the .pfx certificate (submit only)
     ERIC_CERT_PIN      - the certificate PIN (submit only)
============================================================================= */

const path = require('path');
const fs = require('fs');
let koffi, lib, instanz;
let ready = false;
let initError = null;

const ERIC_HOME = process.env.ERIC_HOME || '';

function log(msg) {
  // stdout from a forked child is piped to the parent's logs automatically
  console.log('[eric-worker] ' + msg);
}

function init() {
  if (!ERIC_HOME) { initError = 'ERIC_HOME not set'; return; }
  try {
    koffi = require('koffi');
    const isMac = process.platform === 'darwin';
    const libName = isMac ? 'libericapi.dylib' : 'libericapi.so';
    const LIB = [path.join(ERIC_HOME, 'lib', libName), path.join(ERIC_HOME, libName)].find(p => fs.existsSync(p));
    const PLUGINS = [path.join(ERIC_HOME, 'lib', 'plugins'), path.join(ERIC_HOME, 'plugins')].find(p => fs.existsSync(p));
    if (!LIB || !PLUGINS) { initError = 'ERiC library or plugins not found under ERIC_HOME'; return; }

    const LOGDIR = process.env.ERIC_LOG_DIR || path.join(process.cwd(), 'eric-logs');
    fs.mkdirSync(LOGDIR, { recursive: true });

    lib = koffi.load(LIB);

    global.EricMtInstanzErzeugen          = lib.func('void* EricMtInstanzErzeugen(const char*, const char*)');
    global.EricMtInstanzFreigeben         = lib.func('int EricMtInstanzFreigeben(void*)');
    global.EricMtRueckgabepufferErzeugen  = lib.func('void* EricMtRueckgabepufferErzeugen(void*)');
    global.EricMtRueckgabepufferInhalt    = lib.func('const char* EricMtRueckgabepufferInhalt(void*, void*)');
    global.EricMtRueckgabepufferFreigeben = lib.func('int EricMtRueckgabepufferFreigeben(void*, void*)');
    global.EricMtGetHandleToCertificate   = lib.func('int EricMtGetHandleToCertificate(void* instanz, _Out_ uint32_t* hToken, _Out_ uint32_t* iInfoPinSupport, const char* pathToKeystore)');
    global.EricMtCloseHandleToCertificate = lib.func('int EricMtCloseHandleToCertificate(void* instanz, uint32_t hToken)');

    koffi.struct('eric_verschluesselungs_parameter_t', {
      version: 'uint32_t',
      zertifikatHandle: 'uint32_t',
      pin: 'const char*',
    });
    global.EricMtBearbeiteVorgang = lib.func(
      'int EricMtBearbeiteVorgang(void* instanz, const char* datenpuffer, ' +
      'const char* datenartVersion, uint32_t bearbeitungsFlags, ' +
      'void* druckParameter, eric_verschluesselungs_parameter_t* cryptoParameter, ' +
      'void* rueckgabeXmlPuffer, void* serverantwortXmlPuffer)'
    );

    instanz = global.EricMtInstanzErzeugen(PLUGINS, LOGDIR);
    if (!instanz) { initError = 'EricMtInstanzErzeugen returned null - check eric-logs/eric.log'; return; }

    ready = true;
    log('initialized successfully, instance created');
  } catch (e) {
    initError = 'init exception: ' + e.message;
  }
}

const ERIC_VALIDIERE = 2;
const ERIC_SENDE = 4;

function handleValidate(msg) {
  const rueckgabeBuf = global.EricMtRueckgabepufferErzeugen(instanz);
  const rc = global.EricMtBearbeiteVorgang(
    instanz, msg.xml, msg.datenartVersion || 'ESt_2025', ERIC_VALIDIERE,
    null, null, rueckgabeBuf, null
  );
  const resultXml = global.EricMtRueckgabepufferInhalt(instanz, rueckgabeBuf);
  global.EricMtRueckgabepufferFreigeben(instanz, rueckgabeBuf);
  return { rc, resultXml, sent: false };
}

function handleSubmit(msg) {
  const CERT_PATH = process.env.ERIC_CERT_PATH || '';
  const CERT_PIN = process.env.ERIC_CERT_PIN || '';
  if (!CERT_PATH || !CERT_PIN) {
    return { rc: -1, error: 'ERIC_CERT_PATH / ERIC_CERT_PIN not configured on this server' };
  }
  const hTokenOut = [null];
  const pinSupportOut = [0];
  const rcCert = global.EricMtGetHandleToCertificate(instanz, hTokenOut, pinSupportOut, CERT_PATH);
  if (rcCert !== 0 || hTokenOut[0] == null) {
    return { rc: rcCert, error: 'certificate could not be opened' };
  }
  const cryptoParam = { version: 3, zertifikatHandle: hTokenOut[0], pin: CERT_PIN };

  const rueckgabeBuf = global.EricMtRueckgabepufferErzeugen(instanz);
  const serverantwortBuf = global.EricMtRueckgabepufferErzeugen(instanz);
  const rc = global.EricMtBearbeiteVorgang(
    instanz, msg.xml, msg.datenartVersion || 'ESt_2025', ERIC_VALIDIERE | ERIC_SENDE,
    null, cryptoParam, rueckgabeBuf, serverantwortBuf
  );
  const resultXml = global.EricMtRueckgabepufferInhalt(instanz, rueckgabeBuf);
  const serverXml = global.EricMtRueckgabepufferInhalt(instanz, serverantwortBuf);

  global.EricMtRueckgabepufferFreigeben(instanz, rueckgabeBuf);
  global.EricMtRueckgabepufferFreigeben(instanz, serverantwortBuf);
  global.EricMtCloseHandleToCertificate(instanz, hTokenOut[0]);

  /* the Transferticket, if present, lives inside serverXml - extraction is
     left to the caller (eric-service.js), since the exact tag depends on
     the server response format, not yet seen against a real accepted
     submission (blocked on the Hersteller-ID as of this writing). */
  return { rc, resultXml, serverXml, sent: rc === 0 };
}

init();

process.on('message', (msg) => {
  if (!msg || !msg.id) return;
  if (!ready) {
    process.send({ id: msg.id, error: initError || 'worker not ready' });
    return;
  }
  try {
    let result;
    if (msg.action === 'validate') result = handleValidate(msg);
    else if (msg.action === 'submit') result = handleSubmit(msg);
    else { process.send({ id: msg.id, error: 'unknown action: ' + msg.action }); return; }
    process.send({ id: msg.id, result });
  } catch (e) {
    /* a thrown JS exception here is recoverable - process.send still works.
       A true native segfault would kill this whole process instead, which
       is exactly the isolation this worker exists to provide: the parent
       (eric-service.js) detects the exit and can restart this worker
       without the main API ever going down. */
    process.send({ id: msg.id, error: 'worker exception: ' + e.message });
  }
});

process.send && process.send({ id: '__ready__', result: { ready, initError } });
