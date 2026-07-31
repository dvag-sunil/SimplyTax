/* =============================================================================
   SimplyTax - Frontend/UI test suite
   =============================================================================
   Loads the REAL index.html script (extracted, unmodified logic) via
   vm.runInContext with a minimal DOM stub - not a reimplementation.
   Run with: node test/test-ui.js
============================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

require('./domstub.js');
global.alert = (m) => { global.__lastAlert = m; };
global.fetch = async (url, opts) => {
  global.__fetchCalls = global.__fetchCalls || [];
  global.__fetchCalls.push({ url, opts });
  return { ok: false, status: 501, json: async () => ({ error: 'eric_unavailable' }) };
};

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('Could not extract script from index.html'); process.exit(1); }
const src = scriptMatch[1];

const ctx = vm.createContext(global);
const exposeVars = [
  'rentePct', 'buildElsterDataset', 'computeEstimate', 'N', 'formatDE', 'isPaid', 'PAYMENT', 'ERIC',
  'checkTaxIdChecksum', 'checkIbanChecksum', 'checkSteuernummerChecksum', 'S', 'renderFaDropdown',
  'amountToPflegegrad', 'KINSHIP_ENUM',
];
vm.runInContext(src + `; globalThis.__t = {${exposeVars.map(v => `${v}: typeof ${v} !== 'undefined' ? ${v} : undefined`).join(', ')}};`, ctx);
const T = global.__t;

let pass = 0, fail = 0;
const failures = [];
function check(label, cond) {
  if (cond) pass++;
  else { fail++; failures.push(label); console.log('FAIL: ' + label); }
}
async function checkAsync(label, fn) {
  try { check(label, await fn()); }
  catch (e) { fail++; failures.push(label + ' (threw: ' + e.message + ')'); console.log('FAIL: ' + label + ' - threw: ' + e.message); }
}

/* ---------- helper: build a minimal but realistic client object ---------- */
function makeClient(overrides = {}) {
  return Object.assign({
    id: 'test-client', taxYear: 2025,
    p: { marital: 'single', firstName: 'Max', lastName: 'Muster', taxId: '02476291358',
      birthDate: '1985-01-01', bundesland: 'Hessen', faNumber: '2648', iban: 'DE89370400440532013000',
      religion: 'none' },
    emps: [], kap: [], props: [], rente: [], privIns: [],
    fam: { children: [] }, wk: {}, wkB: {}, oth: {}, ex: {}, ins: {}, sa: {}, docs: [], aus: {},
    pay: { status: 'unpaid' },
  }, overrides);
}

console.log('\n=== Calculation Engine - rentePct formula (statutory pension percentage) ===');
check('rentePct(2005) = 50 (statutory floor)', T.rentePct('2005') === 50);
check('rentePct(2020) = 80', T.rentePct('2020') === 80);
check('rentePct(2022) = 82', T.rentePct('2022') === 82);
check('rentePct(2025) = 83.5', T.rentePct('2025') === 83.5);
check('rentePct(9999 far future) caps at 100, never exceeds', T.rentePct('2100') === 100);
check('rentePct(garbage input) does not crash, returns a number', typeof T.rentePct('not-a-year') === 'number');
check('rentePct(empty string) does not crash', typeof T.rentePct('') === 'number');
check('rentePct(negative) does not crash', typeof T.rentePct('-5') === 'number');

console.log('\n=== amountToPflegegrad / kinship enum mappings ===');
if (T.amountToPflegegrad) {
  check('600 -> Pflegegrad 2', T.amountToPflegegrad('600') === '2');
  check('1800 -> Pflegegrad 4 (covers 4 or 5)', T.amountToPflegegrad('1800') === '4');
  check('unknown amount -> null, not a crash', T.amountToPflegegrad('99999') === null);
}

console.log('\n=== buildElsterDataset - marital status combinations ===');
for (const marital of ['single', 'married', 'married_sep', 'verwitwet', 'geschieden']) {
  checkAsync(`buildElsterDataset does not crash for marital='${marital}'`, async () => {
    const c = makeClient({ p: Object.assign({}, makeClient().p, { marital }) });
    const data = T.buildElsterDataset(c);
    return !!data && !!data.hauptvordruck;
  });
}

console.log('\n=== buildElsterDataset - children / kinship combinations (the childcare feature) ===');
for (const kinship of ['leiblich', 'adoptiert', 'pflegekind', 'stiefkind']) {
  checkAsync(`child with kinship='${kinship}' exports without crashing`, async () => {
    const c = makeClient({ fam: { children: [{ name: 'Kind', birth: '2015-01-01', kinship, kindergeld: '250' }] } });
    const data = T.buildElsterDataset(c);
    return Array.isArray(data.anlageKind) && data.anlageKind.length === 1 && data.anlageKind[0].kinship === kinship;
  });
}

checkAsync('child WITH childcare amount and ALL required fields exports correctly', async () => {
  const c = makeClient({ fam: { children: [{ name: 'Lena', birth: '2015-01-01', kinship: 'leiblich',
    childcare: '2400', ccProvider: 'Kita Sonnenschein', ccPeriodFrom: '2025-01-01', ccPeriodTo: '2025-12-31' }] } });
  const data = T.buildElsterDataset(c);
  const kid = data.anlageKind[0];
  return kid.betreuungskosten === 2400 && kid.betreuungAnbieter === 'Kita Sonnenschein';
});

checkAsync('child with childcare amount but NO provider still exports (backend enforces the requirement, not a UI crash)', async () => {
  const c = makeClient({ fam: { children: [{ name: 'Lena', birth: '2015-01-01', kinship: 'leiblich', childcare: '2400' }] } });
  const data = T.buildElsterDataset(c);
  return Array.isArray(data.anlageKind); // must not throw, regardless of completeness
});

checkAsync('multiple children (5) with mixed kinship types export without crashing', async () => {
  const kids = [];
  const types = ['leiblich', 'adoptiert', 'pflegekind', 'stiefkind', 'leiblich'];
  for (let i = 0; i < 5; i++) kids.push({ name: 'Kind' + i, birth: '2015-01-01', kinship: types[i] });
  const c = makeClient({ fam: { children: kids } });
  const data = T.buildElsterDataset(c);
  return data.anlageKind.length === 5;
});

console.log('\n=== buildElsterDataset - pension (Anlage R) gesetzlich/privat ===');
checkAsync('statutory pension export includes the auto-computed percentage', async () => {
  const c = makeClient({ rente: [{ person: 'A', type: 'gesetzlich', amount: '18000', startYear: '2022' }] });
  const data = T.buildElsterDataset(c);
  return data.anlageR[0].ertragsanteilProzent === T.rentePct('2022');
});
checkAsync('private pension export has NO percentage (matches the real ERiC schema)', async () => {
  const c = makeClient({ rente: [{ person: 'A', type: 'privat', amount: '6000', startYear: '2020', pct: '18' }] });
  const data = T.buildElsterDataset(c);
  return data.anlageR[0].ertragsanteilProzent === null;
});

console.log('\n=== buildElsterDataset - N-AUS foreign employment calculator ===');
checkAsync('N-AUS export uses the exact same formula as the calculator UI', async () => {
  const c = makeClient({ emps: [{ id: 'emp1', employer: 'Muster GmbH', gross: '60000' }],
    aus: { emp1: { country: 'Schweiz', totalWage: '60000', workDaysTotal: '220', workDaysForeign: '90' } } });
  const data = T.buildElsterDataset(c);
  return data.anlageNAUS.length === 1 && Math.abs(data.anlageNAUS[0].steuerfreierBetrag - 24545.45) < 0.01;
});

console.log('\n=== Robustness - malformed / extreme input must never crash buildElsterDataset ===');
checkAsync('completely empty client object does not crash', async () => {
  const data = T.buildElsterDataset({ p: {}, emps: [], kap: [], props: [], rente: [], fam: { children: [] }, wk: {}, wkB: {}, oth: {}, ex: {}, ins: {}, sa: {}, docs: [], aus: {} });
  return !!data;
});
checkAsync('negative numeric amounts do not crash the calculation', async () => {
  const c = makeClient({ emps: [{ id: 'e1', gross: '-5000', wageTax: '-100' }] });
  const data = T.buildElsterDataset(c);
  return !!data;
});
checkAsync('extremely large numeric amounts do not crash', async () => {
  const c = makeClient({ emps: [{ id: 'e1', gross: '999999999999', wageTax: '1' }] });
  const data = T.buildElsterDataset(c);
  return !!data;
});
checkAsync('non-numeric garbage in amount fields does not crash (N() must coerce safely)', async () => {
  const c = makeClient({ emps: [{ id: 'e1', gross: 'not-a-number', wageTax: 'abc' }] });
  const data = T.buildElsterDataset(c);
  return !!data;
});
checkAsync('unicode/emoji in text fields does not crash export', async () => {
  const c = makeClient({ p: Object.assign({}, makeClient().p, { firstName: '日本語 🎉 Müller ñ' }) });
  const data = T.buildElsterDataset(c);
  return data.hauptvordruck.personA.vorname.includes('🎉');
});
checkAsync('50 employers (stress test) does not hang or crash', async () => {
  const emps = [];
  for (let i = 0; i < 50; i++) emps.push({ id: 'e' + i, gross: String(1000 * i), wageTax: '100', person: i % 2 === 0 ? 'A' : 'B' });
  const c = makeClient({ emps });
  const start = Date.now();
  const data = T.buildElsterDataset(c);
  const elapsed = Date.now() - start;
  return data.anlageN.length === 50 && elapsed < 5000; // must complete well under 5s, not hang
});
checkAsync('20 children (stress test) does not hang or crash', async () => {
  const kids = [];
  for (let i = 0; i < 20; i++) kids.push({ name: 'Kind' + i, birth: '2010-01-01', kinship: 'leiblich' });
  const c = makeClient({ fam: { children: kids } });
  const start = Date.now();
  const data = T.buildElsterDataset(c);
  const elapsed = Date.now() - start;
  return data.anlageKind.length === 20 && elapsed < 5000;
});

console.log('\n=== Payment gate logic ===');
check('isPaid: when PAYMENT.enabled=false, everyone is treated as paid (current app default)', T.isPaid(makeClient()) === !T.PAYMENT.enabled);
checkAsync('isPaid correctly reflects a genuinely paid client when PAYMENT.enabled is true', async () => {
  const originalEnabled = T.PAYMENT.enabled;
  T.PAYMENT.enabled = true;
  const paidResult = T.isPaid(makeClient({ pay: { status: 'paid' } }));
  const unpaidResult = T.isPaid(makeClient({ pay: { status: 'unpaid' } }));
  T.PAYMENT.enabled = originalEnabled;
  return paidResult === true && unpaidResult === false;
});

console.log('\n=== Real-time field validation triggers (must not crash or hang without a live backend) ===');
async function testValidationTriggers() {
  await checkAsync('checkTaxIdChecksum does not throw when backend is unavailable (degrades silently)', async () => {
    await T.checkTaxIdChecksum('02476291358');
    return true;
  });
  await checkAsync('checkIbanChecksum does not throw when backend is unavailable (degrades silently)', async () => {
    await T.checkIbanChecksum('DE89370400440532013000');
    return true;
  });
  await checkAsync('checkTaxIdChecksum with a garbage value (not 11 digits) does not even attempt a network call', async () => {
    global.__fetchCalls = [];
    await T.checkTaxIdChecksum('abc');
    return global.__fetchCalls.length === 0;
  });

  console.log(`\n===== UI test suite: ${pass} passed, ${fail} failed =====`);
  if (failures.length) console.log('Failures:', failures);
  process.exit(fail ? 1 : 0);
}
testValidationTriggers();
