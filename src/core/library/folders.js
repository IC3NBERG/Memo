'use strict';

const fs = require('fs');
const path = require('path');

const { isSafeFolderName } = require('../storage/path-guard');
const { updateMetadataFile } = require('./metadata');

const UNSORTED = '_unsorted';

function normalizeFolderName(name) {
  return String(name ?? '').replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').trim();
}

function validFolderName(name) {
  return isSafeFolderName(name) && name !== UNSORTED;
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

function listRecordingDirs(folderPath) {
  if (!fs.existsSync(folderPath)) return [];
  return fs.readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(folderPath, entry.name));
}

function createFolder({ recordingsDir, name } = {}) {
  const safeName = normalizeFolderName(name);
  if (!validFolderName(safeName)) {
    return { success: false, code: 'invalid-folder', error: 'Nome non valido' };
  }

  const folderPath = path.join(recordingsDir, safeName);
  if (fs.existsSync(folderPath)) {
    return { success: false, code: 'folder-exists', error: 'Gruppo già esistente' };
  }

  try {
    fs.mkdirSync(folderPath, { recursive: true });
    return { success: true, name: safeName, path: folderPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Rinomina un gruppo e allinea il campo `folder` di ogni registrazione.
 * Restituisce l'elenco `moved` per permettere al chiamante di aggiornare
 * l'indice di ricerca senza che il core conosca SQLite.
 */
function renameFolder({ recordingsDir, oldName, newName } = {}) {
  const safeName = normalizeFolderName(newName);
  if (!validFolderName(safeName)) {
    return { success: false, code: 'invalid-folder', error: 'Nome non valido' };
  }
  if (!validFolderName(oldName)) {
    return { success: false, code: 'invalid-folder', error: 'Gruppo non valido' };
  }

  const oldPath = path.join(recordingsDir, oldName);
  const newPath = path.join(recordingsDir, safeName);
  if (!fs.existsSync(oldPath)) {
    return { success: false, code: 'folder-not-found', error: 'Gruppo non trovato' };
  }
  if (fs.existsSync(newPath)) {
    return { success: false, code: 'folder-exists', error: 'Nome già in uso' };
  }

  try {
    fs.renameSync(oldPath, newPath);
  } catch (err) {
    return { success: false, error: err.message };
  }

  const moved = [];
  for (const recDir of listRecordingDirs(newPath)) {
    const oldRecDir = path.join(oldPath, path.basename(recDir));
    updateMetadataFile(recDir, (metadata) => ({ ...metadata, folder: safeName }));
    moved.push({ from: oldRecDir, to: recDir });
  }

  return { success: true, name: safeName, moved };
}

/**
 * Elimina un gruppo spostando le registrazioni in `_unsorted`.
 *
 * Se il gruppo contiene file non gestiti (né directory né `.DS_Store`)
 * l'operazione si ferma prima di muovere qualsiasi cosa. Le collisioni di
 * nome vengono risolte con `_1`, `_2`, …: nessuna registrazione viene
 * sovrascritta.
 */
function deleteFolder({ recordingsDir, unsortedDir, name } = {}) {
  if (!validFolderName(name)) {
    return { success: false, code: 'invalid-folder', error: 'Gruppo non valido' };
  }

  const folderPath = path.join(recordingsDir, name);
  if (!fs.existsSync(folderPath)) {
    return { success: false, code: 'folder-not-found', error: 'Gruppo non trovato' };
  }

  const unmanaged = fs.readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => !entry.isDirectory() && entry.name !== '.DS_Store');
  if (unmanaged.length > 0) {
    return {
      success: false,
      code: 'unmanaged-files',
      error: 'Il gruppo contiene file non gestiti: nessuna registrazione è stata spostata.',
    };
  }

  const moved = [];
  try {
    for (const recDir of listRecordingDirs(folderPath)) {
      const destination = uniqueDestinationPath(unsortedDir, path.basename(recDir));
      fs.renameSync(recDir, destination);
      updateMetadataFile(destination, (metadata) => ({ ...metadata, folder: null }));
      moved.push({ from: recDir, to: destination });
    }
  } catch (err) {
    return { success: false, error: err.message, moved };
  }

  const leftovers = fs.readdirSync(folderPath).filter((entry) => entry !== '.DS_Store');
  if (leftovers.length > 0) {
    return {
      success: false,
      code: 'unmanaged-files',
      error: 'Il gruppo contiene file non gestiti: nessun file è stato eliminato.',
      moved,
    };
  }

  try {
    const dsStore = path.join(folderPath, '.DS_Store');
    if (fs.existsSync(dsStore)) fs.unlinkSync(dsStore);
    fs.rmdirSync(folderPath);
  } catch (err) {
    return { success: false, error: err.message, moved };
  }

  return { success: true, moved };
}

module.exports = {
  UNSORTED,
  createFolder,
  deleteFolder,
  listRecordingDirs,
  normalizeFolderName,
  renameFolder,
  uniqueDestinationPath,
  validFolderName,
};
