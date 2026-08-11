# SimplyTax — ERiC Integration Specification (v1)

**Purpose:** Blueprint for connecting SimplyTax to ELSTER via the ERiC library once developer access is granted.
**Architecture:** Frontend → **canonical dataset (JSON, implemented)** → Backend ERiC adapter (to build) → ELSTER.

---

## 1. What is READY in the app today

| Layer | Status |
|---|---|
| Complete ESt data model (Hauptvordruck + all Anlagen) | ✅ implemented |
| Anlage N with official line numbers 1–34 per employment | ✅ implemented |
| Receiving Finanzamt as 4-digit BUFA number, validated before submission | ✅ implemented |
| Canonical export: `buildElsterDataset(client)` + "Export ELSTER dataset (JSON)" button | ✅ implemented |
| Submission status workflow (draft → submitted, transfer ticket slot) | ✅ implemented (simulated) |
| Testmerker flag in the dataset (`meta.testmerker`) | ✅ implemented |

The canonical JSON contains, per client and tax year: `meta` (Datenart e.g. `ESt_2024`, testmerker), `datenlieferant` (practice from Settings — the § 87d transmitter), `hauptvordruck` (Veranlagungsart, BUFA, IdNr, address, religion key EV/RK/VD/--, IBAN, Person B), `anlageN[]` (all lines keyed `zeileNN_…`), `werbungskosten`, `anlageVorsorgeaufwand` (statement totals + categorized private policies), `anlageKind[]`, `anlageUnterhalt`, `sonderausgaben`, `aussergewoehnlicheBelastungen`, `haushaltsnaheLeistungen`, `anlageKAP[]`, `anlageV[]`, `belege[]` (metadata), `schaetzung`.

## 2. What the BACKEND ADAPTER must do (after ERiC access)

1. **Register as developer** (elster.de → Entwicklerbereich; review by Bayerisches Landesamt für Steuern), obtain **Hersteller-ID**, download ERiC + the **Schnittstellenbeschreibung** for the ESt Datenart of each supported year.
2. **Kennzahlen mapping:** transform the canonical JSON into the official ELSTER XML. The exact element names/Kennzahlen come ONLY from the official schema (not public), which is why the app deliberately exports a semantic format (`zeile3_bruttoarbeitslohn` etc.) — the adapter is a pure translation table, no business logic.
3. **Call sequence per submission:** `EricInitialisiere()` → build XML → `EricBearbeiteVorgang()` with flags validate+send, certificate (Organisationszertifikat) + PIN, Hersteller-ID, testmerker → receive validation results, **Transferticket**, and the official transmission PDF → store ticket + PDF with the return → `EricBeende()`.
4. **Test first:** use the ELSTER test environment (test certificates, testmerker=true) until certified.
5. **Error handling:** ERiC returns per-field validation errors (ERiC error codes + Kennzahl) → map back to app field names via the same translation table → surface in the UI on the matching step.

## 3. Retrieval FROM ELSTER (inbound) — separate work packages

| Feature | Mechanism | Prerequisite |
|---|---|---|
| Pre-filled data (Belegabruf / VaSt: Lohnsteuerbescheinigung, KV/RV, Lohnersatz, Renten) | ERiC Datenabholung | Per-client permission via Berechtigungsverwaltung (one-time client approval) |
| Bescheid data & comparison (Bescheiddatenabgleich) | ERiC Datenabholung / DIVA (elektronische Bekanntgabe) | Empfangsvollmacht or client consent |
| Transfer status | Transferticket returned synchronously by `EricBearbeiteVorgang` | — |

These fill today's manual features automatically: VaSt replaces manual Bescheinigung entry, Bescheid retrieval feeds the "Finanzamt inquiries" step.

## 4. Known gaps / TODO before production submission

- **Steuernummer format:** ELSTER uses the 13-digit unified format; the app stores the display format → adapter must convert (per-Bundesland scheme).
- **Fünftelregelung (lines 9/10/19):** captured in the dataset but not in the in-app estimate; the Finanzamt/ERiC calculation applies it. Document this to users.
- **Zusammenveranlagung:** Person B income currently not captured as own statements — Phase: allow assigning statements to person A/B.
- **§ 87d duties:** ID-verification + client approval (Freigabe) steps deliberately deferred — MUST be activated before real transmission.
- **Multi-year Datenart versions:** one translation table per supported year (ESt_2023…ESt_2026); ERiC ships ~3 releases/year.
- **Product name check:** "SimplyTax" contains no "ELSTER" ✅; ERiC license requires showing the ELSTER privacy notice to end users → add to legal pages.

## 5. Suggested backend stack

Node.js service (matches team skills) wrapping ERiC via native bindings (N-API) or a thin C++/Java sidecar; runs on the EU server from the hosting concept; endpoints: `POST /returns/:id/validate`, `POST /returns/:id/submit`, `GET /returns/:id/status`, `POST /clients/:id/vast-retrieve`. The frontend keeps working unchanged — it already produces the input and displays the outputs (ticket, status, inquiries).
