#!/usr/bin/env node
// Revisione formale e automatica degli entitlements macOS.
//
// Controlla che i plist usati per firmare l'app contengano solo le chiavi
// approvate in docs/RELEASE_SECURITY.md e che la configurazione
// electron-builder punti davvero a quei file. Non firma e non modifica nulla.
//
// Uso:
//   node scripts/verify-entitlements.mjs
//   node scripts/verify-entitlements.mjs --plist /percorso/entitlements.plist
//   node scripts/verify-entitlements.mjs --json

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Allowlist approvata. Ogni eccezione deve essere motivata nel documento di
// revisione: se serve una chiave nuova, aggiornare qui e nel documento.
export const APPROVED_ENTITLEMENTS = Object.freeze({
  'com.apple.security.cs.allow-jit': {
    value: true,
    reason: 'V8/Metal richiede memoria eseguibile JIT con hardened runtime.',
    scope: ['main', 'inherit'],
  },
  'com.apple.security.cs.allow-unsigned-executable-memory': {
    value: true,
    reason: 'Electron e i framework nativi allocano memoria eseguibile non firmata.',
    scope: ['main', 'inherit'],
  },
  'com.apple.security.cs.disable-library-validation': {
    value: true,
    reason: 'Necessario per caricare better-sqlite3 ricompilato e firmato dentro il bundle.',
    scope: ['main', 'inherit'],
  },
  'com.apple.security.device.audio-input': {
    value: true,
    reason: 'Cattura del microfono per la registrazione delle lezioni.',
    scope: ['main'],
  },
  'com.apple.security.network.client': {
    value: true,
    reason: 'Download dei modelli e controllo aggiornamenti su HTTPS.',
    scope: ['main'],
  },
  'com.apple.security.files.user-selected.read-write': {
    value: true,
    reason: 'Export TXT/Markdown tramite dialogo di salvataggio.',
    scope: ['main'],
  },
  'com.apple.security.files.downloads.read-write': {
    value: true,
    reason: 'Scrittura dei pacchetti di aggiornamento nella cartella Download.',
    scope: ['main'],
    deprecated: true,
  },
});

// Chiavi che non devono mai comparire in una build di distribuzione.
export const FORBIDDEN_ENTITLEMENTS = Object.freeze([
  'com.apple.security.cs.debugger',
  'com.apple.security.cs.allow-dyld-environment-variables',
  'com.apple.security.cs.disable-executable-page-protection',
  'com.apple.security.get-task-allow',
  'com.apple.security.app-sandbox',
]);

export function parseEntitlements(xml, file = 'entitlements') {
  const entries = {};
  const normalized = xml
    .replace(/<true\s*\/>/g, '<true></true>')
    .replace(/<false\s*\/>/g, '<false></false>');
  const pattern = /<key>([^<]+)<\/key>\s*<(true|false|string)>([\s\S]*?)<\/\2>/g;
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    const [, key, type, raw] = match;
    if (Object.prototype.hasOwnProperty.call(entries, key)) {
      throw new Error(`${file}: chiave duplicata ${key}`);
    }
    entries[key] = type === 'string' ? raw.trim() : type === 'true';
  }
  if (Object.keys(entries).length === 0) {
    throw new Error(`${file}: nessun entitlement riconosciuto`);
  }
  return entries;
}

export function validateEntitlements(entries, scope, allowed = APPROVED_ENTITLEMENTS) {
  const problems = [];
  for (const key of Object.keys(entries)) {
    if (FORBIDDEN_ENTITLEMENTS.includes(key)) {
      problems.push(`${key}: chiave vietata`);
      continue;
    }
    const rule = allowed[key];
    if (!rule) {
      problems.push(`${key}: non presente nell'allowlist`);
      continue;
    }
    if (!rule.scope.includes(scope)) {
      problems.push(`${key}: non ammessa per ${scope}`);
    }
    if (entries[key] !== rule.value) {
      problems.push(`${key}: valore ${JSON.stringify(entries[key])}, atteso ${JSON.stringify(rule.value)}`);
    }
  }
  return problems;
}

export function readPlist(file) {
  return parseEntitlements(fs.readFileSync(file, 'utf8'), path.basename(file));
}

export function checkConfiguration() {
  const problems = [];
  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const mac = pkg.build?.mac || {};

  if (mac.hardenedRuntime !== true) problems.push('build.mac.hardenedRuntime deve essere true');
  if (mac.notarize !== true) problems.push('build.mac.notarize deve essere true');
  if (mac.gatekeeperAssess !== false) problems.push('build.mac.gatekeeperAssess deve essere false');

  const mainRel = mac.entitlements || 'build/entitlements.mac.plist';
  const inheritRel = mac.entitlementsInherit || 'build/entitlements.mac.inherit.plist';
  const mainPath = path.join(root, mainRel);
  const inheritPath = path.join(root, inheritRel);

  if (!fs.existsSync(mainPath)) problems.push(`entitlements main mancante: ${mainRel}`);
  if (!fs.existsSync(inheritPath)) problems.push(`entitlements inherit mancante: ${inheritRel}`);

  if (fs.existsSync(mainPath)) {
    for (const problem of validateEntitlements(readPlist(mainPath), 'main')) {
      problems.push(`main/${problem}`);
    }
  }
  if (fs.existsSync(inheritPath)) {
    for (const problem of validateEntitlements(readPlist(inheritPath), 'inherit')) {
      problems.push(`inherit/${problem}`);
    }
  }

  const microphone = mac.extendInfo?.NSMicrophoneUsageDescription;
  if (typeof microphone !== 'string' || microphone.trim() === '') {
    problems.push('build.mac.extendInfo.NSMicrophoneUsageDescription mancante');
  }

  return { problems, mainPath, inheritPath };
}

function main() {
  const plistArg = process.argv.indexOf('--plist');
  if (plistArg !== -1) {
    const file = path.resolve(root, process.argv[plistArg + 1] || '');
    if (!fs.existsSync(file)) {
      console.error(`Errore: plist non trovato: ${file}`);
      process.exit(1);
    }
    try {
      const entries = readPlist(file);
      const problems = validateEntitlements(entries, 'main');
      if (problems.length) {
        console.error(`Entitlements non validi (${file}):`);
        for (const problem of problems) console.error(`- ${problem}`);
        process.exit(1);
      }
      console.log(`Entitlements validi: ${file} (${Object.keys(entries).length} chiavi)`);
    } catch (err) {
      console.error(`Errore: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  const { problems, mainPath, inheritPath } = checkConfiguration();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: problems.length === 0, problems, mainPath, inheritPath }, null, 2));
  } else if (problems.length) {
    console.error('Revisione entitlements non superata:');
    for (const problem of problems) console.error(`- ${problem}`);
  } else {
    console.log(`Entitlements approvati: ${path.relative(root, mainPath)} + ${path.relative(root, inheritPath)}`);
  }
  if (problems.length) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
