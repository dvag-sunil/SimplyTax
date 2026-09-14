/* certificate-store.js
   ─────────────────────────────────────────────────────────────────
   NEW, SEPARATE FEATURE — customer-provided ELSTER certificate storage.

   This module is intentionally self-contained and additive:
   - It creates its own table (self-installing, same CREATE TABLE IF NOT
     EXISTS convention already used elsewhere in this backend).
   - It registers its own routes under /api/certificate/*.
   - It does NOT modify, import from, or alter behaviour of the existing
     ERiC submission flow (eric-service.js) in any way. Wiring a stored
     certificate into an actual transmission is a deliberate, separate,
     later step — not part of this module.

   Mounting (the only line this needs in server.js):
     require('./eric/certificate-store')(app, pool, auth);

   Requires the 'node-forge' package (not currently in this snapshot's
   dependencies as far as I can tell - needs `npm install node-forge`
   before this will run). Flagging clearly rather than assuming it's
   already there.

   New required env var: CERT_ENCRYPTION_KEY — a 32-byte key (64 hex
   chars) used for AES-256-GCM encryption of the stored .pfx at rest.
   Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   Set as sync:false in render.yaml alongside the other secrets, same
   as JWT_SECRET/DATABASE_URL.

   Deliberate design choice: the certificate's own password/PIN is
   NEVER stored anywhere, at any point, even encrypted. It's used only
   in-memory, once, at upload time, to confirm the file and password
   actually work together — then discarded. Every real submission will
   need the password re-entered fresh. This matches the pattern
   confirmed across every competitor researched (WISO Steuer, etc.):
   store the file once, ask for the password every time after. */

const crypto = require('crypto');
const forge = require('node-forge');

const ENC_ALGO = 'aes-256-gcm';

function getEncryptionKey() {
  const hex = process.env.CERT_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('CERT_ENCRYPTION_KEY missing or not 64 hex chars (32 bytes) - see certificate-store.js header comment');
  }
  return Buffer.from(hex, 'hex');
}

function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encrypted: encrypted.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64') };
}

function decryptBuffer(encB64, ivB64, authTagB64) {
  const decipher = crypto.createDecipheriv(ENC_ALGO, getEncryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]);
}

/* Parses the .pfx with the given password. Throws if the password is
   wrong or the file isn't a valid PKCS12 container. On success,
   returns a small, safe-to-store summary (subject name, expiry date) -
   never the private key material itself beyond this one in-memory
   parse used only to extract display/warning info. */
function parseAndValidatePfx(pfxBuffer, password) {
  const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password); // throws on wrong password
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = (bags[forge.pki.oids.certBag] || [])[0];
  if (!certBag || !certBag.cert) throw new Error('no_certificate_in_file');
  const cert = certBag.cert;
  const cn = (cert.subject.getField('CN') || {}).value || null;
  return { subjectCN: cn, validUntil: cert.validity.notAfter };
}

module.exports = function mountCertificateStore(app, pool, auth) {
  pool.query(`CREATE TABLE IF NOT EXISTS user_certificates (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pfx_encrypted TEXT NOT NULL,
    pfx_iv TEXT NOT NULL,
    pfx_auth_tag TEXT NOT NULL,
    original_filename TEXT,
    subject_cn TEXT,
    valid_until TIMESTAMPTZ,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id)
  )`).catch(e => console.error('[certificate-store] table init failed:', e.message));

  /* Upload (or replace) the certificate for the logged-in user.
     Body: { pfxBase64, password, filename }
     The password is used here ONCE, in-memory, to verify the pair
     works and to extract display info - then never touches disk. */
  app.post('/api/certificate/upload', auth, async (req, res) => {
    const { pfxBase64, password, filename } = req.body || {};
    if (!pfxBase64 || !password) return res.status(400).json({ error: 'missing_fields' });
    let pfxBuffer;
    try { pfxBuffer = Buffer.from(pfxBase64, 'base64'); }
    catch { return res.status(400).json({ error: 'invalid_file_encoding' }); }
    if (pfxBuffer.length > 20 * 1024) return res.status(400).json({ error: 'file_too_large' }); // real .pfx files are a few KB

    let parsed;
    try { parsed = parseAndValidatePfx(pfxBuffer, password); }
    catch { return res.status(400).json({ error: 'invalid_certificate_or_password' }); }

    let encrypted, iv, authTag;
    try {
      ({ encrypted, iv, authTag } = encryptBuffer(pfxBuffer));
    } catch (e) {
      /* Real bug found from a live 500 in production: this was
         previously unguarded, so a missing/malformed CERT_ENCRYPTION_KEY
         crashed here uncaught - even though the certificate and
         password were already confirmed valid one line above. Logged
         specifically so this is immediately diagnosable in Render's
         logs, without ever exposing key/encryption detail to the
         client response itself. */
      console.error('[certificate-store] encryption failed - check CERT_ENCRYPTION_KEY is set and is exactly 64 hex characters:', e.message);
      return res.status(500).json({ error: 'server_encryption_not_configured' });
    }
    try {
      await pool.query(
        `INSERT INTO user_certificates (user_id, pfx_encrypted, pfx_iv, pfx_auth_tag, original_filename, subject_cn, valid_until, uploaded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (user_id) DO UPDATE SET
           pfx_encrypted=$2, pfx_iv=$3, pfx_auth_tag=$4, original_filename=$5, subject_cn=$6, valid_until=$7, uploaded_at=now()`,
        [req.user.sub, encrypted, iv, authTag, filename || null, parsed.subjectCN, parsed.validUntil]
      );
    } catch (e) {
      console.error('[certificate-store] upload save failed:', e.message);
      return res.status(500).json({ error: 'save_failed' });
    }
    res.json({ ok: true, subjectCN: parsed.subjectCN, validUntil: parsed.validUntil });
  });

  /* Status - never returns the file itself, only metadata for display
     (e.g. "certificate on file for Max Mustermann, valid until ...").
     This is what the pre-payment screen and Settings page both read. */
  app.get('/api/certificate/status', auth, async (req, res) => {
    const { rows } = await pool.query(
      'SELECT original_filename, subject_cn, valid_until, uploaded_at FROM user_certificates WHERE user_id=$1',
      [req.user.sub]
    );
    if (!rows.length) return res.json({ hasCertificate: false });
    const c = rows[0];
    const daysUntilExpiry = c.valid_until ? Math.floor((new Date(c.valid_until) - new Date()) / 86400000) : null;
    res.json({
      hasCertificate: true,
      filename: c.original_filename,
      subjectCN: c.subject_cn,
      validUntil: c.valid_until,
      uploadedAt: c.uploaded_at,
      expiringSoon: daysUntilExpiry !== null && daysUntilExpiry <= 30,
      daysUntilExpiry
    });
  });

  app.delete('/api/certificate', auth, async (req, res) => {
    await pool.query('DELETE FROM user_certificates WHERE user_id=$1', [req.user.sub]);
    res.json({ ok: true });
  });

  console.log('[certificate-store] mounted /api/certificate/* routes (separate, additive module)');
};

/* Separate, explicit export used only at actual submission time (called
   from server.js's /api/eric/submit route, not from anywhere inside this
   module's own routes above). Given a userId and the password the
   customer just typed in, fetches their stored encrypted certificate,
   decrypts it, and confirms the password actually opens it - throwing
   a clear, specific error otherwise so the caller can show the right
   message rather than a generic failure.
   Returns the decrypted .pfx as a Buffer. Never logs or persists the
   password anywhere - it only ever exists in memory for the duration
   of this one call. */
async function getDecryptedCertificate(pool, userId, password) {
  const { rows } = await pool.query(
    'SELECT pfx_encrypted, pfx_iv, pfx_auth_tag FROM user_certificates WHERE user_id=$1', [userId]
  );
  if (!rows.length) { const e = new Error('no_certificate_on_file'); e.code = 'no_certificate_on_file'; throw e; }
  const pfxBuffer = decryptBuffer(rows[0].pfx_encrypted, rows[0].pfx_iv, rows[0].pfx_auth_tag);
  try { parseAndValidatePfx(pfxBuffer, password); } // throws if the password is wrong - fail before ever touching disk
  catch { const e = new Error('wrong_certificate_password'); e.code = 'wrong_certificate_password'; throw e; }
  return pfxBuffer;
}

module.exports.getDecryptedCertificate = getDecryptedCertificate;
