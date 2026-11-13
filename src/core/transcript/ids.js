'use strict';

const REVISION_PATTERN = /^r[1-9][0-9]*$/;

function revisionId(number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Numero revisione non valido: ${number}`);
  }
  return `r${n}`;
}

function revisionNumber(id) {
  if (typeof id !== 'string' || !REVISION_PATTERN.test(id)) return null;
  return Number(id.slice(1));
}

function segmentId(revId, oneBasedIndex) {
  const n = Number(oneBasedIndex);
  if (!REVISION_PATTERN.test(revId) || !Number.isInteger(n) || n < 1) {
    throw new Error(`ID segmento non valido: ${revId}/${oneBasedIndex}`);
  }
  return `${revId}-s${String(n).padStart(4, '0')}`;
}

function nextRevisionNumber(metadata, revisionsDirNames = []) {
  const numbers = [];

  for (const item of metadata?.revisions || []) {
    const n = revisionNumber(item?.revisionId);
    if (n) numbers.push(n);
  }

  for (const name of revisionsDirNames) {
    const n = revisionNumber(name);
    if (n) numbers.push(n);
  }

  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

function normalizeSegments(rawSegments, revId, { fallbackEnd = 0 } = {}) {
  const list = Array.isArray(rawSegments) ? rawSegments : [];
  const cleaned = [];

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;

    const rawStart = raw.offsets
      ? Number(raw.offsets.from) / 1000
      : Number(raw.start);
    const rawEnd = raw.offsets
      ? Number(raw.offsets.to) / 1000
      : Number(raw.end);
    const start = Number.isFinite(rawStart) && rawStart >= 0 ? rawStart : 0;
    const end = Number.isFinite(rawEnd) && rawEnd >= 0 ? rawEnd : start;
    const text = String(raw.text ?? '').trim();
    const speaker = typeof raw.speaker === 'string' ? raw.speaker.trim() : '';

    cleaned.push({
      start,
      end: Math.max(start, end),
      text,
      speaker: speaker || null,
    });
  }

  if (cleaned.length === 0) return [];

  // Un segmento completamente vuoto non aggiunge informazione. Se invece
  // l'intera lista è vuota, il chiamante può decidere di creare un fallback.
  const withText = cleaned.filter((segment) => segment.text.length > 0);
  const selected = withText.length > 0 ? withText : cleaned;

  return selected.map((segment, index) => ({
    id: segmentId(revId, index + 1),
    start: segment.start,
    end: segment.end || (index === selected.length - 1 ? fallbackEnd : segment.start),
    text: segment.text,
    ...(segment.speaker ? { speaker: segment.speaker } : {}),
  }));
}

module.exports = {
  REVISION_PATTERN,
  revisionId,
  revisionNumber,
  segmentId,
  nextRevisionNumber,
  normalizeSegments,
};
