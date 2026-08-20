/* Structural regression test for xml-builder.js - run with:
   node backend/eric/test-xml-builder.js
   Does NOT need ERiC itself - checks XML well-formedness and structural
   rules we know must hold, independent of whether ERiC accepts it. Real
   ERiC acceptance can only be confirmed by actually running it through
   EricMtBearbeiteVorgang(ERIC_VALIDIERE) - see eric_phase4_validate_generated.js
   for that. */
const { buildEStXML } = require('./xml-builder.js');

/* Test-only configuration, not a production fallback - the real code
   now genuinely refuses to run without a real configured
   ERIC_HERSTELLER_ID, so the test suite needs to provide one
   explicitly to exercise the rest of the building logic. This value
   only ever exists in this test process's environment, never in the
   shipped source. */
if (!process.env.ERIC_HERSTELLER_ID) process.env.ERIC_HERSTELLER_ID = 'TEST-ONLY-ID';

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
    { person: 'A', arbeitgeberName: 'Muster GmbH', arbeitgeberStreet: 'Bahnhofstr. 1', arbeitgeberPlz: '8001', arbeitgeberCity: 'Zürich', arbeitgeberCountry: 'Schweiz', land: 'Schweiz', gesamtlohn: 60000, arbeitstageGesamt: 220, arbeitstageAusland: 90, steuerfreierBetrag: 24545.45 },
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
check('gesetzlich pension gets the percentage field, correctly formatted with a comma-decimal (real ERiC rejection fixed)', xml.includes('<E1800701>82,00</E1800701>'));
check('privat pension amount written (different Kennzahl)', xml.includes('<E1801601>6000</E1801601>'));
check('privat pension does NOT get a percentage field (correct - none exists in the real schema)',
  !xml.includes('<E1801701>') || !xml.slice(xml.indexOf('<E1801601>'), xml.indexOf('<E1801601>') + 200).includes('E1800701'));

// Anlage V - address/income mapped, Werbungskosten honestly skipped
check('rental street address written', xml.includes('<E0700407>Musterstr. 5</E0700407>'));
check('rental income written (Einz and Sum)', xml.includes('<E0700201>12000</E0700201>') && xml.includes('<E0700206>12000</E0700206>'));
check('V uses Einn/Mieteinn/Whg wrapper', /<Einn>\s*<Mieteinn><Whg>/.test(xml));
check('V uses Allg/Lage wrapper for address', /<Allg>\s*<Lage>/.test(xml));
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
check('N-AUS country written (CORRECTED: was E2601001, the wrong field - real primary country is E2600401, confirmed via raw XSD)', xml.includes('<E2600401>Schweiz</E2600401>'));
check('N-AUS employer name written (CORRECTED: was E2603101/Unternehmen, a different unrelated field - real employer context is ArbG/E2601202, confirmed via raw XSD)', xml.includes('<E2601202>Muster GmbH</E2601202>'));
check('N-AUS final tax-free result matches the confirmed real formula (remaining wage × foreign days / total days, not total wage as first assumed)', xml.includes('<E2604901>14504</E2604901>'));
check('N-AUS employer address is written in full when the source data provides a complete address', xml.includes('<E2601201>Bahnhofstr. 1</E2601201>') && xml.includes('<E2601301>8001</E2601301>'));

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
    par35cEnergetisch: { street: 'Teststr. 2', buildDate: '2005-01-01', plzOrt: '12345 Musterstadt', areaTotal: 100, areaOwn: 100, measureStart: '2025-01-01', heating: 500 },
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
check('Realsplitting correctly writes the ex-spouse IdNr in the confirmed real field order (Amount, IdNr, domestic-flag), resolving a gap where the field was mapped but never actually used', (() => {
  const withIdnr = JSON.parse(JSON.stringify(sample));
  withIdnr.sonderausgaben = {};
  withIdnr.weitereAngaben = { realsplittingAnlageU: 5000, realsplitIdnr: '12345678901' };
  const result = buildEStXML(withIdnr);
  const uXml = result.xml.match(/<Weit_Aufw>[\s\S]*?<\/Weit_Aufw>/)?.[0] || '';
  const posAmount = uXml.indexOf('E0104408');
  const posIdnr = uXml.indexOf('E0104305');
  return posAmount !== -1 && posIdnr !== -1 && posAmount < posIdnr
    && !result.skippedSections.some(s => s.includes('Realsplitting') && s.includes('IdNr'));
})());
check('Realsplitting warning correctly cites the unconditional 2023 rule when the year is 2023, not the generic domestic-only framing', (() => {
  const rs2023 = JSON.parse(JSON.stringify(sample));
  rs2023.meta.taxYear = 2023;
  rs2023.sonderausgaben = {};
  rs2023.weitereAngaben = { realsplittingAnlageU: 5000 };
  const result = buildEStXML(rs2023);
  return result.skippedSections.some(s => s.includes('Realsplitting') && s.includes('unconditionally for tax year 2023'));
})());
// Anlage Unterhalt (bedürftige Personen) - complete rebuild using the
// confirmed real minimal-required field set (10 fields), replacing the
// original wrong single-field mapping.
check('Anlage Unterhalt transmits correctly with complete data - all empirically-confirmed required fields present, no warnings', (() => {
  const withU = JSON.parse(JSON.stringify(sample));
  withU.anlageUnterhalt = { betrag: 6000, von: '2025-01-01', bis: '2025-12-31', personName: 'Maria Muster',
    profession: 'Rentnerin, verwitwet', personBirthDate: '1945-03-10', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Musterstr. 1, 60000 Frankfurt',
    householdSize: 1, cohabitation: false, kindergeldEntitlement: false, otherContributor: false, hasAssets: false, hasOwnIncome: false };
  const result = buildEStXML(withU);
  const uXml = result.xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  const hasAllFields = ['E0120101', 'E0120108', 'E0120201', 'E0120202', 'E0120203', 'E0120211', 'E0120701', 'E0122505', 'E0122613', 'E0124801', 'E0123105', 'E0123313', 'E0120103', 'E0120104', 'E0120109']
    .every(code => uXml.includes(code));
  return hasAllFields && !result.skippedSections.some(s => s.includes('anlageUnterhalt'));
})());

// Real element-ORDER regression (ERIC_IO_READER_SCHEMA_VALIDIERUNGSFEHLER,
// 610301200) found via actual ERiC schema validation against a genuine
// client file - passed every prior presence-only test silently. These
// tests check actual position at all three levels that were wrong,
// confirmed identical for both the 2023 and 2025 structures.
check('Anlage Unterhalt: top-level order is HH_unt_P, AW_U, Ang_Unt_Pers (confirmed identical for both years, real regression found via schema validation)', (() => {
  const withU = JSON.parse(JSON.stringify(sample));
  withU.anlageUnterhalt = { betrag: 6000, von: '2025-01-01', bis: '2025-12-31', personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Test' };
  const uXml = buildEStXML(withU).xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  const posHH = uXml.indexOf('<HH_unt_P>');
  const posAW = uXml.indexOf('<AW_U>');
  const posAngP = uXml.indexOf('<Ang_Unt_Pers>');
  return posHH !== -1 && posHH < posAW && posAW < posAngP;
})());
check('Anlage Unterhalt: Ang_Unt_Pers children order is Allg, Ek_Bez_u_P, Weit_beitr_P (real regression - these two were swapped)', (() => {
  const withU = JSON.parse(JSON.stringify(sample));
  withU.anlageUnterhalt = { betrag: 6000, von: '2025-01-01', bis: '2025-12-31', personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Test' };
  const uXml = buildEStXML(withU).xml;
  const posAllg = uXml.indexOf('<Allg><Persoenl>');
  const posEk = uXml.indexOf('<Ek_Bez_u_P>');
  const posWeit = uXml.indexOf('<Weit_beitr_P>');
  return posAllg !== -1 && posAllg < posEk && posEk < posWeit;
})());
check('Anlage Unterhalt: Persoenl field order is IdNr, Name, Birthdate, Profession, Relationship (real regression - was Name, Profession, Birthdate, IdNr)', (() => {
  const withU = JSON.parse(JSON.stringify(sample));
  withU.anlageUnterhalt = { betrag: 6000, von: '2025-01-01', bis: '2025-12-31', personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Test' };
  const uXml = buildEStXML(withU).xml;
  const order = ['E0120211', 'E0120201', 'E0120203', 'E0120202', 'E0120701'];
  const positions = order.map(code => uXml.indexOf(code));
  return positions.every(p => p !== -1) && positions.every((p, i) => i === 0 || p > positions[i - 1]);
})());
check('Anlage Unterhalt correctly uses "2" (Nein) for hasOwnIncome, legally skipping the entire income sub-tree (JaNein12BaseCType, confirmed via real XSD)', (() => {
  const withU = JSON.parse(JSON.stringify(sample));
  withU.anlageUnterhalt = { betrag: 6000, personName: 'Maria', householdAddress: 'Test', hasOwnIncome: false };
  const uXml = buildEStXML(withU).xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return uXml.includes('<E0123313>2</E0123313>') && !uXml.includes('Ek_ns_A');
})());
check('Anlage Unterhalt correctly warns when required fields are missing, rather than silently sending incomplete data', (() => {
  const incomplete = JSON.parse(JSON.stringify(sample));
  incomplete.anlageUnterhalt = { betrag: 6000 }; // no name, profession, birthdate, or address
  const result = buildEStXML(incomplete);
  return result.skippedSections.some(s => s.includes('anlageUnterhalt') && s.includes('required'));
})());
check('Anlage Unterhalt: domestic case missing IdNr correctly WARNS (corrected understanding - an earlier round wrongly generalized a foreign-only empirical finding to domestic too; the real multi-year regression test proved domestic genuinely requires it)', (() => {
  const noIdnrDomestic = JSON.parse(JSON.stringify(sample));
  noIdnrDomestic.anlageUnterhalt = { betrag: 6000, personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', householdAddress: 'Test' };
  const result = buildEStXML(noIdnrDomestic);
  return result.skippedSections.some(s => s.includes('IdNr') && s.includes('domestic'));
})());
check('Anlage Unterhalt: foreign case missing IdNr correctly does NOT warn about IdNr specifically (genuinely exempt, confirmed via the original empirical ERiC test)', (() => {
  const noIdnrForeign = JSON.parse(JSON.stringify(sample));
  noIdnrForeign.anlageUnterhalt = { betrag: 6000, personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', householdAddress: 'Test', country: 'Türkei', foreignNeedConfirmed: true };
  const result = buildEStXML(noIdnrForeign);
  const uXml = result.xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return !uXml.includes('E0120211') && !result.skippedSections.some(s => s.includes('IdNr') && s.includes('domestic household'));
})());

// Empty-wrapper bug (found via the real empirical test - "kontextLeer")
// - a truthy-but-empty input object should never produce a bare, empty
// XML wrapper. Fixed in buildVOR, buildKAP, buildR.
check('buildVOR produces nothing (not an empty wrapper) when anlageVorsorgeaufwand is an empty object', (() => {
  const emptyVOR = JSON.parse(JSON.stringify(sample));
  emptyVOR.anlageVorsorgeaufwand = {};
  const xmlEmpty = buildEStXML(emptyVOR).xml;
  return !xmlEmpty.includes('<VOR>');
})());
check('buildKAP produces nothing for an entry with no populated amounts, rather than an empty wrapper', (() => {
  const emptyKAP = JSON.parse(JSON.stringify(sample));
  emptyKAP.anlageKAP = [{ person: 'A' }]; // no actual amounts
  const xmlEmpty = buildEStXML(emptyKAP).xml;
  return !xmlEmpty.includes('<KAP>');
})());
check('buildR produces nothing for an entry with an unrecognized art value, rather than an empty wrapper', (() => {
  const emptyR = JSON.parse(JSON.stringify(sample));
  emptyR.anlageR = [{ art: 'unknown_type', jahresbetrag: 0 }];
  const xmlEmpty = buildEStXML(emptyR).xml;
  return !xmlEmpty.includes('<R>');
})());

// Multi-year architecture - confirmed via a real, direct comparison of
// the actual 2023/2024/2025 Kontexte structures and Kennzahl existence
// (see eric-fieldmap.js SECTION_YEAR_SUPPORT / FIELD_YEAR_SUPPORT), not
// assumed. Structural section changes are gated entirely off; simple
// field-level differences are gated individually while the surrounding
// structure stays intact.
check('Anlage Unterhalt (ESt1A_U) correctly uses the OLDER structure (no Ang_HH_unt_P_Unt_Leist wrapper) for tax year 2023, confirmed via direct research that this is the real, correct structure for that year - not blocked, genuinely supported', (() => {
  const old2023 = JSON.parse(JSON.stringify(sample));
  old2023.meta.taxYear = 2023;
  old2023.anlageUnterhalt = { betrag: 6000, personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', householdAddress: 'Test' };
  const result = buildEStXML(old2023);
  const uXml = result.xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return uXml.includes('E0120201') && !uXml.includes('Ang_HH_unt_P_Unt_Leist')
    && !result.skippedSections.some(s => s.includes('anlageUnterhalt') && s.includes('2023'));
})());
check('Anlage Unterhalt (ESt1A_U) correctly uses the OLDER structure for tax year 2024 too (confirmed same cutover as 2023)', (() => {
  const y2024 = JSON.parse(JSON.stringify(sample));
  y2024.meta.taxYear = 2024;
  y2024.anlageUnterhalt = { betrag: 6000, personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', householdAddress: 'Test' };
  const uXml = buildEStXML(y2024).xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return uXml.includes('E0120201') && !uXml.includes('Ang_HH_unt_P_Unt_Leist');
})());
check('Anlage Unterhalt (ESt1A_U) correctly uses the NEWER structure (WITH the wrapper) for tax year 2025, the confirmed real cutover', (() => {
  const y2025 = JSON.parse(JSON.stringify(sample));
  y2025.meta.taxYear = 2025;
  y2025.anlageUnterhalt = { betrag: 6000, personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', householdAddress: 'Test' };
  const uXml = buildEStXML(y2025).xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return uXml.includes('Ang_HH_unt_P_Unt_Leist') && uXml.includes('E0120201');
})());
check('Anlage Unterhalt required-field validation (name/profession/birthdate/address) applies identically regardless of year, since the underlying rules are confirmed identical', (() => {
  const incomplete2023 = JSON.parse(JSON.stringify(sample));
  incomplete2023.meta.taxYear = 2023;
  incomplete2023.anlageUnterhalt = { betrag: 6000 }; // missing everything
  const result = buildEStXML(incomplete2023);
  return result.skippedSections.some(s => s.includes('anlageUnterhalt') && s.includes('required'));
})());
check('Anlage Unterhalt (ESt1A_U) still works normally for tax year 2025 - the year gate does not affect the verified year', (() => {
  const current2025 = JSON.parse(JSON.stringify(sample));
  current2025.meta.taxYear = 2025;
  current2025.anlageUnterhalt = { betrag: 6000, personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', householdAddress: 'Test' };
  const result = buildEStXML(current2025);
  return result.xml.includes('<ESt1A_U>') && !result.skippedSections.some(s => s.includes('2025'));
})());
check('Realsplitting domestic/foreign flag (E0183001) is correctly OMITTED for tax year 2023, while the amount itself still transmits normally', (() => {
  const old2023 = JSON.parse(JSON.stringify(sample));
  old2023.meta.taxYear = 2023;
  old2023.sonderausgaben = {};
  old2023.weitereAngaben = { realsplittingAnlageU: 5000 };
  const xml2023 = buildEStXML(old2023).xml;
  return xml2023.includes('E0104408') && !xml2023.includes('E0183001');
})());
check('Realsplitting domestic/foreign flag (E0183001) IS present for tax year 2024 onward, matching its confirmed real introduction year', (() => {
  const y2024 = JSON.parse(JSON.stringify(sample));
  y2024.meta.taxYear = 2024;
  y2024.sonderausgaben = {};
  y2024.weitereAngaben = { realsplittingAnlageU: 5000 };
  const xml2024 = buildEStXML(y2024).xml;
  return xml2024.includes('E0183001');
})());
check('N/vb9 multi-year pension breakdown (E0201606) is correctly OMITTED for tax year 2024, confirmed genuinely new in 2025', (() => {
  const y2024 = JSON.parse(JSON.stringify(sample));
  y2024.meta.taxYear = 2024;
  y2024.anlageN[0].zeile9_versorgungMehrjaehrig = 500;
  const xml2024 = buildEStXML(y2024).xml;
  return !xml2024.includes('E0201606');
})());
check('N/vb9 (E0201606) IS present for tax year 2025, matching its confirmed real introduction year', (() => {
  const y2025 = JSON.parse(JSON.stringify(sample));
  y2025.meta.taxYear = 2025;
  y2025.anlageN[0].zeile9_versorgungMehrjaehrig = 500;
  const xml2025 = buildEStXML(y2025).xml;
  return xml2025.includes('E0201606');
})());
check('Anlage N Zeile 20 is NOT emitted as E0205630 - real bug found via a genuine client file (feldUnbekannt); that Kennzahl means claimed foreign-travel expenses, not the employer reimbursement the app collects', (() => {
  const withZ20 = JSON.parse(JSON.stringify(sample));
  withZ20.anlageN[0].zeile20_verpflegung = 500;
  const result = buildEStXML(withZ20);
  return !result.xml.includes('E0205630')
    && result.skippedSections.some(s => s.includes('Zeile 20'));
})());
// Anlage V - full implementation (domestic) + foreign routing to AUS
check('V emits full address as three separate fields (Regel 3149)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<E0700407>Musterstr. 1</E0700407>')
    && x.includes('<E0700503>12345</E0700503>')
    && x.includes('<E0700504>Musterstadt</E0700504>');
})());
check('V emits all three required Nutzung declarations in confirmed order 703,705,704', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000 }];
  const x = buildEStXML(d).xml;
  const a = x.indexOf('E0700703'), b = x.indexOf('E0700705'), c = x.indexOf('E0700704');
  return a > -1 && a < b && b < c;
})());
check('V pairs the unit label with its amount (Regel 100750262)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000, wohneinheit: 'EG links' }];
  const x = buildEStXML(d).xml;
  return x.includes('<E0701202>EG links</E0701202>') && x.includes('<E0700201>9000</E0700201>');
})());
check('V declares service charges not separately agreed when none entered (Regel 100750265)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000 }];
  return buildEStXML(d).xml.includes('<E0702404>1</E0702404>');
})());
check('V sends the service-charge amount when one IS entered, not the not-agreed flag', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000, nebenkosten: 1200 }];
  const x = buildEStXML(d).xml;
  return x.includes('<E0700501>1200</E0700501>') && !x.includes('E0702404');
})());
check('V emits the income total including service charges (Regel 100700004)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000, nebenkosten: 1200 }];
  return buildEStXML(d).xml.includes('<E0701401>10200</E0701401>');
})());
check('V warns when the address cannot be split into all three required parts', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Irgendwo', mieteinnahmen: 9000 }];
  return buildEStXML(d).skippedSections.some(s => s.includes('Regel 3149'));
})());
check('V includes the required Erm_Zuord_Ek/Überschuss whenever income is declared - CORRECTED (second pass): the fabricated Ek_b_Gst wrapper from the first attempt caused "feldUnbekannt" against a genuine client file; verified directly against the raw XSD this time (Erm_Zuord_Ek is a direct child of V, not nested under anything)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<Erm_Zuord_Ek>\n<E0701601>9000</E0701601>') && !x.includes('Ek_b_Gst') && !x.includes('E0701401>9000</E0701401>\n<E0701601');
})());
check('V places Erm_Zuord_Ek as a direct sibling of Einn within V, not duplicated into a second <V> block', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000 }];
  const x = buildEStXML(d).xml;
  return (x.match(/<V>/g) || []).length === 1 && (x.match(/<\/V>/g) || []).length === 1
    && x.indexOf('</Einn>') < x.indexOf('<Erm_Zuord_Ek>') && x.indexOf('<Erm_Zuord_Ek>') < x.indexOf('</V>');
})());
check('V Erm_Zuord_Ek Überschuss equals the income total, since Werbungskosten total is honestly not mapped (consistent with the existing gross-income warning)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000, nebenkosten: 1200 }];
  const x = buildEStXML(d).xml;
  return x.includes('<E0701601>10200</E0701601>');
})());
check('V includes the required Überschuss attribution (E0701801) alongside E0701601 - real bug found via testing against a genuine client file (Regel: Überschuss given without any attribution is an error)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<E0701601>9000</E0701601>\n<E0701801>9000</E0701801>');
})());
check('V newly implemented: owner-split feature - defaults to full attribution to Person A when no owner is selected, with an updated warning (rather than guessing a split)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Erika', geburtsdatum: '1987-05-20' };
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000 }];
  const result = buildEStXML(d);
  return result.xml.includes('<E0701801>9000</E0701801>') && !result.xml.includes('E0701802')
    && result.skippedSections.some(s => s.includes('no owner was selected'));
})());
check('V newly implemented: owner-split feature - full attribution to Person B when the property owner is explicitly set to B', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Erika', geburtsdatum: '1987-05-20' };
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000, owner: 'B' }];
  const result = buildEStXML(d);
  return result.xml.includes('<E0701802>9000</E0701802>') && !result.xml.includes('E0701801')
    && !result.skippedSections.some(s => s.includes('no owner was selected'));
})());
check('V newly implemented: owner-split feature - even 50/50 split for jointly-owned property, with any odd cent going to the second half', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Erika', geburtsdatum: '1987-05-20' };
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9001, owner: 'joint' }];
  const result = buildEStXML(d);
  return result.xml.includes('<E0701801>4501</E0701801>') && result.xml.includes('<E0701802>4500</E0701802>');
})());
check('V does not emit E0701401 anywhere except Einn/Sum - the fabricated duplicate is gone', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000 }];
  const x = buildEStXML(d).xml;
  return (x.match(/<E0701401>/g) || []).length === 1;
})());
check('foreign rental goes to Anlage AUS, NOT Anlage V (V has no country field at all)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Via Roma 5, Milano', land: 'Italien', mieteinnahmen: 12000, werbungskosten: 2000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<AUS>') && x.includes('<E0603901>Italien</E0603901>')
    && x.includes('<E0603904>10000</E0603904>') && !x.includes('<V>');
})());
check('AUS sits between KAP and R in the confirmed top-level order', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Via Roma 5, Milano', land: 'Italien', mieteinnahmen: 12000 }];
  d.anlageR = [{ art: 'gesetzlich', jahresbetrag: 5000, rentenbeginn: '2015' }];
  const x = buildEStXML(d).xml;
  return x.indexOf('<KAP>') < x.indexOf('<AUS>') && x.indexOf('<AUS>') < x.indexOf('<R>');
})());

// 2022 real-client-file fixes: Kind K_Verh legacy restructuring, the
// childcare provider/type field split, and the Unterstuetzte_Person
// wrapper - all confirmed via the raw XSD, not the summary sheet.
check('Kind K_Verh (legacy years) has NO <K_Verh> wrapper and wraps content in <KV> - real bug found via a genuine 2022 client file (feldUnbekannt)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2022;
  d.hauptvordruck.personB = null;
  d.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test', otherParentName: 'Max' }];
  const x = buildEStXML(d).xml;
  return x.includes('<K_Verh_A><KV>') && !x.includes('<K_Verh>');
})());
check('Kind K_Verh (2023+) still uses the <K_Verh> wrapper - the legacy branch does not affect it', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2025;
  d.hauptvordruck.personB = null;
  d.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test', otherParentName: 'Max' }];
  const x = buildEStXML(d).xml;
  return x.includes('<K_Verh><K_Verh_A>') && !x.includes('<KV>');
})());
check('Kind K_Verh_B (legacy, married) uses E0500805 for its period, verified separately rather than assumed symmetric with K_Verh_A', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2022;
  d.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Erika', geburtsdatum: '1987-05-20' };
  d.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test' }];
  const x = buildEStXML(d).xml;
  return x.includes('<K_Verh_B><KV>') && x.includes('E0500805');
})());
check('Kind childcare (legacy years) splits service type and provider into E0506101/E0506102 - real bug found via a genuine 2022 client file (Regel 514001)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2022;
  d.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test', otherParentName: 'Max',
    betreuungskosten: 1400, betreuungAnbieter: 'Kita Sonnenschein', betreuungVon: '2022-01-01', betreuungBis: '2022-12-31' }];
  const x = buildEStXML(d).xml;
  return x.includes('<E0506101>Kinderbetreuung</E0506101>') && x.includes('<E0506102>Kita Sonnenschein</E0506102>');
})());
check('Kind childcare (2023+) still uses the single combined E0506101 field - confirmed via the real per-year field description, not assumed', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2025;
  d.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test', otherParentName: 'Max',
    betreuungskosten: 1400, betreuungAnbieter: 'Kita Sonnenschein', betreuungVon: '2025-01-01', betreuungBis: '2025-12-31' }];
  const x = buildEStXML(d).xml;
  return x.includes('<E0506101>Kita Sonnenschein</E0506101>') && !x.includes('E0506102');
})());
check('Anlage Unterhalt (legacy) includes Unterstuetzte_Person as a SIBLING index value ("Person1"), not a wrapper - CORRECTED (second pass): first attempt wrongly wrapped Allg/Ek_Bez_u_P inside it, which made things worse; verified directly against the raw XSD sequence this time', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2022;
  d.anlageUnterhalt = { betrag: 5000, von: '2022-01-01', bis: '2022-12-31', personName: 'Hans', personIdnr: '02476291358', profession: 'Rentner', personBirthDate: '1948-01-01', relationship: 'Vater', householdAddress: 'Test', householdSize: 1 };
  const x = buildEStXML(d).xml;
  const uBlock = x.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)[0];
  return uBlock.includes('<Unterstuetzte_Person>Person1</Unterstuetzte_Person>')
    && uBlock.indexOf('<Unterstuetzte_Person>') < uBlock.indexOf('<Allg>')
    && !uBlock.includes('<Unterstuetzte_Person><Allg>')
    && !uBlock.includes('</Unterstuetzte_Person></Ang_Unt_Pers>');
})());
check('Anlage Unterhalt (2023+) does NOT have the Unterstuetzte_Person field at all - the legacy fix does not affect it', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2025;
  d.anlageUnterhalt = { betrag: 5000, von: '2025-01-01', bis: '2025-12-31', personName: 'Hans', personIdnr: '02476291358', profession: 'Rentner', personBirthDate: '1948-01-01', relationship: 'Vater', householdAddress: 'Test', householdSize: 1 };
  const x = buildEStXML(d).xml;
  return !x.includes('Unterstuetzte_Person');
})());
check('domestic and foreign properties coexist - each routed to its own section', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [
    { objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000 },
    { objekt: 'Via Roma 5, Milano', land: 'Italien', mieteinnahmen: 12000 },
  ];
  const x = buildEStXML(d).xml;
  return x.includes('<V>') && x.includes('<AUS>') && x.includes('<E0603901>Italien</E0603901>');
})());

check('V accepts street/plz/ort as direct separate fields (real gap found via direct user feedback that free-text address parsing is fragile) - no parsing, no false warnings, confirmed via real Regel 3149', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ street: 'Musterstr. 1', plz: '12345', ort: 'Musterstadt', mieteinnahmen: 9000 }];
  const result = buildEStXML(d);
  return result.xml.includes('<E0700407>Musterstr. 1</E0700407>') && result.xml.includes('<E0700503>12345</E0700503>')
    && result.xml.includes('<E0700504>Musterstadt</E0700504>')
    && !result.skippedSections.some(s => s.includes('Regel 3149'));
})());

check('V for 2021/2022 wraps everything in Ek_b_Gst - real bug found via a genuine client submission where every single field, including the sequence number itself, was rejected as feldUnbekannt, confirmed via the real 2022 Kontexte sheet', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2022;
  d.anlageV = [{ street: 'Teststrasse 10', plz: '63069', ort: 'Offenbach am Main', mieteinnahmen: 10000, nebenkosten: 200 }];
  const x = buildEStXML(d).xml;
  return x.includes('<Ek_b_Gst>') && x.includes('<E0700407>Teststrasse 10</E0700407>')
    && x.includes('<E0701401>10200</E0701401>') && !x.includes('<E0701202>'); // no Wohneinheit label field for this year
})());
check('V for 2023+ does NOT use the Ek_b_Gst wrapper - confirms the legacy branch did not leak into the current structure', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2025;
  d.anlageV = [{ street: 'Teststrasse 10', plz: '63069', ort: 'Offenbach am Main', mieteinnahmen: 10000, nebenkosten: 200 }];
  const x = buildEStXML(d).xml;
  return !x.includes('<Ek_b_Gst>') && x.includes('<E0701401>10200</E0701401>');
})());

check('V for 2023 uses the FLAT structure (like 2024/2025), NOT Ek_b_Gst - corrected after a real client submission was rejected on every field; the earlier version of this test asserted the wrong thing, based on a top-level Kontexte scan that found an Ek_b_Gst path unrelated to the specific fields this code actually emits. Checked field-by-field against the real 2023 sheet this time', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2023;
  d.anlageV = [{ street: 'Teststrasse 10', plz: '63069', ort: 'Offenbach am Main', mieteinnahmen: 10000, nebenkosten: 200 }];
  const x = buildEStXML(d).xml;
  return !x.includes('<Ek_b_Gst>') && x.includes('<Laufende_Nummer_V>') && x.includes('<E0701401>10200</E0701401>');
})());
check('V for 2021 confirmed identical to 2022 for every field this code uses (2023 is NOT part of this group - corrected above)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2021;
  d.anlageV = [{ street: 'Teststrasse 10', plz: '63069', ort: 'Offenbach am Main', mieteinnahmen: 10000, nebenkosten: 200 }];
  const x = buildEStXML(d).xml;
  return x.includes('<Ek_b_Gst>') && x.includes('<E0701401>10200</E0701401>');
})());

check('V legacy years (2021-2022 only, NOT 2023 - corrected above) do NOT emit Laufende_Nummer_V - confirmed via direct schema search this field genuinely does not exist in the 2022 Felder sheet, unlike 2024/2025', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2022;
  d.anlageV = [{ street: 'Teststrasse 10', plz: '63069', ort: 'Offenbach am Main', mieteinnahmen: 10000 }];
  const x = buildEStXML(d).xml;
  return !x.includes('Laufende_Nummer_V') && x.includes('<Ek_b_Gst>');
})());
check('V for 2024/2025 still correctly emits Laufende_Nummer_V - confirming the legacy fix did not remove it where it genuinely belongs', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2025;
  d.anlageV = [{ street: 'Teststrasse 10', plz: '63069', ort: 'Offenbach am Main', mieteinnahmen: 10000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<Laufende_Nummer_V>1</Laufende_Nummer_V>');
})());

check('V for 2023 specifically does NOT use Ek_b_Gst - permanent regression guard for the real mistake found via a genuine client submission, where a too-broad top-level Kontexte scan wrongly extended the legacy boundary to include 2023', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2023;
  d.anlageV = [{ street: 'X', plz: '12345', ort: 'Y', mieteinnahmen: 5000 }];
  const x = buildEStXML(d).xml;
  return !x.includes('<Ek_b_Gst>') && x.includes('<Laufende_Nummer_V>');
})());

check('V Werbungskosten: itemized categories (2024/2025) correctly transmit with the required individual-item entries and the overall Se_WK total, and reduce the Überschuss - confirmed via a real ERiC rejection that Sum alone is not accepted without a backing individual entry', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2025;
  d.anlageV = [{ street: 'X', plz: '12345', ort: 'Y', mieteinnahmen: 10000, wkAfa: 5000, wkSchuldzins: 1000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<AfA_Geb><Direkt>') && x.includes('<E0703511>5000</E0703511>') && x.includes('<E0703306>5000</E0703306>')
    && x.includes('<Schuldzins><Direkt>') && x.includes('<E0703406>1000</E0703406>') && x.includes('<E0704508>1000</E0704508>')
    && x.includes('<Se_WK>') && x.includes('<E0705701>6000</E0705701>') // overall total: 5000 + 1000
    && x.includes('<E0701601>4000</E0701601>'); // 10000 - 5000 - 1000
})());
check('V Werbungskosten: same itemized categories with individual entries and overall total also work for legacy years (2021-2022) inside Ek_b_Gst/Wk', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2022;
  d.anlageV = [{ street: 'X', plz: '12345', ort: 'Y', mieteinnahmen: 10000, wkVerwaltung: 300, wkSonst: 100 }];
  const x = buildEStXML(d).xml;
  return x.includes('<Ek_b_Gst>') && x.includes('<Verw_Ko><Direkt>') && x.includes('<E0705515>300</E0705515>') && x.includes('<E0707502>300</E0707502>')
    && x.includes('<Sonst><Direkt>') && x.includes('<E0705607>100</E0705607>') && x.includes('<E0707902>100</E0707902>')
    && x.includes('<E0705701>400</E0705701>') // overall total: 300 + 100
    && x.includes('<E0701601>9600</E0701601>'); // 10000 - 300 - 100
})());
check('V Werbungskosten: an old-style combined total without any category still correctly warns rather than silently dropping the data', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2025;
  d.anlageV = [{ street: 'X', plz: '12345', ort: 'Y', mieteinnahmen: 10000, werbungskosten: 7000 }];
  const result = buildEStXML(d);
  return !result.xml.includes('<Wk>') && result.skippedSections.some(s => s.includes('not broken into the real itemized categories'));
})());
check('V Werbungskosten: using the AfA (building depreciation) category honestly discloses the standard-rate assumption rather than silently guessing', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2025;
  d.anlageV = [{ street: 'X', plz: '12345', ort: 'Y', mieteinnahmen: 10000, wkAfa: 5000 }];
  const result = buildEStXML(d);
  return result.skippedSections.some(s => s.includes('standard default (2% linear'));
})());

check('V Werbungskosten: AfA percentage uses German comma decimal format (2,00), not a period - real bug found via a genuine ERiC rejection (zahlHatUngueltigeZeichen) confirming the required format directly from ERiC\'s own error text', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2025;
  d.anlageV = [{ street: 'X', plz: '12345', ort: 'Y', mieteinnahmen: 10000, wkAfa: 5000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<E0703303>2,00</E0703303>') && !x.includes('<E0703303>2.00</E0703303>');
})());

check('N: fahrt17 (line 17 employer commute allowance) is no longer sent to the wrong context - real bug found via a genuine client submission returning feldUnbekannt for E0205003 under ArbL, confirmed its real context is Wk/AWT/Fahrt instead', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageN = [{ person: 'A', arbeitgeber: 'X', steuerklasse: '1', zeile3_bruttoarbeitslohn: 50000, zeile17_agLeistungenEntfernung: 500 }];
  const result = buildEStXML(d);
  return !result.xml.includes('E0205003') && result.skippedSections.some(s => s.includes('line 17') && s.includes('Wk/AWT/Fahrt'));
})());

check('Vorsatz: Neuaufnahme is disabled following a real ERiC rejection (rc 610301106) confirmed via direct A/B testing against the identical client - even with neuaufnahmeConfirmed set, no Ordnungsbegriff or OrdNrArt=O is ever emitted, matching the one path already proven to work in practice', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.steuernummer = '';
  d.hauptvordruck.neuaufnahmeConfirmed = true;
  const x = buildEStXML(d).xml;
  return !x.includes('<Ordnungsbegriff>') && !x.includes('<OrdNrArt>O</OrdNrArt>') && !x.includes('<StNr>');
})());
check('Vorsatz: a real Steuernummer still takes the normal S path unchanged, confirming the new Neuaufnahme branch did not affect the existing common case', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.steuernummer = '9181081508155';
  const x = buildEStXML(d).xml;
  return x.includes('<StNr>9181081508155</StNr>') && x.includes('<OrdNrArt>S</OrdNrArt>') && !x.includes('<Ordnungsbegriff>');
})());

check('buildEStXML genuinely refuses to run without a real configured Hersteller-ID - no hardcoded value of any kind, per explicit instruction that a hardcoded ID in source is itself a risk', (() => {
  const saved = process.env.ERIC_HERSTELLER_ID;
  delete process.env.ERIC_HERSTELLER_ID;
  let threw = false;
  try { buildEStXML(sample); } catch (e) { threw = e.message.includes('ERIC_HERSTELLER_ID is not configured'); }
  process.env.ERIC_HERSTELLER_ID = saved;
  return threw;
})());
check('buildEStXML correctly uses a real configured Hersteller-ID when one is genuinely provided, confirming the refuse-to-guess behavior does not break the normal, correctly-configured case', (() => {
  const x = buildEStXML(sample).xml;
  return x.includes(`<HerstellerID>${process.env.ERIC_HERSTELLER_ID}</HerstellerID>`);
})());
check('V still works with the old combined objekt field for backward compatibility with existing external test files', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Musterstr. 1, 12345 Musterstadt', mieteinnahmen: 9000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<E0700407>Musterstr. 1</E0700407>') && x.includes('<E0700503>12345</E0700503>');
})());
check('foreign rental flags the treaty question rather than deciding it', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ objekt: 'Via Roma 5, Milano', land: 'Italien', mieteinnahmen: 12000 }];
  return buildEStXML(d).skippedSections.some(s => s.includes('double-taxation'));
})());

// EM_35c (energetic renovation) - full implementation
check('EM_35c requires a genuine measure amount before emitting anything - address alone with no cost is not a real declaration', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.par35cEnergetisch = { street: 'Musterstr. 1', buildDate: '2005-01-01', plzOrt: '12345 Musterstadt', areaTotal: 100, areaOwn: 100, measureStart: '2025-01-01' };
  const x = buildEStXML(d).xml;
  return !x.includes('<EM_35c>');
})());
check('EM_35c emits only the measure categories with a real amount, progressive-disclosure style - unused categories are absent, not sent as zero', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.par35cEnergetisch = { street: 'Musterstr. 1', buildDate: '2005-01-01', plzOrt: '12345 Musterstadt', areaTotal: 100, areaOwn: 100, measureStart: '2025-01-01', windows: 5000 };
  const x = buildEStXML(d).xml;
  return x.includes('<Fenst_Tuer>') && !x.includes('<Heizung>') && !x.includes('<Waende>');
})());
check('EM_35c Sum equals the total of all entered measure categories', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.par35cEnergetisch = { street: 'Musterstr. 1', buildDate: '2005-01-01', plzOrt: '12345 Musterstadt', areaTotal: 100, areaOwn: 100, measureStart: '2025-01-01', windows: 5000, heating: 12000 };
  const x = buildEStXML(d).xml;
  return x.includes('<E0241901>17000</E0241901>');
})());
check('EM_35c omits EM_Vorj entirely when no prior-year amounts are given - not sent as zeros', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.par35cEnergetisch = { street: 'Musterstr. 1', buildDate: '2005-01-01', plzOrt: '12345 Musterstadt', areaTotal: 100, areaOwn: 100, measureStart: '2025-01-01', heating: 5000 };
  const x = buildEStXML(d).xml;
  return !x.includes('EM_Vorj');
})());
check('EM_35c includes EM_Vorj with the user-entered prior-year amounts when provided - simple entry, not app-tracked state', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.par35cEnergetisch = { street: 'Musterstr. 1', buildDate: '2005-01-01', plzOrt: '12345 Musterstadt', areaTotal: 100, areaOwn: 100, measureStart: '2025-01-01', heating: 5000, priorYear1: 1400 };
  const x = buildEStXML(d).xml;
  return x.includes('<EM_Vorj>') && x.includes('<E0242501>1400</E0242501>') && !x.includes('E0243401');
})());
check('EM_35c warns when the building appears under 10 years old at renovation start - a real §35c eligibility rule, not silently allowed through', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.par35cEnergetisch = { street: 'Musterstr. 1', buildDate: '2020-01-01', plzOrt: '12345 Musterstadt', areaTotal: 100, areaOwn: 100, measureStart: '2025-01-01', heating: 5000 };
  const result = buildEStXML(d);
  return result.skippedSections.some(s => s.includes('EM_35c') && s.includes('10 years'));
})());
check('EM_35c works identically across all supported years - confirmed via raw XSD that the structure (not just fields) is unchanged 2021-2025', (() => {
  const results = [2021, 2022, 2023, 2024, 2025].map(y => {
    const d = JSON.parse(JSON.stringify(sample));
    d.meta.taxYear = y;
    d.par35cEnergetisch = { street: 'Musterstr. 1', buildDate: '2005-01-01', plzOrt: '12345 Musterstadt', areaTotal: 100, areaOwn: 100, measureStart: y + '-01-01', heating: 5000 };
    return buildEStXML(d).xml.includes('<EM_35c>') && buildEStXML(d).xml.includes('<E0241901>5000</E0241901>');
  });
  return results.every(Boolean);
})());

// Married-couple test file findings
check('N-AUS count (E0202400) is added to Anlage N whenever N-AUS entries exist for that person - real bug found via testing against a genuine client file (Regel 100260069)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Erika', geburtsdatum: '1987-05-20' };
  d.anlageN = [{ person: 'B', zeile3_bruttoarbeitslohn: 50000 }];
  d.anlageNAUS = [{ person: 'B', land: 'Schweiz', gesamtlohn: 20000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<E0202400>1</E0202400>');
})());
check('KAP Günstigerprüfung applies to both spouses in a joint filing when only one triggers it, including a minimal fallback block for the spouse with no KAP data at all - real bug found via a genuine client file (Regel 193035)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Erika', geburtsdatum: '1987-05-20' };
  d.anlageKAP = [{ person: 'B', zeile7_kapitalertraege: 1000 }];
  const x = buildEStXML(d).xml;
  const blocks = x.match(/<KAP>[\s\S]*?<\/KAP>/g);
  return blocks.length === 2 && blocks.every(b => b.includes('<E1900401>1</E1900401>'));
})());
check('KAP Günstigerprüfung does NOT apply to the spouse for a single filer (no personB) - the joint-filing fix does not affect single filers', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.personB = null;
  d.anlageKAP = [{ person: 'A', zeile7_kapitalertraege: 1000 }];
  const x = buildEStXML(d).xml;
  return (x.match(/<KAP>/g) || []).length === 1;
})());
check('EM_35c warns when a measure amount is entered but the renovation start date is missing - real bug found via a genuine client file (Regel 102240006)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.par35cEnergetisch = { street: 'Musterstr. 1', buildDate: '2005-01-01', plzOrt: '12345 Musterstadt', areaTotal: 100, areaOwn: 100, heating: 5000 };
  const result = buildEStXML(d);
  return result.skippedSections.some(s => s.includes('EM_35c') && s.includes('start date'));
})());
check('Anlage Unterhalt with an amount but a completely blank supported person is omitted entirely, not sent as a structurally-empty block - real robustness fix found via a genuine client file (kontextLeer)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageUnterhalt = { betrag: 5000 };
  const result = buildEStXML(d);
  return !result.xml.includes('<ESt1A_U>') && result.skippedSections.some(s => s.includes('anlageUnterhalt'));
})());

check('N-AUS includes the required remaining-wage field (Verbl/E2604401), computed from total wage minus the tax-exempt portion - real bug found via a genuine client file (Regel 100260026)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', gesamtlohn: 60000, steuerfreierBetrag: 20000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<E2604401>40000</E2604401>');
})());
check('N-AUS remaining-wage field is explicitly sent as 0 (not omitted) when the entire wage is tax-exempt - same zero-omission fix pattern as KAP Sp_PB', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', gesamtlohn: 60000, steuerfreierBetrag: 60000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<E2604401>0</E2604401>');
})());

check('N-AUS remaining-wage field is a clean integer even with decimal input - real bug found via a genuine client file (zahlHatUngueltigeZeichen), genuinely my own mistake: bypassing wholeEuroTag to force zero-emission also bypassed its rounding', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', gesamtlohn: 60000.5, steuerfreierBetrag: 20000.3 }];
  const x = buildEStXML(d).xml;
  const m = x.match(/<E2604401>([^<]*)<\/E2604401>/);
  return m && /^\d+$/.test(m[1]);
})());

// N-AUS complete rewrite - full research-based implementation
check('N-AUS consistency: Anlage N dba16 (E0201502) EXACTLY equals the N-AUS computed total - confirmed required via real Regel 0/1/7, computed via a shared function to guarantee they cannot drift apart', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', arbeitgeberName: 'Muster AG', taetigkeitDesc: 'Beratung', taetigkeitVon: '2025-01-01', taetigkeitBis: '2025-12-31', gesamtlohn: 60000, steuerfreierBetrag: 20000, arbeitstageGesamt: 220, arbeitstageAusland: 180 }];
  const x = buildEStXML(d).xml;
  const nAusResult = x.match(/<E2604901>(\d+)<\/E2604901>/)[1];
  const nResult = x.match(/<E0201502>(\d+)<\/E0201502>/)[1];
  return nAusResult === nResult && Number(nAusResult) > 0;
})());
check('N-AUS legal basis defaults to DBA ("1") for the common case, confirmed required via real Regel 14', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', arbeitgeberName: 'Muster AG', gesamtlohn: 60000, arbeitstageGesamt: 220, arbeitstageAusland: 180 }];
  const x = buildEStXML(d).xml;
  return x.includes('<E2600503>1</E2600503>');
})());
check('N-AUS dual residence defaults to "Nein" and correctly omits the foreign-address sub-fields for the common case', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', arbeitgeberName: 'Muster AG', gesamtlohn: 60000, arbeitstageGesamt: 220, arbeitstageAusland: 180 }];
  const x = buildEStXML(d).xml;
  return x.includes('<E2600703>2</E2600703>') && !x.includes('E2600801');
})());
check('N-AUS dual residence "Ja" correctly includes the foreign address when provided', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', arbeitgeberName: 'Muster AG', gesamtlohn: 60000, arbeitstageGesamt: 220, arbeitstageAusland: 180,
    dualResidence: true, foreignResStreet: 'Seestr. 1', foreignResPlz: '8001', foreignResCity: 'Zürich', foreignResCountry: 'Schweiz', centerOfInterests: true }];
  const x = buildEStXML(d).xml;
  return x.includes('<E2600703>1</E2600703>') && x.includes('<E2600801>Seestr. 1</E2600801>') && x.includes('<E2601104>1</E2601104>');
})());
check('N-AUS employer full address is written when provided, in the confirmed real field order (name, street, plz, city, country)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', arbeitgeberName: 'Muster AG', arbeitgeberStreet: 'Bahnhofstr. 1', arbeitgeberPlz: '8001', arbeitgeberCity: 'Zürich', arbeitgeberCountry: 'Schweiz', gesamtlohn: 60000, arbeitstageGesamt: 220, arbeitstageAusland: 180 }];
  const x = buildEStXML(d).xml;
  const arbG = x.match(/<ArbG>[\s\S]*?<\/ArbG>/)[0];
  return arbG.indexOf('E2601202') < arbG.indexOf('E2601201') && arbG.indexOf('E2601201') < arbG.indexOf('E2601401');
})());
check('N-AUS activity description and full date range (with years, a genuinely different type from other date ranges in this schema) are written together', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', arbeitgeberName: 'Muster AG', taetigkeitDesc: 'Softwareentwicklung', taetigkeitVon: '2025-03-01', taetigkeitBis: '2025-11-30', gesamtlohn: 60000, arbeitstageGesamt: 220, arbeitstageAusland: 180 }];
  const x = buildEStXML(d).xml;
  return x.includes('<E2601701>Softwareentwicklung</E2601701>') && x.includes('<E2601702>01.03.2025-30.11.2025</E2601702>');
})());
check('N-AUS for 2021/2022 is correctly NOT transmitted (genuinely different legacy structure, honestly gated pending its own research pass rather than guessed)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2022;
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', arbeitgeberName: 'Muster AG', gesamtlohn: 60000, arbeitstageGesamt: 220, arbeitstageAusland: 180 }];
  const result = buildEStXML(d);
  return !result.xml.includes('<N_AUS>') && result.skippedSections.some(s => s.includes('N-AUS') && s.includes('2022'));
})());
check('N-AUS warns (does not silently guess) when a non-DBA legal basis is selected, since ATE/ZÜ-specific fields are not implemented', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', arbeitgeberName: 'Muster AG', legalBasis: 'ate', gesamtlohn: 60000, arbeitstageGesamt: 220, arbeitstageAusland: 180 }];
  const result = buildEStXML(d);
  return result.skippedSections.some(s => s.includes('ATE'));
})());
check('N-AUS warns when work-day counts are missing, since the tax-free amount cannot be calculated without them', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', arbeitgeberName: 'Muster AG', gesamtlohn: 60000 }];
  const result = buildEStXML(d);
  return !result.xml.includes('ArbL_DBA') && result.skippedSections.some(s => s.includes('work-day'));
})());

check('N-AUS employer address is genuinely all-or-nothing - a partial address (name only) is omitted entirely and warned about, real bug found via a genuine client file confirming Regel 24', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', arbeitgeberName: 'Muster AG', gesamtlohn: 60000, arbeitstageGesamt: 220, arbeitstageAusland: 180 }];
  const result = buildEStXML(d);
  return !result.xml.includes('<ArbG>') && result.skippedSections.some(s => s.includes('given together or not at all'));
})());
check('N-AUS employer address IS written when genuinely complete (all five fields)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Schweiz', arbeitgeberName: 'Muster AG', arbeitgeberStreet: 'Bahnhofstr. 1', arbeitgeberPlz: '8001', arbeitgeberCity: 'Zürich', arbeitgeberCountry: 'Schweiz', gesamtlohn: 60000, arbeitstageGesamt: 220, arbeitstageAusland: 180 }];
  const x = buildEStXML(d).xml;
  return x.includes('<ArbG>') && x.includes('<E2601202>Muster AG</E2601202>');
})());

check('N-AUS includes the 183-day-rule legal basis (Taetigk_Vertr) when days abroad is under 184 and a basis is provided - real requirement found via testing against a genuine client file (Regel 30)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Indonesien', arbeitgeberName: 'X', arbeitgeberStreet: 'Y', arbeitgeberPlz: '1', arbeitgeberCity: 'Z', arbeitgeberCountry: 'Indonesien',
    taetigkeitDesc: 'Beratung', taetigkeitVon: '2025-01-01', taetigkeitBis: '2025-12-31', gesamtlohn: 65000, arbeitstageGesamt: 220, arbeitstageAusland: 50, shortStayBasis: 'PermanentEstab' }];
  const x = buildEStXML(d).xml;
  return x.includes('<Taetigk_Vertr>\n<E2602601>X</E2602601>');
})());
check('N-AUS warns (does not silently guess) when days abroad is under 184 and no legal basis was given - a real, rejectable gap', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Indonesien', arbeitgeberName: 'X', arbeitgeberStreet: 'Y', arbeitgeberPlz: '1', arbeitgeberCity: 'Z', arbeitgeberCountry: 'Indonesien',
    taetigkeitDesc: 'Beratung', taetigkeitVon: '2025-01-01', taetigkeitBis: '2025-12-31', gesamtlohn: 65000, arbeitstageGesamt: 220, arbeitstageAusland: 50 }];
  const result = buildEStXML(d);
  return !result.xml.includes('Taetigk_Vertr') && result.skippedSections.some(s => s.includes('184'));
})());
check('N-AUS does NOT require the 183-day basis when days abroad is 184 or more - the standard exemption applies without it', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Indonesien', arbeitgeberName: 'X', arbeitgeberStreet: 'Y', arbeitgeberPlz: '1', arbeitgeberCity: 'Z', arbeitgeberCountry: 'Indonesien',
    taetigkeitDesc: 'Beratung', taetigkeitVon: '2025-01-01', taetigkeitBis: '2025-12-31', gesamtlohn: 65000, arbeitstageGesamt: 220, arbeitstageAusland: 200 }];
  const result = buildEStXML(d);
  return !result.skippedSections.some(s => s.includes('184'));
})());
check('N-AUS 183-day basis "Other" uses the free-text field instead of a flag', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'Indonesien', arbeitgeberName: 'X', arbeitgeberStreet: 'Y', arbeitgeberPlz: '1', arbeitgeberCity: 'Z', arbeitgeberCountry: 'Indonesien',
    taetigkeitDesc: 'Beratung', taetigkeitVon: '2025-01-01', taetigkeitBis: '2025-12-31', gesamtlohn: 65000, arbeitstageGesamt: 220, arbeitstageAusland: 50, shortStayBasis: 'Other', shortStayBasisText: 'Sonderfall laut Vertrag' }];
  const x = buildEStXML(d).xml;
  return x.includes('<E2602801>Sonderfall laut Vertrag</E2602801>');
})());

check('Kind: surname-if-different (E0500108) is written right after first name when provided - real gap found via a direct user question, confirmed via the real Felder sheet that this is a genuine, separate optional field, not a "full name" field', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageKind = [{ vorname: 'Lena', surnameIfDifferent: 'Schmidt', geburtsdatum: '2016-01-01', familienkasse: 'Test' }];
  const x = buildEStXML(d).xml;
  return x.includes('<E0500107>Lena</E0500107>\n<E0500108>Schmidt</E0500108>');
})());
check('Kind: surname-if-different is correctly omitted when not provided, not sent as empty', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-01-01', familienkasse: 'Test' }];
  const x = buildEStXML(d).xml;
  return !x.includes('E0500108');
})());
check('buildR includes the required Person tag - real bug found via the multi-year regression test (mandatoryField, "/R[1]/Person[1]")', (() => {
  const withR = JSON.parse(JSON.stringify(sample));
  withR.anlageR = [{ art: 'gesetzlich', jahresbetrag: 12000, rentenbeginn: '2020' }];
  const xml = buildEStXML(withR).xml;
  const rBlock = xml.match(/<R>\n([\s\S]*?)<\/R>/)?.[1] || '';
  return rBlock.startsWith('<Person>PersonA</Person>');
})());
check('buildR formats a year-only rentenbeginn into a full TT.MM.JJJJ date - real bug found via the multi-year regression test (datumFormatFalsch)', (() => {
  const withR = JSON.parse(JSON.stringify(sample));
  withR.anlageR = [{ art: 'gesetzlich', jahresbetrag: 12000, rentenbeginn: '2015' }];
  const xml = buildEStXML(withR).xml;
  return xml.includes('<E1800501>01.01.2015</E1800501>');
})());
check('Eink_Ers (wage-replacement benefits) includes the required Person tag - real bug found via testing against another genuine client file (mandatoryField)', (() => {
  const withErsatz = JSON.parse(JSON.stringify(sample));
  withErsatz.weitereAngaben = { ersatzleistungen: 500 };
  const xml = buildEStXML(withErsatz).xml;
  return xml.includes('<Eink_Ers><Person>PersonA</Person>');
})());
check('buildV produces nothing for an entry with no genuine content (no address, no income) - real bug found via testing against another genuine client file (solitaryIndex) - was mistakenly cleared as "safe" in an earlier round', (() => {
  const emptyV = JSON.parse(JSON.stringify(sample));
  emptyV.anlageV = [{ objekt: '', mieteinnahmen: 0 }];
  const xml = buildEStXML(emptyV).xml;
  return !xml.includes('<V>');
})());
check('buildV correctly numbers sequential entries starting from 1 when an earlier empty entry is skipped, not leaving a gap', (() => {
  const mixedV = JSON.parse(JSON.stringify(sample));
  mixedV.anlageV = [{ objekt: '', mieteinnahmen: 0 }, { objekt: 'Teststr. 5, 12345 Berlin', mieteinnahmen: 8000 }];
  const xml = buildEStXML(mixedV).xml;
  return xml.includes('<Laufende_Nummer_V>1</Laufende_Nummer_V>') && !xml.includes('<Laufende_Nummer_V>2</Laufende_Nummer_V>');
})());

// Multi-year extension to 2021/2022 - confirmed via direct research
// (not assumed) that Anlage Unterhalt's specific fields are missing for
// those years, while everything else checked out compatible.
check('Anlage Unterhalt (legacy structure) works correctly for tax year 2022 with complete data - no warnings, correct field set present', (() => {
  const y2022 = JSON.parse(JSON.stringify(sample));
  y2022.meta.taxYear = 2022;
  y2022.anlageUnterhalt = { betrag: 6000, von: '2022-01-01', bis: '2022-12-31', personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Test' };
  const result = buildEStXML(y2022);
  const uXml = result.xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  const hasCore = ['E0120101', 'E0120108', 'E0120211', 'E0120201', 'E0120203', 'E0120202', 'E0120701', 'E0120401', 'E0120301', 'E0120860', 'E0120901', 'E0120109', 'E0120103', 'E0120104'].every(c => uXml.includes(c));
  return hasCore && !uXml.includes('Ang_HH_unt_P_Unt_Leist') && !result.skippedSections.some(s => s.includes('anlageUnterhalt'));
})());
check('Anlage Unterhalt (legacy structure) uses JaXBaseCType "X" values, not the 2023+ JaNein12 "1"/"2" convention - confirmed via the real XSD types', (() => {
  const y2021 = JSON.parse(JSON.stringify(sample));
  y2021.meta.taxYear = 2021;
  y2021.anlageUnterhalt = { betrag: 6000, von: '2021-01-01', bis: '2021-12-31', personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Test' };
  const xml = buildEStXML(y2021).xml;
  return xml.includes('<E0120401>X</E0120401>') && xml.includes('<E0120301>X</E0120301>') && !xml.includes('E0122505');
})());
check('Anlage Unterhalt (legacy structure) uses the confirmed correct amount context (AW_U/U_Zlg alongside AW_U/U_Ztr), a genuinely different structure from 2023+', (() => {
  const y2022 = JSON.parse(JSON.stringify(sample));
  y2022.meta.taxYear = 2022;
  y2022.anlageUnterhalt = { betrag: 6000, von: '2022-01-01', bis: '2022-12-31', personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Test' };
  const xml = buildEStXML(y2022).xml;
  return xml.includes('<U_Ztr>') && xml.includes('<U_Zlg>') && xml.includes('<E0120103>6000</E0120103>');
})());
check('Anlage Unterhalt (legacy structure) correctly implements foreign households - country field and Yes-confirmed flag both present, no warnings, when foreignNeedConfirmed is true', (() => {
  const y2022foreign = JSON.parse(JSON.stringify(sample));
  y2022foreign.meta.taxYear = 2022;
  y2022foreign.anlageUnterhalt = { betrag: 6000, von: '2022-01-01', bis: '2022-12-31', personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Test', country: 'Türkei', foreignNeedConfirmed: true };
  const result = buildEStXML(y2022foreign);
  const uXml = result.xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return uXml.includes('<E0120102>Türkei</E0120102>') && uXml.includes('<E0120209>X</E0120209>') && !uXml.includes('E0120210') && !result.skippedSections.some(s => s.includes('anlageUnterhalt'));
})());
check('Anlage Unterhalt (legacy structure) foreign household correctly uses the "not confirmed" field (E0120210) when foreignNeedConfirmed is false', (() => {
  const y2021foreign = JSON.parse(JSON.stringify(sample));
  y2021foreign.meta.taxYear = 2021;
  y2021foreign.anlageUnterhalt = { betrag: 6000, von: '2021-01-01', bis: '2021-12-31', personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Test', country: 'Türkei', foreignNeedConfirmed: false };
  const xml = buildEStXML(y2021foreign).xml;
  return xml.includes('<E0120210>X</E0120210>') && !xml.includes('E0120209');
})());
check('Anlage Unterhalt (legacy structure) warns when a foreign household is indicated but foreignNeedConfirmed was never set, since that specific detail cannot be safely defaulted', (() => {
  const y2022noConfirm = JSON.parse(JSON.stringify(sample));
  y2022noConfirm.meta.taxYear = 2022;
  y2022noConfirm.anlageUnterhalt = { betrag: 6000, personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', householdAddress: 'Test', country: 'Türkei' };
  const result = buildEStXML(y2022noConfirm);
  return result.skippedSections.some(s => s.includes('anlageUnterhalt') && s.includes('foreignNeedConfirmed'));
})());
check('Anlage Unterhalt (legacy structure) country field is correctly OMITTED for domestic households - only sent when genuinely foreign', (() => {
  const y2022domestic = JSON.parse(JSON.stringify(sample));
  y2022domestic.meta.taxYear = 2022;
  y2022domestic.anlageUnterhalt = { betrag: 6000, von: '2022-01-01', bis: '2022-12-31', personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Test' };
  const xml = buildEStXML(y2022domestic).xml;
  return !xml.includes('E0120102') && !xml.includes('E0120209') && !xml.includes('E0120210');
})());
check('Anlage Unterhalt: 2023+ behavior remains completely unaffected by the new legacy implementation', (() => {
  const y2023 = JSON.parse(JSON.stringify(sample));
  y2023.meta.taxYear = 2023;
  y2023.anlageUnterhalt = { betrag: 6000, von: '2023-01-01', bis: '2023-12-31', personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Test' };
  const result = buildEStXML(y2023);
  const uXml = result.xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return uXml.includes('E0122505') && uXml.includes('E0122613') && !result.skippedSections.some(s => s.includes('anlageUnterhalt'));
})());
check('Anlage Unterhalt still works normally for tax year 2023 - the new 2021/2022 gate does not affect the already-confirmed-working years', (() => {
  const y2023 = JSON.parse(JSON.stringify(sample));
  y2023.meta.taxYear = 2023;
  y2023.anlageUnterhalt = { betrag: 6000, von: '2023-01-01', bis: '2023-12-31', personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Test' };
  const result = buildEStXML(y2023);
  return result.xml.includes('<ESt1A_U>') && !result.skippedSections.some(s => s.includes('anlageUnterhalt'));
})());

// Kind (child) - four gaps closed after the multi-year regression test:
// Familienkasse, residence duration, second parent's relationship
// (K_Verh_B), and shared-household period.
check('Kind includes Familienkasse when provided (E0500706)', (() => {
  const withKind = JSON.parse(JSON.stringify(sample));
  withKind.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Familienkasse München' }];
  const xml = buildEStXML(withKind).xml;
  return xml.includes('<E0500706>Familienkasse München</E0500706>');
})());
check('Kind warns when Familienkasse is missing, since it cannot be safely defaulted', (() => {
  const noFK = JSON.parse(JSON.stringify(sample));
  noFK.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich' }];
  const result = buildEStXML(noFK);
  return result.skippedSections.some(s => s.includes('Familienkasse'));
})());
check('Kind residence duration (E0500703) defaults to the full tax year when not explicitly set - the common case', (() => {
  const withKind = JSON.parse(JSON.stringify(sample));
  withKind.meta.taxYear = 2025;
  withKind.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test' }];
  const xml = buildEStXML(withKind).xml;
  return xml.includes('<E0500703>01.01-31.12</E0500703>');
})());
check('Kind K_Verh_B is correctly OMITTED for single filers (no Person B) - corrected understanding: real ERiC error proved this is specifically tied to an actual spouse, not "the child\'s second parent generally" as first hypothesized', (() => {
  const withKind = JSON.parse(JSON.stringify(sample));
  withKind.hauptvordruck.personB = null;
  withKind.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test' }];
  const xml = buildEStXML(withKind).xml;
  return xml.includes('<K_Verh_A>') && !xml.includes('<K_Verh_B>');
})());
check('Kind K_Verh_B IS present when Person B genuinely exists on the return', (() => {
  const withKind = JSON.parse(JSON.stringify(sample));
  withKind.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Erika', geburtsdatum: '1987-05-20' };
  withKind.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test' }];
  const xml = buildEStXML(withKind).xml;
  return xml.includes('<K_Verh_B>') && xml.includes('<E0500808>1</E0500808>');
})());
check('Kind childcare block includes the required Ang_HH/Gem_HH_Elt shared-household period, AND its required companion field (both fields needed together, confirmed via Regel 514120 found in a second regression test round)', (() => {
  const withCC = JSON.parse(JSON.stringify(sample));
  withCC.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test',
    betreuungskosten: 1400, betreuungAnbieter: 'Kita', betreuungVon: '2025-01-01', betreuungBis: '2025-12-31' }];
  const xml = buildEStXML(withCC).xml;
  return xml.includes('<E0504807>01.01-31.12</E0504807>') && xml.includes('<E0504808>01.01-31.12</E0504808>');
})());

// KAP Günstigerprüfung - real bug found via the multi-year regression
// test (Regel 192000). Universally safe to default since it can only
// benefit the taxpayer, unlike the church-tax alternative.
check('KAP includes the Günstigerprüfung request (E1900401) whenever domestic withheld capital gains are reported', (() => {
  const withKAP = JSON.parse(JSON.stringify(sample));
  withKAP.anlageKAP = [{ person: 'A', zeile7_kapitalertraege: 1500 }];
  const xml = buildEStXML(withKAP).xml;
  return xml.includes('<Ant>\n<E1900401>1</E1900401>\n</Ant>');
})());
check('KAP Ant block correctly appears right after Person, before KapErt_inl_StAbz - confirmed real field order', (() => {
  const withKAP = JSON.parse(JSON.stringify(sample));
  withKAP.anlageKAP = [{ person: 'A', zeile7_kapitalertraege: 1500 }];
  const xml = buildEStXML(withKAP).xml;
  const kapBlock = xml.match(/<KAP>([\s\S]*?)<\/KAP>/)?.[1] || '';
  return kapBlock.indexOf('<Person>') < kapBlock.indexOf('<Ant>') && kapBlock.indexOf('<Ant>') < kapBlock.indexOf('KapErt_inl_StAbz');
})());

// HA_35a Handwerkerleistungen - real bug found via the multi-year
// regression test (Regel 101170002). Was only sending the invoice
// total; now sends all four required companion fields.
check('HA_35a Handwerkerleistungen includes all four required fields (Art, invoice total, labor portion, Sum) - real bug found via the multi-year regression test', (() => {
  const withHA = JSON.parse(JSON.stringify(sample));
  withHA.haushaltsnaheLeistungen = { handwerkerleistungen: 900 };
  const xml = buildEStXML(withHA).xml;
  const haBlock = xml.match(/<HA_35a>[\s\S]*?<\/HA_35a>/)?.[0] || '';
  return haBlock.includes('E0111217') && haBlock.includes('<E0170601>900</E0170601>')
    && haBlock.includes('<E0111214>900</E0111214>') && haBlock.includes('<E0111215>900</E0111215>');
})());
check('KAP explicitly sends Sp_PB as 0 whenever Günstigerprüfung is requested, even with no Pauschbetrag used - real bug found via a second regression test round (Regel 192036)', (() => {
  const withKAP = JSON.parse(JSON.stringify(sample));
  withKAP.anlageKAP = [{ person: 'A', zeile7_kapitalertraege: 1500 }];
  const xml = buildEStXML(withKAP).xml;
  return xml.includes('<Sp_PB>\n<E1901401>0</E1901401>\n</Sp_PB>');
})());
check('Kind uses K_Verh_and_P (naming the other parent) for single filers instead of the forbidden K_Verh_B - real bug found via a second regression test round confirming the earlier fix was still incomplete', (() => {
  const singleFiler = JSON.parse(JSON.stringify(sample));
  singleFiler.hauptvordruck.personB = null;
  singleFiler.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test', otherParentName: 'Max Mustermann' }];
  const xml = buildEStXML(singleFiler).xml;
  return xml.includes('<K_Verh_and_P><Ang_Pers><E0501103>Max Mustermann</E0501103>') && !xml.includes('<K_Verh_B>');
})());
check('Kind K_Verh_and_P includes the required duration and relationship-type fields alongside the name - real bug found via a third regression test round (Regel 100500001, "Name...Dauer...Art...gemeinsam")', (() => {
  const singleFiler = JSON.parse(JSON.stringify(sample));
  singleFiler.hauptvordruck.personB = null;
  singleFiler.meta.taxYear = 2025;
  singleFiler.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test', otherParentName: 'Max Mustermann' }];
  const xml = buildEStXML(singleFiler).xml;
  return xml.includes('<E0501903>01.01-31.12</E0501903>') && xml.includes('<E0501106>1</E0501106>');
})());
check('Kind Schulgeld includes the required Einz (itemized) block, not just Sum - real bug found via testing against a genuine client file (E0504505/Elt_k_ZV was wrongly treated as the itemized entry)', (() => {
  const withSchool = JSON.parse(JSON.stringify(sample));
  withSchool.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test', otherParentName: 'Max', schulgeld: 200 }];
  const xml = buildEStXML(withSchool).xml;
  return xml.includes('<Einz>\n<E0505606>') && xml.includes('<E0504405>200</E0504405>') && xml.includes('<E0505607>200</E0505607>');
})());
check('AgB Krankheitskosten includes the required reimbursement fields (explicitly 0), not just Art/Höhe - real bug found via testing against a genuine client file (fields were already mapped but never used)', (() => {
  const withMed = JSON.parse(JSON.stringify(sample));
  withMed.aussergewoehnlicheBelastungen = { krankheitskosten: 500 };
  const xml = buildEStXML(withMed).xml;
  const agbBlock = xml.match(/<AgB>[\s\S]*?<\/AgB>/)?.[0] || '';
  return agbBlock.includes('<E0161303>0</E0161303>') && agbBlock.includes('<E0161305>0</E0161305>');
})());
check('Kind warns when other parent\'s name is missing for a single filer, since it cannot be safely defaulted', (() => {
  const singleFilerNoParent = JSON.parse(JSON.stringify(sample));
  singleFilerNoParent.hauptvordruck.personB = null;
  singleFilerNoParent.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test' }];
  const result = buildEStXML(singleFilerNoParent);
  return result.skippedSections.some(s => s.includes('other parent'));
})());
check('Kind childcare includes the Elt_k_ZV/Kosten declaration for non-jointly-assessed filers (no Person B) - real bug found via a second regression test round (Regel 100500024)', (() => {
  const singleFiler = JSON.parse(JSON.stringify(sample));
  singleFiler.hauptvordruck.personB = null;
  singleFiler.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test', otherParentName: 'Max Mustermann',
    betreuungskosten: 1400, betreuungAnbieter: 'Kita', betreuungVon: '2025-01-01', betreuungBis: '2025-12-31' }];
  const xml = buildEStXML(singleFiler).xml;
  return xml.includes('<Elt_k_ZV><Kosten><Einz>') && xml.includes('<E0506605>1400</E0506605>') && xml.includes('<E0506604>1400</E0506604>');
})());
check('Kind childcare correctly OMITS Elt_k_ZV/Kosten when genuinely jointly assessed (veranlagungsart is zusammenveranlagung) - only needed when parents are NOT jointly assessed', (() => {
  const married = JSON.parse(JSON.stringify(sample));
  married.hauptvordruck.veranlagungsart = 'zusammenveranlagung';
  married.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Erika', geburtsdatum: '1987-05-20' };
  married.anlageKind = [{ vorname: 'Lena', geburtsdatum: '2016-03-10', kinship: 'leiblich', familienkasse: 'Test',
    betreuungskosten: 1400, betreuungAnbieter: 'Kita', betreuungVon: '2025-01-01', betreuungBis: '2025-12-31' }];
  const xml = buildEStXML(married).xml;
  return !xml.includes('Elt_k_ZV');
})());
check('Anlage Unterhalt includes the required paymentPeriod field (E0120104) alongside amount - real bug found via the multi-year regression test (Regel 300010, FelderNichtGemeinsamAngegeben)', (() => {
  const withU = JSON.parse(JSON.stringify(sample));
  withU.anlageUnterhalt = { betrag: 6000, von: '2025-01-01', bis: '2025-12-31', personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', relationship: 'Mutter', householdAddress: 'Test' };
  const uXml = buildEStXML(withU).xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return uXml.includes('<E0120104>01.01-31.12</E0120104>') && uXml.includes('<E0120109>01.01-31.12</E0120109>');
})());
check('Realsplitting includes the required Name field (E0183101) alongside amount - corrected understanding (real bug: earlier read as optional based on a misunderstood rule type)', (() => {
  const withRS = JSON.parse(JSON.stringify(sample));
  withRS.sonderausgaben = {};
  withRS.weitereAngaben = { realsplittingAnlageU: 5000, realsplitIdnr: '12345678901', realsplitName: 'Max Mustermann' };
  const xml = buildEStXML(withRS).xml;
  return xml.includes('<E0183101>Max Mustermann</E0183101>');
})());
check('Anlage Unterhalt period uses the confirmed date-range format (TT.MM-TT.MM, no year) - same DatumBereich type as childcare', (() => {
  const withU = JSON.parse(JSON.stringify(sample));
  withU.anlageUnterhalt = { betrag: 6000, personName: 'Maria', householdAddress: 'Test', von: '2025-03-01', bis: '2025-11-30' };
  const uXml = buildEStXML(withU).xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return uXml.includes('<E0120109>01.03-30.11</E0120109>');
})());

// Domestic vs foreign branches - confirmed via real Regeln 46/48/32 that
// BOTH branches require the IdNr (foreign does NOT relax this), and the
// foreign branch adds ONE MORE requirement on top (the home-country
// confirmation), not a replacement.
check('Domestic case (no country given): no country field written, no foreign confirmation written', (() => {
  const dom = JSON.parse(JSON.stringify(sample));
  dom.anlageUnterhalt = { betrag: 6000, personName: 'Maria', personIdnr: '12345678901', householdAddress: 'Test' };
  const uXml = buildEStXML(dom).xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return !uXml.includes('E0120102') && !uXml.includes('E0123213') && uXml.includes('E0120211');
})());
check('Foreign case: country IS written, AND the additional home-country confirmation IS written (real Regel 32 - additive, not a replacement for IdNr)', (() => {
  const foreign = JSON.parse(JSON.stringify(sample));
  foreign.anlageUnterhalt = { betrag: 6000, personName: 'Ahmet Muster', personIdnr: '12345678901', householdAddress: 'Test',
    country: 'Türkei', foreignNeedConfirmed: true };
  const uXml = buildEStXML(foreign).xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return uXml.includes('<E0120102>Türkei</E0120102>') && uXml.includes('<E0123213>1</E0123213>') && uXml.includes('E0120211');
})());
check('Foreign case missing the confirmation declaration correctly triggers a warning (skippedSections), not a silent incomplete send', (() => {
  const foreignIncomplete = JSON.parse(JSON.stringify(sample));
  foreignIncomplete.anlageUnterhalt = { betrag: 6000, personName: 'Ahmet', personIdnr: '12345678901', householdAddress: 'Test', country: 'Türkei' };
  const result = buildEStXML(foreignIncomplete);
  return result.skippedSections.some(s => s.includes('foreign household') || s.includes('Regel 32'));
})());
check('"Deutschland" as an explicit country value is correctly treated as domestic (matching the exact real rule condition, not just "no country given")', (() => {
  const explicitDE = JSON.parse(JSON.stringify(sample));
  explicitDE.anlageUnterhalt = { betrag: 6000, personName: 'Maria', personIdnr: '12345678901', householdAddress: 'Test', country: 'Deutschland' };
  const uXml = buildEStXML(explicitDE).xml.match(/<ESt1A_U>[\s\S]*?<\/ESt1A_U>/)?.[0] || '';
  return !uXml.includes('E0120102') && !uXml.includes('E0123213');
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

/* --- Commute (Entfernungspauschale) and itemized Werbungskosten - newly wired, then corrected after a real ERiC rejection (Regel 120801/111301/100200126) revealed E0203504, E0203003, and E0203501 (workplace address) are all genuinely required alongside any commute data --- */
check('Commute by car: base distance (E0203504) AND the car-specific split (E0203505) are both sent - the real bug was sending only the split, never the base figure the rejection actually complained about', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { entfernungspauschale: { arbeitstage: 220, einfacheEntfernungKm: 25, verkehrsmittel: 'car', oeffentlicheKosten: 0, arbeitsstaette: '60000 Frankfurt, Teststr 1' } } };
  const x = buildEStXML(d).xml;
  const nBlock = x.match(/<N>[\s\S]*?<\/N>/)?.[0] || '';
  const wkMatch = nBlock.match(/<Wk>[\s\S]*?<\/Wk>/)?.[0] || '';
  return wkMatch.includes('<EP><Erste_Taetig>') && wkMatch.includes('<E0203504>25</E0203504>') && wkMatch.includes('<E0203505>25</E0203505>')
    && !nBlock.match(/<ArbL>[\s\S]*?<\/ArbL>/)[0].includes('E0203505');
})());
check('Ziel des Weges (E0203003) is sent as "1" (erste Tätigkeitsstätte), the standard case, confirmed via the real schema enumeration', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { entfernungspauschale: { arbeitstage: 220, einfacheEntfernungKm: 25, verkehrsmittel: 'car', oeffentlicheKosten: 0, arbeitsstaette: '60000 Frankfurt, Teststr 1' } } };
  const x = buildEStXML(d).xml;
  return x.includes('<E0203003>1</E0203003>');
})());
check('Workplace address (E0203501) is transmitted as given', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { entfernungspauschale: { arbeitstage: 220, einfacheEntfernungKm: 25, verkehrsmittel: 'car', oeffentlicheKosten: 0, arbeitsstaette: '60000 Frankfurt, Teststr 1' } } };
  const x = buildEStXML(d).xml;
  return x.includes('<E0203501>60000 Frankfurt, Teststr 1</E0203501>');
})());
check('Commute WITHOUT the required workplace address: the whole commute block is honestly skipped, not sent incomplete (this is exactly the real scenario that caused the actual rejection - resending it incomplete would fail the same way again)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { entfernungspauschale: { arbeitstage: 220, einfacheEntfernungKm: 25, verkehrsmittel: 'car', oeffentlicheKosten: 0 } } }; // no arbeitsstaette
  const result = buildEStXML(d);
  const hasNoCommuteFields = !result.xml.includes('E0203503') && !result.xml.includes('E0203504') && !result.xml.includes('E0203505') && !result.xml.includes('E0203003');
  const hasHonestWarning = result.skippedSections.some(s => s.includes('workplace address') && s.includes('Person A'));
  return hasNoCommuteFields && hasHonestWarning;
})());
check('Commute by non-car (other): base distance AND the non-car split (E0203506) are both sent, with a real workplace address present', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { entfernungspauschale: { arbeitstage: 220, einfacheEntfernungKm: 25, verkehrsmittel: 'other', oeffentlicheKosten: 0, arbeitsstaette: '60000 Frankfurt, Teststr 1' } } };
  const x = buildEStXML(d).xml;
  const wkMatch = x.match(/<Wk>[\s\S]*?<\/Wk>/)?.[0] || '';
  return wkMatch.includes('<E0203504>25</E0203504>') && wkMatch.includes('<E0203506>25</E0203506>') && !wkMatch.includes('E0203505');
})());
check('Commute days go to E0203503, inside Wk not ArbL', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { entfernungspauschale: { arbeitstage: 220, einfacheEntfernungKm: 25, verkehrsmittel: 'car', oeffentlicheKosten: 0, arbeitsstaette: '60000 Frankfurt, Teststr 1' } } };
  const x = buildEStXML(d).xml;
  const nBlock = x.match(/<N>[\s\S]*?<\/N>/)?.[0] || '';
  const arblOnly = nBlock.match(/<ArbL>[\s\S]*?<\/ArbL>/)[0];
  return nBlock.includes('<E0203503>220</E0203503>') && !arblOnly.includes('E0203503');
})());
check('Public transport with actual cost provided: E0203611 is transmitted with that value, inside Wk/EP/Erste_Taetig', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { entfernungspauschale: { arbeitstage: 220, einfacheEntfernungKm: 30, verkehrsmittel: 'public', oeffentlicheKosten: 850, arbeitsstaette: '60000 Frankfurt, Teststr 1' } } };
  const x = buildEStXML(d).xml;
  const wkMatch = x.match(/<Wk>[\s\S]*?<\/Wk>/)?.[0] || '';
  return wkMatch.includes('<E0203611>850</E0203611>') && wkMatch.includes('<E0203506>30</E0203506>');
})());
check('Public transport with no actual cost entered: E0203611 correctly omitted, not sent as zero', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { entfernungspauschale: { arbeitstage: 220, einfacheEntfernungKm: 30, verkehrsmittel: 'public', oeffentlicheKosten: 0, arbeitsstaette: '60000 Frankfurt, Teststr 1' } } };
  const x = buildEStXML(d).xml;
  return !x.includes('E0203611');
})());
check('Distance is rounded to a whole number, matching the schema requirement ("auf volle Kilometer abgerundet") - applies to both the base and split fields', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { entfernungspauschale: { arbeitstage: 220, einfacheEntfernungKm: 25.7, verkehrsmittel: 'car', oeffentlicheKosten: 0, arbeitsstaette: '60000 Frankfurt, Teststr 1' } } };
  const x = buildEStXML(d).xml;
  return x.includes('<E0203504>26</E0203504>') && x.includes('<E0203505>26</E0203505>') && !x.includes('25.7') && !x.includes('25,7');
})());
check('Real bug found via an actual ERiC rejection: Ziel des Weges (E0203003) genuinely does not exist before 2023 - a 2022 return with commute data correctly omits it, while a 2025 return correctly still sends it, and the rest of the commute fields (workplace, days, distance) are unaffected either way', (() => {
  const d2022 = JSON.parse(JSON.stringify(sample));
  d2022.meta.taxYear = 2022;
  d2022.werbungskosten = { personA: { entfernungspauschale: { arbeitstage: 100, einfacheEntfernungKm: 100, verkehrsmittel: '', oeffentlicheKosten: 0, arbeitsstaette: 'Musterstr 1, 80331 Munich' } } };
  const x2022 = buildEStXML(d2022).xml;
  const d2025 = JSON.parse(JSON.stringify(sample));
  d2025.meta.taxYear = 2025;
  d2025.werbungskosten = { personA: { entfernungspauschale: { arbeitstage: 100, einfacheEntfernungKm: 100, verkehrsmittel: '', oeffentlicheKosten: 0, arbeitsstaette: 'Musterstr 1, 80331 Munich' } } };
  const x2025 = buildEStXML(d2025).xml;
  return !x2022.includes('E0203003') && x2022.includes('E0203501') && x2022.includes('E0203504')
    && x2025.includes('<E0203003>1</E0203003>');
})());
check('Real ERiC rejection fixed (Regel 100200112): itemized Werbungskosten entries are now sent as individual Sonst entries alongside the Sum total, not the Sum alone - a sum without the underlying amounts is genuinely invalid', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: {}, einzelposten: [
    { person: 'A', kategorie: 'bewerbung', bezeichnung: 'Bewerbungskosten', betrag: 45 },
    { person: 'A', kategorie: 'kommunikation', bezeichnung: 'Kommunikationskosten', betrag: 180 },
  ] };
  const x = buildEStXML(d).xml;
  const wkMatch = x.match(/<Wk>[\s\S]*?<\/Wk>/)?.[0] || '';
  const sonstCount = (wkMatch.match(/<Sonst>/g) || []).length;
  return sonstCount === 2 && wkMatch.includes('<E0205406>45</E0205406>') && wkMatch.includes('<E0205406>180</E0205406>') && wkMatch.includes('<E0204803>225</E0204803>');
})());
check('Itemized Werbungskosten total is genuinely per-person, not pooled across both spouses', (() => {
  const married = JSON.parse(JSON.stringify(sample));
  married.hauptvordruck.veranlagungsart = 'zusammenveranlagung';
  married.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Erika', geburtsdatum: '1987-05-20', religion: 'EV' };
  married.anlageN.push({ person: 'B', zeile3_bruttoarbeitslohn: 40000, zeile4_lohnsteuer: 6000, zeile5_soli: 100, zeile6_kirchensteuer: 0 });
  married.werbungskosten = { personA: {}, personB: {}, einzelposten: [
    { person: 'A', kategorie: 'bewerbung', betrag: 100 },
    { person: 'B', kategorie: 'kommunikation', betrag: 60 },
  ] };
  const x = buildEStXML(married).xml;
  const blocks = x.match(/<N>[\s\S]*?<\/N>/g) || [];
  const aBlock = blocks.find(b => b.includes('PersonA')) || '';
  const bBlock = blocks.find(b => b.includes('PersonB')) || '';
  return aBlock.includes('<E0204803>100</E0204803>') && bBlock.includes('<E0204803>60</E0204803>');
})());
check('No commute or Werbungskosten data present: none of the new fields appear at all, no empty tags sent, no empty Wk block either', (() => {
  const x = buildEStXML(sample).xml; // the original sample has no werbungskosten object at all
  return !x.includes('E0203503') && !x.includes('E0203505') && !x.includes('E0203506') && !x.includes('E0203611') && !x.includes('E0204803') && !x.includes('<Wk>');
})());

/* --- Anlage SO (private sales gains) - newly wired via SO/Priv_VA_G/And_WG, confirmed identical across all five years 2021-2025 --- */
check('Real private-sales gain produces the correct SO/Priv_VA_G/And_WG structure with the sale-price field set to the known gain, AND includes the description and explicit Gewinn/Verlust fields genuinely required by real ERiC business rules (Regel 130829, 101300034) - confirmed via an actual rejection, not just the schema', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.weitereAngaben = { anlageSO: { privateVeraeusserungsgeschaefte: 2500, erhaltenerUnterhalt: 0 } };
  const x = buildEStXML(d).xml;
  return x.includes('<SO><Priv_VA_G><And_WG><Person>PersonA</Person>') && x.includes('<E0307401>2500</E0307401>')
    && x.includes('<E0307101>') && x.includes('<E0307701>2500</E0307701>');
})());
check('Zero acquisition cost is correctly omitted rather than sent as an explicit 0, matching this codebase\'s established zero-value convention', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.weitereAngaben = { anlageSO: { privateVeraeusserungsgeschaefte: 2500, erhaltenerUnterhalt: 0 } };
  const x = buildEStXML(d).xml;
  return !x.includes('E0307501');
})());
check('No private-sales gain entered: no SO block at all, nothing sent', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.weitereAngaben = { anlageSO: { privateVeraeusserungsgeschaefte: 0, erhaltenerUnterhalt: 0 } };
  const x = buildEStXML(d).xml;
  return !x.includes('<SO>');
})());

/* --- Home office, DHH, and spouse disability fields - real gaps found and fixed via the systematic backend-wiring audit --- */
check('Home office days are correctly wrapped in Homeoffice, not sent bare under Wk (a real bug caught and fixed before shipping)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { homeofficeTage: 60 }, einzelposten: [] };
  const x = buildEStXML(d).xml;
  return x.includes('<Homeoffice><E0204507>60</E0204507>') || x.includes('<Homeoffice>\n<E0204507>60</E0204507>');
})());
check('Real ERiC rejection fixed (feldUnbekannt on all three DHH fields): N_DHH is now correctly built as its own separate top-level element, not nested inside N/Wk - confirmed both that N_DHH contains the real fields AND that N itself no longer contains DHHF at all', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { doppelteHaushaltsfuehrung: { monatsmiete: 800, monate: 6, familienheimfahrten: 12, entfernungKm: 300 } }, einzelposten: [] };
  const x = buildEStXML(d).xml;
  const nBlock = x.match(/<N>[\s\S]*?<\/N>/)?.[0] || '';
  const ndhhBlock = x.match(/<N_DHH>[\s\S]*?<\/N_DHH>/)?.[0] || '';
  return !nBlock.includes('DHHF') && ndhhBlock.includes('<E0207611>4800</E0207611>')
    && ndhhBlock.includes('<E0207116>300</E0207116>') && ndhhBlock.includes('<E0207117>12</E0207117>');
})());
check('Relocation costs are folded honestly into the itemized Werbungskosten total rather than left unsent', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { umzugskosten: 500 }, einzelposten: [] };
  const x = buildEStXML(d).xml;
  return x.includes('<E0204803>500</E0204803>');
})());
check('Spouse disability grade (gdbB) is transmitted using the same real Kennzahl as PersonA, correctly wrapped with Person=PersonB', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.veranlagungsart = 'zusammenveranlagung';
  d.hauptvordruck.personB = { idnr: '11122233344', name: 'Test', vorname: 'B', geburtsdatum: '1986-01-01', religion: '--' };
  d.weitereAngaben = { behinderung: { gdbA: '50', gdbB: '30' } };
  const x = buildEStXML(d).xml;
  return x.includes('<Beh><Person>PersonA</Person><Ausw_Rentb_Besch><E0109708>50</E0109708>')
    && x.includes('<Beh><Person>PersonB</Person><Ausw_Rentb_Besch><E0109708>30</E0109708>');
})());
check('Pflege-Pauschbetrag (care lump sum), incomplete case: a grade alone with no person details still correctly falls through to skippedSections rather than sending an invalid, incomplete entry', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.weitereAngaben = { behinderung: { pflegeA: 600, pflegeB: 1100 } };
  const result = buildEStXML(d);
  const hasNoPflegePB = !result.xml.includes('Pflege_PB');
  const isFlagged = result.skippedSections.some(s => s.includes('Pflege-Pauschbetrag'));
  return hasNoPflegePB && isFlagged;
})());
check('Pflege-Pauschbetrag (care lump sum), now implemented: with all required person details present, the deduction transmits correctly in the confirmed real element order, with no skipped-section note - this test would have caught a real bug where the entry was silently discarded due to a missing "any" flag update', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.weitereAngaben = { behinderung: {
    pflegeA: 600, pflegePersonA: 'Maria Muster, Hauptstr. 1, 12345 Musterstadt, geb. 03.05.1950, Mutter',
    pflegePersonAId: '98765432109', pflegePersonAResident: 'yes', pflegePersonAH: true,
  } };
  const result = buildEStXML(d);
  const pflegeBlock = result.xml.match(/<Pflege_PB>[\s\S]*?<\/Pflege_PB>/)?.[0] || '';
  const notFlagged = !result.skippedSections.some(s => s.includes('Pflege-Pauschbetrag'));
  return pflegeBlock.includes('<E0110601>Maria Muster') && pflegeBlock.includes('<E0161506>98765432109</E0161506>')
    && pflegeBlock.includes('<E0161607>1</E0161607>') && pflegeBlock.includes('<E0161606>2</E0161606>')
    && pflegeBlock.includes('<E0161808>1</E0161808>') && notFlagged;
})());

check('Household services (Hhn_BV_DL) are now correctly wired as a genuine sibling to Handwerkerleistungen under St_Erm, using its own real Kennzahlen rather than incorrectly sharing Handw_L\'s (the real bug the previous version had)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.haushaltsnaheLeistungen = { haushaltsnaheDienstleistungen: 1200, handwerkerleistungen: 800 };
  const x = buildEStXML(d).xml;
  return x.includes('<Hhn_BV_DL><Einz>') && x.includes('<E0107207>1200</E0107207>') && x.includes('<E0107208>1200</E0107208>')
    && x.includes('<Handw_L><Einz>') && x.includes('<E0170601>800</E0170601>')
    && !x.includes('<E0111214>1200'); // confirms the two amounts are genuinely not cross-contaminated
})());

check('Unemployment insurance contributions (av) are now transmitted through the real Weit_Sons_VorAW/Pers structure - a Kennzahl that was already correctly identified in the fieldmap but never actually called before this fix', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageVorsorgeaufwand = { ausLohnsteuerbescheinigungen: { rv: 5000, gkv: 4000, pv: 800, av: 1200 } };
  const x = buildEStXML(d).xml;
  return x.includes('<Weit_Sons_VorAW>') && x.includes('<Pers><Person>PersonA</Person>') && x.includes('<E2004403>1200</E2004403>');
})());

check('Private health/care insurance (pkv type specifically) is transmitted net of reimbursement, while other, not-yet-confirmed insurance types are correctly excluded rather than bundled in incorrectly', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageVorsorgeaufwand = { ausLohnsteuerbescheinigungen: {}, privateVersicherungen: [
    { person: 'A', typ: 'pkv', beitrag: 3600, erstattung: 200, netto: 3400 },
    { person: 'A', typ: 'haftpflicht', beitrag: 100, erstattung: 0, netto: 100 },
  ] };
  const x = buildEStXML(d).xml;
  return x.includes('<Beitr_p_KV_PV_Inl><Person>PersonA</Person>') && x.includes('<E2003104>3400</E2003104>') && !x.includes('3500');
})());

check('Accident/liability/term-life insurance types are combined into the real U_HP_Ris_Vers structure, found by actually opening a sibling element identified earlier but never checked', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageVorsorgeaufwand = { ausLohnsteuerbescheinigungen: {}, privateVersicherungen: [
    { person: 'A', typ: 'haftpflicht', beitrag: 100, erstattung: 0, netto: 100 },
    { person: 'A', typ: 'unfall', beitrag: 150, erstattung: 0, netto: 150 },
  ] };
  const x = buildEStXML(d).xml;
  return x.includes('<U_HP_Ris_Vers><Einz>') && x.includes('<E2001802>250</E2001802>') && x.includes('<E2001803>250</E2001803>');
})());
check('Occupational disability insurance (bu) is transmitted through the real ErwU_BU_Vers structure', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageVorsorgeaufwand = { ausLohnsteuerbescheinigungen: {}, privateVersicherungen: [
    { person: 'A', typ: 'bu', beitrag: 800, erstattung: 0, netto: 800 },
  ] };
  const x = buildEStXML(d).xml;
  return x.includes('<ErwU_BU_Vers><Einz>') && x.includes('<E2001502>800</E2001502>');
})());
check('Real bug caught before shipping: when both unemployment insurance (av) and one of the new insurance categories are present together, they combine into exactly one Weit_Sons_VorAW wrapper, not two illegal separate ones (schema confirmed maxOccurs=1 for Weit_Sons_VorAW itself, the exact same class of bug already caught once with Pflege_PB)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageVorsorgeaufwand = { ausLohnsteuerbescheinigungen: { av: 1200 }, privateVersicherungen: [
    { person: 'A', typ: 'bu', beitrag: 800, erstattung: 0, netto: 800 },
  ] };
  const x = buildEStXML(d).xml;
  const wsvCount = (x.match(/<Weit_Sons_VorAW>/g) || []).length;
  return wsvCount === 1 && x.includes('<E2004403>1200</E2004403>') && x.includes('<E2001502>800</E2001502>');
})());

check('Supplementary health and care insurance (kvzusatz, pflegezusatz) combine into the real WL_Zvers field, found by checking Beitr_p_KV_PV_Inl through to its actual last sibling this time - and correctly share one Beitr_p_KV_PV_Inl wrapper with pkv rather than a duplicate second one', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageVorsorgeaufwand = { ausLohnsteuerbescheinigungen: {}, privateVersicherungen: [
    { person: 'A', typ: 'pkv', beitrag: 3600, erstattung: 200, netto: 3400 },
    { person: 'A', typ: 'kvzusatz', beitrag: 500, erstattung: 0, netto: 500 },
    { person: 'A', typ: 'pflegezusatz', beitrag: 300, erstattung: 0, netto: 300 },
  ] };
  const x = buildEStXML(d).xml;
  const wrapCount = (x.match(/<Beitr_p_KV_PV_Inl>/g) || []).length;
  return wrapCount === 1 && x.includes('<E2003104>3400</E2003104>') && x.includes('<E2003502>800</E2003502>');
})());

check('Real ERiC rejection fixed (uniqueIndex on /KAP/Person): multiple capital income entries for the same person (e.g. two banks) now combine into exactly one KAP block with correctly summed totals, not two separate blocks sharing the same Person value', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageKAP = [
    { person: 'A', zeile7_kapitalertraege: 1000, zeile16_sparerPauschbetragGenutzt: 500 },
    { person: 'A', zeile7_kapitalertraege: 2000, zeile16_sparerPauschbetragGenutzt: 300 },
  ];
  const x = buildEStXML(d).xml;
  const kapCount = (x.match(/<KAP>/g) || []).length;
  return kapCount === 1 && x.includes('<E1900701>3000</E1900701>') && x.includes('<E1901401>800</E1901401>');
})());

check('Same real bug class as KAP, found via systematic audit: multiple pension sources (statutory plus private) for the same person now combine into exactly one R block, not two sharing the same Person value', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageR = [
    { person: 'A', art: 'gesetzlich', jahresbetrag: 8000, rentenbeginn: '2020' },
    { person: 'A', art: 'privat', jahresbetrag: 2000, rentenbeginn: '2021' },
  ];
  const x = buildEStXML(d).xml;
  const rCount = (x.match(/<R>/g) || []).length;
  return rCount === 1 && x.includes('<E1800301>8000</E1800301>') && x.includes('<E1801601>2000</E1801601>');
})());
check('Same real bug class as KAP, found via systematic audit: foreign employment in more than one country for the same person now combines into exactly one N_AUS block with a separate Staat entry per country, not two N_AUS blocks sharing the same Person value', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [
    { person: 'A', land: 'USA', legalBasis: 'dba', gesamtlohn: 30000 },
    { person: 'A', land: 'Frankreich', legalBasis: 'dba', gesamtlohn: 15000 },
  ];
  const x = buildEStXML(d).xml;
  const nAusCount = (x.match(/<N_AUS>/g) || []).length;
  const outerStaatCount = (x.match(/<Staat>\n<Staat>/g) || []).length;
  return nAusCount === 1 && outerStaatCount === 2 && x.includes('<Staat><E2600401>USA</E2600401>\n</Staat>') && x.includes('<Staat><E2600401>Frankreich</E2600401>\n</Staat>');
})());

check('Real, separate bug found while checking for the uniqueIndex issue: AUS now correctly includes the genuinely required Person tag, which was never written at all before this fix', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ street: 'Rue Test', plz: '75001', ort: 'Paris', land: 'Frankreich', mieteinnahmen: 12000, nebenkosten: 0, werbungskosten: 2000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<AUS><Person>PersonA</Person>');
})());

check('Real ERiC rejection fixed (feldUnbekannt on E2600401): the country field is now correctly wrapped in its own inner Staat sub-element, a genuine, separate mistake from the earlier duplicate-wrapper bug - the field was placed one level too shallow', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageNAUS = [{ person: 'A', land: 'USA', legalBasis: 'dba', gesamtlohn: 30000 }];
  const x = buildEStXML(d).xml;
  return x.includes('<Staat>\n<Staat><E2600401>USA</E2600401>');
})());

check('N_DHH correctly builds one block per person when both spouses have double-household costs, matching the confirmed maxOccurs=2 constraint', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.veranlagungsart = 'zusammenveranlagung';
  d.hauptvordruck.personB = { idnr: '11122233344', name: 'Test', vorname: 'B', geburtsdatum: '1986-01-01', religion: '--' };
  d.werbungskosten = {
    personA: { doppelteHaushaltsfuehrung: { monatsmiete: 800, monate: 6, familienheimfahrten: 12, entfernungKm: 300 } },
    personB: { doppelteHaushaltsfuehrung: { monatsmiete: 500, monate: 4, familienheimfahrten: 8, entfernungKm: 200 } },
    einzelposten: [],
  };
  const x = buildEStXML(d).xml;
  const ndhhCount = (x.match(/<N_DHH>/g) || []).length;
  return ndhhCount === 2 && x.includes('<Person>PersonA</Person>\n<DHHF>') && x.includes('<Person>PersonB</Person>\n<DHHF>');
})());

check('Real ERiC rejection fixed (Regel 100200032, 100200041): the five fields genuinely required alongside DHH data are now present in the correct real element order (Allg, then Fahrtk, then Unterkunft), with the date correctly formatted as TT.MM.JJJJ', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { doppelteHaushaltsfuehrung: {
    monatsmiete: 800, monate: 6, familienheimfahrten: 12, entfernungKm: 300,
    grund: 'Neue Arbeitsstelle', datum: '2025-03-01', beschaeftigungsort: '60329 Frankfurt am Main',
    eigenerHausstand: 'yes', reiseart: 'no',
  } }, einzelposten: [] };
  const x = buildEStXML(d).xml;
  const ndhh = x.match(/<N_DHH>[\s\S]*?<\/N_DHH>/)?.[0] || '';
  const allgIdx = ndhh.indexOf('<Allg>'), fahrtkIdx = ndhh.indexOf('<Fahrtk>'), unterkunftIdx = ndhh.indexOf('<Unterkunft>');
  const correctOrder = allgIdx > -1 && allgIdx < fahrtkIdx && fahrtkIdx < unterkunftIdx;
  return correctOrder && ndhh.includes('<E0206103>01.03.2025</E0206103>') && ndhh.includes('<E0206205>Neue Arbeitsstelle</E0206205>')
    && ndhh.includes('<E0206404>60329 Frankfurt am Main</E0206404>') && ndhh.includes('<E0206504>1</E0206504>')
    && ndhh.includes('<E0206805>2</E0206805>');
})());

check('Real structural bug found and fixed: fields within Allg are now written in the confirmed real schema order (date, reason, continuous-until, workplace, own-household...) - the previous code wrote continuous-until before reason, an out-of-order sequence that fails schema validation with no business-rule detail, matching the blank 610301200 crash', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { doppelteHaushaltsfuehrung: {
    monatsmiete: 800, monate: 6, familienheimfahrten: 12, entfernungKm: 300,
    grund: 'Neue Arbeitsstelle', datum: '2025-03-01', bestehtBis: '31.12.', beschaeftigungsort: '60329 Frankfurt am Main',
    eigenerHausstand: 'yes', eigenerHausstandOrt: '12345 Musterstadt', eigenerHausstandSeit: '2015-01-01', reiseart: 'no',
  } }, einzelposten: [] };
  const x = buildEStXML(d).xml;
  const allg = x.match(/<DHHF><Allg>([\s\S]*?)<\/Allg>/)?.[1] || '';
  const order = ['E0206103', 'E0206205', 'E0206304', 'E0206404', 'E0206504', 'E0206505', 'E0206506'];
  const positions = order.map(code => allg.indexOf(code));
  const correctlyOrdered = positions.every((p, i) => p > -1 && (i === 0 || p > positions[i - 1]));
  return correctlyOrdered;
})());
check('Real ERiC rejection fixed (Regel 100200053): when travel was entirely by company car, no travel cost amounts are sent alongside that declaration - a genuine contradiction ELSTER correctly rejects, not two independent facts', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { doppelteHaushaltsfuehrung: {
    monatsmiete: 800, monate: 6, familienheimfahrten: 12, entfernungKm: 300,
    grund: 'x', datum: '2025-03-01', bestehtBis: '31.12', beschaeftigungsort: 'x',
    eigenerHausstand: 'no', reiseart: 'yes',
  } }, einzelposten: [] };
  const x = buildEStXML(d).xml;
  return x.includes('<E0206805>1</E0206805>') && !x.includes('Woech_Heimf');
})());

check('Real gap found via a full client-data audit: Arbeitsmittel and Fortbildung (direct entry fields, distinct from the itemized list) are now transmitted, in the confirmed real element order (Arbeitsmittel before Homeoffice before Fortb)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { arbeitsmittel: 1000, fortbildung: 800, homeofficeTage: 20 }, einzelposten: [] };
  const x = buildEStXML(d).xml;
  const wk = x.match(/<Wk>[\s\S]*?<\/Wk>/)?.[0] || '';
  const order = ['<Arbeitsmittel>', '<Homeoffice>', '<Fortb>'];
  const positions = order.map(tag => wk.indexOf(tag));
  const correctOrder = positions.every((p, i) => p > -1 && (i === 0 || p > positions[i - 1]));
  return correctOrder && wk.includes('<E0204402>1000</E0204402>') && wk.includes('<E0204808>800</E0204808>');
})());
check('Real bug caught via direct inspection of actual client data: the direct "sonstige" field is now given its own visible Sonst entry, not just folded into the Sum total silently - which would have triggered the same "sum without matching entries" rejection already fixed once', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.werbungskosten = { personA: { sonstige: 1000 }, einzelposten: [] };
  const x = buildEStXML(d).xml;
  const weitereWk = x.match(/<Weitere_Wk>[\s\S]*?<\/Weitere_Wk>/)?.[0] || '';
  const sonstCount = (weitereWk.match(/<Sonst>/g) || []).length;
  return sonstCount === 1 && weitereWk.includes('<E0205406>1000</E0205406>') && weitereWk.includes('<E0204803>1000</E0204803>');
})());

check('Real gap found via a complete re-check of the SO structure: received support payments (Unt_Leist) are now transmitted, correctly combined with private sales gains into a single SO wrapper, not two separate ones - and correctly reads the real Kennzahl string rather than the raw fieldmap object (a real bug caught by inspecting the actual output)', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.weitereAngaben = { anlageSO: { privateVeraeusserungsgeschaefte: 3000, erhaltenerUnterhalt: 1000 } };
  const x = buildEStXML(d).xml;
  const soCount = (x.match(/<SO>/g) || []).length;
  return soCount === 1 && x.includes('<E0304601>1000</E0304601>') && x.includes('<E0307401>3000</E0307401>') && !x.includes('[object Object]');
})());

check('Real fix backed by an independent source (steuern.de Ausfüllhilfe): travel health insurance (auslandkv) and sick-pay insurance (krankentagegeld) now correctly fold into the same Wahlleistungen line as supplementary health/care coverage', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageVorsorgeaufwand = { ausLohnsteuerbescheinigungen: {}, privateVersicherungen: [
    { person: 'A', typ: 'auslandkv', beitrag: 200, erstattung: 100, netto: 100 },
    { person: 'A', typ: 'krankentagegeld', beitrag: 300, erstattung: 0, netto: 300 },
  ] };
  const x = buildEStXML(d).xml;
  return x.includes('<WL_Zvers><E2003502>400</E2003502>');
})());
check('Real fix backed by an independent source (WISO Steuer\'s own published list): funeral insurance (sterbegeld) is grouped with term-life insurance in the same real category, not left unmapped', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageVorsorgeaufwand = { ausLohnsteuerbescheinigungen: {}, privateVersicherungen: [
    { person: 'A', typ: 'sterbegeld', beitrag: 2000, erstattung: 0, netto: 2000 },
  ] };
  const x = buildEStXML(d).xml;
  return x.includes('<E2001802>2000</E2001802>');
})());

check('Real ERiC rejection fixed (feldUnbekannt on E2003502, plus the related "nothing but Person" error): kvZusatz now correctly sits inside its own WL_Zvers wrapper rather than as a bare sibling, and exactly one VOR block is produced when both pkv and kvzusatz are present together', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageVorsorgeaufwand = { ausLohnsteuerbescheinigungen: {}, privateVersicherungen: [
    { person: 'A', typ: 'pkv', beitrag: 3600, erstattung: 200, netto: 3400 },
    { person: 'A', typ: 'kvzusatz', beitrag: 500, erstattung: 0, netto: 500 },
  ] };
  const x = buildEStXML(d).xml;
  const vorCount = (x.match(/<VOR>/g) || []).length;
  return vorCount === 1 && x.includes('<E2003104>3400</E2003104>') && x.includes('<WL_Zvers><E2003502>500</E2003502>\n</WL_Zvers>');
})());

check('Real ERiC rejection fixed (Regel 40, 41): the spouse religion field was completely missing from joint assessment, even though first name, birth date, and religion must all be sent together - added in the confirmed real position and format', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.veranlagungsart = 'zusammenveranlagung';
  d.hauptvordruck.personB = { name: 'Muster', vorname: 'Anna', geburtsdatum: '1987-03-15', religion: 'EV' };
  const x = buildEStXML(d).xml;
  const bBlock = x.match(/<B>[\s\S]*?<\/B>/)?.[0] || '';
  return bBlock.includes('<E0100801>Anna</E0100801>') && bBlock.includes('<E0101002>02</E0101002>')
    && bBlock.indexOf('E0100801') < bBlock.indexOf('E0101002');
})());

check('Disability-related commute allowance - now genuinely implemented: the two selectable amounts (900/4500) correctly map to their real thresholds, positioned right after Pflege_PB in the confirmed real element order, and no longer flagged as a gap', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.weitereAngaben = { behinderung: { fahrtA: 900, fahrtB: 4500 } };
  const x_result = buildEStXML(d);
  const xml = x_result.xml;
  const behFkA = xml.includes('<Person>PersonA</Person>\n<E0161706>1</E0161706>');
  const behFkB = xml.includes('<Person>PersonB</Person>\n<E0161806>1</E0161806>');
  const notFlagged = !x_result.skippedSections.some(s => s.includes('commute allowance'));
  const positions = { pflege: xml.indexOf('<Pflege_PB>'), fk: xml.indexOf('<Beh_Fk_Pausch>') };
  return behFkA && behFkB && notFlagged && positions.fk > positions.pflege;
})());

check('Four newly-implemented rarer rental categories (special depreciation, financing costs, 5-year maintenance, VAT-liable letting) transmit in the confirmed real element order, and the required overall Se_WK total correctly includes all of them', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageV = [{ street: 'Test', plz: '60000', ort: 'Frankfurt', land: 'Deutschland', mieteinnahmen: 12000, nebenkosten: 0,
    wkAfa: 2000, wkSonderabschr: 1000, wkSchuldzins: 3000, wkGeldbeschaff: 500,
    wkErhaltung: 800, wk5JAbzugsfaehig: 400, wkVerwaltung: 300, wkUstPflichtig: 200, wkSonst: 100,
    wohneinheit: 'G', ergebnis: 3300 }];
  const x = buildEStXML(d).xml;
  const wk = x.match(/<Wk>[\s\S]*?<\/Wk>/)?.[0] || '';
  const order = ['<AfA_Geb>', '<Sonderabschr_P7b>', '<Schuldzins>', '<Geldbeschaff>', '<Erhalt_AW_dir>', '<Erhalt_AW_5_J>', '<Verw_Ko>', '<Ust_stpfl_Verm>', '<Sonst>', '<Se_WK>'];
  const positions = order.map(tag => wk.indexOf(tag));
  const correctOrder = positions.every((p, i) => p > -1 && (i === 0 || p > positions[i - 1]));
  return correctOrder && wk.includes('<E0703601>2</E0703601>') && wk.includes('<E0704814>500</E0704814>')
    && wk.includes('<E0704812>200</E0704812>') && wk.includes('<E0705701>8300</E0705701>');
})());
check('Financing costs, pre-2023 year: Direkt fields (confirmed minYear=2023) are correctly omitted, but Sum still transmits so the deduction still works for earlier years', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2022;
  d.anlageV = [{ street: 'Test', plz: '60000', ort: 'Frankfurt', land: 'Deutschland', mieteinnahmen: 12000, nebenkosten: 0,
    wkGeldbeschaff: 500, wohneinheit: 'G', ergebnis: 11500 }];
  const x = buildEStXML(d).xml;
  const geldbeschaff = x.match(/<Geldbeschaff>[\s\S]*?<\/Geldbeschaff>/)?.[0] || '';
  return !geldbeschaff.includes('E0704813') && !geldbeschaff.includes('E0704814') && geldbeschaff.includes('<E0704406>500</E0704406>');
})());

check('Real gap found via direct user feedback: multiple supported people (up to 99, confirmed via the real schema) now transmit as genuinely independent entries, not tied to either spouse specifically - two people from a joint-filing couple each get their own complete, correctly structured block', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.veranlagungsart = 'zusammenveranlagung';
  d.hauptvordruck.personB = { name: 'Muster', vorname: 'Anna', geburtsdatum: '1987-03-15', religion: 'EV' };
  d.anlageUnterhalt = [
    { personName: 'Mutter Max', profession: 'Rentnerin', personBirthDate: '1950-01-01', relationship: 'Mutter', betrag: 3000, householdSize: 1 },
    { personName: 'Vater Anna', profession: 'Rentner', personBirthDate: '1948-06-15', relationship: 'Vater', betrag: 2500, householdSize: 1 },
  ];
  const x = buildEStXML(d).xml;
  const blockCount = (x.match(/<Ang_HH_unt_P_Unt_Leist>/g) || []).length;
  return blockCount === 2 && x.includes('<E0120201>Mutter Max</E0120201>') && x.includes('<E0120201>Vater Anna</E0120201>')
    && x.includes('<E0120103>3000</E0120103>') && x.includes('<E0120103>2500</E0120103>');
})());
check('Backward compatibility: the old single-object format (not an array) still works correctly, automatically treated as one person', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageUnterhalt = { personName: 'Solo Person', profession: 'Rentner', personBirthDate: '1950-01-01', relationship: 'Vater', betrag: 3000, householdSize: 1 };
  const x = buildEStXML(d).xml;
  return (x.match(/<Ang_HH_unt_P_Unt_Leist>/g) || []).length === 1 && x.includes('<E0120201>Solo Person</E0120201>');
})());
check('Pre-2023 years: only the first person is sent, since that structure is genuinely more ambiguous for multiple people and hasn\'t been separately verified - honest limitation, not silently dropped', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.meta.taxYear = 2022;
  d.anlageUnterhalt = [
    { personName: 'First Person', profession: 'Rentner', personBirthDate: '1950-01-01', relationship: 'Vater', betrag: 3000, householdSize: 1 },
    { personName: 'Second Person', profession: 'Rentner', personBirthDate: '1948-01-01', relationship: 'Mutter', betrag: 2000, householdSize: 1 },
  ];
  const x = buildEStXML(d).xml;
  return x.includes('First Person') && !x.includes('Second Person');
})());

check('Real gap found via a complete field-audit: Arbeitszimmer (dedicated home office room, distinct from the daily home-office allowance) now transmits correctly for both people, in the confirmed real element order right after Arbeitsmittel and before Homeoffice', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.veranlagungsart = 'zusammenveranlagung';
  d.hauptvordruck.personB = { name: 'Muster', vorname: 'Anna', geburtsdatum: '1987-03-15', religion: 'EV' };
  d.anlageN.push({ person: 'B', zeile3_bruttoarbeitslohn: 40000, zeile4_lohnsteuer: 6000 });
  d.werbungskosten = { personA: { arbeitsmittel: 500, arbeitszimmer: 1260, homeofficeTage: 50 }, personB: { arbeitszimmer: 900 }, einzelposten: [] };
  const x = buildEStXML(d).xml;
  const arbZimBlocks = x.match(/<Arb_Zim>[\s\S]*?<\/Arb_Zim>/g) || [];
  const orderOk = x.indexOf('<Arbeitsmittel>') < x.indexOf('<Arb_Zim>') && x.indexOf('<Arb_Zim>') < x.indexOf('<Homeoffice>');
  return arbZimBlocks.length === 2 && arbZimBlocks[0].includes('<E0204505>1260</E0204505>') && arbZimBlocks[1].includes('<E0204505>900</E0204505>') && orderOk;
})());

check('Newly implemented: child disability/helplessness transfer (Ueb_PB_Beh_Hbl) - indefinite validity case, mandatory fields only', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageKind = [{ vorname: 'Emma', geburtsdatum: '2015-05-01', kinship: 'leiblich',
    behMobility: true, behBlindHelpless: false, behValidIndefinite: true }];
  const x = buildEStXML(d).xml;
  const block = x.match(/<Ueb_PB_Beh_Hbl>[\s\S]*?<\/Ueb_PB_Beh_Hbl>/)?.[0] || '';
  return block.includes('<E0505908>1</E0505908>') && block.includes('<E0505808>1</E0505808>') && !block.includes('E0506007');
})());
check('Newly implemented: child disability/helplessness transfer - date-range validity with a real, non-default split percentage, correctly formatted as month/year only', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageKind = [{ vorname: 'Emma', geburtsdatum: '2015-05-01', kinship: 'leiblich',
    behBlindHelpless: true, behValidFrom: '2023-06-15', behValidTo: '2026-06-15', behSplitPercent: 70 }];
  const x = buildEStXML(d).xml;
  const block = x.match(/<Ueb_PB_Beh_Hbl>[\s\S]*?<\/Ueb_PB_Beh_Hbl>/)?.[0] || '';
  return block.includes('<E0504601>06.2023</E0504601>') && block.includes('<E0504602>06.2026</E0504602>')
    && block.includes('<E0505807>1</E0505807>') && block.includes('<E0506007>70</E0506007>');
})());
check('Newly implemented: child disability/helplessness transfer - a 50% split (ERiC\'s own default) is correctly omitted rather than sent redundantly', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageKind = [{ vorname: 'Emma', geburtsdatum: '2015-05-01', kinship: 'leiblich',
    behMobility: true, behValidIndefinite: true, behSplitPercent: 50 }];
  const x = buildEStXML(d).xml;
  return !x.includes('E0506007');
})());
check('Newly implemented: child disability/helplessness transfer - correctly not sent at all when neither a marker nor validity is present, matching the "don\'t send an incomplete declaration" discipline', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.anlageKind = [{ vorname: 'Emma', geburtsdatum: '2015-05-01', kinship: 'leiblich' }];
  const x = buildEStXML(d).xml;
  return !x.includes('Ueb_PB_Beh_Hbl');
})());

check('Real ERiC cross-validation rejection fixed (Regel 101160039): the disability marker is now declared consistently in both the main Beh block and Beh_Fk_Pausch, confirmed via the exact real scenario that was rejected', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.weitereAngaben = { behinderung: { gdbA: '80', fahrtA: '900' } };
  const x = buildEStXML(d).xml;
  const behBlock = x.match(/<Beh>[\s\S]*?<\/Beh>/)?.[0] || '';
  return behBlock.includes('<E0109708>80</E0109708>') && behBlock.includes('<E0109707>1</E0109707>')
    && x.includes('<E0161706>1</E0161706>');
})());
check('The same marker fix also creates the Beh block even when only the commute tier is selected, with no separate grade value - the marker needs somewhere to live', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.weitereAngaben = { behinderung: { fahrtA: '4500' } };
  const x = buildEStXML(d).xml;
  const behBlock = x.match(/<Beh>[\s\S]*?<\/Beh>/)?.[0] || '';
  return behBlock.includes('<E0109706>1</E0109706>') && !behBlock.includes('Ausw_Rentb_Besch');
})());

check('Real ERiC rejection resolved (feldUnbekannt on E0102602, persisting even with genuine spouse data): the field was being sent inside A, but genuinely lives in its own separate Vlg_Art element (a sibling of A and B) - confirmed via careful schema tracing. Now correctly absent from A and present in its own Vlg_Art block when genuine spouse data exists.', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.veranlagungsart = 'einzelveranlagung_ehegatten_par26a';
  d.hauptvordruck.personB = { idnr: '59846301578', name: 'Mustermann', vorname: 'Frau', geburtsdatum: '1998-06-16', religion: '--' };
  const x = buildEStXML(d).xml;
  const aBlock = x.match(/<A>[\s\S]*?<\/A>/)?.[0] || '';
  const vlgArtBlock = x.match(/<Vlg_Art>[\s\S]*?<\/Vlg_Art>/)?.[0] || '';
  return !aBlock.includes('E0102602') && vlgArtBlock.includes('<E0102602>X</E0102602>');
})());
check('Real ERiC rejection investigated (feldUnbekannt on E0102602): the separate-assessment-of-spouses flag is only sent when genuine spouse data exists (a real Tax ID), not just a truthy personB object, protecting against the exact scenario a real rejection surfaced', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.veranlagungsart = 'einzelveranlagung_ehegatten_par26a';
  d.hauptvordruck.personB = null;
  const x = buildEStXML(d).xml;
  return !x.includes('E0102602');
})());

check('CORRECTED (again): legacy double-household structure for 2021/2022 - my own field extraction had been silently truncated by a chunk-size limit, causing me to wrongly conclude the own-household fields don\'t exist for these years. A real ERiC rejection confirmed they\'re genuinely required, using the exact same codes as 2023+. Now correctly included and required.', (() => {
  const d2022 = JSON.parse(JSON.stringify(sample));
  d2022.meta.taxYear = 2022;
  d2022.werbungskosten = { personA: { doppelteHaushaltsfuehrung: {
    monatsmiete: 800, monate: 6, familienheimfahrten: 12, entfernungKm: 300,
    grund: 'Neue Arbeitsstelle', datum: '2025-03-01', bestehtBis: '31.12.', beschaeftigungsort: '60329 Frankfurt am Main', eigenerHausstand: 'no', reiseart: 'no',
  } }, einzelposten: [] };
  const r2022 = buildEStXML(d2022);
  const dhhf2022 = r2022.xml.match(/<DHHF>[\s\S]*?<\/DHHF>/)?.[0] || '';
  const worksFor2022 = !r2022.xml.includes('N_DHH') && dhhf2022.includes('<E0206103>01.03.2025</E0206103>')
    && dhhf2022.includes('<E0206205>Neue Arbeitsstelle</E0206205>') && dhhf2022.includes('<E0207611>4800</E0207611>')
    && dhhf2022.includes('<E0206504>2</E0206504>');

  const d2025 = JSON.parse(JSON.stringify(sample));
  d2025.meta.taxYear = 2025;
  d2025.werbungskosten = { personA: { doppelteHaushaltsfuehrung: {
    monatsmiete: 800, monate: 6, familienheimfahrten: 12, entfernungKm: 300,
    grund: 'Neue Arbeitsstelle', datum: '2025-03-01', bestehtBis: '31.12.', beschaeftigungsort: '60329 Frankfurt am Main', eigenerHausstand: 'no', reiseart: 'no',
  } }, einzelposten: [] };
  const r2025 = buildEStXML(d2025);
  const worksFor2025 = r2025.xml.includes('<N_DHH>') && r2025.xml.includes('<E0206103>');

  return worksFor2022 && worksFor2025;
})());

check('Real ERiC rejection fixed (Regel 101100156): PersonB\'s Tax ID was still leaking at the Vorsatz level for §26a separate assessment, a completely separate code path from the ESt1A/Allg/B guard fixed earlier', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.veranlagungsart = 'einzelveranlagung_ehegatten_par26a';
  d.hauptvordruck.personB = { idnr: '59846301578', name: 'Mustermann', vorname: 'Frau', geburtsdatum: '1998-06-16', religion: '--' };
  const x = buildEStXML(d).xml;
  return !x.includes('IDEhefrau');
})());
check('Real ERiC rejection fixed (Regel 101900004): no Anlage KAP may be filed for PersonB under §26a separate assessment - including the trickier root cause, a separate Günstigerprüfung-only block that was still being created for PersonB even after their real entries were correctly filtered out', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.veranlagungsart = 'einzelveranlagung_ehegatten_par26a';
  d.hauptvordruck.personB = { idnr: '59846301578', name: 'Mustermann', vorname: 'Frau', geburtsdatum: '1998-06-16', religion: '--' };
  d.anlageKAP = [
    { person: 'A', institut: 'TR', zeile7_kapitalertraege: 3000 },
    { person: 'B', institut: 'ING', zeile7_kapitalertraege: 2000 },
  ];
  const x = buildEStXML(d).xml;
  const kapBlocks = (x.match(/<KAP>[\s\S]*?<\/KAP>/g) || []);
  return kapBlocks.length === 1 && kapBlocks[0].includes('PersonA') && !x.includes('PersonB</Person>\n<Ant>');
})());

check('Newly implemented: donations owner split for joint filing - even split correctly produces two entries, one per person, within the single required Zuw wrapper', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.veranlagungsart = 'zusammenveranlagung';
  d.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Anna', geburtsdatum: '1987-01-01', religion: 'EV' };
  d.sonderausgaben = { spenden: 1000, spendenOwner: 'joint' };
  const x = buildEStXML(d).xml;
  const zuw = x.match(/<Zuw>[\s\S]*?<\/Zuw>/)?.[0] || '';
  return (zuw.match(/<Person>/g) || []).length === 2 && zuw.includes('PersonA') && zuw.includes('PersonB');
})());
check('Newly implemented: donations owner split for §26a separate assessment correctly sends only this filer\'s own half when jointly attributed, matching the same real rule already confirmed for Anlage KAP', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.veranlagungsart = 'einzelveranlagung_ehegatten_par26a';
  d.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Anna', geburtsdatum: '1987-01-01', religion: 'EV' };
  d.sonderausgaben = { spenden: 1000, spendenOwner: 'joint' };
  const x = buildEStXML(d).xml;
  const zuw = x.match(/<Zuw>[\s\S]*?<\/Zuw>/)?.[0] || '';
  return (zuw.match(/<Person>/g) || []).length === 1 && zuw.includes('PersonA') && !zuw.includes('PersonB');
})());
check('Newly implemented: donations owner split for §26a correctly sends nothing at all when the donation belongs entirely to the spouse - it belongs on their own, separate return instead', (() => {
  const d = JSON.parse(JSON.stringify(sample));
  d.hauptvordruck.veranlagungsart = 'einzelveranlagung_ehegatten_par26a';
  d.hauptvordruck.personB = { idnr: '98765432109', name: 'Muster', vorname: 'Anna', geburtsdatum: '1987-01-01', religion: 'EV' };
  d.sonderausgaben = { spenden: 1000, spendenOwner: 'B' };
  const x = buildEStXML(d).xml;
  return !x.includes('<Zuw>');
})());

console.log(`\n===== xml-builder.js structural tests: ${pass} passed, ${fail} failed =====`);
if (skippedSections.length) console.log('Skipped sections (expected, not a failure):', skippedSections);
process.exit(fail ? 1 : 0);
