#!/usr/bin/env node
// Firma uno ZIP di aggiornamento con Ed25519.
//
// Il file di firma contiene il base64 della firma del messaggio
// `sha512:<digest base64>`. L'updater verifica la firma con la chiave
// pubblica incorporata nell'app prima di estrarre il pacchetto.
//
// Uso:
//   node scripts/sign-update.mjs --zip dist/Crunch-1.3.0-arm64-mac.zip
//   UPDATE_SIGNING_KEY="$(cat key.pem)" node scripts/sign-update.mjs --zip ...
//
// La chiave privata può essere passata con --key-file oppure con la variabile
// d'ambiente UPDATE_SIGNING_KEY (usata da GitHub Actions).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { signatureMessage, verifyDigestSignature } = require('../src/main/update-signature');
const { UPDATE_PUBLIC_KEY_BASE64 } = require('../src/main/update-public-key');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`Errore: ${name} richiede un valore.`);
    process.exit(1);
  }
  return value;
}

function sha512File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

const zipArg = argValue('--zip');
if (!zipArg) {
  console.error('Uso: node scripts/sign-update.mjs --zip <file.zip> [--key-file <key.pem>] [--out <file.sig>]');
  process.exit(1);
}

const zipPath = path.resolve(root, zipArg);
if (!fs.existsSync(zipPath)) {
  console.error(`Errore: ZIP non trovato: ${zipPath}`);
  process.exit(1);
}

const keyFile = argValue('--key-file');
const keyPem = keyFile
  ? fs.readFileSync(path.resolve(root, keyFile), 'utf8')
  : process.env.UPDATE_SIGNING_KEY;
if (!keyPem || !keyPem.includes('PRIVATE KEY')) {
  console.error('Errore: chiave privata assente. Usa --key-file o UPDATE_SIGNING_KEY.');
  process.exit(1);
}

const outPath = path.resolve(root, argValue('--out', `${zipPath}.sig`));
const digest = await sha512File(zipPath);
const signature = crypto.sign(null, Buffer.from(signatureMessage(digest), 'utf8'), keyPem);
const signatureBase64 = signature.toString('base64');

if (!verifyDigestSignature(digest, signatureBase64, UPDATE_PUBLIC_KEY_BASE64)) {
  console.error('Errore: la chiave privata non corrisponde alla chiave pubblica incorporata.');
  process.exit(1);
}

fs.writeFileSync(outPath, `${signatureBase64}\n`);
console.log(`Firma scritta: ${outPath}`);
console.log(`SHA-512: ${digest}`);
