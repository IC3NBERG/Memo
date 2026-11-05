'use strict';

const { createRecording } = require('../core/library/recordings');

/**
 * Handler puri per i confini IPC di Fase A0. Non dipendono da Electron: main.js
 * li registra e i test possono esercitarli contro un archivio temporaneo.
 */

function createRecordingSaveHandler({
  recordingsDir,
  unsortedDir,
  now = () => new Date(),
}) {
  return (payload = {}) => {
    try {
      return createRecording({
        recordingsDir,
        unsortedDir,
        folder: payload.folder || null,
        name: payload.name,
        date: now(),
        buffer: payload.buffer,
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  };
}

function createTranscriptReadHandler({ pathGuard, store }) {
  return (payload = {}) => {
    try {
      const { recDir } = payload;
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }

      const result = store.readActiveTranscript(recDir);
      if (!result.success) {
        return { success: false, error: result.error, code: result.code };
      }

      return {
        success: true,
        transcript: result.transcript,
        meta: result.metadata,
        revisionId: result.revisionId,
        kind: result.kind,
      };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  };
}

function createTranscriptSaveHandler({ pathGuard, store }) {
  return (payload = {}) => {
    try {
      const { recDir, transcript, isLivePreview, isTranslated } = payload;
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }

      return store.saveLegacyTranscript(recDir, {
        transcript,
        isLivePreview,
        isTranslated,
      });
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  };
}

module.exports = {
  createRecordingSaveHandler,
  createTranscriptReadHandler,
  createTranscriptSaveHandler,
};
