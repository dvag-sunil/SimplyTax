# SteuerApp — Requirements & ELSTER Research Document (v1)

**Project:** Web app for preparing and submitting Einkommensteuererklärungen for multiple clients
**Owner:** Sunil
**Date:** 14 July 2026
**Status:** Requirements phase — approved features: guided data entry, Lohnsteuerbescheinigung upload with AI auto-fill (with manual review), refund calculator, English-first UI with German toggle

---

## 1. User & Login Architecture (DECIDED)

**Model: Single admin account + client profiles (Mandantenverwaltung)**

- ONE admin login for Sunil (the Bearbeiter / data transmitter).
- Inside the app: create unlimited **client profiles (Mandanten)** — one per customer, per tax year.
- Clients do NOT need their own ELSTER account or certificate.
- Optional (Phase 2): secure client access links so clients can upload documents and approve their return themselves.

**Roles:**
| Role | Rights |
|---|---|
| Admin (Sunil) | Create/edit/delete client profiles, enter data, review, submit, see all statuses |
| Client (optional, Phase 2) | Upload documents, view own return, give approval (Freigabe) |

---

## 2. ELSTER Authorization — How submission for 100 clients works

**Key fact:** The ELSTER certificate identifies the *Datenübermittler* (data transmitter), not the taxpayer. One certificate can submit returns for many different taxpayers.

- Register ONCE on Mein ELSTER → receive an electronic certificate.
- For a business, register an **Organisationszertifikat** (bound to the organization, e.g., GmbH or Kanzlei — registered with the organization's Steuernummer). This is the recommended option.
- Every submission is authenticated with this ONE certificate.

### Legal duties as Datenübermittler (§ 87d AO) — MUST be built into the app
1. **Identifizierung:** Before first transmission for a client, verify identity & address:
   - Name, first name(s), date of birth, place of birth, nationality, residential address
   - Verified against valid photo ID (Personalausweis / Reisepass); record ID number & issue date
   - Records must be retained **5 years**
   - Re-identification not needed for repeat clients unless circumstances raise doubt
2. **Client approval (Freigabe):** Provide the client the complete return data in an easily verifiable form; the client must confirm completeness & correctness BEFORE transmission.
3. **Liability:** Under § 72a AO, the transmitter is liable for tax damages caused by breaching § 87d duties.

**→ App features derived from this:**
- Client onboarding wizard with ID-verification step (ID type, number, issue date, verification date) — stored per client, 5-year retention flag
- Mandatory "Client Approval" checkpoint before any submission (PDF summary + confirmation record with timestamp)
- Audit log of all submissions (who, when, for whom, transfer ticket)

### ⚠️ Steuerberatungsgesetz note
§ 87d AO permits *transmission* by third parties. *Commercial preparation* of tax returns remains restricted (StBerG §§ 3, 4) to authorized persons (Steuerberater, Lohnsteuerhilfevereine, etc.). Recommended setup: operate under/with the Kanzlei. Clarify before go-live.

---

## 3. Technical Path to ELSTER (ERiC) — Backend integration plan

There is **no public REST API**. Real submission requires:

1. **Register as Hersteller/Entwickler** at elster.de (Entwickler area) — free
2. Review by IuK-Bereich of the **Bayerisches Landesamt für Steuern**
3. Receive developer-area access credentials (within a few days, by email)
4. Download **ERiC** (ELSTER Rich Client) — a C library with interface specification, free of charge, available for Windows/Linux/macOS
5. Request a **Hersteller-ID** (required in every transmission header)
6. ERiC validates, compresses, encrypts and transmits the tax XML to the ZPS ELSTER servers in Nürnberg
7. **Test environment available** — test submissions possible before production certification
8. Central API function: `EricBearbeiteVorgang()` — takes the tax XML + Datenart/Version, returns validation results, transfer ticket, and the official PDF (Übertragungsprotokoll)

**Architecture decision:** Frontend (this app) → generates the complete data set → Backend service (Node/Java/C# wrapper around ERiC on a Linux server) → ELSTER. During prototyping: **simulated submission layer** with identical data structure, so the ERiC backend can be plugged in without frontend changes.

**Notes:**
- Software/product name must NOT contain the word "ELSTER"
- ERiC releases update ~3×/year with new form versions (Datenart-Versionen per tax year, e.g., ESt_2025) — plan for annual maintenance
- License requires showing end users a specific privacy notice — include in app legal pages

---

## 4. Mandatory Data for an Einkommensteuererklärung (ESt 1 A + Anlagen)

### 4.1 Hauptvordruck ESt 1 A — ALWAYS required
- Steuernummer (if existing) + zuständiges **Finanzamt** (4-digit BUFA number)
- **Steuerliche Identifikationsnummer (IdNr)** — 11 digits, per person
- Veranlagungsjahr (tax year)
- Name, Vorname, Geburtsdatum, Geburtsort
- Adresse (Straße, Hausnummer, PLZ, Ort)
- Familienstand (+ date, e.g., married since / divorced since)
- **Religionszugehörigkeit** (church tax key, e.g., EV, RK, VD = none)
- Ausgeübter Beruf
- For Zusammenveranlagung: all of the above for spouse (Person B) + Veranlagungsart choice
- **Bankverbindung (IBAN)** + account holder — required for refund payout
- Mitwirkung eines Beraters (checkbox — relevant for us!)
- Signature is replaced electronically by the transmitter's certificate

### 4.2 Anlagen (situation-dependent)
| Anlage | When required | Key fields |
|---|---|---|
| **Anlage N** | Every employee | eTIN/IdNr, Steuerklasse, Bruttoarbeitslohn, Lohnsteuer, Soli, Kirchensteuer (from Lohnsteuerbescheinigung); Werbungskosten: Entfernungspauschale (workdays, km), Arbeitsmittel, Homeoffice-Pauschale, Fortbildung, doppelte Haushaltsführung |
| **Anlage Vorsorgeaufwand** | Nearly ALWAYS (almost every taxpayer has health insurance) | RV-Beiträge (Zeile 22–23 LStB), KV/PV-Beiträge (Zeile 25–26), AV-Beiträge (Zeile 27), private Versicherungen (Haftpflicht, Unfall...) |
| **Anlage Sonderausgaben** | Donations, church tax paid, Ausbildungskosten | Spenden (with receipts), gezahlte Kirchensteuer |
| **Anlage Außergewöhnliche Belastungen** | Illness costs, disability | Krankheitskosten, Behinderten-Pauschbetrag (degree of disability) |
| **Anlage Haushaltsnahe Aufwendungen (§ 35a)** | Handwerker / household services | Labor costs only, paid by bank transfer |
| **Anlage Kind** | Per child | IdNr of child, Kindergeld received, childcare costs, school fees |
| **Anlage R** | Pension income | Rentenbetrag, Rentenbeginn |
| **Anlage KAP** | Capital income above Sparer-Pauschbetrag / no church tax withheld | Kapitalerträge, einbehaltene KapESt |
| **Anlage V** | Rental income | Object address, rent income, costs |
| **Anlage S / G / EÜR** | Self-employed / trade income | Gewinnermittlung — note: e-filing then MANDATORY (§ 25 Abs. 4 EStG) |
| **Anlage WA-ESt** | Foreign matters | Foreign income, periods abroad |

### 4.3 eDaten (pre-filled by authorities — reduces client effort!)
Employers, insurers, and pension providers already transmit electronically: Lohnsteuerbescheinigung data, KV/RV contributions, Lohnersatzleistungen, pensions. Fields marked "e" need no manual entry unless values deviate. Phase 2+: the certificate also enables **Belegabruf (VaSt)** — retrieving these pre-filled data per client (requires client's one-time permission via Berechtigungsverwaltung).

### 4.4 Transmission header (technical, per submission)
- Datenart + version (e.g., ESt_2025), Hersteller-ID, Datenlieferant (transmitter identity), test flag, authentication certificate + PIN

---

## 5. Updated Feature List (Phase 1 prototype)

1. Admin login (simulated auth in prototype)
2. **Client profile management** — create/search/filter 100+ Mandanten, per-profile § 87d ID-verification record
3. Dashboard — statuses: Draft → In Review → Approved by client → Submitted
4. **Lohnsteuerbescheinigung upload → AI auto-fill → editable review screen**
5. Guided interview (all sections from §4 above), plausibility checks, progress bar
6. **Live refund estimate** (§ 32a EStG Grundtarif/Splittingtarif, Pauschbeträge applied), labeled "unverbindliche Schätzung"
7. Summary & review page (mirrors official form structure)
8. **Client approval step (Freigabe)** with timestamp record
9. Simulated ELSTER submission → mock transfer ticket + submission log
10. UI: **English default, German toggle (EN ⇄ DE)**, clean modern design, mobile-friendly

## 6. Later Phases
- Real ERiC backend integration (after Hersteller registration)
- Belegabruf / vorausgefüllte Steuererklärung per client
- Client self-service portal (uploads + digital Freigabe)
- Receipt management, multi-year comparison, Bescheid comparison (Bescheiddatenabgleich)

---

## 7. Open Questions for Sunil
1. Under which entity will you register the Organisationszertifikat — the Kanzlei or your own company?
2. Should clients get self-service access in Phase 1, or admin-only first? (Recommendation: admin-only first)
3. Which tax years must be supported at launch? (e.g., 2022–2025 — four years retroactive filing is possible for voluntary returns)
4. Data hosting preference for production (EU server, GDPR) — e.g., Hetzner/IONOS?
