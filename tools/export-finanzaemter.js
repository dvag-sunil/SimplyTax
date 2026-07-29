#!/usr/bin/env node
/* =============================================================================
   SimplyTax - export the official Finanzamt directory to a static JSON file
   =============================================================================
   One-time (or occasional re-run) script, same pattern as the Phase 1-3
   scripts: talks directly to ERiC, no backend/auth needed. Produces
   finanzamt-directory.json, meant to be committed alongside index.html as
   a static asset - the wizard's Finanzamt dropdown loads this file
   directly, so it works instantly with no live backend dependency.

   Uses the CONFIRMED real XML structure from the official API docs:
     EricHoleFinanzamtLandNummern -> <FinanzamtLand><FinanzamtLandNummer>
       28</FinanzamtLandNummer><Name>Baden-Württemberg</Name></FinanzamtLand>
     EricHoleFinanzaemter -> <Finanzamt><BuFaNummer>2801</BuFaNummer>
       <Name>Finanzamt Offenburg Außenstelle Achern</Name></Finanzamt>

   RUN:
     export ERIC_HOME="/Users/Sunil/Documents/Tax_Application_App/Elster_Developer/ERiC-44.2.4.0-Darwin-universal/ERiC-44.2.4.0/Darwin-universal"
     node export-finanzaemter.js
   Output: finanzamt-directory.json in the current directory - copy it to
   simplytax/assets/finanzamt-directory.json when done.
============================================================================= */

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');

const ERIC_HOME = process.env.ERIC_HOME || '';
if (!ERIC_HOME) { console.error('Please set ERIC_HOME.'); process.exit(1); }

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
const EricMtHoleFinanzamtLandNummern = lib.func('int EricMtHoleFinanzamtLandNummern(void*, void*)');
const EricMtHoleFinanzaemter         = lib.func('int EricMtHoleFinanzaemter(void*, const char*, void*)');

const instanz = EricMtInstanzErzeugen(PLUGINS, LOGDIR);
if (!instanz) { console.error('Instance creation failed - check eric-logs/eric.log'); process.exit(1); }
console.log('[1/3] ERiC instance created');

const landBuf = EricMtRueckgabepufferErzeugen(instanz);
const rcLand = EricMtHoleFinanzamtLandNummern(instanz, landBuf);
if (rcLand !== 0) { console.error('Could not fetch Landnummern, code: ' + rcLand); process.exit(1); }
const landXml = EricMtRueckgabepufferInhalt(instanz, landBuf);
EricMtRueckgabepufferFreigeben(instanz, landBuf);

const landEntries = [];
const landRe = /<FinanzamtLand>\s*<FinanzamtLandNummer>(\d+)<\/FinanzamtLandNummer>\s*<Name>([^<]*)<\/Name>\s*<\/FinanzamtLand>/g;
let lm;
while ((lm = landRe.exec(landXml))) landEntries.push({ code: lm[1], name: decodeXmlEntities(lm[2]) });
console.log('[2/3] Found ' + landEntries.length + ' Bundesland entries: ' + landEntries.map(l => l.name).join(', '));

function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

const directory = {}; // { "Baden-Württemberg": [{bufaNr, name}, ...], ... }
let totalFA = 0;
for (const land of landEntries) {
  const buf = EricMtRueckgabepufferErzeugen(instanz);
  const rc = EricMtHoleFinanzaemter(instanz, land.code, buf);
  if (rc !== 0) {
    console.warn('  ! ' + land.name + ' (code ' + land.code + '): failed, rc=' + rc);
    EricMtRueckgabepufferFreigeben(instanz, buf);
    continue;
  }
  const xml = EricMtRueckgabepufferInhalt(instanz, buf);
  EricMtRueckgabepufferFreigeben(instanz, buf);

  const list = [];
  const faRe = /<Finanzamt>\s*<BuFaNummer>(\d+)<\/BuFaNummer>\s*<Name>([^<]*)<\/Name>\s*<\/Finanzamt>/g;
  let fm;
  while ((fm = faRe.exec(xml))) list.push({ bufaNr: fm[1], name: decodeXmlEntities(fm[2]) });
  directory[land.name] = list;
  totalFA += list.length;
  console.log('  - ' + land.name + ': ' + list.length + ' Finanzämter');
}

EricMtInstanzFreigeben(instanz);
console.log('[3/3] Total: ' + totalFA + ' Finanzämter across ' + landEntries.length + ' Bundesländer');

const outPath = path.join(process.cwd(), 'finanzamt-directory.json');
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), directory }, null, 1), 'utf8');
console.log('');
console.log('Saved: ' + outPath);
console.log('Copy this file to simplytax/assets/finanzamt-directory.json to deploy it.');
