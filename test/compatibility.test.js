'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  describeCompatibility,
  isFutureVersion,
} = require('../src/core/transcript/compatibility');
const {
  createMetadataForNewRecording,
  createRevision,
  readActiveTranscript,
  resetOverlay,
  saveEdits,
  saveLegacyTranscript,
  switchActiveRevision,
} = require('../src/core/transcript/store');
const { ensureRecordingMigrated } = require('../src/core/transcript/migrate');
const { updateMetadataFile } = require('../src/core/library/metadata');
const { tempDir, readJson, cleanup } = require('./helpers');

function createRecording(root) {
  const rec = path.join(root, 'rec');
  fs.mkdirSync(rec, { recursive: true });
  const metadata = createMetadataForNewRecording({
    name: 'Lezione',
    date: new Date('2025-06-07T08:00:00.000Z'),
    folder: null,
  });
  fs.writeFileSync(path.join(rec, 'metadata.json'), JSON.stringify(metadata, null, 2));
  const revision = createRevision(rec, {
    kind: 'transcription',
    source: { engine: 'whisper-cli', model: null, language: 'it', complete: true },
    segments: [{ start: 0, end: 5, text: 'testo' }],
  });
  assert.equal(revision.success, true);
  return rec;
}

function setDocumentVersion(file, version) {
  const document = readJson(file);
  document.schemaVersion = version;
  fs.writeFileSync(file, JSON.stringify(document, null, 2));
  return document;
}

test('describeCompatibility distingue apertura, migrazione, futuro e rifiuto', () => {
  const current = describeCompatibility('metadata', 2);
  assert.equal(current.action, 'open');
  assert.equal(current.writable, true);

  const legacy = describeCompatibility('metadata', 1);
  assert.equal(legacy.action, 'migrate');
  assert.equal(legacy.writable, false);
  assert.equal(legacy.readable, true);

  const future = describeCompatibility('metadata', 99);
  assert.equal(future.action, 'read-only-future');
  assert.equal(future.readable, true);
  assert.equal(future.writable, false);
  assert.match(future.message, /sola lettura/);

  const unknown = describeCompatibility('sconosciuto', 1);
  assert.equal(unknown.action, 'reject');
  assert.equal(unknown.readable, false);

  assert.equal(isFutureVersion('transcript', 99), true);
  assert.equal(isFutureVersion('transcript', 2), false);
});

test('un metadata futuro con campi noti validi si apre in sola lettura senza scrivere', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const metadataPath = path.join(rec, 'metadata.json');
    setDocumentVersion(metadataPath, 99);
    const before = fs.readFileSync(metadataPath, 'utf8');
    const entriesBefore = fs.readdirSync(path.join(rec, '.revisions')).sort();

    const migration = ensureRecordingMigrated(rec);
    assert.equal(migration.migrated, false);
    assert.equal(migration.readOnly, true);
    assert.equal(migration.compatibility.action, 'read-only-future');

    const view = readActiveTranscript(rec);
    assert.equal(view.success, true);
    assert.equal(view.readOnly, true);
    assert.equal(view.transcript.text, 'testo');
    assert.equal(fs.readFileSync(metadataPath, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(path.join(rec, '.revisions')).sort(), entriesBefore);
  } finally {
    cleanup(root);
  }
});

test('in sola lettura tutte le scritture vengono rifiutate e i file restano intatti', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    setDocumentVersion(path.join(rec, 'metadata.json'), 99);
    const metadataBefore = fs.readFileSync(path.join(rec, 'metadata.json'), 'utf8');
    const transcriptPath = path.join(rec, '.revisions', 'r1', 'transcript.json');
    const transcriptBefore = fs.readFileSync(transcriptPath, 'utf8');

    const results = [
      createRevision(rec, {
        kind: 'transcription',
        source: { complete: true },
        segments: [{ start: 0, end: 1, text: 'nuovo' }],
      }),
      saveEdits(rec, { segmentText: { 'r1-s0001': 'modificato' } }),
      resetOverlay(rec),
      switchActiveRevision(rec, 'r1'),
      saveLegacyTranscript(rec, { transcript: { text: 'legacy' } }),
    ];
    for (const result of results) {
      assert.equal(result.success, false);
      assert.equal(result.code, 'read-only-future');
    }

    assert.equal(updateMetadataFile(rec, (draft) => ({ ...draft, name: 'Rinominata' })), false);
    assert.equal(fs.readFileSync(path.join(rec, 'metadata.json'), 'utf8'), metadataBefore);
    assert.equal(fs.readFileSync(transcriptPath, 'utf8'), transcriptBefore);
    assert.deepEqual(fs.readdirSync(path.join(rec, '.revisions')).sort(), ['r1']);
  } finally {
    cleanup(root);
  }
});

test('un metadata futuro con struttura rotta viene rifiutato', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const metadataPath = path.join(rec, 'metadata.json');
    const metadata = setDocumentVersion(metadataPath, 99);
    delete metadata.duration;
    delete metadata.revisions;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    const before = fs.readFileSync(metadataPath, 'utf8');

    assert.throws(
      () => ensureRecordingMigrated(rec),
      (err) => err.code === 'unsupported-schema',
    );
    assert.equal(fs.readFileSync(metadataPath, 'utf8'), before);
  } finally {
    cleanup(root);
  }
});

test('una trascrizione con schema futuro si apre in sola lettura e non viene riscritta', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const transcriptPath = path.join(rec, '.revisions', 'r1', 'transcript.json');
    setDocumentVersion(transcriptPath, 99);
    const before = fs.readFileSync(transcriptPath, 'utf8');

    const view = readActiveTranscript(rec);
    assert.equal(view.success, true);
    assert.equal(view.readOnly, true);
    assert.equal(view.transcript.repaired, false);
    assert.equal(view.transcript.text, 'testo');
    assert.equal(view.transcript.compatibility.action, 'read-only-future');
    assert.equal(fs.readFileSync(transcriptPath, 'utf8'), before);

    const saved = saveEdits(rec, { segmentText: { 'r1-s0001': 'modificato' } });
    assert.equal(saved.success, false);
    assert.equal(saved.code, 'read-only-future');

    const reset = resetOverlay(rec);
    assert.equal(reset.success, false);
    assert.equal(reset.code, 'read-only-future');

    const switched = switchActiveRevision(rec, 'r1');
    assert.equal(switched.success, false);
    assert.equal(switched.code, 'read-only-future');

    const legacy = saveLegacyTranscript(rec, { transcript: { text: 'altro' } });
    assert.equal(legacy.success, false);
    assert.equal(legacy.code, 'read-only-future');
  } finally {
    cleanup(root);
  }
});
