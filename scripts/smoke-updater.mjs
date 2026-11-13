#!/usr/bin/env node
// Smoke test macOS dell'updater interno: installazione con backup e ripristino
// quando la copia fallisce. Non usa la rete e non tocca l'app installata:
// lavora su copie temporanee del bundle.
//
// Uso (solo macOS):
//   node scripts/smoke-updater.mjs [dist/mac-arm64/Crunch.app]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { installUpdate, readAppVersion, INSTALL_SCRIPT } = require('../src/main/updater');

if (process.platform !== 'darwin') {
  console.log('smoke-updater: saltato (richiede macOS).');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.resolve(root, process.argv[2] || 'dist/mac-arm64/Crunch.app');
if (!fs.existsSync(app)) {
  console.error(`Errore: bundle non trovato: ${app}`);
  process.exit(1);
}

function ditto(source, destination) {
  execFileSync('ditto', [source, destination], { stdio: 'inherit' });
}

function waitForLog(file, marker, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes(marker)) return text;
    }
    execFileSync('sleep', ['0.2']);
  }
  throw new Error(`Timeout in attesa di "${marker}" in ${file}`);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crunch-smoke-'));
const originalVersion = readAppVersion(app);
let failures = 0;

try {
  const oldApp = path.join(temp, 'old', 'Crunch.app');
  ditto(app, oldApp);

  const newApp = path.join(temp, 'new', 'Crunch.app');
  ditto(app, newApp);
  execFileSync('plutil', [
    '-replace', 'CFBundleShortVersionString', '-string', '9.9.9',
    path.join(newApp, 'Contents', 'Info.plist'),
  ]);

  const zipPath = path.join(temp, 'Crunch-9.9.9-arm64-mac.zip');
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', newApp, zipPath]);

  const logPath = path.join(temp, 'install.log');
  const result = installUpdate({
    zipPath,
    expectedVersion: '9.9.9',
    appBundlePath: oldApp,
    currentPid: 99999999,
    logPath,
    launch: false,
  });
  waitForLog(logPath, 'Pulizia completata');
  const installedVersion = readAppVersion(oldApp);
  if (installedVersion !== '9.9.9') {
    throw new Error(`versione installata ${installedVersion}, attesa 9.9.9`);
  }
  if (fs.existsSync(result.backupPath)) {
    throw new Error('il backup non è stato ripulito dopo l\'aggiornamento riuscito');
  }
  console.log('smoke-updater: installazione e pulizia backup ok');

  // Ripristino: la nuova app manca, quindi lo script deve rimettere il backup.
  const restoreApp = path.join(temp, 'restore', 'Crunch.app');
  ditto(app, restoreApp);
  const restoreBackup = path.join(temp, 'restore-backup.app');
  const restoreLog = path.join(temp, 'restore.log');
  const restoreScript = path.join(temp, 'restore.sh');
  fs.writeFileSync(restoreScript, INSTALL_SCRIPT, { mode: 0o755 });
  const restore = spawnSync('/bin/bash', [
    restoreScript,
    '99999999',
    restoreApp,
    path.join(temp, 'missing', 'Crunch.app'),
    restoreBackup,
    restoreLog,
    '0',
    path.join(temp, 'restore-temp'),
    path.join(temp, 'restore-updates'),
    path.join(temp, 'restore-updates', 'dummy.zip'),
  ], { encoding: 'utf8' });
  const restoreText = waitForLog(restoreLog, 'ripristino il backup');
  if (!fs.existsSync(restoreApp)) {
    throw new Error('bundle non ripristinato dopo il fallimento');
  }
  if (readAppVersion(restoreApp) !== originalVersion) {
    throw new Error('versione del bundle ripristinato non coerente');
  }
  if (restore.status !== 1) {
    throw new Error(`codice di uscita del ripristino inatteso: ${restore.status}`);
  }
  if (!restoreText.includes('Copia fallita')) {
    throw new Error('il log non descrive il fallimento');
  }
  console.log('smoke-updater: ripristino del backup ok');
} catch (err) {
  failures += 1;
  console.error(`smoke-updater: FALLITO — ${err.message}`);
} finally {
  if (!process.env.CRUNCH_KEEP_SMOKE) {
    fs.rmSync(temp, { recursive: true, force: true });
  } else {
    console.log(`smoke-updater: file temporanei in ${temp}`);
  }
}

process.exit(failures ? 1 : 0);
