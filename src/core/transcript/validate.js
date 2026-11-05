'use strict';

const { SCHEMA_VERSIONS, TRANSCRIPT_KINDS, TRANSCRIPT_TIMINGS } = require('./constants');
const { REVISION_PATTERN } = require('./ids');

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

function validateMetadata(metadata) {
  const errors = [];
  if (!isObject(metadata)) return { ok: false, errors: ['metadata non è un oggetto'] };

  if (metadata.schemaVersion !== SCHEMA_VERSIONS.metadata) {
    errors.push(`schemaVersion deve essere ${SCHEMA_VERSIONS.metadata}`);
  }
  if (!isString(metadata.id) || metadata.id.length === 0) errors.push('id mancante');
  if (!isString(metadata.createdAt)) errors.push('createdAt mancante');
  if (!isString(metadata.updatedAt)) errors.push('updatedAt mancante');
  if (!isString(metadata.name)) errors.push('name mancante');
  if (!isFiniteNumber(metadata.duration)) errors.push('duration non valida');
  if (!isBoolean(metadata.hasTranscript)) errors.push('hasTranscript non booleano');
  if (!isBoolean(metadata.isCompleteTranscript)) errors.push('isCompleteTranscript non booleano');
  if (!isBoolean(metadata.isLivePreview)) errors.push('isLivePreview non booleano');
  if (!isBoolean(metadata.isTranslated)) errors.push('isTranslated non booleano');
  if (!isNullableString(metadata.activeRevisionId)) errors.push('activeRevisionId non valido');
  if (!Array.isArray(metadata.revisions)) errors.push('revisions non è un array');
  if (!isNullableString(metadata.previewReplacedAt)) errors.push('previewReplacedAt non valido');

  return { ok: errors.length === 0, errors };
}

function validateTranscript(transcript) {
  const errors = [];
  if (!isObject(transcript)) return { ok: false, errors: ['transcript non è un oggetto'] };

  if (transcript.schemaVersion !== SCHEMA_VERSIONS.transcript) {
    errors.push(`schemaVersion deve essere ${SCHEMA_VERSIONS.transcript}`);
  }
  if (!isString(transcript.revisionId) || !REVISION_PATTERN.test(transcript.revisionId)) {
    errors.push('revisionId non valido');
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
  }
  if (!Array.isArray(transcript.segments)) {
    errors.push('segments non è un array');
  } else {
    for (const segment of transcript.segments) {
      if (!isObject(segment)) {
        errors.push('segmento non valido');
        continue;
      }
      if (!isString(segment.id) || segment.id.length === 0) errors.push('segment.id mancante');
      if (!isFiniteNumber(segment.start) || segment.start < 0) errors.push('segment.start non valido');
      if (!isFiniteNumber(segment.end) || segment.end < 0) errors.push('segment.end non valido');
      if (!isString(segment.text)) errors.push('segment.text non valido');
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateEdits(edits) {
  const errors = [];
  if (!isObject(edits)) return { ok: false, errors: ['edits non è un oggetto'] };

  if (edits.schemaVersion !== SCHEMA_VERSIONS.edits) {
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

  return { ok: errors.length === 0, errors };
}

module.exports = {
  validateMetadata,
  validateTranscript,
  validateEdits,
};
