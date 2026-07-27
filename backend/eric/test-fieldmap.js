/* Regression test for backend/eric/eric-fieldmap.js - run with:
   node backend/eric/test-fieldmap.js
   Guards against silent regressions: every Kennzahl string must look like
   a real field code (E + 7 digits), the einz/sum pairs for Anlage N must
   stay paired (never accidentally collapsed back to a flat array), and the
   unresolved-field list must never shrink silently (that would mean
   someone "resolved" a field without updating the mapping doc first - the
   doc is the source of truth, not the code). */
const fm = require('./eric-fieldmap.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + label); }
}

const KZ = /^E\d{7}$/;

function allKennzahlen(val) {
  if (Array.isArray(val)) return val;
  const out = [];
  if (val.kennzahlen) out.push(...val.kennzahlen);
  if (val.einz) out.push(val.einz);
  if (val.sum) out.push(val.sum);
  return out;
}

// every Kennzahl in every section must be well-formed
for (const [section, obj] of [['ESt1A', fm.ESt1A], ['N', fm.N], ['VOR', fm.VOR], ['SA', fm.SA], ['Kind', fm.Kind], ['N_DHH', fm.N_DHH], ['KAP', fm.KAP], ['HA_35a', fm.HA_35a]]) {
  for (const [field, val] of Object.entries(obj)) {
    for (const kz of allKennzahlen(val)) {
      check(`${section}.${field} "${kz}" looks like a real Kennzahl`, KZ.test(kz));
    }
  }
}

// section field counts as of this session - if these change, the mapping
// doc (v1/v2/v3) should have changed first
check('ESt1A has 11 fields', Object.keys(fm.ESt1A).length === 11);
check('N has 15 fields', Object.keys(fm.N).length === 15);
check('VOR has 7 fields', Object.keys(fm.VOR).length === 7);
check('SA has 3 fields', Object.keys(fm.SA).length === 3);
check('Kind has 3 fields', Object.keys(fm.Kind).length === 3);
check('N_DHH has 2 fields (dhhKm, dhhTrips)', Object.keys(fm.N_DHH).length === 2);
check('KAP has 15 fields (14 numbered + sparerUsed)', Object.keys(fm.KAP).length === 15);
check('HA_35a has 2 fields', Object.keys(fm.HA_35a).length === 2);

// the five previously-unresolved Anlage N fields are now confirmed einz/sum pairs
for (const f of ['gross', 'wageTax', 'soli', 'churchPaid', 'churchSpouse']) {
  check(`N.${f} has both einz and sum`, !!fm.N[f].einz && !!fm.N[f].sum);
  check(`N.${f} einz !== sum`, fm.N[f].einz !== fm.N[f].sum);
}
check('gross einz is E0200204 (confirmed from real XML)', fm.N.gross.einz === 'E0200204');
check('gross sum is E0200201 (confirmed from real XML)', fm.N.gross.sum === 'E0200201');

// sterbe32 is the one field that should still be unresolved
check('unresolved field list is exactly [sterbe32]', JSON.stringify(fm.unresolvedFields()) === JSON.stringify(['sterbe32']));
check('isSlotResolved false for sterbe32', fm.isSlotResolved(fm.N, 'sterbe32') === false);
check('isSlotResolved true for vb8', fm.isSlotResolved(fm.N, 'vb8') === true);
check('isSlotResolved null for unknown field', fm.isSlotResolved(fm.N, 'doesNotExist') === null);

// sumEmployerField: encodes the "ERiC does not sum itself" rule
const fakeEmps = [{ gross: '30000.50' }, { gross: '37554.26' }];
const summed = fm.sumEmployerField(fakeEmps, 'gross');
check('sumEmployerField counts employers correctly', summed.count === 2);
check('sumEmployerField totals correctly', Math.abs(summed.total - 67554.76) < 0.01);
check('sumEmployerField returns null for unknown field', fm.sumEmployerField(fakeEmps, 'doesNotExist') === null);

console.log(`\n===== eric-fieldmap.js: ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
