# SimplyTax

A multi-consultant web app for preparing German income tax returns (Einkommensteuererklärungen) — built as a lightweight, affordable alternative to existing per-submission-fee platforms.

## Status: Phase 1 prototype

Single-file web app (`index.html`) — open it in a browser or run it inside the Claude.ai artifact environment (required for AI document extraction and persistent storage).

### Features
- **Multi-account:** tax consultants register their own workspace; client data is strictly separated per account (passwords stored hashed; 2FA planned for production)
- **Client management (Mandanten):** profiles, multi-year returns per client (personal data carried over), status tracking (Draft / In review / Submitted), search & filters
- **Guided interview** (9 steps): personal data incl. Finanzamt (Bundesland + 4-digit BUFA number), employment income, insurance (Vorsorgeaufwand), work expenses incl. double household (doppelte Haushaltsführung) & relocation, children (per-child Anlage Kind details: IdNr, Kindergeld, childcare, school fees) & family support (§ 33a incl. country groups), special expenses, household services (§ 35a)
- **AI auto-fill:** upload a Lohnsteuerbescheinigung (photo/PDF) — values are extracted via the Claude API and marked for mandatory review
- **Live refund estimate:** § 32a EStG tariff (2023–2025), Grundtarif/Splittingtarif, per-child deduction caps, church tax 8%/9% by Bundesland — clearly labeled as a non-binding estimate
- **Documents (Belege):** attach receipts per section, downloadable for Finanzamt verification requests
- **Finanzamt inquiries (Rückfragen):** per-return tracker with open/answered status
- **Client PDF summary:** bilingual, with the consultant's practice letterhead (configurable in Settings)
- **EN/DE interface toggle**, German number formatting throughout
- **Simulated ELSTER submission** (transfer ticket) — real submission requires ERiC integration (see below)

### Production roadmap
- **ELSTER/ERiC:** register as a software developer with the Bavarian tax office, integrate the ERiC library server-side (see `docs/requirements_v1.md`)
- **Backend:** EU-hosted (GDPR), PostgreSQL + encrypted object storage, server-side auth + 2FA, audit log (see `docs/data_hosting_concept_v1.md`)
- **Legal:** § 87d AO identification & client approval workflow; StBerG — users must be authorized to provide commercial tax preparation

### Disclaimer
Prototype for demonstration and internal testing. Not a substitute for professional tax advice. All estimates are unverbindlich; the Finanzamt's assessment prevails.
