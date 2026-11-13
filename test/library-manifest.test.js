'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  MANIFEST_FILE,
  readManifest,
  recordingStats,
  updateManifest,
  verifyManifest,
  writeManifest,
} = require('../src/core/library/manifest');
const { tempDir, readJson, cleanup } = require('./helpers');

function createRecording(root) {
  const rec = path.join(root, 'rec');
  fs.mkdirSync(rec, { recursive: true });
  fs.writeFileSync(path.join(rec, 'metadata.json'), JSON.stringify({
    schemaVersion: 2,
    id: 'rec-1',
    createdAt: '2025-06-07T08:00:00.000Z',
    updatedAt: '2025-06-07T08:00:00.000Z',
    name: 'Lezione',
    date: '2025-06-07T08:00:00.000Z',
    folder: null,
    duration: 12,
    hasTranscript: false,
    isCompleteTranscript: false,
    isLivePreview: false,
    isTranslated: false,
    activeRevisionId: null,
    revisions: [],
    previewReplacedAt: null,
  }, null, 2));
  fs.writeFileSync(path.join(rec, 'audio.wav'), 'RIFF-audio-0123456789');
  return rec;
}

test('crea un manifest con SHA-256 e SHA-512 per ogni file utente', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const manifest = writeManifest(rec, {
      now: () => '2025-06-07T09:00:00.000Z',
    });

    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.recordingId, 'rec-1');
    assert.deepEqual(manifest.algorithms, ['sha256', 'sha512']);
    assert.equal(manifest.fileCount, 2);
    assert.equal(manifest.totalBytes, fs.statSync(path.join(rec, 'audio.wav')).size
      + fs.statSync(path.join(rec, 'metadata.json')).size);
    assert.equal(manifest.createdAt, '2025-06-07T09:00:00.000Z');
    assert.equal(manifest.updatedAt, '2025-06-07T09:00:00.000Z');

    const audio = manifest.files.find((entry) => entry.path === 'audio.wav');
    assert.match(audio.sha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(audio.sha512, /^sha512:[a-f0-9]{128}$/);
    assert.equal(manifest.files.some((entry) => entry.path === MANIFEST_FILE), false);

    const read = readManifest(rec);
    assert.equal(read.ok, true);
    assert.deepEqual(read.value.files, manifest.files);
  } finally {
    cleanup(root);
  }
});

test('verifyManifest rileva file mancanti, modificati e non tracciati', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    writeManifest(rec);

    let report = verifyManifest(rec);
    assert.equal(report.status, 'ok');
    assert.equal(report.summary.total, 2);
    assert.equal(report.summary.ok, 2);

    fs.writeFileSync(path.join(rec, 'audio.wav'), 'RIFF-audio-XXXXXXXXXX');
    report = verifyManifest(rec);
    assert.equal(report.status, 'error');
    assert.equal(report.summary.modified, 1);
    const modified = report.files.find((entry) => entry.state === 'modified');
    assert.equal(modified.path, 'audio.wav');
    assert.equal(modified.reason, 'hash');
    assert.equal(modified.hashVerified, true);

    fs.writeFileSync(path.join(rec, 'extra.txt'), 'non nel manifest');
    report = verifyManifest(rec);
    assert.equal(report.status, 'error');
    assert.equal(report.summary.untracked, 1);
    assert.equal(report.files.find((entry) => entry.path === 'extra.txt').state, 'untracked');
    assert.equal(report.summary.modified, 1);

    fs.unlinkSync(path.join(rec, 'metadata.json'));
    report = verifyManifest(rec);
    assert.equal(report.summary.missing, 1);
    assert.equal(report.files.find((entry) => entry.path === 'metadata.json').state, 'missing');
  } finally {
    cleanup(root);
  }
});

test('la verifica superficiale controlla presenza e dimensione, non gli hash', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    writeManifest(rec);

    fs.writeFileSync(path.join(rec, 'audio.wav'), 'RIFF-audio-XXXXXXXXXX');
    const shallow = verifyManifest(rec, { deep: false });
    assert.equal(shallow.status, 'ok');
    assert.equal(shallow.summary.ok, 2);
    assert.equal(shallow.summary.unverified, 2);
    assert.equal(shallow.files.every((entry) => entry.hashVerified === false), true);

    fs.writeFileSync(path.join(rec, 'audio.wav'), 'corto');
    const sizeChanged = verifyManifest(rec, { deep: false });
    assert.equal(sizeChanged.status, 'error');
    assert.equal(sizeChanged.summary.modified, 1);
    assert.equal(sizeChanged.files.find((entry) => entry.state === 'modified').reason, 'size');
  } finally {
    cleanup(root);
  }
});

test('updateManifest aggiorna i digest senza perdere createdAt', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const first = writeManifest(rec, { now: () => '2025-06-07T09:00:00.000Z' });

    fs.writeFileSync(path.join(rec, 'audio.wav'), 'RIFF-audio-ABCDEFGHIJ');
    const result = updateManifest(rec, {
      changedPaths: ['audio.wav'],
      now: () => '2025-06-07T10:00:00.000Z',
    });
    assert.equal(result.success, true);
    assert.equal(result.manifest.createdAt, first.createdAt);
    assert.equal(result.manifest.updatedAt, '2025-06-07T10:00:00.000Z');
    assert.notEqual(
      result.manifest.files.find((entry) => entry.path === 'audio.wav').sha256,
      first.files.find((entry) => entry.path === 'audio.wav').sha256,
    );
    assert.equal(verifyManifest(rec).status, 'ok');
  } finally {
    cleanup(root);
  }
});

test('un manifest assente o corrotto viene segnalato senza inventare dati', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);

    const missing = verifyManifest(rec);
    assert.equal(missing.status, 'missing');
    assert.equal(missing.code, 'missing-manifest');
    assert.equal(missing.summary.untracked, 2);

    fs.writeFileSync(path.join(rec, MANIFEST_FILE), '{ rotto');
    const invalid = verifyManifest(rec);
    assert.equal(invalid.status, 'invalid');
    assert.equal(invalid.code, 'invalid-manifest');
  } finally {
    cleanup(root);
  }
});

test('recordingStats riporta numero file, dimensione e stato del manifest', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const before = recordingStats(rec);
    assert.equal(before.fileCount, 2);
    assert.equal(before.hasManifest, false);

    writeManifest(rec);
    const after = recordingStats(rec);
    assert.equal(after.hasManifest, true);
    assert.equal(after.manifestStatus, 'ok');
    assert.equal(after.totalBytes, readJson(path.join(rec, MANIFEST_FILE)).totalBytes);
  } finally {
    cleanup(root);
  }
});

test('updateManifest non lancia con un percorso non valido', () => {
  const result = updateManifest(null, {});
  assert.equal(result.success, false);
  assert.equal(typeof result.error, 'string');
});
