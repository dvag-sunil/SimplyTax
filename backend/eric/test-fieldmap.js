/* Regression test for eric-fieldmap.js - run with: node test-fieldmap.js */
const fm = require('./eric-fieldmap.js');

let pass = 0, fail = 0;
function check(label, cond) { if (cond) pass++; else { fail++; console.log('FAIL: ' + label); } }

const KZ = /^E\d{7}$/;
/* Unterstuetzte_Person is a real, deliberate exception: confirmed via
   the raw 2022 XSD that this is an XML ELEMENT NAME whose value is a
   literal enum string ("Person1".."Person6"), not a numbered Kennzahl
   like everything else in this map. Not a bug - excluded explicitly
   rather than weakening the general check for everything else. */
const KZ_EXCEPTIONS = new Set(['Unterstuetzte_Person']);
function allKennzahlen(val) {
  if (typeof val === 'string') return [val];
  if (Array.isArray(val)) return val;
  const out = [];
  if (val.kennzahlen) out.push(...val.kennzahlen);
  if (val.einz) out.push(val.einz);
  if (val.sum) out.push(val.sum);
  return out;
}
for (const [section, obj] of Object.entries({
  ESt1A: fm.ESt1A, N: fm.N, VOR: fm.VOR, SA: fm.SA, Kind: fm.Kind, N_DHH: fm.N_DHH,
  KAP: fm.KAP, HA_35a: fm.HA_35a, Sonst: fm.Sonst, ESt1A_U: fm.ESt1A_U, N_AUS: fm.N_AUS,
  AgB: fm.AgB, EM_35c: fm.EM_35c, ESt1A_Ersatz: fm.ESt1A_Ersatz,
})) {
  for (const [field, val] of Object.entries(obj)) {
    for (const kz of allKennzahlen(val)) {
      if (KZ_EXCEPTIONS.has(kz)) continue;
      check(`${section}.${field} "${kz}" looks like a real Kennzahl`, KZ.test(kz));
    }
  }
}

check('total mapped fields = 244 (was 239 - +5 for the newly wired commute/Entfernungspauschale fields and the itemized Werbungskosten total, confirmed via real schema research)', Object.values({
  ESt1A: fm.ESt1A, N: fm.N, VOR: fm.VOR, SA: fm.SA, Kind: fm.Kind, N_DHH: fm.N_DHH,
  KAP: fm.KAP, HA_35a: fm.HA_35a, Sonst: fm.Sonst, ESt1A_U: fm.ESt1A_U, N_AUS: fm.N_AUS,
  AgB: fm.AgB, EM_35c: fm.EM_35c, ESt1A_Ersatz: fm.ESt1A_Ersatz, R: fm.R, V: fm.V,
}).reduce((sum, o) => sum + Object.keys(o).length, 0) === 244);

check('gross einz/sum correct', fm.N.gross.einz === 'E0200204' && fm.N.gross.sum === 'E0200201');
check('taxClass corrected to Steuerklasse', fm.N.taxClass.kennzahlen[0] === 'E0200002');
check('KAP k7 confirmed', fm.KAP.k7 === 'E1900701');
check('medical confirmed', fm.AgB.medical.kennzahlen[0] === 'E0161301');
check('unresolved field list is exactly [verpf20, sterbe32]', JSON.stringify(fm.unresolvedFields()) === JSON.stringify(['verpf20','sterbe32']));
check('isSlotResolved false for sterbe32', fm.isSlotResolved(fm.N, 'sterbe32') === false);
check('isSlotResolved false for verpf20 - deliberately unresolved after the mismapping found via a genuine client file', fm.isSlotResolved(fm.N, 'verpf20') === false);
check('isSlotResolved true for vb8', fm.isSlotResolved(fm.N, 'vb8') === true);
check('routeToVOR agRV -> rv', fm.routeToVOR('agRV') === 'rv');
check('routeToVOR unknown -> null', fm.routeToVOR('doesNotExist') === null);
check('computeAusTaxFree formula (CORRECTED: confirmed via real Regel 52 that the input is REMAINING wage, not total wage as first assumed, and the field type requires a whole integer result)', fm.computeAusTaxFree(35455, 90, 220) === 14504);
check('computeAusTaxFree zero-days safe', fm.computeAusTaxFree(60000, 0, 0) === 0);
check('amountToPflegegrad 600->2', fm.amountToPflegegrad('600') === '2');
check('amountToPflegegrad 1800->4', fm.amountToPflegegrad('1800') === '4');
check('amountToPflegegrad unknown->null', fm.amountToPflegegrad('9999') === null);

const fakeEmps = [{ gross: '30000.50' }, { gross: '37554.26' }];
const summed = fm.sumEmployerField(fakeEmps, 'gross');
check('sumEmployerField counts correctly', summed.count === 2);
check('sumEmployerField totals correctly', Math.abs(summed.total - 67554.76) < 0.01);

console.log(`\n===== eric-fieldmap.js: ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
