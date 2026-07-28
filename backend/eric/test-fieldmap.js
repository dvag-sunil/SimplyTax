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
for (const [section, obj] of [['ESt1A', fm.ESt1A], ['N', fm.N], ['VOR', fm.VOR], ['SA', fm.SA], ['Kind', fm.Kind], ['N_DHH', fm.N_DHH], ['KAP', fm.KAP], ['HA_35a', fm.HA_35a], ['Sonst', fm.Sonst], ['ESt1A_U', fm.ESt1A_U], ['N_AUS', fm.N_AUS], ['AgB', fm.AgB], ['EM_35c', fm.EM_35c], ['ESt1A_Ersatz', fm.ESt1A_Ersatz]]) {
  for (const [field, val] of Object.entries(obj)) {
    for (const kz of allKennzahlen(val)) {
      check(`${section}.${field} "${kz}" looks like a real Kennzahl`, KZ.test(kz));
    }
  }
}

// section field counts as of this session - if these change, the mapping
// doc (v1/v2/v3) should have changed first
check('ESt1A has 11 fields', Object.keys(fm.ESt1A).length === 11);
check('N has 20 fields', Object.keys(fm.N).length === 20);
check('VOR has 7 fields', Object.keys(fm.VOR).length === 7);
check('SA has 3 fields', Object.keys(fm.SA).length === 3);
check('Kind has 4 fields', Object.keys(fm.Kind).length === 4);
check('Sonst has 1 field', Object.keys(fm.Sonst).length === 1);
check('ESt1A_U has 2 fields', Object.keys(fm.ESt1A_U).length === 2);
check('N_AUS has 13 fields', Object.keys(fm.N_AUS).length === 13);
check('AgB has 3 fields', Object.keys(fm.AgB).length === 3);
check('medical confirmed via Kontexte hierarchy', fm.AgB.medical.kennzahlen[0] === 'E0161301');
check('EM_35c has 2 fields', Object.keys(fm.EM_35c).length === 2);
check('ESt1A_Ersatz has 1 field', Object.keys(fm.ESt1A_Ersatz).length === 1);
check('gdbA confirmed', fm.AgB.gdbA.kennzahlen[0] === 'E0109708');
check('ersatz confirmed', fm.ESt1A_Ersatz.ersatz.kennzahlen[0] === 'E0104801');
check('energCost confirmed', fm.EM_35c.energCost.kennzahlen[0] === 'E0241901');
check('computeAusTaxFree matches formula', fm.computeAusTaxFree(60000, 90, 220) === 24545.45);
check('computeAusTaxFree handles zero days', fm.computeAusTaxFree(60000, 0, 0) === 0);
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

// newly confirmed N fields this session
check('taxClass corrected to Steuerklasse (E0200002)', fm.N.taxClass.kennzahlen[0] === 'E0200002');
check('bmg29 confirmed', fm.N.bmg29.kennzahlen[0] === 'E0200902');
check('pausch18 confirmed', fm.N.pausch18.kennzahlen[0] === 'E0203901');
check('dba16 confirmed', fm.N.dba16.kennzahlen[0] === 'E0201502');
check('ml10 confirmed', fm.N.ml10.kennzahlen[0] === 'E0201806');

// routeToVOR: encodes the VOR-overlap discovery
check('agRV routes to VOR.rv', fm.routeToVOR('agRV') === 'rv');
check('anKV routes to VOR.kv', fm.routeToVOR('anKV') === 'kv');
check('anAV routes to VOR.av', fm.routeToVOR('anAV') === 'av');
check('unknown field routes to null', fm.routeToVOR('doesNotExist') === null);
check('every VOR routing target actually exists in fm.VOR', 
  ['agRV','agRVb','anRV','anRVb','agKV','agPKV','anKV','agPV','anPV','anAV','pkv28']
    .every(f => fm.VOR[fm.routeToVOR(f)] !== undefined));

// amountToPflegegrad: reverse-lookup from the app's stored amount to ERiC's enum code
check('600 EUR -> Pflegegrad 2', fm.amountToPflegegrad('600') === '2');
check('1100 EUR -> Pflegegrad 3', fm.amountToPflegegrad('1100') === '3');
check('1800 EUR -> Pflegegrad 4 (covers 4 or 5, matches ERiC own enum)', fm.amountToPflegegrad('1800') === '4');
check('unknown amount -> null', fm.amountToPflegegrad('9999') === null);
check('empty -> null', fm.amountToPflegegrad('') === null);

console.log(`\n===== eric-fieldmap.js: ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
