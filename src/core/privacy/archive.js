'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { listRecordings } = require('./retention');
const { listTrash } = require('../library/trash');
const { PRIVACY_FILE } = require('./settings');

function directoryStats(dir) {
  const result = { bytes: 0, files: 0 };
  if (!dir || !fs.existsSync(dir)) return result;

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return result; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        const nested = directoryStats(full);
        result.bytes += nested.bytes;
        result.files += nested.files;
      } else if (entry.isFile()) {
        result.bytes += fs.statSync(full).size;
        result.files += 1;
      }
    } catch (_) {}
  }
  return result;
}

function safeSize(target) {
  if (!target || !fs.existsSync(target)) return 0;
  try {
    const stat = fs.statSync(target);
    return stat.isDirectory() ? directoryStats(target).bytes : stat.size;
  } catch (_) {
    return 0;
  }
}

function archiveStats({ recordingsDir, modelsDir, indexPath, logsDir } = {}) {
  const recordings = listRecordings(recordingsDir);
  const trash = listTrash({ recordingsDir });
  const archive = directoryStats(recordingsDir);
  const models = safeSize(modelsDir);
  const index = safeSize(indexPath ? path.dirname(indexPath) : null);
  const logs = safeSize(logsDir);

  return {
    recordingsCount: recordings.length,
    trashCount: trash.length,
    recordingsBytes: Math.max(0, archive.bytes - models - index - logs),
    archiveBytes: archive.bytes,
    archiveFiles: archive.files,
    modelsBytes: models,
    indexBytes: index,
    logsBytes: logs,
  };
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Argomenti di `zip` per esportare l'archivio. Indice, log e modelli sono
 * derivati o riscaricabili: inclusi solo su richiesta esplicita.
 */
function buildExportArgs({ destination, includeModels = false } = {}) {
  const args = ['-r', '-X', '-q', destination, '.'];
  const excluded = ['.index/*', '.index', '.logs/*', '.logs'];
  if (!includeModels) excluded.push('.models/*', '.models');
  args.push('-x', ...excluded);
  return args;
}

function createArchiveZip({ recordingsDir, destination, includeModels = false, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    if (!recordingsDir || !fs.existsSync(recordingsDir)) {
      resolve({ success: false, error: 'Archivio non trovato' });
      return;
    }
    if (!destination || typeof destination !== 'string') {
      resolve({ success: false, error: 'Percorso di destinazione non valido' });
      return;
    }
    if (isInside(recordingsDir, path.resolve(destination))) {
      resolve({ success: false, error: 'Scegli una destinazione fuori dall’archivio' });
      return;
    }

    const args = buildExportArgs({ destination, includeModels });
    try { fs.rmSync(destination, { force: true }); } catch (_) {}
    let stderr = '';
    let child;
    try {
      child = spawnImpl('zip', args, { cwd: recordingsDir, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      resolve({ success: false, error: err.message });
      return;
    }

    child.stderr?.on?.('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });
    child.on?.('error', (err) => {
      resolve({ success: false, error: err.code === 'ENOENT' ? 'Comando zip non disponibile' : err.message });
    });
    child.on?.('close', (code) => {
      if (code !== 0) {
        try { fs.rmSync(destination, { force: true }); } catch (_) {}
        resolve({ success: false, error: stderr.trim() || `zip è terminato con codice ${code}` });
        return;
      }
      let bytes = 0;
      try { bytes = fs.statSync(destination).size; } catch (_) {}
      resolve({ success: true, destination, bytes });
    });
  });
}

/**
 * Elimina il contenuto dell'archivio. I modelli AI restano disponibili salvo
 * richiesta esplicita: riscaricarli richiede rete. Le impostazioni privacy e
 * il blocco applicativo restano, perché non contengono dati dell'utente.
 */
function deleteArchiveContents({ recordingsDir, includeModels = false } = {}) {
  if (!recordingsDir || !fs.existsSync(recordingsDir)) {
    return { success: true, removed: 0, keptModels: !includeModels };
  }

  let removed = 0;
  const failed = [];

  let entries;
  try {
    entries = fs.readdirSync(recordingsDir, { withFileTypes: true });
  } catch (err) {
    return { success: false, error: err.message, removed };
  }

  for (const entry of entries) {
    if (entry.name === PRIVACY_FILE) continue;
    if (!includeModels && entry.name === '.models') continue;

    const target = path.join(recordingsDir, entry.name);
    try {
      fs.rmSync(target, { recursive: true, force: true });
      removed += 1;
    } catch (err) {
      failed.push({ name: entry.name, error: err.message });
    }
  }

  if (!includeModels) {
    try { fs.mkdirSync(path.join(recordingsDir, '.models'), { recursive: true }); } catch (_) {}
  }
  try { fs.mkdirSync(path.join(recordingsDir, '_unsorted'), { recursive: true }); } catch (_) {}

  return {
    success: failed.length === 0,
    removed,
    keptModels: !includeModels,
    failed,
  };
}

module.exports = {
  archiveStats,
  buildExportArgs,
  createArchiveZip,
  deleteArchiveContents,
  directoryStats,
  isInside,
};
