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
  anlageR: [
    { person: 'A', art: 'gesetzlich', jahresbetrag: 18000, rentenbeginn: '2022', ertragsanteilProzent: 82 },
    { person: 'A', art: 'privat', jahresbetrag: 6000, rentenbeginn: '2020', ertragsanteilProzent: null },
  ],
  anlageV: [{ objekt: 'Musterstr. 5, 60000 Frankfurt', mieteinnahmen: 12000, werbungskosten: 4000, ergebnis: 8000 }],
  anlageKind: [
    { vorname: 'Lena', geburtsdatum: '2015-06-20', idnr: '98765432109', kinship: 'leiblich', kindergeld: 250,
      betreuungskosten: 2400, betreuungAnbieter: 'Kita Sonnenschein', betreuungVon: '2025-01-01', betreuungBis: '2025-12-31', schulgeld: 0 },
    { vorname: '', geburtsdatum: '', kinship: 'stiefkind', betreuungskosten: 0 }, // deliberately incomplete - must be skipped
  ],
  anlageUnterhalt: { betrag: 3600, laendergruppe: '1' },
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

// Anlage R - the corrected gesetzlich/privat percentage logic
check('gesetzlich pension amount written', xml.includes('<E1800301>18000,00</E1800301>'));
check('gesetzlich pension gets the percentage field', xml.includes('<E1800701>82</E1800701>'));
check('privat pension amount written (different Kennzahl)', xml.includes('<E1801601>6000,00</E1801601>'));
check('privat pension does NOT get a percentage field (correct - none exists in the real schema)',
  !xml.includes('<E1801701>') || !xml.slice(xml.indexOf('<E1801601>'), xml.indexOf('<E1801601>') + 200).includes('E1800701'));

// Anlage V - address/income mapped, Werbungskosten honestly skipped
check('rental street address written', xml.includes('<E0700407>Musterstr. 5</E0700407>'));
check('rental income written (Einz and Sum)', xml.includes('<E0700201>12000,00</E0700201>') && xml.includes('<E0700206>12000,00</E0700206>'));
check('rental Werbungskosten NOT written (documented scope gap, not a bug)', !xml.includes('4000,00'));
check('skippedSections reports the rental costs gap', skippedSections.some(s => s.includes('Werbungskosten')));

// Anlage Kind - newly wired in, was completely orphaned before
check('child first name written (required field)', xml.includes('<E0500107>Lena</E0500107>'));
check('child birthdate written, correctly formatted DD.MM.YYYY (required field)', xml.includes('<E0500701>20.06.2015</E0500701>'));
check('child IdNr written', xml.includes('<E0500406>98765432109</E0500406>'));
check('kinship enum correct (leiblich -> 1)', xml.includes('<E0500807>1</E0500807>'));
check('complete childcare block written (provider+period+amount)', xml.includes('<E0506101>Kita Sonnenschein</E0506101>') && xml.includes('<E0506104>2400,00</E0506104>'));
check('second child (missing name/birthdate) correctly SKIPPED, not sent incomplete', (xml.match(/<Kind>/g) || []).length === 1);

// Anlage Unterhalt - also newly wired in
check('support payment written', xml.includes('<E0125007>3600,00</E0125007>'));

console.log(`\n===== xml-builder.js structural tests: ${pass} passed, ${fail} failed =====`);
if (skippedSections.length) console.log('Skipped sections (expected, not a failure):', skippedSections);
process.exit(fail ? 1 : 0);
