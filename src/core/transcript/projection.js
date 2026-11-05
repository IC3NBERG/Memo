'use strict';

function warning(warnings, code, details) {
  warnings.push({ code, ...details });
}

/**
 * Applica l'overlay alla sorgente senza mai modificarla.
 * - override testuali per ID;
 * - segmenti nascosti;
 * - ordine parziale: gli ID mancanti finiscono in coda nell'ordine sorgente;
 * - gruppi/ordini con ID orfani vengono segnalati ma non bloccano la vista.
 */
function projectTranscript(transcript, edits) {
  const warnings = [];
  const sourceSegments = Array.isArray(transcript?.segments) ? transcript.segments : [];
  const byId = new Map(sourceSegments.map((segment) => [segment.id, segment]));
  const safeEdits = edits && typeof edits === 'object' ? edits : {};

  const hiddenIds = new Set();
  for (const id of Array.isArray(safeEdits.hiddenSegmentIds) ? safeEdits.hiddenSegmentIds : []) {
    if (!byId.has(id)) {
      warning(warnings, 'unknown-segment-id', { field: 'hiddenSegmentIds', id });
      continue;
    }
    hiddenIds.add(id);
  }

  let orderedIds = sourceSegments.map((segment) => segment.id);
  if (Array.isArray(safeEdits.order)) {
    const seen = new Set();
    const explicit = [];

    for (const id of safeEdits.order) {
      if (!byId.has(id)) {
        warning(warnings, 'unknown-segment-id', { field: 'order', id });
        continue;
      }
      if (seen.has(id)) {
        warning(warnings, 'duplicate-segment-id', { field: 'order', id });
        continue;
      }
      seen.add(id);
      explicit.push(id);
    }

    const missing = sourceSegments
      .map((segment) => segment.id)
      .filter((id) => !seen.has(id));

    orderedIds = explicit.concat(missing);
  }

  for (const group of Array.isArray(safeEdits.groups) ? safeEdits.groups : []) {
    for (const id of Array.isArray(group?.segmentIds) ? group.segmentIds : []) {
      if (!byId.has(id)) {
        warning(warnings, 'unknown-segment-id', {
          field: 'groups',
          groupId: group?.id ?? null,
          id,
        });
      }
    }
  }

  const segmentText = safeEdits.segmentText && typeof safeEdits.segmentText === 'object'
    ? safeEdits.segmentText
    : {};

  const effectiveSegments = orderedIds
    .filter((id) => !hiddenIds.has(id))
    .map((id) => {
      const source = byId.get(id);
      const override = segmentText[id];
      return {
        ...source,
        text: typeof override === 'string' ? override : source.text,
      };
    });

  const projectedText = effectiveSegments
    .map((segment) => segment.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Compatibilità temporanea con l'editor contenteditable precedente: il
  // testo completo modificato non è riconducibile ai segmenti. Resta
  // un'informazione dell'overlay, non della sorgente.
  if (typeof safeEdits.legacyDocumentText === 'string') {
    return {
      segments: [],
      effectiveSegments,
      text: safeEdits.legacyDocumentText,
      warnings,
      legacyDocumentText: true,
    };
  }

  return {
    segments: effectiveSegments,
    effectiveSegments,
    text: projectedText,
    warnings,
    legacyDocumentText: false,
  };
}

module.exports = {
  projectTranscript,
};
