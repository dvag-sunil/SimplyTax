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
  spouseLastName: 'E0100901', // confirmed via the real official ELSTER example (est_e10_2025.xml) - was collected by the frontend but never wired into the XML
  spouseFirstName: 'E0100801',
  /* Real, confirmed bug found via direct user feedback - a genuine real
     ERiC rejection during joint assessment (Regel 40/41): the spouse's
     first name, birth date, and religion must all be sent together, but
     religion was completely missing from this block. Confirmed same
     enum type as the filer's own religion field. */
  spouseReligion: 'E0101002',
  lastName: 'E0100201',
  firstName: 'E0100301',
  street: 'E0101104',
  plz: 'E0100601',
  ort: 'E0100602',
  religion: 'E0100402',
  maritalMarried: 'E0100701',
  maritalSeparateAssessment: 'E0102602',
  /* Real, confirmed requirement found via a real ERiC rejection
     (Regel 101100199) - whenever a Veranlagungsart is explicitly
     selected (joint or §26a separate), the marriage/partnership date
     must also be declared. Traced to its actual location within A
     itself (the filer's own block) after two rounds of extraction
     truncation - not within Vlg_Art as the error's field path first
     suggested. Confirmed identical across all five years. */
  marriageDate: 'E0100701',
  maritalWidowed: 'E0100702',
  maritalDivorced: 'E0100703',
  // Allg/BV (Bankverbindung) - confirmed via real ERiC validation
  // ("Bitte geben Sie Ihre Bankverbindungsdaten an...") that this is a
  // real required-or-declare-none field, not optional to skip silently.
  ibanDomestic: 'E0102102',
  noBankAccount: 'E0102002', // declare explicitly if genuinely no IBAN
  accountHolderIsTaxpayer: 'E0101601', // Kto_Inh marker - confirms whose account it is
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
  verpf20:      { line: 20, kennzahlen: ['E0205630'], slotResolved: false, note: 'MISMAPPED - do not use. E0205630 is Wk/VMA/Ausl/Sum (sum of CLAIMED foreign-travel meal expenses, a Werbungskosten figure), NOT the tax-free employer reimbursement from Lohnsteuerbescheinigung Zeile 20 that the app collects. Confirmed via real ERiC validation (feldUnbekannt) against a genuine client file. Correct home would be E0205108 (Wk/VMA/VMA_Ersatz), but it requires the accompanying travel-expense claim the app does not collect - so this value is deliberately not transmitted, and is reported via skippedSections instead.' },
  vbJahr30:     { line: 30, kennzahlen: ['E0201307'], slotResolved: true },
  vbMon31First: { line: 31, kennzahlen: ['E0201003'], slotResolved: true },
  vbMon31Last:  { line: 31, kennzahlen: ['E0201203'], slotResolved: true },
  taxClass:     { line: null, kennzahlen: ['E0200002'], slotResolved: true, note: 'CORRECTED: not employerCount - official Felder sheet confirms E0200002 = Steuerklasse. (employerCount above shares the same raw Kennzahl seen in the example XML; taxClass is the officially documented meaning.)' },
  bmg29:        { line: 29, kennzahlen: ['E0200902'], slotResolved: true },
  pausch18:     { line: 18, kennzahlen: ['E0203901'], slotResolved: true },
  dba16:        { line: 16, kennzahlen: ['E0201502'], slotResolved: true },
 /* Real, confirmed Entfernungspauschale (commute) field group - added
    after checking the actual ERiC-44.2.4.0 schema documentation
    directly (E10-2020.html through E10-2025.html), not guessed.
    Confirmed identical Kennzahlen across every year 2020-2025 (18
    matching field definitions each year, same codes) - no year-gate
    needed for this group, unlike several other Anlage N fields.
    Placement: E0203901 (pausch18, immediately below) sits in this
    exact same numeric family and is already confirmed working flat
    under ArbL with no special wrapper - used as concrete, proven
    evidence for placing this whole group the same way, since the
    HTML schema documentation's own diagram format made the wrapper
    element genuinely difficult to trace conclusively on its own. */
 commuteDays:      { line: 32, kennzahlen: ['E0203503'], slotResolved: true, note: 'aufgesucht an Tagen - days actually commuted, matches how the app already collects this (not the separate "Arbeitstage je Woche" weekly figure, E0203508, which this app does not currently collect and is optional at the schema level - minOccurs=0)' },
 commuteKmCar:     { line: 35, kennzahlen: ['E0203505'], slotResolved: true, note: 'davon mit eigenem oder zur Nutzung überlassenem PKW zurückgelegt - the km figure goes here when commuteMode=car' },
 commuteKmOther:   { line: 35, kennzahlen: ['E0203506'], slotResolved: true, note: 'davon mit öffentlichen Verkehrsmitteln, Motorrad, Fahrrad o.Ä., als Fußgänger und/oder als Mitfahrer einer Fahrgemeinschaft zurückgelegt - the km figure goes here when commuteMode is public or other (non-car)' },
 /* Real bug found via an actual ERiC rejection (Regel 120801) - these
    three fields are genuinely required alongside any commute data,
    confirmed directly by the real error text and cross-checked against
    the schema. The first version of this fix sent ONLY the mode-split
    fields (E0203505/E0203506) and never the base distance itself
    (E0203504) at all - the mode-split fields are an ADDITIONAL
    breakdown, not a substitute for the base figure. */
 commuteKmBase:    { line: 33, kennzahlen: ['E0203504'], slotResolved: true, note: 'einfache Entfernung in Kilometern - the base distance figure, required alongside the mode-specific breakdown, not replaced by it' },
 commuteDestType:  { line: null, kennzahlen: ['E0203003'], slotResolved: true, note: 'Ziel des Weges - enum, confirmed via the real schema enumeration: 1 = erste Tätigkeitsstätte (the standard case this app handles), 2 = Sammelpunkt/weiträumiges Tätigkeitsgebiet (not something this app currently distinguishes, so always sent as 1)' },
 commuteWorkplace: { line: null, kennzahlen: ['E0203501'], slotResolved: true, note: 'PLZ, Ort und Straße - confirmed required together with the distance/days (Regel 100200126); genuinely new data this app did not collect before this fix' },
 commutePublicCost:{ line: 36, kennzahlen: ['E0203611'], slotResolved: true, note: 'Aufwendungen für Fahrten mit öffentlichen Verkehrsmitteln (ohne Fähr- und Flugkosten) - only transmitted when commuteMode=public and the actual cost is genuinely used' },
  /* Real bug found via testing against a genuine client file (Regel
     100260069) - required whenever N-AUS entries exist for this
     person, confirmed via the real Felder sheet as the last field in
     ArbL/Stfr_NAUS. Not app-user-visible data - computed directly from
     the count of anlageNAUS entries for the person. */
  nAusCount: 'E0202400',
  ml10:         { line: 10, kennzahlen: ['E0201806'], slotResolved: true },
  /* Checked again directly, prioritized by the user - both E0201205
     and E0201210 genuinely exist, with identical documentation text
     ("Sterbegeld... laut Nr. 32..."). This means there are genuinely
     two real contexts for this same concept, not a typo or a single
     field - which one applies here still isn't confirmed. Kept
     unresolved rather than guessed, since sending to the wrong one
     risks a real rejection - the same discipline already used
     elsewhere in this file for fields not yet fully confirmed. */
  sterbe32:     { line: 32, kennzahlen: ['E0201205', 'E0201210'], slotResolved: false,
                  note: 'both codes confirmed to genuinely exist with identical documentation text - which real context applies here is still unconfirmed, not yet XML-tested' },
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
  /* Real, confirmed aggregate field for the app's itemized Werbungskosten
     categories (WKI_TYPES - business trips, job application costs,
     equipment depreciation, communication costs, and so on). Checked
     directly against the real schema: "Summe der weiteren
     Werbungskosten" (E0204803), confirmed present and identical across
     every year 2020-2025. Traced its real parent structure -
     Weitere_Wk/Sum - confirmed via the schema's own element
     definitions, a genuine sibling of Arbeitsmittel/Arb_Zim/Homeoffice/
     Fortb (equipment/home-office-room/home-office-allowance/training),
     which matches this app's own category grouping closely.
     Transmitted as a single, verified total rather than mapping each of
     the 11 individual categories to its own Kennzahl in this pass -
     the per-category breakdown would need further, separate research to
     do safely; the total itself is real and confirmed. */
  /* CORRECTED: real ERiC rejection (Regel 100200112) confirmed the sum
     alone is not valid - the individual itemized amounts must also be
     sent. Checked the real Sonst structure directly: E0205405 is
     genuinely a free-text description field (its suggestive name,
     "BEWERBUNGSKOSTEN," is just an illustrative example list in the
     documentation, not an actual restricted enum - confirmed by
     reading the real facet definition, which only constrains the
     character set, not the specific value). Confirmed identical
     across all five years 2021-2025. */
  weitereWkDesc: { kennzahlen: ['E0205405'], slotResolved: true, note: 'Weitere_Wk/Sonst/E0205405 - Bezeichnung, genuinely free text' },
  weitereWkAmount: { kennzahlen: ['E0205406'], slotResolved: true, note: 'Weitere_Wk/Sonst/E0205406 - Betrag, the individual item amount' },
  /* Real gap found via a full client-data audit - Arbeitsmittel (work
     equipment) and Fortbildung (continuing education) are their own
     dedicated top-level Wk sections, genuinely distinct from
     Weitere_Wk, and were never wired at all - the app's own direct
     entry fields for these (separate from the itemized list) were
     being silently dropped. Confirmed identical across all five years
     2021-2025. */
  arbeitsmittelArt: 'E0204401', arbeitsmittelAmount: 'E0204402', arbeitsmittelSum: 'E0204403',
  /* Real gap found via a complete field-audit - Arbeitszimmer (a
     dedicated home office room, a separate deduction from the daily
     home-office allowance) was collected by the app but never wired
     at all, meaning it was silently discarded before even reaching
     the backend. Confirmed real element order: right after
     Arbeitsmittel, before Homeoffice. Confirmed identical across all
     five years 2021-2025. */
  arbeitszimmerArt: 'E0204503', arbeitszimmerAmount: 'E0204505', arbeitszimmerSum: 'E0204504',
  fortbildungArt: 'E0204804', fortbildungAmount: 'E0204808', fortbildungSum: 'E0204812',
  weitereWkSum: { kennzahlen: ['E0204803'], slotResolved: true, note: 'Weitere_Wk/Sum/E0204803 - sum of the itemized Werbungskosten entries (WKI_TYPES), transmitted as a single verified total' },
  /* Real gap found via the systematic backend-wiring audit - collected
     in the app, never attempted before. Confirmed directly: this wants
     the raw day COUNT, not a pre-calculated amount - "Anzahl der
     Kalendertage" - the app already collects exactly this (c.wk.homeOffice
     as a day count), so the raw value transmits as-is, matching the
     schema's own expectation rather than the app's internal €6/day
     calculation. */
  homeOfficeDays: { kennzahlen: ['E0204507'], slotResolved: true, note: 'Wk/Homeoffice/E0204507 - Anzahl der Kalendertage im Homeoffice' },
};

/* ---------- 3. Insurance / Vorsorgeaufwand (VOR context) ---------- */
const VOR = {
  /* CORRECTED: E2000601 was the wrong field - confirmed via the real
     official ELSTER example (est_e10_2025.xml) and its Kennzahlen
     description. E2000601 is specifically for RV contributions NOT
     already covered via employment; our app's rv value comes directly
     from the Lohnsteuerbescheinigung, matching E2000401
     ("Arbeitnehmeranteil laut Nr. 23a/b der Lohnsteuerbescheinigung"). */
  rv: 'E2000401',
  rvArbeitgeber: 'E2000801', // required companion to rv, confirmed via real ERiC validation (Regel 950020) - must be declared together, "gegebenenfalls mit dem Wert 0"
  rvBerufsstaendisch: 'E2000501',
  kv: 'E2001203',
  kvOther: 'E2001805',
  pv: 'E2001505',
  pvErstattung: 'E2001605',
  av: 'E2004403',
  /* CORRECTED: found by fully enumerating VOR's real sibling sequence -
     Beitr_p_KV_PV_Inl covers PRIVATE (not statutory) health/care
     insurance base coverage, genuinely distinct from Beitr_g_KV_PV_Inl
     (statutory, already wired above). Matches this app's own 'pkv'
     insurance type exactly ("Private Kranken-/Pflegeversicherung
     (Basis)"). Confirmed identical across all five years 2021-2025.
     Scope note: only the 'pkv' type is wired here - 'gkvfrei'
     (voluntary statutory insurance) is tagged the same 'basis'
     category in this app's own categorization but represents a
     genuinely different real context not yet independently confirmed,
     so it's deliberately left unmapped rather than assumed identical. */
  pkv: 'E2003104',
  pkvPflege: 'E2003202',
  /* Found by checking the COMPLETE Beitr_p_KV_PV_Inl structure through
     to its actual last sibling this time, not stopping partway - the
     same mistake already caught once with A_B_LP. WL_Zvers covers
     supplementary health AND care insurance together in one real
     field (kvzusatz, pflegezusatz), already net of reimbursement.
     Confirmed identical across all five years 2021-2025. */
  kvZusatz: 'E2003502',
  /* Found by actually opening A_B_LP - a sibling identified earlier but
     never drilled into. This is the real "sonstige Vorsorgeaufwendungen"
     category German tax law does provide for (accident, liability,
     term-life, disability, and endowment life insurance), confirmed
     identical across all five years 2021-2025. Maps directly onto
     several of this app's own "vorsorge"-tagged insurance types. */
  uHpRis: 'E2001802',        // U_HP_Ris_Vers/Einz - unfall, haftpflicht, kfzhaft, tierhaft, risikoleben
  uHpRisArt: 'E2001801',
  uHpRisSum: 'E2001803',
  erwUBu: 'E2001502',        // ErwU_BU_Vers/Einz - bu (occupational disability)
  erwUBuArt: 'E2001501',
  erwUBuSum: 'E2001503',
  rvMitWrKapLv: 'E2001902',  // RV_m_WR_KapLV/Einz - kapitalleben (endowment life, pre-2005)
  rvMitWrKapLvArt: 'E2001901',
  rvMitWrKapLvSum: 'E2001903',
};

/* ---------- 4. Sonderausgaben - donations (SA context) ---------- */
/* Category correction: donations live under "SA", not "SO" (Sonstige
   Einkuenfte - a different form entirely, crypto/private sales). */
const SA = {
  donationsDomestic: 'E0108405',
  donationsThisYear: 'E0108509', // required companion - confirmed via real ERiC validation (Regel 101100001): "how much of the donation applies THIS tax year" (endowment donations can otherwise be spread across up to 10 years)
  // Anlage U / Realsplitting - confirmed via real Kennzahlen sheet under
  // context /SA/Weit_Aufw/U_Leist (nested inside SA, NOT a separate
  // top-level element, per the real content model). Confirmed genuinely
  // required set (Regeln 58, 64, 65): amount + domestic-residence flag
  // always, plus the ex-spouse's IdNr specifically when residence is
  // domestic. Name/birthdate confirmed as a soft completeness companion,
  // not a hard block if omitted.
  realsplittingAmount: 'E0104408', // "tatsächlich erbracht" - amount actually paid
  realsplittingInland: 'E0183001', // domestic residence Ja/Nein - Pflichtangabe whenever this context is used at all
  realsplittingIdNr: 'E0104305', // ex-spouse's IdNr - required unconditionally for 2023 (Regel 66, no country exception exists that year); required only for domestic residence from 2024 onward (once the country/foreign-exception concept was introduced)
  realsplittingNameGeburt: 'E0183101', // combined Name+Geburtsdatum text field - CORRECTED: confirmed hard-required together with the amount via real ERiC validation (Regel 101180025, FelderNichtGemeinsamAngegeben) - an earlier reading of this rule type as "soft/optional" was wrong
  donationsEuEwr: 'E0105502',
  donationsBasis: 'E0105902',
};

/* ---------- 5. Children - Kind context ---------- */
const Kind = {
  idnr:        'E0500406', // Identifikationsnummer
  firstName:   { kennzahlen: ['E0500107'], required: true, note: 'Vorname - Pflichtfeld=Ja in the real schema' },
  /* Real gap found via direct user question about why only a first
     name is collected - confirmed via the real Kontexte/Felder sheets
     that this is deliberate: ELSTER assumes the child shares the
     filer's own surname by default, and E0500108 exists specifically
     and only for when it genuinely differs (blended families, adopted
     children with a different name, etc.) - optional, sibling of
     E0500107, not a "full name" field. */
  surnameIfDifferent: 'E0500108',
  birthDate:   { kennzahlen: ['E0500701'], required: true, note: 'Geburtsdatum - Pflichtfeld=Ja in the real schema' },
  altSurname:  'E0500108', // ggf. abweichender Familienname (only if different from parent)
  /* Transfer of the child's own disability/helplessness lump sum to
     the parent(s) (Ueb_PB_Beh_Hbl), confirmed via full schema
     investigation - the actual deduction tier is determined by which
     marker flags are set, not a directly-entered euro amount or
     percentage grade. Mandatory (calculation-affecting) fields: at
     least one of the two marker flags, and validity (either
     indefinite or a specific date range). The split percentage is
     genuinely optional - omitting it defaults to an even 50/50 split
     automatically, so it's only sent when the person indicates a
     different split. Confirmed identical across all five years. */
  behMobilityMarker: 'E0505808', // erheblich/außergewöhnlich gehbehindert (G/aG)
  behBlindHelplessMarker: 'E0505807', // blind/taubblind/ständig hilflos (Bl/TBl/H)
  behValidIndefinite: 'E0505908', // unbefristet gültig
  behValidFrom: 'E0504601', behValidTo: 'E0504602', // gültig von/bis (only if not indefinite)
  behSplitPercent: 'E0506007', // optional - only if not the default 50/50
  /* CORRECTED: E0500807/E0500808 were previously grouped under one key
     with an incorrect comment claiming they're a "multi-child repeat
     pattern" - real research (the multi-year regression test surfacing
     "andere Elternteil" errors) confirmed these are for the TWO
     PARENTS' relationship to the child (K_Verh_A, K_Verh_B), not a
     per-child repeat. Split into separate keys. */
  kinshipTypeA: { kennzahlen: ['E0500807'], note: 'Art des Kindschaftsverhaeltnisses - parent A (K_Verh_A)' },
  kinshipTypeB: { kennzahlen: ['E0500808'], note: 'Art des Kindschaftsverhaeltnisses - parent B / the child\'s other parent, confirmed required alongside A regardless of whether that person is a co-filer on this return (K_Verh_B)' },
  kinshipPeriodB: 'E0500805', // K_Verh_B - Kindschaftsverhältnis bestand vom - bis (DatumBereich)
  /* LEGACY (2021/2022) ONLY - real bug found via testing against a
     genuine 2022 client file. Confirmed via the raw 2022 XSD that
     K_Verh_A wraps its content in a <KV> element not present in 2023+,
     with this period field as KV's sibling to the type code
     (E0500807). Confirmed A-specific via the real Felder sheet -
     K_Verh_B/KV uses a DIFFERENT code (E0500805, verified separately,
     coincidentally the same code already mapped as kinshipPeriodB for
     2023+). Used only by the taxYear<2023 branch in buildKind() - never
     referenced by the 2023+ code path. */
  kinshipPeriodLegacy: 'E0500601',
  /* NEW: real bug found via the multi-year regression test - discovered
     that K_Verh_B (above) is just ONE of five ways to satisfy the
     "second parent" completeness rule (Regel 100500048/25) - and it's
     specifically the one that's forbidden for single filers (confirmed:
     "Einzelveranlagung, daher...zur Ehefrau nicht zulässig"). The real,
     correct mechanism for single filers is a genuinely different
     context, K_Verh_and_P/Ang_Pers - simply naming the other parent,
     without treating them as a co-filer. This is the simplest of the
     five valid options (the other four require special circumstances:
     the other parent's death, unknown whereabouts, or living abroad -
     none of which should be guessed/defaulted). */
  otherParentName: 'E0501103', // K_Verh/K_Verh_and_P/Ang_Pers - Name, Vorname
  /* NEW: real bug found via a third regression test round - confirmed
     via the actual error text ("Namen...Dauer...Art...gemeinsam
     anzugeben") that Name alone isn't enough - the duration and type of
     this relationship must be given TOGETHER with it (Regel
     100500001). Same enum values as K_Verh_A/B (1=leiblich/adoptiert,
     2=Pflegekind), confirmed via the real XSD. */
  otherParentPeriod: 'E0501903', // K_Verh/K_Verh_and_P/Ang_Pers - Dauer des Kindschaftsverhältnisses (DatumBereich)
  otherParentKinType: 'E0501106', // K_Verh/K_Verh_and_P/Ang_Pers - Art des Kindschaftsverhältnisses (enum)
  familienkasse: 'E0500706', // Ang_Kind/Allg - für die Kindergeldfestsetzung zuständige Familienkasse (free text)
  residenceInl: 'E0500703',  // Ang_Kind/WS/Inl - vom - bis (residence duration in Germany, DatumBereich)
  gemHhElt: 'E0504807',      // KBK/Ang_HH/Gem_HH_Elt - shared parental household period (DatumBereich)
  gemHhEltKind: 'E0504808', // KBK/Ang_HH/Gem_HH_Elt - "Das Kind gehörte zu unserem Haushalt im Zeitraum" - confirmed required TOGETHER with gemHhElt via real ERiC validation (Regel 514120, FelderNichtGemeinsamAngegeben-style pairing)
  kindergeld:  { kennzahlen: ['E0500702', 'E0503802'] },
  /* CORRECTED: real bug found via testing against a genuine client file
     (not synthetic test data) - E0504505 (Elt_k_ZV) is NOT the itemized
     entry that Sum needs to pair with at all. It's a genuinely
     different, conditional field (the non-joint-assessment cost-split
     amount, same "Elt_k_ZV" concept as childcare's Elt_k_ZV/Kosten).
     The REAL itemized entry Sum requires is a separate context,
     Schulgeld/Einz, with its own school-name and amount fields - never
     implemented before, which is exactly why Sum kept appearing without
     its required companion. */
  schoolFeesEinzName: 'E0505606', // Schulgeld/Einz - Bezeichnung der Schule oder deren Träger
  schoolFeesEinzAmount: 'E0504405', // Schulgeld/Einz - Einzelbetrag
  schoolFeesSum: 'E0505607', // Schulgeld/Sum - required companion total
  schoolFeesEltKZv: 'E0504505', // Schulgeld/Elt_k_ZV - only relevant for non-joint assessment cost-splitting, NOT the itemized entry
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
  /* NEW: real bug found via the multi-year regression test - whenever
     the parents are NOT jointly assessed (no Person B, or separate
     assessment), a SEPARATE declaration is required: how much of the
     childcare cost THIS specific taxpayer personally bore (as opposed
     to the general KBK/Art total, which doesn't distinguish between
     two separately-filing parents). Since this app only supports a
     single taxpayer entering childcare costs (no cost-splitting between
     two separate filers), the natural value is the same amount already
     collected - the taxpayer entering it is, by construction, the one
     who bore it. */
  eltKZvPeriod: 'E0506606', // KBK/Elt_k_ZV/Kosten/Einz - Zeitraum (vom - bis)
  eltKZvAmount: 'E0506605', // KBK/Elt_k_ZV/Kosten/Einz - Betrag
  eltKZvSum: 'E0506604',    // KBK/Elt_k_ZV/Kosten/Sum - berücksichtigungsfähige Aufwendungen
  childcareProvider:{ kennzahlen: ['E0506101'], note: 'Art der Dienstleistung, Name und Anschrift des Dienstleisters - service type + provider name + address, REQUIRED together, see rule below. CONFIRMED 2023+ ONLY (verified per-year via the real Beschreibung text) - a single combined free-text field for those years. Do not reuse for 2021/2022, see childcareServiceTypeLegacy/childcareProviderLegacy below.' },
  /* LEGACY (2021/2022) ONLY - real bug found via testing against a
     genuine 2022 client file (Regel 514001, "Art der Dienstleistung,
     Name und Anschrift...nicht gemeinsam angegeben"). Confirmed via the
     real per-year Beschreibung text (not assumed) that E0506101 means
     something NARROWER for 2021/2022 than 2023+ - just "Art der
     Dienstleistung" (service type), with a genuinely SEPARATE field,
     E0506102, for the provider's name/address that 2023+ does not have
     at all (it folds both into the single E0506101). The app was
     sending the provider name into E0506101 for every year, which is
     correct for 2023+ but wrong for 2021/2022 - it needs a real service
     TYPE there instead, with the name going to E0506102. Since the app
     does not collect a specific service category (Kita/Tagesmutter/
     Hort/etc.), a generic, honest description is used - true for any
     childcare arrangement, not a guess at specifics the app cannot
     know. Used only by the taxYear<2023 branch in buildKind() - never
     referenced by the 2023+ code path. */
  childcareServiceTypeLegacy: 'E0506101',
  childcareProviderLegacy: 'E0506102',
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
  /* CORRECTED: dhhRent found this time via direct schema tracing -
     Wk/DHHF/Unterkunft/E0207611, confirmed by its real documentation
     text ("Aufwendungen (z. B. Miete einschließlich Stellplatz- /
     Garagenkosten, Nebenkosten)"). The app's own monthly-cap
     calculation (already applied client-side before this point) is
     what gets sent here - no separate "months" Kennzahl exists in the
     real schema, so the already-computed capped total is correct as
     the transmitted figure. */
  dhhRent: 'E0207611',
  /* CORRECTED: real ERiC rejection (Regel 100200032, 100200041)
     confirmed these five fields are genuinely required once DHH data
     is present at all, despite being schema-optional. Confirmed
     identical across all five years 2021-2025. */
  dhhDate: 'E0206103',        // Allg - date the double household was established
  dhhReason: 'E0206205',      // Allg - Grund (free text)
  dhhWorkplace: 'E0206404',   // Allg - Beschäftigungsort (free text: PLZ, Ort)
  dhhOwnHousehold: 'E0206504', // Allg - eigener Hausstand am Lebensmittelpunkt (Ja=1/Nein=2)
  dhhTravelMode: 'E0206805',  // Fahrtk - Firmenwagen/Sammelbeförderung (1=Ja insgesamt, 2=Nein, 3=Ja teilweise)
  /* CORRECTED (second real rejection, Regel 100200038, 100200061) -
     three more fields genuinely required: the continuous-existence
     date must be paired with the established date, and the
     own-household PLZ/Ort and since-date are required once "own
     household: yes" is declared. Confirmed identical across all five
     years 2021-2025. */
  dhhContinuousUntil: 'E0206304', // Allg - "bis" date. REVERTED: earlier assumption (trailing period required) proven wrong by a direct, controlled user test - "31.12." caused a blank schema crash (610301200), "31.12" produced a real rejection instead. Field currently NOT transmitted pending genuine format verification - see the commented-out line in buildNDHH.
  dhhOwnPlz: 'E0206505',          // Allg - PLZ, Ort des eigenen Hausstandes
  dhhOwnSince: 'E0206506',        // Allg - seit (full date)
  // relocation: no dedicated Kennzahl found in the real schema - folded
  // into the already-wired Weitere_Wk/Sum itemized total instead,
  // rather than left unsent or a nonexistent field invented.
};

/* CORRECTED (complete re-research): the previous version of this
   object was built from the wrong XSD type entirely - tracing N's
   actual real Wk child type for 2022 led to a completely different
   DHHF structure than what was researched before, with completely
   different field codes. Confirmed via direct real-submission
   rejection evidence that the previous codes (E0224902 etc.) never
   existed in this context at all.
   The real, correct codes turn out to be almost identical to the
   2023+ N_DHH ones - same date-established, reason, continuous-until,
   workplace, travel-mode, and rent codes. The one genuine, confirmed
   structural difference: there is no own-household yes/no declaration
   at all for 2021/2022 (unlike 2023+) - instead there's a foreign-
   residence flag and country field, which this app doesn't currently
   collect. Confirmed identical between 2021 and 2022. */
const N_DHH_LEGACY = {
  dhhDate: 'E0206103', dhhReason: 'E0206205', dhhContinuousUntil: 'E0206304',
  dhhWorkplace: 'E0206404', dhhTravelMode: 'E0206805', dhhRent: 'E0207611',
};

/* ---------- 7. Household services / Section 35a (HA_35a context) ---------- */
const HA_35a = {
  /* CORRECTED: found the real mapping by tracing the complete St_Erm
     sequence directly - Minijobs, Hhn_BV_DL, and Handw_L are confirmed
     real siblings under the same parent (HA_35a/St_Erm), not separate,
     unrelated contexts. The earlier failed attempt was chasing a
     coincidentally similarly-named element from a completely different
     part of the schema (a care-specific sub-field under AgB, not this
     general household-services context at all) - the real one shares
     Handw_L's own numeric type family, confirmed directly. Same real
     Einz/Sum completeness pattern as Handw_L: a description, an
     amount, and a matching Sum total. Confirmed identical across all
     five years 2021-2025. */
  household: 'E0107207',       // Hhn_BV_DL/Einz/Aufwendungen
  householdSum: 'E0107208',    // Hhn_BV_DL/Sum
  householdArt: 'E0107206',    // Hhn_BV_DL/Einz/Art der Tätigkeit (required alongside the amount)
  /* CORRECTED: real bug found via the multi-year regression test -
     Handwerkerleistungen only sent the invoice total (E0170601), never
     the three companion fields real ERiC requires alongside it: a
     description of the expense type (E0111217), the labor/machine/
     travel-cost portion itself (E0111214), and its Sum companion
     (E0111215, same Einz/Sum completeness pattern as elsewhere in this
     schema). Confirmed via the app's own field label ("labor costs" /
     "Arbeitskosten") that the value we already collect IS the labor
     portion, not the full invoice - so the same value is used for both
     the total and the labor-portion fields (a defensible simplification
     since materials costs aren't collected separately), with a generic,
     purely-descriptive default for the required "type of expense" text
     field (safe to default, unlike a fact-based declaration). */
  handwerkerInvoice: 'E0170601',   // Rechnungsbetrag
  handwerkerLabor: 'E0111214',     // darin enthaltene Lohnanteile etc. (Einz)
  handwerkerLaborSum: 'E0111215',  // Summe (Sum)
  handwerkerArt: 'E0111217',       // Art der Aufwendungen (required text description)
};

/* ---------- 8. Capital gains - Anlage KAP ---------- */
/* App field names already match the official printed Zeile numbers. */
const KAP = {
  k7: 'E1900701', k8: 'E1900901', k12: 'E1901301', k13: 'E1901403',
  k16: 'E1901401', sparerUsed: 'E1901401',
  k18: 'E1901501', k19: 'E1901702', k20: 'E1901701', k21: 'E1901802',
  k22: 'E1901903', k23: 'E1902001', k43: 'E1904701', k44: 'E1904901', k45: 'E1904801',
  /* NEW: real bug found via the multi-year regression test - whenever
     domestic withheld capital gains are reported, ERiC requires stating
     a REASON for reporting them (one of three options: Günstigerprüfung
     request, withholding-review request, or church-tax declaration).
     Günstigerprüfung ("please check whether my regular tax rate would
     be more favorable than the flat rate") is confirmed universally
     safe to request for every taxpayer - it can only help (if the flat
     rate is already best, the Finanzamt just confirms that; if the
     taxpayer's marginal rate is lower, they get money back) - unlike
     the church-tax option, which would be a false declaration for most
     users. Context /KAP/Ant, a sibling of Person. */
  guenstigerpruefung: 'E1900401',
};

/* ---------- 9. Loss carryforward (Sonst context) ---------- */
const Sonst = {
  lossCarry: 'E0190701',
};

/* ---------- 9a. Private sales gains - Anlage SO (genuinely distinct
   top-level element from "Sonst" above, despite the similar name -
   confirmed directly via the schema: Sonst and SO are two separate
   root elements, not the same thing under a different label.
   Real path confirmed: SO/Priv_VA_G/And_WG/Einz/[fields].
   Checked minOccurs directly rather than assume: only the Person
   index (which spouse this applies to) is genuinely required -
   description, dates, sale price, and acquisition cost are all
   schema-optional. Confirmed identical across all five years this
   app supports (2021-2025) - deliberately using the universal
   And_WG category rather than the newer, crypto-specific Virt_Waehr
   introduced in 2023, since And_WG covers crypto and other private
   sale assets alike without needing a year-conditional branch, and
   this app's own data model doesn't currently distinguish "crypto"
   from "other" as separate figures anyway. */
const SO = {
  soSalePrice: { kennzahlen: ['E0307401'], slotResolved: true, note: 'SO/Priv_VA_G/And_WG/Einz - Veräußerungspreis. The known net gain is entered here, with acquisition cost set to 0, so the resulting taxable gain (sale price minus cost) is exactly the real, correct figure - not a fabricated split, an honest, transparent simplification of a single known net total.' },
  soAcquisitionCost: { kennzahlen: ['E0307501'], slotResolved: true, note: 'SO/Priv_VA_G/And_WG/Einz - Anschaffungskosten, deliberately set to 0 alongside soSalePrice, so the computed gain equals the real known total exactly.' },
  /* CORRECTED: real bug found via an actual ERiC rejection (Regel
     130829 and 101300034) - both schema-optional (minOccurs=0), but
     genuinely required by real business rules once any Einz entry
     exists at all, the exact same "schema-optional does not mean
     business-rule-optional" lesson repeated throughout this project. */
  soGewinnVerlust: { kennzahlen: ['E0307701'], slotResolved: true, note: 'SO/Priv_VA_G/And_WG/Einz - Gewinn/Verlust, the explicit net result ELSTER requires stated directly, not just derivable from sale price minus cost. Set equal to soSalePrice, matching the same zero-cost-basis simplification.' },
  soDescription: { kennzahlen: ['E0307101'], slotResolved: true, note: 'SO/Priv_VA_G/And_WG/Einz - Art des Wirtschaftsguts, confirmed genuinely required once an amount is entered (Regel 101300034), despite being schema-optional. A generic, honest description is used since this app does not collect a specific item description.' },
  /* Real gap found via a full client-data audit, fixed by fully
     re-checking the complete SO structure this time rather than
     stopping after finding Priv_VA_G alone. Confirmed identical
     across all five years 2021-2025. */
  soUnterhalt: { kennzahlen: ['E0304601'], slotResolved: true, note: 'SO/Unt_Leist/E0304601 - Unterhaltsleistungen, soweit sie vom Geber als Sonderausgaben abgezogen werden können (received support, the recipient side of Realsplitting - the payer side is already correctly wired via Anlage U)' },
};

/* ---------- 10. Support payments - Unterhalt (ESt1A_U context) ---------- */
const ESt1A_U = {
  /* CORRECTED: 'support' (E0125007) was the WRONG field entirely - it's
     part of the Opfergrenze means-testing sub-calculation, not the
     support amount itself (confirmed via real ERiC validation Regel
     100120044/101100001 investigated earlier this session). Real
     confirmed minimal-required set below, verified against both the
     Jahresdokumentation Felder sheet and the actual XSD types (not
     guessed) - covers the common domestic case: one household, one
     supported person, no other contributors, no income of their own.
     All under context /ESt1A_U/Ang_HH_unt_P_Unt_Leist/... */
  householdAddress: 'E0120101',   // HH_unt_P - Anschrift dieses Haushaltes (String)
  householdSize: 'E0120108',      // HH_unt_P - Anzahl Personen im Haushalt (Ganzzahl)
  name: 'E0120201',               // Ang_Unt_Pers/Allg/Persoenl - Name, Vorname (String)
  /* CORRECTED via a real empirical ERiC test (not just documentation
     reading): IdNr is genuinely NOT required - a submission missing it
     entirely produced no "missing field" error at all, only the earlier
     documentation-based assumption said otherwise. Kept as a field since
     the data may still be useful/correct when available, but no longer
     treated as mandatory anywhere in the app. */
  idnr: 'E0120211',               // Ang_Unt_Pers/Allg/Persoenl - Identifikationsnummer (confirmed NOT mandatory)
  profession: 'E0120202',         // Ang_Unt_Pers/Allg/Persoenl - Beruf, Familienstand (combined free-text String) - CONFIRMED required via real ERiC validation (Regel 100120001), found via empirical testing, not originally researched
  personBirthDate: 'E0120203',    // Ang_Unt_Pers/Allg/Persoenl - Geburtsdatum - CONFIRMED required alongside Name (same Regel 100120001)
  relationship: 'E0120701',       // Ang_Unt_Pers/Allg/Persoenl - Verwandtschaftsverhältnis (String)
  cohabitation: 'E0122505',       // Ang_Unt_Pers/Allg/U_Berecht - "lebte in meinem inländischen Haushalt" - CONFIRMED required (Regel 100120068), JaNein12BaseCType
  kindergeldEntitlement: 'E0122613', // Ang_Unt_Pers/Allg/U_Berecht - JaNein12BaseCType (1=Ja,2=Nein)
  otherContributor: 'E0124801',   // Ang_Unt_Pers/Weit_beitr_P - JaNein12BaseCType
  hasAssets: 'E0123105',          // Ang_Unt_Pers/Allg/Verm_u_P - "Hatte...Vermögen?" - CONFIRMED required (same Regel that flagged missing Vermögen data), JaNein12BaseCType. Detail sub-fields (E0120305 total value, E0120302 period) only needed if "Ja" - not implemented, matches the same pattern already used for hasOwnIncome.
  hasOwnIncome: 'E0123313',       // Ang_Unt_Pers/Ek_Bez_u_P/Allg - JaNein12BaseCType (2=Nein skips the entire 40+ field income sub-tree)
  amount: 'E0120103',             // AW_U/U_Ztr - Höhe der Unterhaltszahlung (Ganzzahl)
  period: 'E0120109',             // AW_U/U_Ztr - Unterstützungszeitraum (DatumBereichTTpMMbTTpMMBaseCType - "TT.MM-TT.MM", same format as childcare's period)
  paymentPeriod: 'E0120104',      // AW_U/U_Ztr - Zeitraum der tatsächlichen Zahlungen (real bug found via multi-year regression test - confirmed required TOGETHER with the amount via Regel 300010 "FelderNichtGemeinsamAngegeben(E0120103, E0120104)" - a genuinely separate field from E0120109, not a duplicate)

  /* =========================================================================
     LEGACY (2021/2022) - a genuinely SEPARATE, isolated field group.
     Confirmed via full research (not assumed) that Anlage Unterhalt's
     structure for 2021/2022 is substantially different from 2023+:
       - The amount lives under a DIFFERENT context, AW_U/U_Zlg (not
         AW_U/U_Ztr like 2023+ uses for the period alone) - AND both
         contexts are needed together (Regel 5).
       - The Yes/No pattern fields (2023+'s JaNein12, "1"/"2") are
         replaced with STATEMENT-style JaXBaseCType flags ("X") -
         confirmed via the real XSD, a genuinely different value
         convention, not just different Kennzahl numbers.
       - Cohabitation, other-contributor, assets, and Kindergeld are all
         phrased as opposite-polarity statements compared to 2023+ (e.g.
         "had NO assets" instead of "had assets: yes/no").
     Confirmed identical between 2021 and 2022 specifically (same codes,
     same structure) - a single implementation covers both years. These
     names are intentionally prefixed "legacy" and kept completely
     separate from the fields above, so nothing here can accidentally
     affect the confirmed-working 2023+ logic. */
  legacyHouseholdAddress: 'E0120101',
  legacyHouseholdSize: 'E0120108',
  legacyIdnr: 'E0120211',
  legacyName: 'E0120201',
  legacyBirthDate: 'E0120203',
  legacyProfession: 'E0120202',
  legacyRelationship: 'E0120701',
  legacyNoKindergeldAllYear: 'E0120401', // JaXBaseCType - "nobody had a Kindergeld claim the whole year" (the simple/default case)
  legacyNoOrLowAssets: 'E0120301',       // JaXBaseCType - "had no or only minor assets"
  legacyNoOtherContributor: 'E0120860',  // JaXBaseCType - "no other person contributed"
  legacyNoIncome: 'E0120901',            // JaXBaseCType - "no income/benefits"
  legacyPeriod: 'E0120109',              // AW_U/U_Ztr - Unterstützungszeitraum
  legacyAmount: 'E0120103',              // AW_U/U_Zlg - Höhe der Unterhaltszahlung
  legacyPaymentPeriod: 'E0120104',       // AW_U/U_Zlg - Zeitraum der Zahlung
  /* CORRECTED (second pass) - real bug found via testing against a
     genuine 2022 client file. First attempt wrongly treated this as a
     structural wrapper AROUND Allg/Ek_Bez_u_P (based on a
     misinterpretation of the documentation summary sheet, the same
     class of mistake as the Anlage V Ek_b_Gst error last session).
     Verified directly against the raw XSD sequence this time:
     Ang_Unt_Pers's real children are Unterstuetzte_Person (an index
     value), then Allg, then Ek_Bez_u_P - three SIBLINGS, not nested.
     Value is a literal enum string ("Person1".."Person6" for the
     Nth supported person) - this app only supports one, so "Person1"
     is always correct. Used only by the taxYear<2023 branch. */
  legacyPersonIndex: 'Unterstuetzte_Person',

  /* Foreign household - implemented after full research (not deferred
     this time): confirmed via the real XSD and Jahresdokumentation that
     this maps directly onto the same concept already collected in the
     UI for 2023+ (foreignNeedConfirmed) - a mutually exclusive Yes/No
     pair (JaXBaseCType, "X"), not a more complex structure. Country
     list confirmed byte-identical between 2021 and 2022 (232 entries),
     extracted directly from the real XSD documentation string rather
     than assumed compatible with the 2023+ country list (some entries
     genuinely differ, e.g. "Tschechien" here vs "Tschechische
     Republik" in the 2023+ list). */
  legacyCountry: 'E0120102',             // HH_unt_P - Wohnsitzstaat, wenn Ausland
  legacyForeignConfirmedYes: 'E0120209', // Persoenl - "Die...Unterhaltserklärung...liegt mir vor"
  legacyForeignConfirmedNo: 'E0120210',  // Persoenl - "...liegt mir nicht vor"

  /* CORRECTED (found via user's own re-check request): confirmed via the
     real Regeln sheet that BOTH domestic (Regel 46) AND foreign (Regel
     48) branches require the supported person's IdNr - the foreign case
     does NOT relax this, it ADDS one more requirement on top (the
     confirmation declaration below, per Regel 32). Country is a genuine
     enum (NAEnum_LAENDERGR_2024_1_BaseCType, ~232 real country names,
     not free text) - omitted entirely means domestic. */
  country: 'E0120102',            // HH_unt_P - Wohnsitzstaat, wenn Ausland (enum, exact country name match required)
  foreignNeedConfirmed: 'E0123213', // Ang_Unt_Pers/Allg/Erkl_Beduerft - confirmation from the home-country authority - REQUIRED when country is foreign (Regel 32), JaNein12BaseCType
};

/* ---------- 11. Foreign employment income - Anlage N-AUS (N_AUS context) ---------- */
/* SCOPE DECISION: the full form has 82 fields (complete DBA/ATE treaty
   machinery). This covers the common case only - day-apportionment DBA
   exemption - not ATE-specific codes, multi-country splits, or deferred
   compensation. See computeAusTaxFree() for the official formula. */
const N_AUS = {
  /* CORRECTED (major): real bug found via full research prompted by
     repeated real client-file errors - the PREVIOUS mapping used
     entirely the wrong fields. E2601001/E2603xxx are NOT the primary
     employer/country - they belong to Wohnsitz (foreign residence,
     only relevant if dual-residence applies) and Unternehmen (a
     DIFFERENT related-company field for a narrow 183-day exception),
     respectively. Confirmed via the raw XSD content model directly,
     not the summary sheet - the real primary fields are Staat/Staat
     (country) and Staat/Allg/ArbG (employer), genuinely different
     Kennzahlen from what was there before. Gated to 2023-2025 (2021/22
     use structurally different fields, e.g. a Ja/Nein statement PAIR
     for dual-residence instead of one enum - confirmed missing, not
     just renamed - needs its own dedicated research pass the same way
     Anlage Unterhalt's legacy structure did, not guessed under time
     pressure). Confirmed identical across 2023/2024/2025. */
  ausCountry: 'E2600401',              // Staat/Staat - primary work country
  ausLegalBasis: 'E2600503',           // Staat/Allg - 1=DBA, 2=ATE, 3=ZÜ (enum)
  ausDualResidence: 'E2600703',        // Staat/Allg/Wohnsitz - JaNein12
  ausForeignResStreet: 'E2600801',     // only if dual residence = Ja
  ausForeignResPlz: 'E2600901',
  ausForeignResCity: 'E2600902',
  ausForeignResCountry: 'E2601001',
  ausCenterOfInterests: 'E2601104',    // JaNein12 - only if dual residence = Ja
  ausEmployerName: 'E2601202',         // Staat/Allg/ArbG - confirmed correct context (was Unternehmen before)
  ausEmployerStreet: 'E2601201',
  ausEmployerPlz: 'E2601301',
  ausEmployerCity: 'E2601302',
  ausEmployerCountry: 'E2601401',
  ausActivityDesc: 'E2601701',         // Staat/Allg/Taetigk/Art_Zeitr - free text
  ausActivityPeriod: 'E2601702',       // full TT.MM.JJJJ-TT.MM.JJJJ range (confirmed different type from other DatumBereich fields - includes the year)
  ausDaysAbroad: 'E2602001',           // Staat/Allg/Taetigk/Tage
  /* Real requirement found via testing against a genuine client file
     (Regel 30, confirmed): whenever DBA is the legal basis and days
     abroad is under 184, the standard 183-day exemption does not
     automatically apply - at least one of these six mutually exclusive
     legal/contractual bases must be stated, or the entry is rejected.
     Confirmed stable across 2023-2025. First five are simple flags
     (only one should be sent); the sixth is free text for "other". */
  ausShortStayWerkvertrag: 'E2602301',      // under a works/service contract with the employer
  ausShortStayLeasing: 'E2602401',          // commercial employee leasing (Arbeitnehmerüberlassung)
  ausShortStayAffiliated: 'E2602501',       // at a company affiliated with the employer
  ausShortStayPermanentEstab: 'E2602601',   // for a DBA permanent establishment of the employer
  ausShortStayForeignEmployer: 'E2602701',  // for a genuinely separate foreign employer
  ausShortStayOther: 'E2602801',            // free text, "other, specify:"
  ausGross: 'E2603501',
  ausGrossNoWithholding: 'E2603601',
  ausTaxFreeAlready: 'E2603701',
  ausTotalWage: 'E2604101',
  ausRemainingWage: 'E2604401',        // real bug found earlier this project (Regel 100260026) - see prior note in xml-builder.js
  ausWorkDaysTotal: 'E2604501',        // Ang_ArbL/ArbL_DBA - confirmed correct context (was previously right, kept)
  ausWorkDaysForeign: 'E2604601',
  ausDbaCalculated: 'E2604701',        // computed: remaining wage × foreign days / total days (confirmed formula via real Regel 52)
  ausTaxFreeResult: 'E2604901',        // final DBA-exempt wage - MUST equal Anlage N's E0201502 (Regel 0/1/7), computed automatically, not user-entered
};
/* Confirmed formula via real Regel 52: "verbleibender Arbeitslohn ×
   Auslandsarbeitstage / tatsächliche Arbeitstage = verbleibender
   ausländischer Arbeitslohn" - takes the REMAINING wage (post
   tax-exempt-portion-already-subtracted), not the raw total, as
   confirmed by the field name in the formula description itself. */
function computeAusTaxFree(remainingWage, workDaysForeign, workDaysTotal) {
  const w = parseFloat(String(remainingWage||'0').replace(',','.')) || 0;
  const foreign = parseFloat(String(workDaysForeign||'0')) || 0;
  const total = parseFloat(String(workDaysTotal||'0')) || 0;
  if (total <= 0) return 0;
  return Math.round(w * foreign / total);
}

/* ---------- 12. Disability/care allowance - AgB context ---------- */
const AgB = {
  gdbA: 'E0109708',
  /* Real, confirmed cross-validation requirement found via a real
     ERiC rejection (Regel 101160039) - the main Beh block has its own
     separate marker sub-block (Geh_Steh_Blind_Hilfl) that must agree
     with whatever tier is declared in Beh_Fk_Pausch. Same real
     meaning as fahrtTier1/fahrtTier2, just required in this second
     location too. Confirmed identical across all five years. */
  gdbMobilityMarker: 'E0109707', gdbBlindHelplessMarker: 'E0109706',
  pflegeGrad: 'E0161606',
  /* Care lump sum follow-up fields, now implemented - confirmed
     directly against the real schema (Ang_pflegebeduerft_Pers). Real
     element order: Name/address(E0110601), IdNr(E0161506),
     residency(E0161607), grade(E0161606), then the "H" mark(E0161808). */
  pflegePersonInfo: 'E0110601', pflegePersonId: 'E0161506',
  pflegePersonResident: 'E0161607', pflegePersonH: 'E0161808',
  /* Disability-related commute allowance - confirmed directly against
     the schema to be a genuine sibling to the filer's own disability
     grade (Beh) within the main AgB section, maxOccurs=2 (one per
     person), NOT tied to a child entry - resolves earlier confusion
     with a different element that happens to share the same name
     within a child's own entry. Both are real, checkbox-style flags
     (Ja1) - only sent when true, no separate amount field needed
     since these are fixed statutory amounts ELSTER computes itself
     from the flag alone. E0161706 matches the lower threshold (grade
     70+ with mark G, or grade 80+) - the app's 900 EUR option.
     E0161806 matches the higher threshold (aG/Bl/TBl/H marks) - the
     app's 4,500 EUR option. */
  fahrtFlagLow: 'E0161706', fahrtFlagHigh: 'E0161806',
  medical: { kennzahlen: ['E0161301', 'E0161302', 'E0161303', 'E0161304', 'E0161305'],
    note: 'Krankheitskosten: Art/Hoehe/Erstattung/Summe-Aufwand/Summe-Erstattung, confirmed via AgB - Kontexte hierarchy (/AgB/And_Aufw/Krankh is first in the position-matched list of 5 generic Art/Hoehe pairs)' },
};
function amountToPflegegrad(amount) {
  const map = { '600': '2', '1100': '3', '1800': '4' };
  return map[String(amount).trim()] || null;
}

/* ---------- 13. Energetic renovation - Section 35c (EM_35c context) ---------- */
const EM_35c = {
  /* Confirmed via the raw XSD content model directly (not the summary
     sheet, which has misled twice elsewhere in this project) - the
     structure is identical across 2021-2025, only the number of
     measure categories grew over time. All fields below confirmed
     present in every year 2021-2025. */
  street: 'E0240401',           // Obj/Allg - Straße, Hausnummer
  buildDate: 'E0240402',        // Obj/Allg - Herstellungsbeginn des Gebäudes (full date)
  plzOrt: 'E0240501',           // Obj/Allg - Postleitzahl, Ort
  areaTotal: 'E0240801',        // Obj/Allg - Gesamtfläche in m²
  areaOwn: 'E0240802',          // Obj/Allg - davon eigene Wohnzwecke in m²
  priorClaim: 'E0240803',       // Obj/Allg - Steuerermäßigung für dieses Objekt bereits früher genutzt (JaNein12)
  otherFunding: 'E0240902',     // Obj/Aufw - andere Förderung beantragt/genutzt (JaNein12)
  measureStart: 'E0240901',     // Obj/Aufw/Massn - Baubeginn der energetischen Maßnahme (full date)
  /* Measure categories - each wraps a single amount field. Confirmed
     via the raw XSD (Waende/Dach/Geschossd/Fenst_Tuer/Lueftung/Heizung
     each contain exactly one child). Covers the common renovation
     types; the rarer categories (summer heat protection, digital
     monitoring, heating-system optimization, hybrid pre-wiring,
     certification costs, energy consultant fees) are not implemented -
     same "common case first" scoping used throughout this project. */
  measureWalls: 'E0241001',     // Wärmedämmung Wände
  measureRoof: 'E0241101',      // Wärmedämmung Dach
  measureCeiling: 'E0241201',   // Wärmedämmung Geschossdecken
  measureWindows: 'E0241301',   // Fenster/Außentüren
  measureVentilation: 'E0241401', // Lüftungsanlage
  measureHeating: 'E0241501',   // Heizungsanlage
  measureSum: 'E0241901',       // Obj/Aufw/Massn/Sum - Summe aller Maßnahmen
  /* Prior-year recognized amounts - simple user-entered figures from
     their own prior tax notice (Steuerbescheid), NOT something this
     app tracks or computes itself. The §35c credit is legally spread
     over 3 years (7%/7%/6%); ELSTER expects the taxpayer to state what
     was already recognized in years 1 and 2 when filing for a later
     year - the app's job is just to collect those two numbers if the
     user has them, not to remember state across separate tax years. */
  priorYear1: 'E0242501',       // Obj/EM_Vorj - anerkannte Aufwendungen VZ-1
  priorYear2: 'E0243401',       // Obj/EM_Vorj - anerkannte Aufwendungen VZ-2
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
  /* Anlage V - DOMESTIC rental property only. Confirmed via direct
     research against the real 2023 Felder/Kontexte sheets that Allg/Lage
     has NO country field: Anlage V is structurally domestic-only.
     Foreign rental income goes to Anlage AUS instead (see AUS below). */
  street: 'E0700407', plz: 'E0700503', ort: 'E0700504',

  /* Allg/Nutzung - three usage declarations, ALL confirmed required
     whenever any property data is given (real ERiC Regeln 100700068,
     100700069, 100750004 against a genuine client file).
     JaNein12BaseCType: "1" = Ja, "2" = Nein. Confirmed row order in the
     real Felder sheet is 703, 705, 704 - NOT numeric order. */
  nutzFerienwohnung: 'E0700703',   // als Ferienwohnung genutzt
  nutzKurzfristig:   'E0700705',   // kurzfristig vermietet
  nutzAngehoerige:   'E0700704',   // an Angehörige zu Wohnzwecken vermietet

  /* Einn/Mieteinn/Whg - each unit needs a LABEL paired with its amount
     (Regel 100750262: "Bezeichnung der Wohneinheit und der zugehörige
     Betrag nicht gemeinsam angegeben"), plus a Sum companion. */
  wohneinheit: 'E0701202',         // Bezeichnung der Wohneinheit
  mieteinnahmen: 'E0700201',       // Zeile 15 Mieteinnahmen
  mieteinnahmenSum: 'E0700206',    // Summe der Mieteinnahmen

  /* Einn/Uml - service charges. Regel 100750265 requires EITHER an
     amount OR an explicit "not separately agreed" declaration. The
     latter is Ja1BaseCType ("1"), a different convention from the
     JaNein12 fields above - confirmed via the real XSD. */
  nebenkosten: 'E0700501',         // laufende Neben-/Betriebskosten
  nebenkostenNichtVereinbart: 'E0702404', // Ja1: "nicht gesondert vereinbart"

  /* Einn/Sum - overall income total (Regel 100700004). */
  einnahmenSum: 'E0701401',

  /* CORRECTED (real mistake, found and fixed via the actual client file
     returning "feldUnbekannt" - not just a Regel violation this time):
     an earlier pass wrongly nested this under a fabricated <Ek_b_Gst>
     wrapper and duplicated the income sum into it. Verified directly
     against the raw 2023 XSD (V_67907_CType, the single definition
     actually used by the <V> element - no ambiguity): Erm_Zuord_Ek is
     a DIRECT child of <V>, a sibling of Allg/Einn/Wk, and its ONLY
     children are E0701601 (Überschuss), E0701801 and E0701802
     (ownership-split attribution for a Gemeinschaft/Gesellschaft).
     E0701401 (income sum) does NOT belong here at all - that field
     lives only under Einn/Sum, which is already correctly emitted
     elsewhere. Confirmed via real Regeln (198, 13) that E0701601 alone
     satisfies both required checks - the attribution fields are not
     needed for a single taxpayer. Since Werbungskosten total is not
     mapped (see note above), Überschuss honestly equals the income
     sum - consistent with the existing "declared income is gross"
     warning given elsewhere for this same limitation. */
  ueberschuss: 'E0701601', // V/Erm_Zuord_Ek - Überschuss (Einnahmen abzüglich Werbungskosten)
  /* Real bug found via testing against a genuine client file (Regel:
     "FeldAngegeben(E0701601) Und FeldNichtAngegeben(E0701801) Und
     FeldNichtAngegeben(E0701802)" -> error): the Überschuss requires an
     attribution to at least one of taxpayer/spouse. Confirmed field
     order via the raw XSD: 601, 801, 802. The app does not collect a
     per-property ownership split, so the full amount is honestly
     attributed to the primary filer (Person A) - correct for the
     common sole-ownership case. When Person B exists on the return, a
     real co-ownership split may apply and is flagged rather than
     guessed (see skippedSections). */
  ueberschussZuordA: 'E0701801', // V/Erm_Zuord_Ek - Zurechnung an steuerpflichtige Person / Person A
  ueberschussZuordB: 'E0701802', // V/Erm_Zuord_Ek - Zurechnung an Ehefrau / Person B

  /* Wk - itemized Werbungskosten (rental deduction costs). Confirmed
     via the real 2025 Kontexte/Felder sheets that this is a genuinely
     elaborate structure (~15 sub-categories, several with a 5-year
     spreadable-maintenance variant with its own multi-year carryover
     breakdown). Deliberately scoped to the five categories that cover
     the large majority of real rental situations - building
     depreciation, loan interest, immediately-deductible maintenance,
     management costs, and a general "other" catch-all - using each
     category's aggregate "Sum" field (Abzugsfähige Werbungskosten)
     rather than requiring full itemized receipt-level detail (the
     Direkt/Einz sub-breakdown some categories also support). The rarer
     categories (special depreciation §7b, 5-year-spread maintenance,
     financing costs, VAT-liable letting) are honestly left unmapped -
     same real gap as before, just narrower now, still flagged via
     skippedSections rather than guessed. Confirmed identical field
     codes for 2021-2023 (inside Ek_b_Gst) and 2024/2025 (flat). */
  wkAfaSum: 'E0703511',       // Wk/AfA_Geb/Sum - Gebäudeabschreibung (building depreciation)
  wkSchuldzinsSum: 'E0703406', // Wk/Schuldzins/Sum - Darlehenszinsen (loan interest)
  wkErhaltungSum: 'E0704412', // Wk/Erhalt_AW_dir/Sum - Erhaltungsaufwand (maintenance/repairs)
  wkVerwaltungSum: 'E0705515', // Wk/Verw_Ko/Sum - Verwaltungskosten (management costs)
  wkSonstSum: 'E0705607',      // Wk/Sonst/Sum - sonstige Werbungskosten (other)

  /* Individual-item fields - CONFIRMED REQUIRED via a real ERiC
     rejection (Regel 100750171/100750204/100750061/100750253/100750259):
     a category's Sum alone is not accepted without at least one backing
     individual entry. Each category's real "Direkt"/"Einz" structure
     is simple - one description plus the same amount - not full
     multi-receipt itemization, confirmed directly against the schema. */
  wkAfaArt: 'E0703302',        // Wk/AfA_Geb/Direkt - Art der Absetzung (1=linear, 2=degressiv)
  wkAfaProzent: 'E0703303',    // Wk/AfA_Geb/Direkt - Prozent
  wkAfaDirekt: 'E0703306',     // Wk/AfA_Geb/Direkt - Werbungskosten (matches wkAfaSum)
  wkSchuldzinsAngaben: 'E0704507', // Wk/Schuldzins/Direkt - Einzelangaben (z.B. Kreditinstitut)
  wkSchuldzinsDirekt: 'E0704508',  // Wk/Schuldzins/Direkt - Werbungskosten (matches wkSchuldzinsSum)
  /* Four newly-implemented rarer categories, confirmed directly
     against the real schema. Special depreciation and 5-year-spread
     maintenance genuinely lack a simple description+amount Direkt
     structure (unlike the other categories) - special depreciation
     uses a real, confirmed two-value enum (1=same as prior year,
     2=per explanation) alongside free text, and this app correctly
     uses "2" with a generic explanation since it doesn't track prior-
     year carryover amounts. 5-year maintenance has a genuinely
     different real structure (total expense + this year's deductible
     portion). VAT-liable letting has only a single field, no Direkt/
     Sum split at all. Financing costs matches the same
     description+amount+sum pattern as loan interest exactly, but its
     Direkt sub-fields are confirmed minYear=2023 (Sum works for all
     years). Confirmed identical across years otherwise. */
  wkSonderabschrArt: 'E0703601', wkSonderabschrErlaeuterung: 'E0703602', wkSonderabschrSum: 'E0703416',
  wk5JGesamt: 'E0703907', wk5JAbzugsfaehig: 'E0704703',
  wkGeldbeschaffAngaben: 'E0704813', wkGeldbeschaffDirekt: 'E0704814', wkGeldbeschaffSum: 'E0704406',
  wkUstPflichtig: 'E0704812',
  wkErhaltungBezeichnung: 'E0703707', // Wk/Erhalt_AW_dir/Einz - Bezeichnung
  wkErhaltungAussteller: 'E0703708',  // Wk/Erhalt_AW_dir/Einz - Rechnungsaussteller
  wkErhaltungDatum: 'E0703709',       // Wk/Erhalt_AW_dir/Einz - Rechnungsdatum
  wkErhaltungGesamt: 'E0704410',      // Wk/Erhalt_AW_dir/Einz - Gesamtbetrag
  wkErhaltungEinz: 'E0703911',        // Wk/Erhalt_AW_dir/Einz - Werbungskosten (matches wkErhaltungSum)
  wkVerwaltungAngaben: 'E0707501', // Wk/Verw_Ko/Direkt - Einzelangaben
  wkVerwaltungDirekt: 'E0707502',  // Wk/Verw_Ko/Direkt - Gesamtbetrag (matches wkVerwaltungSum)
  wkSonstAngaben: 'E0707901', // Wk/Sonst/Direkt - Einzelangaben
  wkSonstDirekt: 'E0707902',  // Wk/Sonst/Direkt - Gesamtbetrag (matches wkSonstSum)
  wkSeWk: 'E0705701', // Wk/Se_WK - overall Werbungskosten total across ALL categories - CONFIRMED
                       // required (Regel 100700003): itemized categories present but no overall
                       // sum stated. Missed in the first pass - only the per-category Sum fields
                       // were mapped, not this required grand total across all of them.
};

/* ---------- Anlage AUS - foreign income (Progressionsvorbehalt) ----------
   Confirmed via direct research: foreign rental income does NOT belong on
   Anlage V (no country field exists there) and NOT on Anlage V-Sonstige
   (that sheet covers partnership shares, sublets and undeveloped land).
   Under a DBA it is normally exempt in Germany but raises the tax rate on
   German income - declared as "steuerfreie Einkünfte mit
   Progressionsvorbehalt" at /AUS/Stfr_Ek_ProgV/P32b/Mitt/Einz. */
const AUS = {
  progStaat: 'E0603901',        // aus dem Staat
  progQuelle: 'E0603902',       // aus der Einkunftsquelle
  progEinkunftsart: 'E0603903', // Einkunftsart
  progEinkuenfte: 'E0603904',   // Einkünfte (net result)
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

/* =============================================================================
   Multi-year support registry
   =============================================================================
   Built from a direct, real comparison of the actual Kontexte structure
   (not just Kennzahl existence) across the 2023, 2024, and 2025
   Jahresdokumentation for every section this app uses. The app's UI
   currently offers 2023-2026 as selectable tax years; 2026 has no
   published ELSTER schema yet (checked directly - genuinely doesn't
   exist, not a bug), so it is excluded from what can be verified here.

   SECTION_YEAR_SUPPORT: sections whose XML STRUCTURE itself changed
   meaningfully between years (not just a field code) - these need a
   real minimum verified year, below which the section is not safely
   generated at all, rather than silently producing structurally wrong
   XML for an older year.
============================================================================= */
const SECTION_YEAR_SUPPORT = {
  /* ESt1A_U previously listed here as 2025-only. RESOLVED (for
     2023-2025) after direct research: confirmed via a full
     field-by-field and Regel-by-Regel comparison of the real
     2023/2024/2025 Jahresdokumentation that every Kennzahl code and
     validation rule is identical across those three years - only the
     XML wrapper differs (2025 added a <Ang_HH_unt_P_Unt_Leist> level).
     buildUnterhalt() in xml-builder.js handles this directly with a
     year-conditional wrapper.

     STILL GATED for 2021/2022, confirmed via direct research (not
     assumed): every one of the 8 Kennzahl codes this section relies on
     (cohabitation, Kindergeld entitlement, other contributor, assets,
     own-income declaration, foreign confirmation) is genuinely MISSING
     from the real 2021 and 2022 XSDs - not just a different wrapper,
     the codes themselves don't exist under these numbers. ESt1A_U
     itself does exist for those years (77-80 fields), so the deduction
     category isn't unsupported by ELSTER - our specific implementation
     just hasn't been researched against whatever the era-correct field
     set was. That's real, separate research work, not attempted here
     rather than guessed at.

     RESOLVED for 2021/2022 too: full research completed (65 real
     Regeln analyzed), confirming a genuinely separate structure - the
     amount lives under a different context (AW_U/U_Zlg, needed
     alongside AW_U/U_Ztr), and the Yes/No pattern is replaced with
     opposite-polarity JaXBaseCType statement flags. Implemented as a
     completely separate function, buildLegacyUnterhalt() in
     xml-builder.js, gated to years < 2023 - the confirmed-working
     2023+ path (buildUnterhalt()) is untouched.

     Foreign households for 2021/2022 RESOLVED too (second research
     pass): maps directly onto the same foreignNeedConfirmed concept
     already collected for 2023+, just a different field
     (E0120209/E0120210 mutually-exclusive pair instead of a single
     Ja/Nein). Country list confirmed identical between 2021 and 2022,
     extracted directly from the real XSD. */
};

/* FIELD_YEAR_SUPPORT: individual fields whose CODE is genuinely
   year-gated but the surrounding structure is stable - confirmed via
   direct existence checks against the real 2023/2024/2025 XSDs. */
const FIELD_YEAR_SUPPORT = {
  E0201606: { minYear: 2025, section: 'N', note: 'granular multi-year pension income breakdown, genuinely new in 2025' },
  E0183001: { minYear: 2024, section: 'SA (Realsplitting)', note: 'domestic/foreign residence flag for Anlage U, genuinely new in 2024 - structure itself (SA/Weit_Aufw/U_Leist) confirmed stable across all three years' },
  E0203003: { minYear: 2023, section: 'N/Wk/EP/Erste_Taetig (commute destination type)', note: 'real bug found via an actual ERiC rejection ("Ziel des Weges" not supported for 2022) - checked directly against the schema for every year: genuinely absent for 2020-2022, present from 2023 onward. The rest of the commute field group (E0203501/503/504/505/506) is confirmed stable across all six years - this one field specifically is the only part of that group with a real year boundary.' },
  E0704813: { minYear: 2023, section: 'V/Wk/Geldbeschaff/Direkt (financing costs description)', note: 'checked directly against the schema for every year - genuinely absent for 2021-2022, present from 2023 onward. The Sum field (E0704406) is stable across all years, so financing costs can still be sent for earlier years via Sum alone.' },
  E0704814: { minYear: 2023, section: 'V/Wk/Geldbeschaff/Direkt (financing costs amount)', note: 'same real year boundary as E0704813, confirmed together.' },
};

function isSectionSupportedForYear(section, year) {
  const rule = SECTION_YEAR_SUPPORT[section];
  if (!rule) return true; // no known restriction = assumed stable, matching every other field in this app
  return year >= rule.minYear;
}
function isFieldSupportedForYear(code, year) {
  const rule = FIELD_YEAR_SUPPORT[code];
  if (!rule) return true;
  return year >= rule.minYear;
}

module.exports = {
  ESt1A, N, VOR, SA, Kind, N_DHH, N_DHH_LEGACY, HA_35a, KAP, Sonst, SO, ESt1A_U, N_AUS, AgB, EM_35c, ESt1A_Ersatz, R, V, AUS,
  isSlotResolved, unresolvedFields, sumEmployerField, routeToVOR, computeAusTaxFree, amountToPflegegrad,
  SECTION_YEAR_SUPPORT, FIELD_YEAR_SUPPORT, isSectionSupportedForYear, isFieldSupportedForYear,
};
