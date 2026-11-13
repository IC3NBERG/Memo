'use strict';

const crypto = require('crypto');

const SCRYPT_PARAMS = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  keylen: 32,
});

const MIN_PASSCODE_LENGTH = 4;
const MAX_PASSCODE_LENGTH = 128;

function validatePasscode(passcode) {
  if (typeof passcode !== 'string') {
    return { ok: false, error: 'Il codice deve essere una stringa.' };
  }
  if (passcode.length < MIN_PASSCODE_LENGTH) {
    return { ok: false, error: `Il codice deve avere almeno ${MIN_PASSCODE_LENGTH} caratteri.` };
  }
  if (passcode.length > MAX_PASSCODE_LENGTH) {
    return { ok: false, error: `Il codice non può superare ${MAX_PASSCODE_LENGTH} caratteri.` };
  }
  return { ok: true };
}

function hashPasscode(passcode, {
  salt = crypto.randomBytes(16),
  params = SCRYPT_PARAMS,
} = {}) {
  const validation = validatePasscode(passcode);
  if (!validation.ok) throw new Error(validation.error);

  const normalized = passcode.normalize('NFKC');
  const hash = crypto.scryptSync(normalized, salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 128 * 1024 * 1024,
  });

  return {
    algorithm: 'scrypt',
    params: { ...params },
    salt: Buffer.from(salt).toString('hex'),
    hash: hash.toString('hex'),
  };
}

function verifyPasscode(passcode, record) {
  if (!record || record.algorithm !== 'scrypt' || !record.salt || !record.hash) {
    return false;
  }
  if (typeof passcode !== 'string' || passcode.length === 0) return false;

  let expected;
  try {
    expected = Buffer.from(record.hash, 'hex');
  } catch (_) {
    return false;
  }

  const params = { ...SCRYPT_PARAMS, ...(record.params || {}) };
  let actual;
  try {
    actual = crypto.scryptSync(passcode.normalize('NFKC'), Buffer.from(record.salt, 'hex'), expected.length, {
      N: Number(params.N) || SCRYPT_PARAMS.N,
      r: Number(params.r) || SCRYPT_PARAMS.r,
      p: Number(params.p) || SCRYPT_PARAMS.p,
      maxmem: 128 * 1024 * 1024,
    });
  } catch (_) {
    return false;
  }

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  MAX_PASSCODE_LENGTH,
  MIN_PASSCODE_LENGTH,
  SCRYPT_PARAMS,
  hashPasscode,
  validatePasscode,
  verifyPasscode,
};
