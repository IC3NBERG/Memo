'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createRecordingSaveHandler,
  createTranscriptReadHandler,
  createTranscriptSaveHandler,
} = require('../src/main/handlers');
const { createPathGuard } = require('../src/core/storage/path-guard');
const transcriptStore = require('../src/core/transcript/store');
const { tempDir, copyFixture, readJson, cleanup } = require('./helpers');

function setup(root) {
  const recordingsDir = path.join(root, 'archive');
  const unsortedDir = path.join(recordingsDir, '_unsorted');
  fs.mkdirSync(unsortedDir, { recursive: true });
  return {
    recordingsDir,
    unsortedDir,
    pathGuard: createPathGuard(recordingsDir),
  };
}

test('recording:save crea audio e metadata v2 senza sovrascrivere', () => {
  const root = tempDir();
  try {
    const { recordingsDir, unsortedDir } = setup(root);
    const save = createRecordingSaveHandler({
      recordingsDir,
      unsortedDir,
      now: () => new Date('2025-06-07T08:09:10.000Z'),
    });

    const first = save({ buffer: Buffer.from('RIFF-audio'), name: 'Lezione 1' });
    assert.equal(first.success, true);
    assert.ok(fs.existsSync(path.join(first.recDir, 'audio.wav')));
    assert.equal(fs.readFileSync(path.join(first.recDir, 'audio.wav'), 'utf8'), 'RIFF-audio');

    const metadata = readJson(path.join(first.recDir, 'metadata.json'));
    assert.equal(metadata.schemaVersion, 2);
    assert.equal(metadata.name, 'Lezione 1');
    assert.equal(metadata.activeRevisionId, null);
    assert.deepEqual(metadata.revisions, []);

    const second = save({ buffer: Buffer.from('RIFF-audio-2'), name: 'Lezione 1' });
    assert.equal(second.success, true);
    assert.notEqual(second.recDir, first.recDir);
    assert.match(path.basename(second.recDir), /_1$/);
  } finally {
    cleanup(root);
  }
});

test('recording:save rifiuta gruppi non validi e audio mancante', () => {
  const root = tempDir();
  try {
    const { recordingsDir, unsortedDir } = setup(root);
    const save = createRecordingSaveHandler({ recordingsDir, unsortedDir });

    assert.deepEqual(save({ buffer: Buffer.from('x'), folder: '../fuori' }), {
      success: false,
      error: 'Gruppo non valido',
    });
    assert.deepEqual(save({ buffer: Buffer.from('x'), folder: '_unsorted' }), {
      success: false,
      error: 'Gruppo non valido',
    });
    assert.deepEqual(save({ name: 'Senza audio' }), {
      success: false,
      error: 'Audio mancante',
    });
    assert.deepEqual(save({ buffer: Buffer.alloc(0) }), {
      success: false,
      error: 'Audio mancante',
    });
  } finally {
    cleanup(root);
  }
});

test('transcript:read migra una v1 al primo accesso', () => {
  const root = tempDir();
  try {
    const { recordingsDir, pathGuard } = setup(root);
    const rec = copyFixture('live-preview', recordingsDir);
    const read = createTranscriptReadHandler({
      pathGuard,
      store: transcriptStore,
    });

    const result = read({ recDir: rec });
    assert.equal(result.success, true);
    assert.equal(result.revisionId, 'r1');
    assert.equal(result.kind, 'livePreview');
    assert.equal(result.transcript.text, "Questa è un'anteprima live parziale.");
    assert.ok(fs.existsSync(path.join(rec, '.revisions', 'r1', 'transcript.json')));
  } finally {
    cleanup(root);
  }
});

test('transcript:read e transcript:save rifiutano percorsi fuori archivio', () => {
  const root = tempDir();
  try {
    const { recordingsDir, pathGuard } = setup(root);
    const outside = path.join(root, 'fuori');
    fs.mkdirSync(outside);
    const read = createTranscriptReadHandler({ pathGuard, store: transcriptStore });
    const save = createTranscriptSaveHandler({ pathGuard, store: transcriptStore });

    assert.deepEqual(read({ recDir: outside }), {
      success: false,
      error: 'Registrazione non valida',
    });
    assert.deepEqual(save({ recDir: outside, transcript: { text: 'x' } }), {
      success: false,
      error: 'Registrazione non valida',
    });
  } finally {
    cleanup(root);
  }
});

test('transcript:save aggiorna l’overlay senza toccare la sorgente', () => {
  const root = tempDir();
  try {
    const { recordingsDir, pathGuard } = setup(root);
    const rec = path.join(recordingsDir, '_unsorted', 'lezione');
    fs.mkdirSync(rec, { recursive: true });
    fs.writeFileSync(
      path.join(rec, 'metadata.json'),
      JSON.stringify(transcriptStore.createMetadataForNewRecording({
        name: 'Lezione',
        date: new Date('2025-06-07T08:00:00.000Z'),
      }), null, 2),
    );
    transcriptStore.createRevision(rec, {
      kind: 'transcription',
      source: { engine: 'whisper-cli', model: 'm.bin', language: 'it', complete: true },
      segments: [
        { start: 0, end: 3, text: 'originale' },
        { start: 3, end: 6, text: 'secondo' },
      ],
    });

    const sourcePath = path.join(rec, '.revisions', 'r1', 'transcript.json');
    const sourceBefore = fs.readFileSync(sourcePath);

    const save = createTranscriptSaveHandler({ pathGuard, store: transcriptStore });
    const result = save({
      recDir: rec,
      transcript: { segments: [], text: 'testo riscritto' },
    });

    assert.equal(result.success, true);
    assert.equal(result.transcript.text, 'testo riscritto');
    assert.deepEqual(result.transcript.segments, []);
    assert.deepEqual(fs.readFileSync(sourcePath), sourceBefore);

    const edits = readJson(path.join(rec, '.revisions', 'r1', 'edits.json'));
    assert.equal(edits.legacyDocumentText, 'testo riscritto');
    assert.equal(edits.editRevision, 1);
  } finally {
    cleanup(root);
  }
});
