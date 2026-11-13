'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const updater = require('../src/main/updater');
const { verifyDigestSignature } = require('../src/main/update-signature');
const { tempDir, cleanup } = require('./helpers');

const darwinTest = process.platform === 'darwin' ? test : test.skip;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    }),
  };
}

function sha512Base64(data) {
  return crypto.createHash('sha512').update(data).digest('base64');
}

function signDigest(digest, privateKey) {
  return crypto.sign(null, Buffer.from(`sha512:${digest}`), privateKey).toString('base64');
}

test('sha512File calcola il digest base64 usato dal manifest', async () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'file.bin');
    fs.writeFileSync(file, 'crunch');
    const digest = await updater.sha512File(file);
    assert.equal(digest, sha512Base64('crunch'));
    assert.equal(await updater.fileMatchesSha512(file, digest), true);
    assert.equal(await updater.fileMatchesSha512(file, 'altro'), false);
    assert.equal(await updater.fileMatchesSha512(path.join(dir, 'assente'), digest), false);
  } finally {
    cleanup(dir);
  }
});

test('la firma Ed25519 copre il digest SHA-512', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const digest = sha512Base64('pacchetto');
  const signature = signDigest(digest, privateKey);

  assert.equal(verifyDigestSignature(digest, signature, publicKeyBase64), true);
  assert.equal(verifyDigestSignature(sha512Base64('altro'), signature, publicKeyBase64), false);
  assert.equal(verifyDigestSignature(digest, `${signature.slice(0, -4)}AAAA`, publicKeyBase64), false);
  assert.equal(verifyDigestSignature(digest, '', publicKeyBase64), false);
  assert.equal(verifyDigestSignature(digest, signature, 'non-base64'), false);
});

test('verifyUpdateFile richiede digest e firma coerenti', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const dir = tempDir();
  try {
    const file = path.join(dir, 'update.zip');
    fs.writeFileSync(file, 'zip-bytes');
    const digest = sha512Base64('zip-bytes');
    const signature = signDigest(digest, privateKey);

    const valid = await updater.verifyUpdateFile(file, digest, signature, publicKeyBase64);
    assert.equal(valid.ok, true);
    assert.equal(valid.sha512, digest);

    const wrongDigest = await updater.verifyUpdateFile(file, sha512Base64('altro'), signature);
    assert.equal(wrongDigest.ok, false);

    const wrongSignature = await updater.verifyUpdateFile(file, digest, signDigest(digest, crypto.generateKeyPairSync('ed25519').privateKey));
    assert.equal(wrongSignature.ok, false);
    assert.equal(verifyDigestSignature(digest, signature, publicKeyBase64), true);
  } finally {
    cleanup(dir);
  }
});

test('downloadFile verifica il checksum e restituisce il digest', async () => {
  const dir = tempDir();
  const payload = Buffer.from('contenuto aggiornamento');
  const { baseUrl, close } = await startServer((req, res) => {
    res.writeHead(200, { 'content-length': String(payload.length) });
    res.end(payload);
  });

  try {
    const dest = path.join(dir, 'update.zip');
    const progress = [];
    const result = await updater.downloadFile({
      url: `${baseUrl}/update.zip`,
      dest,
      sha512: sha512Base64(payload),
      onProgress: (data) => progress.push(data),
    });
    assert.equal(result.path, dest);
    assert.equal(result.sha512, sha512Base64(payload));
    assert.equal(fs.readFileSync(dest, 'utf8'), payload.toString());
    assert.equal(fs.existsSync(`${dest}.part`), false);
    assert.equal(progress[progress.length - 1].percent, 100);
  } finally {
    await close();
    cleanup(dir);
  }
});

test('downloadFile rifiuta un checksum errato e ripulisce il temporaneo', async () => {
  const dir = tempDir();
  const { baseUrl, close } = await startServer((req, res) => {
    res.writeHead(200, { 'content-length': '4' });
    res.end('male');
  });

  try {
    const dest = path.join(dir, 'update.zip');
    await assert.rejects(
      () => updater.downloadFile({ url: `${baseUrl}/update.zip`, dest, sha512: sha512Base64('buono') }),
      /Checksum SHA-512 non valido/,
    );
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(`${dest}.part`), false);
  } finally {
    await close();
    cleanup(dir);
  }
});

test('downloadFile segue i redirect', async () => {
  const dir = tempDir();
  const { baseUrl, close } = await startServer((req, res) => {
    if (req.url === '/start') {
      res.writeHead(302, { location: '/update.zip' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-length': '3' });
    res.end('zip');
  });

  try {
    const dest = path.join(dir, 'update.zip');
    const result = await updater.downloadFile({ url: `${baseUrl}/start`, dest });
    assert.equal(result.sha512, sha512Base64('zip'));
    assert.equal(fs.readFileSync(dest, 'utf8'), 'zip');
  } finally {
    await close();
    cleanup(dir);
  }
});

test('downloadText scarica e normalizza la firma', async () => {
  const { baseUrl, close } = await startServer((req, res) => {
    if (req.url === '/sig') {
      res.writeHead(302, { location: '/signature.txt' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('  firma-base64\n');
  });

  try {
    assert.equal(await updater.downloadText(`${baseUrl}/sig`), 'firma-base64');
  } finally {
    await close();
  }
});

test('downloadText fallisce su HTTP diverso da 200', async () => {
  const { baseUrl, close } = await startServer((req, res) => {
    res.writeHead(404);
    res.end('assente');
  });

  try {
    await assert.rejects(() => updater.downloadText(`${baseUrl}/sig`), /HTTP 404/);
  } finally {
    await close();
  }
});

test('getAppBundlePath riconosce solo bundle .app', () => {
  assert.equal(
    updater.getAppBundlePath('/Applications/Crunch.app/Contents/MacOS/Crunch'),
    '/Applications/Crunch.app',
  );
  assert.equal(updater.getAppBundlePath('/tmp/not-an-app/Contents/MacOS/Crunch'), null);
  assert.equal(updater.getAppBundlePath(null), null);
  assert.equal(updater.getAppBundlePath(''), null);
});

function writeFakeApp(dir, version, marker) {
  const app = path.join(dir, `Crunch ${version}.app`);
  const contents = path.join(app, 'Contents');
  const macos = path.join(contents, 'MacOS');
  fs.mkdirSync(macos, { recursive: true });
  fs.writeFileSync(path.join(app, marker), marker);
  fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleIdentifier</key><string>com.crunch.test</string>
<key>CFBundleExecutable</key><string>Crunch</string>
</dict></plist>
`);
  fs.writeFileSync(path.join(macos, 'Crunch'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  return app;
}

function runInstallScript({ app, newApp, backup, log }) {
  const dir = path.dirname(log);
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'install.sh');
  fs.writeFileSync(script, updater.INSTALL_SCRIPT, { mode: 0o755 });
  const tempRoot = path.join(dir, 'temp-extract');
  fs.mkdirSync(tempRoot, { recursive: true });
  const updatesDir = path.join(dir, 'updates');
  fs.mkdirSync(updatesDir, { recursive: true });
  const zipFile = path.join(updatesDir, 'fake.zip');
  return spawnSync('/bin/bash', [script, '99999999', app, newApp, backup, log, '0', tempRoot, updatesDir, zipFile], {
    encoding: 'utf8',
  });
}

darwinTest('lo script di installazione sostituisce l’app e rimuove il backup', async () => {
  const dir = tempDir();
  try {
    const app = writeFakeApp(dir, '1.0.0', 'old.txt');
    const newApp = writeFakeApp(dir, '2.0.0', 'new.txt');
    const backup = path.join(dir, 'backup.app');
    const log = path.join(dir, 'install.log');

    const result = runInstallScript({ app, newApp, backup, log });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(app, 'new.txt')), true);
    // Il backup viene rimosso dopo un aggiornamento riuscito
    assert.equal(fs.existsSync(backup), false);
    assert.match(fs.readFileSync(log, 'utf8'), /Aggiornamento completato/);
    assert.match(fs.readFileSync(log, 'utf8'), /Pulizia completata/);
  } finally {
    cleanup(dir);
  }
});

darwinTest('lo script di installazione ripristina il backup se la copia fallisce', async () => {
  const dir = tempDir();
  try {
    const app = writeFakeApp(dir, '1.0.0', 'old.txt');
    const missing = path.join(dir, 'missing', 'Crunch.app');
    const backup = path.join(dir, 'backup.app');
    const log = path.join(dir, 'install.log');

    const result = runInstallScript({ app, newApp: missing, backup, log });
    assert.equal(result.status, 1);
    assert.equal(fs.existsSync(path.join(app, 'old.txt')), true);
    assert.equal(fs.existsSync(backup), false);
    assert.match(fs.readFileSync(log, 'utf8'), /Copia fallita: ripristino il backup/);
  } finally {
    cleanup(dir);
  }
});

darwinTest('extractApp e readAppVersion leggono il bundle dello ZIP', () => {
  const dir = tempDir();
  try {
    const app = writeFakeApp(dir, '2.3.4', 'marker.txt');
    const zip = path.join(dir, 'update.zip');
    execFileSync('ditto', ['-c', '-k', '--keepParent', app, zip]);
    const extracted = updater.extractApp(zip, path.join(dir, 'extracted'));
    assert.equal(updater.readAppVersion(extracted), '2.3.4');
  } finally {
    cleanup(dir);
  }
});

darwinTest('installUpdate estrae, verifica la versione e pulisce dopo installazione', async () => {
  const dir = tempDir();
  try {
    const app = writeFakeApp(dir, '1.0.0', 'old.txt');
    const newApp = writeFakeApp(dir, '2.0.0', 'new.txt');
    const zip = path.join(dir, 'update.zip');
    execFileSync('ditto', ['-c', '-k', '--keepParent', newApp, zip]);
    const log = path.join(dir, 'install.log');

    const result = updater.installUpdate({
      zipPath: zip,
      expectedVersion: '2.0.0',
      appBundlePath: app,
      currentPid: 99999999,
      logPath: log,
      launch: false,
    });

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('Pulizia completata')) break;
      await delay(100);
    }
    const logContent = fs.readFileSync(log, 'utf8');
    assert.match(logContent, /Aggiornamento completato/);
    assert.match(logContent, /Pulizia completata/);
    assert.equal(fs.existsSync(path.join(app, 'new.txt')), true);
    // Il backup viene rimosso dopo installazione riuscita
    assert.equal(fs.existsSync(result.backupPath), false);
  } finally {
    cleanup(dir);
  }
});

darwinTest('installUpdate rifiuta una versione diversa da quella attesa', () => {
  const dir = tempDir();
  try {
    const app = writeFakeApp(dir, '1.0.0', 'old.txt');
    const newApp = writeFakeApp(dir, '2.0.0', 'new.txt');
    const zip = path.join(dir, 'update.zip');
    execFileSync('ditto', ['-c', '-k', '--keepParent', newApp, zip]);

    assert.throws(
      () => updater.installUpdate({
        zipPath: zip,
        expectedVersion: '3.0.0',
        appBundlePath: app,
        currentPid: process.pid,
        logPath: path.join(dir, 'install.log'),
      }),
      /Versione inattesa nel pacchetto: 2\.0\.0/,
    );
  } finally {
    cleanup(dir);
  }
});
