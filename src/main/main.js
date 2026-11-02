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
const RECORDINGS_DIR = path.join(os.homedir(), 'MemoRecordings');
const MODELS_DIR = path.join(RECORDINGS_DIR, '.models');
const UNSORTED_DIR = path.join(RECORDINGS_DIR, '_unsorted');
const MODEL_FILENAME = 'ggml-large-v3-turbo.bin';
const MODEL_PATH = path.join(MODELS_DIR, MODEL_FILENAME);
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin';

// Percorso al binario whisper-cli (dentro l'app oppure nella dir di sviluppo)
function getWhisperBinPath() {
  // In produzione (app pacchettizzata)
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'whisper-cli');
  }
  // In sviluppo
  return path.join(__dirname, '..', '..', 'bin', 'whisper-cli');
}

// ─── Crea directory necessarie ─────────────────────────────────────────────
function ensureDirectories() {
  [RECORDINGS_DIR, MODELS_DIR, UNSORTED_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// ─── Finestra principale ───────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
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
      message: 'Memo è già aggiornato all\'ultima versione.'
    });
  });

  autoUpdater.on('error', (err) => {
    // Non allarmiamo in modalità di sviluppo o se offline
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
    // Controlla dopo 4 secondi dall'avvio
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 4000);

    // Controlla ogni 3 ore
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
  return fs.existsSync(MODEL_PATH);
});

// ─── IPC: Download modello ─────────────────────────────────────────────────
ipcMain.on('model:download', (event) => {
  if (fs.existsSync(MODEL_PATH)) {
    event.sender.send('model:download-done');
    return;
  }

  const tmpPath = MODEL_PATH + '.tmp';

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
            fs.renameSync(tmpPath, MODEL_PATH);
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

// ─── IPC: Salva audio WAV ──────────────────────────────────────────────────
ipcMain.handle('recording:save', async (event, { buffer, folder, name }) => {
  try {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10);
    const safeName = (name || 'Lezione').replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').trim() || 'Lezione';
    const recDirName = `${dateStr}_${safeName}`;

    const baseDir = folder ? path.join(RECORDINGS_DIR, folder) : UNSORTED_DIR;
    const recDir = path.join(baseDir, recDirName);

    if (!fs.existsSync(recDir)) fs.mkdirSync(recDir, { recursive: true });

    const audioPath = path.join(recDir, 'audio.wav');
    fs.writeFileSync(audioPath, Buffer.from(buffer));

    const metadata = {
      name: safeName,
      date: date.toISOString(),
      folder: folder || null,
      duration: 0,
      hasTranscript: false,
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

// ─── IPC: Trascrizione ─────────────────────────────────────────────────────
ipcMain.on('transcription:start', (event, { audioPath, recDir, language, translate }) => {
  if (!fs.existsSync(MODEL_PATH)) {
    event.sender.send('transcription:error', 'Modello Whisper non trovato in ~/.MemoRecordings/.models.');
    return;
  }

  const whisperBin = getWhisperBinPath();
  if (!fs.existsSync(whisperBin)) {
    event.sender.send('transcription:error', 'Motore whisper-cli non trovato.');
    return;
  }

  const audioBasename = path.basename(audioPath, path.extname(audioPath));
  const outputPrefix = path.join(recDir, audioBasename);

  // Argomenti conformi a whisper-cli nativo (whisper.cpp)
  const args = [
    '--model', MODEL_PATH,
    '--language', language || 'it',
    '--output-file', outputPrefix,
    '--output-json',
    '--output-txt',
    '--print-progress',
    '--file', audioPath,
    '--threads', '4',
  ];

  if (translate) {
    args.push('--translate');
  }

  const proc = spawn(whisperBin, args);

  const handleOutput = (data) => {
    const line = data.toString();
    // whisper.cpp stampa: "progress = 45%" o simile
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

      // Aggiorna metadata
      const metaPath = path.join(recDir, 'metadata.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        meta.hasTranscript = true;
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      }

      event.sender.send('transcription:done', transcript);
    } catch (err) {
      event.sender.send('transcription:error', err.message);
    }
  });

  proc.on('error', (err) => {
    event.sender.send('transcription:error', err.message);
  });
});

// ─── IPC: Trascrizione Chunk Live ─────────────────────────────────────────
ipcMain.handle('transcription:chunk', async (event, { buffer, language, translate }) => {
  if (!fs.existsSync(MODEL_PATH)) {
    return { success: false, error: 'Modello non pronto' };
  }
  const whisperBin = getWhisperBinPath();
  if (!fs.existsSync(whisperBin)) {
    return { success: false, error: 'whisper-cli non trovato' };
  }

  const tmpId = Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const tmpWav = path.join(os.tmpdir(), `memo_chunk_${tmpId}.wav`);
  const tmpOut = path.join(os.tmpdir(), `memo_chunk_out_${tmpId}`);

  try {
    fs.writeFileSync(tmpWav, Buffer.from(buffer));

    const args = [
      '--model', MODEL_PATH,
      '--language', language || 'it',
      '--output-txt',
      '--output-file', tmpOut,
      '--no-timestamps',
      '--file', tmpWav,
      '--threads', '4',
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
      const meta = fs.existsSync(metaPath)
        ? JSON.parse(fs.readFileSync(metaPath, 'utf8'))
        : { name: e.name, date: null, duration: 0, hasTranscript: false };

      return {
        id: recDir,
        dirName: e.name,
        recDir,
        audioPath: path.join(recDir, 'audio.wav'),
        folder: folderName,
        ...meta,
      };
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// ─── IPC: Crea cartella ────────────────────────────────────────────────────
ipcMain.handle('folder:create', (event, { name }) => {
  try {
    const safeName = name.replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').trim();
    if (!safeName) return { success: false, error: 'Nome non valido' };
    const folderPath = path.join(RECORDINGS_DIR, safeName);
    if (fs.existsSync(folderPath)) return { success: false, error: 'Cartella già esistente' };
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
    if (!safeName) return { success: false, error: 'Nome non valido' };
    const oldPath = path.join(RECORDINGS_DIR, oldName);
    const newPath = path.join(RECORDINGS_DIR, safeName);
    if (fs.existsSync(newPath)) return { success: false, error: 'Nome già in uso' };
    fs.renameSync(oldPath, newPath);
    return { success: true, name: safeName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Elimina cartella ─────────────────────────────────────────────────
ipcMain.handle('folder:delete', (event, { name }) => {
  try {
    const folderPath = path.join(RECORDINGS_DIR, name);
    const recordings = getRecordingsInDir(folderPath, name);

    // Sposta i file in _unsorted
    for (const rec of recordings) {
      const dest = path.join(UNSORTED_DIR, rec.dirName);
      if (!fs.existsSync(dest)) {
        fs.renameSync(rec.recDir, dest);
      }
    }

    if (fs.existsSync(folderPath)) {
      fs.rmdirSync(folderPath, { recursive: true });
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Sposta registrazione ─────────────────────────────────────────────
ipcMain.handle('recording:move', (event, { recDir, targetFolder }) => {
  try {
    const dirName = path.basename(recDir);
    const destBase = targetFolder ? path.join(RECORDINGS_DIR, targetFolder) : UNSORTED_DIR;
    const destPath = path.join(destBase, dirName);

    if (!fs.existsSync(destBase)) fs.mkdirSync(destBase, { recursive: true });
    fs.renameSync(recDir, destPath);

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
    fs.rmSync(recDir, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Leggi trascrizione ───────────────────────────────────────────────
ipcMain.handle('transcript:read', (event, { recDir }) => {
  try {
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
ipcMain.handle('transcript:save', (event, { recDir, transcript }) => {
  try {
    fs.writeFileSync(path.join(recDir, 'transcript.json'), JSON.stringify(transcript, null, 2));
    fs.writeFileSync(path.join(recDir, 'transcript.txt'), transcript.text || '');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Export ──────────────────────────────────────────────────────────
ipcMain.handle('transcript:export', async (event, { recDir, format, text }) => {
  try {
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
  const audioPath = path.join(recDir, 'audio.wav');
  if (fs.existsSync(audioPath)) {
    return { success: true, audioPath: 'file://' + audioPath };
  }
  return { success: false, error: 'File audio non trovato' };
});

// ─── IPC: Finestra minima ─────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());
