'use strict';

const fs = require('fs');
const path = require('path');

const { hashPasscode, validatePasscode, verifyPasscode } = require('../core/privacy/passcode');
const { readJsonSafe, writeJsonAtomicSync } = require('../core/storage/atomic');

const LOCK_SCHEMA_VERSION = 1;
const DEFAULT_AUTO_LOCK_MINUTES = 5;
const MAX_FAILED_ATTEMPTS = 5;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const BLOCK_MS = 30 * 1000;

function normalizeMinutes(value, fallback = DEFAULT_AUTO_LOCK_MINUTES) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return fallback;
  return Math.min(120, Math.max(1, Math.round(minutes)));
}

/**
 * Blocco applicativo per macchine condivise. Il codice non viene mai salvato
 * in chiaro: solo un hash scrypt con salt casuale. Il file vive nella cartella
 * utente dell'app, fuori dall'archivio esportabile.
 */
function createLockService({
  file,
  logger = null,
  clock = () => Date.now(),
} = {}) {
  let failures = [];
  let blockedUntil = 0;

  function read() {
    const result = readJsonSafe(file);
    if (!result.ok || !result.value || typeof result.value !== 'object') {
      return { enabled: false, autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES, lockOnBlur: false };
    }
    const value = result.value;
    return {
      enabled: value.enabled === true && !!value.hash && !!value.salt,
      autoLockMinutes: normalizeMinutes(value.autoLockMinutes),
      lockOnBlur: value.lockOnBlur === true,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
      algorithm: value.algorithm,
      params: value.params,
      salt: value.salt,
      hash: value.hash,
    };
  }

  function status() {
    const current = read();
    return {
      enabled: current.enabled,
      autoLockMinutes: current.autoLockMinutes,
      lockOnBlur: current.lockOnBlur,
      updatedAt: current.updatedAt || null,
    };
  }

  function persist(next) {
    writeJsonAtomicSync(file, {
      schemaVersion: LOCK_SCHEMA_VERSION,
      ...next,
      updatedAt: new Date(clock()).toISOString(),
    });
  }

  function throttleState() {
    const now = clock();
    failures = failures.filter((time) => now - time < FAILURE_WINDOW_MS);
    if (blockedUntil > now) {
      return { blocked: true, retryAfterMs: blockedUntil - now };
    }
    return { blocked: false, retryAfterMs: 0 };
  }

  function verify({ passcode } = {}) {
    const current = read();
    if (!current.enabled) return { success: true, enabled: false };

    const throttle = throttleState();
    if (throttle.blocked) {
      return {
        success: false,
        error: 'Troppi tentativi. Riprova tra poco.',
        retryAfterMs: throttle.retryAfterMs,
      };
    }

    if (verifyPasscode(passcode, current)) {
      failures = [];
      blockedUntil = 0;
      return { success: true, enabled: true };
    }

    failures.push(clock());
    if (failures.length >= MAX_FAILED_ATTEMPTS) {
      blockedUntil = clock() + BLOCK_MS;
      failures = [];
      logger?.warn('lock.blocked', { attempts: MAX_FAILED_ATTEMPTS });
      return {
        success: false,
        error: 'Troppi tentativi. Bloccato per 30 secondi.',
        retryAfterMs: BLOCK_MS,
      };
    }

    logger?.warn('lock.verify-failed', { attempts: failures.length });
    return { success: false, error: 'Codice non corretto.' };
  }

  function setPasscode({ passcode, currentPasscode } = {}) {
    const validation = validatePasscode(passcode);
    if (!validation.ok) return { success: false, error: validation.error };

    const current = read();
    if (current.enabled) {
      const check = verify({ passcode: currentPasscode });
      if (!check.success) return { success: false, error: 'Codice attuale non corretto.' };
    }

    try {
      const record = hashPasscode(passcode);
      persist({
        enabled: true,
        ...record,
        autoLockMinutes: current.autoLockMinutes,
        lockOnBlur: current.lockOnBlur,
      });
      logger?.info('lock.enabled', { autoLockMinutes: current.autoLockMinutes });
      return { success: true, ...status() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function disable({ passcode } = {}) {
    const current = read();
    if (!current.enabled) return { success: true, enabled: false };

    const check = verify({ passcode });
    if (!check.success) return { success: false, error: check.error || 'Codice non corretto.' };

    try {
      fs.rmSync(file, { force: true });
    } catch (err) {
      return { success: false, error: err.message };
    }
    failures = [];
    blockedUntil = 0;
    logger?.info('lock.disabled');
    return { success: true, enabled: false };
  }

  function updateOptions({ autoLockMinutes, lockOnBlur } = {}) {
    const current = read();
    const nextMinutes = autoLockMinutes === undefined
      ? current.autoLockMinutes
      : normalizeMinutes(autoLockMinutes);
    const nextBlur = lockOnBlur === undefined ? current.lockOnBlur : lockOnBlur === true;

    try {
      if (!current.enabled) {
        // Conserva le preferenze anche prima di impostare un codice.
        writeJsonAtomicSync(file, {
          schemaVersion: LOCK_SCHEMA_VERSION,
          enabled: false,
          autoLockMinutes: nextMinutes,
          lockOnBlur: nextBlur,
          updatedAt: new Date(clock()).toISOString(),
        });
      } else {
        persist({
          enabled: true,
          algorithm: current.algorithm,
          params: current.params,
          salt: current.salt,
          hash: current.hash,
          autoLockMinutes: nextMinutes,
          lockOnBlur: nextBlur,
        });
      }
      return { success: true, ...status() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function resetForTests() {
    failures = [];
    blockedUntil = 0;
  }

  return {
    disable,
    file,
    read,
    resetForTests,
    setPasscode,
    status,
    updateOptions,
    verify,
  };
}

module.exports = {
  DEFAULT_AUTO_LOCK_MINUTES,
  LOCK_SCHEMA_VERSION,
  MAX_FAILED_ATTEMPTS,
  createLockService,
  normalizeMinutes,
};
