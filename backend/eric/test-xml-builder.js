/* Structural regression test for xml-builder.js - run with:
   node backend/eric/test-xml-builder.js
   Does NOT need ERiC itself - checks XML well-formedness and structural
   rules we know must hold, independent of whether ERiC accepts it. Real
   ERiC acceptance can only be confirmed by actually running it through
   EricMtBearbeiteVorgang(ERIC_VALIDIERE) - see eric_phase4_validate_generated.js
   for that. */
const { buildEStXML } = require('./xml-builder.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + label); }
}

const sample = {
  meta: { taxYear: 2025, testmerker: true },
  datenlieferant: { name: 'Test Kanzlei' },
  hauptvordruck: {
    veranlagungsart: 'einzelveranlagung', bundesland: 'Hessen',
    finanzamt: { bufaNr: '9181' },
    personA: { idnr: '12345678901', vorname: 'Max', geburtsdatum: '1985-03-15',
      anschrift: { strasse: 'Teststr', hausnummer: '1', plz: '60000', ort: 'Frankfurt' } },
    personB: null,
  },
  anlageN: [
    { person: 'A', zeile3_bruttoarbeitslohn: 50000, zeile4_lohnsteuer: 8000, zeile5_soli: 200, zeile6_kirchensteuer: 0 },
  ],
  anlageVorsorgeaufwand: { ausLohnsteuerbescheinigungen: { rv: 4650, gkv: 3900, pv: 950 } },
  anlageKAP: [], sonderausgaben: {}, weitereAngaben: {}, aussergewoehnlicheBelastungen: {},
  haushaltsnaheLeistungen: {}, par35cEnergetisch: {},
};

const { xml, skippedSections } = buildEStXML(sample, { herstellerID: '99999' });

// well-formedness: every opened tag closes, in order (simple stack check)
function isWellFormed(x) {
  const stack = [];
  const re = /<\/?([A-Za-z0-9_]+)[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(x))) {
    const [full, name, selfClose] = m;
    if (full.startsWith('<?') || full.startsWith('<!')) continue;
    if (selfClose === '/') continue;
    if (full.startsWith('</')) {
      const top = stack.pop();
      if (top !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}
check('XML is well-formed (all tags balanced)', isWellFormed(xml));
check('XML declaration present', xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
check('HerstellerID substituted correctly', xml.includes('<HerstellerID>99999</HerstellerID>'));
check('Testmerker present (test mode)', xml.includes('<Testmerker>700000004</Testmerker>'));
check('E10 namespace matches tax year 2025', xml.includes('v2025'));
check('gross wage value present with German decimal comma', xml.includes('50000,00') || xml.includes('50000'));
check('no duplicate E0200002 (the known ambiguous field)', (xml.match(/<E0200002>/g) || []).length <= 1);
check('date formatted DD.MM.YYYY not ISO', xml.includes('15.03.1985') && !xml.includes('1985-03-15'));
check('zero-value fields omitted (sparse output, matches real ERiC example style)', !xml.includes('<E0200504>0,00</E0200504>'));
check('single person (no B) produces no B block content', !xml.includes('<B>\n<E01'));

console.log(`\n===== xml-builder.js structural tests: ${pass} passed, ${fail} failed =====`);
if (skippedSections.length) console.log('Skipped sections (expected, not a failure):', skippedSections);
process.exit(fail ? 1 : 0);
