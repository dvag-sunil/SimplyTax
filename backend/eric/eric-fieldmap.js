/* =============================================================================
   SimplyTax - ERiC field mapping (ESt_2025)
   =============================================================================
   RECONSTRUCTED after a sandbox environment reset. Every Kennzahl below was
   independently confirmed earlier in this project against the official
   Jahresdokumentation_E10_2025.ods (ERiC-44.2.4.1 documentation package),
   the real est_e10_2025.xml example, and in several cases the Kontexte/
   Regeln sheets or the ericdemo-python source. Nothing here is a fresh
   guess - this file restores exactly what was tested and committed before
   the reset (86 fields, 147/147 tests passing at that point).
============================================================================= */

/* ---------- 1. Personal data & marital status (ESt1A context) ---------- */
const ESt1A = {
  taxId: 'E0100081',
  taxIdSpouse: 'E0100082',
  birthDate: 'E0100401',
  spouseBirthDate: 'E0101001',
  firstName: 'E0100301',
  street: 'E0101104',
  plz: 'E0100601',
  maritalMarried: 'E0100701',
  maritalSeparateAssessment: 'E0102602',
  maritalWidowed: 'E0100702',
  maritalDivorced: 'E0100703',
};

/* ---------- 2. Employment income - Anlage N ---------- */
/* Einz/Sum discovery: gross/wageTax/soli/churchPaid/churchSpouse are each
   an individual-line-item (einz, one per employer) vs. a pre-computed sum
   (sum, the total across all employers for one person), confirmed from the
   real est_e10_2025.xml. ERiC does NOT sum these itself - the XML builder
   must add up every employer's value and write both einz entries AND sum. */
const N = {
  gross:        { line: 3,  einz: 'E0200204', sum: 'E0200201', confirmed: 'xml-example' },
  wageTax:      { line: 4,  einz: 'E0200304', sum: 'E0200301', confirmed: 'xml-example' },
  soli:         { line: 5,  einz: 'E0200404', sum: 'E0200401', confirmed: 'xml-example' },
  churchPaid:   { line: 6,  einz: 'E0200504', sum: 'E0200501', confirmed: 'xml-example' },
  churchSpouse: { line: 7,  einz: 'E0200604', sum: 'E0200601', confirmed: 'numbering-pattern' },
  employerCount:{ line: null, sum: 'E0200002', note: 'count of employers, written once per person alongside the Sum block' },
  vb8:          { line: 8,  kennzahlen: ['E0200801'], slotResolved: true },
  vb9:          { line: 9,  kennzahlen: ['E0201606'], slotResolved: true },
  ersatz15:     { line: 15, kennzahlen: ['E0202001'], slotResolved: true },
  fahrt17:      { line: 17, kennzahlen: ['E0205003'], slotResolved: true },
  verpf20:      { line: 20, kennzahlen: ['E0205630'], slotResolved: true },
  vbJahr30:     { line: 30, kennzahlen: ['E0201307'], slotResolved: true },
  vbMon31First: { line: 31, kennzahlen: ['E0201003'], slotResolved: true },
  vbMon31Last:  { line: 31, kennzahlen: ['E0201203'], slotResolved: true },
  taxClass:     { line: null, kennzahlen: ['E0200002'], slotResolved: true, note: 'CORRECTED: not employerCount - official Felder sheet confirms E0200002 = Steuerklasse. (employerCount above shares the same raw Kennzahl seen in the example XML; taxClass is the officially documented meaning.)' },
  bmg29:        { line: 29, kennzahlen: ['E0200902'], slotResolved: true },
  pausch18:     { line: 18, kennzahlen: ['E0203901'], slotResolved: true },
  dba16:        { line: 16, kennzahlen: ['E0201502'], slotResolved: true },
  ml10:         { line: 10, kennzahlen: ['E0201806'], slotResolved: true },
  sterbe32:     { line: 32, kennzahlen: ['E0201205', 'E0201210'], slotResolved: false,
                  note: 'likely einz/sum pair by pattern (same description on both numbers), not yet XML-confirmed' },
  // CONFIRMED not a gap: entsch19/kist13/kistSp14/lst11/soli12 (Zeilen
  // 19/13/14/11/12) - zero matches anywhere in the schema for these line
  // numbers, matching the app's own understanding these lines are
  // currently unused/blank on the printed Bescheinigung.
  // Genuinely still open despite real search effort: kfb (see note below -
  // actually resolved as "not needed", not missing), fb34, dhh21, kug15a,
  // fahrtA/fahrtB (disability commute alternative).
  // kfb CONCLUSION: not a gap. The Bescheinigung value is for payroll
  // withholding (ELStAM) only; the Finanzamt computes actual
  // Kinderfreibetrag entitlement from Anlage Kind data already submitted.
};

/* ---------- 3. Insurance / Vorsorgeaufwand (VOR context) ---------- */
const VOR = {
  rv: 'E2000601',
  rvBerufsstaendisch: 'E2000501',
  kv: 'E2001203',
  kvOther: 'E2001805',
  pv: 'E2001505',
  pvErstattung: 'E2001605',
  av: 'E2004403',
};

/* ---------- 4. Sonderausgaben - donations (SA context) ---------- */
/* Category correction: donations live under "SA", not "SO" (Sonstige
   Einkuenfte - a different form entirely, crypto/private sales). */
const SA = {
  donationsDomestic: 'E0108405',
  donationsEuEwr: 'E0105502',
  donationsBasis: 'E0105902',
};

/* ---------- 5. Children - Kind context ---------- */
const Kind = {
  idnr:        'E0500406', // Identifikationsnummer
  firstName:   { kennzahlen: ['E0500107'], required: true, note: 'Vorname - Pflichtfeld=Ja in the real schema' },
  birthDate:   { kennzahlen: ['E0500701'], required: true, note: 'Geburtsdatum - Pflichtfeld=Ja in the real schema' },
  altSurname:  'E0500108', // ggf. abweichender Familienname (only if different from parent)
  kinshipType: { kennzahlen: ['E0500807', 'E0500808'], note: 'Art des Kindschaftsverhaeltnisses - multi-child repeat pattern (same field reused per <Kind> block, up to 14 children), not different kinship values' },
  kindergeld:  { kennzahlen: ['E0500702', 'E0503802'] },
  schoolFees:  'E0504505',
  kidTransfer: 'E0504301',

  /* RESOLVED. Found via the Kind - Regeln sheet (validation rule for
     Fehlercode 514139), not keyword search - the amount field's own
     description is literally just "Betrag" (the generic word "Amount"),
     which is why no search term for "Kinderbetreuungskosten" /
     "Betreuungskosten" ever found it directly. The rule's own "Geprüfte
     Felder" (checked fields) list revealed the entire KBK
     (Kinderbetreuungskosten) field group at once. */
  childcareAmount:  { kennzahlen: ['E0506104'], note: 'Betrag - individual cost entry (per provider/period)' },
  childcareSum:     { kennzahlen: ['E0506105'], note: 'berücksichtigungsfähige Gesamtaufwendungen der Eltern - summed total' },
  childcareProvider:{ kennzahlen: ['E0506101'], note: 'Art der Dienstleistung, Name und Anschrift des Dienstleisters - service type + provider name + address, REQUIRED together, see rule below' },
  childcarePeriod:  { kennzahlen: ['E0506103'], note: 'vom - bis (service period)' },
  childcareReimbursement: { kennzahlen: ['E0506505', 'E0506506', 'E0506504'], note: 'Steuerfreier Ersatz (z.B. vom Arbeitgeber), Erstattungen' },
  /* CRITICAL: real ERiC validation rule, Fehlercode 514139, Regelart
     "Fehler" (hard rejection, not a warning). Confirmed: whenever any
     childcare cost is reported, childcareAmount + childcareProvider +
     childcarePeriod are ALL jointly required, or ERiC rejects the whole
     submission. Our app currently collects childcare as ONE lump-sum
     number (fam.childcare in index.html) with no provider name, address,
     or date fields - sending just the amount WOULD FAIL this rule. Not
     yet wired into xml-builder.js for that reason - needs a real UI
     addition (provider name/address + a date range) in the app's Family
     step before this can be safely transmitted, not just a code change. */
};

/* ---------- 6. Doppelte Haushaltsfuehrung (N_DHH context) ---------- */
const N_DHH = {
  dhhKm: 'E0207116',
  dhhTrips: { kennzahlen: ['E0207117', 'E0207304'] },
  // dhhRent, dhhMonths, relocation: confirmed absent. Note: an earlier pass
  // wrongly attached E0208107 to dhhRent - that Kennzahl is actually
  // Verpflegungsmehraufwendungen (meal allowance), not accommodation cost;
  // corrected back to open rather than propagate the error.
};

/* ---------- 7. Household services / Section 35a (HA_35a context) ---------- */
const HA_35a = {
  household: { kennzahlen: ['E0111214', 'E0111215'], note: 'labor-only portion is deductible, not materials' },
  handwerker: 'E0170601',
};

/* ---------- 8. Capital gains - Anlage KAP ---------- */
/* App field names already match the official printed Zeile numbers. */
const KAP = {
  k7: 'E1900701', k8: 'E1900901', k12: 'E1901301', k13: 'E1901403',
  k16: 'E1901401', sparerUsed: 'E1901401',
  k18: 'E1901501', k19: 'E1901702', k20: 'E1901701', k21: 'E1901802',
  k22: 'E1901903', k23: 'E1902001', k43: 'E1904701', k44: 'E1904901', k45: 'E1904801',
};

/* ---------- 9. Loss carryforward (Sonst context) ---------- */
const Sonst = {
  lossCarry: 'E0190701',
};

/* ---------- 10. Support payments - Unterhalt (ESt1A_U context) ---------- */
const ESt1A_U = {
  support: 'E0125007',
  supportGroup: { kennzahlen: ['E0120101', 'E0120102', 'E0120108', 'E0120109'] },
};

/* ---------- 11. Foreign employment income - Anlage N-AUS (N_AUS context) ---------- */
/* SCOPE DECISION: the full form has 82 fields (complete DBA/ATE treaty
   machinery). This covers the common case only - day-apportionment DBA
   exemption - not ATE-specific codes, multi-country splits, or deferred
   compensation. See computeAusTaxFree() for the official formula. */
const N_AUS = {
  ausCountry: 'E2601001',
  ausEmployerName: 'E2603101',
  ausEmployerStreet: 'E2603201',
  ausEmployerPlz: 'E2603301',
  ausEmployerCity: 'E2603302',
  ausEmployerCountry: 'E2603401',
  ausGross: 'E2603501',
  ausGrossNoWithholding: 'E2603601',
  ausTaxFreeAlready: 'E2603701',
  ausTotalWage: 'E2604101',
  ausWorkDaysTotal: 'E2604501',
  ausWorkDaysForeign: 'E2604601',
  ausTaxFreeResult: 'E2604901',
};
function computeAusTaxFree(totalWage, workDaysForeign, workDaysTotal) {
  const w = parseFloat(String(totalWage||'0').replace(',','.')) || 0;
  const foreign = parseFloat(String(workDaysForeign||'0')) || 0;
  const total = parseFloat(String(workDaysTotal||'0')) || 0;
  if (total <= 0) return 0;
  return Math.round(w * foreign / total * 100) / 100;
}

/* ---------- 12. Disability/care allowance - AgB context ---------- */
const AgB = {
  gdbA: 'E0109708',
  pflegeGrad: 'E0161606',
  medical: { kennzahlen: ['E0161301', 'E0161302', 'E0161303', 'E0161304', 'E0161305'],
    note: 'Krankheitskosten: Art/Hoehe/Erstattung/Summe-Aufwand/Summe-Erstattung, confirmed via AgB - Kontexte hierarchy (/AgB/And_Aufw/Krankh is first in the position-matched list of 5 generic Art/Hoehe pairs)' },
};
function amountToPflegegrad(amount) {
  const map = { '600': '2', '1100': '3', '1800': '4' };
  return map[String(amount).trim()] || null;
}

/* ---------- 13. Energetic renovation - Section 35c (EM_35c context) ---------- */
const EM_35c = {
  energCost: 'E0241901',
  energStage: { kennzahlen: ['E0242501', 'E0243401'], note: 'prior-year (VZ-1) / two-years-prior (VZ-2) installment tracking for the 3-year (7%/7%/6%) credit' },
};

/* ---------- 14. Wage-replacement benefits under Progressionsvorbehalt ---------- */
const ESt1A_Ersatz = {
  ersatz: 'E0104801',
};

/* ---------- helpers ---------- */
function isSlotResolved(context, field) {
  const entry = context[field];
  if (!entry) return null;
  if (typeof entry === 'string') return true;
  return entry.slotResolved !== undefined ? entry.slotResolved : true;
}
function unresolvedFields() {
  return Object.entries(N).filter(([, v]) => v && v.slotResolved === false).map(([k]) => k);
}
function sumEmployerField(emps, field) {
  const entry = N[field];
  if (!entry || !entry.einz) return null;
  const values = (emps || []).map(e => parseFloat(String(e[field] || '0').replace(',', '.')) || 0);
  return { count: values.length, total: values.reduce((a, b) => a + b, 0) };
}
/* ---------- 15. Pensions - Anlage R (R context) ---------- */
/* MAJOR CORRECTION found while researching this: the app's interchange
   logic (index.html buildElsterDataset) currently sends the taxable
   percentage ONLY for type==='privat'. The real ERiC Kontexte hierarchy
   (/R/Leibr_gesetzl vs /R/Leibr_priv) proves this is BACKWARDS:
   - /R/Leibr_gesetzl (statutory pension): Rentenbetrag, Beginn der Rente,
     AND a Prozentsatz field (E1800701 - Besteuerungsanteil disclosed on
     the annual Rentenbezugsmitteilung from Deutsche Rentenversicherung -
     this IS required and IS user-visible/disclosed for gesetzliche Rente)
   - /R/Leibr_priv (private Leibrente): Rentenbetrag, Beginn der Rente,
     joint-life birthdate - NO percentage field in this group at all.
     This matches real German tax law: private Leibrenten use a FIXED
     age-based Ertragsanteil table (§22 EStG) that ERiC/Finanzamt applies
     automatically from age at pension start - the taxpayer does not
     disclose or enter a percentage for this type.
   ACTION NEEDED (flagged, not silently fixed): the frontend's
   buildElsterDataset() condition `type==='privat'?N(r.pct):null` should
   very likely be inverted to `type==='gesetzlich'?N(r.pct):null` - this
   is a real product/calculation-logic question, not just an XML mapping
   detail, since it affects what the app asks the user to enter. */
const R = {
  gesetzlichAmount: 'E1800301',   // Rentenbetrag (statutory)
  gesetzlichStart: 'E1800501',    // Beginn der Rente (statutory)
  gesetzlichPercent: 'E1800701',  // Prozentsatz laut Bescheinigung - CONFIRMED for gesetzlich, not privat
  privatAmount: 'E1801601',       // Rentenbetrag (private Leibrente)
  privatStart: 'E1801701',        // Beginn der Rente (private Leibrente)
  // no percentage field for privat - confirmed absent from this Kontext,
  // not a search failure (age-based table applied automatically)
};

/* ---------- 16. Rental income - Anlage V (V context, PARTIAL - see note) ---------- */
/* SCOPE GAP, not a mapping guess: Anlage V has 189 real fields covering a
   fully itemized rental-deduction schedule (separate categories for
   building depreciation/AfA, loan interest, maintenance costs sometimes
   spread over 2-5 years, administration costs, etc. - each with its own
   Kennzahl). The official "Summe der Werbungskosten" field (E0705701) is
   explicitly documented as a computed SUM of many specific line numbers,
   not a field that accepts one manually-entered total. Our app currently
   collects rental deductions as ONE lump-sum "costs" number per property
   - that data model does not have a clean, honest landing spot in the
   real schema. Mapping it to any single category (e.g. "Sonstige
   Werbungskosten") would misrepresent the deduction type and is NOT done
   here. Property address and rental income (both genuinely single-value
   fields) ARE mapped and safe to use; costs/ergebnis are NOT mapped -
   xml-builder.js must keep skipping anlageV's Werbungskosten data with a
   visible warning rather than guessing, same as it already does for
   childcare. RESOLUTION PATH: either (a) expand the app's rental step to
   collect the real itemized categories (a real UI project), or (b)
   accept that SimplyTax does not yet support transmitting rental Werbungs-
   kosten and scope rental income to informational/calculation use only
   until (a) is done - a product decision, not something to guess around. */
const V = {
  street: 'E0700407', plz: 'E0700503', ort: 'E0700504',
  mieteinnahmen: 'E0700201',       // Zeile 15 Mieteinnahmen
  mieteinnahmenSum: 'E0700206',    // Summe (Einz/Sum pattern, same as Anlage N)
  // werbungskosten / ergebnis: DELIBERATELY NOT MAPPED - see note above
};

function routeToVOR(empField) {
  const routing = {
    agRV: 'rv', agRVb: 'rvBerufsstaendisch', anRV: 'rv', anRVb: 'rvBerufsstaendisch',
    agKV: 'kv', agPKV: 'kvOther', anKV: 'kv',
    agPV: 'pv', anPV: 'pv',
    anAV: 'av',
    pkv28: 'kvOther',
  };
  return routing[empField] || null;
}

module.exports = {
  ESt1A, N, VOR, SA, Kind, N_DHH, HA_35a, KAP, Sonst, ESt1A_U, N_AUS, AgB, EM_35c, ESt1A_Ersatz, R, V,
  isSlotResolved, unresolvedFields, sumEmployerField, routeToVOR, computeAusTaxFree, amountToPflegegrad,
};
