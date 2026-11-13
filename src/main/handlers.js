'use strict';

const { createRecording } = require('../core/library/recordings');
const { TRANSCRIPT_KINDS } = require('../core/transcript/constants');
const { parseSnippet } = require('../core/search/query');

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

function createRevisionListHandler({ pathGuard, store }) {
  return (payload = {}) => {
    try {
      const { recDir } = payload;
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }

      const metadata = store.readMetadata(recDir);
      return {
        success: true,
        activeRevisionId: metadata.activeRevisionId || null,
        revisions: store.listRevisions(recDir),
      };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  };
}

function createRevisionSwitchHandler({ pathGuard, store }) {
  return (payload = {}) => {
    try {
      const { recDir, revisionId } = payload;
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }
      if (typeof revisionId !== 'string' || revisionId.length === 0) {
        return { success: false, error: 'Revisione non valida' };
      }

      return store.switchActiveRevision(recDir, revisionId);
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  };
}

function createEditsSaveHandler({ pathGuard, store }) {
  return (payload = {}) => {
    try {
      const { recDir, edits, expectedEditRevision } = payload;
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }

      return store.saveEdits(recDir, edits, { expectedEditRevision });
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  };
}

function createEditsResetHandler({ pathGuard, store }) {
  return (payload = {}) => {
    try {
      const { recDir } = payload;
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }

      return store.resetOverlay(recDir);
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  };
}

function createRevisionCreateHandler({ pathGuard, store }) {
  return (payload = {}) => {
    try {
      const { recDir, kind, text, timing } = payload;
      if (!pathGuard.isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }
      const nextKind = TRANSCRIPT_KINDS.includes(kind) ? kind : 'transcription';
      const body = String(text ?? '').trim();
      if (!body) return { success: false, error: 'Nessun testo da convertire' };

      return store.createRevision(recDir, {
        kind: nextKind,
        source: {
          engine: null,
          model: null,
          language: null,
          targetLanguage: nextKind === 'translation' ? 'en' : null,
          complete: nextKind !== 'livePreview',
          translated: nextKind === 'translation',
          timing: timing === 'segment' ? 'segment' : 'whole-recording',
          format: 'block-editor-conversion',
        },
        text: body,
      });
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  };
}

function createSearchHandler({ getIndex }) {
  return (payload = {}) => {
    try {
      const index = getIndex();
      if (!index) {
        return {
          success: false,
          code: 'index-unavailable',
          error: 'Indice di ricerca non disponibile',
        };
      }

      const results = index.search(String(payload.query ?? ''), {
        limit: payload.limit,
        filters: payload.filters,
      });
      return {
        success: true,
        results: results.map((row) => ({
          ...row,
          snippetParts: parseSnippet(row.snippet),
        })),
      };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  };
}

function createSearchFacetsHandler({ getIndex }) {
  return () => {
    try {
      const index = getIndex();
      if (!index) {
        return {
          success: false,
          code: 'index-unavailable',
          error: 'Indice di ricerca non disponibile',
        };
      }
      return { success: true, ...index.facets() };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  };
}

module.exports = {
  createEditsResetHandler,
  createEditsSaveHandler,
  createRecordingSaveHandler,
  createRevisionCreateHandler,
  createRevisionListHandler,
  createRevisionSwitchHandler,
  createSearchFacetsHandler,
  createSearchHandler,
  createTranscriptReadHandler,
  createTranscriptSaveHandler,
};
