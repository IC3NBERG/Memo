'use strict';

const {
  SCHEMA_VERSIONS,
  TRANSCRIPT_KINDS,
  TRANSCRIPT_TIMINGS,
} = require('./constants');
const { REVISION_PATTERN, segmentId } = require('./ids');
const { SEGMENT_PATTERN } = require('./validate');

function warning(warnings, code, message, details = {}) {
  warnings.push({ code, message, ...details });
}

function textOrNull(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  return typeof value === 'string' ? value : fallback;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSource(source, fallback = {}) {
  const raw = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const timing = TRANSCRIPT_TIMINGS.includes(raw.timing)
    ? raw.timing
    : (fallback.timing || 'whole-recording');
  const kind = fallback.kind || 'transcription';

  return {
    ...raw,
    engine: textOrNull(raw.engine),
    model: textOrNull(raw.model),
    language: textOrNull(raw.language),
    targetLanguage: textOrNull(raw.targetLanguage),
    complete: typeof raw.complete === 'boolean' ? raw.complete : kind !== 'livePreview',
    translated: typeof raw.translated === 'boolean'
      ? raw.translated
      : (kind === 'translation'),
    timing,
    format: raw.format === undefined ? null : textOrNull(raw.format),
  };
}

function rawSegmentParts(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const start = raw.offsets
    ? finiteOrNull(raw.offsets.from) / 1000
    : finiteOrNull(raw.start);
  const end = raw.offsets
    ? finiteOrNull(raw.offsets.to) / 1000
    : finiteOrNull(raw.end);
  return {
    start: Number.isFinite(start) && start >= 0 ? start : null,
    end: Number.isFinite(end) && end >= 0 ? end : null,
    text: typeof raw.text === 'string' ? raw.text : null,
    speaker: typeof raw.speaker === 'string' && raw.speaker.trim()
      ? raw.speaker.trim()
      : null,
    id: typeof raw.id === 'string' ? raw.id : null,
  };
}

/**
 * Ripara in memoria un transcript non conforme, senza mai riscrivere la
 * sorgente. I casi gestiti sono: schema/kind/source incompleti, ID mancanti,
 * duplicati o di un'altra revisione, timestamp invalidi o invertiti, segmenti
 * non oggetto e speaker non stringa. Il documento prodotto è sempre valido per
 * il formato corrente.
 */
function repairTranscriptDocument(raw, expectedRevisionId, {
  ignoreSchemaVersion = false,
  fallbackEnd = 0,
} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'invalid-transcript',
      errors: ['transcript non è un oggetto'],
      warnings: [],
      repaired: false,
    };
  }

  const warnings = [];
  const version = Number(raw.schemaVersion) || 1;
  if (!ignoreSchemaVersion && version !== SCHEMA_VERSIONS.transcript) {
    return {
      ok: false,
      code: version > SCHEMA_VERSIONS.transcript ? 'unsupported-schema' : 'invalid-transcript',
      errors: [`schemaVersion ${version} non supportata (${SCHEMA_VERSIONS.transcript})`],
      warnings,
      repaired: false,
    };
  }

  let revisionId = expectedRevisionId;
  if (!revisionId) {
    revisionId = typeof raw.revisionId === 'string' && REVISION_PATTERN.test(raw.revisionId)
      ? raw.revisionId
      : null;
  }
  if (!revisionId) revisionId = 'r1';
  if (raw.revisionId !== revisionId) {
    warning(warnings, 'revision-id-repaired', 'revisionId del transcript corretto', {
      from: raw.revisionId ?? null,
      to: revisionId,
    });
  }

  let kind = TRANSCRIPT_KINDS.includes(raw.kind) ? raw.kind : null;
  if (!kind) {
    kind = 'transcription';
    warning(warnings, 'kind-repaired', 'kind del transcript mancante o non valido');
  }

  const source = normalizeSource(raw.source, { kind });
  if (!raw.source || typeof raw.source !== 'object') {
    warning(warnings, 'source-repaired', 'source del transcript mancante');
  }

  const rawSegments = Array.isArray(raw.segments) ? raw.segments : [];
  if (!Array.isArray(raw.segments)) {
    warning(warnings, 'segments-repaired', 'segments del transcript mancante o non array');
  }

  const parts = rawSegments
    .map((segment, index) => {
      const parsed = rawSegmentParts(segment);
      if (!parsed) {
        warning(warnings, 'segment-dropped', 'segmento non oggetto ignorato', { index });
        return null;
      }
      return { ...parsed, index };
    })
    .filter(Boolean);

  // Prenota gli ID già validi: gli ID generati non devono collidere con quelli
  // che compaiono più avanti nel documento.
  const reserved = new Set();
  for (const part of parts) {
    if (part.id && SEGMENT_PATTERN.test(part.id)
        && part.id.startsWith(`${revisionId}-s`)) {
      reserved.add(part.id);
    }
  }

  const used = new Set();
  let nextIndex = 1;
  const segments = [];

  for (const part of parts) {
    let start = part.start;
    let end = part.end;
    if (start === null) {
      start = segments.length > 0 ? segments[segments.length - 1].start : 0;
      warning(warnings, 'segment-start-repaired', 'start mancante corretto', { index: part.index });
    }
    if (end === null) {
      end = Math.max(start, Number(fallbackEnd) || 0);
      warning(warnings, 'segment-end-repaired', 'end mancante corretto', { index: part.index });
    }
    if (end < start) {
      warning(warnings, 'segment-order-repaired', 'end precedeva start', {
        index: part.index,
        start,
        end,
      });
      end = start;
    }

    let id = part.id;
    const validId = id && SEGMENT_PATTERN.test(id)
      && id.startsWith(`${revisionId}-s`)
      && !used.has(id);
    if (!validId) {
      while (reserved.has(segmentId(revisionId, nextIndex))
          || used.has(segmentId(revisionId, nextIndex))) {
        nextIndex += 1;
      }
      id = segmentId(revisionId, nextIndex);
      reserved.add(id);
      nextIndex += 1;
      warning(warnings, 'segment-id-repaired', 'ID segmento rigenerato', {
        index: part.index,
        from: part.id,
        to: id,
      });
    }
    used.add(id);

    if (part.text === null) {
      warning(warnings, 'segment-text-repaired', 'testo segmento non stringa corretto', {
        index: part.index,
        id,
      });
    }

    const text = part.text ?? '';
    const segment = { id, start, end, text };
    if (part.speaker) segment.speaker = part.speaker;
    segments.push(segment);
  }

  const transcript = {
    ...raw,
    schemaVersion: ignoreSchemaVersion ? version : SCHEMA_VERSIONS.transcript,
    revisionId,
    kind,
    source,
    segments,
  };

  return {
    ok: true,
    transcript,
    warnings,
    repaired: warnings.length > 0,
    schemaVersion: version,
  };
}

module.exports = {
  repairTranscriptDocument,
};
