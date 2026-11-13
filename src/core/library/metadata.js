'use strict';

const path = require('path');

const { readJsonSafe, writeJsonAtomicSync } = require('../storage/atomic');
const { SCHEMA_VERSIONS } = require('../transcript/constants');
const { documentVersion } = require('../transcript/compatibility');
const { updateManifest } = require('./manifest');

function metadataPath(recDir) {
  return path.join(recDir, 'metadata.json');
}

/**
 * Lettura tollerante per la libreria: un metadata corrotto non deve impedire
 * di mostrare le altre registrazioni.
 */
function readMetadataFile(recDir) {
  const result = readJsonSafe(metadataPath(recDir));
  const value = result.ok ? result.value : null;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * Aggiornamento atomico del metadata. Funziona sia su v1 sia su v2: il
 * chiamante decide quali campi toccare, senza riscrivere il resto.
 */
function updateMetadataFile(recDir, mutate) {
  const current = readMetadataFile(recDir);
  if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
  // Una versione futura è in sola lettura: non riscriviamo nemmeno i campi noti.
  if (documentVersion(current, 'metadata') > SCHEMA_VERSIONS.metadata) return false;

  const next = mutate({ ...current });
  if (!next || typeof next !== 'object' || Array.isArray(next)) return false;

  writeJsonAtomicSync(metadataPath(recDir), next);
  updateManifest(recDir, { changedPaths: ['metadata.json'] });
  return true;
}

module.exports = {
  metadataPath,
  readMetadataFile,
  updateMetadataFile,
};
