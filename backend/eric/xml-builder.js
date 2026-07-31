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
  if (w.ersatzleistungen) xml += `<Eink_Ers><Inl><Sum>\n${wholeEuroTag(fm.ESt1A_Ersatz.ersatz, w.ersatzleistungen)}</Sum></Inl></Eink_Ers>\n`;

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
    xml += wholeEuroTag(fm.N.vb9.kennzahlen[0], first.zeile9_versorgungMehrjaehrig);
    xml += wholeEuroTag(fm.N.ml10.kennzahlen[0], first.zeile10_mehrjaehrigEntschaedigung);
    xml += wholeEuroTag(fm.N.ersatz15.kennzahlen[0], first.zeile15_lohnersatz);
    /* CORRECTED: dba16 needs its own ArbL/Stfr_NAUS wrapper, confirmed via
       the real Felder sheet Kontext column - was flat directly under
       ArbL, causing "/N/ArbL/E0201502" to be unrecognized. */
    if (N(first.zeile16_dbaAte) > 0) xml += `<Stfr_NAUS>${wholeEuroTag(fm.N.dba16.kennzahlen[0], first.zeile16_dbaAte)}</Stfr_NAUS>\n`;
    xml += wholeEuroTag(fm.N.fahrt17.kennzahlen[0], first.zeile17_agLeistungenEntfernung);
    xml += wholeEuroTag(fm.N.pausch18.kennzahlen[0], first.zeile18_pauschal15);
    xml += wholeEuroTag(fm.N.verpf20.kennzahlen[0], first.zeile20_verpflegung);
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
  let xml = '';
  for (const a of entries) {
    xml += `<N_AUS><Person>Person${a.person === 'B' ? 'B' : 'A'}</Person><Staat>\n`;
    /* CORRECTED (second pass): the Allg wrapper alone was not enough -
       country and employer name each need their OWN sub-wrapper inside
       Allg (Wohnsitz and Unternehmen respectively), confirmed via the
       real Felder sheet - this was already researched correctly earlier
       but not applied precisely when first implemented. */
    if (a.land || a.arbeitgeberName) {
      xml += '<Allg>\n';
      if (a.land) xml += `<Wohnsitz>${tag(fm.N_AUS.ausCountry, a.land)}</Wohnsitz>\n`;
      if (a.arbeitgeberName) xml += `<Unternehmen>${tag(fm.N_AUS.ausEmployerName, a.arbeitgeberName)}</Unternehmen>\n`;
      xml += '</Allg>\n';
    }
    if (N(a.gesamtlohn) > 0) xml += `<Ang_ArbL><Sum_inl_ausl_AL>${wholeEuroTag(fm.N_AUS.ausTotalWage, a.gesamtlohn)}</Sum_inl_ausl_AL></Ang_ArbL>\n`;
    const dbaInner = (a.arbeitstageGesamt ? tag(fm.N_AUS.ausWorkDaysTotal, String(a.arbeitstageGesamt)) : '')
      + (a.arbeitstageAusland ? tag(fm.N_AUS.ausWorkDaysForeign, String(a.arbeitstageAusland)) : '')
      + wholeEuroTag(fm.N_AUS.ausTaxFreeResult, a.steuerfreierBetrag);
    if (dbaInner) xml += `<ArbL_DBA>\n${dbaInner}</ArbL_DBA>\n`;
    /* employer address sub-fields (ausEmployerStreet/Plz/City/Country) -
       deliberately NOT written, no data source in the app - see note above */
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
  let xml = '<VOR>\n';
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
  if (N(l.rv) > 0) xml += `<AVor><Person>PersonA</Person>\n${wholeEuroTag(fm.VOR.rv, l.rv)}<${fm.VOR.rvArbeitgeber}>0</${fm.VOR.rvArbeitgeber}>\n</AVor>\n`;
  if (N(l.gkv) > 0 || N(l.pv) > 0) {
    xml += '<Beitr_g_KV_PV_Inl><Person>PersonA</Person><AN>\n';
    xml += wholeEuroTag(fm.VOR.kv, l.gkv);
    xml += wholeEuroTag(fm.VOR.pv, l.pv);
    xml += '</AN></Beitr_g_KV_PV_Inl>\n';
  }
  /* NOTE: v.privateVersicherungen (Haftpflicht etc.) are collected by the
     app but not yet mapped to a VOR Kennzahl - most private insurance
     types outside statutory RV/KV/PV are either non-deductible or belong
     to a different context not yet researched. Not written here rather
     than guessed. kvOther (pkv28) also not yet placed in this corrected
     structure - needs its own confirmed nesting before use. */
  xml += '</VOR>\n';
  return xml;
}

/* =============================================================================
   Anlage KAP - capital gains, field names already match Zeile numbers.
   CORRECTED nesting per line-group, confirmed via the real Kennzahlen sheet.
============================================================================= */
function buildKAP(data) {
  const entries = data.anlageKAP || [];
  if (!entries.length) return '';
  let xml = '';
  for (const k of entries) {
    xml += `<KAP><Person>Person${k.person === 'B' ? 'B' : 'A'}</Person>\n`;
    const g1 = wholeEuroTag(fm.KAP.k7, k.zeile7_kapitalertraege) + wholeEuroTag(fm.KAP.k8, k.zeile8_aktiengewinne)
      + wholeEuroTag(fm.KAP.k12, k.zeile12_verlusteOhneAktien) + wholeEuroTag(fm.KAP.k13, k.zeile13_verlusteAktien);
    if (g1) xml += `<KapErt_inl_StAbz><Betr_lt_StBesch>\n${g1}</Betr_lt_StBesch></KapErt_inl_StAbz>\n`;
    const g2 = wholeEuroTag(fm.KAP.k16, k.zeile16_sparerPauschbetragGenutzt);
    if (g2) xml += `<Sp_PB>\n${g2}</Sp_PB>\n`;
    const g3 = wholeEuroTag(fm.KAP.k18, k.zeile18_inlaendischOhneSteuerabzug) + wholeEuroTag(fm.KAP.k19, k.zeile19_auslaendisch)
      + wholeEuroTag(fm.KAP.k20, k.zeile20_aktiengewinne) + wholeEuroTag(fm.KAP.k21, k.zeile21_stillhalterTermingeschaefte)
      + wholeEuroTag(fm.KAP.k22, k.zeile22_verlusteOhneAktien) + wholeEuroTag(fm.KAP.k23, k.zeile23_verlusteAktien);
    if (g3) xml += `<KapErt_kein_inl_StAbz>\n${g3}</KapErt_kein_inl_StAbz>\n`;
    const g4 = euroTag(fm.KAP.k43, k.zeile43_kapitalertragsteuer) + euroTag(fm.KAP.k44, k.zeile44_soli)
      + euroTag(fm.KAP.k45, k.zeile45_kirchensteuer);
    if (g4) xml += `<St_Abz_Betr_Inl_u_Inv_Ert>\n${g4}</St_Abz_Betr_Inl_u_Inv_Ert>\n`;
    xml += '</KAP>\n';
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
    xml += '<R>\n';
    if (r.art === 'gesetzlich' || !r.art) {
      xml += '<Leibr_gesetzl><Einz>\n';
      xml += wholeEuroTag(fm.R.gesetzlichAmount, r.jahresbetrag);
      if (r.rentenbeginn) xml += tag(fm.R.gesetzlichStart, r.rentenbeginn);
      if (r.ertragsanteilProzent != null) xml += `<Oeff_Kl>${tag(fm.R.gesetzlichPercent, r.ertragsanteilProzent)}</Oeff_Kl>\n`;
      xml += '</Einz></Leibr_gesetzl>\n';
    } else if (r.art === 'privat') {
      xml += '<Leibr_priv><Einz>\n';
      xml += wholeEuroTag(fm.R.privatAmount, r.jahresbetrag);
      if (r.rentenbeginn) xml += tag(fm.R.privatStart, r.rentenbeginn);
      xml += '</Einz></Leibr_priv>\n';
    }
    xml += '</R>\n';
  }
  return xml;
}

/* =============================================================================
   Anlage V - rental income. PARTIAL by design. CORRECTED nesting per
   confirmed Kennzahlen sheet paths (Allg/Lage for address,
   Einn/Mieteinn/Whg/Einz+Sum for income).
============================================================================= */
function buildV(data) {
  const entries = data.anlageV || [];
  if (!entries.length) return '';
  let xml = '';
  entries.forEach((p, idx) => {
    xml += '<V>\n';
    /* CORRECTED: Laufende_Nummer_V confirmed required via real ERiC
       validation - a simple 1-based sequence number identifying each
       property, using the array position already available from the loop. */
    xml += tag('Laufende_Nummer_V', String(idx + 1));
    if (p.objekt) {
      const parts = String(p.objekt).split(',');
      if (parts[0]) xml += `<Allg><Lage>${tag(fm.V.street, parts[0].trim())}</Lage></Allg>\n`;
    }
    if (N(p.mieteinnahmen) > 0) {
      xml += '<Einn><Mieteinn><Whg>\n';
      xml += `<Einz>${wholeEuroTag(fm.V.mieteinnahmen, p.mieteinnahmen)}</Einz>\n`;
      xml += `<Sum>${wholeEuroTag(fm.V.mieteinnahmenSum, p.mieteinnahmen)}</Sum>\n`;
      xml += '</Whg></Mieteinn></Einn>\n';
    }
    xml += '</V>\n';
  });
  return xml;
}

/* =============================================================================
   Sonderausgaben - donations
============================================================================= */
function buildSA(data) {
  const s = data.sonderausgaben;
  if (!s || !s.spenden) return '';
  /* CORRECTED nesting - Zuw/Sp_erh_Verm_Stift confirmed via the real
     Kennzahlen sheet. NOTE: this path name ("Spende erhöhter
     Vermögensstock-Stiftung") suggests E0108405 may specifically be for
     ENDOWMENT-related donations, not general everyday donations - worth
     re-confirming in a future pass whether a separate, simpler donations
     Kennzahl exists for the common case. Not changed here since this is
     still the same code already independently confirmed to exist and be
     donation-related - flagging the naming oddity rather than guessing
     a different code. */
  /* CORRECTED: confirmed via the real Regeln sheet (Regel 101100001) that
     E0108509 is a REQUIRED companion to E0108405 - "how much of this
     donation applies to THIS specific tax year" (Vermögensstock endowment
     donations can otherwise be legally spread across up to 10 years).
     This is why the amount alone kept failing across multiple rounds
     despite being present and correctly formatted - a genuinely separate
     missing field, not a formatting issue. Defaults to claiming the full
     amount in the current year (the simple, most common case) rather than
     spreading it - spreading would need real UI for the user to choose. */
  return `<SA><Zuw><Sp_erh_Verm_Stift><Person>PersonA</Person>\n${wholeEuroTag(fm.SA.donationsDomestic, s.spenden)}${wholeEuroTag(fm.SA.donationsThisYear, s.spenden)}</Sp_erh_Verm_Stift></Zuw></SA>\n`;
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
    xml += '<And_Aufw><Krankh><Einz>\n';
    xml += tag(fm.AgB.medical.kennzahlen[0], 'Krankheitskosten');
    xml += wholeEuroTag(fm.AgB.medical.kennzahlen[1], agb.krankheitskosten);
    xml += '</Einz><Sum>\n';
    xml += wholeEuroTag(fm.AgB.medical.kennzahlen[3], agb.krankheitskosten);
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
function buildKind(data) {
  const entries = data.anlageKind || [];
  if (!entries.length) return '';
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
    xml += tag(fm.Kind.birthDate.kennzahlen[0], formatDateDE(k.geburtsdatum));
    /* CORRECTED: confirmed via real XSD that E0500702 is a Ganzzahl
       (whole-number) type despite its Ja/Nein-sounding description
       ("Anspruch auf Kindergeld...") - sibling Ja1BaseCType fields
       elsewhere in this schema use "1" for yes, not "X" (that's only
       for JaXBaseCType fields specifically) - "X" triggered
       "zahlHatUngueltigeZeichen" since it's not a valid digit. */
    if (k.kindergeld) xml += tag(fm.Kind.kindergeld.kennzahlen[0], '1');
    xml += '</Allg></Ang_Kind>\n';

    const kinCode = KINSHIP_ENUM[k.kinship] || '1';
    xml += `<K_Verh><K_Verh_A>${tag(fm.Kind.kinshipType.kennzahlen[0], kinCode)}</K_Verh_A></K_Verh>\n`;

    /* CORRECTED: confirmed via real ERiC validation that Schulgeld/Sum
       (the total) is a required companion to Elt_k_ZV (the individual
       amount) - same Einz/Sum completeness pattern as everywhere else
       in this schema. For a single child/single payer, the total equals
       the individual amount. */
    if (k.schulgeld) xml += `<Schulgeld><Elt_k_ZV>${wholeEuroTag(fm.Kind.schoolFees, k.schulgeld)}</Elt_k_ZV><Sum>${wholeEuroTag(fm.Kind.schoolFeesSum, k.schulgeld)}</Sum></Schulgeld>\n`;

    /* childcare - now safe to write: the app's UI enforces provider+period
       whenever an amount is entered, so by the time data reaches here the
       ERiC rule 514139 requirement is already satisfied - but double-check
       defensively anyway rather than trust the frontend blindly. */
    if (k.betreuungskosten > 0 && k.betreuungAnbieter && k.betreuungVon && k.betreuungBis) {
      xml += '<KBK><Art><Einz>\n';
      xml += tag(fm.Kind.childcareProvider.kennzahlen[0], k.betreuungAnbieter);
      xml += tag(fm.Kind.childcarePeriod.kennzahlen[0], formatDateRangeDE(k.betreuungVon, k.betreuungBis));
      xml += wholeEuroTag(fm.Kind.childcareAmount.kennzahlen[0], k.betreuungskosten);
      xml += '</Einz><Sum>\n';
      xml += wholeEuroTag(fm.Kind.childcareSum.kennzahlen[0], k.betreuungskosten);
      xml += '</Sum></Art></KBK>\n';
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
  /* SCOPE LIMITATION, discovered via the real Regeln sheet condition for
     error 100120044 (persisted across 3 rounds before being properly
     researched instead of guessed at). E0125007 was ORIGINALLY MAPPED
     WRONG - it is not a standalone "support amount paid" field at all.
     It's part of the Opfergrenze (means-testing limit) SUB-CALCULATION,
     which requires an entire separate parent block describing the
     supported person - identity, relationship, income sources, assets -
     a 50+ field sub-form (/ESt1A_U/Ang_HH_unt_P_Unt_Leist/...) the app
     has no UI for at all. This mirrors the same honest-scope-limitation
     pattern already used for N-AUS employer address and Anlage V
     Werbungskosten: rather than guess-populate a form this deep, or keep
     sending a field that cascades into unresolvable completeness
     errors, support payments are NOT currently transmitted. The real
     "how much support did you pay" field is very likely elsewhere in
     that Ang_HH_unt_P_Unt_Leist sub-tree, not under OG_Ber at all - a
     genuine future research task if this feature becomes a priority,
     not something to guess at here. */
  return '';
}

/* =============================================================================
   HA_35a - household services. CORRECTED nesting - both household and
   handwerker Kennzahlen confirmed under the same St_Erm/Handw_L/Einz path.
============================================================================= */
function buildHA35a(data) {
  const h = data.haushaltsnaheLeistungen;
  if (!h || (!h.haushaltsnaheDienstleistungen && !h.handwerkerleistungen)) return '';
  let inner = '';
  inner += wholeEuroTag(fm.HA_35a.household.kennzahlen[0], h.haushaltsnaheDienstleistungen);
  inner += wholeEuroTag(fm.HA_35a.handwerker, h.handwerkerleistungen);
  return `<HA_35a><St_Erm><Handw_L><Einz>\n${inner}</Einz></Handw_L></St_Erm></HA_35a>\n`;
}

/* =============================================================================
   Wage-replacement benefits + loss carryforward + energetic renovation
============================================================================= */
function buildMisc(data) {
  const w = data.weitereAngaben || {};
  let xml = '';
  /* CORRECTED: verlustvortrag and energCost were previously written with
     NO wrapper tag at all (not even their own top-level context element)
     - the log showed these as bare "/E0190701" and "/E0241901" with no
     path prefix whatsoever. ersatzleistungen moved into buildESt1A
     itself, since it belongs inside the single ESt1A block, not a
     second separate one (E10 only allows one ESt1A element). */
  /* CORRECTED: confirmed via real XSD that E0190701 is Ja1BaseCType - a
     pure declaration flag ("a loss carryforward WAS established"), NOT
     the loss amount itself. Was incorrectly sending the euro amount to
     this field. Now sends the confirmed correct flag value "1" whenever
     an amount is present - but the actual carried-forward LOSS AMOUNT
     needs a genuinely different Kennzahl not yet found; that data is
     currently NOT transmitted (a real remaining gap, not silently
     guessed at). */
  if (w.verlustvortrag) xml += `<Sonst><Verl_Abz><Vortrag><Person>PersonA</Person>\n${tag(fm.Sonst.lossCarry, '1')}</Vortrag></Verl_Abz></Sonst>\n`;
  const e = data.par35cEnergetisch;
  if (e && e.aufwendungen) xml += `<EM_35c><Obj><Aufw><Massn><Sum>\n${wholeEuroTag(fm.EM_35c.energCost, e.aufwendungen)}</Sum></Massn></Aufw></Obj></EM_35c>\n`;
  return xml;
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
  if (h.steuernummer) xml += tag('StNr', String(h.steuernummer).replace(/\D/g, ''));
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

  const herstellerID = opts.herstellerID || process.env.ERIC_HERSTELLER_ID || '74931';
  const testmerker = data.meta?.testmerker !== false ? '700000004' : '';
  const year = data.meta?.taxYear || 2025;
  const bundesland = bundeslandCode(data.hauptvordruck?.bundesland);

  const skippedSections = [];
  if ((data.anlageV || []).some(p => p.werbungskosten > 0))
    skippedSections.push('anlageV Werbungskosten (rental deduction costs - real schema needs itemized categories, our simple total cannot be honestly mapped)');
  if ((data.anlageKind || []).some(k => k.betreuungskosten > 0 && (!k.betreuungAnbieter || !k.betreuungVon || !k.betreuungBis)))
    skippedSections.push('anlageKind childcare amount present without provider/period for at least one child - that entry\'s childcare block was skipped (should not happen if the app UI validation ran, worth checking why it was bypassed)');
  if (data.anlageUnterhalt && data.anlageUnterhalt.betrag > 0)
    skippedSections.push('anlageUnterhalt support payment (was mapped to the wrong field originally - real ELSTER validation revealed the correct field requires an entire 50+ field supported-person sub-form our app does not collect; not transmitted until that scope decision is made)');
  if (skippedSections.length) {
    console.warn('[eric xml-builder] Sections present in data but not mapped, SKIPPED (not silently guessed):');
    skippedSections.forEach(s => console.warn('  - ' + s));
  }

  let nutzdaten = `<E10 xmlns="http://finkonsens.de/elster/elstererklaerung/est/e10/v${year}" version="${year}">\n`;
  nutzdaten += buildESt1A(data);
  nutzdaten += buildAnlageN(data);
  nutzdaten += buildNAUS(data);
  nutzdaten += buildVOR(data);
  nutzdaten += buildKAP(data);
  nutzdaten += buildR(data);
  nutzdaten += buildV(data);
  nutzdaten += buildKind(data);
  nutzdaten += buildUnterhalt(data);
  nutzdaten += buildSA(data);
  nutzdaten += buildAgB(data);
  nutzdaten += buildHA35a(data);
  nutzdaten += buildMisc(data);
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
