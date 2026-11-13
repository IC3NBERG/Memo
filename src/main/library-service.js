'use strict';

const fs = require('fs');
const path = require('path');

const {
  createFolder,
  deleteFolder,
  renameFolder,
  uniqueDestinationPath,
} = require('../core/library/folders');
const { readMetadataFile, updateMetadataFile } = require('../core/library/metadata');
const { recordingStats, writeManifest } = require('../core/library/manifest');
const { inspectRecording, scanArchive } = require('../core/library/integrity');
const {
  emptyTrash,
  listTrash,
  moveToTrash,
  purgeTrashEntry,
  restoreFromTrash,
} = require('../core/library/trash');
const { isSafeFolderName } = require('../core/storage/path-guard');

/**
 * Servizi della libreria usati dagli handler IPC. Non conosce Electron: ogni
 * dipendenza esterna (path guard, indice di ricerca) è iniettata.
 */
function createLibraryService({
  recordingsDir,
  unsortedDir,
  pathGuard,
  search,
} = {}) {
  function recordingDirs() {
    return search?.collectRecordingDirs?.() || [];
  }

  function getRecordingsInDir(dir, folderName) {
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const recDir = path.join(dir, entry.name);
        const parsed = readMetadataFile(recDir);
        const meta = parsed || { name: entry.name, date: null, duration: 0, hasTranscript: false };
        const stats = recordingStats(recDir);

        let searchText = '';
        const txtPath = path.join(recDir, 'transcript.txt');
        if (fs.existsSync(txtPath)) {
          try { searchText = fs.readFileSync(txtPath, 'utf8'); } catch (_) {}
        }
        if (searchText && !meta.hasTranscript) meta.hasTranscript = true;

        return {
          ...meta,
          id: recDir,
          dirName: entry.name,
          recDir,
          audioPath: path.join(recDir, 'audio.wav'),
          folder: folderName,
          searchText,
          fileCount: stats.fileCount,
          totalBytes: stats.totalBytes,
          manifestStatus: stats.manifestStatus,
        };
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  function buildLibrary() {
    const library = { folders: [], unsorted: [] };
    if (!fs.existsSync(recordingsDir)) return library;

    for (const entry of fs.readdirSync(recordingsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name === '_unsorted') {
        library.unsorted = getRecordingsInDir(unsortedDir, null);
      } else {
        const folderPath = path.join(recordingsDir, entry.name);
        library.folders.push({
          name: entry.name,
          path: folderPath,
          recordings: getRecordingsInDir(folderPath, entry.name),
        });
      }
    }
    return library;
  }

  function createGroup({ name }) {
    try {
      return createFolder({ recordingsDir, name });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function renameGroup({ oldName, newName }) {
    try {
      const result = renameFolder({ recordingsDir, oldName, newName });
      if (result.success) {
        for (const moved of result.moved) {
          search?.markRecordingChanged(moved.to, { movedFrom: moved.from });
        }
      }
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function deleteGroup({ name }) {
    try {
      const result = deleteFolder({ recordingsDir, unsortedDir, name });
      if (result.success) {
        for (const moved of result.moved) {
          search?.markRecordingChanged(moved.to, { movedFrom: moved.from });
        }
      }
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function moveRecording({ recDir, targetFolder }) {
    try {
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }
      if (targetFolder && !isSafeFolderName(targetFolder)) {
        return { success: false, error: 'Gruppo non valido' };
      }

      const dirName = path.basename(recDir);
      const destBase = targetFolder ? path.join(recordingsDir, targetFolder) : unsortedDir;
      if (!fs.existsSync(destBase)) fs.mkdirSync(destBase, { recursive: true });

      let destPath = path.join(destBase, dirName);
      if (path.resolve(destPath) !== path.resolve(recDir)) {
        destPath = uniqueDestinationPath(destBase, dirName);
        fs.renameSync(recDir, destPath);
      }

      const metadataPath = path.join(destPath, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        updateMetadataFile(destPath, (meta) => ({ ...meta, folder: targetFolder || null }));
      }

      search?.markRecordingChanged(destPath, {
        movedFrom: path.resolve(destPath) !== path.resolve(recDir) ? recDir : null,
      });
      return { success: true, newPath: destPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function renameRecording({ recDir, newName }) {
    try {
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }
      const safeName = String(newName ?? '').replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').trim();
      if (!safeName) return { success: false, error: 'Nome non valido' };
      updateMetadataFile(recDir, (meta) => ({ ...meta, name: safeName }));
      search?.indexRecording(recDir);
      return { success: true, name: safeName };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function deleteRecording({ recDir }) {
    try {
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }
      const result = moveToTrash({ recordingsDir, recDir });
      if (result.success) search?.removeRecording(recDir);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function recordingInfo({ recDir }) {
    try {
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }
      const metadata = readMetadataFile(recDir) || {};
      const stats = recordingStats(recDir);
      const relative = path.relative(recordingsDir, recDir);
      const parts = relative.split(path.sep);
      const folder = parts.length > 1 && parts[0] !== '_unsorted' ? parts[0] : null;
      return {
        success: true,
        name: metadata.name || path.basename(recDir),
        folder,
        fileCount: stats.fileCount,
        totalBytes: stats.totalBytes,
        manifestStatus: stats.manifestStatus,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function updateDuration({ recDir, duration }) {
    try {
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }
      updateMetadataFile(recDir, (meta) => ({ ...meta, duration }));
      search?.indexRecording(recDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function scanOne({ recDir, deep = true } = {}) {
    try {
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }
      return { success: true, report: inspectRecording(recDir, { deep: !!deep }) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function scanAll({ deep = false } = {}) {
    try {
      const report = scanArchive({
        recordingsDir,
        recDirs: recordingDirs(),
        deep: !!deep,
      });
      return { success: true, report };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function refreshIntegrity({ recDir } = {}) {
    try {
      if (recDir) {
        if (!pathGuard.isValidRecordingDir(recDir)) {
          return { success: false, error: 'Registrazione non valida' };
        }
        const manifest = writeManifest(recDir);
        return { success: true, refreshed: 1, fileCount: manifest.fileCount };
      }

      let refreshed = 0;
      const failed = [];
      for (const dir of recordingDirs()) {
        try {
          writeManifest(dir);
          refreshed += 1;
        } catch (err) {
          failed.push({ recDir: dir, error: err.message });
        }
      }
      return { success: failed.length === 0, refreshed, failed };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function trashList() {
    try {
      return { success: true, entries: listTrash({ recordingsDir }) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function trashRestore({ trashId } = {}) {
    try {
      const result = restoreFromTrash({ recordingsDir, unsortedDir, trashId });
      if (result.success) search?.indexRecording(result.recDir);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function trashPurge({ trashId } = {}) {
    try {
      return purgeTrashEntry({ recordingsDir, trashId });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function trashEmpty() {
    try {
      return emptyTrash({ recordingsDir });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return {
    buildLibrary,
    createGroup,
    deleteGroup,
    deleteRecording,
    getRecordingsInDir,
    moveRecording,
    recordingInfo,
    refreshIntegrity,
    renameGroup,
    renameRecording,
    scanAll,
    scanOne,
    trashEmpty,
    trashList,
    trashPurge,
    trashRestore,
    updateDuration,
  };
}

module.exports = {
  createLibraryService,
};
