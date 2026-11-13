#!/usr/bin/env node
// Lint leggero e senza dipendenze esterne.
//
// Non sostituisce una suite di regole stylistiche: verifica ciò che rompe la
// build o la sicurezza del repository.
//   - sintassi di ogni file JS/MJS;
//   - require relativi che puntano a file inesistenti;
//   - JSON non validi (package, schemi, lockfile);
//   - test marcati `.only` (bloccherebbero il resto della suite);
//   - `debugger` e `console.log` nel codice di produzione;
//   - CRLF, spazi finali e chiavi private accidentali.
//
// Uso:
//   node scripts/lint.mjs

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = ['src', 'test', 'scripts'];
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'bin', 'coverage', '.git', '.secrets']);
const EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function relative(file) {
  return path.relative(root, file) || file;
}

const problems = [];
const files = SOURCE_DIRS.flatMap((dir) => walk(path.join(root, dir)));

for (const file of files) {
  const rel = relative(file);
  const source = fs.readFileSync(file, 'utf8');

  if (source.includes('\r\n')) problems.push(`${rel}: usa CRLF (atteso LF)`);
  source.split('\n').forEach((line, index) => {
    if (/[ \t]+$/.test(line)) problems.push(`${rel}:${index + 1}: spazi finali`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line)) {
      problems.push(`${rel}:${index + 1}: possibile chiave privata nel repository`);
    }
  });

  if (/\.only\s*\(/.test(source)) problems.push(`${rel}: test con .only`);
  if ((rel.startsWith('src/') || rel.startsWith('test/')) && /\bdebugger\b/.test(source)) {
    problems.push(`${rel}: istruzione debugger`);
  }
  if (rel.startsWith('src/') && /\bconsole\.(log|debug)\s*\(/.test(source)) {
    problems.push(`${rel}: console.log/debug nel codice di produzione`);
  }

  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) {
    problems.push(`${rel}: errore di sintassi\n${(syntax.stderr || '').trim()}`);
  }

  if (!rel.startsWith('test/')) {
    const requirePattern = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let match;
    while ((match = requirePattern.exec(source)) !== null) {
      const request = match[1];
      const base = path.resolve(path.dirname(file), request);
      const candidates = [
        base,
        `${base}.js`,
        `${base}.cjs`,
        `${base}.mjs`,
        `${base}.json`,
        `${base}.node`,
        path.join(base, 'index.js'),
        path.join(base, 'index.json'),
      ];
      if (!candidates.some((candidate) => fs.existsSync(candidate))) {
        problems.push(`${rel}: require relativo non risolvibile: ${request}`);
      }
    }
  }
}

const jsonFiles = [
  'package.json',
  'package-lock.json',
  'src/core/schema/metadata.schema.json',
  'src/core/schema/transcript.schema.json',
  'src/core/schema/edits.schema.json',
];
for (const rel of jsonFiles) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    problems.push(`${rel}: JSON non valido (${err.message})`);
  }
}

if (problems.length > 0) {
  console.error(`Lint fallito (${problems.length} problemi):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`Lint superato: ${files.length} file JS/MJS e ${jsonFiles.length} file JSON.`);
