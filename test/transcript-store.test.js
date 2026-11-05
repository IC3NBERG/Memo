'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createMetadataForNewRecording,
  createRevision,
  listRevisions,
  readActiveTranscript,
  saveEdits,
  saveLegacyTranscript,
  switchActiveRevision,
} = require('../src/core/transcript/store');
const { sha256File } = require('../src/core/storage/atomic');
const { tempDir, readJson, cleanup } = require('./helpers');

function createRecording(root) {
  const rec = path.join(root, 'rec');
  fs.mkdirSync(rec, { recursive: true });
  const metadata = createMetadataForNewRecording({
    name: 'Lezione test',
    date: new Date('2025-06-07T08:00:00.000Z'),
    folder: null,
  });
  fs.writeFileSync(path.join(rec, 'metadata.json'), JSON.stringify(metadata, null, 2));
  return rec;
}

test('crea revisioni, archivia la precedente e mantiene il puntatore attivo', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const first = createRevision(rec, {
      kind: 'livePreview',
      source: {
        engine: null,
        model: null,
        language: null,
        targetLanguage: null,
        complete: false,
        translated: false,
        timing: 'whole-recording',
        format: 'legacy-save',
      },
      segments: [{ start: 0, end: 10, text: 'anteprima' }],
    });
    assert.equal(first.success, true);
    assert.equal(first.revisionId, 'r1');

    const second = createRevision(rec, {
      kind: 'transcription',
      source: {
        engine: 'whisper-cli',
        model: 'ggml-large-v3-turbo.bin',
        language: 'it',
        complete: true,
        translated: false,
      },
      segments: [
        { start: 0, end: 5, text: 'primo' },
        { start: 5, end: 10, text: 'secondo' },
      ],
    });
    assert.equal(second.success, true);
    assert.equal(second.revisionId, 'r2');

    const metadata = readJson(path.join(rec, 'metadata.json'));
    assert.equal(metadata.activeRevisionId, 'r2');
    assert.equal(metadata.isLivePreview, false);
    assert.equal(metadata.isCompleteTranscript, true);
    assert.ok(metadata.previewReplacedAt);

    assert.ok(fs.existsSync(path.join(rec, '.revisions', 'r1', 'transcript.json')));
    assert.ok(fs.existsSync(path.join(rec, '.revisions', 'r2', 'transcript.json')));
    assert.equal(readJson(path.join(rec, 'transcript.json')).revisionId, 'r2');
    assert.equal(fs.readFileSync(path.join(rec, 'transcript.txt'), 'utf8').trim(), 'primo secondo');

    const view = readActiveTranscript(rec);
    assert.equal(view.success, true);
    assert.equal(view.kind, 'transcription');
    assert.equal(view.transcript.text, 'primo secondo');

    assert.deepEqual(listRevisions(rec).map((item) => item.revisionId), ['r1', 'r2']);
  } finally {
    cleanup(root);
  }
});

test('salva il testo legacy senza modificare la sorgente', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    createRevision(rec, {
      kind: 'transcription',
      source: { engine: 'whisper-cli', model: null, language: 'it', complete: true },
      segments: [{ start: 0, end: 10, text: 'testo originale' }],
    });

    const sourcePath = path.join(rec, '.revisions', 'r1', 'transcript.json');
    const before = sha256File(sourcePath);

    const saved = saveLegacyTranscript(rec, {
      transcript: { segments: [], text: 'testo modificato' },
      isLivePreview: false,
      isTranslated: false,
    });
    assert.equal(saved.success, true);
    assert.equal(saved.transcript.text, 'testo modificato');
    assert.deepEqual(saved.transcript.segments, []);
    assert.equal(sha256File(sourcePath), before);

    const edits = readJson(path.join(rec, '.revisions', 'r1', 'edits.json'));
    assert.equal(edits.legacyDocumentText, 'testo modificato');
    assert.equal(edits.editRevision, 1);

    const view = readActiveTranscript(rec);
    assert.equal(view.success, true);
    assert.equal(view.transcript.text, 'testo modificato');
  } finally {
    cleanup(root);
  }
});

test('un salvataggio invariato non degrada la vista a legacyDocumentText', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    createRevision(rec, {
      kind: 'transcription',
      source: { engine: 'whisper-cli', model: null, language: 'it', complete: true },
      segments: [
        { start: 0, end: 5, text: 'uno' },
        { start: 5, end: 10, text: 'due' },
      ],
    });

    const saved = saveLegacyTranscript(rec, {
      transcript: { segments: [], text: 'uno\ndue\n' },
      isLivePreview: false,
      isTranslated: false,
    });
    assert.equal(saved.success, true);
    assert.deepEqual(saved.transcript.segments.map((segment) => segment.id), [
      'r1-s0001',
      'r1-s0002',
    ]);

    const edits = readJson(path.join(rec, '.revisions', 'r1', 'edits.json'));
    assert.equal(edits.legacyDocumentText, undefined);
  } finally {
    cleanup(root);
  }
});

test('salva overlay per segmento e rileva edits stale', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    createRevision(rec, {
      kind: 'transcription',
      source: { engine: 'whisper-cli', model: null, language: 'it', complete: true },
      segments: [
        { start: 0, end: 5, text: 'uno' },
        { start: 5, end: 10, text: 'due' },
      ],
    });

    const saved = saveEdits(rec, {
      segmentText: { 'r1-s0001': 'uno corretto' },
      hiddenSegmentIds: ['r1-s0002'],
      order: ['r1-s0002'],
      groups: [{ id: 'g1', title: 'Gruppo', segmentIds: ['r1-s0001', 'r1-s9999'] }],
    });
    assert.equal(saved.success, true);
    assert.equal(saved.transcript.text, 'uno corretto');
    assert.deepEqual(saved.transcript.segments.map((segment) => segment.id), ['r1-s0001']);
    assert.equal(saved.edits.editRevision, 1);
    assert.deepEqual(saved.edits.groups[0].segmentIds, ['r1-s0001']);

    const sourcePath = path.join(rec, '.revisions', 'r1', 'transcript.json');
    const source = readJson(sourcePath);
    source.segments[0].text = 'manomesso fuori dall’app';
    fs.writeFileSync(sourcePath, JSON.stringify(source, null, 2));

    const stale = readActiveTranscript(rec);
    assert.equal(stale.success, true);
    assert.equal(stale.editsStatus, 'stale-edits');
    assert.equal(stale.transcript.text, 'manomesso fuori dall’app due');
  } finally {
    cleanup(root);
  }
});

test('cambia revisione attiva senza riscrivere le sorgenti', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    createRevision(rec, {
      kind: 'livePreview',
      source: { complete: false, translated: false, timing: 'whole-recording' },
      segments: [{ start: 0, end: 10, text: 'anteprima' }],
    });
    createRevision(rec, {
      kind: 'translation',
      source: { complete: true, translated: true, targetLanguage: 'en' },
      segments: [{ start: 0, end: 10, text: 'translation' }],
    });

    const switched = switchActiveRevision(rec, 'r1');
    assert.equal(switched.success, true);
    assert.equal(switched.kind, 'livePreview');

    const metadata = readJson(path.join(rec, 'metadata.json'));
    assert.equal(metadata.activeRevisionId, 'r1');
    assert.equal(metadata.isLivePreview, true);
    assert.equal(metadata.isTranslated, false);
    assert.equal(readJson(path.join(rec, 'transcript.json')).kind, 'livePreview');
  } finally {
    cleanup(root);
  }
});
