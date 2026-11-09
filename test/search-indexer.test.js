'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

let Database = null;
try {
  Database = require('better-sqlite3');
  const probe = new Database(':memory:');
  probe.exec('CREATE VIRTUAL TABLE probe_fts USING fts5(x)');
  probe.close();
} catch (_) {
  Database = null;
}

const { openSearchIndex } = require('../src/core/search/index');
const {
  buildIndexRecord,
  folderFromPath,
  indexRecording,
  removeRecording,
} = require('../src/core/search/recording-indexer');
const transcriptStore = require('../src/core/transcript/store');
const { tempDir, cleanup } = require('./helpers');

const sqliteTest = Database ? test : test.skip;

function createRecording(root, folder = 'Università') {
  const base = folder ? path.join(root, 'archive', folder) : path.join(root, 'archive', '_unsorted');
  const recDir = path.join(base, 'Lezione');
  fs.mkdirSync(recDir, { recursive: true });

  const metadata = transcriptStore.createMetadataForNewRecording({
    name: 'Lezione di biologia',
    date: new Date('2025-06-07T08:00:00.000Z'),
    folder: folder || null,
  });
  fs.writeFileSync(path.join(recDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  transcriptStore.createRevision(recDir, {
    kind: 'transcription',
    source: {
      engine: 'whisper-cli',
      model: 'modello.bin',
      language: 'it',
      complete: true,
      translated: false,
      timing: 'segment',
    },
    segments: [
      { start: 0, end: 3, text: 'La fotosintesi clorofilliana.' },
      { start: 3, end: 6, text: 'Il nucleo contiene il DNA.' },
    ],
  });

  return recDir;
}

test('folderFromPath ignora _unsorted e i percorsi esterni', () => {
  const root = '/archive';
  assert.equal(folderFromPath('/archive/Universita/rec', root), 'Universita');
  assert.equal(folderFromPath('/archive/_unsorted/rec', root), null);
  assert.equal(folderFromPath('/archive/rec', root), null);
  assert.equal(folderFromPath('/elsewhere/rec', root), null);
});

sqliteTest('indicizza la proiezione della revisione attiva, non i derivati', () => {
  const root = tempDir();
  try {
    const recordingsDir = path.join(root, 'archive');
    const recDir = createRecording(root);
    const index = openSearchIndex({ dbPath: path.join(root, '.index', 'search.sqlite3') });

    const result = indexRecording({ index, store: transcriptStore, recDir, recordingsDir });
    assert.equal(result.indexed, true);
    assert.equal(result.changed, true);

    assert.equal(index.search('fotosintesi')[0].recId, recDir);
    assert.equal(index.search('biologia')[0].recId, recDir);
    assert.equal(index.search('universita')[0].recId, recDir);

    // L'override dell'overlay cambia il testo effettivo indicizzato.
    const edits = transcriptStore.readActiveTranscript(recDir).transcript.edits;
    edits.segmentText = { 'r1-s0001': 'La respirazione cellulare.' };
    transcriptStore.saveEdits(recDir, edits);

    const reindexed = indexRecording({ index, store: transcriptStore, recDir, recordingsDir });
    assert.equal(reindexed.changed, true);
    assert.equal(index.search('fotosintesi').length, 0);
    assert.equal(index.search('respirazione').length, 1);

    // La copia derivata nella root non deve essere la sorgente dell'indice.
    fs.writeFileSync(path.join(recDir, 'transcript.txt'), 'testo derivato sbagliato');
    indexRecording({ index, store: transcriptStore, recDir, recordingsDir });
    assert.equal(index.search('sbagliato').length, 0);

    index.close();
  } finally {
    cleanup(root);
  }
});

sqliteTest('spostare una registrazione aggiorna l’identificativo indicizzato', () => {
  const root = tempDir();
  try {
    const recordingsDir = path.join(root, 'archive');
    const recDir = createRecording(root);
    const index = openSearchIndex({ dbPath: path.join(root, '.index', 'search.sqlite3') });
    indexRecording({ index, store: transcriptStore, recDir, recordingsDir });

    const moved = path.join(root, 'archive', '_unsorted', 'Lezione');
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.renameSync(recDir, moved);
    const movedMetadataPath = path.join(moved, 'metadata.json');
    const movedMetadata = JSON.parse(fs.readFileSync(movedMetadataPath, 'utf8'));
    movedMetadata.folder = null;
    fs.writeFileSync(movedMetadataPath, JSON.stringify(movedMetadata, null, 2));

    removeRecording(index, recDir);
    indexRecording({ index, store: transcriptStore, recDir: moved, recordingsDir });

    const results = index.search('fotosintesi');
    assert.equal(results.length, 1);
    assert.equal(results[0].recId, moved);
    assert.equal(results[0].folder, null);
    index.close();
  } finally {
    cleanup(root);
  }
});

sqliteTest('buildIndexRecord non fallisce senza trascrizione', () => {
  const root = tempDir();
  try {
    const recordingsDir = path.join(root, 'archive');
    const recDir = path.join(recordingsDir, '_unsorted', 'Vuota');
    fs.mkdirSync(recDir, { recursive: true });
    const metadata = transcriptStore.createMetadataForNewRecording({
      name: 'Nota senza testo',
      date: new Date('2025-06-07T08:00:00.000Z'),
      folder: null,
    });
    fs.writeFileSync(path.join(recDir, 'metadata.json'), JSON.stringify(metadata));

    const record = buildIndexRecord({ store: transcriptStore, recDir, recordingsDir });
    assert.equal(record.name, 'Nota senza testo');
    assert.equal(record.body, '');
    assert.equal(record.folder, '');
  } finally {
    cleanup(root);
  }
});
