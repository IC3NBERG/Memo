'use strict';

const crypto = require('crypto');
const path = require('path');

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function folderFromPath(recDir, recordingsDir) {
  if (!recordingsDir) return null;
  const relative = path.relative(recordingsDir, recDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const parts = relative.split(path.sep);
  if (parts.length < 2) return null;
  return parts[0] === '_unsorted' ? null : parts[0];
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function speakerNames(value) {
  if (Array.isArray(value)) {
    return value.flatMap(speakerNames);
  }
  if (typeof value !== 'string') return [];
  const speaker = value.trim();
  return speaker ? [speaker] : [];
}

function collectSpeakers(metadata, segments) {
  const speakers = new Set([
    ...speakerNames(metadata?.speaker),
    ...speakerNames(metadata?.speakers),
  ]);
  for (const segment of segments) {
    for (const speaker of speakerNames(segment.speaker)) speakers.add(speaker);
  }
  return [...speakers].sort((a, b) => a.localeCompare(b, 'it'));
}

/**
 * Costruisce il documento indicizzato dalla revisione ATTIVA, non dalle copie
 * derivate. Se la registrazione non ha trascrizione resta comunque cercabile
 * per nome, gruppo e metadati; i segmenti servono per saltare al punto audio.
 */
function buildIndexRecord({ store, recDir, recordingsDir }) {
  const metadata = store.readMetadata(recDir);
  let body = '';
  let revisionId = metadata.activeRevisionId || null;
  let segments = [];

  if (revisionId) {
    const result = store.readActiveTranscript(recDir);
    if (result.success && result.transcript) {
      body = String(result.transcript.text || '');
      revisionId = result.revisionId || revisionId;
      segments = (Array.isArray(result.transcript.segments) ? result.transcript.segments : [])
        .map((segment) => ({
          start: Number.isFinite(Number(segment.start)) ? Number(segment.start) : 0,
          end: Number.isFinite(Number(segment.end)) ? Number(segment.end) : 0,
          text: String(segment.text ?? ''),
          speaker: speakerNames(segment.speaker)[0] || null,
        }));
    }
  }

  const name = String(metadata.name || path.basename(recDir));
  const folder = metadata.folder || folderFromPath(recDir, recordingsDir) || '';
  const updatedAt = metadata.updatedAt || null;
  const startedAt = normalizeDate(metadata.date || metadata.createdAt);
  const duration = Number.isFinite(Number(metadata.duration)) ? Number(metadata.duration) : 0;
  const speakers = collectSpeakers(metadata, segments);
  const contentHash = sha256(JSON.stringify([
    name,
    folder,
    body,
    revisionId,
    updatedAt,
    startedAt,
    duration,
    speakers,
    segments.map((segment) => [segment.start, segment.end, segment.text, segment.speaker]),
  ]));

  return {
    recId: path.resolve(recDir),
    name,
    folder,
    body,
    startedAt,
    duration,
    speakers,
    segments,
    updatedAt,
    revisionId,
    contentHash,
  };
}

function indexRecording({ index, store, recDir, recordingsDir }) {
  if (!index) return { indexed: false, changed: false, reason: 'index-unavailable' };
  const record = buildIndexRecord({ store, recDir, recordingsDir });
  const result = index.upsert(record);
  return {
    indexed: true,
    changed: result.changed,
    recId: record.recId,
    revisionId: record.revisionId,
  };
}

function removeRecording(index, recDir) {
  if (!index) return false;
  return index.remove(path.resolve(recDir));
}

function syncRecordings({ index, store, recordingsDir, recDirs = [] }) {
  const summary = { indexed: 0, skipped: 0, failed: 0 };
  if (!index) return summary;

  for (const recDir of recDirs) {
    try {
      const result = indexRecording({ index, store, recDir, recordingsDir });
      if (result.indexed) {
        summary.skipped += result.changed ? 0 : 1;
        summary.indexed += result.changed ? 1 : 0;
      }
    } catch (_) {
      summary.failed += 1;
    }
  }

  return summary;
}

module.exports = {
  buildIndexRecord,
  collectSpeakers,
  folderFromPath,
  indexRecording,
  removeRecording,
  syncRecordings,
};
