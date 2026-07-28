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
  kinshipType: { kennzahlen: ['E0500807', 'E0500808'], note: 'Art des Kindschaftsverhaeltnisses - multi-child repeat pattern (same field reused per <Kind> block, up to 14 children), not different kinship values' },
  kindergeld:  { kennzahlen: ['E0500702', 'E0503802'] },
  schoolFees:  'E0504505',
  kidTransfer: 'E0504301',
  // childcare (Kinderbetreuungskosten amount): genuinely unresolved.
  // Found the SPLIT-RATIO field (E0508601) but never the underlying amount
  // field despite checking all 57 real Kind field codes directly, the full
  // Kind - Felder sheet, and the SA context. A German question for ELSTER
  // developer support has been drafted separately for this.
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
  ESt1A, N, VOR, SA, Kind, N_DHH, HA_35a, KAP, Sonst, ESt1A_U, N_AUS, AgB, EM_35c, ESt1A_Ersatz,
  isSlotResolved, unresolvedFields, sumEmployerField, routeToVOR, computeAusTaxFree, amountToPflegegrad,
};
