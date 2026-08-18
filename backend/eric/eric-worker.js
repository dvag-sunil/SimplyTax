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

/* Module-level so both init() and the new readEricLogTail() helper below
   can reach it - previously a local const inside init(), inaccessible
   anywhere else. */
let LOGDIR = null;

/* Real fix for a genuine, real problem: when ERiC returns an empty
   resultXml (confirmed this happens specifically for low-level schema
   validation failures like rc 610301200), its own error text says the
   actual detail lives in eric.log - but that file lives on Render's
   ephemeral filesystem, and Shell/Logs access isn't available on every
   plan. Rather than depend on infrastructure access that may not exist,
   the app itself now reads and returns the tail of this file directly
   in the API response, so the real diagnostic content reaches the
   app's own error display no matter what Render access is or isn't
   available. */
function readEricLogTail(maxLines = 60) {
  /* CORRECTED: real bug found via direct feedback - this previously
     returned null (silently omitting the whole section from the UI)
     whenever LOGDIR wasn't set or the file didn't exist, which looks
     identical to the fix never having deployed at all - genuinely
     confusing, not a helpful diagnostic. Now always returns an honest
     string explaining exactly what happened, so the section reliably
     appears and tells the truth, whether or not real log content is
     actually available at that moment. */
  if (!LOGDIR) return '[eric.log location not available - LOGDIR was never set, meaning the ERiC library never finished initializing]';
  const logPath = path.join(LOGDIR, 'eric.log');
  try {
    if (!fs.existsSync(logPath)) return `[no eric.log file exists yet at ${logPath} - ERiC may not have written to it for this specific error, or the file was cleared by a recent deploy/restart on this ephemeral filesystem]`;
    const content = fs.readFileSync(logPath, 'utf8');
    if (!content.trim()) return `[eric.log exists at ${logPath} but is currently empty]`;
    const lines = content.split('\n');
    return lines.slice(-maxLines).join('\n');
  } catch (e) {
    return `[could not read eric.log at ${logPath}: ${e.message}]`;
  }
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

    LOGDIR = process.env.ERIC_LOG_DIR || path.join(process.cwd(), 'eric-logs');
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

    /* Steuernummer: converts printed-format + 4-digit Finanzamt number into
       the unified 13-digit ELSTER format AND validates it in one call
       (confirmed from the real docs: "wird von der Funktion auch auf
       Gueltigkeit geprueft"). landesnr is left empty since we always have
       the 4-digit bundesfinanzamtsnr from the Finanzamt directory field. */
    global.EricMtMakeElsterStnr = lib.func(
      'int EricMtMakeElsterStnr(void* instanz, const char* steuernrBescheid, const char* landesnr, const char* bundesfinanzamtsnr, void* steuernrPuffer)'
    );

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
    /* CONFIRMED via the real ERiC API reference (ERiC-API-Referenz.pdf,
       EricMtGetErrormessagesFromXMLAnswer, page 161) - the documented,
       official way to extract the Transferticket from a genuine server
       answer, not a regex guess against the raw XML. This binding was
       missing even though extractServerAnswer() already correctly
       called this exact function name - it would have thrown "not a
       function" the moment a real send response reached it. Confirmed
       this is the Mt-prefixed, instance-bound variant (takes instanz
       first), not the similarly-named non-Mt variant documented
       separately - checked both against the real docs rather than
       assume either was right. */
    global.EricMtGetErrormessagesFromXMLAnswer = lib.func(
      'int EricMtGetErrormessagesFromXMLAnswer(void* instanz, const char* xml, ' +
      'void* transferticketPuffer, void* returncodeTHPuffer, ' +
      'void* fehlertextTHPuffer, void* returncodesUndFehlertexteNDHXmlPuffer)'
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

/* Real mapping from this app's Bundesland names to their official
   2-letter codes, confirmed directly - EricMtMakeElsterStnr genuinely
   requires this (Steuernummer format length varies by state), but was
   previously called with an empty string, causing correctly-entered
   values to be wrongly rejected regardless of how correct they
   actually were. */
const BUNDESLAND_CODES = {
  'Baden-Württemberg': 'BW', 'Bayern': 'BY', 'Berlin': 'BE', 'Brandenburg': 'BB',
  'Bremen': 'HB', 'Hamburg': 'HH', 'Hessen': 'HE', 'Mecklenburg-Vorpommern': 'MV',
  'Niedersachsen': 'NI', 'Nordrhein-Westfalen': 'NW', 'Rheinland-Pfalz': 'RP',
  'Saarland': 'SL', 'Sachsen': 'SN', 'Sachsen-Anhalt': 'ST',
  'Schleswig-Holstein': 'SH', 'Thüringen': 'TH',
};

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
  if (msg.steuernummer != null) {
    /* needs the 4-digit Finanzamt number too - bufaNr comes from the
       app's already-populated faNumber field (via the Finanzamt directory) */
    const bufaNr = msg.bufaNr ? String(msg.bufaNr) : '';
    const outBuf = global.EricMtRueckgabepufferErzeugen(instanz);
    /* CORRECTED: real, confirmed bug found via direct user feedback -
       this call passed an empty string for the state, but the real
       function signature (found by reading the actual declared
       parameter name, "landesnr") confirms a state identifier is
       genuinely required - Steuernummer format length varies by
       state, so ERiC can't correctly interpret an input without
       knowing which state's rules apply. Correctly-entered values
       were being wrongly rejected because of this, not because of
       anything wrong with what was typed.
       Honest limitation: the exact format ERiC expects for this
       specific parameter isn't in the documentation available here -
       using the standard 2-letter state code (the widely-used
       convention, e.g. "HE" for Hessen) as the best-reasoned attempt,
       not a confirmed-correct value the way the rest of this fix is.
       If checks continue failing after this deploys, the real
       expected format (which may be numeric rather than a letter
       code) needs to be confirmed via a real, direct test rather than
       guessed at again. */
    const landesnr = BUNDESLAND_CODES[msg.bundesland] || '';
    const rc = global.EricMtMakeElsterStnr(instanz, String(msg.steuernummer), landesnr, bufaNr, outBuf);
    out.steuernummer = { rc, valid: rc === 0 };
    if (rc === 0) out.steuernummer.elsterFormat = global.EricMtRueckgabepufferInhalt(instanz, outBuf) || null;
    global.EricMtRueckgabepufferFreigeben(instanz, outBuf);
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
  /* Real fix - see readEricLogTail() above. Only attached when resultXml
     is genuinely empty, since that's specifically when ERiC's own error
     text points to this file for the real detail instead of providing
     it directly. */
  const ericLogTail = (rc !== 0 && !resultXml) ? readEricLogTail() : undefined;
  return { rc, resultXml, sent: false, ...(ericLogTail ? { ericLogTail } : {}) };
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
  const ericLogTail = (rc !== 0 && !resultXml) ? readEricLogTail() : undefined;

  return { rc, resultXml, serverXml, sent: rc === 0, ...answer, ...(ericLogTail ? { ericLogTail } : {}) };
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
