/* afa-rate.js
   ─────────────────────────────────────────────────────────────────
   NEW, SEPARATE MODULE — standard building-depreciation (AfA) rate
   for rental property (Anlage V, §7 Abs. 4 EStG).

   This is deliberately a single, small, pure function with zero
   dependencies - it takes a completion year and returns the correct
   standard linear AfA rate, nothing else. It does NOT touch or
   import from any existing calculation code.

   Scope, deliberately narrow: this covers only the standard linear
   rate every rental property qualifies for by default. It does NOT
   cover the optional degressive method (5%, only for a narrow
   2023-2029 purchase window) or Denkmal-AfA/§7b Sonderabschreibung -
   those already have their own separate, dedicated fields and hints
   elsewhere in the app (wkSonderabschr) and are out of scope here.

   Verified against current law (checked directly, not assumed):
   - Completion before 1925:        2.5%  (§7 Abs. 4 Satz 1 Nr. 2c)
   - Completion 1925–2022:          2%    (§7 Abs. 4 Satz 1 Nr. 2b)
   - Completion 2023 onward:        3%    (§7 Abs. 4 Satz 1 Nr. 2a,
                                            raised from 2% by the
                                            Wachstumschancengesetz)

   One open item worth a professional's confirmation (flagged, not
   resolved by guessing): one source suggested the standard rate
   might have varied by filing year rather than purely by
   construction year for 2023-2025 specifically, while every other
   source checked was consistent with the simpler rule above. Treated
   the majority, consistent sourcing as authoritative here - worth a
   real confirmation as part of the broader tax-professional review
   (item 2.2), not something to leave unresolved silently.

   Usage:
     Node/backend:  const { afaRate } = require('./afa-rate');
     Browser:       afaRate(completionYear) - available as a plain
                     global function once the mirrored copy below is
                     loaded (see index.html, clearly marked to match
                     this file verbatim). */

function afaRate(completionYear) {
  const year = parseInt(completionYear, 10);
  if (!Number.isFinite(year) || year < 1000) return null; // no valid year given - caller decides the fallback
  if (year < 1925) return 2.5;
  if (year >= 2023) return 3;
  return 2; // 1925–2022
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { afaRate };
}
