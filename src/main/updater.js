'use strict';

// ─── Aggiornamento manuale per build macOS non firmate ────────────────────
// Squirrel.Mac rifiuta le build ad-hoc/unsigned. Questo modulo scarica lo ZIP
// della release, ne verifica SHA-512 e firma Ed25519, poi sostituisce l'app
// tramite uno script che attende la chiusura di Crunch, conserva un backup e
// riapre la nuova app.

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { verifyDigestSignature } = require('./update-signature');

const RELEASES_URL = 'https://github.com/IC3NBERG/Memo/releases/latest';

function getAppBundlePath(exePath) {
  if (!exePath || typeof exePath !== 'string') return null;
  try {
    const contents = path.dirname(path.dirname(exePath)); // .../Crunch.app/Contents
    const bundle = path.dirname(contents);                 // .../Crunch.app
    return bundle.endsWith('.app') ? bundle : null;
  } catch (_) {
    return null;
  }
}

// Una build firmata con Developer ID e con firma valida può usare Squirrel.
// Ad-hoc o non firmate passano dall'updater interno.
function isDeveloperIdSigned(appBundlePath) {
  if (!appBundlePath) return false;
  try {
    const info = spawnSync('codesign', ['-dv', '--verbose=2', appBundlePath], {
      encoding: 'utf8',
    });
    const output = `${info.stdout || ''}\n${info.stderr || ''}`;
    if (info.status !== 0 || !/Authority=Developer ID Application/.test(output)) {
      return false;
    }
    const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', appBundlePath], {
      encoding: 'utf8',
    });
    return verify.status === 0;
  } catch (_) {
    return false;
  }
}

function sha512File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

async function fileMatchesSha512(filePath, expected) {
  if (!expected || !fs.existsSync(filePath)) return false;
  try {
    return (await sha512File(filePath)) === expected;
  } catch (_) {
    return false;
  }
}

function verifyUpdateFile(filePath, expectedSha512, signatureText, publicKeyBase64) {
  return sha512File(filePath).then((digest) => {
    if (expectedSha512 && digest !== expectedSha512) return { ok: false, sha512: digest };
    return {
      ok: verifyDigestSignature(digest, signatureText, publicKeyBase64),
      sha512: digest,
    };
  });
}

function httpClientFor(url) {
  return String(url).startsWith('http:') ? http : https;
}

function downloadText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) {
      reject(new Error('Troppi redirect durante il download della firma'));
      return;
    }

    const req = httpClientFor(url).get(url, {
      headers: { 'User-Agent': 'Crunch-Updater' },
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        res.resume();
        const location = res.headers.location;
        if (!location) {
          reject(new Error('Redirect senza destinazione'));
          return;
        }
        downloadText(new URL(location, url).toString(), redirects + 1).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download firma fallito (HTTP ${res.statusCode})`));
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 64 * 1024) {
          res.destroy(new Error('Firma troppo grande'));
        }
      });
      res.on('end', () => resolve(body.trim()));
      res.on('error', reject);
    });

    req.on('error', reject);
  });
}

function downloadFile({ url, dest, sha512, onProgress, redirects = 0 }) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) {
      reject(new Error('Troppi redirect durante il download'));
      return;
    }

    const tmpPath = `${dest}.part`;
    let file = null;
    let handedOff = false;

    const cleanup = () => {
      try { if (file) file.destroy(); } catch (_) {}
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    };

    const fail = (err) => {
      if (handedOff) return;
      cleanup();
      reject(err);
    };

    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
    } catch (err) {
      reject(err);
      return;
    }

    const hash = crypto.createHash('sha512');
    let received = 0;
    let total = 0;

    const req = httpClientFor(url).get(url, {
      headers: { 'User-Agent': 'Crunch-Updater' },
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        res.resume();
        const location = res.headers.location;
        if (!location) {
          fail(new Error('Redirect senza destinazione'));
          return;
        }
        const nextUrl = new URL(location, url).toString();
        handedOff = true;
        downloadFile({ url: nextUrl, dest, sha512, onProgress, redirects: redirects + 1 })
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        fail(new Error(`Download fallito (HTTP ${res.statusCode})`));
        return;
      }

      total = parseInt(res.headers['content-length'] || '0', 10);
      file = fs.createWriteStream(tmpPath);

      res.on('data', (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        if (onProgress && total > 0) {
          onProgress({
            percent: Math.min(100, Math.round((received / total) * 100)),
            transferred: received,
            total,
          });
        }
      });

      res.on('error', fail);
      res.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          if (total > 0 && received !== total) {
            fail(new Error('Download incompleto'));
            return;
          }
          const digest = hash.digest('base64');
          if (sha512 && digest !== sha512) {
            fail(new Error('Checksum SHA-512 non valido'));
            return;
          }
          try {
            fs.renameSync(tmpPath, dest);
            resolve({ path: dest, sha512: digest });
          } catch (err) {
            fail(err);
          }
        });
      });

      file.on('error', fail);
    });

    req.on('error', fail);
  });
}

function readAppVersion(appPath) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const res = spawnSync('plutil', [
    '-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist,
  ], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`Impossibile leggere la versione da ${appPath}`);
  }
  return res.stdout.trim();
}

function extractApp(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const res = spawnSync('ditto', ['-x', '-k', zipPath, destDir], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`Estrazione fallita: ${(res.stderr || '').trim() || res.status}`);
  }
  const appName = fs.readdirSync(destDir).find((name) => name.endsWith('.app'));
  if (!appName) {
    throw new Error('Il pacchetto scaricato non contiene un\'app');
  }
  return path.join(destDir, appName);
}

const INSTALL_SCRIPT = `#!/bin/bash
set -u

OLD_PID="$1"
APP="$2"
NEW_APP="$3"
BACKUP="$4"
LOG="$5"
LAUNCH="$6"
TEMP_ROOT="$7"
UPDATES_DIR="$8"
ZIP_FILE="$9"

exec >> "$LOG" 2>&1
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Avvio aggiornamento Crunch"

# Attende la chiusura completa della vecchia istanza (max 2 minuti)
for _ in $(seq 1 240); do
  if ! kill -0 "$OLD_PID" 2>/dev/null; then break; fi
  sleep 0.5
done

if kill -0 "$OLD_PID" 2>/dev/null; then
  echo "Timeout: Crunch non si è chiusa"
  exit 1
fi

sleep 1

if [ ! -d "$APP" ]; then
  echo "App non trovata: $APP"
  exit 1
fi

rm -rf "$BACKUP" || exit 1
mv "$APP" "$BACKUP" || { echo "Backup fallito"; exit 1; }

if ! ditto "$NEW_APP" "$APP"; then
  echo "Copia fallita: ripristino il backup"
  rm -rf "$APP"
  mv "$BACKUP" "$APP"
  open "$APP" >/dev/null 2>&1 || true
  exit 1
fi

# Evita che Gatekeeper blocchi la nuova build non notarizzata
xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1 || true
echo "Aggiornamento completato"

# ─── Pulizia post-installazione ────────────────────────────────────────────
# Elimina il backup della vecchia versione (non serve più)
rm -rf "$BACKUP" 2>/dev/null && echo "Backup rimosso: $BACKUP"

# Elimina la cartella temporanea di estrazione
rm -rf "$TEMP_ROOT" 2>/dev/null && echo "Temp rimosso: $TEMP_ROOT"

# Elimina TUTTI gli installer (.zip, .sig, .part) dalla cartella degli aggiornamenti
if [ -n "$UPDATES_DIR" ] && [ -d "$UPDATES_DIR" ]; then
  rm -f "$UPDATES_DIR"/*.zip "$UPDATES_DIR"/*.sig "$UPDATES_DIR"/*.part 2>/dev/null
  echo "Installer rimossi dalla cartella updates: $UPDATES_DIR"
fi

# Elimina vecchi backup o cartelle temporanee rimaste in os.tmpdir() e /tmp
BACKUP_PARENT="$(dirname "$BACKUP")"
if [ -n "$BACKUP_PARENT" ] && [ -d "$BACKUP_PARENT" ]; then
  find "$BACKUP_PARENT" -maxdepth 1 -name "Crunch-backup-*.app" -type d -exec rm -rf {} + 2>/dev/null
  find "$BACKUP_PARENT" -maxdepth 1 -name "crunch-update-*" -type d -exec rm -rf {} + 2>/dev/null
fi
find /tmp -maxdepth 1 -name "Crunch-backup-*.app" -type d -exec rm -rf {} + 2>/dev/null
find /tmp -maxdepth 1 -name "crunch-update-*" -type d -exec rm -rf {} + 2>/dev/null

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pulizia completata"

if [ "$LAUNCH" = "1" ]; then
  open "$APP" || echo "Riapertura fallita"
fi

exit 0
`;

function installUpdate({
  zipPath,
  expectedVersion,
  appBundlePath,
  currentPid,
  logPath,
  launch = true,
}) {
  if (!appBundlePath || !appBundlePath.endsWith('.app')) {
    throw new Error('Percorso applicazione non valido');
  }
  if (!fs.existsSync(zipPath)) {
    throw new Error('Pacchetto di aggiornamento non trovato');
  }
  if (!fs.existsSync(appBundlePath)) {
    throw new Error('Applicazione installata non trovata');
  }

  const parentDir = path.dirname(appBundlePath);
  fs.accessSync(parentDir, fs.constants.W_OK);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crunch-update-'));
  const newApp = extractApp(zipPath, path.join(tempRoot, 'extracted'));

  const version = readAppVersion(newApp);
  if (expectedVersion && version !== expectedVersion) {
    throw new Error(`Versione inattesa nel pacchetto: ${version}`);
  }

  const backupPath = path.join(os.tmpdir(), `Crunch-backup-${Date.now()}.app`);
  const scriptPath = path.join(tempRoot, 'install.sh');
  const finalLogPath = logPath || path.join(tempRoot, 'install.log');

  const updatesDir = path.dirname(zipPath);

  fs.mkdirSync(path.dirname(finalLogPath), { recursive: true });
  fs.writeFileSync(scriptPath, INSTALL_SCRIPT, { mode: 0o755 });

  const child = spawn('/bin/bash', [
    scriptPath,
    String(currentPid),
    appBundlePath,
    newApp,
    backupPath,
    finalLogPath,
    launch ? '1' : '0',
    tempRoot,
    updatesDir,
    zipPath,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return { backupPath, logPath: finalLogPath, tempRoot, version };
}

module.exports = {
  RELEASES_URL,
  INSTALL_SCRIPT,
  getAppBundlePath,
  isDeveloperIdSigned,
  sha512File,
  fileMatchesSha512,
  verifyUpdateFile,
  downloadFile,
  downloadText,
  extractApp,
  readAppVersion,
  installUpdate,
};
