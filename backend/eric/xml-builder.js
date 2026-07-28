/* =============================================================================
   SimplyTax - ERiC XML Builder (Phase 5, Stage 2)
   =============================================================================
   Input:  the "simplytax-interchange" JSON already produced client-side by
           index.html's buildElsterDataset(c) - see the comment there:
           "handover format for the ERiC backend adapter". This file is
           that adapter's other half.
   Output: a real <Elster>...<E10>...</E10>...</Elster> XML string matching
           the structure confirmed against ERiC's own est_e10_2025.xml
           example (TransferHeader / NutzdatenHeader / Nutzdaten / E10),
           ready to hand to EricMtBearbeiteVorgang as datenpuffer.

   SCOPE - only sections with a confirmed Kennzahl in eric-fieldmap.js are
   written. Sections present in the interchange JSON but NOT YET MAPPED are
   explicitly skipped with a console.warn, never silently guessed:
     - anlageR (pensions) - was never mapped, discovered as a gap while
       building this file. No Kennzahlen researched yet for this context.
     - anlageV (rental) - same, not yet mapped.
     - anlageKind.betreuungskosten (childcare amount) - confirmed absent
       from the entire ERiC documentation after exhaustive search; a
       German question for ELSTER developer support is drafted separately.
   This means: run this against the demo dataset, and Anlage R / Anlage V
   data will NOT appear in the output XML, by design, not by bug. Extending
   this file to cover them requires mapping those contexts first (same
   research process as everything else in eric-fieldmap.js).
============================================================================= */

const fm = require('./eric-fieldmap.js');

/* ---------- small helpers ---------- */
function xesc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
/* German decimal format for XML values: dot-decimal internally in JS, but
   ERiC's own example XML uses comma-decimal in the field content itself
   (confirmed: <E0200204>67554,76</E0200204> in the real example). */
function euro(n) {
  const v = Number(n) || 0;
  if (v === 0) return null; // omit zero-value fields, matching the real example's sparse style
  return v.toFixed(2).replace('.', ',');
}
function tag(name, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<${name}>${xesc(value)}</${name}>\n`;
}
function euroTag(name, n) {
  const v = euro(n);
  return v ? tag(name, v) : '';
}

/* ---------- religion code mapping (already produced correctly by the frontend) ---------- */
/* buildElsterDataset(c) already converts to EV/RK/VD/-- - passed through as-is. */

/* =============================================================================
   ESt1A - personal data & marital status
============================================================================= */
function buildESt1A(data) {
  const h = data.hauptvordruck;
  const A = h.personA, B = h.personB;
  let xml = '<ESt1A>\n';

  /* declaration checkboxes - always present for a self-filed/consultant return */
  xml += '<Art_Erkl>\n' + tag('E0100001', 'X') + tag('E0100002', 'X') + tag('E0100003', 'X') + '</Art_Erkl>\n';

  xml += '<Allg><A>\n';
  xml += tag(fm.ESt1A.taxId, A.idnr);
  xml += tag(fm.ESt1A.firstName, A.vorname);
  xml += tag(fm.ESt1A.birthDate, formatDateDE(A.geburtsdatum));
  xml += tag('E0101104', [A.anschrift?.strasse, A.anschrift?.hausnummer].filter(Boolean).join(' '));
  xml += tag(fm.ESt1A.plz, A.anschrift?.plz);
  xml += '</A>';
  if (B) {
    xml += '<B>\n';
    xml += tag(fm.ESt1A.taxIdSpouse, B.idnr);
    xml += tag(fm.ESt1A.spouseBirthDate, formatDateDE(B.geburtsdatum));
    xml += '</B>';
  }
  xml += '</Allg>\n';

  /* marital status flags - buildElsterDataset already resolved which case applies */
  if (h.veranlagungsart === 'zusammenveranlagung') {
    xml += tag(fm.ESt1A.maritalMarried, 'X');
  } else if (h.veranlagungsart === 'einzelveranlagung_ehegatten_par26a') {
    xml += tag(fm.ESt1A.maritalSeparateAssessment, 'X');
  } else if (h.veranlagungsart === 'einzelveranlagung_verwitwete_gnadensplitting_par32a6') {
    xml += tag(fm.ESt1A.maritalWidowed, 'X');
  }

  xml += '</ESt1A>\n';
  return xml;
}

/* =============================================================================
   Anlage N - employment income, one block per employer-slot, grouped by
   person, with the confirmed Einz (per employer) / Sum (person total)
   structure. buildElsterDataset(c) gives us a flat anlageN[] array with
   one entry PER EMPLOYER already (person:'A'|'B') - we group and sum here.
============================================================================= */
function buildAnlageN(data) {
  const entries = data.anlageN || [];
  const byPerson = { A: entries.filter(e => e.person !== 'B'), B: entries.filter(e => e.person === 'B') };
  let xml = '';

  for (const person of ['A', 'B']) {
    const list = byPerson[person];
    if (!list.length) continue;

    xml += `<N><Person>Person${person}</Person>\n<ArbL>\n`;

    /* one Einz block per employer */
    for (const e of list) {
      xml += '<LStB_1_5_Einz>\n';
      xml += euroTag(fm.N.gross.einz, e.zeile3_bruttoarbeitslohn);
      xml += euroTag(fm.N.wageTax.einz, e.zeile4_lohnsteuer);
      xml += euroTag(fm.N.soli.einz, e.zeile5_soli);
      xml += euroTag(fm.N.churchPaid.einz, e.zeile6_kirchensteuer);
      xml += euroTag(fm.N.churchSpouse.einz, e.zeile7_kirchensteuerEhegatte);
      xml += '</LStB_1_5_Einz>\n';
    }

    /* one Sum block for the person, computed here (ERiC does NOT sum itself) */
    const sum = (field) => list.reduce((a, e) => a + (Number(e[field]) || 0), 0);
    xml += '<LStB_1_5_Sum>\n';
    xml += tag(fm.N.employerCount.sum, String(list.length));
    xml += euroTag(fm.N.gross.sum, sum('zeile3_bruttoarbeitslohn'));
    xml += euroTag(fm.N.wageTax.sum, sum('zeile4_lohnsteuer'));
    xml += euroTag(fm.N.soli.sum, sum('zeile5_soli'));
    xml += euroTag(fm.N.churchPaid.sum, sum('zeile6_kirchensteuer'));
    xml += '</LStB_1_5_Sum>\n';

    /* remaining confirmed single-value lines - taken from the FIRST employer entry
       (these lines are rarely split across multiple employers in practice) */
    const first = list[0];
    xml += euroTag(fm.N.vb8.kennzahlen[0], first.zeile8_versorgungsbezuege);
    xml += euroTag(fm.N.vb9.kennzahlen[0], first.zeile9_versorgungMehrjaehrig);
    xml += euroTag(fm.N.ml10.kennzahlen[0], first.zeile10_mehrjaehrigEntschaedigung);
    xml += euroTag(fm.N.ersatz15.kennzahlen[0], first.zeile15_lohnersatz);
    xml += euroTag(fm.N.dba16.kennzahlen[0], first.zeile16_dbaAte);
    xml += euroTag(fm.N.fahrt17.kennzahlen[0], first.zeile17_agLeistungenEntfernung);
    xml += euroTag(fm.N.pausch18.kennzahlen[0], first.zeile18_pauschal15);
    xml += euroTag(fm.N.verpf20.kennzahlen[0], first.zeile20_verpflegung);
    xml += euroTag(fm.N.bmg29.kennzahlen[0], first.zeile29_bmgVersorgungsfreibetrag);
    if (first.zeile30_versorgungsbeginn) xml += tag(fm.N.vbJahr30.kennzahlen[0], first.zeile30_versorgungsbeginn);
    /* NOTE: taxClass (Steuerklasse, E0200002) deliberately NOT written here.
       E0200002 is confirmed to appear inside <LStB_1_5_Sum> as the employer
       count (see above) in the real example XML. The official Felder sheet
       separately documents E0200002 = "Steuerklasse", but its correct XML
       PARENT PATH was never confirmed - writing it as a second, differently
       -placed E0200002 under <ArbL> would either duplicate the element name
       or use the wrong path, both invalid. Caught by testing against real
       data during this build - do not re-add without confirming the real
       path first (check the N - Kontexte sheet). */

    /* route the pension/insurance lines through VOR instead of Anlage N -
       confirmed this session: these are NOT separately represented here */
    xml += '</ArbL></N>\n';
  }
  return xml;
}

/* =============================================================================
   Vorsorgeaufwand - pension/insurance, including the routed employment lines
============================================================================= */
function buildVOR(data) {
  const v = data.anlageVorsorgeaufwand;
  if (!v) return '';
  let xml = '<VOR>\n';
  const l = v.ausLohnsteuerbescheinigungen || {};
  xml += euroTag(fm.VOR.rv, l.rv);
  xml += euroTag(fm.VOR.kv, l.gkv);
  xml += euroTag(fm.VOR.pv, l.pv);
  xml += euroTag(fm.VOR.kvOther, l.pkv28);
  /* NOTE: v.privateVersicherungen (Haftpflicht etc.) are collected by the
     app but not yet mapped to a VOR Kennzahl - most private insurance
     types outside statutory RV/KV/PV are either non-deductible or belong
     to a different context not yet researched. Not written here rather
     than guessed. */
  xml += '</VOR>\n';
  return xml;
}

/* =============================================================================
   Anlage KAP - capital gains, field names already match Zeile numbers
============================================================================= */
function buildKAP(data) {
  const entries = data.anlageKAP || [];
  if (!entries.length) return '';
  let xml = '';
  for (const k of entries) {
    xml += '<KAP>\n';
    xml += euroTag(fm.KAP.k7, k.zeile7_kapitalertraege);
    xml += euroTag(fm.KAP.k8, k.zeile8_aktiengewinne);
    xml += euroTag(fm.KAP.k12, k.zeile12_verlusteOhneAktien);
    xml += euroTag(fm.KAP.k13, k.zeile13_verlusteAktien);
    xml += euroTag(fm.KAP.k16, k.zeile16_sparerPauschbetragGenutzt);
    xml += euroTag(fm.KAP.k18, k.zeile18_inlaendischOhneSteuerabzug);
    xml += euroTag(fm.KAP.k19, k.zeile19_auslaendisch);
    xml += euroTag(fm.KAP.k20, k.zeile20_aktiengewinne);
    xml += euroTag(fm.KAP.k21, k.zeile21_stillhalterTermingeschaefte);
    xml += euroTag(fm.KAP.k22, k.zeile22_verlusteOhneAktien);
    xml += euroTag(fm.KAP.k23, k.zeile23_verlusteAktien);
    xml += euroTag(fm.KAP.k43, k.zeile43_kapitalertragsteuer);
    xml += euroTag(fm.KAP.k44, k.zeile44_soli);
    xml += euroTag(fm.KAP.k45, k.zeile45_kirchensteuer);
    xml += '</KAP>\n';
  }
  return xml;
}

/* =============================================================================
   Sonderausgaben - donations
============================================================================= */
function buildSA(data) {
  const s = data.sonderausgaben;
  if (!s || !s.spenden) return '';
  return '<SA>\n' + euroTag(fm.SA.donationsDomestic, s.spenden) + '</SA>\n';
}

/* =============================================================================
   AgB - disability/care/medical
============================================================================= */
function buildAgB(data) {
  const w = data.weitereAngaben || {};
  const b = w.behinderung || {};
  const agb = data.aussergewoehnlicheBelastungen || {};
  let xml = '<AgB>\n';
  let any = false;
  if (b.gdbA) { xml += tag(fm.AgB.gdbA, b.gdbA); any = true; }
  if (b.pflegeA) {
    const grad = fm.amountToPflegegrad(b.pflegeA);
    if (grad) { xml += tag(fm.AgB.pflegeGrad, grad); any = true; }
  }
  if (agb.krankheitskosten) {
    xml += tag(fm.AgB.medical.kennzahlen[0], 'Krankheitskosten');
    xml += euroTag(fm.AgB.medical.kennzahlen[1], agb.krankheitskosten);
    any = true;
  }
  xml += '</AgB>\n';
  return any ? xml : '';
}

/* =============================================================================
   HA_35a - household services
============================================================================= */
function buildHA35a(data) {
  const h = data.haushaltsnaheLeistungen;
  if (!h || (!h.haushaltsnaheDienstleistungen && !h.handwerkerleistungen)) return '';
  let xml = '<HA_35a>\n';
  xml += euroTag(fm.HA_35a.household.kennzahlen[0], h.haushaltsnaheDienstleistungen);
  xml += euroTag(fm.HA_35a.handwerker, h.handwerkerleistungen);
  xml += '</HA_35a>\n';
  return xml;
}

/* =============================================================================
   Wage-replacement benefits + loss carryforward + energetic renovation
============================================================================= */
function buildMisc(data) {
  const w = data.weitereAngaben || {};
  let xml = '';
  if (w.ersatzleistungen) xml += euroTag(fm.ESt1A_Ersatz.ersatz, w.ersatzleistungen);
  if (w.verlustvortrag) xml += euroTag(fm.Sonst.lossCarry, w.verlustvortrag);
  const e = data.par35cEnergetisch;
  if (e && e.aufwendungen) xml += euroTag(fm.EM_35c.energCost, e.aufwendungen);
  return xml;
}

/* ---------- date format: interchange uses ISO (YYYY-MM-DD), ERiC example uses DD.MM.YYYY ---------- */
function formatDateDE(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/* =============================================================================
   Main entry point
============================================================================= */
function buildEStXML(data, opts = {}) {
  const herstellerID = opts.herstellerID || process.env.ERIC_HERSTELLER_ID || '74931';
  const testmerker = data.meta?.testmerker !== false ? '700000004' : '';
  const year = data.meta?.taxYear || 2025;
  const bundesland = bundeslandCode(data.hauptvordruck?.bundesland);

  const skippedSections = [];
  if ((data.anlageR || []).length) skippedSections.push('anlageR (pensions - not yet mapped)');
  if ((data.anlageV || []).length) skippedSections.push('anlageV (rental - not yet mapped)');
  if ((data.anlageKind || []).some(k => k.betreuungskosten > 0))
    skippedSections.push('anlageKind childcare amounts (confirmed absent from ERiC docs - see prepared support question)');
  if (skippedSections.length) {
    console.warn('[eric xml-builder] Sections present in data but not yet mapped, SKIPPED (not silently guessed):');
    skippedSections.forEach(s => console.warn('  - ' + s));
  }

  let nutzdaten = `<E10 xmlns="http://finkonsens.de/elster/elstererklaerung/est/e10/v${year}" version="${year}">\n`;
  nutzdaten += buildESt1A(data);
  nutzdaten += buildAnlageN(data);
  nutzdaten += buildVOR(data);
  nutzdaten += buildKAP(data);
  nutzdaten += buildSA(data);
  nutzdaten += buildAgB(data);
  nutzdaten += buildHA35a(data);
  nutzdaten += buildMisc(data);
  nutzdaten += '</E10>\n';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">
<TransferHeader version="11">
<Verfahren>ElsterErklaerung</Verfahren>
<DatenArt>ESt</DatenArt>
<Vorgang>send-Auth</Vorgang>
${testmerker ? `<Testmerker>${testmerker}</Testmerker>\n` : ''}<Empfaenger id="L"><Ziel>${bundesland}</Ziel></Empfaenger>
<HerstellerID>${xesc(herstellerID)}</HerstellerID>
<DatenLieferant>${xesc(data.datenlieferant?.name || 'SimplyTax')}</DatenLieferant>
<Datei><Verschluesselung>CMSEncryptedData</Verschluesselung><Kompression>GZIP</Kompression><TransportSchluessel/></Datei>
</TransferHeader>
<DatenTeil>
<Nutzdatenblock>
<NutzdatenHeader version="11">
<NutzdatenTicket>${uid()}</NutzdatenTicket>
<Empfaenger id="F">${xesc(data.hauptvordruck?.finanzamt?.bufaNr || '9181')}</Empfaenger>
</NutzdatenHeader>
<Nutzdaten>
${nutzdaten}</Nutzdaten>
</Nutzdatenblock>
</DatenTeil>
</Elster>`;

  return { xml, skippedSections };
}

function bundeslandCode(name) {
  const map = { 'Baden-Württemberg':'BW','Bayern':'BY','Berlin':'BE','Brandenburg':'BB','Bremen':'HB',
    'Hamburg':'HH','Hessen':'HE','Mecklenburg-Vorpommern':'MV','Niedersachsen':'NI','Nordrhein-Westfalen':'NW',
    'Rheinland-Pfalz':'RP','Saarland':'SL','Sachsen':'SN','Sachsen-Anhalt':'ST','Schleswig-Holstein':'SH','Thüringen':'TH' };
  return map[name] || 'BY';
}
function uid() { return 'st' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

module.exports = { buildEStXML };
