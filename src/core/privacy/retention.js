'use strict';

const fs = require('fs');
const path = require('path');

const { readMetadataFile } = require('../library/metadata');
const { listTrash, moveToTrash, purgeTrashEntry } = require('../library/trash');
const { normalizePrivacySettings } = require('./settings');

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value) {
  if (typeof value !== 'string' || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function recordingDate(recDir) {
  const metadata = readMetadataFile(recDir);
  const fromMetadata = parseDate(metadata?.createdAt) || parseDate(metadata?.date);
  if (fromMetadata) return fromMetadata;
  try {
    const stat = fs.statSync(recDir);
    return stat.birthtimeMs || stat.mtimeMs;
  } catch (_) {
    return null;
  }
}

/**
 * Elenca le registrazioni dell'archivio (un livello di gruppo, più
 * `_unsorted`). Esclude cartelle di servizio e file nascosti.
 */
function listRecordings(recordingsDir) {
  const result = [];
  if (!recordingsDir || !fs.existsSync(recordingsDir)) return result;

  for (const entry of fs.readdirSync(recordingsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name === '_unsorted') {
      const unsorted = path.join(recordingsDir, '_unsorted');
      let children = [];
      try { children = fs.readdirSync(unsorted, { withFileTypes: true }); } catch (_) { continue; }
      for (const child of children) {
        if (child.isDirectory() && !child.name.startsWith('.')) {
          result.push(path.join(unsorted, child.name));
        }
      }
      continue;
    }
    const group = path.join(recordingsDir, entry.name);
    let children = [];
    try { children = fs.readdirSync(group, { withFileTypes: true }); } catch (_) { continue; }
    for (const child of children) {
      if (child.isDirectory() && !child.name.startsWith('.')) {
        result.push(path.join(group, child.name));
      }
    }
  }
  return result;
}

/**
 * Applica la politica di retention:
 *  - il cestino viene svuotato parzialmente oltre `trashDays` (0 = mai);
 *  - le registrazioni più vecchie di `recordingsDays` (0 = mai) vengono
 *    spostate nel cestino, non cancellate: restano recuperabili finché non
 *    scade anche la retention del cestino.
 */
function applyRetention({ recordingsDir, settings, now = () => new Date(), dryRun = false } = {}) {
  const normalized = normalizePrivacySettings(settings);
  const nowDate = now();
  const nowMs = nowDate.getTime();
  const result = {
    success: true,
    dryRun: !!dryRun,
    purgedTrash: [],
    trashedRecordings: [],
    errors: [],
    retention: normalized.retention,
  };

  const trashDays = normalized.retention.trashDays;
  if (trashDays > 0) {
    const cutoff = nowMs - (trashDays * DAY_MS);
    for (const entry of listTrash({ recordingsDir })) {
      const trashedAt = parseDate(entry.trashedAt);
      if (!trashedAt || trashedAt > cutoff) continue;
      if (dryRun) {
        result.purgedTrash.push({ id: entry.id, trashedAt: entry.trashedAt });
        continue;
      }
      const purged = purgeTrashEntry({ recordingsDir, trashId: entry.id });
      if (purged.success) {
        result.purgedTrash.push({ id: entry.id, trashedAt: entry.trashedAt });
      } else {
        result.errors.push({ id: entry.id, error: purged.error });
      }
    }
  }

  const recordingsDays = normalized.retention.recordingsDays;
  if (recordingsDays > 0) {
    const cutoff = nowMs - (recordingsDays * DAY_MS);
    for (const recDir of listRecordings(recordingsDir)) {
      const date = recordingDate(recDir);
      if (!date || date > cutoff) continue;
      if (dryRun) {
        result.trashedRecordings.push({ recDir, date: new Date(date).toISOString() });
        continue;
      }
      const moved = moveToTrash({ recordingsDir, recDir });
      if (moved.success) {
        result.trashedRecordings.push({
          recDir,
          trashId: moved.trashId,
          date: new Date(date).toISOString(),
        });
      } else {
        result.errors.push({ recDir, error: moved.error });
      }
    }
  }

  result.success = result.errors.length === 0;
  return result;
}

module.exports = {
  DAY_MS,
  applyRetention,
  listRecordings,
  recordingDate,
};
