/* =============================================================================
   SimplyTax - ERiC field mapping (ESt_2025)
   =============================================================================
   Converts the CONFIRMED sections of docs/eric_phase4_field_mapping_v1.md
   and v2.md into real code. This is the single source of truth used by the
   Phase 5 XML builder to translate a client's SimplyTax data into official
   ELSTER Kennzahlen.

   SCOPE - only sections marked "Fully mapped" in the v2 summary table are
   included here. NOT included yet (still open in the mapping docs, would be
   guessing to code them now): Sonderausgaben donations, childcare amount,
   part of Doppelte Haushaltsführung, Kind kinship-type representation, and
   the exact per-line KAP Kennzahl (KAP is structurally confirmed since our
   fields already use the official line numbers, but not yet verified 1:1).
   Do not extend this file for those sections until the mapping doc is
   updated first - code should never be ahead of a confirmed mapping.

   PROVENANCE - every Kennzahl below comes from the official
   Jahresdokumentation_E10_2025.ods (ERiC-44.2.4.1 documentation package),
   NOT yet confirmed against a real ERiC validate response (blocked on the
   Hersteller-ID). Once that arrives, Phase 5's first test run is what turns
   "very likely correct" into "confirmed" - do not remove this note until
   then.
============================================================================= */

/* ---------- 1. Personal data & marital status (ESt1A context) ---------- */
const ESt1A = {
  taxId: 'E0100081',            // Identifikationsnummer (Steuerpflichtiger)
  taxIdSpouse: 'E0100082',      // Identifikationsnummer (Ehegatte/Lebenspartner)
  birthDate: 'E0100401',        // Geburtsdatum (Steuerpflichtiger)
  spouseBirthDate: 'E0101001',  // Geburtsdatum (Ehegatte/Lebenspartner)
  firstName: 'E0100301',        // Vorname
  street: 'E0101104',           // Straße (derzeitige Adresse)
  plz: 'E0100601',              // Postleitzahl (Inland)

  // marital status - each is a distinct flag/date field, not a single enum Kennzahl
  maritalMarried: 'E0100701',             // "Verheiratet / Lebenspartnerschaft begründet seit dem"
  maritalSeparateAssessment: 'E0102602',  // "Einzelveranlagung von Ehegatten/Lebenspartnern" (our married_sep / §26a)
  maritalWidowed: 'E0100702',             // "Verwitwet seit dem" (drives Witwensplitting eligibility)
  maritalDivorced: 'E0100703',            // "Geschieden / Lebenspartnerschaft aufgehoben seit dem"

  // TODO (open in mapping doc, not yet located): lastName exact Kennzahl,
  // getrennt_lebend's own distinct field (vs. divorced), singleParent flag,
  // religion/Kirchensteuer flags, Steuerklasse-adjacent fields, Bundesland/
  // Finanzamt routing fields.
};

/* ---------- 2. Employment income - Anlage N (our most complete feature) ---------- */
/* RESOLVED (previously flagged as person/employer-slot ambiguity - see
   eric_phase4_field_mapping_v3.md for the full story). The multiple
   Kennzahlen per field were never person-slot variants: they are an
   INDIVIDUAL LINE ITEM (einz, one per employer) vs. a PRE-COMPUTED SUM
   (sum, the total across all employers for one person) pair, confirmed
   directly from the real est_e10_2025.xml example structure:
     <LStB_1_5_Einz>  - repeated once per employer entry
     <LStB_1_5_Sum>   - written ONCE per person, with the totals
   ERiC does NOT sum these itself - the XML builder (Phase 5) must add up
   every employer's value and write both the einz entries AND the sum. */
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
  verpf20:      { line: 20, kennzahlen: ['E0205630'], slotResolved: true },   // foreign Auswärtstätigkeit variant only
  vbJahr30:     { line: 30, kennzahlen: ['E0201307'], slotResolved: true },
  vbMon31First: { line: 31, kennzahlen: ['E0201003'], slotResolved: true },   // "Erster Monat"
  vbMon31Last:  { line: 31, kennzahlen: ['E0201203'], slotResolved: true },   // "Letzter Monat"
  taxClass:     { line: null, kennzahlen: ['E0200002'], slotResolved: true, note: 'CORRECTED: earlier assumed employerCount based on XML context alone (value happened to be "1" in the example); official Felder sheet confirms E0200002 = Steuerklasse' },
  bmg29:        { line: 29, kennzahlen: ['E0200902'], slotResolved: true, note: 'Bemessungsgrundlage für den Versorgungsfreibetrag laut Nr. 29' },
  pausch18:     { line: 18, kennzahlen: ['E0203901'], slotResolved: true, note: 'Arbeitgeberleistungen laut Nr. 18 (pauschal besteuert)' },
  dba16:        { line: 16, kennzahlen: ['E0201502'], slotResolved: true, note: 'Steuerfreier Arbeitslohn nach DBA/sonstigen zwischenstaatlichen Übereinkommen' },
  ml10:         { line: 10, kennzahlen: ['E0201806'], slotResolved: true, note: 'Arbeitslohn für mehrere Jahre, Entschädigungen (z.B. Abfindungen) laut Nr. 10' },

  /* sterbe32: very likely the SAME einz/sum pattern as gross/wageTax/soli
     above (identical description on both numbers, sits in the Versorgungs-
     bezüge sub-block) - but NOT yet confirmed by real XML content the way
     the five fields above were, since the example file's case didn't
     include a Versorgungsbezüge scenario. Do not treat as fully resolved
     until either a real multi-employer test or an ERiC validate response
     confirms which of the two is einz vs sum. */
  sterbe32:     { line: 32, kennzahlen: ['E0201205', 'E0201210'], slotResolved: false,
                  note: 'likely einz/sum pair by pattern, not yet XML-confirmed' },

  /* MAJOR DISCOVERY this session: agRV, agRVb, anRV, anRVb (Bescheinigung
     Zeilen 22a/22b/23a/23b), agKV, agPKV, agPV (24a-c), anKV, anPV, anAV
     (25-27), pkv28 - searched exhaustively in the N - Felder sheet for
     "Rentenversicherung", "Krankenversicherung", "Pflegeversicherung",
     "Arbeitslosenversicherung" - ZERO matches. These values, even though
     the user enters them on the Employment Income wizard step (because
     that's where they appear on the printed Lohnsteuerbescheinigung), are
     NOT separately represented in Anlage N's XML schema. They are reported
     ONLY through the Vorsorgeaufwand context (see VOR above: rv/kv/pv/av).
     Phase 5 implication: the XML builder must route these 11 app fields
     into the VOR Kennzahlen, not look for N-context equivalents that do
     not exist. */

  // CONFIRMED (not a gap): entsch19, kist13, kistSp14, lst11, soli12
  // correspond to Bescheinigung lines 19, 13, 14, 11, 12 - zero matches for
  // "Zeile 11/12/13/14/19" anywhere in the entire N - Felder sheet, which
  // matches the app's own earlier documented understanding that these
  // specific lines are currently unused/blank on the printed Lohnsteuer-
  // bescheinigung. There is correctly nothing to map here - not an open
  // gap, a confirmed non-field. (ml10, Zeile 10, is a real used line and
  // is mapped separately above - not part of this unused group.)

  // still genuinely open despite exhaustive search this session: kfb
  // (Kinderfreibeträge - checked both N and ESt1A contexts, zero matches),
  // fb34 (Versorgungsfreibetrag Zeile 34), dhh21 (steuerfreie AG-Leistungen
  // bei doppelter Haushaltsführung), kug15a ((Saison-)Kurzarbeitergeld
  // sub-line of 15) - none of these appear under any search term tried.
  // Possible explanations: different official wording not yet guessed, or
  // (for kfb specifically) these values may be computed by ERiC/the tax
  // office from other submitted data rather than transmitted directly.
};

/* ---------- 3. Insurance / Vorsorgeaufwand (VOR context) ---------- */
const VOR = {
  rv:        { kennzahlen: ['E2000601'], note: 'Beiträge zu gesetzlichen Rentenversicherungen' },
  rvBerufsstaendisch: { kennzahlen: ['E2000501'], note: 'landwirtschaftliche Alterskasse / berufsständische Versorgung' },
  kv:        { kennzahlen: ['E2001203'], note: 'laut Nr. 25 der Lohnsteuerbescheinigung' },
  kvOther:   { kennzahlen: ['E2001805'], note: 'non-employment variant (Rentner, freiwillig gesetzlich Versicherte)' },
  pv:        { kennzahlen: ['E2001505'], note: 'laut Nr. 26 der Lohnsteuerbescheinigung' },
  pvErstattung: { kennzahlen: ['E2001605'], note: 'von Kranken-/Pflegeversicherung erstattete Beiträge' },
  av:        { kennzahlen: ['E2004403'], note: 'laut Nr. 27 der Lohnsteuerbescheinigung' },

  // OPEN QUESTION (noted in mapping doc, not yet resolved): should VOR
  // auto-populate from Anlage N's anKV/anPV/anAV instead of asking the
  // user twice? This is a product decision as much as a mapping one -
  // do not auto-wire without confirming the intended UX.
};

/* ---------- 4. Sonderausgaben - donations (SA context) ---------- */
/* Category correction from v2: the "SO" context searched earlier is
   actually "Sonstige Einkünfte" (other income - crypto, private sales),
   a completely different form. Donations live under "SA". */
const SA = {
  donationsDomestic: { kennzahlen: ['E0108405'], note: 'Spenden an Empfänger im Inland' },
  donationsEuEwr:     { kennzahlen: ['E0105502'], note: 'Spenden an Empfänger im EU-/EWR-Ausland' },
  donationsBasis:     { kennzahlen: ['E0105902'], note: 'Summe der Umsätze, Löhne und Gehälter - basis for the deduction ceiling calculation' },
  // lower priority for launch, not yet needed: carryforward (E0108509),
  // Vermögensstock/endowment donations (E0108607)
};

/* ---------- 5. Children - kinship type (Kind context) ---------- */
const Kind = {
  kinshipType: { kennzahlen: ['E0500807', 'E0500808'], note: 'Art des Kindschaftsverhältnisses - maps to our leiblich/adoptiert/pflegekind/stiefkind select. Two numbers likely a multi-child repeat pattern, not different kinship types - confirm against Kind - Kennzahlen sheet or a real multi-child example next.' },
  kindergeld:   { kennzahlen: ['E0500702', 'E0503802'], note: 'Anspruch auf Kindergeld / Kindergeld ausgezahlt im Zeitraum' },
  schoolFees:   { kennzahlen: ['E0504505'], note: 'Das von mir übernommene Schulgeld beträgt' },
  // still open (exhausted search, see v3 doc): childcare expense amount -
  // not found anywhere in the workbook, likely a structured block not a
  // simple amount field
};

/* ---------- 6. Doppelte Haushaltsführung addition (N_DHH context) ---------- */
const N_DHH = {
  dhhKm: { kennzahlen: ['E0207116'], note: 'einfache Entfernung in km (ohne Flugstrecken) - single-trip distance for Familienheimfahrten' },
  dhhTrips: { kennzahlen: ['E0207117', 'E0207304'], note: 'Anzahl der Familienheimfahrten (two numbers, identical description - likely a domestic/foreign or Einz/Sum pattern similar to Anlage N, not yet XML-confirmed)' },
  // dhhRent: CORRECTED after verification. v2 doc wrongly attached E0208107
  // (Verpflegungsmehraufwendungen = meal allowance) to this field. The
  // app's own calc (index.html line ~1278: min(dhhRent,1000) * min(dhhMonths,12))
  // confirms dhhRent is the statutory EUR 1,000/month ACCOMMODATION cost cap
  // (Unterkunftskosten, § 9 Abs.1 Satz 3 Nr.5 EStG) - a different concept
  // entirely. The real Unterkunftskosten Kennzahl has NOT been found yet -
  // moved back to genuinely open, not guessed.
  // still open (exhausted or not yet found): dhhRent (Unterkunftskosten),
  // dhhMonths, relocation
};


function isSlotResolved(context, field) {
  const entry = context[field];
  if (!entry) return null;
  return entry.slotResolved !== undefined ? entry.slotResolved : true;
}

/* ---------- helper: list every field still needing resolution before Phase 5 XML generation ---------- */
function unresolvedFields() {
  return Object.entries(N)
    .filter(([, v]) => v.slotResolved === false)
    .map(([k]) => k);
}

/* ---------- 8. Household services / § 35a (HA_35a context) ---------- */
/* Confirmed in v2: § 35a only allows deducting the LABOR portion of an
   invoice (Lohnanteile), not materials - the Kennzahl structure reflects
   this directly. Our app currently collects ex.household and ex.handwerker
   as single total amounts; Phase 5 needs a product decision on whether to
   ask users to split labor from materials, or apply a standard assumption -
   this mapping alone does not resolve that, it only supplies the codes. */
const HA_35a = {
  household:  { kennzahlen: ['E0111214', 'E0111215'], note: 'haushaltsnahe Dienstleistungen - Lohnanteile/Fahrtkosten (deductible portion only)' },
  handwerker: { kennzahlen: ['E0170601'], note: 'Handwerkerleistungen - Rechnungsbeträge (total invoice, labor-only portion uses the same E0111214/215 fields as household)' },
};


/* Our app already names these fields after the official printed-form Zeile
   numbers (k7, k8, k12...), so this mapping is a direct Zeile -> Kennzahl
   lookup, cross-checked against the real KAP - Felder descriptions (some
   sub-line descriptions say "in Zeile 7 enthaltene..." for what prints as
   a DIFFERENT line number - resolved using the standard Anlage KAP form
   structure, not the description text alone). */
const KAP = {
  k7:  { kennzahlen: ['E1900701'], note: 'Zeile 7: Kapitalerträge' },
  k8:  { kennzahlen: ['E1900901'], note: 'Zeile 8: davon Gewinne aus Aktienveräußerungen (in Zeile 7 enthalten)' },
  k12: { kennzahlen: ['E1901301'], note: 'Zeile 12: nicht ausgeglichene Verluste aus Aktienveräußerung' },
  k13: { kennzahlen: ['E1901403'], note: 'Zeile 13: Verluste aus Termingeschäften' },
  k16: { kennzahlen: ['E1901401'], note: 'Zeile 16: in Anspruch genommener Sparer-Pauschbetrag (erklärte Erträge)' },
  sparerUsed: { kennzahlen: ['E1901401'], note: 'same Kennzahl as k16 - app may store this as a derived/duplicate concept, worth de-duplicating in Phase 5' },
  k18: { kennzahlen: ['E1901501'], note: 'Zeile 18: inländische Kapitalerträge' },
  k19: { kennzahlen: ['E1901702'], note: 'Zeile 19: ausländische Kapitalerträge' },
  k20: { kennzahlen: ['E1901701'], note: 'Zeile 20: Gewinne aus Aktienveräußerung (in Zeilen 18/19 enthalten)' },
  k21: { kennzahlen: ['E1901802'], note: 'Zeile 21: Verluste ohne Aktien (in Zeilen 18/19 enthalten)' },
  k22: { kennzahlen: ['E1901903'], note: 'Zeile 22: Verluste aus Aktienveräußerung (in Zeilen 18/19 enthalten)' },
  k23: { kennzahlen: ['E1902001'], note: 'Zeile 23: Zinsen vom Finanzamt für Steuererstattungen' },
  k43: { kennzahlen: ['E1904701'], note: 'Zeile 43: Kapitalertragsteuer' },
  k44: { kennzahlen: ['E1904901'], note: 'Zeile 44: Solidaritätszuschlag' },
  k45: { kennzahlen: ['E1904801'], note: 'Zeile 45: Kirchensteuer zur Kapitalertragsteuer' },
  // 'platform' (broker/Depotbank name) is internal app metadata, not a
  // separate Kennzahl - custodian identity is not reported to ERiC per-field
  // the same way; no code entry needed for it.
};


/* Direct encoding of the Einz/Sum discovery: given our app's emps[] array
   and a field name (e.g. 'gross'), returns { count, total } - the values
   that must go into the corresponding N.<field>.sum Kennzahl. Does NOT
   round to whole numbers unless the field's real Sum example did (gross
   summed to a whole number in the real XML - "67554" vs "67554,76" - this
   needs confirming whether that's intentional rounding or a coincidence in
   the one example we have, before Phase 5 relies on it). */
function sumEmployerField(emps, field) {
  const entry = N[field];
  if (!entry || !entry.einz) return null;
  const values = (emps || []).map(e => parseFloat(String(e[field] || '0').replace(',', '.')) || 0);
  return { count: values.length, total: values.reduce((a, b) => a + b, 0) };
}

/* ---------- helper: which VOR field does this Bescheinigung-line app field route to? ---------- */
/* Encodes the VOR-overlap discovery directly: agRV/anRV -> VOR.rv,
   agKV/agPKV/anKV -> VOR.kv, agPV/anPV -> VOR.pv, anAV -> VOR.av.
   Returns null for fields that don't have a VOR routing (i.e. genuinely
   belong in N or are still unmapped). */
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

module.exports = { ESt1A, N, VOR, SA, Kind, N_DHH, HA_35a, KAP, isSlotResolved, unresolvedFields, sumEmployerField, routeToVOR };
