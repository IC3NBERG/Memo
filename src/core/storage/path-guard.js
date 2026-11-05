'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Guardia per i percorsi dell'archivio. Non basta path.resolve(): un symlink
 * dentro l'archivio può puntare fuori. Per i percorsi esistenti usiamo il
 * realpath; per quelli nuovi risolviamo l'antenato esistente più vicino.
 */
function createPathGuard(rootDir) {
  const rootResolved = path.resolve(rootDir);

  function realpathIfExists(target) {
    try {
      return fs.realpathSync.native(target);
    } catch (_) {
      return null;
    }
  }

  function realRoot() {
    return realpathIfExists(rootResolved) || rootResolved;
  }

  function resolveNearest(target) {
    const resolved = path.resolve(target);
    const existing = realpathIfExists(resolved);
    if (existing) return existing;

    const missing = [];
    let current = resolved;

    while (true) {
      const real = realpathIfExists(current);
      if (real) {
        return path.join(real, ...missing.reverse());
      }
      const parent = path.dirname(current);
      if (parent === current) return null;
      missing.push(path.basename(current));
      current = parent;
    }
  }

  function normalize(target) {
    if (typeof target !== 'string' || target.length === 0) return null;
    if (target.includes('\0')) return null;
    return resolveNearest(target);
  }

  function isInside(target) {
    const normalized = normalize(target);
    if (!normalized) return false;
    const root = realRoot();
    return normalized !== root && normalized.startsWith(root + path.sep);
  }

  function isInsideOrEqual(target) {
    const normalized = normalize(target);
    if (!normalized) return false;
    const root = realRoot();
    return normalized === root || normalized.startsWith(root + path.sep);
  }

  function isValidRecordingDir(target) {
    if (!isInside(target)) return false;
    try {
      return fs.statSync(target).isDirectory();
    } catch (_) {
      return false;
    }
  }

  function isValidParentForNewPath(target) {
    const parent = path.dirname(path.resolve(target));
    return isInsideOrEqual(parent);
  }

  return {
    root: rootResolved,
    realRoot,
    normalize,
    isInside,
    isInsideOrEqual,
    isValidRecordingDir,
    isValidParentForNewPath,
  };
}

function isSafeFolderName(name) {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 80
    && name !== '.'
    && name !== '..'
    && !name.startsWith('.')
    && !name.includes('/')
    && !name.includes('\\')
    && !name.includes('\0');
}

module.exports = {
  createPathGuard,
  isSafeFolderName,
};
