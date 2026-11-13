'use strict';

const fs = require('fs');

const { readJsonSafe, writeJsonAtomicSync } = require('../storage/atomic');

const PRIVACY_FILE = 'privacy.json';
const PRIVACY_SCHEMA_VERSION = 1;
const VOICEPRINT_CONSENT_VERSION = 1;

const DEFAULT_PRIVACY_SETTINGS = Object.freeze({
  schemaVersion: PRIVACY_SCHEMA_VERSION,
  retention: Object.freeze({
    trashDays: 30,
    recordingsDays: 0,
  }),
  voiceprint: Object.freeze({
    enabled: false,
    consentVersion: null,
    grantedAt: null,
    revokedAt: null,
    scope: 'local-only',
  }),
  diagnostics: Object.freeze({
    level: 'info',
  }),
});

function clampDays(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(3650, Math.max(0, Math.round(number)));
}

function normalizeLevel(value, fallback = 'info') {
  return ['debug', 'info', 'warn', 'error'].includes(value) ? value : fallback;
}

/**
 * Normalizza impostazioni provenienti dal disco o dal renderer. I valori
 * sconosciuti vengono scartati: il file non è mai una fonte di verità per
 * comportamenti distruttivi.
 */
function normalizePrivacySettings(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const retention = input.retention && typeof input.retention === 'object' ? input.retention : {};
  const voiceprint = input.voiceprint && typeof input.voiceprint === 'object' ? input.voiceprint : {};
  const diagnostics = input.diagnostics && typeof input.diagnostics === 'object' ? input.diagnostics : {};

  const grantedAt = typeof voiceprint.grantedAt === 'string' ? voiceprint.grantedAt : null;
  const revokedAt = typeof voiceprint.revokedAt === 'string' ? voiceprint.revokedAt : null;

  return {
    schemaVersion: PRIVACY_SCHEMA_VERSION,
    retention: {
      trashDays: clampDays(retention.trashDays, DEFAULT_PRIVACY_SETTINGS.retention.trashDays),
      recordingsDays: clampDays(
        retention.recordingsDays,
        DEFAULT_PRIVACY_SETTINGS.retention.recordingsDays,
      ),
    },
    voiceprint: {
      enabled: voiceprint.enabled === true && !revokedAt,
      consentVersion: voiceprint.enabled === true && !revokedAt
        ? (Number(voiceprint.consentVersion) || VOICEPRINT_CONSENT_VERSION)
        : null,
      grantedAt,
      revokedAt,
      scope: 'local-only',
    },
    diagnostics: {
      level: normalizeLevel(diagnostics.level, DEFAULT_PRIVACY_SETTINGS.diagnostics.level),
    },
  };
}

function readPrivacySettings(file) {
  if (!file) return normalizePrivacySettings(DEFAULT_PRIVACY_SETTINGS);
  const result = readJsonSafe(file);
  if (!result.ok) return normalizePrivacySettings(DEFAULT_PRIVACY_SETTINGS);
  return normalizePrivacySettings(result.value);
}

function writePrivacySettings(file, value) {
  const normalized = normalizePrivacySettings(value);
  writeJsonAtomicSync(file, normalized);
  return normalized;
}

/**
 * Consenso esplicito e revocabile per le impronte vocali. La revoca non
 * cancella i voiceprint già archiviati: il chiamante deve farlo, perché il
 * modello è progettato per essere cancellabile per voce e per intero.
 */
function setVoiceprintConsent(value, granted, { at = new Date().toISOString(), version = VOICEPRINT_CONSENT_VERSION } = {}) {
  const current = normalizePrivacySettings(value);
  const timestamp = at;
  if (granted) {
    return normalizePrivacySettings({
      ...current,
      voiceprint: {
        enabled: true,
        consentVersion: version,
        grantedAt: timestamp,
        revokedAt: null,
        scope: 'local-only',
      },
    });
  }
  return normalizePrivacySettings({
    ...current,
    voiceprint: {
      enabled: false,
      consentVersion: current.voiceprint.consentVersion,
      grantedAt: current.voiceprint.grantedAt,
      revokedAt: timestamp,
      scope: 'local-only',
    },
  });
}

function privacyFileExists(file) {
  try {
    return fs.existsSync(file);
  } catch (_) {
    return false;
  }
}

module.exports = {
  DEFAULT_PRIVACY_SETTINGS,
  PRIVACY_FILE,
  PRIVACY_SCHEMA_VERSION,
  VOICEPRINT_CONSENT_VERSION,
  normalizePrivacySettings,
  privacyFileExists,
  readPrivacySettings,
  setVoiceprintConsent,
  writePrivacySettings,
};
