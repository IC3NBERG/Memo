'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { pipeline } = require('stream/promises');

const { ensureDirSync } = require('../storage/atomic');

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 10;

function request(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https:') || url.startsWith('https://') ? https : http;
    const req = proto.get(url, resolve);
    req.on('error', reject);
  });
}

async function writeResponse(res, tmpPath, onProgress) {
  const totalSize = parseInt(res.headers['content-length'] || '0', 10);
  let downloaded = 0;

  if (totalSize > 0) {
    onProgress({ downloaded: 0, total: totalSize, percent: 0 });
  }

  res.on('data', (chunk) => {
    downloaded += chunk.length;
    if (totalSize > 0) {
      onProgress({
        downloaded,
        total: totalSize,
        percent: Math.min(100, Math.round((downloaded / totalSize) * 100)),
      });
    }
  });

  await pipeline(res, fs.createWriteStream(tmpPath));

  if (totalSize > 0 && downloaded !== totalSize) {
    throw new Error(`Download incompleto (${downloaded}/${totalSize} byte)`);
  }

  onProgress({
    downloaded,
    total: totalSize || downloaded,
    percent: 100,
  });
}

/**
 * Scarica un file su `targetPath` passando da un `.tmp` e rinominando solo a
 * download completato. Un errore non lascia mai un modello parziale al posto
 * di quello buono.
 */
async function downloadFile({
  url,
  targetPath,
  onProgress = () => {},
  maxRedirects = DEFAULT_MAX_REDIRECTS,
}) {
  ensureDirSync(path.dirname(targetPath));
  const tmpPath = `${targetPath}.tmp`;

  try {
    let currentUrl = url;

    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const res = await request(currentUrl);

      if (REDIRECT_CODES.has(res.statusCode)) {
        const location = res.headers.location;
        res.destroy();
        if (!location) throw new Error('Redirect senza Location');
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (res.statusCode !== 200) {
        res.destroy();
        throw new Error(`HTTP ${res.statusCode}`);
      }

      await writeResponse(res, tmpPath, onProgress);
      fs.renameSync(tmpPath, targetPath);
      return { targetPath, url: currentUrl };
    }

    throw new Error('Troppi redirect');
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    throw err;
  }
}

/**
 * Wrapper con callback usato da main.js. Evita download concorrenti dello
 * stesso target: il secondo richiedente viene semplicemente ignorato.
 */
const activeDownloads = new Set();

function downloadModelFile({ url, targetPath, onProgress, onDone, onError }) {
  if (activeDownloads.has(targetPath)) return;
  activeDownloads.add(targetPath);

  downloadFile({ url, targetPath, onProgress })
    .then(
      () => onDone(),
      (err) => onError(err.message),
    )
    .finally(() => activeDownloads.delete(targetPath));
}

module.exports = {
  DEFAULT_MAX_REDIRECTS,
  downloadFile,
  downloadModelFile,
  writeResponse,
};
