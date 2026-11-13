'use strict';

const fs = require('fs');
const path = require('path');

const { openSearchIndex, removeIndexFiles } = require('../core/search/index');
const {
  indexRecording,
  removeRecording,
  syncRecordings,
} = require('../core/search/recording-indexer');

/**
 * Ciclo di vita dell'indice FTS5. L'indice è sempre derivato: il filesystem
 * resta l'unica fonte di verità e ogni errore di indicizzazione è non fatale.
 */
function createSearchService({
  recordingsDir,
  indexPath,
  store,
  openIndex = openSearchIndex,
  removeIndex = removeIndexFiles,
  indexOne = indexRecording,
  removeOne = removeRecording,
  syncAll = syncRecordings,
  logger = null,
} = {}) {
  let index = null;
  let unavailable = false;
  let rebuilding = false;
  let synced = false;

  function getIndex() {
    if (index) return index;
    if (unavailable) return null;
    try {
      index = openIndex({ dbPath: indexPath });
      return index;
    } catch (err) {
      unavailable = true;
      logger?.warn('search.index-unavailable', { error: err.message });
      console.warn('Indice di ricerca non disponibile:', err.message);
      return null;
    }
  }

  function indexRecordingSafe(recDir) {
    try {
      const current = getIndex();
      if (!current || !recDir) return;
      indexOne({ index: current, store, recDir, recordingsDir });
    } catch (err) {
      logger?.warn('search.index-failed', { error: err.message });
      console.warn('Indicizzazione fallita:', recDir, err.message);
    }
  }

  function removeRecordingSafe(recDir) {
    try {
      if (index && recDir) removeOne(index, recDir);
    } catch (_) {}
  }

  function collectRecordingDirs() {
    const result = [];
    if (!fs.existsSync(recordingsDir)) return result;

    for (const entry of fs.readdirSync(recordingsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dir = path.join(recordingsDir, entry.name);
      let children = [];
      try {
        children = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      for (const child of children) {
        if (child.isDirectory() && !child.name.startsWith('.')) {
          result.push(path.join(dir, child.name));
        }
      }
    }
    return result;
  }

  function sync() {
    const current = getIndex();
    if (!current) return { indexed: 0, skipped: 0, failed: 0 };
    const summary = syncAll({
      index: current,
      store,
      recordingsDir,
      recDirs: collectRecordingDirs(),
    });
    synced = true;
    return summary;
  }

  function ensureSynced() {
    const current = getIndex();
    if (!current) return;
    if (!synced || current.count() === 0) sync();
  }

  function rebuild() {
    if (rebuilding) return { success: false, error: 'Ricostruzione già in corso' };
    rebuilding = true;
    synced = false;

    try {
      if (index) {
        try { index.close(); } catch (_) {}
        index = null;
      }
      unavailable = false;
      removeIndex(indexPath);

      const next = getIndex();
      if (!next) {
        return { success: false, error: 'Impossibile creare l’indice di ricerca' };
      }
      const summary = sync();
      return { success: true, ...summary };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      rebuilding = false;
    }
  }

  function close() {
    if (!index) return;
    try { index.close(); } catch (_) {}
    index = null;
  }

  function markRecordingChanged(recDir, { movedFrom = null } = {}) {
    if (movedFrom) removeRecordingSafe(movedFrom);
    indexRecordingSafe(recDir);
  }

  return {
    close,
    collectRecordingDirs,
    ensureSynced,
    getIndex,
    indexRecording: indexRecordingSafe,
    markRecordingChanged,
    rebuild,
    removeRecording: removeRecordingSafe,
    sync,
  };
}

module.exports = {
  createSearchService,
};
