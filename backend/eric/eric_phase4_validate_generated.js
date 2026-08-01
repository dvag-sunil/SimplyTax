#!/usr/bin/env node
/* =============================================================================
   SimplyTax - ERiC Phase 4B: validate GENERATED XML (not the demo example)
   =============================================================================
   This is the real test: takes a real client interchange JSON (exported
   from the app via the "Export ELSTER dataset" feature, or the sample
   elster_dataset_2025_Client.json), runs it through xml-builder.js to
   produce actual XML, then validates that XML with the same proven
   EricMtBearbeiteVorgang(ERIC_VALIDIERE) call from Phase 2 - this time
   against OUR OWN generated XML instead of ERiC's demo file.

   SETUP: copy xml-builder.js and eric-fieldmap.js into the SAME folder as
   this script (or adjust the require() paths below to wherever you saved
   them).

   RUN:
     export ERIC_HOME="/Users/Sunil/Documents/Tax_Application_App/Elster_Developer/ERiC-44.2.4.0-Darwin-universal/ERiC-44.2.4.0/Darwin-universal"
     node eric_phase4_validate_generated.js /path/to/elster_dataset_2025_Client.json
============================================================================= */

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { buildEStXML } = require('/Users/Sunil/Documents/Tax_Application_App/SimplyTax/backend/eric/xml-builder.js');
/* Points directly at the REAL backend code - not a local copy. This means
   xml-builder.js's own require('./eric-fieldmap.js') automatically
   resolves relative to THAT real folder too, so eric-fieldmap.js is also
   read from the real location - there is now only ever one copy of
   either file anywhere, so they can never drift out of sync again. */

const ERIC_HOME = process.env.ERIC_HOME || '';
const DATA_PATH = process.argv[2];
if (!ERIC_HOME) { console.error('Please set ERIC_HOME.'); process.exit(1); }
if (!DATA_PATH) { console.error('Usage: node eric_phase4_validate_generated.js /path/to/dataset.json'); process.exit(1); }
if (!fs.existsSync(DATA_PATH)) { console.error('File not found: ' + DATA_PATH); process.exit(1); }

const isMac = process.platform === 'darwin';
const libName = isMac ? 'libericapi.dylib' : 'libericapi.so';
const LIB = [path.join(ERIC_HOME, 'lib', libName), path.join(ERIC_HOME, libName)].find(p => fs.existsSync(p));
const PLUGINS = [path.join(ERIC_HOME, 'lib', 'plugins'), path.join(ERIC_HOME, 'plugins')].find(p => fs.existsSync(p));
if (!LIB || !PLUGINS) { console.error('Library or plugins not found - check ERIC_HOME.'); process.exit(1); }

const LOGDIR = path.join(process.cwd(), 'eric-logs');
fs.mkdirSync(LOGDIR, { recursive: true });

const lib = koffi.load(LIB);
const EricMtInstanzErzeugen          = lib.func('void* EricMtInstanzErzeugen(const char*, const char*)');
const EricMtInstanzFreigeben         = lib.func('int EricMtInstanzFreigeben(void*)');
const EricMtRueckgabepufferErzeugen  = lib.func('void* EricMtRueckgabepufferErzeugen(void*)');
const EricMtRueckgabepufferInhalt    = lib.func('const char* EricMtRueckgabepufferInhalt(void*, void*)');
const EricMtRueckgabepufferFreigeben = lib.func('int EricMtRueckgabepufferFreigeben(void*, void*)');
const EricMtBearbeiteVorgang = lib.func(
  'int EricMtBearbeiteVorgang(void* instanz, const char* datenpuffer, ' +
  'const char* datenartVersion, uint32_t bearbeitungsFlags, ' +
  'void* druckParameter, void* cryptoParameter, ' +
  'void* rueckgabeXmlPuffer, void* serverantwortXmlPuffer)'
);
/* Real bug found via actual ERiC validation (Fehlercode 10010 +
   ungueltigeSteuernummer): a raw, regionally-formatted Steuernummer must
   be converted into the unified 13-digit ELSTER format before
   transmission - this function does both the conversion AND validates
   it in one call. This same fix was added to the real backend
   (server.js), but THIS standalone script calls buildEStXML directly
   and bypasses that entirely - so it needs its own copy of the same
   conversion step. */
const EricMtMakeElsterStnr = lib.func(
  'int EricMtMakeElsterStnr(void* instanz, const char* steuernrBescheid, ' +
  'const char* landesnr, const char* bundesfinanzamtsnr, void* steuernrPuffer)'
);
const ERIC_VALIDIERE = 2;

/* ---------- create the ERiC instance FIRST, so it can be used for the
   Steuernummer conversion below, before building the XML ---------- */
const instanz = EricMtInstanzErzeugen(PLUGINS, LOGDIR);
if (!instanz) { console.error('Instance creation failed.'); process.exit(1); }
console.log('[1/5] ERiC instance created');

/* ---------- load the data and convert the Steuernummer if present ---------- */
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const rawStNr = data.hauptvordruck?.steuernummer;
const bufaNr = data.hauptvordruck?.finanzamt?.bufaNr;
if (rawStNr && bufaNr) {
  const outBuf = EricMtRueckgabepufferErzeugen(instanz);
  const rc = EricMtMakeElsterStnr(instanz, String(rawStNr), '', String(bufaNr), outBuf);
  if (rc === 0) {
    const converted = EricMtRueckgabepufferInhalt(instanz, outBuf);
    console.log('[2/5] Steuernummer converted: ' + rawStNr + ' -> ' + converted);
    data.hauptvordruck.steuernummer = converted;
  } else {
    console.log('[2/5] Steuernummer conversion FAILED (rc=' + rc + ') - check that the Steuernummer genuinely belongs to Finanzamt ' + bufaNr + '. Proceeding with the raw value, which will likely be rejected by the next step.');
  }
  EricMtRueckgabepufferFreigeben(instanz, outBuf);
} else {
  console.log('[2/5] No Steuernummer or Finanzamt number present - skipping conversion.');
}

/* ---------- build our own XML from the (now converted) data ---------- */
const { xml, skippedSections } = buildEStXML(data);

console.log('[3/5] Generated XML from: ' + DATA_PATH + ' (' + xml.length + ' bytes)');
if (skippedSections.length) {
  console.log('      Skipped (not yet mapped, by design):', skippedSections.join('; '));
}

/* save a copy for inspection regardless of the validate result */
const outPath = path.join(process.cwd(), 'generated-est.xml');
fs.writeFileSync(outPath, xml, 'utf8');
console.log('[4/5] Saved generated XML to: ' + outPath + ' (open it to inspect)');

/* ---------- validate with the real library (reusing the same instance) ---------- */
const rueckgabeBuf = EricMtRueckgabepufferErzeugen(instanz);
/* CORRECTED: real bug found - this was hardcoded to 'ESt_2025' regardless
   of the actual tax year in the loaded JSON. ERiC ships a separate
   validation plugin per year (libcheckESt_2025.dylib, libcheckESt_2023.
   dylib, etc. - already confirmed present in earlier sessions), and
   picks the correct one ONLY based on this exact string. Testing a 2023
   file while always requesting the 2025 plugin explains exactly the
   "lots of errors on a 2023 file" symptom - those weren't necessarily
   real problems with the 2023 data, they were the WRONG year's rulebook
   being applied. xml-builder.js itself was already correctly year-aware
   (the E10 namespace/version attributes derive from data.meta.taxYear
   dynamically) - only this outer call parameter was hardcoded. */
const datenartVersion = 'ESt_' + (data.meta?.taxYear || 2025);
console.log('[4b/5] Using datenartVersion: ' + datenartVersion + ' (derived from the loaded file\'s taxYear, not hardcoded)');
const rc = EricMtBearbeiteVorgang(instanz, xml, datenartVersion, ERIC_VALIDIERE, null, null, rueckgabeBuf, null);

console.log('[5/5] EricMtBearbeiteVorgang returned code: ' + rc + (rc === 0 ? '  (0 = ERIC_OK - OUR GENERATED XML IS VALID)' : ''));

const resultXml = EricMtRueckgabepufferInhalt(instanz, rueckgabeBuf);
console.log('----------------------------------------------------------------');
console.log(resultXml || '(empty result buffer)');
console.log('----------------------------------------------------------------');

EricMtRueckgabepufferFreigeben(instanz, rueckgabeBuf);
EricMtInstanzFreigeben(instanz);

console.log('');
if (rc === 0) {
  console.log('SUCCESS - the XML generator produces output ERiC considers valid.');
  console.log('This is real confirmation the field mapping and XML structure work.');
} else {
  console.log('Got a specific ERiC response (not a crash) - paste the full output');
  console.log('above into the chat, plus generated-est.xml if useful, and we fix');
  console.log('exactly what ERiC is objecting to.');
}
