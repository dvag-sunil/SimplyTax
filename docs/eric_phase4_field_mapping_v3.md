# SimplyTax - Phase 4 Field Mapping (ESt 2025) - v3

Resolves the person/employer-slot ambiguity flagged in v1/v2, and closes
most of the remaining gaps from v2. Source for the resolution: the real
official example file est_e10_2025.xml (ERiC-44.2.4.1 documentation
package) - this is the first time a mapping in this project has been
checked against actual XML structure, not just the field-name catalog.

---

## MAJOR: the "person/employer slot" ambiguity was never about slots

Every Anlage N field that appeared in groups of 2-4 Kennzahlen (gross,
wageTax, soli, churchPaid, churchSpouse) is NOT a person-slot variant at
all. It is an **individual line item vs. pre-computed sum** pair:

```
<N><Person>PersonA</Person>          <- person identified ONCE per whole block,
                                          via a sibling tag, not per-field
  <ArbL>
    <LStB_1_5_Einz>                  <- ONE of these PER EMPLOYER
      <E0200204>67554,76</E0200204>     gross, this employer, with cents
      <E0200304>17653,65</E0200304>     wage tax, this employer
      <E0200404>3543,54</E0200404>      soli, this employer
      <E0200504>775,43</E0200504>       church tax, this employer
    <LStB_1_5_Sum>                   <- ONE of these, the TOTAL across all employers
      <E0200002>1</E0200002>            count of employers
      <E0200201>67554</E0200201>        gross, summed (note: rounded, no cents)
      <E0200301>17653,65</E0200301>     wage tax, summed
      <E0200401>3543,54</E0200401>      soli, summed
      <E0200501>775,43</E0200501>       church tax, summed
```

CRITICAL implementation consequence for Phase 5: **ERiC does not sum these
itself.** The XML must contain BOTH one `<LStB_1_5_Einz>` block per employer
in our app's `emps[]` array, AND a separately pre-computed `<LStB_1_5_Sum>`
block with the totals. The XML builder must do this addition in code before
writing the XML - forgetting the Sum block, or getting the total wrong,
would likely fail ERiC's plausibility check.

For a MARRIED couple, this whole `<N>...</N>` block repeats once per person
(`<Person>PersonA</Person>` / `<Person>PersonB</Person>`), each with its own
Einz/Sum groups - not a different Kennzahl number per spouse.

### Resolved: the five previously "unresolved" Anlage N fields

| SimplyTax field | Einz (per employer) | Sum (person total, app must compute) |
|---|---|---|
| gross | E0200204 | E0200201 |
| wageTax | E0200304 | E0200301 |
| soli | E0200404 | E0200401 |
| churchPaid | E0200504 | E0200501 |
| churchSpouse | E0200604 | E0200601 |

Confirmed for gross/wageTax/soli/churchPaid directly from the real example
XML content. churchSpouse confirmed by numbering-pattern consistency (same
_04/_01 suffix structure) rather than direct XML content, since the example
file's single case didn't include a Konfessionsverschiedenheit scenario -
still high confidence, but worth a real validate-test once possible.

### sterbe32 - same pattern very likely, exact assignment not yet certain

E0201205 and E0201210 share an identical official description and sit in
the Versorgungsbezüge sub-block (not the ArbL/LStB_1_5 group), so they very
likely follow the same Einz/Sum split - but the example file's simple case
didn't include a Versorgungsbezüge scenario, so which of 05/10 is Einz vs
Sum is not yet confirmed by real XML content. Needs either a real multi-
employer test case or an actual ERiC validate response to settle.

---

## Gap closures from v2

**Donations - FOUND, and a categorization correction.** The "SO" context
searched in v2 is actually "Sonstige Einkünfte" (other income - crypto,
private sales under §22 EStG), NOT Sonderausgaben. The correct context is
**"SA"** (Sonderausgaben). Confirmed Kennzahlen:
- E0108405 - Spenden an Empfänger im Inland (domestic donations)
- E0105502 - Spenden an Empfänger im EU-/EWR-Ausland (EU/EEA donations)
- E0105902 - Summe der Umsätze, Löhne und Gehälter (basis for the donation
  deduction ceiling calculation)
- E0108509 / E0108607 - carryforward and endowment (Vermögensstock) special
  cases, lower priority for launch scope

**Kindschaftsverhältnis (kinship type) - FOUND.** E0500807 / E0500808 =
"Art des Kindschaftsverhältnisses" - this is the actual field our app's
kinship select (leiblich/adoptiert/pflegekind/stiefkind) maps to. The two
numbers likely correspond to first vs. subsequent child slots or a similar
structural repeat, not different kinship types themselves - needs the
Kind - Kennzahlen sheet (not just Felder) to confirm the exact repeat
pattern for multiple children, using the same method that resolved the
Anlage N ambiguity above (check the XML example structure directly rather
than the Felder sheet alone).

**wk.dhhKm - FOUND.** E0207116 = "einfache Entfernung in km (ohne
Flugstrecken)" - single-trip distance for Familienheimfahrten, in the
correct N_DHH context.

## Still genuinely open (exhausted search, not a guess)

- **k.childcare (Kinderbetreuungskosten amount)** - not found anywhere in
  the entire workbook despite exhaustive search across all ~40 Felder
  sheets. Likely represented as a structured block (e.g. requiring
  provider/invoice details) rather than a single amount field - needs
  checking the Kind - Kontexte or Kind - Regeln sheet, or a real example
  XML containing a childcare scenario, next session.
- **wk.relocation (Umzugskosten)** - the word "Umzug" appears nowhere in
  the entire workbook's field descriptions. Possible explanations: folded
  into a general Werbungskosten catch-all with no dedicated Kennzahl, or
  represented under a completely different Anlage not yet checked.
- **wk.dhhMonths** - not found; possibly not a distinct field at all if
  ERiC computes the double-household period from the trip dates instead.

---

## Updated status table

| Section | Status |
|---|---|
| Personal data / marital status | Fully mapped |
| Employment income / Anlage N | Fully mapped INCLUDING the Einz/Sum structure - ready for real code |
| Insurance / VOR | Fully mapped |
| Donations / Sonderausgaben (SA) | Mapped (main fields); category correction from v2 |
| Kindschaftsverhältnis | Field identified, exact multi-child repeat pattern to confirm |
| § 35a / HA_35a | Mapped (v2), labor/materials nuance flagged |
| Doppelte Haushaltsführung | dhhKm now resolved; dhhMonths and relocation still open |
| Capital gains / KAP | Structurally confirmed (v2), direct per-line lookup still pending |
| Children - other fields | Mapped in v2 (Kindergeld, Schulgeld) |
