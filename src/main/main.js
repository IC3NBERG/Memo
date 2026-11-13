'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { createPathGuard } = require('../core/storage/path-guard');
const { createLogger } = require('../core/diagnostics/logger');
const transcriptStore = require('../core/transcript/store');
const { createModelResolver } = require('../core/asr/models');
const { createSearchService } = require('./search-service');
const { createLibraryService } = require('./library-service');
const { createTranscriptionService } = require('./transcription-service');
const { createUpdateController } = require('./update-service');
const { createLockService } = require('./lock-service');
const { createPrivacyService } = require('./privacy-service');
const { createDiagnosticsService } = require('./diagnostics-service');
const { registerIpcHandlers } = require('./ipc');

// ─── Percorsi principali ───────────────────────────────────────────────────
const OLD_MEMO_DIR = path.join(os.homedir(), 'MemoRecordings');
const RECORDINGS_DIR = process.env.CRUNCH_RECORDINGS_DIR
  ? path.resolve(process.env.CRUNCH_RECORDINGS_DIR)
  : path.join(os.homedir(), 'CrunchRecordings');

// Migra automaticamente dal vecchio nome senza riscaricare il modello.
if (!process.env.CRUNCH_RECORDINGS_DIR
    && fs.existsSync(OLD_MEMO_DIR)
    && !fs.existsSync(RECORDINGS_DIR)) {
  try {
    fs.renameSync(OLD_MEMO_DIR, RECORDINGS_DIR);
  } catch (_) {}
}

const MODELS_DIR = path.join(RECORDINGS_DIR, '.models');
const UNSORTED_DIR = path.join(RECORDINGS_DIR, '_unsorted');
const LOGS_DIR = path.join(RECORDINGS_DIR, '.logs');
const PRIVACY_SETTINGS_PATH = path.join(RECORDINGS_DIR, 'privacy.json');
const LOCK_FILE_PATH = path.join(app.getPath('userData'), 'privacy-lock.json');
const SEARCH_INDEX_PATH = path.join(RECORDINGS_DIR, '.index', 'search.sqlite3');

const logger = createLogger({ dir: LOGS_DIR });

const models = createModelResolver({
  modelsDir: MODELS_DIR,
  legacyModelsDir: path.join(OLD_MEMO_DIR, '.models'),
});

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin';
const TRANSLATION_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin';

function resourcePath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', name)
    : path.join(__dirname, '..', '..', 'bin', name);
}

// ─── Servizi ───────────────────────────────────────────────────────────────
const recordingsPathGuard = createPathGuard(RECORDINGS_DIR);
const search = createSearchService({
  recordingsDir: RECORDINGS_DIR,
  indexPath: SEARCH_INDEX_PATH,
  store: transcriptStore,
  logger,
});
const library = createLibraryService({
  recordingsDir: RECORDINGS_DIR,
  unsortedDir: UNSORTED_DIR,
  pathGuard: recordingsPathGuard,
  search,
});
const transcription = createTranscriptionService({
  models,
  binPath: resourcePath('whisper-cli'),
  serverBinPath: resourcePath('whisper-server'),
  store: transcriptStore,
});
const updates = createUpdateController({
  app,
  shell,
  getWindow: () => mainWindow,
});
const lock = createLockService({ file: LOCK_FILE_PATH, logger });
const privacy = createPrivacyService({
  recordingsDir: RECORDINGS_DIR,
  modelsDir: MODELS_DIR,
  indexPath: SEARCH_INDEX_PATH,
  logsDir: LOGS_DIR,
  privacySettingsPath: PRIVACY_SETTINGS_PATH,
  search,
  logger,
});

let lastIntegrityReport = null;
const diagnostics = createDiagnosticsService({
  app,
  recordingsDir: RECORDINGS_DIR,
  modelsDir: MODELS_DIR,
  indexPath: SEARCH_INDEX_PATH,
  logsDir: LOGS_DIR,
  library,
  search,
  logger,
  privacySettingsPath: PRIVACY_SETTINGS_PATH,
  lockService: lock,
  getLastIntegrityReport: () => lastIntegrityReport,
});

let mainWindow;

// ─── Directory e integrità ────────────────────────────────────────────────
function ensureDirectories() {
  [RECORDINGS_DIR, MODELS_DIR, UNSORTED_DIR, LOGS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  const oldModel = path.join(OLD_MEMO_DIR, '.models', models.transcriptionModel);
  const newModel = path.join(MODELS_DIR, models.transcriptionModel);
  if (fs.existsSync(oldModel) && !fs.existsSync(newModel)) {
    try { fs.copyFileSync(oldModel, newModel); } catch (_) {}
  }
}

function runStartupIntegrityScan() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const result = library.scanAll({ deep: false });
    if (!result.success) throw new Error(result.error);
    const report = result.report;
    lastIntegrityReport = report;
    mainWindow.webContents.send('integrity:startup-report', report);
    if (report.status !== 'ok') {
      logger.warn('integrity.startup-issues', {
        errors: report.summary.errors,
        warnings: report.summary.warnings,
        recordings: report.summary.recordings,
      });
      console.warn(
        `Scansione integrità: ${report.summary.errors} errori, `
        + `${report.summary.warnings} avvisi su ${report.summary.recordings} registrazioni`,
      );
    }
  } catch (err) {
    logger.warn('integrity.startup-failed', { error: err.message });
    console.warn('Scansione integrità non riuscita:', err.message);
  }
}

// ─── Finestra principale ───────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Crunch',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: '#1E1A17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '..', '..', 'assets', 'icons', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Scansione non invasiva dopo il primo paint: non blocca l'apertura.
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(runStartupIntegrityScan, 2500);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── IPC ───────────────────────────────────────────────────────────────────
registerIpcHandlers({
  ipcMain,
  dialog,
  shell,
  clipboard,
  app,
  recordingsDir: RECORDINGS_DIR,
  unsortedDir: UNSORTED_DIR,
  pathGuard: recordingsPathGuard,
  store: transcriptStore,
  search,
  library,
  transcription,
  updates,
  privacy,
  diagnostics,
  lock,
  logger,
  getWindow: () => mainWindow,
  modelsDir: MODELS_DIR,
  legacyModelsDir: path.join(OLD_MEMO_DIR, '.models'),
  transcriptionModelUrl: MODEL_URL,
  translationModelUrl: TRANSLATION_MODEL_URL,
});

// ─── Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensureDirectories();
  logger.info('app.ready', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
  });

  // La retention è una policy esplicita e configurabile: viene applicata
  // all'avvio, ma solo entro le soglie scelte dall'utente (0 = mai).
  try {
    const settings = privacy.getSettings().settings;
    logger.setLevel(settings.diagnostics.level);
    const retention = privacy.applyRetentionNow();
    if (retention?.success && (retention.purgedTrash?.length || retention.trashedRecordings?.length)) {
      logger.info('privacy.retention-startup', {
        purgedTrash: retention.purgedTrash.length,
        trashedRecordings: retention.trashedRecordings.length,
      });
    }
  } catch (err) {
    logger.warn('privacy.retention-startup-failed', { error: err.message });
  }

  // Usato da scripts/smoke-release.sh: verifica il bootstrap reale senza
  // aprire una finestra (utile in CI e sulle build appena firmate).
  if (process.argv.includes('--smoke-test')) {
    process.stdout.write('CRUNCH_SMOKE_OK\n');
    app.quit();
    return;
  }

  createWindow();
  updates.setup();

  // L'indice è ricostruibile: la sincronizzazione parte dopo la finestra.
  setTimeout(() => {
    try { search.sync(); } catch (err) {
      logger.warn('search.sync-failed', { error: err.message });
      console.warn('Sincronizzazione indice fallita:', err.message);
    }
  }, 0);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  logger.info('app.quit');
  transcription.stop();
  search.close();
});

process.on('uncaughtException', (err) => {
  logger.error('process.uncaught-exception', err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandled-rejection', { error: reason instanceof Error ? reason : String(reason) });
});
