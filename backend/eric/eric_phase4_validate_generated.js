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
const ERIC_VALIDIERE = 2;

/* ---------- build our own XML from real data ---------- */
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const { xml, skippedSections } = buildEStXML(data);

console.log('[1/4] Generated XML from: ' + DATA_PATH + ' (' + xml.length + ' bytes)');
if (skippedSections.length) {
  console.log('      Skipped (not yet mapped, by design):', skippedSections.join('; '));
}

/* save a copy for inspection regardless of the validate result */
const outPath = path.join(process.cwd(), 'generated-est.xml');
fs.writeFileSync(outPath, xml, 'utf8');
console.log('[2/4] Saved generated XML to: ' + outPath + ' (open it to inspect)');

/* ---------- validate with the real library ---------- */
const instanz = EricMtInstanzErzeugen(PLUGINS, LOGDIR);
if (!instanz) { console.error('Instance creation failed.'); process.exit(1); }
console.log('[3/4] ERiC instance created');

const rueckgabeBuf = EricMtRueckgabepufferErzeugen(instanz);
const rc = EricMtBearbeiteVorgang(instanz, xml, 'ESt_2025', ERIC_VALIDIERE, null, null, rueckgabeBuf, null);

console.log('[4/4] EricMtBearbeiteVorgang returned code: ' + rc + (rc === 0 ? '  (0 = ERIC_OK - OUR GENERATED XML IS VALID)' : ''));

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
