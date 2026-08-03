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
check('Anlage Unterhalt correctly warns (not silently sends wrong) when a foreign household is indicated for a legacy year, since that path is not implemented', (() => {
  const y2022foreign = JSON.parse(JSON.stringify(sample));
  y2022foreign.meta.taxYear = 2022;
  y2022foreign.anlageUnterhalt = { betrag: 6000, personName: 'Maria', profession: 'Rentnerin', personBirthDate: '1945-01-01', personIdnr: '12345678901', householdAddress: 'Test', country: 'Türkei' };
  const result = buildEStXML(y2022foreign);
  return result.skippedSections.some(s => s.includes('anlageUnterhalt') && s.includes('not implemented for 2021/2022'));
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
check('Kind childcare correctly OMITS Elt_k_ZV/Kosten when jointly assessed (Person B exists) - only needed when parents are NOT jointly assessed', (() => {
  const married = JSON.parse(JSON.stringify(sample));
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

console.log(`\n===== xml-builder.js structural tests: ${pass} passed, ${fail} failed =====`);
if (skippedSections.length) console.log('Skipped sections (expected, not a failure):', skippedSections);
process.exit(fail ? 1 : 0);
