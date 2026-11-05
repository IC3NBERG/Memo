'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const manualUpdater = require('./updater');
const { createPathGuard, isSafeFolderName } = require('../core/storage/path-guard');
const transcriptStore = require('../core/transcript/store');
const { readMetadataFile, updateMetadataFile } = require('../core/library/metadata');
const {
  createRecordingSaveHandler,
  createTranscriptReadHandler,
  createTranscriptSaveHandler,
} = require('./handlers');
const {
  buildWhisperArgs,
  cleanupStaging,
  createWhisperStaging,
  publishWhisperOutput,
  whisperOutputPrefix,
} = require('../core/transcript/whisper');

// ─── Percorsi principali ───────────────────────────────────────────────────
const OLD_MEMO_DIR = path.join(os.homedir(), 'MemoRecordings');
const RECORDINGS_DIR = process.env.CRUNCH_RECORDINGS_DIR
  ? path.resolve(process.env.CRUNCH_RECORDINGS_DIR)
  : path.join(os.homedir(), 'CrunchRecordings');

// Se esiste MemoRecordings ma non ancora CrunchRecordings, migra subito senza riscaricare il modello!
if (!process.env.CRUNCH_RECORDINGS_DIR
    && fs.existsSync(OLD_MEMO_DIR)
    && !fs.existsSync(RECORDINGS_DIR)) {
  try {
    fs.renameSync(OLD_MEMO_DIR, RECORDINGS_DIR);
  } catch (_) {}
}

const MODELS_DIR = path.join(RECORDINGS_DIR, '.models');
const UNSORTED_DIR = path.join(RECORDINGS_DIR, '_unsorted');
const MODEL_FILENAME = 'ggml-large-v3-turbo.bin';

// Modello dedicato alla traduzione verso l'inglese.
// large-v3-turbo non è addestrato al task "translate": per questo la traduzione
// usa un modello separato, scaricato SOLO quando l'utente la richiede davvero.
const TRANSLATION_MODEL_FILENAME = 'ggml-medium.bin';

function getModelPath() {
  const primary = path.join(MODELS_DIR, MODEL_FILENAME);
  if (fs.existsSync(primary)) return primary;
  const fallbackOld = path.join(OLD_MEMO_DIR, '.models', MODEL_FILENAME);
  if (fs.existsSync(fallbackOld)) return fallbackOld;
  return primary;
}

function getTranslationModelPath() {
  const primary = path.join(MODELS_DIR, TRANSLATION_MODEL_FILENAME);
  if (fs.existsSync(primary)) return primary;
  const fallbackOld = path.join(OLD_MEMO_DIR, '.models', TRANSLATION_MODEL_FILENAME);
  if (fs.existsSync(fallbackOld)) return fallbackOld;
  return primary;
}

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin';
const TRANSLATION_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin';

// Percorso al binario whisper-cli (dentro l'app oppure nella dir di sviluppo)
function getWhisperBinPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'whisper-cli');
  }
  return path.join(__dirname, '..', '..', 'bin', 'whisper-cli');
}

// Motore live persistente: whisper-server tiene il modello caricato in memoria
// tra un chunk e l'altro, eliminando ~1,5 s di reload per ogni intervallo.
function getWhisperServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'whisper-server');
  }
  return path.join(__dirname, '..', '..', 'bin', 'whisper-server');
}

// ─── Validazione percorsi IPC ──────────────────────────────────────────────
// Il renderer non deve poter leggere/scrivere/eliminare percorsi arbitrari.
const recordingsPathGuard = createPathGuard(RECORDINGS_DIR);

function isValidRecordingDir(recDir) {
  return recordingsPathGuard.isValidRecordingDir(recDir);
}

// ─── Crea directory necessarie ─────────────────────────────────────────────
function ensureDirectories() {
  [RECORDINGS_DIR, MODELS_DIR, UNSORTED_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Se il modello è rimasto nel vecchio percorso, copialo o linkalo nel nuovo
  const oldModel = path.join(OLD_MEMO_DIR, '.models', MODEL_FILENAME);
  const newModel = path.join(MODELS_DIR, MODEL_FILENAME);
  if (fs.existsSync(oldModel) && !fs.existsSync(newModel)) {
    try {
      fs.copyFileSync(oldModel, newModel);
    } catch (_) {}
  }
}

// ─── Finestra principale ───────────────────────────────────────────────────
let mainWindow;

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

  mainWindow.loadFile(path.join(__dirname, '..', rendererPath()));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function rendererPath() {
  return path.join('renderer', 'index.html');
}

// ─── Auto-Updater ──────────────────────────────────────────────────────────
// Su macOS Squirrel.Mac accetta solo aggiornamenti firmati con lo stesso
// Developer ID dell'app in esecuzione. Per le build ad-hoc usiamo un download
// e un'installazione interna (ZIP + SHA-512 + sostituzione con backup).
let manualUpdate = null;          // { version, file }
let manualDownloadVersion = null; // versione attualmente in download
let usesManualUpdater = false;

function sendUpdateStatus(payload) {
  mainWindow?.webContents.send('update:status', payload);
}

function sendUpdateProgress(payload) {
  mainWindow?.webContents.send('update:progress', payload);
}

function setupAutoUpdater() {
  const bundlePath = manualUpdater.getAppBundlePath(app.getPath('exe'));
  usesManualUpdater = !manualUpdater.isDeveloperIdSigned(bundlePath);

  autoUpdater.autoDownload = !usesManualUpdater;
  autoUpdater.autoInstallOnAppQuit = !usesManualUpdater;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({
      type: 'checking',
      message: 'Verifica aggiornamenti...'
    });
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus({
      type: 'available',
      version: info.version,
      message: `Trovata nuova versione v${info.version}. Download in corso...`
    });
    if (usesManualUpdater) {
      startManualUpdateDownload(info);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdateStatus({
      type: 'not-available',
      version: info?.version || app.getVersion(),
      message: 'Crunch è già aggiornato all\'ultima versione.'
    });
  });

  autoUpdater.on('error', (err) => {
    sendUpdateStatus({
      type: 'error',
      message: err ? (err.message || String(err)) : 'Errore durante la ricerca aggiornamenti'
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    sendUpdateProgress({
      percent: Math.round(progressObj.percent || 0),
      transferred: progressObj.transferred,
      total: progressObj.total
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({
      type: 'downloaded',
      version: info.version,
      message: `Versione v${info.version} scaricata e pronta. Clicca per riavviare.`
    });
  });

  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 4000);

    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 3 * 60 * 60 * 1000);
  }
}

async function startManualUpdateDownload(info) {
  if (manualUpdate && manualUpdate.version === info.version && fs.existsSync(manualUpdate.file)) {
    sendUpdateStatus({
      type: 'downloaded',
      version: manualUpdate.version,
      message: `Versione v${manualUpdate.version} già scaricata e pronta. Clicca per riavviare.`
    });
    return;
  }

  if (manualDownloadVersion === info.version) return;

  const files = Array.isArray(info.files) ? info.files : [];
  const zipFile = files.find((file) => typeof file.url === 'string' && /\.zip($|\?)/i.test(file.url));
  if (!zipFile) {
    sendUpdateStatus({
      type: 'error',
      message: 'La release non contiene un pacchetto ZIP aggiornabile.'
    });
    return;
  }

  const fileName = path.basename(decodeURIComponent(zipFile.url.split('?')[0]));
  const dest = path.join(app.getPath('userData'), 'updates', fileName);
  const url = /^https?:\/\//i.test(zipFile.url)
    ? zipFile.url
    : `https://github.com/IC3NBERG/Memo/releases/download/v${info.version}/${encodeURIComponent(fileName)}`;

  manualDownloadVersion = info.version;

  try {
    if (!(await manualUpdater.fileMatchesSha512(dest, zipFile.sha512))) {
      await manualUpdater.downloadFile({
        url,
        dest,
        sha512: zipFile.sha512,
        onProgress: (progress) => sendUpdateProgress(progress),
      });
    }

    manualUpdate = { version: info.version, file: dest };
    sendUpdateStatus({
      type: 'downloaded',
      version: info.version,
      message: `Versione v${info.version} scaricata e pronta. Clicca per riavviare.`
    });
  } catch (err) {
    sendUpdateStatus({
      type: 'error',
      message: `Download aggiornamento fallito: ${err.message}`
    });
  } finally {
    manualDownloadVersion = null;
  }
}

ipcMain.handle('app:check-for-updates', async () => {
  if (!app.isPackaged) {
    return { success: false, message: 'Aggiornamenti automatici attivi nell\'app installata (Release).' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:restart-and-install', async () => {
  if (!usesManualUpdater) {
    autoUpdater.quitAndInstall();
    return { success: true };
  }

  if (!manualUpdate || !fs.existsSync(manualUpdate.file)) {
    shell.openExternal(manualUpdater.RELEASES_URL);
    return {
      success: false,
      action: 'open-release',
      error: 'Aggiornamento non ancora scaricato: ho aperto la pagina della release.',
    };
  }

  const bundlePath = manualUpdater.getAppBundlePath(app.getPath('exe'));
  if (!bundlePath) {
    return { success: false, error: 'Percorso dell\'app non riconosciuto.' };
  }

  try {
    const logPath = path.join(app.getPath('logs'), 'updater.log');
    const result = manualUpdater.installUpdate({
      zipPath: manualUpdate.file,
      expectedVersion: manualUpdate.version,
      appBundlePath: bundlePath,
      currentPid: process.pid,
      logPath,
      launch: true,
    });

    setTimeout(() => app.quit(), 400);
    return { success: true, logPath: result.logPath, backupPath: result.backupPath };
  } catch (err) {
    return {
      success: false,
      error: `Impossibile avviare l'aggiornamento: ${err.message}`,
    };
  }
});

ipcMain.handle('app:get-version', () => {
  return app.getVersion();
});

// ─── Lifecycle App ─────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensureDirectories();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: Stato modelli ────────────────────────────────────────────────────
ipcMain.handle('model:check', () => {
  return fs.existsSync(getModelPath());
});

ipcMain.handle('model:check-translation', () => {
  return fs.existsSync(getTranslationModelPath());
});

// ─── Download modello generico (riutilizzato per trascrizione e traduzione) ─
const activeModelDownloads = new Set();

function downloadModelFile({ url, targetPath, onProgress, onDone, onError }) {
  // Evita download concorrenti dello stesso modello (stesso file temporaneo).
  if (activeModelDownloads.has(targetPath)) return;
  activeModelDownloads.add(targetPath);

  const tmpPath = targetPath + '.tmp';
  const finish = (cb) => {
    activeModelDownloads.delete(targetPath);
    cb();
  };
  const fail = (message) => finish(() => onError(message));
  const succeed = () => finish(onDone);

  function startDownload(currentUrl, redirectCount = 0) {
    if (redirectCount > 10) {
      fail('Troppi redirect');
      return;
    }

    const proto = currentUrl.startsWith('https') ? https : http;

    const req = proto.get(currentUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        const location = res.headers['location'];
        res.destroy();
        startDownload(location, redirectCount + 1);
        return;
      }

      if (res.statusCode !== 200) {
        fail(`HTTP ${res.statusCode}`);
        return;
      }

      const totalSize = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;

      const file = fs.createWriteStream(tmpPath);
      res.pipe(file);

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (totalSize > 0) {
          const pct = Math.round((downloaded / totalSize) * 100);
          onProgress({ downloaded, total: totalSize, percent: pct });
        }
      });

      file.on('finish', () => {
        file.close(() => {
          try {
            fs.renameSync(tmpPath, targetPath);
            succeed();
          } catch (e) {
            fail(e.message);
          }
        });
      });

      file.on('error', (err) => {
        fs.unlink(tmpPath, () => {});
        fail(err.message);
      });
    });

    req.on('error', (err) => {
      fail(err.message);
    });
  }

  startDownload(url);
}

// ─── IPC: Download modello trascrizione ────────────────────────────────────
ipcMain.on('model:download', (event) => {
  const targetPath = path.join(MODELS_DIR, MODEL_FILENAME);
  if (fs.existsSync(getModelPath())) {
    event.sender.send('model:download-done');
    return;
  }

  downloadModelFile({
    url: MODEL_URL,
    targetPath,
    onProgress: (data) => event.sender.send('model:download-progress', data),
    onDone: () => event.sender.send('model:download-done'),
    onError: (err) => event.sender.send('model:download-error', err),
  });
});

// ─── IPC: Download modello traduzione (solo su richiesta esplicita) ────────
ipcMain.on('model:download-translation', (event) => {
  const targetPath = path.join(MODELS_DIR, TRANSLATION_MODEL_FILENAME);
  if (fs.existsSync(getTranslationModelPath())) {
    event.sender.send('model:translation-done');
    return;
  }

  downloadModelFile({
    url: TRANSLATION_MODEL_URL,
    targetPath,
    onProgress: (data) => event.sender.send('model:translation-progress', data),
    onDone: () => event.sender.send('model:translation-done'),
    onError: (err) => event.sender.send('model:translation-error', err),
  });
});

// ─── IPC: Salva audio WAV (Anti-sovrascrittura garantita) ───────────────────
const handleRecordingSave = createRecordingSaveHandler({
  recordingsDir: RECORDINGS_DIR,
  unsortedDir: UNSORTED_DIR,
});

ipcMain.handle('recording:save', async (event, payload) => handleRecordingSave(payload));

// ─── IPC: Aggiorna durata registrazione ───────────────────────────────────
ipcMain.handle('recording:update-duration', (event, { recDir, duration }) => {
  try {
    if (!isValidRecordingDir(recDir)) {
      return { success: false, error: 'Registrazione non valida' };
    }
    updateMetadataFile(recDir, (meta) => ({ ...meta, duration }));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Trascrizione Integrale Completa & Traduzione ──────────────────────
let activeTranscription = null;

ipcMain.on('transcription:start', (event, { audioPath, recDir, language, translate }) => {
  if (activeTranscription) {
    event.sender.send('transcription:error', 'Una trascrizione è già in corso. Attendi che termini.');
    return;
  }

  const normalizedRecDir = recordingsPathGuard.normalize(recDir);
  const normalizedAudioPath = audioPath ? recordingsPathGuard.normalize(audioPath) : null;
  const audioInsideRecDir = normalizedRecDir
    && normalizedAudioPath
    && normalizedAudioPath.startsWith(normalizedRecDir + path.sep);

  if (!isValidRecordingDir(recDir) || !audioInsideRecDir) {
    event.sender.send('transcription:error', 'Percorso audio non valido.');
    return;
  }

  const isTranslate = !!translate;

  // La traduzione richiede un modello dedicato: large-v3-turbo non esegue
  // il task "translate". Il modello viene usato solo se già scaricato.
  const currentModelPath = isTranslate ? getTranslationModelPath() : getModelPath();
  if (!fs.existsSync(currentModelPath)) {
    event.sender.send('transcription:error', {
      code: isTranslate ? 'translation-model-missing' : 'model-missing',
      message: isTranslate
        ? 'Modello di traduzione non trovato. Scaricalo per tradurre in inglese.'
        : 'Modello Whisper non trovato in ~/CrunchRecordings/.models.',
    });
    return;
  }

  const whisperBin = getWhisperBinPath();
  if (!fs.existsSync(whisperBin)) {
    event.sender.send('transcription:error', 'Motore whisper-cli non trovato.');
    return;
  }

  // Whisper lavora in una staging nella stessa filesystem della registrazione:
  // il rename verso .revisions/rN/ è atomico e non lascia output parziali.
  let stagingDir;
  try {
    stagingDir = createWhisperStaging(recDir);
  } catch (err) {
    event.sender.send('transcription:error', err.message);
    return;
  }
  const outputPrefix = whisperOutputPrefix(stagingDir);

  const cleanupStagingDir = () => cleanupStaging(stagingDir);

  const args = buildWhisperArgs({
    modelPath: currentModelPath,
    outputPrefix,
    audioPath,
    language,
    translate: isTranslate,
  });

  let proc;
  try {
    proc = spawn(whisperBin, args);
  } catch (err) {
    cleanupStagingDir();
    event.sender.send('transcription:error', err.message);
    return;
  }
  activeTranscription = proc;

  const handleOutput = (data) => {
    const line = data.toString();
    const match = line.match(/(?:progress\s*=\s*|(\d+)%)/i);
    if (match) {
      const pctMatch = line.match(/(\d+)%/);
      if (pctMatch) {
        const pct = parseInt(pctMatch[1], 10);
        if (!isNaN(pct)) {
          event.sender.send('transcription:progress', pct);
        }
      }
    }
  };

  proc.stderr.on('data', handleOutput);
  proc.stdout.on('data', handleOutput);

  proc.on('close', (code) => {
    activeTranscription = null;
    if (code !== 0) {
      cleanupStagingDir();
      event.sender.send('transcription:error', `whisper-cli terminato con errore (codice ${code})`);
      return;
    }

    try {
      const result = publishWhisperOutput(recDir, stagingDir, {
        model: path.basename(currentModelPath),
        language,
        translate: isTranslate,
        store: transcriptStore,
      });

      cleanupStagingDir();

      if (!result.success) {
        event.sender.send('transcription:error', result.error || 'Trascrizione vuota');
        return;
      }

      event.sender.send('transcription:done', {
        recDir,
        transcript: result.transcript,
        translate: !!translate,
      });
    } catch (err) {
      cleanupStagingDir();
      event.sender.send('transcription:error', err.message);
    }
  });

  proc.on('error', (err) => {
    activeTranscription = null;
    cleanupStagingDir();
    event.sender.send('transcription:error', err.message);
  });
});

// ─── Motore live persistente (whisper-server) ──────────────────────────────
let whisperServer = null;        // { proc, port, modelPath }
let whisperServerStarting = null;
let whisperServerIdleTimer = null;
let whisperServerDisabledUntil = 0;

function stopWhisperServer() {
  if (whisperServerIdleTimer) {
    clearTimeout(whisperServerIdleTimer);
    whisperServerIdleTimer = null;
  }
  if (!whisperServer) return;
  const proc = whisperServer.proc;
  whisperServer = null;
  try { proc.kill('SIGTERM'); } catch (_) {}
}

function scheduleWhisperServerIdleStop() {
  if (whisperServerIdleTimer) clearTimeout(whisperServerIdleTimer);
  whisperServerIdleTimer = setTimeout(() => stopWhisperServer(), 5 * 60 * 1000);
  if (whisperServerIdleTimer.unref) whisperServerIdleTimer.unref();
}

async function waitForWhisperServer(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' });
      if (res.ok || res.status === 404) return true;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function ensureWhisperServer(modelPath) {
  if (Date.now() < whisperServerDisabledUntil) return null;

  if (whisperServer && whisperServer.modelPath === modelPath) {
    scheduleWhisperServerIdleStop();
    return whisperServer;
  }

  if (whisperServerStarting) {
    const started = await whisperServerStarting;
    if (started && started.modelPath === modelPath) return started;
  }

  stopWhisperServer();

  const serverBin = getWhisperServerPath();
  if (!fs.existsSync(serverBin)) return null;

  const port = 18000 + Math.floor(Math.random() * 2000);
  const proc = spawn(serverBin, [
    '--model', modelPath,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--threads', '4',
    '--beam-size', '5',
    '--suppress-nst',
    '--no-speech-thold', '0.6',
    '--language', 'auto',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  const entry = { proc, port, modelPath };
  whisperServerStarting = (async () => {
    const ready = await waitForWhisperServer(port);
    if (!ready) {
      // Se il server non parte, usa la CLI per i prossimi 60 s senza riprovare.
      whisperServerDisabledUntil = Date.now() + 60000;
      try { proc.kill('SIGTERM'); } catch (_) {}
      return null;
    }
    whisperServer = entry;
    proc.on('exit', () => {
      if (whisperServer === entry) whisperServer = null;
    });
    scheduleWhisperServerIdleStop();
    return entry;
  })();

  const started = await whisperServerStarting;
  whisperServerStarting = null;
  return started;
}

function wordsFromSegments(segments) {
  const words = [];
  for (const seg of segments || []) {
    const segStart = Number(seg.start || 0);
    const segEnd = Number(seg.end || 0);
    const tokens = Array.isArray(seg.words) && seg.words.length
      ? seg.words
      : [{ word: seg.text, start: segStart, end: segEnd }];

    // Il server restituisce token/sottoparole: vanno ricomposti in parole
    // usando lo spazio iniziale come confine ("g" + "atto" → "gatto").
    let current = null;
    for (const token of tokens) {
      const raw = String(token.word ?? token.text ?? '');
      if (!raw) continue;
      const start = Number(token.start ?? segStart);
      const end = Number(token.end ?? segEnd);
      const leadingSpace = /^\s/.test(raw);
      const text = raw.replace(/^\s+/, '');
      if (!text || /^\[_[^\]]*\]$/.test(text)) continue;

      if (leadingSpace || !current) {
        if (current) words.push(current);
        current = { start, end, text };
      } else {
        current.text += text;
        current.end = end;
      }
    }
    if (current) words.push(current);
  }
  return words;
}

async function transcribeChunkWithServer(entry, buffer, { language, translate, prompt }) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/wav' }), 'chunk.wav');
  form.append('response_format', 'verbose_json');
  form.append('language', language || 'auto');
  form.append('translate', translate ? 'true' : 'false');
  form.append('token_timestamps', 'true');
  form.append('suppress_nst', 'true');
  form.append('no_speech_thold', '0.6');
  if (prompt) form.append('prompt', prompt);

  const res = await fetch(`http://127.0.0.1:${entry.port}/inference`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`whisper-server HTTP ${res.status}`);
  const data = await res.json();

  const segments = (data.segments || []).map((seg) => ({
    start: Number(seg.start || 0),
    end: Number(seg.end || 0),
    text: String(seg.text || '').trim(),
    words: wordsFromSegments([seg]),
  }));

  return {
    text: String(data.text || '').trim(),
    language: data.language || data.detected_language || null,
    segments,
  };
}

// Converte i token di whisper-cli (--output-json-full) in parole con timestamp.
function wordsFromCliTokens(tokens, segStart, segEnd) {
  const words = [];
  let current = null;

  for (const token of tokens || []) {
    const raw = String(token.text ?? '');
    if (!raw) continue;
    const start = token.offsets ? Number(token.offsets.from) / 1000 : segStart;
    const end = token.offsets ? Number(token.offsets.to) / 1000 : segEnd;
    const leadingSpace = /^\s/.test(raw);
    const text = raw.replace(/^\s+/, '');
    // I token speciali di whisper.cpp ([_BEG_], [_TT_...]) non sono parlato.
    if (!text || /^\[_[^\]]*\]$/.test(text)) continue;

    if (leadingSpace || !current) {
      if (current) words.push(current);
      current = { start, end, text };
    } else {
      current.text += text;
      current.end = end;
    }
  }
  if (current) words.push(current);
  return words;
}

function parseCliChunkJson(raw) {
  const segments = [];
  for (const seg of raw.transcription || []) {
    const start = seg.offsets ? Number(seg.offsets.from) / 1000 : 0;
    const end = seg.offsets ? Number(seg.offsets.to) / 1000 : 0;
    const text = String(seg.text || '')
      .replace(/\[_[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = wordsFromCliTokens(seg.tokens, start, end);
    segments.push({
      start,
      end,
      text,
      words: words.length ? words : [{ start, end, text }],
    });
  }
  return {
    language: raw.result?.language || null,
    segments,
  };
}

function transcribeChunkWithCli(buffer, { language, translate, prompt }) {
  const whisperBin = getWhisperBinPath();
  if (!fs.existsSync(whisperBin)) return null;

  const modelPath = translate ? getTranslationModelPath() : getModelPath();
  const tmpId = Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const tmpWav = path.join(os.tmpdir(), `crunch_chunk_${tmpId}.wav`);
  const tmpOut = path.join(os.tmpdir(), `crunch_chunk_out_${tmpId}`);

  fs.writeFileSync(tmpWav, Buffer.from(buffer));

  const args = [
    '--model', modelPath,
    '--output-json-full',
    '--output-file', tmpOut,
    '--file', tmpWav,
    '--threads', '4',
    '--language', language || 'auto',
    '--suppress-nst',
    '--no-speech-thold', '0.6',
    '--beam-size', '5',
    '--no-prints',
  ];

  if (prompt) args.push('--prompt', prompt, '--carry-initial-prompt');
  if (translate) args.push('--translate');

  return new Promise((resolve) => {
    const proc = spawn(whisperBin, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const cleanup = () => {
      try { if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav); } catch (_) {}
      try { if (fs.existsSync(tmpOut + '.json')) fs.unlinkSync(tmpOut + '.json'); } catch (_) {}
    };

    proc.on('close', (code) => {
      try {
        if (code !== 0) {
          cleanup();
          resolve({ success: false, error: `whisper exit code ${code}: ${stderr.slice(-200)}` });
          return;
        }
        const jsonFile = tmpOut + '.json';
        if (!fs.existsSync(jsonFile)) {
          cleanup();
          resolve({ success: false, error: 'Risposta whisper-cli priva di JSON' });
          return;
        }
        const raw = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        const parsed = parseCliChunkJson(raw);
        cleanup();
        resolve({
          success: true,
          engine: 'cli',
          text: parsed.segments.map((s) => s.text).join(' ').trim(),
          language: parsed.language,
          segments: parsed.segments,
        });
      } catch (err) {
        cleanup();
        resolve({ success: false, error: err.message });
      }
    });

    proc.on('error', (err) => {
      cleanup();
      resolve({ success: false, error: err.message });
    });
  });
}

// ─── IPC: Trascrizione Chunk Live (Ultra-rapida Metal) ──────────────────────
ipcMain.handle('transcription:prewarm', async (event, { translate } = {}) => {
  const isTranslate = !!translate;
  const modelPath = isTranslate ? getTranslationModelPath() : getModelPath();
  if (!fs.existsSync(modelPath)) {
    return { success: false, code: isTranslate ? 'translation-model-missing' : 'model-missing' };
  }
  const server = await ensureWhisperServer(modelPath);
  return { success: !!server, engine: server ? 'server' : 'cli' };
});

ipcMain.handle('transcription:chunk', async (event, { buffer, language, translate, prompt }) => {
  const isTranslate = !!translate;
  const currentModelPath = isTranslate ? getTranslationModelPath() : getModelPath();
  if (!fs.existsSync(currentModelPath)) {
    return {
      success: false,
      code: isTranslate ? 'translation-model-missing' : 'model-missing',
      error: isTranslate ? 'Modello di traduzione non pronto' : 'Modello non pronto',
    };
  }

  // Preferisce il server persistente: modello già caldo, latenza più bassa.
  const server = await ensureWhisperServer(currentModelPath);
  if (server) {
    try {
      const result = await transcribeChunkWithServer(server, Buffer.from(buffer), {
        language,
        translate: isTranslate,
        prompt,
      });
      return { success: true, engine: 'server', ...result };
    } catch (err) {
      // Il server è caduto o ha risposto male: lo fermiamo e ripieghiamo sulla CLI.
      stopWhisperServer();
      whisperServerDisabledUntil = Date.now() + 60000;
    }
  }

  const fallback = transcribeChunkWithCli(buffer, { language, translate: isTranslate, prompt });
  if (!fallback) return { success: false, error: 'whisper-cli non trovato' };
  return fallback;
});

// Libera la memoria del modello live quando l'app si chiude.
app.on('before-quit', () => stopWhisperServer());

// ─── IPC: Libreria ─────────────────────────────────────────────────────────
ipcMain.handle('library:get', () => {
  return buildLibrary();
});

function buildLibrary() {
  const library = { folders: [], unsorted: [] };

  if (!fs.existsSync(RECORDINGS_DIR)) return library;

  const entries = fs.readdirSync(RECORDINGS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    if (entry.name === '_unsorted') {
      library.unsorted = getRecordingsInDir(UNSORTED_DIR, null);
    } else {
      const folderPath = path.join(RECORDINGS_DIR, entry.name);
      library.folders.push({
        name: entry.name,
        path: folderPath,
        recordings: getRecordingsInDir(folderPath, entry.name),
      });
    }
  }

  return library;
}

function getRecordingsInDir(dir, folderName) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const recDir = path.join(dir, e.name);
      const parsed = readMetadataFile(recDir);
      const meta = parsed || { name: e.name, date: null, duration: 0, hasTranscript: false };

      // Testo della trascrizione per la ricerca full-text nella sidebar
      let searchText = '';
      const txtPath = path.join(recDir, 'transcript.txt');
      if (fs.existsSync(txtPath)) {
        try { searchText = fs.readFileSync(txtPath, 'utf8'); } catch (_) {}
      }

      // Recupera anche le anteprime live salvate prima dell'allineamento
      // dei flag nel metadata
      if (searchText && !meta.hasTranscript) {
        meta.hasTranscript = true;
      }

      return {
        ...meta,
        id: recDir,
        dirName: e.name,
        recDir,
        audioPath: path.join(recDir, 'audio.wav'),
        // La posizione reale sul filesystem è la fonte di verità, non il metadata
        folder: folderName,
        searchText,
      };
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// Aggiorna il campo folder del metadata dopo uno spostamento/rinomina
function updateMetadataFolder(recDir, folder) {
  updateMetadataFile(recDir, (meta) => ({ ...meta, folder }));
}

// Restituisce un percorso libero, evitando di sovrascrivere cartelle esistenti
function uniqueDestinationPath(baseDir, dirName) {
  let candidate = path.join(baseDir, dirName);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(baseDir, `${dirName}_${counter}`);
    counter++;
  }
  return candidate;
}

// ─── IPC: Crea cartella ────────────────────────────────────────────────────
ipcMain.handle('folder:create', (event, { name }) => {
  try {
    const safeName = name.replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').trim();
    if (!isSafeFolderName(safeName) || safeName === '_unsorted') {
      return { success: false, error: 'Nome non valido' };
    }
    const folderPath = path.join(RECORDINGS_DIR, safeName);
    if (fs.existsSync(folderPath)) return { success: false, error: 'Gruppo già esistente' };
    fs.mkdirSync(folderPath, { recursive: true });
    return { success: true, name: safeName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Rinomina cartella ────────────────────────────────────────────────
ipcMain.handle('folder:rename', (event, { oldName, newName }) => {
  try {
    const safeName = newName.replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').trim();
    if (!isSafeFolderName(safeName) || safeName === '_unsorted') {
      return { success: false, error: 'Nome non valido' };
    }
    if (!isSafeFolderName(oldName) || oldName === '_unsorted') {
      return { success: false, error: 'Gruppo non valido' };
    }
    const oldPath = path.join(RECORDINGS_DIR, oldName);
    const newPath = path.join(RECORDINGS_DIR, safeName);
    if (!fs.existsSync(oldPath)) return { success: false, error: 'Gruppo non trovato' };
    if (fs.existsSync(newPath)) return { success: false, error: 'Nome già in uso' };
    fs.renameSync(oldPath, newPath);

    // Allinea il metadata dei file alla nuova posizione
    for (const rec of getRecordingsInDir(newPath, safeName)) {
      updateMetadataFolder(rec.recDir, safeName);
    }

    return { success: true, name: safeName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Elimina cartella ─────────────────────────────────────────────────
ipcMain.handle('folder:delete', (event, { name }) => {
  try {
    if (!isSafeFolderName(name) || name === '_unsorted') {
      return { success: false, error: 'Gruppo non valido' };
    }
    const folderPath = path.join(RECORDINGS_DIR, name);
    if (!fs.existsSync(folderPath)) return { success: false, error: 'Gruppo non trovato' };

    // Verifica PRIMA di spostare: se ci sono file non gestiti ci fermiamo,
    // così il gruppo resta intatto e l'utente può controllarlo.
    const unmanaged = fs.readdirSync(folderPath, { withFileTypes: true })
      .filter(e => !e.isDirectory() && e.name !== '.DS_Store');
    if (unmanaged.length > 0) {
      return {
        success: false,
        error: 'Il gruppo contiene file non gestiti: nessuna registrazione è stata spostata.',
      };
    }

    // Sposta tutte le registrazioni in _unsorted, senza mai sovrascrivere
    const recordings = getRecordingsInDir(folderPath, name);
    for (const rec of recordings) {
      const dest = uniqueDestinationPath(UNSORTED_DIR, rec.dirName);
      fs.renameSync(rec.recDir, dest);
      updateMetadataFolder(dest, null);
    }

    // Elimina il gruppo solo se è rimasto vuoto (a parte .DS_Store).
    // In caso di file non previsti non cancelliamo nulla: meglio un gruppo
    // vuoto che perdere registrazioni.
    const leftovers = fs.readdirSync(folderPath).filter(n => n !== '.DS_Store');
    if (leftovers.length > 0) {
      return {
        success: false,
        error: 'Il gruppo contiene file non gestiti: nessun file è stato eliminato.',
      };
    }

    const dsStore = path.join(folderPath, '.DS_Store');
    if (fs.existsSync(dsStore)) fs.unlinkSync(dsStore);
    fs.rmdirSync(folderPath);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Sposta registrazione ─────────────────────────────────────────────
ipcMain.handle('recording:move', (event, { recDir, targetFolder }) => {
  try {
    if (!isValidRecordingDir(recDir)) {
      return { success: false, error: 'Registrazione non valida' };
    }
    if (targetFolder && !isSafeFolderName(targetFolder)) {
      return { success: false, error: 'Gruppo non valido' };
    }
    const dirName = path.basename(recDir);
    const destBase = targetFolder ? path.join(RECORDINGS_DIR, targetFolder) : UNSORTED_DIR;

    if (!fs.existsSync(destBase)) fs.mkdirSync(destBase, { recursive: true });

    // Spostamento nella stessa posizione: evita di creare un duplicato "_1"
    let destPath = path.join(destBase, dirName);
    if (path.resolve(destPath) !== path.resolve(recDir)) {
      destPath = uniqueDestinationPath(destBase, dirName);
      fs.renameSync(recDir, destPath);
    }
    const metaPath = path.join(destPath, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      updateMetadataFile(destPath, (meta) => ({ ...meta, folder: targetFolder || null }));
    }

    return { success: true, newPath: destPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Rinomina registrazione ───────────────────────────────────────────
ipcMain.handle('recording:rename', (event, { recDir, newName }) => {
  try {
    if (!isValidRecordingDir(recDir)) {
      return { success: false, error: 'Registrazione non valida' };
    }
    const safeName = newName.replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').trim();
    if (!safeName) return { success: false, error: 'Nome non valido' };
    updateMetadataFile(recDir, (meta) => ({ ...meta, name: safeName }));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Elimina registrazione ────────────────────────────────────────────
ipcMain.handle('recording:delete', (event, { recDir }) => {
  try {
    if (!isValidRecordingDir(recDir)) {
      return { success: false, error: 'Registrazione non valida' };
    }
    fs.rmSync(recDir, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Leggi trascrizione ───────────────────────────────────────────────
const handleTranscriptRead = createTranscriptReadHandler({
  pathGuard: recordingsPathGuard,
  store: transcriptStore,
});
ipcMain.handle('transcript:read', (event, payload) => handleTranscriptRead(payload));

// ─── IPC: Salva trascrizione editata ──────────────────────────────────────
const handleTranscriptSave = createTranscriptSaveHandler({
  pathGuard: recordingsPathGuard,
  store: transcriptStore,
});
ipcMain.handle('transcript:save', (event, payload) => handleTranscriptSave(payload));

// ─── IPC: Export ──────────────────────────────────────────────────────────
ipcMain.handle('transcript:export', async (event, { recDir, format, text }) => {
  try {
    if (!isValidRecordingDir(recDir)) {
      return { success: false, error: 'Registrazione non valida' };
    }
    const meta = readMetadataFile(recDir) || {};
    const ext = format === 'md' ? '.md' : '.txt';
    const defaultName = `${meta.name || 'trascrizione'}${ext}`;

    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: format === 'md'
        ? [{ name: 'Markdown', extensions: ['md'] }]
        : [{ name: 'Testo', extensions: ['txt'] }],
    });

    if (canceled || !filePath) return { success: false };

    let content = text;
    if (format === 'md') {
      content = `# ${meta.name || 'Trascrizione'}\n\n_Registrato il ${meta.date ? new Date(meta.date).toLocaleDateString('it-IT') : 'N/A'}_\n\n---\n\n${text}`;
    }

    fs.writeFileSync(filePath, content, 'utf8');
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Ottieni percorso audio (per riproduzione) ───────────────────────
ipcMain.handle('audio:get-path', (event, { recDir }) => {
  if (!isValidRecordingDir(recDir)) {
    return { success: false, error: 'Registrazione non valida' };
  }
  const audioPath = path.join(recDir, 'audio.wav');
  if (fs.existsSync(audioPath)) {
    return { success: true, audioPath: 'file://' + audioPath };
  }
  return { success: false, error: 'File audio non trovato' };
});

// ─── IPC: Finestra minima ─────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());
