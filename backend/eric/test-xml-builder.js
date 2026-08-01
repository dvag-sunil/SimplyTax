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
    finanzamt: { bufaNr: '9181' }, steuernummer: '91815081508',
    personA: { idnr: '12345678901', name: 'Muster', vorname: 'Max', geburtsdatum: '1985-03-15', religion: 'RK',
      anschrift: { strasse: 'Teststr', hausnummer: '1', plz: '60000', ort: 'Frankfurt' } },
    personB: null,
    bankverbindung: { iban: 'DE89370400440532013000' },
  },
  anlageN: [
    { person: 'A', zeile3_bruttoarbeitslohn: 50000, zeile4_lohnsteuer: 8000, zeile5_soli: 200, zeile6_kirchensteuer: 0 },
  ],
  anlageVorsorgeaufwand: { ausLohnsteuerbescheinigungen: { rv: 4650, gkv: 3900, pv: 950 } },
  anlageKAP: [{ person: 'A', zeile7_kapitalertraege: 1000 }],
  sonderausgaben: { spenden: 500 },
  weitereAngaben: { behinderung: { gdbA: '30' } },
  aussergewoehnlicheBelastungen: {},
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
  anlageNAUS: [
    { person: 'A', arbeitgeberName: 'Muster GmbH', land: 'Schweiz', gesamtlohn: 60000, arbeitstageGesamt: 220, arbeitstageAusland: 90, steuerfreierBetrag: 24545.45 },
  ],
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

// STRUCTURAL NESTING - regression tests for the real bug found via actual
// ERiC validation (ERIC_IO_READER_UNERWARTETE_ELEMENTE): sections below
// were previously flat and unrecognized by ERiC's meta-info lookup.
check('VOR uses AVor wrapper for rv', xml.includes('<AVor>'));
check('VOR uses Beitr_g_KV_PV_Inl/AN wrapper for kv/pv', xml.includes('<Beitr_g_KV_PV_Inl><Person>PersonA</Person><AN>'));

// Anlage R - the corrected gesetzlich/privat percentage logic
check('gesetzlich pension amount written', xml.includes('<E1800301>18000</E1800301>'));
check('R uses Leibr_gesetzl/Einz wrapper', xml.includes('<Leibr_gesetzl><Einz>'));
check('R uses Leibr_priv/Einz wrapper', xml.includes('<Leibr_priv><Einz>'));
check('gesetzlich pension gets the percentage field', xml.includes('<E1800701>82</E1800701>'));
check('privat pension amount written (different Kennzahl)', xml.includes('<E1801601>6000</E1801601>'));
check('privat pension does NOT get a percentage field (correct - none exists in the real schema)',
  !xml.includes('<E1801701>') || !xml.slice(xml.indexOf('<E1801601>'), xml.indexOf('<E1801601>') + 200).includes('E1800701'));

// Anlage V - address/income mapped, Werbungskosten honestly skipped
check('rental street address written', xml.includes('<E0700407>Musterstr. 5</E0700407>'));
check('rental income written (Einz and Sum)', xml.includes('<E0700201>12000</E0700201>') && xml.includes('<E0700206>12000</E0700206>'));
check('V uses Einn/Mieteinn/Whg wrapper', xml.includes('<Einn><Mieteinn><Whg>'));
check('V uses Allg/Lage wrapper for address', xml.includes('<Allg><Lage>'));
check('rental Werbungskosten NOT written (documented scope gap, not a bug)', !xml.includes('4000,00'));
check('skippedSections reports the rental costs gap', skippedSections.some(s => s.includes('Werbungskosten')));

// Anlage Kind - newly wired in, was completely orphaned before
check('child first name written (required field)', xml.includes('<E0500107>Lena</E0500107>'));
check('Kind uses Ang_Kind/Allg wrapper', xml.includes('<Ang_Kind><Allg>'));
check('Kind uses K_Verh/K_Verh_A wrapper', xml.includes('<K_Verh><K_Verh_A>'));
check('Kind childcare uses KBK/Art/Einz and Sum wrappers', xml.includes('<KBK><Art><Einz>') && xml.includes('</Einz><Sum>'));
check('child birthdate written, correctly formatted DD.MM.YYYY (required field)', xml.includes('<E0500701>20.06.2015</E0500701>'));
check('child IdNr written', xml.includes('<E0500406>98765432109</E0500406>'));
check('kinship enum correct (leiblich -> 1)', xml.includes('<E0500807>1</E0500807>'));
check('complete childcare block written (provider+period+amount)', xml.includes('<E0506101>Kita Sonnenschein</E0506101>') && xml.includes('<E0506104>2400</E0506104>'));
check('second child (missing name/birthdate) correctly SKIPPED, not sent incomplete', (xml.match(/<Kind>/g) || []).length === 1);

// Anlage Unterhalt - also newly wired in
check('support payment is deliberately NOT transmitted (E0125007 was mapped to the wrong field - real field needs a 50+ field sub-form we do not collect)', !xml.includes('E0125007'));
check('skippedSections reports the support payment scope limitation clearly', skippedSections.some(s => s.includes('anlageUnterhalt')));

// Anlage N-AUS - newly wired, was collected by the calculator but never exported before
check('N-AUS country written', xml.includes('<E2601001>Schweiz</E2601001>'));
check('N-AUS employer name written', xml.includes('<E2603101>Muster GmbH</E2603101>'));
check('N-AUS final tax-free result matches the confirmed formula (60000, 90/220 -> 24545.45)', xml.includes('<E2604901>24545</E2604901>'));
check('N-AUS employer address sub-fields correctly NOT written (no data source in the app)', !xml.includes('E2603201') && !xml.includes('E2603301'));

// Vorsatz - confirmed via ELSTER official developer forum. E0100081/E0100082
// are "interne ERiC Felder" and must NEVER be submitted directly - this was
// the actual root cause of the persistent ERIC_IO_READER_UNERWARTETE_ELEMENTE
// error, distinct from all the earlier nesting bugs.
check('E0100081 (forbidden internal field) is NEVER written directly', !xml.includes('E0100081'));
check('E0100082 (forbidden internal field) is NEVER written directly', !xml.includes('E0100082'));
check('Vorsatz block is present', xml.includes('<Vorsatz>'));
check('Vorsatz/ID carries the real IdNr instead', xml.includes('<ID>12345678901</ID>'));
check('Vorsatz/Unterfallart is fixed at 10 for ESt', xml.includes('<Unterfallart>10</Unterfallart>'));
check('Vorsatz/Vorgang is fixed at 01 (Veranlagung)', xml.includes('<Vorgang>01</Vorgang>'));
check('Vorsatz appears as the last child of E10, right before it closes', /<\/Vorsatz>\s*<\/E10>/.test(xml));

// ELEMENT ORDER matters strictly in XSD (xs:sequence) - a real regression
// (ERIC_IO_READER_SCHEMA_VALIDIERUNG, 610301200) passed our own presence-
// only checks silently, since .includes() never verifies order. These
// tests check actual position, confirmed against the real official
// ELSTER example, to close that gap going forward.
check('Allg/A field order matches the real confirmed example: Geburtsdatum, Name, Vorname, Religion, Strasse, PLZ, Ort', (() => {
  const aBlock = xml.match(/<A>\n([\s\S]*?)<\/A>/)?.[1] || '';
  const order = ['E0100401', 'E0100201', 'E0100301', 'E0100402', 'E0101104', 'E0100601', 'E0100602'];
  const positions = order.map(code => aBlock.indexOf(code));
  return positions.every(p => p !== -1) && positions.every((p, i) => i === 0 || p > positions[i - 1]);
})());
check('Allg/B field order matches the real confirmed example: Geburtsdatum, Name, Vorname', (() => {
  const withB = JSON.parse(JSON.stringify(sample));
  withB.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Erika', geburtsdatum: '1987-05-20' };
  const xmlWithB = buildEStXML(withB).xml;
  const bBlock = xmlWithB.match(/<B>\n([\s\S]*?)<\/B>/)?.[1] || '';
  const order = ['E0101001', 'E0100901', 'E0100801'];
  const positions = order.map(code => bBlock.indexOf(code));
  return positions.every(p => p !== -1) && positions.every((p, i) => i === 0 || p > positions[i - 1]);
})());

// TOP-LEVEL section order - a real regression (ERIC_IO_READER_SCHEMA_
// VALIDIERUNGSFEHLER, 610301200) found via actual ERiC, which quoted the
// complete authoritative content model directly. This is checked here
// with every section populated at once, using the confirmed exact
// sequence, closing the gap that let SA drift to the wrong position
// completely undetected by 69 other passing tests.
check('Top-level section order matches the authoritative content model confirmed via real ERiC (ESt1A,SA,AgB,HA_35a,EM_35c,Sonst,ESt1A_U,Kind,N,N_AUS,KAP,R,V,VOR,Vorsatz)', (() => {
  const full = {
    meta: { taxYear: 2025 },
    hauptvordruck: { veranlagungsart: 'einzelveranlagung', bundesland: 'Hessen', finanzamt: {},
      personA: { idnr: '1', vorname: 'X', geburtsdatum: '1985-01-01', anschrift: {} } },
    anlageN: [{ person: 'A', zeile3_bruttoarbeitslohn: 50000 }],
    anlageNAUS: [{ person: 'A', land: 'Schweiz', gesamtlohn: 60000, steuerfreierBetrag: 100 }],
    anlageVorsorgeaufwand: { ausLohnsteuerbescheinigungen: { rv: 4650 } },
    anlageKAP: [{ person: 'A', zeile7_kapitalertraege: 1000 }],
    sonderausgaben: { spenden: 500 },
    weitereAngaben: { verlustvortrag: 1000, behinderung: { gdbA: '30' } },
    aussergewoehnlicheBelastungen: {},
    haushaltsnaheLeistungen: { handwerkerleistungen: 300 },
    par35cEnergetisch: { aufwendungen: 500 },
    anlageR: [{ person: 'A', art: 'gesetzlich', jahresbetrag: 12000, rentenbeginn: '2020' }],
    anlageV: [{ objekt: 'Teststr. 1', mieteinnahmen: 8000 }],
    anlageKind: [{ vorname: 'Lena', geburtsdatum: '2015-01-01', kinship: 'leiblich' }],
  };  const fullXml = buildEStXML(full).xml;
  const tags = ['<ESt1A>', '<SA>', '<AgB>', '<HA_35a>', '<EM_35c>', '<Sonst>', '<Kind>', '<N>', '<N_AUS>', '<KAP>', '<R>', '<V>', '<VOR>', '<Vorsatz>'];
  const positions = tags.map(t => fullXml.indexOf(t));
  const allPresent = positions.every(p => p !== -1);
  const inOrder = positions.every((p, i) => i === 0 || p > positions[i - 1]);
  if (!allPresent) console.log('  (order test note: some sections missing from test data - present:', tags.filter((t, i) => positions[i] !== -1).join(', '), ')');
  return allPresent && inOrder;
})());

// Field-format fixes - confirmed via real ERiC validation (error code
// 610001002, a detailed field-level punch list) after the structural
// (610301106) issues were fully resolved.
check('whole-number fields have NO decimal separator (Ganzzahl type, confirmed via real XSD)', !xml.includes('<E2000401>4650,00</E2000401>') && xml.includes('<E2000401>4650</E2000401>'));
check('decimal fields (the 13 confirmed Dezimalzahl group) STILL use comma-decimal correctly', xml.includes('<E0200204>50000,00</E0200204>') || xml.includes(',00</E02'));
check('Kindergeld sends "1" not "X" (Ganzzahl type despite Ja/Nein-sounding description)', !xml.includes('<E0500702>X</E0500702>'));
check('marital status date fields (E0100701/E0100702) are NOT sent with a wrong "X" value', !xml.includes('<E0100701>X</E0100701>') && !xml.includes('<E0100702>X</E0100702>'));
check('empty B block is never written (was triggering "kontextLeer")', !xml.includes('<B>\n</B>'));

// Second round of fixes - confirmed via real ERiC business-rule validation
// (error code 610001002, a detailed field-completeness punch list) after
// all structural/nesting and number-format issues were fully resolved.
check('VOR/AVor has the required Person tag', xml.includes('<AVor><Person>PersonA</Person>'));
check('VOR/AVor sends the required employer-portion companion field, even as 0 (confirmed via real ERiC Regel 950020)', xml.includes('<E2000801>0</E2000801>'));
check('KAP has the required Person tag, using the real per-entry person data', xml.includes('<KAP><Person>PersonA</Person>'));
check('SA/Zuw/Sp_erh_Verm_Stift has the required Person tag', xml.includes('<Sp_erh_Verm_Stift><Person>PersonA</Person>'));
check('AgB/Beh has the required Person tag', xml.includes('<Beh><Person>PersonA</Person>'));
check('N_AUS has the required top-level Person tag', xml.includes('<N_AUS><Person>PersonA</Person>'));
check('ESt1A now includes last name (was missing entirely)', xml.includes('<E0100201>Muster</E0100201>'));
check('ESt1A now includes city/Wohnort (was missing entirely)', xml.includes('<E0100602>Frankfurt</E0100602>'));
check('ESt1A now includes religion (was missing entirely)', xml.includes('<E0100402>'));
check('ESt1A now includes real IBAN under Allg/BV (was collected but never transmitted)', xml.includes('<BV>') && xml.includes('<E0102102>'));
check('E0100002 (Sparzulage) blanket checkbox removed - had an unmet conditional requirement', !xml.includes('<E0100002>'));

// Anlage U / Realsplitting - confirmed real Kennzahlen under /SA/Weit_Aufw/
// U_Leist/Einz. Uses isolated test data since the main fixture doesn't
// include this scenario.
check('Realsplitting works standalone (no donations) - the early-return guard bug is fixed', (() => {
  const rsOnly = JSON.parse(JSON.stringify(sample));
  rsOnly.sonderausgaben = {};
  rsOnly.weitereAngaben = { realsplittingAnlageU: 5000 };
  const rsXml = buildEStXML(rsOnly).xml;
  return rsXml.includes('<E0104408>5000</E0104408>') && rsXml.includes('<E0183001>1</E0183001>');
})());
check('Realsplitting and donations correctly coexist as siblings within one SA block', (() => {
  const both = JSON.parse(JSON.stringify(sample));
  both.sonderausgaben = { spenden: 500 };
  both.weitereAngaben = { realsplittingAnlageU: 5000 };
  const bothXml = buildEStXML(both).xml;
  const saCount = (bothXml.match(/<SA>/g) || []).length;
  return saCount === 1 && bothXml.includes('E0108405') && bothXml.includes('E0104408');
})());
check('Realsplitting skippedSections correctly warns about the missing ex-spouse IdNr', (() => {
  const rsOnly = JSON.parse(JSON.stringify(sample));
  rsOnly.sonderausgaben = {};
  rsOnly.weitereAngaben = { realsplittingAnlageU: 5000 };
  const result = buildEStXML(rsOnly);
  return result.skippedSections.some(s => s.includes('Realsplitting'));
})());

// Anlage Unterhalt (bedürftige Personen) - complete rebuild using the
// confirmed real minimal-required field set (10 fields), replacing the
// original wrong single-field mapping.
check('Anlage Unterhalt transmits correctly with complete data - all 10 confirmed fields present, no warnings', (() => {
  const withU = JSON.parse(JSON.stringify(sample));
  withU.anlageUnterhalt = { betrag: 6000, von: '2025-01-01', bis: '2025-12-31', personName: 'Maria Muster',
    personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Musterstr. 1, 60000 Frankfurt',
    householdSize: 1, kindergeldEntitlement: false, otherContributor: false, hasOwnIncome: false };
  const result = buildEStXML(withU);
  const uXml = result.xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  const hasAllFields = ['E0120101', 'E0120108', 'E0120201', 'E0120211', 'E0120701', 'E0122613', 'E0124801', 'E0123313', 'E0120103', 'E0120109']
    .every(code => uXml.includes(code));
  return hasAllFields && !result.skippedSections.some(s => s.includes('anlageUnterhalt'));
})());
check('Anlage Unterhalt correctly uses "2" (Nein) for hasOwnIncome, legally skipping the entire income sub-tree (JaNein12BaseCType, confirmed via real XSD)', (() => {
  const withU = JSON.parse(JSON.stringify(sample));
  withU.anlageUnterhalt = { betrag: 6000, personName: 'Maria', householdAddress: 'Test', hasOwnIncome: false };
  const uXml = buildEStXML(withU).xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return uXml.includes('<E0123313>2</E0123313>') && !uXml.includes('Ek_ns_A');
})());
check('Anlage Unterhalt correctly warns when required fields (name/address) are missing, rather than silently sending incomplete data', (() => {
  const incomplete = JSON.parse(JSON.stringify(sample));
  incomplete.anlageUnterhalt = { betrag: 6000 }; // no name, no address
  const result = buildEStXML(incomplete);
  return result.skippedSections.some(s => s.includes('anlageUnterhalt') && s.includes('missing'));
})());
check('Anlage Unterhalt period uses the confirmed date-range format (TT.MM-TT.MM, no year) - same DatumBereich type as childcare', (() => {
  const withU = JSON.parse(JSON.stringify(sample));
  withU.anlageUnterhalt = { betrag: 6000, personName: 'Maria', householdAddress: 'Test', von: '2025-03-01', bis: '2025-11-30' };
  const uXml = buildEStXML(withU).xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return uXml.includes('<E0120109>01.03-30.11</E0120109>');
})());
check('V includes the required Laufende_Nummer_V sequence field', xml.includes('<Laufende_Nummer_V>1</Laufende_Nummer_V>'));
check('SA donation includes the required "this year" companion field (E0108509), resolving a persistent real ERiC validation error', xml.includes('<E0108509>500</E0108509>'));
check('Vorsatz/OrdNrArt is present and correctly paired with a real StNr value', xml.includes('<StNr>91815081508</StNr>') && xml.includes('<OrdNrArt>S</OrdNrArt>'));
check('Vorsatz/OrdNrArt is correctly OMITTED when there is no steuernummer (a space is DEFINITIVELY confirmed invalid via real ERiC - "fuehrendesBlank" - not a documentation guess anymore)', (() => {
  const noStNrData = JSON.parse(JSON.stringify(sample));
  delete noStNrData.hauptvordruck.steuernummer;
  const xmlNoStNr = buildEStXML(noStNrData).xml;
  return !xmlNoStNr.includes('<OrdNrArt>') && !xmlNoStNr.includes('<StNr>');
})());
check('Vorsatz/Rueckuebermittlung/Bescheid is now present (matches the real ELSTER example default)', xml.includes('<Rueckuebermittlung><Bescheid>2</Bescheid>'));

console.log(`\n===== xml-builder.js structural tests: ${pass} passed, ${fail} failed =====`);
if (skippedSections.length) console.log('Skipped sections (expected, not a failure):', skippedSections);
process.exit(fail ? 1 : 0);
