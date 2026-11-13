'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { ensureDirSync, readJsonSafe, writeJsonAtomicSync } = require('../storage/atomic');
const { isSafeFolderName } = require('../storage/path-guard');
const { updateMetadataFile } = require('./metadata');
const { recordingStats } = require('./manifest');

const TRASH_DIR = '.trash';
const TRASH_ENTRY_FILE = '.trash-entry.json';
const TRASH_ENTRY_SCHEMA_VERSION = 1;

function trashRoot(recordingsDir) {
  return path.join(recordingsDir, TRASH_DIR);
}

function nowIso() {
  return new Date().toISOString();
}

function trashTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function validateTrashId(id) {
  return typeof id === 'string'
    && id.length > 0
    && !id.includes('/')
    && !id.includes('\\')
    && !id.includes('\0')
    && id !== '.'
    && id !== '..';
}

function uniqueDestinationPath(baseDir, dirName) {
  let candidate = path.join(baseDir, dirName);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(baseDir, `${dirName}_${counter}`);
    counter += 1;
  }
  return candidate;
}

function folderFromRecDir(recDir, recordingsDir) {
  const relative = path.relative(recordingsDir, recDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const parts = relative.split(path.sep);
  if (parts.length < 2) return null;
  return parts[0] === '_unsorted' ? null : parts[0];
}

function makeEntry(recDir, recordingsDir, { trashId, trashedAt } = {}) {
  const stats = recordingStats(recDir);
  const metadata = readJsonSafe(path.join(recDir, 'metadata.json'));
  const name = metadata.ok && metadata.value && typeof metadata.value.name === 'string'
    ? metadata.value.name
    : path.basename(recDir);
  return {
    schemaVersion: TRASH_ENTRY_SCHEMA_VERSION,
    id: trashId,
    trashedAt: trashedAt || nowIso(),
    name,
    originalName: path.basename(recDir),
    originalFolder: folderFromRecDir(recDir, recordingsDir),
    originalRelativePath: path.relative(recordingsDir, recDir).split(path.sep).join('/'),
    fileCount: stats.fileCount,
    totalBytes: stats.totalBytes,
    hadManifest: stats.hasManifest,
  };
}

/**
 * Sposta una registrazione nel cestino dell'archivio. Non elimina nulla: il
 * contenuto resta integro e ripristinabile. Il manifest non include
 * `.trash-entry.json`, quindi continua a descrivere i soli file utente.
 */
function moveToTrash({ recordingsDir, recDir, now = () => new Date() } = {}) {
  if (!recordingsDir || !recDir) {
    return { success: false, code: 'invalid-path', error: 'Percorso non valido' };
  }
  if (!fs.existsSync(recDir) || !fs.statSync(recDir).isDirectory()) {
    return { success: false, code: 'not-found', error: 'Registrazione non trovata' };
  }

  const trash = trashRoot(recordingsDir);
  ensureDirSync(trash);

  const date = now();
  const trashId = `${trashTimestamp(date)}__${crypto.randomUUID()}`;
  const destination = uniqueDestinationPath(trash, trashId);
  const entry = makeEntry(recDir, recordingsDir, {
    trashId: path.basename(destination),
    trashedAt: date.toISOString(),
  });

  try {
    fs.renameSync(recDir, destination);
  } catch (err) {
    return { success: false, code: 'move-failed', error: err.message };
  }

  try {
    writeJsonAtomicSync(path.join(destination, TRASH_ENTRY_FILE), entry);
  } catch (err) {
    // Ripristina la posizione originale se non riusciamo a marcare l'entry.
    try { fs.renameSync(destination, recDir); } catch (_) {}
    return { success: false, code: 'trash-entry-failed', error: err.message };
  }

  return {
    success: true,
    trashId: entry.id,
    trashDir: destination,
    entry,
  };
}

function readTrashEntry(dir, fallbackId) {
  const result = readJsonSafe(path.join(dir, TRASH_ENTRY_FILE));
  if (result.ok && result.value && typeof result.value === 'object' && !Array.isArray(result.value)) {
    return {
      ...result.value,
      id: typeof result.value.id === 'string' ? result.value.id : fallbackId,
    };
  }

  let stat = null;
  try { stat = fs.statSync(dir); } catch (_) {}
  return {
    schemaVersion: TRASH_ENTRY_SCHEMA_VERSION,
    id: fallbackId,
    trashedAt: stat ? stat.mtime.toISOString() : null,
    name: fallbackId.split('__').slice(1).join('__') || fallbackId,
    originalName: null,
    originalFolder: null,
    originalRelativePath: null,
    fileCount: null,
    totalBytes: null,
    hadManifest: fs.existsSync(path.join(dir, 'manifest.json')),
  };
}

function listTrash({ recordingsDir } = {}) {
  const root = trashRoot(recordingsDir);
  if (!fs.existsSync(root)) return [];

  const entries = [];
  for (const child of fs.readdirSync(root, { withFileTypes: true })) {
    if (!child.isDirectory() || child.name.startsWith('.')) continue;
    const dir = path.join(root, child.name);
    const entry = readTrashEntry(dir, child.name);
    entries.push({
      ...entry,
      id: child.name,
      dir,
    });
  }

  return entries.sort((a, b) => String(b.trashedAt || '').localeCompare(String(a.trashedAt || '')));
}

function restoreFromTrash({ recordingsDir, unsortedDir, trashId } = {}) {
  if (!validateTrashId(trashId)) {
    return { success: false, code: 'invalid-trash-id', error: 'Elemento del cestino non valido' };
  }

  const source = path.join(trashRoot(recordingsDir), trashId);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    return { success: false, code: 'not-found', error: 'Elemento del cestino non trovato' };
  }

  const entry = readTrashEntry(source, trashId);
  const originalFolder = typeof entry.originalFolder === 'string'
    && isSafeFolderName(entry.originalFolder)
    && fs.existsSync(path.join(recordingsDir, entry.originalFolder))
    ? entry.originalFolder
    : null;
  const baseDir = originalFolder
    ? path.join(recordingsDir, originalFolder)
    : unsortedDir;
  ensureDirSync(baseDir);

  const dirName = typeof entry.originalName === 'string' && entry.originalName
    ? entry.originalName
    : (trashId.split('__').slice(1).join('__') || 'Registrazione');
  const destination = uniqueDestinationPath(baseDir, dirName);

  try {
    fs.renameSync(source, destination);
  } catch (err) {
    return { success: false, code: 'restore-failed', error: err.message };
  }

  try {
    const entryPath = path.join(destination, TRASH_ENTRY_FILE);
    if (fs.existsSync(entryPath)) fs.unlinkSync(entryPath);
  } catch (_) {}

  try {
    updateMetadataFile(destination, (metadata) => ({ ...metadata, folder: originalFolder }));
  } catch (_) {}

  return {
    success: true,
    recDir: destination,
    folder: originalFolder,
    entry,
  };
}

function purgeTrashEntry({ recordingsDir, trashId } = {}) {
  if (!validateTrashId(trashId)) {
    return { success: false, code: 'invalid-trash-id', error: 'Elemento del cestino non valido' };
  }
  const target = path.join(trashRoot(recordingsDir), trashId);
  if (!fs.existsSync(target)) {
    return { success: false, code: 'not-found', error: 'Elemento del cestino non trovato' };
  }
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function emptyTrash({ recordingsDir } = {}) {
  const root = trashRoot(recordingsDir);
  if (!fs.existsSync(root)) return { success: true, removed: 0 };

  let removed = 0;
  try {
    for (const child of fs.readdirSync(root, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      fs.rmSync(path.join(root, child.name), { recursive: true, force: true });
      removed += 1;
    }
    return { success: true, removed };
  } catch (err) {
    return { success: false, error: err.message, removed };
  }
}

module.exports = {
  TRASH_DIR,
  TRASH_ENTRY_FILE,
  emptyTrash,
  listTrash,
  moveToTrash,
  purgeTrashEntry,
  readTrashEntry,
  restoreFromTrash,
  trashRoot,
  validateTrashId,
};
