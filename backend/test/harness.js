/* =============================================================================
   Test harness - loads the REAL server.js (not a copy, not reimplemented
   logic) with two things swapped at the module-resolution level:
     1. 'pg'            -> pg-mem's compatible Pool (real SQL, see testdb.js)
     2. './eric/eric-service' -> a controllable mock (see below)
   Everything else in server.js runs completely unmodified - the actual
   Express routes, the actual auth logic, the actual SQL queries.
============================================================================= */
const path = require('path');
const Module = require('module');
const { createTestPool } = require('./testdb');

/* ---------- mock ERiC service - controllable per-test ---------- */
const ericMock = {
  _ready: true,
  _initError: null,
  _validateResult: { rc: 0, resultXml: '<ok/>' },
  _submitResult: { rc: 0, sent: true, resultXml: '<ok/>', serverXml: '<Transferticket>TEST-123</Transferticket>' },
  _validateFieldsResult: {},
  isReady: () => ericMock._ready,
  getInitError: () => ericMock._initError,
  validate: async () => ericMock._validateResult,
  submit: async () => ericMock._submitResult,
  validateFields: async () => ericMock._validateFieldsResult,
};

/* ---------- module interception ---------- */
const testPool = createTestPool();
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'pg') {
    return { Pool: function () { return testPool; } };
  }
  if (request === './eric/eric-service' || request.endsWith('/eric/eric-service')) {
    return ericMock;
  }
  return originalLoad.apply(this, arguments);
};

/* ---------- environment the real server.js requires at load time ---------- */
process.env.DATABASE_URL = 'postgres://test:test@localhost/test'; // never actually connected to - pg is intercepted above
process.env.JWT_SECRET = 'test-secret-not-for-production';
process.env.ALLOWED_ORIGIN = 'https://dvag-sunil.github.io';
process.env.PORT = '0';
/* The server now refuses to start without FRONTEND_URL, and the certificate module needs CERT_ENCRYPTION_KEY. Test-only
   defaults (never real secrets) so `node test/test-api.js` works locally with no setup; CI/real env values still win. */
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://dvag-sunil.github.io/';
process.env.CERT_ENCRYPTION_KEY = process.env.CERT_ENCRYPTION_KEY || '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
if (!process.env.ERIC_HERSTELLER_ID) process.env.ERIC_HERSTELLER_ID = 'TEST-ONLY-ID'; // xml-builder.js now genuinely refuses to run without a real configured value - test-only, never a production fallback

delete require.cache[require.resolve('../server.js')];
const app = require('../server.js');

Module._load = originalLoad; // restore normal resolution for anything loaded after this point

module.exports = { app, testPool, ericMock };
