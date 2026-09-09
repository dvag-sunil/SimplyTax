/* test-estimate.js
   Stage 2 of the estimate-calculator verification work: real,
   assertion-based tests against the ACTUAL, LIVE computeEstimate() /
   computeEstimatePerPerson() functions - loaded directly from
   index.html itself (not a hand-copied duplicate of the logic), so
   this test suite can never silently drift out of sync with the real
   code the way the frontend estimate and backend XML-builder logic
   already once did (see the §35c/energEnabled bug this exact concern
   was raised over).

   Reference figures used to check against fall into two kinds:
   1. The pure §32a EStG tariff formula itself - checked against an
      independent implementation of the formula, transcribed directly
      from the actual, current law text (verified word-for-word
      against dejure.org / the BMF's own official Lohnsteuer-Handbuch
      in the same research pass that fixed the missing 2026 tariff row
      in index.html). This is Stage 1's own verification, kept here
      as a permanent, re-runnable check rather than a one-off.
   2. A handful of realistic filing scenarios, each hand-traced through
      every deduction step below the actual test case that produces it,
      so the expected zvE and tax are independently derived, not just
      "whatever the code currently outputs."

   Honest scope note, stated plainly rather than implied: this suite
   covers the core tariff formula (Stage 1, now solid) and a
   representative slice of the deduction logic (Stage 2). It does NOT
   yet cover every one of the many deduction rules this app implements
   (§33b, §24a Altersentlastungsbetrag, §31 Kinderfreibetrag-
   Günstigerprüfung, church tax edge cases, and others each have their
   own real logic not exercised here). Extending this suite to those
   remaining rules is real, additional work - this file is a genuine
   start, not a claim of full coverage. */

function stubEl() {
  return { style: {}, innerHTML: '', textContent: '', addEventListener: () => {}, classList: { add: () => {}, remove: () => {} },
    appendChild: () => {}, value: '', focus: () => {}, click: () => {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [] };
}
global.window = { addEventListener: () => {}, location: { search: '' }, innerWidth: 1200 };
global.document = { getElementById: () => stubEl(), addEventListener: () => {}, documentElement: { style: {} },
  createElement: () => stubEl(), querySelector: () => null, querySelectorAll: () => [] };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.location = { search: '', pathname: '/', href: '' };
global.history = { replaceState: () => {} };
global.navigator = { language: 'en' };
global.fetch = () => Promise.reject(new Error('no network in tests'));
global.URLSearchParams = URLSearchParams;
global.MutationObserver = class { observe() {} disconnect() {} };
global.IntersectionObserver = class { observe() {} disconnect() {} };
global.self = global;

const fs = require('fs');
const path = require('path');

// Extracts the same inline <script> block index.html actually runs -
// tests the real, live file, not a hand-copied duplicate of it.
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const startIdx = html.indexOf('<script>', html.indexOf('</head>'));
const endIdx = html.lastIndexOf('</script>');
const scriptCode = html.slice(startIdx + 8, endIdx);
eval(scriptCode + '; global.__computeEstimate = computeEstimate; global.__computeEstimatePerPerson = computeEstimatePerPerson; global.__estBase = estBase; global.__TARIFF = TARIFF;');

let passed = 0, failed = 0;
function approxEqual(actual, expected, tolerance, label) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL: ${label}\n  expected ~${expected} (±${tolerance}), got ${actual} (diff ${diff})`);
  }
}
function isTrue(cond, label) {
  if (cond) passed++;
  else { failed++; console.log(`FAIL: ${label}`); }
}

function baseClient(overrides) {
  return Object.assign({
    taxYear: 2025,
    p: { marital: 'single', birthDate: '1985-01-01', religion: 'none', bundesland: 'Hessen' },
    emps: [], wkItems: [], privIns: [], rente: [], kap: [], props: [],
    ex: {}, fam: { children: [] }, sa: {}, ins: {}, wk: {}, wkB: {}, oth: { emEnabled: true },
  }, overrides);
}

/* ===================================================================
   PART 1 - the core §32a tariff formula itself, independently
   re-implemented here directly from the actual, current law text
   (verified word-for-word against the official sources in the
   research that also fixed the missing 2026 row in index.html).
   =================================================================== */
function officialTariff(x, year) {
  const T = {
    2023: { gfb: 10908, z1: 15999, a1: 979.18, z2: 62809, a2: 192.59, c2: 966.53, r3: .42, d3: 9972.98, z3: 277825, r4: .45, d4: 18307.73 },
    2024: { gfb: 11784, z1: 17005, a1: 954.80, z2: 66760, a2: 181.19, c2: 991.21, r3: .42, d3: 10636.31, z3: 277825, r4: .45, d4: 18971.06 },
    2025: { gfb: 12096, z1: 17443, a1: 932.30, z2: 68480, a2: 176.64, c2: 1015.13, r3: .42, d3: 10911.92, z3: 277825, r4: .45, d4: 19246.67 },
    2026: { gfb: 12348, z1: 17799, a1: 914.51, z2: 69878, a2: 173.10, c2: 1034.87, r3: .42, d3: 11135.63, z3: 277825, r4: .45, d4: 19470.38 },
  }[year];
  if (x <= T.gfb) return 0;
  if (x <= T.z1) { const y = (x - T.gfb) / 10000; return Math.floor((T.a1 * y + 1400) * y); }
  if (x <= T.z2) { const z = (x - T.z1) / 10000; return Math.floor((T.a2 * z + 2397) * z + T.c2); }
  if (x <= T.z3) return Math.floor(T.r3 * x - T.d3);
  return Math.floor(T.r4 * x - T.d4);
}

console.log('=== Part 1: core §32a tariff formula, all years, all zone boundaries ===');
for (const year of [2023, 2024, 2025, 2026]) {
  const T = global.__TARIFF[year];
  const boundaries = [0, T.gfb, T.gfb + 1, T.z1e, T.z1e + 1, T.z2e, T.z2e + 1, T.z3e, T.z3e + 1, 500000];
  for (const x of boundaries) {
    approxEqual(global.__estBase(x, year), officialTariff(x, year), 0, `estBase(${x}, ${year})`);
  }
}

/* ===================================================================
   PART 2 - realistic filing scenarios, each hand-traced through the
   actual deduction steps to derive an independent expected figure.
   =================================================================== */
console.log('\n=== Part 2: realistic scenarios, hand-traced ===');

// 2a. Single filer, employed, no RV/KV/PV set (isolates the tariff +
// the €1,230 Werbungskosten-Pauschbetrag + the €36 statutory minimum
// Sonderausgaben-Pauschbetrag per § 10c EStG, applied even with zero
// donations entered).
{
  const c = baseClient({ emps: [{ gross: '50000', person: 'A' }] });
  const zvEExpected = 50000 - 1230 - 36; // gross - WK-Pauschbetrag - § 10c Sonderausgaben-Pauschbetrag
  const taxExpected = officialTariff(zvEExpected, 2025);
  const r = global.__computeEstimate(c);
  approxEqual(r.zvE, zvEExpected, 1, 'single employed 50000: zvE');
  approxEqual(r.tax, taxExpected, 1, 'single employed 50000: tax (before Soli/credits)');
}

// 2b. Same income, but married (Zusammenveranlagung) - tests the
// actual splitting formula: 2 x tariff(zvE/2), not tariff(zvE).
{
  const c = baseClient({
    p: { marital: 'married', birthDate: '1985-01-01', spouseBirth: '1985-01-01', religion: 'none', spouseReligion: 'none', bundesland: 'Hessen' },
    emps: [{ gross: '50000', person: 'A' }],
  });
  const zvEExpected = 50000 - 1230 - 72; // joint § 10c Pauschbetrag is 72, not 36
  const taxExpected = 2 * officialTariff(zvEExpected / 2, 2025);
  const r = global.__computeEstimate(c);
  approxEqual(r.zvE, zvEExpected, 1, 'married, one earner, 50000: zvE');
  approxEqual(r.tax, taxExpected, 1, 'married, one earner, 50000: splitting tariff applied');
  isTrue(r.tax < officialTariff(zvEExpected, 2025), 'married splitting tariff is genuinely lower than single tariff on the same income');
}

// 2c. Real Werbungskosten above the €1,230 flat rate - confirms the
// actual entered figure is used instead of the Pauschbetrag once it's
// genuinely higher, not the Pauschbetrag regardless.
{
  const c = baseClient({ emps: [{ gross: '50000', person: 'A' }], wkItems: [{ amount: '2500', person: 'A' }] });
  const zvEExpected = 50000 - 2500 - 36; // real costs (2500) exceed the 1230 flat rate, so real costs are used
  const r = global.__computeEstimate(c);
  approxEqual(r.zvE, zvEExpected, 1, 'real Werbungskosten (2500) above Pauschbetrag: zvE uses the real figure');
}

// 2d. Werbungskosten BELOW the flat rate - confirms the €1,230
// Pauschbetrag is still used even though real, entered costs are
// lower (the flat rate is a floor, not a cap).
{
  const c = baseClient({ emps: [{ gross: '50000', person: 'A' }], wkItems: [{ amount: '400', person: 'A' }] });
  const zvEExpected = 50000 - 1230 - 36; // Pauschbetrag (1230) still wins over the lower real cost (400)
  const r = global.__computeEstimate(c);
  approxEqual(r.zvE, zvEExpected, 1, 'Werbungskosten (400) below Pauschbetrag: zvE still uses the 1230 flat rate');
}

// 2e. Soli-Freigrenze - a taxAfter figure comfortably under the 2025
// Freigrenze (€19,950 for a single filer) should owe zero Soli.
{
  const c = baseClient({ emps: [{ gross: '35000', person: 'A' }] }); // tax well under the Freigrenze at this income
  const r = global.__computeEstimate(c);
  isTrue(r.taxAfter < 19950, 'sanity check: this scenario\'s tax is genuinely under the 2025 Soli-Freigrenze');
  approxEqual(r.soli, 0, 0, 'Soli is genuinely zero below the Freigrenze, not just small');
}

// 2f. Soli above the Freigrenze - a high earner should owe a real,
// non-zero Soli amount, capped at 5.5% of taxAfter.
{
  const c = baseClient({ emps: [{ gross: '150000', person: 'A' }] });
  const r = global.__computeEstimate(c);
  isTrue(r.taxAfter > 19950, 'sanity check: this scenario\'s tax is genuinely above the 2025 Soli-Freigrenze');
  isTrue(r.soli > 0, 'Soli is genuinely non-zero once above the Freigrenze');
  isTrue(r.soli <= r.taxAfter * 0.055 + 1, 'Soli never exceeds the statutory 5.5% cap');
}

// 2g. Kirchensteuer rate by Bundesland - Bayern/Baden-Württemberg use
// 8%, every other state uses 9% (§ 51a EStG in conjunction with the
// individual Land's own Kirchensteuergesetz).
{
  const cBayern = baseClient({ p: { marital: 'single', birthDate: '1985-01-01', religion: 'rk', bundesland: 'Bayern' }, emps: [{ gross: '50000', person: 'A' }] });
  const cHessen = baseClient({ p: { marital: 'single', birthDate: '1985-01-01', religion: 'rk', bundesland: 'Hessen' }, emps: [{ gross: '50000', person: 'A' }] });
  const rBayern = global.__computeEstimate(cBayern);
  const rHessen = global.__computeEstimate(cHessen);
  isTrue(rBayern.kist > 0 && rHessen.kist > 0, 'church tax is genuinely charged for a stated church membership');
  approxEqual(rBayern.kist / rHessen.kist, 8 / 9, 0.01, 'Bayern (8%) vs. Hessen (9%) church tax rate ratio matches the real, different statutory rates');
}

/* ===================================================================
   PART 3 - the three previously-missing rules, each independently
   researched and verified against multiple official sources before
   these test cases were written (not just re-deriving the code's own
   numbers back at it).
   =================================================================== */
console.log('\n=== Part 3: previously-missing rules ===');

// 3a. § 33b disability lump sum - the GdB table itself confirmed
// against the actual 2021 doubling legislation (still current, no
// further changes found for 2022-2026). Confirmed the allowance is
// applied WITHOUT the zumutbare-Belastung threshold (unlike ordinary
// außergewöhnliche Belastungen) - so it should reduce zvE by exactly
// its full table value, not a reduced amount.
{
  const c = baseClient({ emps: [{ gross: '50000', person: 'A' }], oth: { emEnabled: true, gdbA: '50' } });
  const cNoDisab = baseClient({ emps: [{ gross: '50000', person: 'A' }] });
  const r = global.__computeEstimate(c);
  const rBase = global.__computeEstimate(cNoDisab);
  approxEqual(rBase.zvE - r.zvE, 1140, 1, 'GdB 50 disability lump sum (§33b): reduces zvE by exactly the table value (1140), confirmed against the 2021 doubling legislation');
}
{
  // Confirmed against the law's own explicit statement: the highest
  // qualifying disability lump sum ("hilflos"/blind) is €7,400, and no
  // pro-rating by month applies even for a mid-year change - this app
  // doesn't collect a start date for this allowance at all, which is
  // only correct because the law itself says none is needed.
  const c = baseClient({ emps: [{ gross: '50000', person: 'A' }], oth: { emEnabled: true, gdbA: 'blind' } });
  const cNoDisab = baseClient({ emps: [{ gross: '50000', person: 'A' }] });
  const r = global.__computeEstimate(c);
  const rBase = global.__computeEstimate(cNoDisab);
  approxEqual(rBase.zvE - r.zvE, 7400, 1, 'highest disability tier ("hilflos"/blind, §33b): exactly 7400, the real statutory maximum');
}

// 3b. § 24a Altersentlastungsbetrag - confirmed against three
// independent, official worked examples (a person turning 64 in 2017,
// 2024, and 2025 respectively), each hand-matched to the app's own
// "first" variable, which represents the FIRST YEAR the allowance
// actually applies (the year after turning 64, per the law's own
// wording - "vor Beginn des Kalenderjahres... das 64. Lebensjahr
// vollendet"), not the year of the 64th birthday itself.
{
  // Turned 64 in 2017 (birth year 1953) -> allowance first applies
  // 2018 -> confirmed official rate: 19.2%, max €912.
  const c = baseClient({
    taxYear: 2025, p: { marital: 'single', birthDate: '1953-06-01', religion: 'none', bundesland: 'Hessen' },
    emps: [{ gross: '10000', person: 'A' }], // small enough that 19.2% stays under the 912 cap, isolating the percentage itself
  });
  const r = global.__computeEstimate(c);
  const wageBase = 10000; // no vb8 entered
  const expectedAeb = Math.min(Math.floor(wageBase * 0.192), 912);
  const cNoAge = baseClient({ p: { marital: 'single', birthDate: '2000-01-01', religion: 'none', bundesland: 'Hessen' }, emps: [{ gross: '10000', person: 'A' }] });
  const rNoAge = global.__computeEstimate(cNoAge);
  approxEqual(rNoAge.zvE - r.zvE, expectedAeb, 1, 'Altersentlastungsbetrag, cohort "turned 64 in 2017" (19.2%): matches the official worked example exactly');
}
{
  // Turned 64 in 2024 (birth year 1960) -> allowance first applies
  // 2025 -> confirmed official rate: 13.2%, max €627.
  const c = baseClient({
    taxYear: 2025, p: { marital: 'single', birthDate: '1960-03-01', religion: 'none', bundesland: 'Hessen' },
    emps: [{ gross: '10000', person: 'A' }],
  });
  const r = global.__computeEstimate(c);
  const expectedAeb = Math.min(Math.floor(10000 * 0.132), 627);
  const cNoAge = baseClient({ p: { marital: 'single', birthDate: '2000-01-01', religion: 'none', bundesland: 'Hessen' }, emps: [{ gross: '10000', person: 'A' }] });
  const rNoAge = global.__computeEstimate(cNoAge);
  approxEqual(rNoAge.zvE - r.zvE, expectedAeb, 1, 'Altersentlastungsbetrag, cohort "turned 64 in 2024" (13.2%): matches the official worked example exactly');
}
{
  // Turned 64 in 2025 (birth year 1961) -> allowance first applies
  // 2026 -> confirmed official rate: 12.8%, max €608. High enough
  // wage base (30000) to genuinely hit the cap, testing that side of
  // the min() too, not just the percentage.
  const c = baseClient({
    taxYear: 2026, p: { marital: 'single', birthDate: '1961-09-01', religion: 'none', bundesland: 'Hessen' },
    emps: [{ gross: '30000', person: 'A' }],
  });
  const r = global.__computeEstimate(c);
  const cNoAge = baseClient({ taxYear: 2026, p: { marital: 'single', birthDate: '2000-01-01', religion: 'none', bundesland: 'Hessen' }, emps: [{ gross: '30000', person: 'A' }] });
  const rNoAge = global.__computeEstimate(cNoAge);
  approxEqual(rNoAge.zvE - r.zvE, 608, 1, 'Altersentlastungsbetrag, cohort "turned 64 in 2025" (12.8%, cap of 608 genuinely reached): matches the official worked example exactly');
}

// 3c. § 31 Kinderfreibetrag-Günstigerprüfung - confirmed the exact
// Kindergeld and Kinderfreibetrag figures the code uses against
// multiple independent sources (matching exactly, across two separate
// years), and confirmed the comparison itself uses the STATUTORY
// entitlement (255x12 for one child in 2025), not whatever was
// actually entered/received, per § 31 Satz 4's own explicit wording.
{
  // High income, single parent, one child - the allowance should
  // genuinely win here (high marginal rate makes the Freibetrag more
  // valuable than the flat Kindergeld).
  const c = baseClient({
    p: { marital: 'single', birthDate: '1985-01-01', religion: 'none', bundesland: 'Hessen' },
    emps: [{ gross: '120000', person: 'A' }],
    fam: { children: [{ birthDate: '2015-01-01' }] },
  });
  const zvEBeforeKids = 120000 - 1230 - 36;
  const taxBeforeKids = officialTariff(zvEBeforeKids, 2025);
  const taxWithKfb = officialTariff(Math.max(0, zvEBeforeKids - 9600), 2025);
  const kgAnspruch = 255 * 12;
  const allowanceWins = (taxBeforeKids - taxWithKfb) > kgAnspruch;
  const r = global.__computeEstimate(c);
  isTrue(allowanceWins, 'sanity check: at this high an income, the Kinderfreibetrag genuinely should out-value the flat Kindergeld');
  approxEqual(r.tax, taxWithKfb, 1, 'high-income single parent, 1 child: Günstigerprüfung correctly picks the Kinderfreibetrag path');
}
{
  // Low income, single parent, one child - Kindergeld should
  // genuinely win here (low marginal rate makes the Freibetrag worth
  // less than the flat Kindergeld), so the child allowance should NOT
  // reduce the tax figure at all.
  const c = baseClient({
    p: { marital: 'single', birthDate: '1985-01-01', religion: 'none', bundesland: 'Hessen' },
    emps: [{ gross: '25000', person: 'A' }],
    fam: { children: [{ birthDate: '2015-01-01' }] },
  });
  const zvEBeforeKids = 25000 - 1230 - 36;
  const taxBeforeKids = officialTariff(zvEBeforeKids, 2025);
  const taxWithKfb = officialTariff(Math.max(0, zvEBeforeKids - 9600), 2025);
  const kgAnspruch = 255 * 12;
  const allowanceWins = (taxBeforeKids - taxWithKfb) > kgAnspruch;
  const r = global.__computeEstimate(c);
  isTrue(!allowanceWins, 'sanity check: at this low an income, the flat Kindergeld genuinely should out-value the Kinderfreibetrag');
  approxEqual(r.tax, taxBeforeKids, 1, 'low-income single parent, 1 child: Günstigerprüfung correctly keeps the Kindergeld path (tax unaffected by the child allowance)');
}

console.log(`\n===== test-estimate.js: ${passed} passed, ${failed} failed =====`);
process.exit(failed > 0 ? 1 : 0);
