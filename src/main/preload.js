'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // Modello Whisper
  modelCheck: () => ipcRenderer.invoke('model:check'),
  modelDownload: () => ipcRenderer.send('model:download'),
  onModelProgress: (cb) => ipcRenderer.on('model:download-progress', (_, data) => cb(data)),
  onModelDone: (cb) => ipcRenderer.on('model:download-done', () => cb()),
  onModelError: (cb) => ipcRenderer.on('model:download-error', (_, err) => cb(err)),

  // Registrazione
  recordingSave: (data) => ipcRenderer.invoke('recording:save', data),
  recordingUpdateDuration: (data) => ipcRenderer.invoke('recording:update-duration', data),
  recordingMove: (data) => ipcRenderer.invoke('recording:move', data),
  recordingRename: (data) => ipcRenderer.invoke('recording:rename', data),
  recordingDelete: (data) => ipcRenderer.invoke('recording:delete', data),

  // Trascrizione
  transcriptionStart: (data) => ipcRenderer.send('transcription:start', data),
  transcriptionChunk: (data) => ipcRenderer.invoke('transcription:chunk', data),
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

  // Audio
  audioGetPath: (data) => ipcRenderer.invoke('audio:get-path', data),

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
