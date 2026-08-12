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
   written. As of this update:
     - anlageR (pensions) - NOW MAPPED. Both statutory and private
       Leibrenten, using the CORRECTED gesetzlich/privat percentage logic
       (see eric-fieldmap.js R section - the earlier assumption that only
       private pensions carry a percentage was backwards).
     - anlageV (rental) - PARTIALLY mapped. Property address and rental
       income are written; Werbungskosten (deductible costs) are
       deliberately NOT written - the real schema wants an itemized
       category breakdown (189 fields total) our app's simple lump-sum
       cost model cannot honestly represent. Still skipped, now for a
       documented reason rather than "not yet researched".
     - anlageKind.betreuungskosten (childcare amount) - Kennzahlen NOW
       KNOWN (resolved via the Kind - Regeln validation-rule trick, not
       keyword search - see eric-fieldmap.js Kind section). Still NOT
       written here: a real ERiC rule (Fehlercode 514139) requires the
       provider name/address and service period to be submitted together
       with the amount, and our app only collects a single lump-sum
       number today - sending just the amount would fail that rule. This
       is a UI gap now, not a research gap.
   This means: rental Werbungskosten and childcare amounts will NOT appear
   in the output XML, by design, not by bug or oversight.
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
function N(v) {
  const n = parseFloat(String(v ?? '0').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
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
/* CONFIRMED via the real XSD: most monetary Kennzahlen are "Ganzzahl"
   (whole euros, NO decimal separator at all - not even ",00") - only a
   specific 13-field group (the Anlage N Einz/Sum wage lines plus the KAP
   withholding lines) are genuinely "Dezimalzahl" (comma-decimal allowed).
   Confirmed field-by-field against the XSD, not assumed - using euroTag
   (comma-decimal) for a Ganzzahl field is exactly what produced the
   "zahlHatDezimalTrenner" errors from real ERiC validation. */
function wholeEuro(n) {
  const v = Math.round(Number(n) || 0);
  if (v === 0) return null;
  return String(v);
}
function wholeEuroTag(name, n) {
  const v = wholeEuro(n);
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

  /* CORRECTED: removed the unconditional E0100002 (Arbeitnehmer-Sparzulage
     request) checkbox - real ERiC validation confirmed this specific
     checkbox has its own deeper conditional requirement (all VL
     certificates must additionally be flagged) that our app has no
     matching feature for. Blanket-checking "yes" to a request we cannot
     actually back up is wrong - only E0100001/E0100003 (general
     declaration + advisor involvement) are unconditionally safe. */
  xml += '<Art_Erkl>\n' + tag('E0100001', 'X') + tag('E0100003', 'X') + '</Art_Erkl>\n';

  xml += '<Allg><A>\n';
  /* REMOVED: E0100081 (taxId) - confirmed via official ELSTER developer
     forum (product manager response) to be an "internes ERiC Feld" that
     MUST NOT be submitted directly. ERiC auto-populates it from
     Vorsatz/ID instead - see buildVorsatz() below. Directly submitting
     this field is exactly what caused "Eingefuegt-Kennzeichen J oder P"
     / ERIC_IO_READER_UNERWARTETE_ELEMENTE. */
  /* CORRECTED (element order): confirmed via the real official ELSTER
     example that the correct sequence is Geburtsdatum, Name, Vorname,
     Religion, Strasse, PLZ, Ort - NOT the order these were originally
     added in across several separate fixes. XSD sequence types enforce
     order strictly; getting this wrong passed our own structural tests
     (which only check field presence, not order) but failed real ERiC's
     basic schema validation (ERIC_IO_READER_SCHEMA_VALIDIERUNG,
     610301200) - a more fundamental layer than the business-rule checks
     debugged in earlier rounds, and a real regression worth having
     caught sooner. */
  xml += tag(fm.ESt1A.birthDate, formatDateDE(A.geburtsdatum));
  xml += tag(fm.ESt1A.lastName, A.name);
  xml += tag(fm.ESt1A.firstName, A.vorname);
  /* CORRECTED: confirmed via real ERiC validation ("enthält einen
     ungültigen Wert") and the real XSD enum that E0100402 wants 2-digit
     NUMERIC codes (11=none, 03=katholisch, 02=evangelisch), not the
     frontend's letter codes (--/RK/EV/VD). The frontend's mapping was
     never wrong for its own display purposes - this conversion was
     simply never added on the way into the XML. Rarer denominations
     (frontend's "VD"/other) fall back to "11" (none/not liable) rather
     than guess a specific denomination code from a very long enum - a
     known, documented limitation, not a silent wrong guess. */
  const religionCode = { '--': '11', RK: '03', EV: '02' }[A.religion] || '11';
  xml += tag(fm.ESt1A.religion, religionCode);
  xml += tag('E0101104', [A.anschrift?.strasse, A.anschrift?.hausnummer].filter(Boolean).join(' '));
  xml += tag(fm.ESt1A.plz, A.anschrift?.plz);
  xml += tag(fm.ESt1A.ort, A.anschrift?.ort);
  /* CORRECTED (structural): marital status flags belong INSIDE Allg/A.
     CORRECTED (semantic, confirmed via real XSD): maritalMarried
     (E0100701) and maritalWidowed (E0100702) are actually DATE fields
     ("verheiratet SEIT DEM ...", "verwitwet SEIT DEM ...") - not simple
     checkboxes. Sending 'X' triggered "datumFormatFalsch". The app does
     not currently collect an actual marriage/widowhood date anywhere -
     this is a REAL GAP needing a UI addition (a date field per status),
     not a code-only fix - so these two are correctly NOT sent for now
     rather than sent with a wrong value. maritalSeparateAssessment
     (E0102602, § 26a) IS confirmed to be a genuine checkbox (JaXBaseCType)
     - that one is correct as-is, and per the real example's order, comes
     LAST within the A block (it's the final field shown, right before
     </A> closes). */
  /* CORRECTED: confirmed via real ERiC validation ("feldUnbekannt" - not
     supported for the given Veranlagungsart) that § 26a separate
     assessment logically requires an actual Person B to exist - it makes
     no sense to declare "separate assessment of spouses" with no spouse
     data present. If the test data selected this status without
     providing personB, that is itself a data-consistency issue worth
     checking, but this guard also protects against sending an
     inconsistent declaration regardless. */
  if (h.veranlagungsart === 'einzelveranlagung_ehegatten_par26a' && B) {
    xml += tag(fm.ESt1A.maritalSeparateAssessment, 'X');
  }
  xml += '</A>';
  /* CORRECTED: confirmed via real ERiC validation ("kontextLeer" - "the
     context is empty") that an empty <B></B> block (when B exists as an
     object but has no populated fields, since taxIdSpouse was removed
     and spouseBirthDate may be blank) is itself invalid - a context
     must either have content or not be written at all. */
  /* CORRECTED: element ORDER matters strictly in XSD (xs:sequence) -
     confirmed via the real official ELSTER example that Person B's
     fields must appear as Geburtsdatum, THEN Name, THEN Vorname - my
     earlier addition of the name fields put them in the wrong order
     (Name/Vorname before Geburtsdatum), which passed our own structural
     tests (they only check presence, not order) but failed real ERiC's
     basic XML schema validation (ERIC_IO_READER_SCHEMA_VALIDIERUNG,
     610301200) - a more fundamental layer than the business-rule checks
     we'd been debugging, and a genuine regression from that specific fix. */
  const bContent = B ? (tag(fm.ESt1A.spouseBirthDate, formatDateDE(B.geburtsdatum)) + tag(fm.ESt1A.spouseLastName, B.name) + tag(fm.ESt1A.spouseFirstName, B.vorname)) : '';
  if (bContent) {
    xml += `<B>\n${bContent}</B>`;
  }
  /* CORRECTED: confirmed via real ERiC validation ("Bitte geben Sie Ihre
     Bankverbindungsdaten an oder erklären Sie...dass keine Bankverbindung
     vorhanden ist") that this is a genuinely required declaration - either
     real bank details or an explicit "none" flag, not silently omittable.
     The IBAN itself was already being collected and exported by the
     frontend (hauptvordruck.bankverbindung.iban) but never wired into the
     XML at all until now. */
  const iban = (h.bankverbindung?.iban || '').trim();
  if (iban) {
    xml += `<BV>\n${tag(fm.ESt1A.ibanDomestic, iban)}<Kto_Inh>${tag(fm.ESt1A.accountHolderIsTaxpayer, 'X')}</Kto_Inh>\n</BV>\n`;
  } else {
    xml += `<BV>\n${tag(fm.ESt1A.noBankAccount, 'X')}</BV>\n`;
  }
  xml += '</Allg>\n';

  const w = data.weitereAngaben || {};
  /* CORRECTED: real bug found via testing against a genuine client file
     - same bug class as buildR() earlier (missing Person tag, confirmed
     unconditionally required via real ERiC mandatoryField validation). */
  if (w.ersatzleistungen) xml += `<Eink_Ers><Person>PersonA</Person><Inl><Sum>\n${wholeEuroTag(fm.ESt1A_Ersatz.ersatz, w.ersatzleistungen)}</Sum></Inl></Eink_Ers>\n`;

  xml += '</ESt1A>\n';
  return xml;
}

/* =============================================================================
   Anlage N - employment income, one block per employer-slot, grouped by
   person, with the confirmed Einz (per employer) / Sum (person total)
   structure. buildElsterDataset(c) gives us a flat anlageN[] array with
   one entry PER EMPLOYER already (person:'A'|'B') - we group and sum here.
============================================================================= */
/* Shared by buildAnlageN and buildNAUS - confirmed via real Regel 0/1/7
   that Anlage N's dba16 (E0201502) must EXACTLY equal the sum of all of
   this person's N-AUS computed DBA-exempt amounts (E2604901). Computed
   once here so both call sites can never drift apart. Only counts
   entries with both day counts present (2023+ only - legacy years are
   gated separately, see buildNAUS). */
function computeNausDbaTotalForPerson(data, person) {
  const year = data.meta?.taxYear || 2025;
  if (year < 2023) return 0;
  const entries = (data.anlageNAUS || []).filter(a => (a.person === 'B') === (person === 'B'));
  return entries.reduce((sum, a) => {
    if (!(N(a.gesamtlohn) > 0) || !(N(a.arbeitstageGesamt) > 0) || !(N(a.arbeitstageAusland) > 0)) return sum;
    const remaining = Math.max(0, Math.round(N(a.gesamtlohn) - N(a.steuerfreierBetrag)));
    return sum + fm.computeAusTaxFree(remaining, Math.round(N(a.arbeitstageAusland)), Math.round(N(a.arbeitstageGesamt)));
  }, 0);
}

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
    /* CORRECTED: confirmed via real XSD that E0200201 specifically is
       Ganzzahl (whole number) - an asymmetric exception, since its
       sibling sums (wageTax/soli/churchPaid below) are genuinely
       Dezimalzahl. Verified per-field from the XSD, not assumed as a
       uniform pattern. */
    xml += wholeEuroTag(fm.N.gross.sum, sum('zeile3_bruttoarbeitslohn'));
    xml += euroTag(fm.N.wageTax.sum, sum('zeile4_lohnsteuer'));
    xml += euroTag(fm.N.soli.sum, sum('zeile5_soli'));
    xml += euroTag(fm.N.churchPaid.sum, sum('zeile6_kirchensteuer'));
    xml += '</LStB_1_5_Sum>\n';

    /* remaining confirmed single-value lines - taken from the FIRST employer entry
       (these lines are rarely split across multiple employers in practice) */
    const first = list[0];
    xml += wholeEuroTag(fm.N.vb8.kennzahlen[0], first.zeile8_versorgungsbezuege);
    /* YEAR GATE: E0201606 confirmed genuinely new in 2025 via direct XSD
       comparison against 2023/2024 - simply omitted for earlier years,
       the underlying amount is still captured within the broader
       Bruttoarbeitslohn total either way, so this is a lossless omission,
       not a missing-data situation. */
    if (fm.isFieldSupportedForYear('E0201606', data.meta?.taxYear || 2025))
      xml += wholeEuroTag(fm.N.vb9.kennzahlen[0], first.zeile9_versorgungMehrjaehrig);
    xml += wholeEuroTag(fm.N.ml10.kennzahlen[0], first.zeile10_mehrjaehrigEntschaedigung);
    xml += wholeEuroTag(fm.N.ersatz15.kennzahlen[0], first.zeile15_lohnersatz);
    /* CORRECTED: dba16 needs its own ArbL/Stfr_NAUS wrapper, confirmed via
       the real Felder sheet Kontext column - was flat directly under
       ArbL, causing "/N/ArbL/E0201502" to be unrecognized. */
    /* CORRECTED: real bug found via testing against a genuine client
       file (Regel 100260069) - whenever N-AUS entries exist for this
       person, Anlage N itself must ALSO state how many, in the SAME
       Stfr_NAUS wrapper (confirmed field order: dba16 amount, then two
       unmapped fields, then this count, last). Previously the wrapper
       was only emitted if a DBA/ATE amount existed - now also emitted
       (with 0 for the amount) if there are N-AUS entries without one,
       since the count itself is what's required. */
    const nAusCountForPerson = (data.anlageNAUS || []).filter(a => (a.person === 'B') === (person === 'B')).length;
    /* CORRECTED (major): previously used a separate, manually-entered
       figure (zeile16_dbaAte) that could drift from what N-AUS itself
       computes - confirmed via real Regel 0/1/7 that these two MUST be
       identical, not just both present. Now computed from the same
       shared helper N-AUS uses, guaranteeing they can never mismatch. */
    const dbaTotal = computeNausDbaTotalForPerson(data, person);
    if (dbaTotal > 0 || nAusCountForPerson > 0) {
      xml += '<Stfr_NAUS>';
      xml += `<${fm.N.dba16.kennzahlen[0]}>${dbaTotal}</${fm.N.dba16.kennzahlen[0]}>\n`;
      if (nAusCountForPerson > 0) xml += tag(fm.N.nAusCount, String(nAusCountForPerson));
      xml += '</Stfr_NAUS>\n';
    }
    /* REMOVED (real bug found via a genuine client submission returning
       "feldUnbekannt"): this field was placed directly under ArbL, but
       its confirmed real context is Wk/AWT/Fahrt - a Werbungskosten
       travel-cost sub-section, not a wage-certificate line under ArbL
       at all. Same bug class as the already-fixed E0205630 case just
       above, but the correct fix here needs its own dedicated check
       first - E0205630 turned out to be a genuinely different concept
       once properly researched (VMA_Ersatz, not the field this app's
       own field name suggested), and this one may well be the same.
       Rather than guess a second placement without that same level of
       confirmation, this is honestly surfaced via skippedSections in
       buildEStXML below instead of silently sent to a location already
       proven wrong. */
    xml += wholeEuroTag(fm.N.pausch18.kennzahlen[0], first.zeile18_pauschal15);
    /* CORRECTED: real bug found via testing against a genuine client file
       ("feldUnbekannt" for /N/ArbL/E0205630). Same bug class as dba16
       above (wrong parent context), but with a deeper problem behind it:
       E0205630's real context is Wk/VMA/Ausl/Sum - the SUM OF CLAIMED
       foreign-travel meal expenses, a Werbungskosten figure, NOT the
       tax-free employer reimbursement from Lohnsteuerbescheinigung
       Zeile 20 that this app actually collects. Genuinely different
       concepts, so this was never just a misplaced tag.
       The correct home for Zeile 20 is E0205108 (Wk/VMA/VMA_Ersatz,
       "Vom Arbeitgeber steuerfrei ersetzt") - but that field only makes
       sense alongside the corresponding travel-expense claim (days away,
       countries, per-diem rates), none of which this app collects.
       Sending a lone reimbursement figure with no matching expenses
       would be an incomplete and likely rejected declaration. Correctly
       surfaced via skippedSections instead of guessed. */
    xml += wholeEuroTag(fm.N.bmg29.kennzahlen[0], first.zeile29_bmgVersorgungsfreibetrag);
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
    /* CORRECTED: real gap found via direct feedback and confirmed by
       checking the actual backend directly - the commute
       (Entfernungspauschale) fields and the itemized Werbungskosten
       entries were being calculated correctly in the app's own
       estimate, but never actually transmitted to ELSTER at all, for
       any year. Fixed by checking the real ERiC-44.2.4.0 schema
       documentation directly (E10-2020.html through E10-2025.html -
       confirmed identical Kennzahlen across every one of those years,
       no year-gate needed here). Placed flat under ArbL, the same
       proven placement as the neighboring E0203901 field (pausch18) in
       this exact numeric family, which is already confirmed working. */
    const wk = data.werbungskosten && data.werbungskosten['person' + person];
    if (wk && wk.entfernungspauschale) {
      const ep = wk.entfernungspauschale;
      if (N(ep.arbeitstage) > 0) xml += wholeEuroTag(fm.N.commuteDays.kennzahlen[0], ep.arbeitstage);
      if (N(ep.einfacheEntfernungKm) > 0) {
        const km = Math.round(N(ep.einfacheEntfernungKm)); // schema requires a whole number ("auf volle Kilometer abgerundet")
        if (ep.verkehrsmittel === 'car') xml += wholeEuroTag(fm.N.commuteKmCar.kennzahlen[0], km);
        else xml += wholeEuroTag(fm.N.commuteKmOther.kennzahlen[0], km);
      }
      if (ep.verkehrsmittel === 'public' && N(ep.oeffentlicheKosten) > 0)
        xml += wholeEuroTag(fm.N.commutePublicCost.kennzahlen[0], Math.round(N(ep.oeffentlicheKosten)));
    }
    /* Itemized Werbungskosten (WKI_TYPES) - transmitted as a single,
       verified total (Weitere_Wk/Sum/E0204803), summed here from the
       real per-entry amounts the app already collects and already
       exports, rather than mapping each of the 11 individual
       categories to its own Kennzahl, which would need further
       dedicated research to do safely. */
    const items = (data.werbungskosten && data.werbungskosten.einzelposten || []).filter(x => x.person === person);
    const itemsSum = items.reduce((a, x) => a + (N(x.betrag) || 0), 0);
    if (itemsSum > 0) xml += wholeEuroTag(fm.N.weitereWkSum.kennzahlen[0], Math.round(itemsSum));
    xml += '</ArbL></N>\n';
  }
  return xml;
}

/* =============================================================================
   Anlage N-AUS - foreign employment DBA calculator. NEWLY WIRED IN (was
   mapped in eric-fieldmap.js and collected by the app's calculator UI,
   but never exported to the interchange JSON at all - a broken link
   further upstream than the XML builder itself, not a missing builder).
   SCOPE: only the fields the app actually collects are written -
   employer address (street/plz/city/country) has no data source
   anywhere in the app (employer is a single free-text name field) and
   is deliberately NOT invented here. This is a smaller subset of the
   already-deliberately-scoped N_AUS feature (see eric-fieldmap.js N_AUS
   comment - the full official form has 82 fields, this covers the
   common day-apportionment case only).
============================================================================= */
function buildNAUS(data) {
  const entries = data.anlageNAUS || [];
  if (!entries.length) return '';
  const year = data.meta?.taxYear || 2025;
  let xml = '';
  for (const a of entries) {
    /* Year gate: confirmed via direct field-existence check against the
       real 2021/2022 XSDs that E2600503 (legal basis) and E2600703
       (dual residence) are genuinely missing that year - not renamed,
       structurally different (2022 uses an opposite-polarity statement
       PAIR for dual residence, same pattern as the legacy Anlage
       Unterhalt/Kind structures already researched separately in this
       project). Rather than guess that structure under time pressure,
       this is honestly gated pending its own dedicated research pass -
       the same discipline already applied to Unterhalt and Kind. */
    if (year < 2023) continue;

    xml += `<N_AUS><Person>Person${a.person === 'B' ? 'B' : 'A'}</Person><Staat>\n`;
    /* CORRECTED (major, second pass): confirmed via the raw XSD content
       model that E2600401 (Staat/Staat) is the primary work country -
       genuinely different from the field used before (E2601001, which
       is the Wohnsitz/foreign-residence country, only relevant when
       dual residence applies). */
    if (a.land) xml += tag(fm.N_AUS.ausCountry, a.land);

    let allg = '';
    /* Legal basis - confirmed required (Regel 14). Defaults to DBA
       ("1"), the standard double-taxation-treaty basis and the common
       case for German employees working abroad. ATE (special
       intergovernmental development-aid agreements) and ZÜ (other
       multilateral treaties, e.g. NATO/diplomatic postings) are
       genuinely different, narrower legal bases this app does not
       collect enough information to complete correctly - flagged via
       skippedSections below rather than guessed if selected. */
    const basis = a.legalBasis || 'dba';
    allg += tag(fm.N_AUS.ausLegalBasis, basis === 'ate' ? '2' : basis === 'zu' ? '3' : '1');

    /* Dual residence - confirmed required (Regel 22). Defaults to
       "Nein", the common case (foreign assignment without maintaining
       a second residence abroad) - only asks for the foreign address
       and center-of-interests declaration if the user says Yes. */
    const dual = !!a.dualResidence;
    allg += `<Wohnsitz>\n${tag(fm.N_AUS.ausDualResidence, dual ? '1' : '2')}`;
    if (dual) {
      if (a.foreignResStreet) allg += tag(fm.N_AUS.ausForeignResStreet, a.foreignResStreet);
      if (a.foreignResPlz) allg += tag(fm.N_AUS.ausForeignResPlz, a.foreignResPlz);
      if (a.foreignResCity) allg += tag(fm.N_AUS.ausForeignResCity, a.foreignResCity);
      if (a.foreignResCountry) allg += tag(fm.N_AUS.ausForeignResCountry, a.foreignResCountry);
      allg += tag(fm.N_AUS.ausCenterOfInterests, a.centerOfInterests ? '1' : '2');
    }
    allg += '</Wohnsitz>\n';

    /* Employer - CORRECTED (major): confirmed via the raw XSD that the
       real context is Allg/ArbG, not Unternehmen (a different,
       unrelated field for a narrow related-company exception). Name
       comes before street in the confirmed real field order.
       CORRECTED (second pass): confirmed via the real Regel 24
       (FelderNichtGemeinsamAngegeben across all five fields) that this
       is genuinely all-or-nothing - sending name without a complete
       address (or vice versa) is rejected the same as sending nothing,
       so a partial set is now honestly omitted with a clear warning
       rather than sent and rejected. */
    const employerComplete = a.arbeitgeberName && a.arbeitgeberStreet && a.arbeitgeberPlz && a.arbeitgeberCity && a.arbeitgeberCountry;
    if (employerComplete) {
      allg += '<ArbG>\n';
      allg += tag(fm.N_AUS.ausEmployerName, a.arbeitgeberName);
      allg += tag(fm.N_AUS.ausEmployerStreet, a.arbeitgeberStreet);
      allg += tag(fm.N_AUS.ausEmployerPlz, a.arbeitgeberPlz);
      allg += tag(fm.N_AUS.ausEmployerCity, a.arbeitgeberCity);
      allg += tag(fm.N_AUS.ausEmployerCountry, a.arbeitgeberCountry);
      allg += '</ArbG>\n';
    }

    /* Activity description + period - confirmed required together
       (Regel 26/28). Full date range including years, a genuinely
       different type from the month-only ranges used elsewhere in
       this schema - confirmed via the raw XSD, not assumed uniform. */
    if (a.taetigkeitDesc && a.taetigkeitVon && a.taetigkeitBis) {
      allg += `<Taetigk><Art_Zeitr>\n${tag(fm.N_AUS.ausActivityDesc, a.taetigkeitDesc)}${tag(fm.N_AUS.ausActivityPeriod, formatDateRangeFullDE(a.taetigkeitVon, a.taetigkeitBis))}</Art_Zeitr>\n`;
      const daysAbroad = Math.round(N(a.arbeitstageAusland));
      if (daysAbroad > 0) allg += `<Tage>\n${tag(fm.N_AUS.ausDaysAbroad, String(daysAbroad))}</Tage>\n`;
      allg += '</Taetigk>\n';
      /* Real requirement found via testing against a genuine client
         file (Regel 30) - confirmed sibling of Taetigk, not nested
         inside it. Only relevant/required under 184 days abroad;
         above that, the standard 183-day exemption applies without
         needing this. This is a genuine legal distinction the app
         cannot safely guess - if the days are short and no basis is
         given, this is flagged via skippedSections rather than
         defaulted to any of the six options. */
      if (daysAbroad > 0 && daysAbroad < 184 && a.shortStayBasis) {
        const key = 'ausShortStay' + a.shortStayBasis;
        if (a.shortStayBasis === 'Other') {
          if (a.shortStayBasisText) allg += `<Taetigk_Vertr>\n${tag(fm.N_AUS.ausShortStayOther, a.shortStayBasisText)}</Taetigk_Vertr>\n`;
        } else if (fm.N_AUS[key]) {
          allg += `<Taetigk_Vertr>\n${tag(fm.N_AUS[key], 'X')}</Taetigk_Vertr>\n`;
        }
      }
    }
    if (allg) xml += `<Allg>\n${allg}</Allg>\n`;

    let remaining = 0;
    if (N(a.gesamtlohn) > 0) {
      /* CORRECTED: real bug, genuinely my own mistake, not a
         documentation gap - bypassing wholeEuroTag() to force explicit
         zero-emission also meant bypassing its rounding, so a
         non-integer result (from float subtraction, e.g. entered cents)
         was sent as a raw decimal, which ERiC correctly rejects
         ("zahlHatUngueltigeZeichen"). Rounded explicitly here instead. */
      remaining = Math.max(0, Math.round(N(a.gesamtlohn) - N(a.steuerfreierBetrag)));
      xml += `<Ang_ArbL><Sum_inl_ausl_AL>${wholeEuroTag(fm.N_AUS.ausTotalWage, a.gesamtlohn)}</Sum_inl_ausl_AL><Verbl><${fm.N_AUS.ausRemainingWage}>${remaining}</${fm.N_AUS.ausRemainingWage}></Verbl></Ang_ArbL>\n`;
    }

    /* CORRECTED (major): the tax-free result was previously a direct
       pass-through of the user's rough estimate (steuerfreierBetrag).
       Confirmed via the real formula (Regel 52) that ELSTER expects
       this computed via days-proportion: remaining wage × foreign work
       days / total work days - the same two-step structure the real
       Lohnsteuerbescheinigung uses (a rough estimate feeding the
       "remaining" base, then a formula-based recalculation for the
       actual transferred amount). Only computed when both day counts
       are present - otherwise honestly flagged via skippedSections
       rather than guessed. */
    if (N(a.arbeitstageGesamt) > 0 && N(a.arbeitstageAusland) > 0) {
      const totalDays = Math.round(N(a.arbeitstageGesamt));
      const foreignDays = Math.round(N(a.arbeitstageAusland));
      const calculated = fm.computeAusTaxFree(remaining, foreignDays, totalDays);
      let dbaInner = tag(fm.N_AUS.ausWorkDaysTotal, String(totalDays));
      dbaInner += tag(fm.N_AUS.ausWorkDaysForeign, String(foreignDays));
      dbaInner += `<${fm.N_AUS.ausDbaCalculated}>${calculated}</${fm.N_AUS.ausDbaCalculated}>\n`;
      dbaInner += `<${fm.N_AUS.ausTaxFreeResult}>${calculated}</${fm.N_AUS.ausTaxFreeResult}>\n`;
      xml += `<ArbL_DBA>\n${dbaInner}</ArbL_DBA>\n`;
    }
    xml += '</Staat></N_AUS>\n';
  }
  return xml;
}

/* =============================================================================
   Vorsorgeaufwand - pension/insurance, including the routed employment lines
============================================================================= */
function buildVOR(data) {
  const v = data.anlageVorsorgeaufwand;
  if (!v) return '';
  const l = v.ausLohnsteuerbescheinigungen || {};
  let inner = '';
  /* CORRECTED nesting - confirmed via the real Kennzahlen sheet paths.
     Was flat (<VOR><E2000601>), which caused ERIC_IO_READER_UNERWARTETE_ELEMENTE
     - ERiC could not find meta-information for ANY field at the wrong
     nesting depth, even fields with genuinely correct Kennzahl codes. */
  /* CORRECTED: <Person> is a REQUIRED sibling in both sub-blocks below,
     confirmed via real ERiC validation ("mandatoryField"). Defaults to
     PersonA since the app currently collects insurance contributions as
     one pooled figure, not split per spouse. */
  /* CONFIRMED via real ERiC validation (Regel 950020): E2000401
     (Arbeitnehmeranteil) and E2000801 (Arbeitgeberanteil) must be
     declared TOGETHER, explicitly with 0 if not otherwise available -
     our app only collects one combined rv figure (the employee's own
     contribution), so the employer portion is sent as 0 rather than
     omitted, since omitting it entirely is exactly what caused this
     error. wholeEuroTag() would otherwise silently drop a zero value,
     so this writes the tag directly instead. */
  if (N(l.rv) > 0) inner += `<AVor><Person>PersonA</Person>\n${wholeEuroTag(fm.VOR.rv, l.rv)}<${fm.VOR.rvArbeitgeber}>0</${fm.VOR.rvArbeitgeber}>\n</AVor>\n`;
  if (N(l.gkv) > 0 || N(l.pv) > 0) {
    inner += '<Beitr_g_KV_PV_Inl><Person>PersonA</Person><AN>\n';
    inner += wholeEuroTag(fm.VOR.kv, l.gkv);
    inner += wholeEuroTag(fm.VOR.pv, l.pv);
    inner += '</AN></Beitr_g_KV_PV_Inl>\n';
  }
  /* NOTE: v.privateVersicherungen (Haftpflicht etc.) are collected by the
     app but not yet mapped to a VOR Kennzahl - most private insurance
     types outside statutory RV/KV/PV are either non-deductible or belong
     to a different context not yet researched. Not written here rather
     than guessed. kvOther (pkv28) also not yet placed in this corrected
     structure - needs its own confirmed nesting before use. */
  /* CORRECTED: real bug found via the architectural review's empirical
     test - anlageVorsorgeaufwand being an empty object ({}, truthy) but
     with no actual contribution amounts still produced a bare, empty
     <VOR></VOR> wrapper, triggering ERiC's "kontextLeer" (empty context)
     error. Now only emits the wrapper at all if there's genuinely
     something inside it. */
  return inner ? `<VOR>\n${inner}</VOR>\n` : '';
}

/* =============================================================================
   Anlage KAP - capital gains, field names already match Zeile numbers.
   CORRECTED nesting per line-group, confirmed via the real Kennzahlen sheet.
============================================================================= */
function buildKAP(data) {
  const entries = data.anlageKAP || [];
  if (!entries.length) return '';
  let xml = '';
  const personsWithBlock = new Set();
  /* CORRECTED: real bug found via testing against a genuine client file
     (Regel 193035) - for a joint filing (Zusammenveranlagung), if
     EITHER spouse's domestic withheld gains trigger Günstigerprüfung,
     BOTH must request it, not just the person who individually
     triggered it. Computed once up front, applied consistently below -
     to every existing block, not just the one that happened to have g1
     itself. */
  const anyGuenstiger = data.hauptvordruck?.personB && entries.some(k =>
    N(k.zeile7_kapitalertraege) > 0 || N(k.zeile8_aktiengewinne) > 0
    || N(k.zeile12_verlusteOhneAktien) > 0 || N(k.zeile13_verlusteAktien) > 0);
  for (const k of entries) {
    let inner = '';
    const g1 = wholeEuroTag(fm.KAP.k7, k.zeile7_kapitalertraege) + wholeEuroTag(fm.KAP.k8, k.zeile8_aktiengewinne)
      + wholeEuroTag(fm.KAP.k12, k.zeile12_verlusteOhneAktien) + wholeEuroTag(fm.KAP.k13, k.zeile13_verlusteAktien);
    if (g1) inner += `<KapErt_inl_StAbz><Betr_lt_StBesch>\n${g1}</Betr_lt_StBesch></KapErt_inl_StAbz>\n`;
    /* CORRECTED: real bug found via the multi-year regression test
       (Regel 192036) - whenever Günstigerprüfung is requested (which
       happens automatically whenever g1/domestic withheld gains are
       present), the Sparer-Pauschbetrag USED must ALSO be stated,
       explicitly as 0 if the user hasn't used any - wholeEuroTag()
       would otherwise silently omit a zero value, which is exactly
       what caused this error despite the field being "collected" (just
       never written when it was 0). */
    const g2 = g1 ? `<${fm.KAP.k16}>${N(k.zeile16_sparerPauschbetragGenutzt)}</${fm.KAP.k16}>\n` : wholeEuroTag(fm.KAP.k16, k.zeile16_sparerPauschbetragGenutzt);
    if (g2) inner += `<Sp_PB>\n${g2}</Sp_PB>\n`;
    const g3 = wholeEuroTag(fm.KAP.k18, k.zeile18_inlaendischOhneSteuerabzug) + wholeEuroTag(fm.KAP.k19, k.zeile19_auslaendisch)
      + wholeEuroTag(fm.KAP.k20, k.zeile20_aktiengewinne) + wholeEuroTag(fm.KAP.k21, k.zeile21_stillhalterTermingeschaefte)
      + wholeEuroTag(fm.KAP.k22, k.zeile22_verlusteOhneAktien) + wholeEuroTag(fm.KAP.k23, k.zeile23_verlusteAktien);
    if (g3) inner += `<KapErt_kein_inl_StAbz>\n${g3}</KapErt_kein_inl_StAbz>\n`;
    const g4 = euroTag(fm.KAP.k43, k.zeile43_kapitalertragsteuer) + euroTag(fm.KAP.k44, k.zeile44_soli)
      + euroTag(fm.KAP.k45, k.zeile45_kirchensteuer);
    if (g4) inner += `<St_Abz_Betr_Inl_u_Inv_Ert>\n${g4}</St_Abz_Betr_Inl_u_Inv_Ert>\n`;
    /* CORRECTED: same class of bug found via the architectural review's
       empirical test (originally surfaced in buildVOR) - an entry with
       no actual populated amounts would still have produced an empty
       <KAP><Person>.../<KAP> wrapper, triggering ERiC's "kontextLeer"
       error. Now only emits per-entry if there's genuinely content. */
    if (inner) {
      /* Applies whenever THIS entry triggered it directly, or the
         joint-filing requirement means it applies regardless (Regel
         193035 - see the anyGuenstiger computation above). */
      const antTag = (g1 || anyGuenstiger) ? `<Ant>\n${tag(fm.KAP.guenstigerpruefung, '1')}</Ant>\n` : '';
      xml += `<KAP><Person>Person${k.person === 'B' ? 'B' : 'A'}</Person>\n${antTag}${inner}</KAP>\n`;
      personsWithBlock.add(k.person === 'B' ? 'B' : 'A');
    }
  }
  /* If the joint-filing requirement applies but one spouse has no KAP
     data at all (and so never got a <KAP> block above), a minimal
     block carrying just the declaration is added for them here. */
  if (anyGuenstiger) {
    for (const p of ['A', 'B']) {
      if (!personsWithBlock.has(p)) {
        xml += `<KAP><Person>Person${p}</Person>\n<Ant>\n${tag(fm.KAP.guenstigerpruefung, '1')}</Ant>\n</KAP>\n`;
      }
    }
  }
  return xml;
}

/* =============================================================================
   Anlage R - pensions. IMPORTANT: uses the CORRECTED gesetzlich/privat
   logic (see eric-fieldmap.js R section comment) - the percentage field
   belongs to gesetzlich (statutory), not privat, confirmed via the real
   Kontexte hierarchy. If the frontend's buildElsterDataset() still sends
   pct only for 'privat', that value will simply not be used here for
   'privat' entries (correctly, per the real schema) - but it also means
   'gesetzlich' entries won't have a percentage to send until the
   frontend logic is corrected. Flagged clearly, not silently patched.
============================================================================= */
function buildR(data) {
  const entries = data.anlageR || [];
  if (!entries.length) return '';
  let xml = '';
  for (const r of entries) {
    let inner = '';
    let hasContent = false;
    if (r.art === 'gesetzlich' || !r.art) {
      if (N(r.jahresbetrag) > 0) {
        hasContent = true;
        inner += '<Leibr_gesetzl><Einz>\n';
        inner += wholeEuroTag(fm.R.gesetzlichAmount, r.jahresbetrag);
        /* CORRECTED: real bug found via the multi-year regression test -
           E1800501 ("Beginn der Rente") requires a genuine TT.MM.JJJJ
           date (confirmed via the real error: "Bitte geben Sie ein
           gültiges Datum TT.MM.JJJJ ein"), but the raw value was passed
           through unformatted. Our app's data model only collects the
           start YEAR (matching the existing rentePct(startYear)
           percentage-calculation logic elsewhere) - converts that into
           January 1st of that year as a reasonable, defensible default
           when only a year is available, or formats a genuine full date
           correctly if one is provided. */
        if (r.rentenbeginn) {
          const isYearOnly = /^\d{4}$/.test(String(r.rentenbeginn));
          const startDate = isYearOnly ? `01.01.${r.rentenbeginn}` : formatDateDE(r.rentenbeginn);
          if (startDate) inner += tag(fm.R.gesetzlichStart, startDate);
        }
        if (r.ertragsanteilProzent != null) inner += `<Oeff_Kl>${tag(fm.R.gesetzlichPercent, r.ertragsanteilProzent)}</Oeff_Kl>\n`;
        inner += '</Einz></Leibr_gesetzl>\n';
      }
    } else if (r.art === 'privat') {
      if (N(r.jahresbetrag) > 0) {
        hasContent = true;
        inner += '<Leibr_priv><Einz>\n';
        inner += wholeEuroTag(fm.R.privatAmount, r.jahresbetrag);
        /* Same fix as gesetzlichStart above - year-only value converted
           to a full date, since ELSTER requires TT.MM.JJJJ. */
        if (r.rentenbeginn) {
          const isYearOnly = /^\d{4}$/.test(String(r.rentenbeginn));
          const startDate = isYearOnly ? `01.01.${r.rentenbeginn}` : formatDateDE(r.rentenbeginn);
          if (startDate) inner += tag(fm.R.privatStart, startDate);
        }
        inner += '</Einz></Leibr_priv>\n';
      }
    }
    /* CORRECTED: real bug found via the multi-year regression test -
       buildR never wrote a <Person> tag at all, confirmed unconditionally
       required by real ERiC validation (mandatoryField, "/R[1]/Person[1]").
       Added as the first child, matching the pattern used everywhere
       else in this file (KAP, VOR, SA, etc.) - but only when there's
       genuine pension content, checked separately via hasContent, so
       the Person tag alone doesn't defeat the empty-wrapper protection
       (a real regression this same fix could have silently reintroduced
       if not checked carefully). */
    if (hasContent) xml += `<R>\n<Person>Person${r.person === 'B' ? 'B' : 'A'}</Person>\n${inner}</R>\n`;
  }
  return xml;
}

/* =============================================================================
   Anlage V - rental income. PARTIAL by design. CORRECTED nesting per
   confirmed Kennzahlen sheet paths (Allg/Lage for address,
   Einn/Mieteinn/Whg/Einz+Sum for income).
============================================================================= */
/* A property counts as foreign when a country is set to anything other
   than Germany - this routes it to Anlage AUS instead of Anlage V. */
function isForeignProperty(p) {
  return !!(p && p.land && String(p.land).trim() && String(p.land).trim() !== 'Deutschland');
}

/* Anlage V requires street+number, postcode and city as SEPARATE fields
   (Regel 3149). The app stores a single free-text address, so this
   splits the common "Street 1, 12345 City" shape. Anything it cannot
   split confidently is reported via skippedSections rather than guessed. */
function splitPropertyAddress(objekt) {
  const out = { street: '', plz: '', ort: '' };
  if (!objekt) return out;
  const parts = String(objekt).split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length) out.street = parts[0];
  const rest = parts.slice(1).join(', ');
  const m = rest.match(/(\d{5})\s+(.+)/);
  if (m) { out.plz = m[1]; out.ort = m[2].trim(); }
  return out;
}

function percentTag(name, n) {
  const v = Number(n);
  if (!v) return '';
  /* CORRECTED (real bug found via a genuine ERiC rejection,
     zahlHatUngueltigeZeichen): this field's real required format is
     German-style comma decimal ("2,00"), not a period - confirmed
     directly from ERiC's own error text ("muss vom Format '0,00'...
     sein"). toFixed(2) produces a period; replaced with a comma to
     match what ERiC actually requires for this specific field. */
  return tag(name, v.toFixed(2).replace('.', ','));
}
/* Shared by both buildV (2024/2025) and buildVLegacy (2021-2023) -
   confirmed identical field codes and category names for both
   structures, only the surrounding wrapper differs. Each category
   only emits when it has a real amount - an empty <Wk> with nothing
   inside it is never sent. */
function wkCategoryTotal(p) {
  return N(p.wkAfa) + N(p.wkSchuldzins) + N(p.wkErhaltung) + N(p.wkVerwaltung) + N(p.wkSonst);
}
/* CORRECTED (real bug found via a genuine ERiC rejection, Regel
   100750171/100750204/100750061/100750253/100750259 and 100700003):
   a category's Sum alone is not accepted - ERiC requires at least one
   backing individual entry justifying it, and a required overall
   total (Se_WK) across every category actually used. Checked each
   category's real "Direkt"/"Einz" structure directly - genuinely
   simple, one description plus the same amount, not full multi-
   receipt itemization. AfA specifically also needs a depreciation
   type and percentage, which this app doesn't collect yet - uses the
   standard, most common default (2% linear, the normal rate for
   buildings completed after 1924) rather than leave it blank, and
   returns a flag so the caller can honestly disclose this assumption
   rather than silently guess without telling anyone. */
function buildWkBlock(p) {
  let inner = '';
  let usedAfaDefault = false;
  if (N(p.wkAfa) > 0) {
    usedAfaDefault = true;
    inner += `<AfA_Geb><Direkt>\n${tag(fm.V.wkAfaArt, '1')}${percentTag(fm.V.wkAfaProzent, 2)}${wholeEuroTag(fm.V.wkAfaDirekt, p.wkAfa)}</Direkt><Sum>\n${wholeEuroTag(fm.V.wkAfaSum, p.wkAfa)}</Sum></AfA_Geb>\n`;
  }
  if (N(p.wkSchuldzins) > 0) {
    inner += `<Schuldzins><Direkt>\n${tag(fm.V.wkSchuldzinsAngaben, 'Darlehenszinsen')}${wholeEuroTag(fm.V.wkSchuldzinsDirekt, p.wkSchuldzins)}</Direkt><Sum>\n${wholeEuroTag(fm.V.wkSchuldzinsSum, p.wkSchuldzins)}</Sum></Schuldzins>\n`;
  }
  if (N(p.wkErhaltung) > 0) {
    inner += `<Erhalt_AW_dir><Einz>\n${tag(fm.V.wkErhaltungBezeichnung, 'Erhaltungsaufwand')}${wholeEuroTag(fm.V.wkErhaltungGesamt, p.wkErhaltung)}${wholeEuroTag(fm.V.wkErhaltungEinz, p.wkErhaltung)}</Einz><Sum>\n${wholeEuroTag(fm.V.wkErhaltungSum, p.wkErhaltung)}</Sum></Erhalt_AW_dir>\n`;
  }
  if (N(p.wkVerwaltung) > 0) {
    inner += `<Verw_Ko><Direkt>\n${tag(fm.V.wkVerwaltungAngaben, 'Verwaltungskosten')}${wholeEuroTag(fm.V.wkVerwaltungDirekt, p.wkVerwaltung)}</Direkt><Sum>\n${wholeEuroTag(fm.V.wkVerwaltungSum, p.wkVerwaltung)}</Sum></Verw_Ko>\n`;
  }
  if (N(p.wkSonst) > 0) {
    inner += `<Sonst><Direkt>\n${tag(fm.V.wkSonstAngaben, 'Sonstige Werbungskosten')}${wholeEuroTag(fm.V.wkSonstDirekt, p.wkSonst)}</Direkt><Sum>\n${wholeEuroTag(fm.V.wkSonstSum, p.wkSonst)}</Sum></Sonst>\n`;
  }
  if (!inner) return { xml: '', usedAfaDefault: false };
  const total = wkCategoryTotal(p);
  inner += `<Se_WK>\n${wholeEuroTag(fm.V.wkSeWk, total)}</Se_WK>\n`;
  return { xml: `<Wk>\n${inner}</Wk>\n`, usedAfaDefault };
}

/* Anlage V, 2021-2023 structure - see the confirmed research notes
   inside buildV() above for exactly what differs and why. */
function buildVLegacy(data, entries) {
  let xml = '';
  let idx = 0;
  entries.forEach((p) => {
    if (!p.objekt && !p.street && !(N(p.mieteinnahmen) > 0)) return;
    idx++;
    const addr = (p.street || p.plz || p.ort)
      ? { street: p.street || '', plz: p.plz || '', ort: p.ort || '' }
      : splitPropertyAddress(p.objekt);
    xml += '<V>\n';
    /* CONFIRMED real gap found via the actual client response: even
       after fixing the Ek_b_Gst wrapper, ERiC still rejected
       Laufende_Nummer_V specifically as feldUnbekannt. Checked
       directly - this element genuinely does not exist in the 2022
       Felder sheet at all (searched explicitly, zero matches), while
       it does exist for 2024/2025. Legacy years don't use an explicit
       sequence-number element the way the current structure does, so
       it's correctly omitted here rather than guessed back in. */
    xml += '<Ek_b_Gst>\n';

    /* Allg - confirmed real 2022 field order: address, then the three
       usage declarations directly (no separate Nutzung sub-wrapper,
       confirmed absent from the real 2022 Kontexte sheet). */
    let allg = '';
    if (addr.street) allg += tag(fm.V.street, addr.street);
    if (addr.plz) allg += tag(fm.V.plz, addr.plz);
    if (addr.ort) allg += tag(fm.V.ort, addr.ort);
    allg += tag(fm.V.nutzFerienwohnung, p.ferienwohnung ? '1' : '2');
    allg += tag(fm.V.nutzKurzfristig, p.kurzfristig ? '1' : '2');
    allg += tag(fm.V.nutzAngehoerige, p.angehoerige ? '1' : '2');
    xml += `<Allg>\n${allg}</Allg>\n`;

    if (N(p.mieteinnahmen) > 0) {
      /* Einn/Mieteinn/Whg/Einz - confirmed real 2022 context has NO
         Wohneinheit label field (E0701202 does not exist here for this
         year) - only the amount, unlike 2023+. */
      xml += '<Einn>\n<Mieteinn><Whg>\n';
      xml += `<Einz>\n${wholeEuroTag(fm.V.mieteinnahmen, p.mieteinnahmen)}</Einz>\n`;
      xml += `<Sum>\n${wholeEuroTag(fm.V.mieteinnahmenSum, p.mieteinnahmen)}</Sum>\n`;
      xml += '</Whg></Mieteinn>\n';
      /* Einn/Uml_sonst - confirmed real 2022 context has no "not
         separately agreed" alternative declaration (that specific
         Regel is 2023+ only) - only emit an amount when there
         genuinely is one. */
      if (N(p.nebenkosten) > 0) {
        xml += `<Uml_sonst>\n${wholeEuroTag(fm.V.nebenkosten, p.nebenkosten)}</Uml_sonst>\n`;
      }
      xml += '</Einn>\n';

      const wkResult = buildWkBlock(p);
      xml += wkResult.xml;
      const wkTotal = wkCategoryTotal(p);

      /* Erm_Zuord_Ek - confirmed real 2022 context: the income sum,
         Überschuss, and ownership attribution all sit here directly,
         not under Einn/Sum the way 2023+ does. Werbungskosten is now
         itemized above (same categories, same field codes as 2023+,
         confirmed identical), so the Überschuss correctly subtracts
         them rather than reporting gross income. */
      const totalIncome = N(p.mieteinnahmen) + N(p.nebenkosten);
      xml += '<Erm_Zuord_Ek>\n';
      xml += wholeEuroTag(fm.V.einnahmenSum, totalIncome);
      xml += wholeEuroTag(fm.V.ueberschuss, totalIncome - wkTotal);
      xml += wholeEuroTag(fm.V.ueberschussZuordA, totalIncome - wkTotal);
      xml += '</Erm_Zuord_Ek>\n';
    }
    xml += '</Ek_b_Gst>\n</V>\n';
  });
  return xml;
}

function buildV(data) {
  const entries = (data.anlageV || []).filter(p => !isForeignProperty(p));
  if (!entries.length) return '';
  /* CONFIRMED via a real client submission returning "feldUnbekannt" on
     every single field in this section, including the sequence number
     itself (the clearest possible signature of a whole-section
     structural mismatch, not individual wrong field codes) - checked
     directly against the real 2022 Kontexte/Felder sheets: 2021/2022
     wrap the entire section in an <Ek_b_Gst> element that does not
     exist in the 2023+ structure below. Same field codes are largely
     reused, but nested differently, and with real, confirmed
     differences: no Wohneinheit label field in the 2022 Einz context,
     no "service charges not separately agreed" alternative declaration,
     and the income/Überschuss/attribution fields sit under
     Erm_Zuord_Ek rather than Einn/Sum. The itemized Werbungskosten
     sub-tree 2022 also has (Wk/AfA_Geb, Wk/Schuldzins, etc.) is a
     separate, larger scope, honestly left unmapped here the same way
     it already is for 2023+ - not silently guessed either way. */
  /* CORRECTED (real regression found via a genuine client submission
     returning feldUnbekannt on every V field for a 2023 return): the
     earlier "confirmed for 2023 too" comment above was wrong. That
     check only scanned the top-level Kontexte sheet for the presence
     of any Ek_b_Gst path anywhere, which found one - but it belonged
     to entries unrelated to the actual fields this code emits, not
     the ones it uses. Redone properly this time: checked every single
     field code this code actually touches against the real 2023
     Felder sheet directly, field by field. All of them sit under the
     flat, non-wrapped context (Allg/Lage, Einn/Sum, etc.) - identical
     to 2024/2025, not the Ek_b_Gst-wrapped legacy structure. Only 2021
     and 2022 are genuinely legacy - re-verified those the same
     thorough way to be sure this correction doesn't overcorrect. */
  const legacyV = data.meta?.taxYear <= 2022;
  if (legacyV) return buildVLegacy(data, entries);
  let xml = '';
  let idx = 0;
  entries.forEach((p) => {
    /* Only emits an entry (and only increments the sequence number) when
       there is genuine property content - ERiC rejects a lone sequence
       number as "solitaryIndex". */
    if (!p.objekt && !p.street && !(N(p.mieteinnahmen) > 0)) return;
    idx++;
    /* CORRECTED: the frontend now collects street/plz/ort as three
       separate fields directly (confirmed via Regel 3149 that this is
       what ELSTER actually requires), eliminating the fragile
       comma/regex parsing this used to depend on entirely. The old
       parsing is kept only as a fallback for any external test file
       still using the old combined "objekt" shape. */
    const addr = (p.street || p.plz || p.ort)
      ? { street: p.street || '', plz: p.plz || '', ort: p.ort || '' }
      : splitPropertyAddress(p.objekt);
    xml += '<V>\n';
    xml += tag('Laufende_Nummer_V', String(idx));

    /* Allg - Lage then Nutzung, confirmed element order. All three
       Nutzung declarations are required whenever property data is
       given (Regeln 100700068 / 100700069 / 100750004). They are real
       yes/no facts about the property, so they are taken from the data
       and only defaulted to "Nein" ("2") when explicitly answered as
       such by the UI - never silently guessed for an unanswered
       property (see the skippedSections check for that case). */
    let allg = '';
    if (addr.street || addr.plz || addr.ort) {
      allg += '<Lage>\n';
      if (addr.street) allg += tag(fm.V.street, addr.street);
      if (addr.plz) allg += tag(fm.V.plz, addr.plz);
      if (addr.ort) allg += tag(fm.V.ort, addr.ort);
      allg += '</Lage>\n';
    }
    allg += '<Nutzung>\n';
    allg += tag(fm.V.nutzFerienwohnung, p.ferienwohnung ? '1' : '2');
    allg += tag(fm.V.nutzKurzfristig, p.kurzfristig ? '1' : '2');
    allg += tag(fm.V.nutzAngehoerige, p.angehoerige ? '1' : '2');
    allg += '</Nutzung>\n';
    xml += `<Allg>\n${allg}</Allg>\n`;

    /* Einn - Mieteinn, then Uml, then Sum (confirmed order). Each unit
       needs a label paired with its amount (Regel 100750262). */
    if (N(p.mieteinnahmen) > 0) {
      const label = p.wohneinheit || 'Wohneinheit 1';
      xml += '<Einn>\n<Mieteinn><Whg>\n';
      xml += `<Einz>\n${tag(fm.V.wohneinheit, label)}${wholeEuroTag(fm.V.mieteinnahmen, p.mieteinnahmen)}</Einz>\n`;
      xml += `<Sum>\n${wholeEuroTag(fm.V.mieteinnahmenSum, p.mieteinnahmen)}</Sum>\n`;
      xml += '</Whg></Mieteinn>\n';
      /* Regel 100750265: either an amount, or an explicit declaration
         that service charges were not separately agreed. */
      if (N(p.nebenkosten) > 0) {
        xml += `<Uml>\n${wholeEuroTag(fm.V.nebenkosten, p.nebenkosten)}</Uml>\n`;
      } else {
        xml += `<Uml>\n${tag(fm.V.nebenkostenNichtVereinbart, '1')}</Uml>\n`;
      }
      /* Regel 100700004: the overall income total. Service charges are
         themselves income, so they are included in the sum. */
      const totalIncome = N(p.mieteinnahmen) + N(p.nebenkosten);
      xml += `<Sum>\n${wholeEuroTag(fm.V.einnahmenSum, totalIncome)}</Sum>\n`;
      xml += '</Einn>\n';

      const wkResult = buildWkBlock(p);
      xml += wkResult.xml;
      const wkTotal = wkCategoryTotal(p);

      /* CORRECTED (second pass) - real bug found via the actual client
         file returning "feldUnbekannt": the previous version wrapped
         this in a fabricated <Ek_b_Gst> element and duplicated the
         income sum into it. Verified directly against the raw XSD this
         time, not just the documentation sheet: Erm_Zuord_Ek is a
         direct sibling of Einn within <V>, confirmed field order right
         after Einn (Wk sits between them in the real sequence). */
      /* CORRECTED (third pass) - real bug found via the actual client
         file: Regel confirms the Überschuss requires an attribution to
         at least one of taxpayer/spouse. No ownership-split data is
         collected, so the full amount is attributed to Person A - the
         correct behaviour for sole ownership, which is the common
         case this app supports. */
      /* CORRECTED (fourth pass) - real gap found via direct feedback:
         Werbungskosten are now itemized into real categories (see
         buildWkBlock above), so the Überschuss correctly subtracts
         them instead of reporting gross income - the "declared income
         is too high" warning that used to accompany this is no longer
         needed once a real category amount is entered. */
      xml += '<Erm_Zuord_Ek>\n';
      xml += wholeEuroTag(fm.V.ueberschuss, totalIncome - wkTotal);
      xml += wholeEuroTag(fm.V.ueberschussZuordA, totalIncome - wkTotal);
      xml += '</Erm_Zuord_Ek>\n';
    }
    xml += '</V>\n';
  });
  return xml;
}

/* =============================================================================
   Anlage AUS - foreign rental income (Progressionsvorbehalt)
   =============================================================================
   Confirmed via direct research that Anlage V is structurally
   domestic-only (its Allg/Lage block has no country field at all), and
   that Anlage V-Sonstige covers something different entirely
   (partnership shares, sublets, undeveloped land). Foreign rental income
   under a double-taxation agreement is normally exempt in Germany but
   still raises the rate applied to German income, and is declared as
   "steuerfreie Einkünfte mit Progressionsvorbehalt".

   IMPORTANT SCOPE NOTE: this reports the NET result the user supplies.
   Whether a given country's DBA actually exempts the income (rather than
   crediting foreign tax against German tax) is a genuine per-treaty legal
   question this app does not attempt to decide - the credit method needs
   a different section entirely and is not implemented.
============================================================================= */
function buildAUS(data) {
  const foreign = (data.anlageV || []).filter(isForeignProperty);
  if (!foreign.length) return '';
  let inner = '';
  foreign.forEach((p) => {
    const net = N(p.mieteinnahmen) + N(p.nebenkosten) - N(p.werbungskosten);
    if (!p.land || !(N(p.mieteinnahmen) > 0)) return;
    inner += '<Einz>\n';
    inner += tag(fm.AUS.progStaat, p.land);
    inner += tag(fm.AUS.progQuelle, p.street || p.objekt || 'Vermietung');
    inner += tag(fm.AUS.progEinkunftsart, 'Vermietung und Verpachtung');
    inner += wholeEuroTag(fm.AUS.progEinkuenfte, net);
    inner += '</Einz>\n';
  });
  if (!inner) return '';
  return `<AUS>\n<Stfr_Ek_ProgV><P32b><Mitt>\n${inner}</Mitt></P32b></Stfr_Ek_ProgV>\n</AUS>\n`;
}

/* =============================================================================
   Sonderausgaben - donations
============================================================================= */
function buildSA(data) {
  const s = data.sonderausgaben || {};
  const w = data.weitereAngaben || {};
  /* CORRECTED: the early-return guard previously only checked for
     donations - meaning Realsplitting data alone (no donations) would
     have been silently dropped entirely, never even reaching the
     Realsplitting logic below. Now checks both. */
  if (!s.spenden && !w.realsplittingAnlageU) return '';

  let inner = '';
  if (s.spenden) {
    /* CORRECTED nesting - Zuw/Sp_erh_Verm_Stift confirmed via the real
       Kennzahlen sheet. NOTE: this path name ("Spende erhöhter
       Vermögensstock-Stiftung") suggests E0108405 may specifically be for
       ENDOWMENT-related donations, not general everyday donations - worth
       re-confirming in a future pass whether a separate, simpler donations
       Kennzahl exists for the common case. Not changed here since this is
       still the same code already independently confirmed to exist and be
       donation-related - flagging the naming oddity rather than guessing
       a different code.
       CORRECTED: confirmed via the real Regeln sheet (Regel 101100001) that
       E0108509 is a REQUIRED companion to E0108405 - "how much of this
       donation applies to THIS specific tax year" (Vermögensstock endowment
       donations can otherwise be legally spread across up to 10 years).
       Defaults to claiming the full amount in the current year (the simple,
       most common case) rather than spreading it - spreading would need
       real UI for the user to choose. */
    inner += `<Zuw><Sp_erh_Verm_Stift><Person>PersonA</Person>\n${wholeEuroTag(fm.SA.donationsDomestic, s.spenden)}${wholeEuroTag(fm.SA.donationsThisYear, s.spenden)}</Sp_erh_Verm_Stift></Zuw>\n`;
  }
  if (w.realsplittingAnlageU) {
    /* Anlage U / Realsplitting - confirmed via the real Kennzahlen sheet,
       nested at /SA/Weit_Aufw/U_Leist/Einz (a SIBLING of Zuw within SA,
       not a separate top-level element - confirmed via the real
       Kontexte sheet). Confirmed genuinely required set (Regeln 58, 64,
       65): amount + domestic-residence flag always, plus the ex-spouse's
       IdNr specifically when residence is domestic.
       CORRECTED: the app now collects both the ex-spouse's IdNr and
       name via the UI (realsplitIdnr, realsplitName - both required
       fields in the Anlage U section). Domestic residence defaults to
       "Wahr" (true), the overwhelmingly common case for this app's
       German-resident user base. If either is still blank when this
       runs, that reflects the specific record's data, not a missing
       app feature - surfaced honestly via skippedSections either way,
       never guessed. */
    /* CONFIRMED via the real XSD: E0183001 is JaNein12BaseCType (the same
       type family as Vorsatz/Rueckuebermittlung/Bescheid, where "1"=Ja
       was already confirmed) - NOT a simple "X" checkbox.
       YEAR GATE: confirmed genuinely new in 2024 via direct XSD
       comparison against 2023 - the surrounding structure (SA/Weit_Aufw/
       U_Leist) is confirmed stable across 2023-2025, only this one field
       is year-gated, so it's simply omitted for 2023 rather than the
       whole section being restricted. */
    const inlandTag = fm.isFieldSupportedForYear('E0183001', data.meta?.taxYear || 2025) ? tag(fm.SA.realsplittingInland, '1') : '';
    /* CORRECTED (second pass): confirmed exact field order via the real
       Kennzahlen sheet row order: Name, Amount, IdNr, domestic-flag.
       Name (E0183101) was originally read as "optional/soft" based on a
       misunderstanding of the FelderNichtGemeinsamAngegeben rule type -
       the real multi-year regression test proved it's genuinely
       required TOGETHER with the amount (Regel 101180025). CORRECTED:
       the app now does collect the ex-spouse's name via the UI
       (realsplitName, required field) - if it's still blank here, that
       means the specific record being processed hasn't had it filled
       in yet, not that the app lacks the field. No placeholder is ever
       guessed - a blank value is honestly surfaced as a skippedSections
       warning either way. */
    const nameTag = w.realsplitName ? tag(fm.SA.realsplittingNameGeburt, w.realsplitName) : '';
    const idnrTag = w.realsplitIdnr ? tag(fm.SA.realsplittingIdNr, w.realsplitIdnr.replace(/\s/g, '')) : '';
    inner += `<Weit_Aufw><U_Leist><Einz>\n${nameTag}${wholeEuroTag(fm.SA.realsplittingAmount, w.realsplittingAnlageU)}${idnrTag}${inlandTag}</Einz></U_Leist></Weit_Aufw>\n`;
  }
  return `<SA>\n${inner}</SA>\n`;
}

/* =============================================================================
   AgB - disability/care/medical. CORRECTED nesting per the confirmed
   Kennzahlen sheet paths.
============================================================================= */
function buildAgB(data) {
  const w = data.weitereAngaben || {};
  const b = w.behinderung || {};
  const agb = data.aussergewoehnlicheBelastungen || {};
  let xml = '<AgB>\n';
  let any = false;
  if (b.gdbA) { xml += `<Beh><Person>PersonA</Person><Ausw_Rentb_Besch>${tag(fm.AgB.gdbA, b.gdbA)}</Ausw_Rentb_Besch></Beh>\n`; any = true; }
  if (b.pflegeA) {
    const grad = fm.amountToPflegegrad(b.pflegeA);
    if (grad) { xml += `<Pflege_PB><Einz><Ang_pflegebeduerft_Pers>${tag(fm.AgB.pflegeGrad, grad)}</Ang_pflegebeduerft_Pers></Einz></Pflege_PB>\n`; any = true; }
  }
  if (agb.krankheitskosten) {
    /* CORRECTED: real bug found via testing against a genuine client
       file - kennzahlen[2]/[4] (the "erhaltene/zu erwartende
       Versicherungsleistungen" reimbursement fields) were already
       mapped but never actually used. The rule itself explicitly
       permits "0" when there's no reimbursement (the app doesn't
       collect this separately), so 0 is a safe, defensible default
       rather than a guess - matching the rule's own stated allowance. */
    xml += '<And_Aufw><Krankh><Einz>\n';
    xml += tag(fm.AgB.medical.kennzahlen[0], 'Krankheitskosten');
    xml += wholeEuroTag(fm.AgB.medical.kennzahlen[1], agb.krankheitskosten);
    xml += `<${fm.AgB.medical.kennzahlen[2]}>0</${fm.AgB.medical.kennzahlen[2]}>\n`;
    xml += '</Einz><Sum>\n';
    xml += wholeEuroTag(fm.AgB.medical.kennzahlen[3], agb.krankheitskosten);
    xml += `<${fm.AgB.medical.kennzahlen[4]}>0</${fm.AgB.medical.kennzahlen[4]}>\n`;
    xml += '</Sum></Krankh></And_Aufw>\n';
    any = true;
  }
  xml += '</AgB>\n';
  return any ? xml : '';
}

/* =============================================================================
   Anlage Kind - children. NEWLY WIRED IN (was completely orphaned before -
   mapped in eric-fieldmap.js and fully collected in the app UI, but no
   builder function existed and nothing was ever written to the XML).
   firstName and birthDate are REAL required fields (Pflichtfeld=Ja in the
   source) - an entry missing either is skipped with a console warning
   rather than sent incomplete, since ERiC would reject it anyway.
============================================================================= */
const KINSHIP_ENUM = { leiblich: '1', adoptiert: '1', pflegekind: '2', stiefkind: '3' };
/* =============================================================================
   Anlage Unterhalt - LEGACY structure (2021/2022 only)
   =============================================================================
   Genuinely separate function, not a variant of buildUnterhalt() above -
   built after full research (65 real Regeln analyzed, confirmed
   identical between 2021 and 2022) that the 2021/2022 structure is
   substantially different from 2023+, not just a wrapper difference:
     - The amount lives under AW_U/U_Zlg, a different context from
       2023+'s AW_U/U_Ztr - and BOTH contexts are needed together
       (Regel 5: giving U_Zlg without U_Ztr's period field is an error).
     - The simple Yes/No pattern (2023+'s JaNein12, "1"/"2") is replaced
       with opposite-polarity JaXBaseCType statement flags ("X") -
       confirmed via the real XSD types, a genuinely different value
       convention: "had NO assets" instead of "had assets: yes/no".
     - Kindergeld uses a mutually-exclusive pair (E0120401 "nobody all
       year" OR E0120402 "someone during the year") instead of 2023+'s
       single Ja/Nein field.
   Covers the same common case as buildUnterhalt(): domestic household,
   no other contributor, no assets, no income of the supported person -
   confirmed via the real rules that this combination is genuinely
   complete and valid, not guessed. Foreign-household support is NOT
   implemented here (would need its own dedicated research pass, same
   as any other real scope boundary in this project).
============================================================================= */
function buildLegacyUnterhalt(data) {
  const u = data.anlageUnterhalt;
  if (!u || !(u.betrag > 0)) return '';
  const x = (v) => (v ? 'X' : ''); // JaXBaseCType: "X" asserts the statement, omitted otherwise
  const isForeign = u.country && u.country !== 'Deutschland';

  let hhUntP = '<HH_unt_P>\n';
  hhUntP += tag(fm.ESt1A_U.legacyHouseholdAddress, u.householdAddress);
  /* Foreign household - confirmed correct position (between address and
     household size) via the real Felder sheet row order for 2021/2022. */
  if (isForeign) hhUntP += tag(fm.ESt1A_U.legacyCountry, u.country);
  hhUntP += wholeEuroTag(fm.ESt1A_U.legacyHouseholdSize, u.householdSize || 2);
  hhUntP += '</HH_unt_P>\n';

  let awU = '<AW_U>\n';
  awU += `<U_Ztr>\n${tag(fm.ESt1A_U.legacyPeriod, (u.von && u.bis) ? formatDateRangeDE(u.von, u.bis) : '')}</U_Ztr>\n`;
  awU += '<U_Zlg>\n';
  awU += wholeEuroTag(fm.ESt1A_U.legacyAmount, u.betrag);
  if (u.von && u.bis) awU += tag(fm.ESt1A_U.legacyPaymentPeriod, formatDateRangeDE(u.von, u.bis));
  awU += '</U_Zlg>\n';
  awU += '</AW_U>\n';

  /* CORRECTED (second pass) - real bug found via testing against a
     genuine 2022 client file. My first attempt wrongly treated
     Unterstuetzte_Person as a wrapper AROUND Allg/Ek_Bez_u_P - that
     was wrong and made things worse (everything inside it became
     unrecognized). Verified directly against the raw XSD sequence
     this time: Unterstuetzte_Person is a SIBLING of Allg/Ek_Bez_u_P,
     not their parent - a simple index value ("Person1" for the first
     supported person, confirmed via the real enum), required first in
     sequence. This app only supports declaring one supported person,
     so "Person1" is always correct here. */
  let angUntPers = '<Ang_Unt_Pers>';
  angUntPers += tag(fm.ESt1A_U.legacyPersonIndex, 'Person1');
  angUntPers += '<Allg><Persoenl>\n';
  if (u.personIdnr) angUntPers += tag(fm.ESt1A_U.legacyIdnr, u.personIdnr.replace(/\s/g, ''));
  angUntPers += tag(fm.ESt1A_U.legacyName, u.personName);
  angUntPers += tag(fm.ESt1A_U.legacyBirthDate, formatDateDE(u.personBirthDate));
  angUntPers += tag(fm.ESt1A_U.legacyProfession, u.profession);
  angUntPers += tag(fm.ESt1A_U.legacyRelationship, u.relationship);
  /* Foreign household confirmation - confirmed correct position (right
     after relationship) via the real Felder sheet row order. A
     mutually exclusive Yes/No pair (Regel: both given together is an
     error) - maps directly onto the same foreignNeedConfirmed boolean
     already collected in the UI for 2023+. */
  if (isForeign) angUntPers += tag(u.foreignNeedConfirmed ? fm.ESt1A_U.legacyForeignConfirmedYes : fm.ESt1A_U.legacyForeignConfirmedNo, 'X');
  angUntPers += '</Persoenl>\n';
  /* Kindergeld: mutually exclusive pair, confirmed via Regel 32
     (AlleFelderAngegeben(E0120401,E0120402) is itself an error - only
     one may be sent). Defaults to the common case: nobody claimed
     Kindergeld for this person all year. */
  angUntPers += `<U_Berecht>\n${tag(fm.ESt1A_U.legacyNoKindergeldAllYear, x(!u.kindergeldEntitlement))}</U_Berecht>\n`;
  angUntPers += `<Verm_u_P>\n${tag(fm.ESt1A_U.legacyNoOrLowAssets, x(!u.hasAssets))}</Verm_u_P>\n`;
  angUntPers += `<Weit_beitr_P>\n${tag(fm.ESt1A_U.legacyNoOtherContributor, x(!u.otherContributor))}</Weit_beitr_P>\n`;
  angUntPers += '</Allg>\n';
  angUntPers += `<Ek_Bez_u_P><Allg>\n${tag(fm.ESt1A_U.legacyNoIncome, x(!u.hasOwnIncome))}</Allg></Ek_Bez_u_P>\n`;
  angUntPers += '</Ang_Unt_Pers>\n';

  return `<ESt1A_U>\n${hhUntP}${awU}${angUntPers}</ESt1A_U>\n`;
}

function buildKind(data) {
  const entries = data.anlageKind || [];
  if (!entries.length) return '';
  const B = data.hauptvordruck?.personB;
  let xml = '';
  for (const k of entries) {
    if (!k.vorname || !k.geburtsdatum) {
      console.warn('[eric xml-builder] Kind entry skipped - missing required firstName or birthDate:', k.vorname || '(no name)');
      continue;
    }
    xml += '<Kind>\n';
    /* CORRECTED nesting per confirmed Kennzahlen sheet paths - was
       previously flat, causing every child field to be unrecognized. */
    xml += '<Ang_Kind><Allg>\n';
    if (k.idnr) xml += tag(fm.Kind.idnr, k.idnr);
    xml += tag(fm.Kind.firstName.kennzahlen[0], k.vorname);
    if (k.surnameIfDifferent) xml += tag(fm.Kind.surnameIfDifferent, k.surnameIfDifferent);
    xml += tag(fm.Kind.birthDate.kennzahlen[0], formatDateDE(k.geburtsdatum));
    /* Sensible default for residence duration: full tax year, the
       common case where a child lived with the filer in Germany all
       year - fully overridable when the UI provides explicit dates
       (e.g. a child born mid-year, or one who moved). */
    const taxYear = data.meta?.taxYear || 2025;
    const wsVon = k.wsVon || `${taxYear}-01-01`;
    const wsBis = k.wsBis || `${taxYear}-12-31`;
    /* CORRECTED: confirmed via real XSD that E0500702 is a Ganzzahl
       (whole-number) type despite its Ja/Nein-sounding description
       ("Anspruch auf Kindergeld...") - sibling Ja1BaseCType fields
       elsewhere in this schema use "1" for yes, not "X" (that's only
       for JaXBaseCType fields specifically) - "X" triggered
       "zahlHatUngueltigeZeichen" since it's not a valid digit. */
    if (k.kindergeld) xml += tag(fm.Kind.kindergeld.kennzahlen[0], '1');
    /* NEW: Familienkasse - confirmed required alongside name/birthdate
       (Regel 5021, "Vorname...Geburtsdatum...Familienkasse...nicht
       gemeinsam angegeben") via the multi-year regression test. Free
       text - the specific office responsible for Kindergeld, which the
       app does not track by code, only by name. */
    if (k.familienkasse) xml += tag(fm.Kind.familienkasse, k.familienkasse);
    xml += '</Allg>\n';
    /* NEW: residence duration (Wohnsitz) - confirmed required alongside
       first name (Regel 5039/8) via the multi-year regression test.
       Defaults to the full tax year for the common case (a child living
       with the filer in Germany all year) - editable in the UI for
       partial-year cases. */
    xml += `<WS><Inl>\n${tag(fm.Kind.residenceInl, formatDateRangeDE(wsVon, wsBis))}</Inl></WS>\n`;
    xml += '</Ang_Kind>\n';

    /* NEW: K_Verh_B (the child's OTHER parent's relationship) -
       confirmed required alongside K_Verh_A (Regel 100500048, "es wurde
       nur ein Kindschaftsverhältnis...angegeben") via the multi-year
       regression test. Important semantic note found during research:
       this is NOT specifically about "Person B" the tax-filing spouse -
       it's about the child's second parent generally, who may not be a
       co-filer on this return at all. Pragmatic default for the common
       case: same kinship type as parent A, same period - editable in
       the UI if the family situation differs (e.g. blended families). */
    /* CORRECTED (second pass): the multi-year regression test proved my
       earlier semantic interpretation wrong. Real ERiC error, verbatim:
       "Es handelt sich um eine Einzelveranlagung, daher sind Angaben
       zum Kindschaftsverhältnis zur Ehefrau nicht zulässig" - K_Verh_B
       is NOT "the child's second parent generally" as first
       hypothesized; it's specifically tied to an actual spouse (Person
       B) filing on this same return. For single filers, it must be
       OMITTED entirely, not defaulted - sending it at all (even a
       reasonable-looking default) is itself the error, not just an
       incomplete one. */
    const kinCode = KINSHIP_ENUM[k.kinship] || '1';
    if (taxYear < 2023) {
      /* LEGACY (2021/2022) ONLY - genuinely different structure,
         confirmed via the raw 2022 XSD content model, not the
         documentation summary sheet (which already misled once this
         session on a different section). Real bug found via testing
         against a genuine 2022 client file (feldUnbekannt on K_Verh_A
         and every K_Verh_and_P field):
           - K_Verh_A/K_Verh_B/K_Verh_and_P are DIRECT children of
             <Kind> - there is no <K_Verh> wrapper grouping them, unlike
             2023+.
           - K_Verh_A/K_Verh_B each wrap their content one level deeper,
             inside a <KV> element, with a sibling relationship-period
             field (E0500601) alongside the type code.
         K_Verh_and_P's own internal shape (Ang_Pers with name, period,
         type) is confirmed IDENTICAL to 2023+ - only the missing outer
         <K_Verh> wrapper and K_Verh_A's <KV> nesting differ. This
         branch is completely isolated from the 2023+ code below -
         changing it can only affect years before 2023. */
      if (B) {
        const kinCodeB = KINSHIP_ENUM[k.kinshipB] || kinCode;
        xml += `<K_Verh_A><KV>${tag(fm.Kind.kinshipTypeA.kennzahlen[0], kinCode)}${tag(fm.Kind.kinshipPeriodLegacy, formatDateRangeDE(wsVon, wsBis))}</KV></K_Verh_A>\n`;
        /* K_Verh_B/KV verified SEPARATELY (not assumed symmetric with
           K_Verh_A) - confirmed via the real 2022 Felder sheet that its
           period field is E0500805, the SAME code already mapped as
           kinshipPeriodB for 2023+ (a genuine coincidence confirmed by
           checking, not assumed). */
        xml += `<K_Verh_B><KV>${tag(fm.Kind.kinshipTypeB.kennzahlen[0], kinCodeB)}${tag(fm.Kind.kinshipPeriodB, formatDateRangeDE(wsVon, wsBis))}</KV></K_Verh_B>\n`;
      } else if (k.otherParentName) {
        xml += `<K_Verh_A><KV>${tag(fm.Kind.kinshipTypeA.kennzahlen[0], kinCode)}${tag(fm.Kind.kinshipPeriodLegacy, formatDateRangeDE(wsVon, wsBis))}</KV></K_Verh_A>\n`;
        xml += `<K_Verh_and_P><Ang_Pers>${tag(fm.Kind.otherParentName, k.otherParentName)}${tag(fm.Kind.otherParentPeriod, formatDateRangeDE(wsVon, wsBis))}${tag(fm.Kind.otherParentKinType, kinCode)}</Ang_Pers></K_Verh_and_P>\n`;
      } else {
        xml += `<K_Verh_A><KV>${tag(fm.Kind.kinshipTypeA.kennzahlen[0], kinCode)}${tag(fm.Kind.kinshipPeriodLegacy, formatDateRangeDE(wsVon, wsBis))}</KV></K_Verh_A>\n`;
      }
    } else if (B) {
      const kinCodeB = KINSHIP_ENUM[k.kinshipB] || kinCode;
      xml += `<K_Verh><K_Verh_A>${tag(fm.Kind.kinshipTypeA.kennzahlen[0], kinCode)}</K_Verh_A>`;
      xml += `<K_Verh_B>${tag(fm.Kind.kinshipTypeB.kennzahlen[0], kinCodeB)}`;
      xml += tag(fm.Kind.kinshipPeriodB, formatDateRangeDE(wsVon, wsBis));
      xml += '</K_Verh_B></K_Verh>\n';
    } else if (k.otherParentName) {
      /* CORRECTED (second pass): for single filers, K_Verh_and_P/Ang_Pers
         (simply naming the other parent) is the correct mechanism -
         confirmed via real ERiC validation that K_Verh_B specifically
         requires an actual spouse. */
      xml += `<K_Verh><K_Verh_A>${tag(fm.Kind.kinshipTypeA.kennzahlen[0], kinCode)}</K_Verh_A>`;
      xml += `<K_Verh_and_P><Ang_Pers>${tag(fm.Kind.otherParentName, k.otherParentName)}${tag(fm.Kind.otherParentPeriod, formatDateRangeDE(wsVon, wsBis))}${tag(fm.Kind.otherParentKinType, kinCode)}</Ang_Pers></K_Verh_and_P></K_Verh>\n`;
    } else {
      xml += `<K_Verh><K_Verh_A>${tag(fm.Kind.kinshipTypeA.kennzahlen[0], kinCode)}</K_Verh_A></K_Verh>\n`;
    }

    /* CORRECTED: confirmed via real ERiC validation that Schulgeld/Sum
       (the total) is a required companion to Elt_k_ZV (the individual
       amount) - same Einz/Sum completeness pattern as everywhere else
       in this schema. For a single child/single payer, the total equals
       the individual amount. */
    if (k.schulgeld) {
      /* CORRECTED: real bug found via testing against a genuine client
         file - the itemized Einz block (school name + amount) was never
         implemented; only Sum was sent, which real ERiC correctly
         rejected as incomplete. A generic, purely-descriptive default
         is used for the school name when the app doesn't collect one
         specifically (safe, since it's not a factual declaration the
         way a person's identity would be). Elt_k_ZV is only relevant
         for non-joint-assessment cost-splitting (same concept as
         childcare's Elt_k_ZV) - correctly omitted when jointly
         assessed. */
      xml += '<Schulgeld><Einz>\n';
      xml += tag(fm.Kind.schoolFeesEinzName, k.schulgeldSchule || 'Schule');
      xml += wholeEuroTag(fm.Kind.schoolFeesEinzAmount, k.schulgeld);
      xml += '</Einz><Sum>\n';
      xml += wholeEuroTag(fm.Kind.schoolFeesSum, k.schulgeld);
      xml += '</Sum>';
      if (!B) xml += `<Elt_k_ZV>${wholeEuroTag(fm.Kind.schoolFeesEltKZv, k.schulgeld)}</Elt_k_ZV>`;
      xml += '</Schulgeld>\n';
    }

    /* childcare - now safe to write: the app's UI enforces provider+period
       whenever an amount is entered, so by the time data reaches here the
       ERiC rule 514139 requirement is already satisfied - but double-check
       defensively anyway rather than trust the frontend blindly. */
    if (k.betreuungskosten > 0 && k.betreuungAnbieter && k.betreuungVon && k.betreuungBis) {
      xml += '<KBK><Art><Einz>\n';
      if (taxYear < 2023) {
        /* LEGACY (2021/2022) ONLY - real bug found via testing against
           a genuine 2022 client file. See eric-fieldmap.js
           childcareServiceTypeLegacy/childcareProviderLegacy for the
           full research. Isolated to this branch only - the 2023+
           path below is completely untouched. */
        xml += tag(fm.Kind.childcareServiceTypeLegacy, 'Kinderbetreuung');
        xml += tag(fm.Kind.childcareProviderLegacy, k.betreuungAnbieter);
      } else {
        xml += tag(fm.Kind.childcareProvider.kennzahlen[0], k.betreuungAnbieter);
      }
      xml += tag(fm.Kind.childcarePeriod.kennzahlen[0], formatDateRangeDE(k.betreuungVon, k.betreuungBis));
      xml += wholeEuroTag(fm.Kind.childcareAmount.kennzahlen[0], k.betreuungskosten);
      xml += '</Einz><Sum>\n';
      xml += wholeEuroTag(fm.Kind.childcareSum.kennzahlen[0], k.betreuungskosten);
      xml += '</Sum></Art>\n';
      /* NEW: Ang_HH/Gem_HH_Elt - confirmed required whenever childcare
         costs are claimed (Regel 10514160, "Für den Abzug von
         Kinderbetreuungskosten werden auch Angaben zum Haushalt der
         Elternteile...benötigt") via the multi-year regression test.
         Defaults to the same period as the childcare service itself -
         the common case where the shared parental household covers the
         same period the childcare was used. */
      xml += `<Ang_HH><Gem_HH_Elt>\n${tag(fm.Kind.gemHhElt, formatDateRangeDE(k.betreuungVon, k.betreuungBis))}${tag(fm.Kind.gemHhEltKind, formatDateRangeDE(k.betreuungVon, k.betreuungBis))}</Gem_HH_Elt></Ang_HH>\n`;
      /* NEW: real bug found via the multi-year regression test - when
         the parents are NOT jointly assessed (no Person B on this
         return), a separate declaration of how much of the childcare
         cost THIS taxpayer personally bore is required (Regel
         100500024, "gegebenenfalls '0'"). Since this app only supports
         one taxpayer entering the cost (no splitting between two
         separately-filing parents), the same amount already collected
         is the correct value here too. */
      if (!B) xml += `<Elt_k_ZV><Kosten><Einz>\n${tag(fm.Kind.eltKZvPeriod, formatDateRangeDE(k.betreuungVon, k.betreuungBis))}${wholeEuroTag(fm.Kind.eltKZvAmount, k.betreuungskosten)}</Einz><Sum>\n${wholeEuroTag(fm.Kind.eltKZvSum, k.betreuungskosten)}</Sum></Kosten></Elt_k_ZV>\n`;
      xml += '</KBK>\n';
    } else if (k.betreuungskosten > 0) {
      console.warn('[eric xml-builder] childcare amount present but provider/period missing - skipped this entry\'s childcare block (should not happen if the app UI validation ran correctly)');
    }
    xml += '</Kind>\n';
  }
  return xml;
}

/* =============================================================================
   Anlage Unterhalt - support payments to needy relatives (ESt1A_U context).
   NEWLY WIRED IN - same orphan situation as Kind: mapped and collected,
   never actually built into the XML before this pass.
============================================================================= */
function buildUnterhalt(data) {
  const u = data.anlageUnterhalt;
  if (!u || !(u.betrag > 0)) return '';
  /* Real robustness fix found via testing against a genuine client file
     (kontextLeer on Persoenl, plus the business-rule errors that follow
     from it) - if the supported person's core identity is entirely
     blank, sending a structurally-empty Persoenl wrapper produces a
     confusing raw schema error on top of the already-clear
     skippedSections warning about the same missing data. Omitting the
     whole section here is honest and no worse - the warning already
     tells the user exactly what's needed, and a provably-incomplete
     structure would be rejected either way. */
  if (!u.personName && !u.profession && !u.personBirthDate) return '';
  /* YEAR DISPATCH: confirmed via full research (65 real Regeln
     analyzed) that 2021/2022 use a genuinely different structure, not
     just a wrapper difference like 2023-2025 share. Redirects to a
     completely separate, isolated implementation for those years -
     this function (and the confirmed-working 2023+ structure below it)
     is never touched for 2021/2022. See eric-fieldmap.js
     SECTION_YEAR_SUPPORT and buildLegacyUnterhalt() above for the full
     research trail. */
  if ((data.meta?.taxYear || 2025) < 2023) return buildLegacyUnterhalt(data);
  /* MULTI-YEAR SUPPORT (implemented after direct research, not guessed):
     confirmed via a full field-by-field and Regel-by-Regel comparison of
     the real 2023, 2024, and 2025 Jahresdokumentation that:
       - Every Kennzahl code used below is IDENTICAL across all three years.
       - Every validation rule (the Name/Profession/Birthdate all-or-nothing
         group, cohabitation, assets, amount/period pairing) is functionally
         IDENTICAL across all three years.
       - The ONLY real structural difference is that 2025 introduced an
         additional wrapper element, <Ang_HH_unt_P_Unt_Leist>, directly
         under <ESt1A_U> - 2023 and 2024 nest HH_unt_P/Ang_Unt_Pers/AW_U
         directly under <ESt1A_U> instead, with no such wrapper.
     This means the SAME field-building logic is correct for all three
     years - only the wrapper needs to be conditional on year, not a
     separate implementation per year. */
  const year = data.meta?.taxYear || 2025;
  const useWrapper = year >= 2025; // confirmed cutover year via direct Kontexte comparison
  const yn = (v) => (v ? '1' : '2'); // JaNein12BaseCType: 1=Ja, 2=Nein
  const isForeign = u.country && u.country !== 'Deutschland';

  /* CORRECTED (major): real bug found via actual ERiC schema validation
     (ERIC_IO_READER_SCHEMA_VALIDIERUNGSFEHLER, 610301200) against a
     genuine client file - confirmed via direct Kontexte/Felder row-order
     comparison for BOTH 2023 and 2025 that the element order below was
     wrong in THREE places, and - importantly - the correct order is
     IDENTICAL between years (only the wrapper differs, not the order
     itself), so this is one universal fix, not a year-specific one:
       1. Persoenl: IdNr, Name, Birthdate, Profession, Relationship
          (was: Name, Profession, Birthdate, IdNr, Relationship)
       2. Top-level ESt1A_U: HH_unt_P, AW_U, Ang_Unt_Pers
          (was: HH_unt_P, Ang_Unt_Pers, AW_U)
       3. Ang_Unt_Pers children: Allg, Ek_Bez_u_P, Weit_beitr_P
          (was: Allg, Weit_beitr_P, Ek_Bez_u_P)
     Built as three separate pieces here and assembled in the confirmed
     correct order, rather than one linear string, to make this order
     explicit and harder to accidentally break again. */
  let hhUntP = '<HH_unt_P>\n';
  hhUntP += tag(fm.ESt1A_U.householdAddress, u.householdAddress);
  if (isForeign) hhUntP += tag(fm.ESt1A_U.country, u.country);
  hhUntP += wholeEuroTag(fm.ESt1A_U.householdSize, u.householdSize || 2);
  hhUntP += '</HH_unt_P>\n';

  let angUntPers = '<Ang_Unt_Pers><Allg><Persoenl>\n';
  if (u.personIdnr) angUntPers += tag(fm.ESt1A_U.idnr, u.personIdnr.replace(/\s/g, ''));
  angUntPers += tag(fm.ESt1A_U.name, u.personName);
  angUntPers += tag(fm.ESt1A_U.personBirthDate, formatDateDE(u.personBirthDate));
  angUntPers += tag(fm.ESt1A_U.profession, u.profession);
  angUntPers += tag(fm.ESt1A_U.relationship, u.relationship);
  angUntPers += '</Persoenl><U_Berecht>\n';
  angUntPers += tag(fm.ESt1A_U.cohabitation, yn(u.cohabitation));
  angUntPers += tag(fm.ESt1A_U.kindergeldEntitlement, yn(u.kindergeldEntitlement));
  angUntPers += '</U_Berecht>\n';
  angUntPers += `<Verm_u_P>\n${tag(fm.ESt1A_U.hasAssets, yn(u.hasAssets))}</Verm_u_P>\n`;
  if (isForeign) angUntPers += `<Erkl_Beduerft>\n${tag(fm.ESt1A_U.foreignNeedConfirmed, yn(u.foreignNeedConfirmed))}</Erkl_Beduerft>\n`;
  angUntPers += '</Allg>\n';
  angUntPers += `<Ek_Bez_u_P><Allg>\n${tag(fm.ESt1A_U.hasOwnIncome, yn(u.hasOwnIncome))}</Allg></Ek_Bez_u_P>\n`;
  angUntPers += `<Weit_beitr_P>\n${tag(fm.ESt1A_U.otherContributor, yn(u.otherContributor))}</Weit_beitr_P>\n`;
  angUntPers += '</Ang_Unt_Pers>\n';

  let awU = '<AW_U><U_Ztr>\n';
  if (u.von && u.bis) awU += tag(fm.ESt1A_U.period, formatDateRangeDE(u.von, u.bis));
  if (u.von && u.bis) awU += tag(fm.ESt1A_U.paymentPeriod, formatDateRangeDE(u.von, u.bis));
  awU += wholeEuroTag(fm.ESt1A_U.amount, u.betrag);
  awU += '</U_Ztr></AW_U>\n';

  const inner = hhUntP + awU + angUntPers;

  return useWrapper
    ? `<ESt1A_U><Ang_HH_unt_P_Unt_Leist>\n${inner}</Ang_HH_unt_P_Unt_Leist></ESt1A_U>\n`
    : `<ESt1A_U>\n${inner}</ESt1A_U>\n`;
}

/* =============================================================================
   HA_35a - household services. CORRECTED nesting - both household and
   handwerker Kennzahlen confirmed under the same St_Erm/Handw_L/Einz path.
============================================================================= */
function buildHA35a(data) {
  const h = data.haushaltsnaheLeistungen;
  if (!h || (!h.haushaltsnaheDienstleistungen && !h.handwerkerleistungen)) return '';
  let inner = '';
  /* NOTE: household services (h.haushaltsnaheDienstleistungen) is
     intentionally NOT written here - flagged as likely using the wrong
     Kennzahlen entirely (see eric-fieldmap.js HA_35a.household comment).
     Rather than send data through a mapping known to be questionable
     and never tested, it's correctly omitted until researched properly. */
  if (h.handwerkerleistungen > 0) {
    /* CORRECTED: real bug found via the multi-year regression test -
       confirmed field order: Art (description), Rechnungsbetrag
       (total), Lohnanteile (labor portion), then Sum as a sibling. Our
       app's own field label confirms the collected value IS the labor
       portion already, so it's used for both total and labor fields. */
    inner += tag(fm.HA_35a.handwerkerArt, 'Handwerkerleistungen im Haushalt');
    inner += wholeEuroTag(fm.HA_35a.handwerkerInvoice, h.handwerkerleistungen);
    inner += wholeEuroTag(fm.HA_35a.handwerkerLabor, h.handwerkerleistungen);
  }
  if (!inner) return '';
  let xml = `<HA_35a><St_Erm><Handw_L><Einz>\n${inner}</Einz>`;
  if (h.handwerkerleistungen > 0) xml += `<Sum>\n${wholeEuroTag(fm.HA_35a.handwerkerLaborSum, h.handwerkerleistungen)}</Sum>`;
  xml += '</Handw_L></St_Erm></HA_35a>\n';
  return xml;
}

/* =============================================================================
   Wage-replacement benefits + loss carryforward + energetic renovation
============================================================================= */
function buildEM35c(data) {
  const e = data.par35cEnergetisch;
  if (!e || !e.street) return '';
  /* Confirmed exact sequence via the raw XSD, not the summary sheet
     (which has misled twice elsewhere in this project):
       Obj > Allg (address/building/area/prior-claim)
       Obj > Aufw > E0240902, Massn (start date, measure categories, Sum)
       Obj > EM_Vorj (prior-year amounts, optional)
     Ownership split (Eigent) and community/partnership shares
     (Ant_35c) are NOT implemented - defaults to sole ownership, the
     common case for this app, matching the same scoping used for
     Anlage V's Erm_Zuord_Ek attribution. */
  let allg = '<Allg>\n';
  allg += tag(fm.EM_35c.street, e.street);
  allg += tag(fm.EM_35c.buildDate, formatDateDE(e.buildDate));
  allg += tag(fm.EM_35c.plzOrt, e.plzOrt);
  allg += wholeEuroTag(fm.EM_35c.areaTotal, e.areaTotal);
  allg += wholeEuroTag(fm.EM_35c.areaOwn, e.areaOwn);
  allg += tag(fm.EM_35c.priorClaim, e.priorClaim ? '1' : '2');
  allg += '</Allg>\n';

  const categories = [
    ['measureWalls', 'Waende', e.walls], ['measureRoof', 'Dach', e.roof], ['measureCeiling', 'Geschossd', e.ceiling],
    ['measureWindows', 'Fenst_Tuer', e.windows], ['measureVentilation', 'Lueftung', e.ventilation], ['measureHeating', 'Heizung', e.heating],
  ];
  const total = categories.reduce((sum, [, , v]) => sum + N(v), 0);
  if (total <= 0) return ''; // no measure amount entered - nothing genuinely to declare

  let massn = tag(fm.EM_35c.measureStart, formatDateDE(e.measureStart));
  for (const [key, elName, val] of categories) {
    if (N(val) > 0) massn += `<${elName}>${wholeEuroTag(fm.EM_35c[key], val)}</${elName}>\n`;
  }
  massn += `<Sum>\n${wholeEuroTag(fm.EM_35c.measureSum, total)}</Sum>\n`;

  let aufw = `<Aufw>\n${tag(fm.EM_35c.otherFunding, e.otherFunding ? '1' : '2')}<Massn>\n${massn}</Massn>\n</Aufw>\n`;

  let vorj = '';
  if (N(e.priorYear1) > 0 || N(e.priorYear2) > 0) {
    vorj = '<EM_Vorj>\n';
    if (N(e.priorYear1) > 0) vorj += wholeEuroTag(fm.EM_35c.priorYear1, e.priorYear1);
    if (N(e.priorYear2) > 0) vorj += wholeEuroTag(fm.EM_35c.priorYear2, e.priorYear2);
    vorj += '</EM_Vorj>\n';
  }

  return `<EM_35c><Obj>\n${allg}${aufw}${vorj}</Obj></EM_35c>\n`;
}
function buildSonst(data) {
  const w = data.weitereAngaben || {};
  /* CORRECTED: confirmed via real XSD that E0190701 is Ja1BaseCType - a
     pure declaration flag ("a loss carryforward WAS established"), NOT
     the loss amount itself. Sends the confirmed correct flag value "1"
     whenever an amount is present - the actual carried-forward LOSS
     AMOUNT needs a genuinely different Kennzahl not yet found; that data
     is currently NOT transmitted (a real remaining gap, not silently
     guessed at). */
  if (!w.verlustvortrag) return '';
  return `<Sonst><Verl_Abz><Vortrag><Person>PersonA</Person>\n${tag(fm.Sonst.lossCarry, '1')}</Vortrag></Verl_Abz></Sonst>\n`;
}

/* ---------- date format: interchange uses ISO (YYYY-MM-DD), ERiC example uses DD.MM.YYYY ---------- */
function formatDateDE(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
/* CONFIRMED via real XSD (DatumBereichTTpMMbTTpMMBaseCType) and the actual
   ERiC validation error ("Bitte geben Sie einen gültigen Datumsbereich
   TT.MM-TT.MM ein") - day.month only, NO year, hyphen with no spaces.
   Was previously sending full dates with a spaced hyphen, which is wrong
   for every date-RANGE field in this schema. */
function formatDateRangeDE(isoFrom, isoTo) {
  const short = (iso) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    const [, m, d] = iso.split('-');
    return `${d}.${m}`;
  };
  const a = short(isoFrom), b = short(isoTo);
  return (a && b) ? `${a}-${b}` : '';
}
/* CONFIRMED via raw XSD (DatumBereichTTpMMpJJJJbTTpMMpJJJJBaseCType) that
   N-AUS's activity period is a genuinely DIFFERENT type from the
   month-only ranges used everywhere else in this schema - includes the
   full year on both ends. Checked directly rather than assumed uniform
   with formatDateRangeDE above. */
function formatDateRangeFullDE(isoFrom, isoTo) {
  const full = formatDateDE(isoFrom), fullTo = formatDateDE(isoTo);
  return (full && fullTo) ? `${full}-${fullTo}` : '';
}

/* =============================================================================
   Main entry point
============================================================================= */
/* =============================================================================
   Vorsatz - REQUIRED block, confirmed via ELSTER's official developer
   forum (product manager response) after ERIC_IO_READER_UNERWARTETE_ELEMENTE
   / "Eingefuegt-Kennzeichen J oder P" investigation. E0100081/E0100082 are
   "interne ERiC Felder" that must NEVER be submitted directly in ESt1A -
   ERiC auto-populates them from Vorsatz/ID and Vorsatz/IDEhefrau instead.
   Confirmed against the real official XSD (Vorsatz_67907_CType) - field
   ORDER MATTERS for XML schema validation, matches the sequence below
   exactly. This is a real, load-bearing XML block, not a Kennzahl-style
   context - element names are used directly (ID, IDEhefrau, etc.), not
   E-prefixed Kennzahl codes.
============================================================================= */
function buildVorsatz(data) {
  const h = data.hauptvordruck || {};
  const A = h.personA || {};
  const B = h.personB;
  const year = String(data.meta?.taxYear || 2025);

  let xml = '<Vorsatz>\n';
  xml += tag('Unterfallart', '10'); // fixed value for ESt per the XSD's own documentation
  xml += tag('Vorgang', '01'); // "Veranlagung" - standard filing (the other option, "04", is for advance-payment cases)
  /* Neuaufnahme (first-time filer, no Steuernummer) - DISABLED per a
     genuine real-world test: the exact same client, same data, was
     rejected via this path (rc 610301106, "unexpected elements") but
     succeeded cleanly (rc 0) with a real Steuernummer instead -
     confirmed by directly comparing both outcomes for the identical
     submission. Everything checked against the static schema and
     handbook was correct - the real XSD sequence, the Ordnungsbegriff
     format, the handbook's own confirmation this is a supported path
     for ESt - but something about how ERiC's actual runtime handles
     this specific combination (possibly related to send-Auth requiring
     the authenticating certificate's own identity to relate to the
     filer in a way a Neuaufnahme record can't yet establish, though
     this isn't confirmed with certainty) rejects it in practice. Rather
     than guess again without further verified evidence, this is
     disabled until the real cause is found - genuinely required only
     from here on, matching the one path already proven to work. */
  if (h.steuernummer) {
    xml += tag('StNr', String(h.steuernummer).replace(/\D/g, ''));
  }
  xml += tag('ID', A.idnr);
  if (B && B.idnr) xml += tag('IDEhefrau', B.idnr);
  xml += tag('Zeitraum', year);
  /* sender = the preparer (self-filer's own name, or the consultant/
     Kanzlei name for the consultant workspace) - reuses the same
     DatenLieferant concept already used in the TransferHeader. */
  const senderName = data.datenlieferant?.name || [A.vorname, h.lastName].filter(Boolean).join(' ') || 'SimplyTax';
  xml += tag('AbsName', senderName.slice(0, 45));
  if (A.anschrift?.strasse) xml += tag('AbsStr', [A.anschrift.strasse, A.anschrift.hausnummer].filter(Boolean).join(' ').slice(0, 30));
  if (A.anschrift?.plz) xml += tag('AbsPlz', A.anschrift.plz);
  if (A.anschrift?.ort) xml += tag('AbsOrt', A.anschrift.ort.slice(0, 29));
  xml += tag('Copyright', 'SimplyTax');
  /* DEFINITIVELY DISPROVEN (fourth pass) - confirmed via real ERiC
     validation, not just documentation ambiguity: sending a space for
     OrdNrArt returns "fuehrendesBlank" ("darf nicht mit einem Leerzeichen
     beginnen"). Since this is a strict 1-character field, a value
     beginning with a space and a value OF a space are the same thing
     here - so this proves conclusively that a blank OrdNrArt is NOT
     valid for E10's Vorsatz, unlike the developer manual's §15.4.1
     BDS-2 record (a genuinely different record type, as flagged as a
     real risk before trying this). E10's Vorsatz/OrdNrArt only accepts
     "S" (needs a real Steuernummer) or "O" (needs a real Ordnungsbegriff,
     which the app does not collect either). CONCLUSION: for this
     specific data type/ERiC version, there is currently no confirmed
     way to submit E10 without either a Steuernummer or an
     Ordnungsbegriff - "ID-only" filing may exist at the ELSTER-portal
     level for a human filer, but not through this specific
     software-transmission path as currently understood. Reverted to
     correctly omitting OrdNrArt when no steuernummer exists (an honest
     incomplete submission ERiC will clearly flag, rather than an
     actively wrong value). A sharpened, evidence-backed question - now
     armed with this definitive proof - is the right next step, not
     another guess. */
  if (h.steuernummer) xml += tag('OrdNrArt', 'S');
  // 'O' (Neuaufnahme) path disabled - see the detailed comment above where StNr/Ordnungsbegriff are built
  /* CORRECTED: Rueckuebermittlung/Bescheid confirmed via real ERiC
     validation to be required too ("ist anzugeben, ob die Bereitstellung
     der Bescheiddaten...gewünscht wird"). "2" matches the real official
     ELSTER example file - the app has no UI yet for this choice, so this
     is the same safe default ELSTER's own demo uses, not an invented
     value. */
  xml += '<Rueckuebermittlung>' + tag('Bescheid', '2') + '</Rueckuebermittlung>\n';
  xml += '</Vorsatz>\n';
  return xml;
}

function buildEStXML(data, opts = {}) {
  /* Defensive check - found via testing that malformed/incomplete
     interchangeData (missing hauptvordruck, missing personA) caused an
     uncaught "Cannot read properties of undefined" deep inside
     buildESt1A(), which the API route's try/catch turned into a generic
     500. A 500 misleadingly signals a server bug when the real problem
     is invalid input - this throws a clearly-labeled error instead, so
     callers (the API route) can distinguish "bad input, return 400"
     from "something actually broke, return 500". */
  if (!data || typeof data !== 'object') {
    throw new InterchangeDataError('interchangeData is missing or not an object');
  }
  if (!data.hauptvordruck || typeof data.hauptvordruck !== 'object') {
    throw new InterchangeDataError('interchangeData.hauptvordruck is missing');
  }
  if (!data.hauptvordruck.personA || typeof data.hauptvordruck.personA !== 'object') {
    throw new InterchangeDataError('interchangeData.hauptvordruck.personA is missing');
  }

  /* CORRECTED: real bug found while investigating the 610301106
     "unexpected elements" rejection - this fallback was hardcoded to
     '74931', an unregistered placeholder value, not this project's
     real, confirmed Hersteller-ID (38099, UrbanoperationsTax -
     confirmed and used consistently throughout this whole project).
     If ERIC_HERSTELLER_ID is ever unset in the environment this runs
     in, this fallback would have silently substituted a wrong,
     unregistered ID - which could plausibly explain a low-level
     rejection like this one, though it needs Render's actual current
     env var state confirmed to know for certain this was the cause
     here specifically. */
  /* CORRECTED per explicit instruction: no hardcoded Hersteller-ID
     value at all, not even a "correct-looking" one - a hardcoded ID in
     source code is itself a real risk if the code is ever shared or
     exposed. The only valid source now is genuine configuration
     (explicitly passed in, or the real environment variable). If
     neither is present, this fails loudly and immediately rather than
     silently substituting any value - a missing ID should stop the
     submission, not quietly send something wrong. */
  const herstellerID = opts.herstellerID || process.env.ERIC_HERSTELLER_ID;
  if (!herstellerID) {
    throw new InterchangeDataError('ERIC_HERSTELLER_ID is not configured - refusing to submit without a genuine, configured Hersteller-ID rather than guess at one.');
  }
  const testmerker = data.meta?.testmerker !== false ? '700000004' : '';
  const year = data.meta?.taxYear || 2025;
  const bundesland = bundeslandCode(data.hauptvordruck?.bundesland);

  const skippedSections = [];
  if ((data.anlageN || []).some(n => N(n.zeile17_agLeistungenEntfernung) > 0))
    skippedSections.push('anlageN employer-provided commute allowance (Lohnsteuerbescheinigung line 17) was entered but not transmitted - the field previously used for this was confirmed placed under the wrong section (Wk/AWT/Fahrt, not ArbL, found via a genuine client submission returning feldUnbekannt). Its exact real meaning needs the same dedicated research the neighboring line 20 field already went through before it can be sent correctly.');
  if ((data.anlageV || []).some(p => p.werbungskosten > 0 && wkCategoryTotal(p) === 0))
    skippedSections.push('anlageV Werbungskosten (rental deduction costs) - a total was entered but not broken into the real itemized categories (depreciation, loan interest, maintenance, management, other), so it could not be transmitted honestly. Enter the amount under the specific category it belongs to instead of one combined figure.');
  if ((data.anlageV || []).some(p => N(p.wkAfa) > 0))
    skippedSections.push('anlageV building depreciation (AfA) - transmitted using the standard default (2% linear depreciation), since the exact method and construction date aren\'t collected yet. This is the correct rate for most buildings completed after 1924, but if a different method or rate genuinely applies to this property, the amount transmitted may not be exactly right - worth confirming with a Steuerberater if unsure.');
  if ((data.anlageKind || []).some(k => k.betreuungskosten > 0 && (!k.betreuungAnbieter || !k.betreuungVon || !k.betreuungBis)))
    skippedSections.push('anlageKind childcare amount present without provider/period for at least one child - that entry\'s childcare block was skipped (should not happen if the app UI validation ran, worth checking why it was bypassed)');
  if ((data.anlageKind || []).some(k => k.vorname && k.geburtsdatum && !k.familienkasse))
    skippedSections.push('anlageKind present without the Familienkasse (responsible child-benefit office) for at least one child - confirmed required alongside name/birthdate (Regel 5021). This is genuinely case-specific data (which office is responsible) that cannot be safely defaulted - needs to come from the user.');
  if (!data.hauptvordruck?.personB && (data.anlageKind || []).some(k => k.vorname && k.geburtsdatum && !k.otherParentName))
    skippedSections.push('anlageKind present for a single filer without the other parent\'s name for at least one child - confirmed required (Regel 100500048/25). This is genuinely case-specific data that cannot be safely defaulted - needs to come from the user.');
  if ((data.anlageN || []).some(n => N(n.zeile20_verpflegung) > 0))
    skippedSections.push('Anlage N Zeile 20 (tax-free employer meal allowances) present but NOT transmitted - real bug found via testing against a genuine client file. It was previously sent to the wrong XML context (ArbL) under a field that actually means something different (the sum of CLAIMED foreign-travel meal expenses). Its correct home is E0205108 "vom Arbeitgeber steuerfrei ersetzt", which only makes sense alongside the travel-expense claim itself (days away, countries, per-diem rates) - none of which this app collects. Sending it alone would be an incomplete declaration, so it is honestly omitted rather than guessed.');
  (data.anlageNAUS || []).forEach((a, i) => {
    const label = `anlageNAUS entry ${i + 1}`;
    const year = data.meta?.taxYear || 2025;
    if (year < 2023) {
      skippedSections.push(`${label}: N-AUS for tax year ${year} is not yet implemented - confirmed via direct research that 2021/2022 use a genuinely different structure for the legal-basis and dual-residence fields (an opposite-polarity statement pair, not a simple enum), needing its own dedicated research pass the same way Anlage Unterhalt's legacy structure did. Not transmitted for this year.`);
      return;
    }
    if (a.legalBasis && a.legalBasis !== 'dba')
      skippedSections.push(`${label}: legal basis "${a.legalBasis === 'ate' ? 'ATE' : 'ZÜ'}" was selected, but only the standard DBA basis is implemented - the additional fields ATE/ZÜ specifically require (e.g. employer's business sector, the international organization involved) are not collected. Confirmed sent as DBA regardless - please review this entry, since that may not be correct for this case.`);
    if (!a.taetigkeitDesc || !a.taetigkeitVon || !a.taetigkeitBis)
      skippedSections.push(`${label}: the foreign activity's description and date range are required together (Regel 100260064) and were not fully provided - this entry will be rejected until filled in.`);
    if (!(N(a.arbeitstageGesamt) > 0) || !(N(a.arbeitstageAusland) > 0))
      skippedSections.push(`${label}: work-day counts are required whenever DBA is the legal basis (Regel 100260013 - ERiC rejects the entry outright without either a real day count or an explicit "not required" declaration for the narrow seafarer/aircrew exception, which this app does not offer). Not just an inaccuracy - this entry will be rejected until both counts are filled in.`);
    if (N(a.arbeitstageAusland) > 0 && N(a.arbeitstageAusland) < 184 && !a.shortStayBasis)
      skippedSections.push(`${label}: fewer than 184 days were spent abroad, so the standard 183-day exemption does not automatically apply (Regel 30). At least one of six legal/contractual bases must be stated for the exemption to be valid - this is a real distinction that needs to come from the user, not something the app can safely guess. This entry will be rejected until one is selected.`);
    if ((a.arbeitgeberName || a.arbeitgeberStreet || a.arbeitgeberPlz || a.arbeitgeberCity || a.arbeitgeberCountry)
      && !(a.arbeitgeberName && a.arbeitgeberStreet && a.arbeitgeberPlz && a.arbeitgeberCity && a.arbeitgeberCountry))
      skippedSections.push(`${label}: the employer's name, street, postcode, city and country must all be given together or not at all (Regel 24, confirmed) - some but not all were provided, so none were transmitted rather than sending an incomplete address ERiC would reject anyway. Please complete all five fields.`);
    if (a.dualResidence && (!a.foreignResStreet || !a.foreignResCountry))
      skippedSections.push(`${label}: a foreign residence was indicated but its address is incomplete (Regel 20) - this entry will be rejected until filled in.`);
  });
  if (data.par35cEnergetisch?.street) {
    const em = data.par35cEnergetisch;
    const emTotal = ['walls','roof','ceiling','windows','ventilation','heating'].reduce((s2, k) => s2 + N(em[k]), 0);
    if (emTotal > 0 && !em.measureStart)
      skippedSections.push('EM_35c (energetic renovation) - a measure amount was entered but the renovation start date was not, and ERiC requires both together (Regel 102240006). Found via testing against a genuine client file - the return will be rejected until this date is filled in.');
    if (emTotal > 0 && data.hauptvordruck?.personB)
      skippedSections.push('EM_35c (energetic renovation) - ownership was attributed entirely to the primary filer. The app does not collect a per-property ownership split, so if this property is jointly owned with the spouse, the attribution should be reviewed.');
    if (em.buildDate && em.measureStart) {
      const years = (new Date(em.measureStart) - new Date(em.buildDate)) / (365.25 * 24 * 3600 * 1000);
      if (years < 10)
        skippedSections.push('EM_35c (energetic renovation) - the building appears to be less than 10 years old at the start of the renovation. §35c EStG requires the building to be over 10 years old to qualify - please double-check this is correct before filing, since ERiC will reject it otherwise.');
    }
  }
  (data.anlageV || []).forEach((p, i) => {
    const label = `anlageV property ${i + 1}`;
    if (isForeignProperty(p)) {
      /* Foreign rental is routed to Anlage AUS as exempt income with
         Progressionsvorbehalt. Flagged so the user knows the treaty
         question was NOT decided for them. */
      if (!(N(p.mieteinnahmen) > 0)) {
        skippedSections.push(`${label}: a foreign country is set but no rental income was entered - nothing was transmitted for this property.`);
      } else {
        skippedSections.push(`${label}: foreign rental income was declared on Anlage AUS as tax-exempt income with Progressionsvorbehalt (the standard treatment under most double-taxation agreements). Whether the relevant treaty actually exempts this income rather than crediting foreign tax against German tax is a per-country legal question this app does not decide - worth confirming for the specific country before filing.`);
      }
      if (N(p.werbungskosten) > 0)
        skippedSections.push(`${label}: foreign rental expenses were subtracted to report a net figure, since Anlage AUS asks for net income rather than itemised costs.`);
      return;
    }
    if (!p.objekt && !p.street && !(N(p.mieteinnahmen) > 0)) return;
    const addr = (p.street || p.plz || p.ort)
      ? { street: p.street || '', plz: p.plz || '', ort: p.ort || '' }
      : splitPropertyAddress(p.objekt);
    if (!addr.street || !addr.plz || !addr.ort)
      skippedSections.push(`${label}: Anlage V requires the street with house number, the postcode AND the city as separate entries (Regel 3149) - one of these is still missing for this property.`);
    if (p.ferienwohnung == null || p.kurzfristig == null || p.angehoerige == null)
      skippedSections.push(`${label}: the three required usage declarations (holiday let / short-term letting / rented to relatives) were not all answered - unanswered ones were sent as "Nein", which is the common case but is a real declaration and should be confirmed by the taxpayer.`);
    if (!(N(p.nebenkosten) > 0))
      skippedSections.push(`${label}: no service charges (Neben-/Betriebskosten) were entered, so the return declares that these were not separately agreed (Regel 100750265). If the tenant does pay service charges, that amount must be entered instead.`);
    if (N(p.werbungskosten) > 0 && wkCategoryTotal(p) === 0)
      skippedSections.push(`${label}: rental expenses were entered as one combined total but not transmitted - break the amount down by category (depreciation, loan interest, maintenance, management costs, other) instead of one figure, since the real schema requires itemization. The declared income is currently gross until this is done.`);
    if (wkCategoryTotal(p) > 0)
      skippedSections.push(`${label}: itemized rental deduction costs were transmitted for the five most common categories (depreciation, loan interest, immediately-deductible maintenance, management costs, other). Rarer categories - special depreciation, maintenance spread over 5 years, financing costs, VAT-liable letting - are not yet collected; if any of these apply to this property, the deduction is understated until they are added.`);
    if (N(p.mieteinnahmen) > 0 && data.hauptvordruck?.personB)
      skippedSections.push(`${label}: the full surplus was attributed to the primary filer (Person A). The app does not collect a per-property ownership split, so if this property is jointly owned with the spouse, the attribution should be reviewed and may need splitting between E0701801 and E0701802.`);
  });
  if (data.anlageUnterhalt?.betrag > 0) {
    const uYear = data.meta?.taxYear || 2025;
    const isLegacyYear = uYear < 2023;
    if (isLegacyYear) {
      /* Legacy (2021/2022) required-field check - same core identity
         fields as 2023+ (Regel 27, "NichtAlleFelderOderKeinFeldAngegeben
         (E0120201,E0120202,E0120203)"), confirmed via the same
         completeness-group pattern, plus IdNr confirmed unconditionally
         required (Regel 28/29) - not just domestic-conditional the way
         2023+ turned out to be. Foreign households ARE implemented for
         legacy years (second research pass) - maps onto the same
         foreignNeedConfirmed boolean already collected for 2023+. */
      if (!data.anlageUnterhalt.personName || !data.anlageUnterhalt.profession || !data.anlageUnterhalt.personBirthDate || !data.anlageUnterhalt.householdAddress || !data.anlageUnterhalt.personIdnr) {
        /* CORRECTED: real gap found via a genuine client file where only
           one of five fields was actually missing (personIdnr), but the
           message listed all five every time regardless of which was
           genuinely the problem - the exact same class of issue just
           fixed on the frontend's equivalent alert. Now names only what's
           actually missing. */
        const missing = [];
        if (!data.anlageUnterhalt.personName) missing.push('name');
        if (!data.anlageUnterhalt.profession) missing.push('profession/marital status');
        if (!data.anlageUnterhalt.personBirthDate) missing.push('birthdate');
        if (!data.anlageUnterhalt.householdAddress) missing.push('household address');
        if (!data.anlageUnterhalt.personIdnr) missing.push('IdNr (required unconditionally for this tax year, unlike 2023 onward)');
        skippedSections.push(`anlageUnterhalt (legacy structure, tax year ${uYear}) support payment present but missing: ${missing.join(', ')} (confirmed via real Regeln 27-29 for the 2021/2022 structure).`);
      }
      if (data.anlageUnterhalt.country && data.anlageUnterhalt.country !== 'Deutschland' && data.anlageUnterhalt.foreignNeedConfirmed == null)
        skippedSections.push(`anlageUnterhalt (legacy structure, tax year ${uYear}) - a foreign household was indicated but the home-country confirmation (foreignNeedConfirmed) was not set - required together (Regel 30/31 for the 2021/2022 structure).`);
    } else if (!data.anlageUnterhalt.personName || !data.anlageUnterhalt.householdAddress || !data.anlageUnterhalt.profession || !data.anlageUnterhalt.personBirthDate) {
      const missing2023 = [];
      if (!data.anlageUnterhalt.personName) missing2023.push('name');
      if (!data.anlageUnterhalt.profession) missing2023.push('profession/marital status');
      if (!data.anlageUnterhalt.personBirthDate) missing2023.push('birthdate');
      if (!data.anlageUnterhalt.householdAddress) missing2023.push('household address');
      skippedSections.push(`anlageUnterhalt support payment present but missing: ${missing2023.join(', ')} (confirmed via a real empirical ERiC test, not just documentation - Regel 100120001).`);
    }
    if (!isLegacyYear && (!data.anlageUnterhalt.von || !data.anlageUnterhalt.bis))
      skippedSections.push('anlageUnterhalt support payment present but missing the support period (von/bis dates) - confirmed required together with the amount (Regel 300010/300135), found via testing against a genuine client file that omitted these dates.');
    if (!isLegacyYear && !(data.anlageUnterhalt.country && data.anlageUnterhalt.country !== 'Deutschland') && !data.anlageUnterhalt.personIdnr)
      /* CORRECTED: an earlier round's empirical test found IdNr "not
         required" - but that test only covered a FOREIGN scenario and was
         wrongly generalized to domestic too. The real multi-year
         regression test proved domestic genuinely DOES require it (Regel
         100120098, "Voraussetzung für den Abzug"). Only foreign is
         genuinely exempt. */
      skippedSections.push('anlageUnterhalt support payment for a domestic household present but missing the supported person\'s IdNr - confirmed required for domestic cases (Regel 100120098); only exempt when the household is genuinely foreign.');
    if (!isLegacyYear && data.anlageUnterhalt.country && data.anlageUnterhalt.country !== 'Deutschland' && data.anlageUnterhalt.foreignNeedConfirmed !== true)
      skippedSections.push('anlageUnterhalt support payment for a foreign household - confirmed via real ERiC validation (Regel 32) that the home-country-authority confirmation (foreignNeedConfirmed) is required for foreign households.');
  }
  if (data.weitereAngaben?.realsplittingAnlageU && !data.weitereAngaben.realsplitIdnr) {
    /* NOTE: the app does not currently collect a country/residence field
       specifically for Realsplitting (unlike Anlage Unterhalt) - so this
       warns whenever the amount is present without an IdNr, for any
       year. Confirmed via real research: 2023 requires this
       unconditionally (Regel 66, no country exception exists that
       year); 2024+ requires it specifically for a domestic residence -
       since we have no way to know the residence here, treating it as
       required is the safe, honest default rather than assuming it's
       exempt. */
    const rsYear = data.meta?.taxYear || 2025;
    skippedSections.push(`Realsplitting (Anlage U) sent without the ex-spouse's IdNr - confirmed required ${rsYear <= 2023 ? 'unconditionally for tax year ' + rsYear + ' (no foreign-residence exception exists that year)' : 'for a domestic residence, and the app does not yet collect residence country for this specific field to know otherwise'}. A real submission with this data would likely be rejected until this field is filled in.`);
  }
  if (data.weitereAngaben?.realsplittingAnlageU && !data.weitereAngaben.realsplitName)
    skippedSections.push('Realsplitting (Anlage U) sent without the ex-spouse\'s name - confirmed required together with the amount via real ERiC validation (Regel 101180025). This is a required field in the app (Anlage U section) - it appears to be blank for this specific record rather than something the app cannot collect.');
  if (skippedSections.length) {
    console.warn('[eric xml-builder] Sections present in data but not mapped, SKIPPED (not silently guessed):');
    skippedSections.forEach(s => console.warn('  - ' + s));
  }

  let nutzdaten = `<E10 xmlns="http://finkonsens.de/elster/elstererklaerung/est/e10/v${year}" version="${year}">\n`;
  /* CORRECTED (major): the ENTIRE call order below was wrong - confirmed
     directly and authoritatively via a real ERiC schema validation error
     (610301200 / ERIC_IO_READER_SCHEMA_VALIDIERUNGSFEHLER) that quoted
     the complete required content model:
       (ESt1A?,SA?,AgB?,HA_35a?,EM_35c?,Sonst?,WA_ESt?,ESt1A_U?,Kind*,
        L*,Anl_34b*,Anl_32c?,G*,Zins*,S*,N_GRE*,N*,N_DHH*,N_AUS*,KAP*,
        KAP_BET*,KAP_I*,AUS*,R*,RAV_bAV*,R_AUS*,SO?,V*,V_FeWo*,
        V_Sonstige?,FW*,VOR?,AV?,Mob?,Vorsatz?)
     XSD content models are strictly ORDERED even when every element is
     individually optional/repeatable - SA was being written after N,
     N_AUS, VOR, KAP, R, V, Kind and Unterhalt, when it must come
     immediately after ESt1A. This previously passed all our own
     structural tests (which checked presence and, after the earlier
     regression, INTRA-element field order - but never checked TOP-LEVEL
     section order against each other). Every build*() call below is now
     in the exact confirmed sequence; sections we don't implement are
     simply skipped, which is valid since every element in this model is
     optional (?) or repeatable (*), not required. */
  nutzdaten += buildESt1A(data);
  nutzdaten += buildSA(data);
  nutzdaten += buildAgB(data);
  nutzdaten += buildHA35a(data);
  nutzdaten += buildEM35c(data);
  nutzdaten += buildSonst(data);
  nutzdaten += buildUnterhalt(data); // ESt1A_U
  nutzdaten += buildKind(data);
  nutzdaten += buildAnlageN(data); // N
  nutzdaten += buildNAUS(data); // N_AUS
  nutzdaten += buildKAP(data);
  nutzdaten += buildAUS(data); // foreign rental - confirmed position: after KAP, before R
  nutzdaten += buildR(data);
  nutzdaten += buildV(data);
  nutzdaten += buildVOR(data);
  nutzdaten += buildVorsatz(data);
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

class InterchangeDataError extends Error {
  constructor(msg) { super(msg); this.name = 'InterchangeDataError'; }
}

module.exports = { buildEStXML, InterchangeDataError };
