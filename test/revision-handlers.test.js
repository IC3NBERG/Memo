'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createEditsSaveHandler,
  createRevisionCreateHandler,
  createRevisionListHandler,
  createRevisionSwitchHandler,
  createSearchHandler,
} = require('../src/main/handlers');
const { createPathGuard } = require('../src/core/storage/path-guard');
const transcriptStore = require('../src/core/transcript/store');
const { tempDir, cleanup } = require('./helpers');

function setup(root) {
  const recordingsDir = path.join(root, 'archive');
  const recDir = path.join(recordingsDir, '_unsorted', 'Lezione');
  fs.mkdirSync(recDir, { recursive: true });
  const metadata = transcriptStore.createMetadataForNewRecording({
    name: 'Lezione',
    date: new Date('2025-06-07T08:00:00.000Z'),
    folder: null,
  });
  fs.writeFileSync(path.join(recDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  return { recordingsDir, recDir, pathGuard: createPathGuard(recordingsDir) };
}

function addRevision(recDir, text, kind = 'transcription') {
  return transcriptStore.createRevision(recDir, {
    kind,
    source: {
      engine: 'whisper-cli',
      model: 'modello.bin',
      language: 'it',
      complete: true,
      translated: false,
      timing: 'segment',
    },
    segments: [{ start: 0, end: 2, text }],
  });
}

test('revision:list elenca le revisioni e il puntatore attivo', () => {
  const root = tempDir();
  try {
    const { recDir, pathGuard } = setup(root);
    addRevision(recDir, 'prima');
    addRevision(recDir, 'seconda');

    const list = createRevisionListHandler({ pathGuard, store: transcriptStore });
    const result = list({ recDir });
    assert.equal(result.success, true);
    assert.equal(result.activeRevisionId, 'r2');
    assert.deepEqual(result.revisions.map((item) => item.revisionId), ['r1', 'r2']);
    assert.equal(result.revisions[1].kind, 'transcription');
    assert.equal(result.revisions[1].timing, 'segment');
  } finally {
    cleanup(root);
  }
});

test('revision:switch cambia la vista senza riscrivere le sorgenti', () => {
  const root = tempDir();
  try {
    const { recDir, pathGuard } = setup(root);
    addRevision(recDir, 'prima');
    addRevision(recDir, 'seconda');

    const switchRevision = createRevisionSwitchHandler({ pathGuard, store: transcriptStore });
    const result = switchRevision({ recDir, revisionId: 'r1' });
    assert.equal(result.success, true);
    assert.equal(result.revisionId, 'r1');
    assert.equal(result.transcript.text, 'prima');
    assert.equal(transcriptStore.readMetadata(recDir).activeRevisionId, 'r1');

    assert.equal(switchRevision({ recDir, revisionId: 'r9' }).success, false);
    assert.equal(switchRevision({ recDir: path.join(root, 'fuori'), revisionId: 'r1' }).success, false);
  } finally {
    cleanup(root);
  }
});

test('edits:save applica l’overlay con controllo di concorrenza', () => {
  const root = tempDir();
  try {
    const { recDir, pathGuard } = setup(root);
    addRevision(recDir, 'testo originale');
    const saveEdits = createEditsSaveHandler({ pathGuard, store: transcriptStore });

    const view = transcriptStore.readActiveTranscript(recDir).transcript;
    const edits = {
      ...view.edits,
      segmentText: { 'r1-s0001': 'testo corretto' },
      tags: { 'r1-s0001': ['importante'] },
    };

    const saved = saveEdits({
      recDir,
      edits,
      expectedEditRevision: view.edits.editRevision,
    });
    assert.equal(saved.success, true);
    assert.equal(saved.transcript.text, 'testo corretto');
    assert.equal(saved.transcript.edits.editRevision, view.edits.editRevision + 1);
    assert.deepEqual(saved.transcript.edits.tags['r1-s0001'], ['importante']);

    const conflict = saveEdits({
      recDir,
      edits,
      expectedEditRevision: view.edits.editRevision,
    });
    assert.equal(conflict.success, false);
    assert.equal(conflict.code, 'edit-revision-mismatch');
  } finally {
    cleanup(root);
  }
});

test('revision:create-from-text archivia la revisione precedente', () => {
  const root = tempDir();
  try {
    const { recDir, pathGuard } = setup(root);
    addRevision(recDir, 'prima');
    const create = createRevisionCreateHandler({ pathGuard, store: transcriptStore });

    const result = create({
      recDir,
      kind: 'transcription',
      text: 'testo legacy convertito',
      timing: 'whole-recording',
    });
    assert.equal(result.success, true);
    assert.equal(result.revisionId, 'r2');
    assert.equal(result.transcript.text, 'testo legacy convertito');
    assert.equal(result.transcript.timing, 'whole-recording');
    assert.deepEqual(
      transcriptStore.listRevisions(recDir).map((item) => item.revisionId),
      ['r1', 'r2'],
    );
  } finally {
    cleanup(root);
  }
});

test('search:query espone i risultati con parti evidenziabili', () => {
  const handler = createSearchHandler({
    getIndex: () => ({
      search: () => [{
        recId: '/archive/Lezione',
        name: 'Lezione',
        folder: null,
        updatedAt: null,
        snippet: 'la \u0001cellula\u0002 è viva',
        score: 0,
      }],
    }),
  });

  const result = handler({ query: 'cellula' });
  assert.equal(result.success, true);
  assert.equal(result.results[0].recId, '/archive/Lezione');
  assert.deepEqual(result.results[0].snippetParts[1], {
    text: 'cellula',
    highlighted: true,
  });
});

test('search:query segnala l’indice non disponibile', () => {
  const handler = createSearchHandler({ getIndex: () => null });
  const result = handler({ query: 'test' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'index-unavailable');
});
