#!/usr/bin/env node
// Genera la coppia di chiavi Ed25519 usata per firmare gli ZIP di
// aggiornamento. La chiave privata resta fuori dal repository in `.secrets/`
// e va copiata nel secret GitHub `UPDATE_SIGNING_KEY`; la chiave pubblica
// viene incorporata nell'app come `src/main/update-public-key.js`.
//
// Uso:
//   node scripts/update-keygen.mjs [--force]
//
// Ruotare la chiave significa pubblicare una nuova release firmata con la
// nuova chiave: le versioni precedenti non potranno verificare le release
// successive finché non aggiornate manualmente.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const force = process.argv.includes('--force');
const privateKeyPath = path.join(root, '.secrets', 'update-signing-key.pem');
const publicKeyModule = path.join(root, 'src', 'main', 'update-public-key.js');

if (!force && (fs.existsSync(privateKeyPath) || fs.existsSync(publicKeyModule))) {
  console.error('Errore: chiavi già presenti. Usa --force per sovrascriverle.');
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicDer = publicKey.export({ type: 'spki', format: 'der' });
const publicBase64 = publicDer.toString('base64');

fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(privateKeyPath, privatePem, { mode: 0o600 });
fs.writeFileSync(publicKeyModule, `'use strict';

// Chiave pubblica Ed25519 incorporata nell'app. Viene generata da
// \`node scripts/update-keygen.mjs\` e verifica le firme degli ZIP pubblicati
// nella release. Non contiene materiale segreto.
module.exports = {
  UPDATE_PUBLIC_KEY_BASE64: '${publicBase64}',
};
`);

console.log(`Chiave privata: ${privateKeyPath}`);
console.log(`Chiave pubblica: ${publicKeyModule}`);
console.log('');
console.log('Aggiungi il contenuto di update-signing-key.pem al secret GitHub');
console.log('UPDATE_SIGNING_KEY, poi elimina il file locale se non serve più.');
