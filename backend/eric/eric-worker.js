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

    /* field-level validators - real checksum validation, confirmed exact
       signatures from ericmtapi_8h_source.html, not guessed */
    global.EricMtPruefeIdentifikationsMerkmal = lib.func('int EricMtPruefeIdentifikationsMerkmal(void* instanz, const char* steuerId)');
    global.EricMtPruefeIBAN = lib.func('int EricMtPruefeIBAN(void* instanz, const char* iban)');
    global.EricMtPruefeBIC = lib.func('int EricMtPruefeBIC(void* instanz, const char* bic)');

    /* official Transferticket/error extraction from a server answer -
       replaces manual XML parsing with ERiC's own documented function */
    global.EricMtGetErrormessagesFromXMLAnswer = lib.func(
      'int EricMtGetErrormessagesFromXMLAnswer(void* instanz, const char* xml, ' +
      'void* transferticketPuffer, void* returncodeTHPuffer, void* fehlertextTHPuffer, ' +
      'void* returncodesUndFehlertexteNDHXmlPuffer)'
    );

    /* official Finanzamt directory - confirmed exact signatures from
       ericmtapi_8h_source.html. Hierarchy: Landnummern (Bundesland codes)
       -> Finanzaemter per Land -> full details per Finanzamt (not used
       here, name+address already come back from HoleFinanzaemter). */
    global.EricMtHoleFinanzamtLandNummern = lib.func('int EricMtHoleFinanzamtLandNummern(void* instanz, void* rueckgabeXmlPuffer)');
    global.EricMtHoleFinanzaemter = lib.func('int EricMtHoleFinanzaemter(void* instanz, const char* finanzamtLandNummer, void* rueckgabeXmlPuffer)');

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

function handleValidateFields(msg) {
  /* real ERiC checksum validation for a few key fields - rc===0 means
     valid, any other code means invalid. Only checks fields actually
     present in the request, so this can be called with a partial set
     (e.g. just the IdNr, or just the IBAN). */
  const out = {};
  if (msg.taxId != null) {
    out.taxId = { rc: global.EricMtPruefeIdentifikationsMerkmal(instanz, String(msg.taxId)) };
    out.taxId.valid = out.taxId.rc === 0;
  }
  if (msg.iban != null) {
    out.iban = { rc: global.EricMtPruefeIBAN(instanz, String(msg.iban)) };
    out.iban.valid = out.iban.rc === 0;
  }
  if (msg.bic != null) {
    out.bic = { rc: global.EricMtPruefeBIC(instanz, String(msg.bic)) };
    out.bic.valid = out.bic.rc === 0;
  }
  return out;
}

function extractServerAnswer(serverXml) {
  /* uses the OFFICIAL function instead of manually parsing serverXml -
     replaces the earlier TODO. All four output buffers are created,
     read, and freed the same proven way as every other buffer in this
     file. */
  if (!serverXml) return { transferTicket: null, returncodeTH: null, fehlertextTH: null, perDocErrors: null };
  const b1 = global.EricMtRueckgabepufferErzeugen(instanz);
  const b2 = global.EricMtRueckgabepufferErzeugen(instanz);
  const b3 = global.EricMtRueckgabepufferErzeugen(instanz);
  const b4 = global.EricMtRueckgabepufferErzeugen(instanz);
  const rc = global.EricMtGetErrormessagesFromXMLAnswer(instanz, serverXml, b1, b2, b3, b4);
  const result = rc === 0 ? {
    transferTicket: global.EricMtRueckgabepufferInhalt(instanz, b1) || null,
    returncodeTH: global.EricMtRueckgabepufferInhalt(instanz, b2) || null,
    fehlertextTH: global.EricMtRueckgabepufferInhalt(instanz, b3) || null,
    perDocErrors: global.EricMtRueckgabepufferInhalt(instanz, b4) || null,
  } : { transferTicket: null, returncodeTH: null, fehlertextTH: null, perDocErrors: null, extractRc: rc };
  global.EricMtRueckgabepufferFreigeben(instanz, b1);
  global.EricMtRueckgabepufferFreigeben(instanz, b2);
  global.EricMtRueckgabepufferFreigeben(instanz, b3);
  global.EricMtRueckgabepufferFreigeben(instanz, b4);
  return result;
}


function handleFinanzaemter(msg) {
  /* two-step lookup: first get every Land code, then every Finanzamt in
     each Land. Returns raw XML per step - parsing into a clean structure
     happens in the exporter script, not here, to keep this worker
     focused purely on native calls. */
  const landBuf = global.EricMtRueckgabepufferErzeugen(instanz);
  const rcLand = global.EricMtHoleFinanzamtLandNummern(instanz, landBuf);
  const landXml = global.EricMtRueckgabepufferInhalt(instanz, landBuf);
  global.EricMtRueckgabepufferFreigeben(instanz, landBuf);
  if (rcLand !== 0) return { rc: rcLand, error: 'could not fetch Landnummern' };

  /* extract Land code + name pairs, using the CONFIRMED real XML structure
     (<FinanzamtLand><FinanzamtLandNummer>28</FinanzamtLandNummer><Name>
     Baden-Württemberg</Name></FinanzamtLand>) - not a generic digit
     scrape, so it can't accidentally match something else. */
  const landEntries = [];
  const landRe = /<FinanzamtLand>\s*<FinanzamtLandNummer>(\d+)<\/FinanzamtLandNummer>\s*<Name>([^<]*)<\/Name>\s*<\/FinanzamtLand>/g;
  let lm;
  while ((lm = landRe.exec(landXml))) landEntries.push({ code: lm[1], name: lm[2] });
  const landCodes = landEntries.map(l => l.code);

  const perLand = {};
  for (const land of landCodes) {
    const buf = global.EricMtRueckgabepufferErzeugen(instanz);
    const rc = global.EricMtHoleFinanzaemter(instanz, land, buf);
    perLand[land] = { rc, xml: rc === 0 ? global.EricMtRueckgabepufferInhalt(instanz, buf) : null };
    global.EricMtRueckgabepufferFreigeben(instanz, buf);
  }
  return { rc: 0, landEntries, perLand };
}


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

  /* FIXED (was a manual-parsing TODO): use ERiC's own official function to
     pull the Transferticket and error details out of the server answer,
     rather than regex-parsing serverXml ourselves. */
  const answer = extractServerAnswer(serverXml);

  return { rc, resultXml, serverXml, sent: rc === 0, ...answer };
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
    else if (msg.action === 'validateFields') result = handleValidateFields(msg);
    else if (msg.action === 'finanzaemter') result = handleFinanzaemter(msg);
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
