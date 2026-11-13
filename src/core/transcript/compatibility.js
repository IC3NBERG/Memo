'use strict';

const { SCHEMA_VERSIONS } = require('./constants');

/**
 * Politica di compatibilità dei documenti dell'archivio.
 *
 * - versioni precedenti (1) vengono migrate in modo lazy quando il formato è
 *   supportato;
 * - versione corrente: lettura e scrittura;
 * - versioni future: nessuna scrittura e nessun downgrade. Se la struttura
 *   minima resta leggibile, la registrazione viene aperta in sola lettura; se
 *   anche i campi noti non sono validi, l'apertura viene rifiutata senza
 *   modificare alcun file.
 */

const SUPPORTED_VERSIONS = Object.freeze({
  metadata: Object.freeze({ min: 1, max: SCHEMA_VERSIONS.metadata }),
  transcript: Object.freeze({ min: 1, max: SCHEMA_VERSIONS.transcript }),
  edits: Object.freeze({ min: 1, max: SCHEMA_VERSIONS.edits }),
  manifest: Object.freeze({ min: 1, max: SCHEMA_VERSIONS.manifest }),
});

const DOCUMENT_LABELS = Object.freeze({
  metadata: 'metadata.json',
  transcript: 'transcript.json',
  edits: 'edits.json',
  manifest: 'manifest.json',
});

function normalizeVersion(value, fallback = 1) {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : fallback;
}

function documentVersion(document, kind) {
  if (document && typeof document === 'object' && !Array.isArray(document)) {
    return normalizeVersion(document.schemaVersion, 1);
  }
  return 1;
}

/**
 * Restituisce la politica applicabile a un documento senza toccare il file.
 * `readable` indica solo che il formato è noto; la validazione dei campi noti
 * resta a carico di validate.js.
 */
function describeCompatibility(kind, version) {
  const supported = SUPPORTED_VERSIONS[kind];
  const current = SCHEMA_VERSIONS[kind];
  const label = DOCUMENT_LABELS[kind] || kind;
  const value = normalizeVersion(version);

  if (!supported) {
    return {
      kind,
      version: value,
      supported: false,
      readable: false,
      writable: false,
      action: 'reject',
      currentVersion: null,
      message: `Tipo di documento sconosciuto: ${kind}`,
    };
  }

  if (value > supported.max) {
    return {
      kind,
      version: value,
      supported: false,
      readable: true,
      writable: false,
      action: 'read-only-future',
      currentVersion: current,
      supportedMin: supported.min,
      supportedMax: supported.max,
      message: `${label} ha schemaVersion ${value}, più nuova di quella supportata (${current}). `
        + 'La registrazione può essere aperta solo in sola lettura: nessuna migrazione, '
        + 'nessun downgrade e nessuna scrittura verranno eseguiti.',
    };
  }

  if (value === current) {
    return {
      kind,
      version: value,
      supported: true,
      readable: true,
      writable: true,
      action: 'open',
      currentVersion: current,
      supportedMin: supported.min,
      supportedMax: supported.max,
      message: `${label} v${value} è supportato.`,
    };
  }

  if (value >= supported.min) {
    return {
      kind,
      version: value,
      supported: true,
      readable: true,
      writable: false,
      action: 'migrate',
      currentVersion: current,
      supportedMin: supported.min,
      supportedMax: supported.max,
      message: `${label} v${value} viene migrato a v${current} in modo atomico con backup.`,
    };
  }

  return {
    kind,
    version: value,
    supported: false,
    readable: false,
    writable: false,
    action: 'reject',
    currentVersion: current,
    supportedMin: supported.min,
    supportedMax: supported.max,
    message: `${label} ha schemaVersion ${value}, precedente al minimo supportato (${supported.min}).`,
  };
}

function isFutureVersion(kind, version) {
  const supported = SUPPORTED_VERSIONS[kind];
  if (!supported) return false;
  return normalizeVersion(version) > supported.max;
}

module.exports = {
  DOCUMENT_LABELS,
  SUPPORTED_VERSIONS,
  describeCompatibility,
  documentVersion,
  isFutureVersion,
  normalizeVersion,
};
