#!/usr/bin/env node
// Ricompila better-sqlite3 per l'ABI di Electron in uso.
//
// Versione portabile di scripts/rebuild-native.sh: su Windows `npm` esegue i
// lifecycle script con cmd.exe, quindi un postinstall basato su bash non è
// affidabile. Qui invochiamo direttamente il CLI di @electron/rebuild.

import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function commandWorks(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result.status === 0;
}

function findPython() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const candidates = process.platform === 'win32'
    ? ['python', 'py', 'python3']
    : ['python3', 'python'];
  for (const candidate of candidates) {
    if (commandWorks(candidate, ['-c', 'import sys'])) return candidate;
  }
  return null;
}

let python = findPython();
if (!python) {
  console.error('Errore: Python non trovato (imposta la variabile PYTHON).');
  process.exit(1);
}

// node-gyp 9 (usato da electron-builder 25) importa distutils, rimosso da
// Python 3.12+. Su macOS il Python di sistema lo fornisce ancora.
if (!commandWorks(python, ['-c', 'import distutils'])) {
  if (process.platform === 'darwin'
      && fs.existsSync('/usr/bin/python3')
      && commandWorks('/usr/bin/python3', ['-c', 'import distutils'])) {
    python = '/usr/bin/python3';
  }
}

const electronVersion = require('electron/package.json').version;
const cli = require.resolve('@electron/rebuild/lib/cli.js');
const result = spawnSync(process.execPath, [
  cli,
  '-f',
  '-w', 'better-sqlite3',
  '--build-from-source',
  '--version', electronVersion,
], {
  stdio: 'inherit',
  env: { ...process.env, PYTHON: python },
});

if (result.status !== 0) {
  if (process.env.npm_lifecycle_event === 'postinstall') {
    console.warn('\nAvviso: ricompilazione better-sqlite3 per Electron non riuscita durante postinstall.');
    console.warn('Questo e normale su sistemi (es. Windows in CI) privi della toolchain C++ completa per Electron.');
    process.exit(0);
  }
  process.exit(result.status ?? 1);
}

process.exit(0);
