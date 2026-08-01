#!/usr/bin/env node
/* =============================================================================
   Empirical test: does a foreign-household Anlage Unterhalt submission
   genuinely require the supported person's German IdNr, or was that
   reading of the documentation wrong? Settled here with real ERiC
   validation, not more documentation interpretation.

   Builds TWO versions of the same foreign-household submission - one
   WITH the IdNr, one WITHOUT - and shows exactly what real ERiC says
   about each, so there's no ambiguity left.

   RUN (same ERIC_HOME already set in your terminal):
     node eric_test_foreign_unterhalt.js
============================================================================= */
const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { buildEStXML } = require('/Users/Sunil/Documents/Tax_Application_App/SimplyTax/backend/eric/xml-builder.js');

const ERIC_HOME = process.env.ERIC_HOME || '';
const HERSTELLER_ID = process.env.ERIC_HERSTELLER_ID || '';
if (!ERIC_HOME) { console.error('Please set ERIC_HOME.'); process.exit(1); }
if (!HERSTELLER_ID) { console.error('Please set ERIC_HERSTELLER_ID.'); process.exit(1); }

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

const instanz = EricMtInstanzErzeugen(PLUGINS, LOGDIR);
if (!instanz) { console.error('Instance creation failed.'); process.exit(1); }

const baseData = {
  meta: { taxYear: 2025 },
  hauptvordruck: { veranlagungsart: 'einzelveranlagung', bundesland: 'Hessen', steuernummer: '91815081508',
    finanzamt: { bufaNr: '9181' },
    personA: { idnr: '02476291358', name: 'Muster', vorname: 'Max', geburtsdatum: '1985-01-01', religion: '--',
      anschrift: { strasse: 'Teststr.', hausnummer: '1', plz: '60000', ort: 'Frankfurt' } },
    personB: null, bankverbindung: { iban: 'DE89370400440532013000' } },
  anlageN: [], anlageVorsorgeaufwand: {}, anlageKAP: [], sonderausgaben: {}, weitereAngaben: {},
  aussergewoehnlicheBelastungen: {}, haushaltsnaheLeistungen: {}, par35cEnergetisch: {},
  anlageR: [], anlageV: [], anlageKind: [],
};

function testScenario(label, unterhaltData) {
  const data = JSON.parse(JSON.stringify(baseData));
  data.anlageUnterhalt = unterhaltData;
  const { xml } = buildEStXML(data, { herstellerID: HERSTELLER_ID });

  const rueckgabeBuf = EricMtRueckgabepufferErzeugen(instanz);
  const rc = EricMtBearbeiteVorgang(instanz, xml, 'ESt_2025', ERIC_VALIDIERE, null, null, rueckgabeBuf, null);
  const resultXml = EricMtRueckgabepufferInhalt(instanz, rueckgabeBuf);
  EricMtRueckgabepufferFreigeben(instanz, rueckgabeBuf);

  console.log('=== ' + label + ' ===');
  console.log('rc = ' + rc + (rc === 0 ? ' (ERIC_OK)' : ''));
  console.log(resultXml || '(empty result buffer - check eric-logs/eric.log for this run)');
  console.log('');
}

testScenario('Foreign household, WITH IdNr and WITH home-country confirmation', {
  betrag: 6000, von: '2025-01-01', bis: '2025-12-31',
  personName: 'Ahmet Yilmaz', personIdnr: '12345678901', relationship: 'Vater',
  householdAddress: 'Istiklal Cad. 1, Istanbul', householdSize: 1,
  kindergeldEntitlement: false, otherContributor: false, hasOwnIncome: false,
  country: 'Türkei', foreignNeedConfirmed: true,
});

testScenario('Foreign household, WITHOUT IdNr (testing whether it is genuinely required)', {
  betrag: 6000, von: '2025-01-01', bis: '2025-12-31',
  personName: 'Ahmet Yilmaz', personIdnr: '', relationship: 'Vater',
  householdAddress: 'Istiklal Cad. 1, Istanbul', householdSize: 1,
  kindergeldEntitlement: false, otherContributor: false, hasOwnIncome: false,
  country: 'Türkei', foreignNeedConfirmed: true,
});

EricMtInstanzFreigeben(instanz);

console.log('Compare the two results above directly - if the WITHOUT-IdNr');
console.log('case comes back clean (rc=0) while the WITH-IdNr case also');
console.log('works, that empirically confirms IdNr is genuinely optional');
console.log('for foreign households. If WITHOUT-IdNr fails specifically on');
console.log('the IdNr field, that confirms the documentation reading was');
console.log('correct. Either way, this is now a real answer, not a guess.');
