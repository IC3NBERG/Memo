'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

// ─── Percorsi principali ───────────────────────────────────────────────────
const OLD_MEMO_DIR = path.join(os.homedir(), 'MemoRecordings');
const RECORDINGS_DIR = path.join(os.homedir(), 'CrunchRecordings');

// Se esiste MemoRecordings ma non ancora CrunchRecordings, migra subito senza riscaricare il modello!
if (fs.existsSync(OLD_MEMO_DIR) && !fs.existsSync(RECORDINGS_DIR)) {
  try {
    fs.renameSync(OLD_MEMO_DIR, RECORDINGS_DIR);
  } catch (_) {}
}

const MODELS_DIR = path.join(RECORDINGS_DIR, '.models');
const UNSORTED_DIR = path.join(RECORDINGS_DIR, '_unsorted');
const MODEL_FILENAME = 'ggml-large-v3-turbo.bin';

function getModelPath() {
  const primary = path.join(MODELS_DIR, MODEL_FILENAME);
  if (fs.existsSync(primary)) return primary;
  const fallbackOld = path.join(OLD_MEMO_DIR, '.models', MODEL_FILENAME);
  if (fs.existsSync(fallbackOld)) return fallbackOld;
  return primary;
}

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin';

// Percorso al binario whisper-cli (dentro l'app oppure nella dir di sviluppo)
function getWhisperBinPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'whisper-cli');
  }
  return path.join(__dirname, '..', '..', 'bin', 'whisper-cli');
}

// ─── Validazione percorsi IPC ──────────────────────────────────────────────
// Il renderer non deve poter leggere/scrivere/eliminare percorsi arbitrari.
function isPathInsideRecordings(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const resolved = path.resolve(targetPath);
  const root = path.resolve(RECORDINGS_DIR);
  return resolved.startsWith(root + path.sep);
}

function isSafeFolderName(name) {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 80
    && name !== '.'
    && name !== '..'
    && !name.startsWith('.')
    && !name.includes('/')
    && !name.includes('\\');
}

function isValidRecordingDir(recDir) {
  return isPathInsideRecordings(recDir) && fs.existsSync(recDir);
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
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update:status', {
      type: 'checking',
      message: 'Verifica aggiornamenti...'
    });
  });

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:status', {
      type: 'available',
      version: info.version,
      message: `Trovata nuova versione v${info.version}. Download in corso...`
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    mainWindow?.webContents.send('update:status', {
      type: 'not-available',
      version: info?.version || app.getVersion(),
      message: 'Crunch è già aggiornato all\'ultima versione.'
    });
  });

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update:status', {
      type: 'error',
      message: err ? (err.message || String(err)) : 'Errore durante la ricerca aggiornamenti'
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow?.webContents.send('update:progress', {
      percent: Math.round(progressObj.percent || 0),
      transferred: progressObj.transferred,
      total: progressObj.total
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update:status', {
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

ipcMain.handle('app:restart-and-install', () => {
  autoUpdater.quitAndInstall();
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

// ─── IPC: Stato modello ────────────────────────────────────────────────────
ipcMain.handle('model:check', () => {
  return fs.existsSync(getModelPath());
});

// ─── IPC: Download modello ─────────────────────────────────────────────────
ipcMain.on('model:download', (event) => {
  const currentModelPath = getModelPath();
  if (fs.existsSync(currentModelPath)) {
    event.sender.send('model:download-done');
    return;
  }

  const targetPath = path.join(MODELS_DIR, MODEL_FILENAME);
  const tmpPath = targetPath + '.tmp';

  function startDownload(url, redirectCount = 0) {
    if (redirectCount > 10) {
      event.sender.send('model:download-error', 'Troppi redirect');
      return;
    }

    const proto = url.startsWith('https') ? https : http;

    const req = proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        const location = res.headers['location'];
        res.destroy();
        startDownload(location, redirectCount + 1);
        return;
      }

      if (res.statusCode !== 200) {
        event.sender.send('model:download-error', `HTTP ${res.statusCode}`);
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
          event.sender.send('model:download-progress', { downloaded, total: totalSize, percent: pct });
        }
      });

      file.on('finish', () => {
        file.close(() => {
          try {
            fs.renameSync(tmpPath, targetPath);
            event.sender.send('model:download-done');
          } catch (e) {
            event.sender.send('model:download-error', e.message);
          }
        });
      });

      file.on('error', (err) => {
        fs.unlink(tmpPath, () => {});
        event.sender.send('model:download-error', err.message);
      });
    });

    req.on('error', (err) => {
      event.sender.send('model:download-error', err.message);
    });
  }

  startDownload(MODEL_URL);
});

// ─── IPC: Salva audio WAV (Anti-sovrascrittura garantita) ───────────────────
ipcMain.handle('recording:save', async (event, { buffer, folder, name }) => {
  try {
    if (folder && !isSafeFolderName(folder)) {
      return { success: false, error: 'Gruppo non valido' };
    }

    const date = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const timeStr = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    const safeName = (name || 'Lezione').replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').trim() || 'Lezione';

    const baseDir = folder ? path.join(RECORDINGS_DIR, folder) : UNSORTED_DIR;
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

    let recDirName = `${dateStr}_${timeStr}_${safeName}`;
    let recDir = path.join(baseDir, recDirName);

    // Se esiste già una cartella identica, aggiungi progressivo
    let counter = 1;
    while (fs.existsSync(recDir)) {
      recDirName = `${dateStr}_${timeStr}_${safeName}_${counter}`;
      recDir = path.join(baseDir, recDirName);
      counter++;
    }

    fs.mkdirSync(recDir, { recursive: true });

    const audioPath = path.join(recDir, 'audio.wav');
    fs.writeFileSync(audioPath, Buffer.from(buffer));

    const metadata = {
      name: safeName,
      date: date.toISOString(),
      folder: folder || null,
      duration: 0,
      hasTranscript: false,
      isCompleteTranscript: false,
    };
    fs.writeFileSync(path.join(recDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

    return { success: true, recDir, audioPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Aggiorna durata registrazione ───────────────────────────────────
ipcMain.handle('recording:update-duration', (event, { recDir, duration }) => {
  try {
    if (!isValidRecordingDir(recDir)) {
      return { success: false, error: 'Registrazione non valida' };
    }
    const metaPath = path.join(recDir, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      meta.duration = duration;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }
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

  if (!isValidRecordingDir(recDir) ||
      !audioPath ||
      !path.resolve(audioPath).startsWith(path.resolve(recDir) + path.sep)) {
    event.sender.send('transcription:error', 'Percorso audio non valido.');
    return;
  }

  const currentModelPath = getModelPath();
  if (!fs.existsSync(currentModelPath)) {
    event.sender.send('transcription:error', 'Modello Whisper non trovato in ~/CrunchRecordings/.models.');
    return;
  }

  const whisperBin = getWhisperBinPath();
  if (!fs.existsSync(whisperBin)) {
    event.sender.send('transcription:error', 'Motore whisper-cli non trovato.');
    return;
  }

  const audioBasename = path.basename(audioPath, path.extname(audioPath));
  const outputPrefix = path.join(recDir, audioBasename);

  // Rimuovi vecchi file per evitare che letture residue sporchino la traduzione/ritrascrizione
  ['.json', '.txt', '.srt', '.vtt', '.csv'].forEach(ext => {
    try {
      const f = outputPrefix + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (_) {}
  });

  // Argomenti per whisper-cli nativo Metal
  const args = [
    '--model', currentModelPath,
    '--output-file', outputPrefix,
    '--output-json',
    '--output-txt',
    '--print-progress',
    '--file', audioPath,
    '--threads', '4',
    '--language', language || 'auto',
  ];

  if (translate) {
    args.push('--translate');
  }

  const proc = spawn(whisperBin, args);
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
      event.sender.send('transcription:error', `whisper-cli terminato con errore (codice ${code})`);
      return;
    }

    try {
      const jsonPath = outputPrefix + '.json';
      const txtPath = outputPrefix + '.txt';

      let transcript = { segments: [], text: '' };

      if (fs.existsSync(jsonPath)) {
        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        transcript.segments = (raw.transcription || []).map(seg => ({
          start: seg.offsets ? (seg.offsets.from / 1000) : 0,
          end: seg.offsets ? (seg.offsets.to / 1000) : 0,
          text: (seg.text || '').trim(),
        }));
        transcript.text = transcript.segments.map(s => s.text).join(' ').trim();
      } else if (fs.existsSync(txtPath)) {
        transcript.text = fs.readFileSync(txtPath, 'utf8').trim();
      }

      // Salva copie canoniche
      fs.writeFileSync(path.join(recDir, 'transcript.json'), JSON.stringify(transcript, null, 2));
      fs.writeFileSync(path.join(recDir, 'transcript.txt'), transcript.text);

      // Aggiorna metadata con flag di trascrizione COMPLETA al 100%
      const metaPath = path.join(recDir, 'metadata.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        meta.hasTranscript = true;
        meta.isCompleteTranscript = true;
        meta.isLivePreview = false;
        meta.isTranslated = !!translate;
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      }

      event.sender.send('transcription:done', {
        recDir,
        transcript,
        translate: !!translate,
      });
    } catch (err) {
      event.sender.send('transcription:error', err.message);
    }
  });

  proc.on('error', (err) => {
    activeTranscription = null;
    event.sender.send('transcription:error', err.message);
  });
});

// ─── IPC: Trascrizione Chunk Live (Ultra-rapida Metal) ──────────────────────
ipcMain.handle('transcription:chunk', async (event, { buffer, language, translate }) => {
  const currentModelPath = getModelPath();
  if (!fs.existsSync(currentModelPath)) {
    return { success: false, error: 'Modello non pronto' };
  }
  const whisperBin = getWhisperBinPath();
  if (!fs.existsSync(whisperBin)) {
    return { success: false, error: 'whisper-cli non trovato' };
  }

  const tmpId = Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const tmpWav = path.join(os.tmpdir(), `crunch_chunk_${tmpId}.wav`);
  const tmpOut = path.join(os.tmpdir(), `crunch_chunk_out_${tmpId}`);

  try {
    fs.writeFileSync(tmpWav, Buffer.from(buffer));

    const args = [
      '--model', currentModelPath,
      '--output-txt',
      '--output-file', tmpOut,
      '--no-timestamps',
      '--file', tmpWav,
      '--threads', '4',
      '--language', language || 'auto',
    ];

    if (translate) {
      args.push('--translate');
    }

    return new Promise((resolve) => {
      const proc = spawn(whisperBin, args);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        try {
          const txtFile = tmpOut + '.txt';
          let text = '';
          if (fs.existsSync(txtFile)) {
            text = fs.readFileSync(txtFile, 'utf8').trim();
            try { fs.unlinkSync(txtFile); } catch (_) {}
          }
          if (fs.existsSync(tmpWav)) {
            try { fs.unlinkSync(tmpWav); } catch (_) {}
          }

          if (code === 0) {
            resolve({ success: true, text });
          } else {
            resolve({ success: false, error: `whisper exit code ${code}: ${stderr.slice(-200)}` });
          }
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });

      proc.on('error', (err) => {
        if (fs.existsSync(tmpWav)) {
          try { fs.unlinkSync(tmpWav); } catch (_) {}
        }
        resolve({ success: false, error: err.message });
      });
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
});

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
      const metaPath = path.join(recDir, 'metadata.json');
      let meta;
      try {
        meta = fs.existsSync(metaPath)
          ? JSON.parse(fs.readFileSync(metaPath, 'utf8'))
          : { name: e.name, date: null, duration: 0, hasTranscript: false };
      } catch (_) {
        // Metadata corrotto: non bloccare l'intera libreria
        meta = { name: e.name, date: null, duration: 0, hasTranscript: false };
      }

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
  const metaPath = path.join(recDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) return;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.folder = folder;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch (_) {}
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
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      meta.folder = targetFolder || null;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
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
    const metaPath = path.join(recDir, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      meta.name = safeName;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }
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
ipcMain.handle('transcript:read', (event, { recDir }) => {
  try {
    if (!isValidRecordingDir(recDir)) {
      return { success: false, error: 'Registrazione non valida' };
    }
    const jsonPath = path.join(recDir, 'transcript.json');
    if (fs.existsSync(jsonPath)) {
      return { success: true, transcript: JSON.parse(fs.readFileSync(jsonPath, 'utf8')) };
    }
    return { success: false, error: 'Nessuna trascrizione' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Salva trascrizione editata ──────────────────────────────────────
ipcMain.handle('transcript:save', (event, { recDir, transcript, isLivePreview, isTranslated }) => {
  try {
    if (!isValidRecordingDir(recDir)) {
      return { success: false, error: 'Registrazione non valida' };
    }
    fs.writeFileSync(path.join(recDir, 'transcript.json'), JSON.stringify(transcript, null, 2));
    fs.writeFileSync(path.join(recDir, 'transcript.txt'), transcript.text || '');

    // Allinea i flag del metadata: senza questo, un'anteprima live
    // scomparirebbe dalla libreria al riavvio dell'app.
    const metaPath = path.join(recDir, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        meta.hasTranscript = true;
        if (isLivePreview === true) {
          meta.isLivePreview = true;
          meta.isCompleteTranscript = false;
          if (typeof isTranslated === 'boolean') meta.isTranslated = isTranslated;
        }
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      } catch (_) {}
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Export ──────────────────────────────────────────────────────────
ipcMain.handle('transcript:export', async (event, { recDir, format, text }) => {
  try {
    if (!isValidRecordingDir(recDir)) {
      return { success: false, error: 'Registrazione non valida' };
    }
    const meta = JSON.parse(fs.readFileSync(path.join(recDir, 'metadata.json'), 'utf8'));
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
