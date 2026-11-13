'use strict';

const {
  SCHEMA_VERSIONS,
  TRANSCRIPT_KINDS,
  TRANSCRIPT_TIMINGS,
} = require('./constants');
const { REVISION_PATTERN } = require('./ids');

const SEGMENT_PATTERN = /^r[1-9][0-9]*-s[0-9]{4,}$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string';
}

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

function validateRevisionEntry(entry, index, errors) {
  const prefix = `revisions[${index}]`;
  if (!isObject(entry)) {
    errors.push(`${prefix} non è un oggetto`);
    return;
  }
  if (!isString(entry.revisionId) || !REVISION_PATTERN.test(entry.revisionId)) {
    errors.push(`${prefix}.revisionId non valido`);
  }
  if (!TRANSCRIPT_KINDS.includes(entry.kind)) {
    errors.push(`${prefix}.kind non valido`);
  }
  if (!isString(entry.createdAt)) {
    errors.push(`${prefix}.createdAt mancante`);
  }
  if (!isBoolean(entry.complete)) errors.push(`${prefix}.complete non booleano`);
  if (!isBoolean(entry.translated)) errors.push(`${prefix}.translated non booleano`);
  if (!isNullableString(entry.model)) errors.push(`${prefix}.model non valido`);
  if (!isNullableString(entry.language)) errors.push(`${prefix}.language non valido`);
  if (!isNullableString(entry.targetLanguage)) errors.push(`${prefix}.targetLanguage non valido`);
  if (!TRANSCRIPT_TIMINGS.includes(entry.timing)) errors.push(`${prefix}.timing non valido`);
}

/**
 * Validazione del metadata v2 (o della sola struttura nota di una versione
 * futura). `ignoreSchemaVersion` serve alla modalità futuro in sola lettura.
 */
function validateMetadata(metadata, { ignoreSchemaVersion = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(metadata)) {
    return { ok: false, errors: ['metadata non è un oggetto'], warnings };
  }

  if (!ignoreSchemaVersion && metadata.schemaVersion !== SCHEMA_VERSIONS.metadata) {
    errors.push(`schemaVersion deve essere ${SCHEMA_VERSIONS.metadata}`);
  }
  if (!isString(metadata.id) || metadata.id.length === 0) errors.push('id mancante');
  if (!isString(metadata.createdAt)) errors.push('createdAt mancante');
  if (!isString(metadata.updatedAt)) errors.push('updatedAt mancante');
  if (!isString(metadata.name)) errors.push('name mancante');
  if (metadata.date !== undefined && metadata.date !== null && !isString(metadata.date)) {
    errors.push('date non valida');
  }
  if (metadata.folder !== undefined && metadata.folder !== null && !isString(metadata.folder)) {
    errors.push('folder non valido');
  }
  if (!isFiniteNumber(metadata.duration) || metadata.duration < 0) {
    errors.push('duration non valida');
  }
  if (!isBoolean(metadata.hasTranscript)) errors.push('hasTranscript non booleano');
  if (!isBoolean(metadata.isCompleteTranscript)) errors.push('isCompleteTranscript non booleano');
  if (!isBoolean(metadata.isLivePreview)) errors.push('isLivePreview non booleano');
  if (!isBoolean(metadata.isTranslated)) errors.push('isTranslated non booleano');
  if (!isNullableString(metadata.activeRevisionId)) errors.push('activeRevisionId non valido');
  if (!Array.isArray(metadata.revisions)) {
    errors.push('revisions non è un array');
  } else {
    metadata.revisions.forEach((entry, index) => validateRevisionEntry(entry, index, errors));
    if (metadata.activeRevisionId) {
      const known = metadata.revisions
        .some((entry) => isObject(entry) && entry.revisionId === metadata.activeRevisionId);
      if (!known) {
        warnings.push('activeRevisionId non è elencato in revisions');
      }
    }
  }
  if (!isNullableString(metadata.previewReplacedAt)) {
    errors.push('previewReplacedAt non valido');
  }
  if (metadata.migrationWarnings !== undefined && !Array.isArray(metadata.migrationWarnings)) {
    warnings.push('migrationWarnings non è un array');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Validazione rigorosa del transcript canonico. I casi recuperabili (ID
 * duplicati, timestamp invertiti, campi opzionali mancanti) vengono gestiti da
 * repair.js: qui segnaliamo tutto ciò che rende il documento non conforme.
 */
function validateTranscript(transcript, {
  ignoreSchemaVersion = false,
  expectedRevisionId = null,
} = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(transcript)) {
    return { ok: false, errors: ['transcript non è un oggetto'], warnings };
  }

  if (!ignoreSchemaVersion && transcript.schemaVersion !== SCHEMA_VERSIONS.transcript) {
    errors.push(`schemaVersion deve essere ${SCHEMA_VERSIONS.transcript}`);
  }
  if (!isString(transcript.revisionId) || !REVISION_PATTERN.test(transcript.revisionId)) {
    errors.push('revisionId non valido');
  } else if (expectedRevisionId && transcript.revisionId !== expectedRevisionId) {
    errors.push(`revisionId ${transcript.revisionId} non corrisponde a ${expectedRevisionId}`);
  }
  if (!TRANSCRIPT_KINDS.includes(transcript.kind)) {
    errors.push('kind non valido');
  }
  if (!isObject(transcript.source)) {
    errors.push('source mancante');
  } else {
    if (!isNullableString(transcript.source.engine)) errors.push('source.engine non valido');
    if (!isNullableString(transcript.source.model)) errors.push('source.model non valido');
    if (!isNullableString(transcript.source.language)) errors.push('source.language non valido');
    if (!isNullableString(transcript.source.targetLanguage)) errors.push('source.targetLanguage non valido');
    if (!isBoolean(transcript.source.complete)) errors.push('source.complete non booleano');
    if (!isBoolean(transcript.source.translated)) errors.push('source.translated non booleano');
    if (!TRANSCRIPT_TIMINGS.includes(transcript.source.timing)) errors.push('source.timing non valido');
    if (transcript.source.format !== undefined && !isNullableString(transcript.source.format)) {
      errors.push('source.format non valido');
    }
    if (transcript.kind === 'livePreview' && transcript.source.timing !== 'whole-recording') {
      warnings.push('livePreview con timing diverso da whole-recording');
    }
  }
  if (!Array.isArray(transcript.segments)) {
    errors.push('segments non è un array');
  } else {
    const seen = new Set();
    let previousStart = -Infinity;
    for (let index = 0; index < transcript.segments.length; index += 1) {
      const segment = transcript.segments[index];
      const prefix = `segments[${index}]`;
      if (!isObject(segment)) {
        errors.push(`${prefix} non valido`);
        continue;
      }
      if (!isString(segment.id) || !SEGMENT_PATTERN.test(segment.id)) {
        errors.push(`${prefix}.id non valido`);
      } else {
        if (transcript.revisionId && !segment.id.startsWith(`${transcript.revisionId}-s`)) {
          errors.push(`${prefix}.id non appartiene alla revisione ${transcript.revisionId}`);
        }
        if (seen.has(segment.id)) errors.push(`${prefix}.id duplicato: ${segment.id}`);
        seen.add(segment.id);
      }
      if (!isFiniteNumber(segment.start) || segment.start < 0) {
        errors.push(`${prefix}.start non valido`);
      }
      if (!isFiniteNumber(segment.end) || segment.end < 0) {
        errors.push(`${prefix}.end non valido`);
      }
      if (isFiniteNumber(segment.start) && isFiniteNumber(segment.end)
          && segment.end < segment.start) {
        errors.push(`${prefix}.end precede start`);
      }
      if (!isString(segment.text)) errors.push(`${prefix}.text non valido`);
      if (segment.speaker !== undefined && !isNullableString(segment.speaker)) {
        errors.push(`${prefix}.speaker non valido`);
      }
      if (isFiniteNumber(segment.start)) {
        if (segment.start < previousStart) {
          warnings.push(`${prefix} non è ordinato per start`);
        }
        previousStart = Math.max(previousStart, segment.start);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateEdits(edits, { ignoreSchemaVersion = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(edits)) {
    return { ok: false, errors: ['edits non è un oggetto'], warnings };
  }

  if (!ignoreSchemaVersion && edits.schemaVersion !== SCHEMA_VERSIONS.edits) {
    errors.push(`schemaVersion deve essere ${SCHEMA_VERSIONS.edits}`);
  }
  if (!isString(edits.revisionId) || !REVISION_PATTERN.test(edits.revisionId)) {
    errors.push('revisionId non valido');
  }
  if (!isString(edits.sourceHash) || !/^sha256:[a-f0-9]{64}$/.test(edits.sourceHash)) {
    errors.push('sourceHash non valido');
  }
  if (!Number.isInteger(edits.editRevision) || edits.editRevision < 0) {
    errors.push('editRevision non valido');
  }
  if (!isObject(edits.segmentText)) errors.push('segmentText non è un oggetto');
  if (!Array.isArray(edits.hiddenSegmentIds)) errors.push('hiddenSegmentIds non è un array');
  if (!isObject(edits.tags)) errors.push('tags non è un oggetto');
  if (!isObject(edits.annotations)) errors.push('annotations non è un oggetto');
  if (edits.order !== null && !Array.isArray(edits.order)) errors.push('order non valido');
  if (!Array.isArray(edits.groups)) errors.push('groups non è un array');
  if (edits.legacyDocumentText !== undefined && !isString(edits.legacyDocumentText)) {
    errors.push('legacyDocumentText non valido');
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = {
  SEGMENT_PATTERN,
  validateEdits,
  validateMetadata,
  validateTranscript,
};
