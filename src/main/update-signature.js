'use strict';

// ─── Firma crittografica degli aggiornamenti ──────────────────────────────
// Le build non firmate con Developer ID non possono usare Squirrel.Mac.
// Per il fallback interno la release pubblica, accanto allo ZIP, un file
// `<zip>.sig` con la firma Ed25519 del digest SHA-512. La chiave pubblica è
// incorporata nell'app: una release manomessa o non firmata viene rifiutata.

const crypto = require('crypto');
const { UPDATE_PUBLIC_KEY_BASE64 } = require('./update-public-key');

const SIGNATURE_MESSAGE_PREFIX = 'sha512:';

function signatureMessage(digestBase64) {
  if (typeof digestBase64 !== 'string' || digestBase64.length === 0) {
    throw new Error('Digest SHA-512 mancante');
  }
  return `${SIGNATURE_MESSAGE_PREFIX}${digestBase64}`;
}

function publicKeyFromBase64(publicKeyBase64) {
  return crypto.createPublicKey({
    key: Buffer.from(publicKeyBase64, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

function verifyDigestSignature(digestBase64, signatureBase64, publicKeyBase64 = UPDATE_PUBLIC_KEY_BASE64) {
  if (typeof signatureBase64 !== 'string' || signatureBase64.trim() === '') return false;
  try {
    const signature = Buffer.from(signatureBase64.trim(), 'base64');
    if (signature.length !== 64) return false;
    const key = publicKeyFromBase64(publicKeyBase64);
    return crypto.verify(
      null,
      Buffer.from(signatureMessage(digestBase64), 'utf8'),
      key,
      signature,
    );
  } catch (_) {
    return false;
  }
}

module.exports = {
  SIGNATURE_MESSAGE_PREFIX,
  signatureMessage,
  verifyDigestSignature,
};
