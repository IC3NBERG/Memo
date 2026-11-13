'use strict';

const fs = require('fs');
const path = require('path');

const { SCHEMA_VERSIONS } = require('../transcript/constants');
const {
  ensureDirSync,
  fileDigests,
  readJsonSafe,
  writeJsonAtomicSync,
} = require('../storage/atomic');

const MANIFEST_FILE = 'manifest.json';
const MANIFEST_SCHEMA_VERSION = SCHEMA_VERSIONS.manifest;
const HASH_ALGORITHMS = Object.freeze(['sha256', 'sha512']);

function isIgnoredName(name) {
  if (!name) return true;
  if (name === MANIFEST_FILE) return true;
  if (name === '.DS_Store') return true;
  if (name === '.trash-entry.json') return true;
  if (name.startsWith('.tmp-')) return true;
  if (name.includes('.tmp-')) return true;
  return false;
}

function relativePath(recDir, absolutePath) {
  return path.relative(recDir, absolutePath).split(path.sep).join('/');
}

/**
 * Inventario dei file reali della registrazione. Non segue i symlink: il
 * manifest descrive solo file regolari contenuti nella cartella.
 */
function walkRecordingFiles(recDir) {
  const result = [];
  if (!recDir || !fs.existsSync(recDir)) return result;

  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      if (isIgnoredName(entry.name)) continue;
      const absolutePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        let stat;
        try {
          stat = fs.statSync(absolutePath);
        } catch (_) {
          continue;
        }
        result.push({
          path: relativePath(recDir, absolutePath),
          absolutePath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
  };

  visit(recDir);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeManifestEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.path !== 'string' || entry.path.length === 0) return null;
  const size = Number(entry.size);
  if (!Number.isInteger(size) || size < 0) return null;
  if (typeof entry.sha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(entry.sha256)) return null;
  if (typeof entry.sha512 !== 'string' || !/^sha512:[a-f0-9]{128}$/.test(entry.sha512)) return null;
  return {
    path: entry.path,
    size,
    mtimeMs: Number.isFinite(Number(entry.mtimeMs)) ? Number(entry.mtimeMs) : null,
    sha256: entry.sha256,
    sha512: entry.sha512,
  };
}

function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest non è un oggetto'] };
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion deve essere ${MANIFEST_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(manifest.files)) {
    errors.push('files non è un array');
  } else {
    const seen = new Set();
    for (const entry of manifest.files) {
      const normalized = normalizeManifestEntry(entry);
      if (!normalized) {
        errors.push('voce manifest non valida');
        continue;
      }
      if (seen.has(normalized.path)) errors.push(`voce duplicata: ${normalized.path}`);
      seen.add(normalized.path);
    }
  }
  if (manifest.fileCount !== undefined && manifest.fileCount !== manifest.files?.length) {
    errors.push('fileCount non corrisponde a files');
  }
  return { ok: errors.length === 0, errors };
}

function readManifest(recDir) {
  const file = path.join(recDir, MANIFEST_FILE);
  const result = readJsonSafe(file);
  if (!result.ok) {
    return {
      ok: false,
      code: result.code === 'ENOENT' ? 'missing-manifest' : 'invalid-manifest',
      error: result.error,
    };
  }
  const validation = validateManifest(result.value);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'invalid-manifest',
      error: validation.errors.join('; '),
    };
  }
  return { ok: true, value: result.value };
}

function readManifestMetadataId(recDir) {
  const result = readJsonSafe(path.join(recDir, 'metadata.json'));
  if (!result.ok || !result.value || typeof result.value !== 'object') return null;
  return typeof result.value.id === 'string' ? result.value.id : null;
}

function buildManifest(recDir, {
  previous = null,
  changedPaths = null,
  now = () => new Date().toISOString(),
} = {}) {
  const previousByPath = new Map(
    (previous?.files || [])
      .map((entry) => [entry.path, entry]),
  );
  const changed = changedPaths ? new Set(changedPaths) : null;
  const files = walkRecordingFiles(recDir).map((entry) => {
    const old = previousByPath.get(entry.path);
    const reusable = old
      && old.size === entry.size
      && Number(old.mtimeMs) === Number(entry.mtimeMs)
      && typeof old.sha256 === 'string'
      && typeof old.sha512 === 'string'
      && (!changed || !changed.has(entry.path));

    const digests = reusable
      ? { sha256: old.sha256, sha512: old.sha512 }
      : fileDigests(entry.absolutePath);

    return {
      path: entry.path,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      sha256: digests.sha256,
      sha512: digests.sha512,
    };
  });

  const createdAt = typeof previous?.createdAt === 'string' ? previous.createdAt : now();
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    recordingId: readManifestMetadataId(recDir),
    algorithms: [...HASH_ALGORITHMS],
    createdAt,
    updatedAt: now(),
    fileCount: files.length,
    totalBytes: files.reduce((total, entry) => total + entry.size, 0),
    files,
  };
}

function writeManifest(recDir, options = {}) {
  ensureDirSync(recDir);
  const previous = options.previous !== undefined
    ? options.previous
    : (readManifest(recDir).value || null);
  const manifest = buildManifest(recDir, { ...options, previous });
  writeJsonAtomicSync(path.join(recDir, MANIFEST_FILE), manifest);
  return manifest;
}

/**
 * Aggiornamento best-effort: il manifest non deve mai impedire il salvataggio
 * dei dati utente. Gli errori vengono restituiti, non lanciati.
 */
function updateManifest(recDir, options = {}) {
  try {
    return { success: true, manifest: writeManifest(recDir, options) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function verifyManifest(recDir, { deep = true } = {}) {
  const currentFiles = walkRecordingFiles(recDir);
  const currentByPath = new Map(currentFiles.map((entry) => [entry.path, entry]));
  const manifestResult = readManifest(recDir);

  if (!manifestResult.ok) {
    return {
      status: manifestResult.code === 'missing-manifest' ? 'missing' : 'invalid',
      code: manifestResult.code,
      error: manifestResult.error,
      files: currentFiles.map((entry) => ({
        path: entry.path,
        size: entry.size,
        state: 'untracked',
        hashVerified: false,
      })),
      summary: {
        total: currentFiles.length,
        ok: 0,
        missing: 0,
        modified: 0,
        untracked: currentFiles.length,
        unverified: currentFiles.length,
      },
      totalBytes: currentFiles.reduce((total, entry) => total + entry.size, 0),
    };
  }

  const manifest = manifestResult.value;
  const tracked = new Set();
  const files = [];
  const summary = {
    total: currentFiles.length,
    ok: 0,
    missing: 0,
    modified: 0,
    untracked: 0,
    unverified: 0,
  };

  for (const expected of manifest.files) {
    tracked.add(expected.path);
    const actual = currentByPath.get(expected.path);

    if (!actual) {
      summary.missing += 1;
      files.push({ ...expected, state: 'missing', hashVerified: false });
      continue;
    }

    if (actual.size !== expected.size) {
      summary.modified += 1;
      files.push({
        path: expected.path,
        size: actual.size,
        expectedSize: expected.size,
        state: 'modified',
        reason: 'size',
        hashVerified: false,
      });
      continue;
    }

    if (!deep) {
      summary.ok += 1;
      summary.unverified += 1;
      files.push({
        path: expected.path,
        size: actual.size,
        state: 'ok',
        hashVerified: false,
      });
      continue;
    }

    let digests;
    try {
      digests = fileDigests(actual.absolutePath);
    } catch (err) {
      summary.modified += 1;
      files.push({
        path: expected.path,
        size: actual.size,
        state: 'modified',
        reason: 'unreadable',
        error: err.message,
        hashVerified: false,
      });
      continue;
    }

    if (digests.sha256 !== expected.sha256 || digests.sha512 !== expected.sha512) {
      summary.modified += 1;
      files.push({
        path: expected.path,
        size: actual.size,
        state: 'modified',
        reason: 'hash',
        expectedSha256: expected.sha256,
        actualSha256: digests.sha256,
        hashVerified: true,
      });
      continue;
    }

    summary.ok += 1;
    files.push({
      path: expected.path,
      size: actual.size,
      state: 'ok',
      hashVerified: true,
    });
  }

  for (const entry of currentFiles) {
    if (tracked.has(entry.path)) continue;
    summary.untracked += 1;
    summary.unverified += 1;
    files.push({
      path: entry.path,
      size: entry.size,
      state: 'untracked',
      hashVerified: false,
    });
  }

  const status = summary.missing > 0 || summary.modified > 0
    ? 'error'
    : (summary.untracked > 0 ? 'warning' : 'ok');

  return {
    status,
    code: null,
    manifest: {
      schemaVersion: manifest.schemaVersion,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      algorithms: manifest.algorithms || [...HASH_ALGORITHMS],
    },
    files,
    summary,
    totalBytes: currentFiles.reduce((total, entry) => total + entry.size, 0),
  };
}

function recordingStats(recDir) {
  const files = walkRecordingFiles(recDir);
  const manifest = readManifest(recDir);
  return {
    fileCount: files.length,
    totalBytes: files.reduce((total, entry) => total + entry.size, 0),
    hasManifest: manifest.ok,
    manifestStatus: manifest.ok ? 'ok' : manifest.code,
  };
}

module.exports = {
  HASH_ALGORITHMS,
  MANIFEST_FILE,
  MANIFEST_SCHEMA_VERSION,
  buildManifest,
  isIgnoredName,
  readManifest,
  recordingStats,
  updateManifest,
  validateManifest,
  verifyManifest,
  walkRecordingFiles,
  writeManifest,
};
