'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  readMetadataFile,
  updateMetadataFile,
} = require('../src/core/library/metadata');
const { createMetadataForNewRecording } = require('../src/core/transcript/store');
const { tempDir, readJson, cleanup } = require('./helpers');

function createRecording(root) {
  const rec = path.join(root, 'rec');
  fs.mkdirSync(rec, { recursive: true });
  const metadata = createMetadataForNewRecording({
    name: 'Lezione',
    date: new Date('2025-06-07T08:00:00.000Z'),
    folder: null,
  });
  metadata.revisions = [{
    revisionId: 'r1',
    kind: 'transcription',
    createdAt: metadata.createdAt,
    complete: true,
    translated: false,
    model: null,
    language: null,
    targetLanguage: null,
    timing: 'segment',
  }];
  metadata.activeRevisionId = 'r1';
  fs.writeFileSync(path.join(rec, 'metadata.json'), JSON.stringify(metadata, null, 2));
  return { rec, metadata };
}

test('updateMetadataFile cambia solo i campi richiesti', () => {
  const root = tempDir();
  try {
    const { rec, metadata } = createRecording(root);

    const updated = updateMetadataFile(rec, (draft) => ({ ...draft, folder: 'Università' }));
    assert.equal(updated, true);

    const onDisk = readJson(path.join(rec, 'metadata.json'));
    assert.equal(onDisk.folder, 'Università');
    assert.equal(onDisk.schemaVersion, 2);
    assert.equal(onDisk.activeRevisionId, 'r1');
    assert.deepEqual(onDisk.revisions, metadata.revisions);
    assert.deepEqual(fs.readdirSync(rec), ['metadata.json']);
  } finally {
    cleanup(root);
  }
});

test('updateMetadataFile non tocca un metadata corrotto', () => {
  const root = tempDir();
  try {
    const rec = path.join(root, 'corrotto');
    fs.mkdirSync(rec);
    const file = path.join(rec, 'metadata.json');
    fs.writeFileSync(file, '{ rotto');

    assert.equal(readMetadataFile(rec), null);
    assert.equal(updateMetadataFile(rec, (draft) => ({ ...draft, name: 'x' })), false);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ rotto');
  } finally {
    cleanup(root);
  }
});

test('readMetadataFile restituisce null per registrazione inesistente', () => {
  const root = tempDir();
  try {
    assert.equal(readMetadataFile(path.join(root, 'manca')), null);
  } finally {
    cleanup(root);
  }
});
