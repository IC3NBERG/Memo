'use strict';

const fs = require('fs');
const path = require('path');

const {
  ensureDirSync,
  writeFileAtomicSync,
  writeJsonAtomicSync,
} = require('../storage/atomic');
const { isSafeFolderName } = require('../storage/path-guard');
const { createMetadataForNewRecording } = require('../transcript/store');
const { writeManifest } = require('./manifest');

const FALLBACK_RECORDING_NAME = 'Lezione';
const TIMESTAMP_PAD = (value) => String(value).padStart(2, '0');

/**
 * Nome visibile e nome cartella condividono la stessa sanificazione: niente
 * separatori di percorso né caratteri di controllo.
 */
function sanitizeRecordingName(name) {
  const cleaned = String(name ?? '')
    .replace(/[^a-zA-Z0-9À-ÿ _-]/g, '')
    .trim();
  return cleaned || FALLBACK_RECORDING_NAME;
}

function formatRecordingTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  const dateStr = `${d.getFullYear()}-${TIMESTAMP_PAD(d.getMonth() + 1)}-${TIMESTAMP_PAD(d.getDate())}`;
  const timeStr = `${TIMESTAMP_PAD(d.getHours())}-${TIMESTAMP_PAD(d.getMinutes())}-${TIMESTAMP_PAD(d.getSeconds())}`;
  return `${dateStr}_${timeStr}`;
}

/**
 * Alloca una directory libera senza mai sovrascrivere una registrazione
 * esistente. `_1`, `_2`, … mantengono l'ordinamento cronologico.
 */
function allocateRecordingDir(baseDir, dirName) {
  let candidate = path.join(baseDir, dirName);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(baseDir, `${dirName}_${counter}`);
    counter += 1;
  }
  return candidate;
}

function createRecording({
  recordingsDir,
  unsortedDir,
  folder = null,
  name,
  date = new Date(),
  buffer,
}) {
  if (folder && (!isSafeFolderName(folder) || folder === '_unsorted')) {
    return { success: false, error: 'Gruppo non valido' };
  }
  if (!buffer || buffer.length === 0) {
    return { success: false, error: 'Audio mancante' };
  }

  const safeName = sanitizeRecordingName(name);
  const baseDir = folder ? path.join(recordingsDir, folder) : unsortedDir;
  ensureDirSync(baseDir);

  const dirName = `${formatRecordingTimestamp(date)}_${safeName}`;
  const recDir = allocateRecordingDir(baseDir, dirName);

  // mkdir non ricorsivo: se qualcuno ha occupato il percorso nel frattempo,
  // meglio fallire che scrivere dentro una cartella non nostra.
  fs.mkdirSync(recDir);

  try {
    const audioPath = path.join(recDir, 'audio.wav');
    writeFileAtomicSync(audioPath, Buffer.from(buffer));

    const metadata = createMetadataForNewRecording({
      name: safeName,
      date,
      folder: folder || null,
    });
    writeJsonAtomicSync(path.join(recDir, 'metadata.json'), metadata);
    writeManifest(recDir);

    return { success: true, recDir, audioPath };
  } catch (err) {
    try { fs.rmSync(recDir, { recursive: true, force: true }); } catch (_) {}
    throw err;
  }
}

module.exports = {
  FALLBACK_RECORDING_NAME,
  allocateRecordingDir,
  createRecording,
  formatRecordingTimestamp,
  sanitizeRecordingName,
};
