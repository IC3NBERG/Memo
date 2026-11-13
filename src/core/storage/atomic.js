'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fsyncDir(dir) {
  // Su macOS/Linux rende il rename persistente. Su Windows può non essere
  // supportato: non è un errore fatale.
  try {
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch (_) {}
}

function tmpPathFor(file) {
  const suffix = crypto.randomBytes(6).toString('hex');
  return path.join(
    path.dirname(file),
    `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}-${suffix}`,
  );
}

function writeFileAtomicSync(file, data) {
  ensureDirSync(path.dirname(file));
  const tmp = tmpPathFor(file);
  let fd = null;

  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
    fsyncDir(path.dirname(file));
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

function writeJsonAtomicSync(file, value) {
  writeFileAtomicSync(file, serializeJson(value));
}

function writeTextAtomicSync(file, text) {
  writeFileAtomicSync(file, String(text ?? ''));
}

function readJsonSafe(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return { ok: true, value: JSON.parse(raw), raw };
  } catch (err) {
    return {
      ok: false,
      code: err.code === 'ENOENT' ? 'ENOENT' : 'INVALID_JSON',
      error: err.message,
    };
  }
}

function readJsonStrict(file) {
  const result = readJsonSafe(file);
  if (!result.ok) {
    const err = new Error(
      result.code === 'ENOENT'
        ? `File non trovato: ${file}`
        : `JSON non valido: ${file}`,
    );
    err.code = result.code;
    throw err;
  }
  return result.value;
}

function sha256(data) {
  return `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;
}

function sha512(data) {
  return `sha512:${crypto.createHash('sha512').update(data).digest('hex')}`;
}

function sha256Buffer(buffer) {
  return sha256(buffer);
}

function sha512Buffer(buffer) {
  return sha512(buffer);
}

function sha256Json(value) {
  return sha256(Buffer.from(serializeJson(value), 'utf8'));
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function sha512File(file) {
  return sha512(fs.readFileSync(file));
}

function fileDigests(file) {
  const data = fs.readFileSync(file);
  return {
    sha256: sha256(data),
    sha512: sha512(data),
  };
}

function copyFileSync(src, dest) {
  ensureDirSync(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function removeDirIfExists(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function listDirectories(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

module.exports = {
  ensureDirSync,
  serializeJson,
  writeFileAtomicSync,
  writeJsonAtomicSync,
  writeTextAtomicSync,
  readJsonSafe,
  readJsonStrict,
  sha256Buffer,
  sha512Buffer,
  sha256Json,
  sha256File,
  sha512File,
  fileDigests,
  copyFileSync,
  removeDirIfExists,
  listDirectories,
};
