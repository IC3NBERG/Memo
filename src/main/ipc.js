'use strict';

const fs = require('fs');
const path = require('path');

const {
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
} = require('./handlers');
const { createExportService } = require('./export-service');
const { downloadModelFile } = require('../core/models/download');
const { createModelResolver } = require('../core/asr/models');

/**
 * Registra tutti i canali IPC. La logica vive nei servizi; qui restano solo
 * validazione dei confini, traduzione eventi → oggetti e inoltro all'indice.
 */
function registerIpcHandlers({
  ipcMain,
  dialog,
  shell,
  clipboard = null,
  app,
  recordingsDir,
  unsortedDir,
  isPackaged = false,
  pathGuard,
  store,
  search,
  library,
  transcription,
  updates,
  privacy = null,
  diagnostics = null,
  lock = null,
  logger = null,
  getWindow = () => null,
  modelsDir,
  legacyModelsDir = null,
  transcriptionModelUrl,
  translationModelUrl,
} = {}) {
  const models = transcription?.models || createModelResolver({ modelsDir, legacyModelsDir });
  const isValidRecordingDir = (recDir) => pathGuard.isValidRecordingDir(recDir);
  const window = () => getWindow();

  // ─── Applicazione / update ───────────────────────────────────────────────
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:check-for-updates', () => updates.checkForUpdates());
  ipcMain.handle('app:restart-and-install', () => updates.restartAndInstall());

  ipcMain.on('window:minimize', () => window()?.minimize());
  ipcMain.on('window:close', () => window()?.close());

  // ─── Modelli ─────────────────────────────────────────────────────────────
  ipcMain.handle('model:check', () => fs.existsSync(models.modelPath(false)));
  ipcMain.handle('model:check-translation', () => fs.existsSync(models.modelPath(true)));

  ipcMain.on('model:download', (event) => {
    if (fs.existsSync(models.modelPath(false))) {
      event.sender.send('model:download-done');
      return;
    }
    downloadModelFile({
      url: transcriptionModelUrl,
      targetPath: path.join(modelsDir, models.transcriptionModel),
      onProgress: (data) => event.sender.send('model:download-progress', data),
      onDone: () => event.sender.send('model:download-done'),
      onError: (err) => event.sender.send('model:download-error', err),
    });
  });

  ipcMain.on('model:download-translation', (event) => {
    if (fs.existsSync(models.modelPath(true))) {
      event.sender.send('model:translation-done');
      return;
    }
    downloadModelFile({
      url: translationModelUrl,
      targetPath: path.join(modelsDir, models.translationModel),
      onProgress: (data) => event.sender.send('model:translation-progress', data),
      onDone: () => event.sender.send('model:translation-done'),
      onError: (err) => event.sender.send('model:translation-error', err),
    });
  });

  // ─── Registrazioni ───────────────────────────────────────────────────────
  const handleRecordingSave = createRecordingSaveHandler({ recordingsDir, unsortedDir });
  ipcMain.handle('recording:save', async (event, payload) => {
    const result = await handleRecordingSave(payload);
    if (result?.success && result.recDir) search.indexRecording(result.recDir);
    return result;
  });

  ipcMain.handle('recording:update-duration', (event, payload = {}) => library.updateDuration(payload));
  ipcMain.handle('recording:move', (event, payload = {}) => library.moveRecording(payload));
  ipcMain.handle('recording:rename', (event, payload = {}) => library.renameRecording(payload));
  ipcMain.handle('recording:delete', (event, payload = {}) => library.deleteRecording(payload));
  ipcMain.handle('recording:stats', (event, payload = {}) => library.recordingInfo(payload));

  ipcMain.handle('library:get', () => library.buildLibrary());

  // ─── Gruppi ──────────────────────────────────────────────────────────────
  ipcMain.handle('folder:create', (event, payload = {}) => library.createGroup(payload));
  ipcMain.handle('folder:rename', (event, payload = {}) => library.renameGroup(payload));
  ipcMain.handle('folder:delete', (event, payload = {}) => library.deleteGroup(payload));

  // ─── Trascrizione ────────────────────────────────────────────────────────
  ipcMain.on('transcription:start', (event, { audioPath, recDir, language, translate } = {}) => {
    const normalizedRecDir = pathGuard.normalize(recDir);
    const normalizedAudioPath = audioPath ? pathGuard.normalize(audioPath) : null;
    const audioInsideRecDir = normalizedRecDir
      && normalizedAudioPath
      && normalizedAudioPath.startsWith(normalizedRecDir + path.sep);

    if (!isValidRecordingDir(recDir) || !audioInsideRecDir) {
      event.sender.send('transcription:error', 'Percorso audio non valido.');
      return;
    }

    transcription.startFull({
      audioPath,
      recDir,
      language,
      translate: !!translate,
      onProgress: (pct) => event.sender.send('transcription:progress', pct),
      onDone: (payload) => {
        search.indexRecording(recDir);
        event.sender.send('transcription:done', payload);
      },
      onError: (err) => event.sender.send('transcription:error', err),
    });
  });

  ipcMain.handle('transcription:prewarm', (event, payload = {}) => transcription.prewarm(payload));
  ipcMain.handle('transcription:chunk', (event, payload = {}) => transcription.transcribeChunk(payload));

  // ─── Trascrizioni, revisioni, overlay ────────────────────────────────────
  const handleTranscriptRead = createTranscriptReadHandler({ pathGuard, store });
  ipcMain.handle('transcript:read', (event, payload) => {
    const result = handleTranscriptRead(payload);
    if (result.success) search.indexRecording(payload?.recDir);
    return result;
  });

  const handleTranscriptSave = createTranscriptSaveHandler({ pathGuard, store });
  ipcMain.handle('transcript:save', (event, payload) => {
    const result = handleTranscriptSave(payload);
    if (result.success) search.indexRecording(payload?.recDir);
    return result;
  });

  const handleRevisionList = createRevisionListHandler({ pathGuard, store });
  ipcMain.handle('revision:list', (event, payload) => handleRevisionList(payload));

  const handleRevisionSwitch = createRevisionSwitchHandler({ pathGuard, store });
  ipcMain.handle('revision:switch', (event, payload) => {
    const result = handleRevisionSwitch(payload);
    if (result.success) search.indexRecording(payload?.recDir);
    return result;
  });

  const handleRevisionCreate = createRevisionCreateHandler({ pathGuard, store });
  ipcMain.handle('revision:create-from-text', (event, payload) => {
    const result = handleRevisionCreate(payload);
    if (result.success) search.indexRecording(payload?.recDir);
    return result;
  });

  const handleEditsSave = createEditsSaveHandler({ pathGuard, store });
  ipcMain.handle('edits:save', (event, payload) => {
    const result = handleEditsSave(payload);
    if (result.success) search.indexRecording(payload?.recDir);
    return result;
  });

  const handleEditsReset = createEditsResetHandler({ pathGuard, store });
  ipcMain.handle('edits:reset', (event, payload) => {
    const result = handleEditsReset(payload);
    if (result.success && result.changed) search.indexRecording(payload?.recDir);
    return result;
  });

  // ─── Ricerca ─────────────────────────────────────────────────────────────
  const handleSearch = createSearchHandler({ getIndex: search.getIndex });
  ipcMain.handle('search:query', (event, payload) => {
    search.ensureSynced();
    return handleSearch(payload);
  });
  const handleSearchFacets = createSearchFacetsHandler({ getIndex: search.getIndex });
  ipcMain.handle('search:facets', () => {
    search.ensureSynced();
    return handleSearchFacets();
  });
  ipcMain.handle('search:rebuild', () => search.rebuild());

  // ─── Export ──────────────────────────────────────────────────────────────
  const exports = createExportService({
    isValidRecordingDir,
    choosePath: ({ format, defaultName }) => dialog.showSaveDialog(window(), {
      defaultPath: defaultName,
      filters: format === 'md'
        ? [{ name: 'Markdown', extensions: ['md'] }]
        : [{ name: 'Testo', extensions: ['txt'] }],
    }),
    reveal: (filePath) => shell.showItemInFolder(filePath),
  });
  ipcMain.handle('transcript:export', (event, payload = {}) => exports.exportTranscript(payload));

  // ─── Audio ───────────────────────────────────────────────────────────────
  ipcMain.handle('audio:get-path', (event, { recDir } = {}) => {
    if (!isValidRecordingDir(recDir)) {
      return { success: false, error: 'Registrazione non valida' };
    }
    const audioPath = path.join(recDir, 'audio.wav');
    if (fs.existsSync(audioPath)) {
      return { success: true, audioPath: 'file://' + audioPath };
    }
    return { success: false, error: 'File audio non trovato' };
  });

  // ─── Cestino e integrità ─────────────────────────────────────────────────
  ipcMain.handle('trash:list', () => library.trashList());
  ipcMain.handle('trash:restore', (event, payload = {}) => library.trashRestore(payload));
  ipcMain.handle('trash:purge', (event, payload = {}) => library.trashPurge(payload));
  ipcMain.handle('trash:empty', () => library.trashEmpty());

  ipcMain.handle('integrity:scan', (event, payload = {}) => library.scanOne(payload));
  ipcMain.handle('integrity:scan-all', (event, payload = {}) => library.scanAll(payload));
  ipcMain.handle('integrity:refresh', (event, payload = {}) => library.refreshIntegrity(payload));

  // ─── Privacy operativa ───────────────────────────────────────────────────
  if (privacy) {
    ipcMain.handle('privacy:get-settings', () => privacy.getSettings());
    ipcMain.handle('privacy:update-settings', (event, payload = {}) => privacy.updateSettings(payload));
    ipcMain.handle('privacy:retention-preview', () => privacy.retentionPreview());
    ipcMain.handle('privacy:apply-retention', () => privacy.applyRetentionNow());
    ipcMain.handle('privacy:stats', () => privacy.getStats());

    ipcMain.handle('privacy:export-archive', async (event, payload = {}) => {
      const stamp = new Date().toISOString().slice(0, 10);
      const result = await dialog.showSaveDialog(window(), {
        title: 'Esporta archivio Crunch',
        defaultPath: `Crunch-archivio-${stamp}.zip`,
        filters: [{ name: 'Archivio ZIP', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };
      return privacy.exportArchive({
        destination: result.filePath,
        includeModels: payload.includeModels === true,
      });
    });

    ipcMain.handle('privacy:delete-archive', (event, payload = {}) => {
      const result = privacy.deleteArchive({
        confirm: payload.confirm,
        includeModels: payload.includeModels === true,
      });
      if (result.success && logger) logger.warn('privacy.archive-deleted', { removed: result.removed });
      return result;
    });
  }

  // ─── Blocco applicativo (macchine condivise) ─────────────────────────────
  if (lock) {
    ipcMain.handle('lock:status', () => lock.status());
    ipcMain.handle('lock:set-passcode', (event, payload = {}) => lock.setPasscode(payload));
    ipcMain.handle('lock:verify', (event, payload = {}) => lock.verify(payload));
    ipcMain.handle('lock:disable', (event, payload = {}) => lock.disable(payload));
    ipcMain.handle('lock:update-options', (event, payload = {}) => lock.updateOptions(payload));
  }

  // ─── Diagnostica ─────────────────────────────────────────────────────────
  if (diagnostics) {
    ipcMain.handle('diagnostics:get', () => ({ success: true, report: diagnostics.collect() }));
    ipcMain.handle('diagnostics:text', () => ({ success: true, text: diagnostics.buildText() }));
    ipcMain.handle('diagnostics:copy', () => {
      if (!clipboard) return { success: false, error: 'Appunti non disponibili' };
      return diagnostics.copyReport(clipboard);
    });
    ipcMain.handle('diagnostics:open-logs', () => diagnostics.openLogs(shell));
  }

  return { models };
}

module.exports = {
  registerIpcHandlers,
};
