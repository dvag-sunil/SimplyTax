#!/usr/bin/env node
/* =============================================================================
   SimplyTax - repository layout check. Run it from the ROOT of your repo (the folder that contains index.html and backend/):

       node check-repo-layout.js

   For every file the project and its CI workflow need it says:
     OK         the file is there and identical to the version that was delivered
     MISSING    the file is not there: copy it from the outputs folder (the name in "from") to the path shown
     DIFFERENT  the file exists but is not the delivered version (an older copy, or one you changed on purpose)
   Line endings are ignored (Windows vs Mac/Linux). Exit code 1 if anything is MISSING.
   No installation needed. The list below is a snapshot of the delivery it came with.
============================================================================= */
const fs = require('fs'), crypto = require('crypto');
const MANIFEST = [
 {
  "path": "index.html",
  "from": "index.html",
  "check": "hash",
  "sha": "e0244002054c5a7d6d89c2d1aea2f139cabd86ca0b8d70c674505cd464c75249"
 },
 {
  "path": "home.html",
  "from": "home.html",
  "check": "hash",
  "sha": "796d009c211451545afbd3defaa416abbca94b9d826b1bc803c362b0ea035b36"
 },
 {
  "path": "agb.html",
  "from": "agb.html",
  "check": "hash",
  "sha": "2830f85687bbd150d9c693d71689ea88c881e09d29214de912d39486fd04adc3"
 },
 {
  "path": "datenschutz.html",
  "from": "datenschutz.html",
  "check": "hash",
  "sha": "3df213c5733971b49153045d8b925ba59ba50d7598597674ec6ce2704c879059"
 },
 {
  "path": "impressum.html",
  "from": "impressum.html",
  "check": "hash",
  "sha": "5a2d83fa3a7dbec00b6d6b2a71c286b8663513e2562e5da829c9ef933a0f40c3"
 },
 {
  "path": "program-scope.html",
  "from": "program-scope.html",
  "check": "hash",
  "sha": "ea091b3786a81ac1be7710af08e1afbe3b7d205f572dcc23b0aa1208a03824df"
 },
 {
  "path": "elster-zertifikat-guide.html",
  "from": "elster-zertifikat-guide.html",
  "check": "hash",
  "sha": "72939c079e584a6492b389fc4182b7c49d8890b90d5eda9332cd2e374444fd14"
 },
 {
  "path": "steuerwissen.html",
  "from": "steuerwissen.html",
  "check": "hash",
  "sha": "e600fcf0c0364603da103447bbf442c17595192665853287e050843572dee4ab"
 },
 {
  "path": "assets/site.css",
  "from": "site.css",
  "check": "hash",
  "sha": "5b7dd6cd96ad7807fbf8688664b55718429554d5462bc1a19ebc509dc71d47ea"
 },
 {
  "path": ".github/workflows/deploy.yml",
  "from": "deploy.yml",
  "check": "hash",
  "sha": "9a4b2da291465cb610b05ce55870a013738f8988979c3cf2155d729d6ef3a456"
 },
 {
  "path": ".github/workflows/backend-ci.yml",
  "from": "backend-ci.yml",
  "check": "hash",
  "sha": "111b1ad2e3df8c555575582310e7dfe74456887fb91b0e1812333dcb111fe97d"
 },
 {
  "path": "test/test-ui.js",
  "from": "test-ui.js",
  "check": "hash",
  "sha": "b0c7e90d952bbb5c352557838bd94dbc6748b90440c8df38b92a3a9d62e92ee7"
 },
 {
  "path": "test/domstub.js",
  "from": "domstub.js",
  "check": "hash",
  "sha": "c9a3e8d24ce61495aa49b1237bf6313a1ada3ab69e068f6f839d6f375db0dd28"
 },
 {
  "path": "test/apicheck.py",
  "from": "apicheck.py",
  "check": "hash",
  "sha": "4b338c3708e9ef41d4cb5a9015ee20cda7a9a5200ff8c6011ba9f74fc07d56a5"
 },
 {
  "path": "backend/server.js",
  "from": "server.js",
  "check": "hash",
  "sha": "8ecbdf6e00eea47ce60ce356ca72d2928424ddface0cb1da11f35878d8449227"
 },
 {
  "path": "backend/schema.sql",
  "from": "schema.sql",
  "check": "hash",
  "sha": "dd9e269da53b1f218369b803c6992d26315711a4b1bacf2e3201b35927eb2f49"
 },
 {
  "path": "backend/package.json",
  "from": "package.json",
  "check": "hash",
  "sha": "1493f60b07d81e31f92f15684902803fa8c4bcdca5399de2c891861f8d3f3671"
 },
 {
  "path": "backend/render-build.sh",
  "from": "render-build.sh",
  "check": "hash",
  "sha": "c191ddfbd26f2ef887328ade3707a3184d84b4216a41f190755e2497603993a8"
 },
 {
  "path": "backend/package-lock.json",
  "from": null,
  "check": "exists",
  "sha": null
 },
 {
  "path": "backend/tools/check-live-schema.js",
  "from": "check-live-schema.js",
  "check": "hash",
  "sha": "374b301dedd00dea26dec4b4c7bd764e17255ac56c3f238900b54d8811557960"
 },
 {
  "path": "backend/tools/memory-smoke.js",
  "from": "memory-smoke.js",
  "check": "hash",
  "sha": "320c31c084a0ef8dcb97c488373446e805a640f10fb0fb8158513c5560b13fac"
 },
 {
  "path": "backend/eric/xml-builder.js",
  "from": "xml-builder.js",
  "check": "hash",
  "sha": "68bb3938fae3be0c8f3e8b49166d3fbb6b56d6f3d5c33825d06aca4272fe0819"
 },
 {
  "path": "backend/eric/eric-fieldmap.js",
  "from": "eric-fieldmap.js",
  "check": "hash",
  "sha": "b2bd5684d7f1e746d6ea3ea3815e1f81d9c70ad025b66af2d2c2de9a29e99290"
 },
 {
  "path": "backend/eric/eric-service.js",
  "from": "eric-service.js",
  "check": "hash",
  "sha": "a4e240eb24389ebd1c134ba1bf38aa7a26dae8b34a9abfbfda01e93222353ea1"
 },
 {
  "path": "backend/eric/afa-rate.js",
  "from": "afa-rate.js",
  "check": "hash",
  "sha": "bbac48f5ec9d776c087690549c00ddd217ad3387bd735ce9a45be5d44f5ba359"
 },
 {
  "path": "backend/eric/test-xml-builder.js",
  "from": "test-xml-builder.js",
  "check": "hash",
  "sha": "57465f873c1a992d9b5aabed7b76b303d79a3de4515b281f9d73f39cf81dd695"
 },
 {
  "path": "backend/eric/test-fieldmap.js",
  "from": "test-fieldmap.js",
  "check": "hash",
  "sha": "74711aedc554cd3e8b552b17d474b259b68f3e91c9e3ee8ff25f3a31b7baa3ef"
 },
 {
  "path": "backend/eric/eric-worker.js",
  "from": "eric-worker.js",
  "check": "exists",
  "sha": null
 },
 {
  "path": "backend/eric/certificate-store.js",
  "from": "certificate-store.js",
  "check": "exists",
  "sha": null
 },
 {
  "path": "backend/test/harness.js",
  "from": "harness.js",
  "check": "hash",
  "sha": "b6e315f17dcfac64beea2c63d7612024ef581cdf2224cf53dd203875f2dd281b"
 },
 {
  "path": "backend/test/testdb.js",
  "from": "testdb.js",
  "check": "hash",
  "sha": "579727aeec3ed8dd09595def07c65698e684b0e0ec77c6df4b85b2afad38c9a9"
 },
 {
  "path": "backend/test/pglite-pool.js",
  "from": "pglite-pool.js",
  "check": "hash",
  "sha": "e0c4a77824481a107c0230c5744b6f313c52d6576cc317e4aaebc3d93c8ec32a"
 },
 {
  "path": "backend/test/run-all.js",
  "from": "run-all.js",
  "check": "hash",
  "sha": "6a40f556a0b16436e9ef5b56a9e75634e22ba19df07d576967260d8e2a0c8d0d"
 },
 {
  "path": "backend/test/test-api.js",
  "from": "test-api.js",
  "check": "hash",
  "sha": "fd880d317940deaf2b9f6ba121b32fa741e852eaa0990a0448b5eb228f26d113"
 },
 {
  "path": "backend/test/test-payments.js",
  "from": "test-payments.js",
  "check": "hash",
  "sha": "045273b172d70734242771a968bb9d15038204bf80ccb46b1c4388e66be8cd87"
 },
 {
  "path": "backend/test/test-extract.js",
  "from": "test-extract.js",
  "check": "hash",
  "sha": "2b7d39c2d4ee6c2ef3e5cfd2b87487a8ca03c127cb23203fe2c4b485d72c917e"
 },
 {
  "path": "backend/test/test-eric-routes.js",
  "from": "test-eric-routes.js",
  "check": "hash",
  "sha": "421489060de098f155d24fb0f67361efb2f6ac0908a2e041d6d21f5c808239b1"
 },
 {
  "path": "backend/test/test-submit-recovery.js",
  "from": "test-submit-recovery.js",
  "check": "hash",
  "sha": "61e04a09fb81888ccb09c91e2d333c0cb0200fdf8194fd3d540e40b471757109"
 },
 {
  "path": "backend/test/test-sessions.js",
  "from": "test-sessions.js",
  "check": "hash",
  "sha": "281dfef60cd51cc7d01861edf3c8bc8a6b720f94d6260aa70f3bc0c3fbdee812"
 },
 {
  "path": "backend/test/test-session-abuse.js",
  "from": "test-session-abuse.js",
  "check": "hash",
  "sha": "13eb9a8b566ba93fd48d93d2fb90885384298196d4b42f0904c4ef25d43e2762"
 },
 {
  "path": "backend/test/test-hardening.js",
  "from": "test-hardening.js",
  "check": "hash",
  "sha": "2a2d031f1cbf1dccfdc6228f30da33a1718ad37a93a970bdad06768197f32f69"
 },
 {
  "path": "backend/test/test-account-deletion.js",
  "from": "test-account-deletion.js",
  "check": "hash",
  "sha": "3f6e4866db5f0e96e208c454df5d9a40c5f38901d8dfed7b04ba1fe1d031f9df"
 },
 {
  "path": "backend/test/test-security-state.js",
  "from": "test-security-state.js",
  "check": "hash",
  "sha": "b0023d52952438bae0793e146817ee01e8f5bf4b956ea31a1013f4582957fb12"
 },
 {
  "path": "backend/test/test-lifecycle.js",
  "from": "test-lifecycle.js",
  "check": "hash",
  "sha": "f3f5a3abe04dfbea91642242d54e1afff618686690811e65d89552b3057244f8"
 },
 {
  "path": "backend/test/test-security.js",
  "from": "test-security.js",
  "check": "hash",
  "sha": "218e6f807cc475e4e5d2420c709f025b0c8e60f4ff06d926b7f9743207772cdb"
 },
 {
  "path": "backend/test/test-schema.js",
  "from": "test-schema.js",
  "check": "hash",
  "sha": "c370370e821156645c699389166ffe47df25b8bb2fb65fe73dbe16d06c77b94a"
 },
 {
  "path": "backend/test/fixtures/schema.v1.sql",
  "from": "schema.v1.sql",
  "check": "hash",
  "sha": "e2e55c1974183345fbfb53a9263ce3675cba0894bdfc21e09340666c63daf0eb"
 }
];
const sha = (p) => crypto.createHash('sha256').update(Buffer.from(fs.readFileSync(p)).toString('latin1').replace(/\r\n/g, '\n'), 'latin1').digest('hex');
if (!fs.existsSync('index.html') || !fs.existsSync('backend')) { console.error('Run this from the ROOT of your repo (the folder containing index.html and backend/).'); process.exit(2); }
let missing = 0, different = 0, ok = 0;
for (const m of MANIFEST) {
  if (!fs.existsSync(m.path)) { missing++; console.log(`MISSING    ${m.path}${m.from ? `      <- copy "${m.from}" from the outputs folder` : '      <- created by "npm install" in backend/'}`); continue; }
  if (m.check === 'exists') { ok++; continue; }
  if (sha(m.path) === m.sha) { ok++; continue; }
  different++; console.log(`DIFFERENT  ${m.path}      (delivered file: "${m.from}")`);
}
console.log(`\n${ok} files OK, ${missing} MISSING, ${different} different from the delivered version.`);
if (missing) console.log('Add the MISSING files first: CI fails when a file it runs does not exist.');
if (different) console.log('DIFFERENT is not always wrong (you may have edited the file on purpose), but an OLD copy of a delivered file is a common cause of CI failures.');
process.exit(missing ? 1 : 0);
