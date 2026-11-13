'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // Modello Whisper
  modelCheck: () => ipcRenderer.invoke('model:check'),
  modelDownload: () => ipcRenderer.send('model:download'),
  onModelProgress: (cb) => ipcRenderer.on('model:download-progress', (_, data) => cb(data)),
  onModelDone: (cb) => ipcRenderer.on('model:download-done', () => cb()),
  onModelError: (cb) => ipcRenderer.on('model:download-error', (_, err) => cb(err)),

  // Modello dedicato alla traduzione (dormiente finché non richiesto)
  modelCheckTranslation: () => ipcRenderer.invoke('model:check-translation'),
  modelDownloadTranslation: () => ipcRenderer.send('model:download-translation'),
  onTranslationModelProgress: (cb) => ipcRenderer.on('model:translation-progress', (_, data) => cb(data)),
  onTranslationModelDone: (cb) => ipcRenderer.on('model:translation-done', () => cb()),
  onTranslationModelError: (cb) => ipcRenderer.on('model:translation-error', (_, err) => cb(err)),

  // Registrazione
  recordingSave: (data) => ipcRenderer.invoke('recording:save', data),
  recordingUpdateDuration: (data) => ipcRenderer.invoke('recording:update-duration', data),
  recordingMove: (data) => ipcRenderer.invoke('recording:move', data),
  recordingRename: (data) => ipcRenderer.invoke('recording:rename', data),
  recordingDelete: (data) => ipcRenderer.invoke('recording:delete', data),
  recordingStats: (data) => ipcRenderer.invoke('recording:stats', data),

  // Trascrizione
  transcriptionStart: (data) => ipcRenderer.send('transcription:start', data),
  transcriptionChunk: (data) => ipcRenderer.invoke('transcription:chunk', data),
  transcriptionPrewarm: (data) => ipcRenderer.invoke('transcription:prewarm', data),
  onTranscriptionProgress: (cb) => ipcRenderer.on('transcription:progress', (_, pct) => cb(pct)),
  onTranscriptionDone: (cb) => ipcRenderer.on('transcription:done', (_, transcript) => cb(transcript)),
  onTranscriptionError: (cb) => ipcRenderer.on('transcription:error', (_, err) => cb(err)),

  // Libreria
  libraryGet: () => ipcRenderer.invoke('library:get'),

  // Cartelle / Gruppi
  folderCreate: (data) => ipcRenderer.invoke('folder:create', data),
  folderRename: (data) => ipcRenderer.invoke('folder:rename', data),
  folderDelete: (data) => ipcRenderer.invoke('folder:delete', data),

  // Trascrizioni
  transcriptRead: (data) => ipcRenderer.invoke('transcript:read', data),
  transcriptSave: (data) => ipcRenderer.invoke('transcript:save', data),
  transcriptExport: (data) => ipcRenderer.invoke('transcript:export', data),

  // Revisioni e overlay a blocchi
  revisionList: (data) => ipcRenderer.invoke('revision:list', data),
  revisionSwitch: (data) => ipcRenderer.invoke('revision:switch', data),
  revisionCreateFromText: (data) => ipcRenderer.invoke('revision:create-from-text', data),
  editsSave: (data) => ipcRenderer.invoke('edits:save', data),
  editsReset: (data) => ipcRenderer.invoke('edits:reset', data),

  // Ricerca full-text
  searchQuery: (data) => ipcRenderer.invoke('search:query', data),
  searchFacets: () => ipcRenderer.invoke('search:facets'),
  searchRebuild: () => ipcRenderer.invoke('search:rebuild'),

  // Integrità, manifest e cestino
  integrityScan: (data) => ipcRenderer.invoke('integrity:scan', data),
  integrityScanAll: (data) => ipcRenderer.invoke('integrity:scan-all', data),
  integrityRefresh: (data) => ipcRenderer.invoke('integrity:refresh', data),
  onIntegrityReport: (cb) => ipcRenderer.on('integrity:startup-report', (_, report) => cb(report)),
  trashList: () => ipcRenderer.invoke('trash:list'),
  trashRestore: (data) => ipcRenderer.invoke('trash:restore', data),
  trashPurge: (data) => ipcRenderer.invoke('trash:purge', data),
  trashEmpty: () => ipcRenderer.invoke('trash:empty'),

  // Audio
  audioGetPath: (data) => ipcRenderer.invoke('audio:get-path', data),

  // Privacy operativa
  privacyGetSettings: () => ipcRenderer.invoke('privacy:get-settings'),
  privacyUpdateSettings: (data) => ipcRenderer.invoke('privacy:update-settings', data),
  privacyRetentionPreview: () => ipcRenderer.invoke('privacy:retention-preview'),
  privacyApplyRetention: () => ipcRenderer.invoke('privacy:apply-retention'),
  privacyStats: () => ipcRenderer.invoke('privacy:stats'),
  privacyExportArchive: (data) => ipcRenderer.invoke('privacy:export-archive', data),
  privacyDeleteArchive: (data) => ipcRenderer.invoke('privacy:delete-archive', data),

  // Blocco applicativo
  lockStatus: () => ipcRenderer.invoke('lock:status'),
  lockSetPasscode: (data) => ipcRenderer.invoke('lock:set-passcode', data),
  lockVerify: (data) => ipcRenderer.invoke('lock:verify', data),
  lockDisable: (data) => ipcRenderer.invoke('lock:disable', data),
  lockUpdateOptions: (data) => ipcRenderer.invoke('lock:update-options', data),

  // Diagnostica
  diagnosticsGet: () => ipcRenderer.invoke('diagnostics:get'),
  diagnosticsText: () => ipcRenderer.invoke('diagnostics:text'),
  diagnosticsCopy: () => ipcRenderer.invoke('diagnostics:copy'),
  diagnosticsOpenLogs: () => ipcRenderer.invoke('diagnostics:open-logs'),

  // Auto-Update & Info App
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  restartAndInstall: () => ipcRenderer.invoke('app:restart-and-install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_, data) => cb(data)),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_, data) => cb(data)),

  // Finestra
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowClose: () => ipcRenderer.send('window:close'),
};

contextBridge.exposeInMainWorld('memoAPI', api);
contextBridge.exposeInMainWorld('crunchAPI', api);
