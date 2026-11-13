#!/usr/bin/env node
// Esegue la suite di test in modo portabile (Linux, macOS, Windows).
//
// `node --test test/*.test.js` dipende dall'espansione della glob da parte
// della shell: su Windows cmd.exe non la espande. Qui elenchiamo i file e
// passiamo un elenco esplicito al test runner.
//
// Uso:
//   node scripts/run-tests.mjs             # test Node
//   node scripts/run-tests.mjs --electron  # test con l'ABI di Electron
//   node scripts/run-tests.mjs --e2e       # smoke test Electron via CDP

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const mode = process.argv.includes('--electron')
  ? 'electron'
  : (process.argv.includes('--e2e') ? 'e2e' : 'node');

function testFiles(dir) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => path.join(absolute, name));
}

let files;
let command;
let args;
const env = { ...process.env };

if (mode === 'e2e') {
  files = testFiles('test/e2e');
  command = process.execPath;
  args = ['--test', ...files];
  env.CRUNCH_E2E = '1';
} else {
  files = testFiles('test');
  if (mode === 'electron') {
    command = require('electron');
    args = ['--test', ...files];
    env.ELECTRON_RUN_AS_NODE = '1';
  } else {
    command = process.execPath;
    args = ['--test', ...files];
  }
}

if (files.length === 0) {
  console.error(`Nessun test trovato per la modalità ${mode}.`);
  process.exit(1);
}

console.log(`Test (${mode}): ${files.length} file`);
const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env });
process.exit(result.status ?? 1);
