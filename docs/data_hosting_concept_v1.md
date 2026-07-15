# KlarSteuer — Data Storage & Hosting Concept (v1)

**Date:** 14 July 2026 · **Status:** Planning (Phase 2 — production)

---

## 1. Where the data lives today (prototype)

- Client data + documents are stored in the **built-in workspace storage** of the prototype (key-value store).
- Limits: ~5 MB per entry, single admin, tied to this workspace, no backups, no access control.
- **Rule: test data only — no real client data in the prototype.**

## 2. Production architecture (target)

```
Browser (KlarSteuer frontend)
        │  HTTPS / TLS 1.3
        ▼
Backend API (Node.js or similar) ── ERiC service (submission to ELSTER)
        │
        ├── PostgreSQL (EU server) ......... clients, returns, inquiries, audit log
        ├── Object storage, S3-compatible .. uploaded documents (Belege), encrypted
        └── Encrypted backups (daily) ...... separate location, EU
```

**Recommended EU hosting (GDPR-friendly, low cost):**
| Component | Option | Approx. cost |
|---|---|---|
| Server + PostgreSQL | Hetzner Cloud (Falkenstein/Nürnberg) or IONOS | €5–15 / month |
| Document storage | Hetzner Object Storage / IONOS S3 | €5 / month |
| Backups | Included snapshot/backup options | ~20% of server |

**Scale reality:** 100 clients × several tax years × documents is a *tiny* database for PostgreSQL. Even 10,000 clients would run comfortably on a €15/month server. Storage growth is driven by documents: ~1 MB average per Beleg → 100 clients × 10 docs ≈ 1 GB/year. No problem.

## 3. GDPR & security requirements (non-negotiable)

Tax data is highly sensitive personal data — and one field in our app is **Art. 9 GDPR special-category data: religious affiliation** (needed for church tax). Therefore:

1. **EU hosting only**, with a signed **Auftragsverarbeitungsvertrag (AVV/DPA)** with the hoster — consistent with the existing three-check GDPR framework (public DPA, documented transfer mechanism, no rights over uploads).
2. **Encryption in transit (TLS)** and **at rest** (database + document storage).
3. **Access control:** admin login with strong password + 2FA; later role-based access if staff is added.
4. **Audit log:** who created/changed/submitted what and when (already structured in the app).
5. **Backups:** automatic daily encrypted backups, restore tested.
6. **Retention:** tax-relevant records up to **10 years** (§ 147 AO); § 87d identification records **5 years**. Deletion concept after expiry.
7. **Legal basis & information duties:** privacy notice for clients (Art. 13), processing register (Art. 30), legal basis for religion data = necessity for tax filing (Art. 9 (2) g) / explicit consent as fallback.
8. **No US cloud** for the core data (avoids transfer-mechanism complexity entirely).
9. AI document extraction in production: EU-compliant setup or processing agreement per the established three-check framework.

## 4. Migration path

Prototype → production: the app's data model (clients, returns per year, documents, inquiries) maps 1:1 to database tables:
`clients` · `returns` (client_id, tax_year, status, transfer_ticket) · `documents` (return_id, section, file_ref) · `inquiries` (return_id, question, answer, status) · `audit_log`.
A one-time export/import script moves any test structures over. The frontend stays the same — only the storage layer is swapped for API calls.

## 5. Decision needed from Sunil (Phase 2)

- Hosting provider preference: Hetzner vs. IONOS?
- Backend language preference (Node.js recommended; ERiC wrapper examples exist for C++/C#/Java)?
- Single admin forever, or plan multi-user (e.g., Kanzlei colleagues) from the start?
