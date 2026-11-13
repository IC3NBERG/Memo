'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { repairTranscriptDocument } = require('../src/core/transcript/repair');
const { SEGMENT_PATTERN, validateTranscript } = require('../src/core/transcript/validate');

function validTranscript() {
  return {
    schemaVersion: 2,
    revisionId: 'r2',
    kind: 'transcription',
    source: {
      engine: 'whisper-cli',
      model: 'ggml-large-v3-turbo.bin',
      language: 'it',
      targetLanguage: null,
      complete: true,
      translated: false,
      timing: 'segment',
      format: 'v2',
    },
    segments: [
      { id: 'r2-s0001', start: 0, end: 5, text: 'primo' },
      { id: 'r2-s0002', start: 5, end: 10, text: 'secondo' },
    ],
  };
}

test('un transcript conforme non viene modificato', () => {
  const raw = validTranscript();
  const result = repairTranscriptDocument(raw, 'r2');

  assert.equal(result.ok, true);
  assert.equal(result.repaired, false);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.transcript, raw);
});

test('ripara ID duplicati, ID di un’altra revisione e timestamp invalidi', () => {
  const raw = validTranscript();
  raw.segments = [
    { id: 'r2-s0001', start: 0, end: 5, text: 'primo' },
    { id: 'r2-s0001', start: 5, end: 10, text: 'duplicato' },
    { id: 'r9-s0007', start: 20, end: 15, text: 'altra revisione' },
    { start: 'x', end: 'y', text: 'senza timestamp' },
  ];

  const result = repairTranscriptDocument(raw, 'r2', { fallbackEnd: 30 });
  assert.equal(result.ok, true);
  assert.equal(result.repaired, true);

  const segments = result.transcript.segments;
  assert.equal(segments.length, 4);
  const ids = segments.map((segment) => segment.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const segment of segments) {
    assert.match(segment.id, SEGMENT_PATTERN);
    assert.equal(segment.id.startsWith('r2-s'), true);
    assert.equal(typeof segment.start, 'number');
    assert.equal(typeof segment.end, 'number');
    assert.equal(Number.isFinite(segment.start), true);
    assert.equal(Number.isFinite(segment.end), true);
    assert.equal(segment.end >= segment.start, true);
    assert.equal(typeof segment.text, 'string');
  }
  assert.deepEqual(
    [...new Set(result.warnings.map((item) => item.code))].sort(),
    ['segment-end-repaired', 'segment-id-repaired', 'segment-order-repaired', 'segment-start-repaired'],
  );
  assert.deepEqual(validateTranscript(result.transcript, { expectedRevisionId: 'r2' }).errors, []);
});

test('scarta segmenti non oggetto e normalizza campi opzionali', () => {
  const raw = validTranscript();
  raw.segments = [
    { id: 'r2-s0001', start: 0, end: 5, text: 'ok', speaker: '  Docente  ' },
    null,
    'stringa',
    [1, 2],
    { id: 'r2-s0002', start: 5, end: 10, text: 7, speaker: 42 },
  ];

  const result = repairTranscriptDocument(raw, 'r2');
  assert.equal(result.ok, true);
  assert.equal(result.transcript.segments.length, 2);
  assert.equal(result.transcript.segments[0].speaker, 'Docente');
  assert.equal(result.transcript.segments[1].speaker, undefined);
  assert.equal(result.transcript.segments[1].text, '');
  assert.equal(result.warnings.filter((item) => item.code === 'segment-dropped').length, 3);
});

test('completa kind, source e segments mancanti', () => {
  const raw = {
    schemaVersion: 2,
    revisionId: 'r3',
    segments: [{ start: 0, end: 3, text: 'testo' }],
  };
  const result = repairTranscriptDocument(raw, 'r3');

  assert.equal(result.ok, true);
  assert.equal(result.transcript.kind, 'transcription');
  assert.equal(result.transcript.source.timing, 'whole-recording');
  assert.equal(result.transcript.source.complete, true);
  assert.equal(result.transcript.source.translated, false);
  assert.equal(result.warnings.some((item) => item.code === 'kind-repaired'), true);
  assert.equal(result.warnings.some((item) => item.code === 'source-repaired'), true);
  assert.equal(result.warnings.some((item) => item.code === 'segment-id-repaired'), true);

  const missingSegments = { schemaVersion: 2, revisionId: 'r3' };
  const repaired = repairTranscriptDocument(missingSegments, 'r3');
  assert.deepEqual(repaired.transcript.segments, []);
  assert.equal(repaired.warnings.some((item) => item.code === 'segments-repaired'), true);
});

test('corregge un revisionId del documento diverso da quello atteso', () => {
  const raw = validTranscript();
  raw.revisionId = 'r7';
  for (const segment of raw.segments) segment.id = segment.id.replace('r2-', 'r7-');

  const result = repairTranscriptDocument(raw, 'r2');
  assert.equal(result.ok, true);
  assert.equal(result.transcript.revisionId, 'r2');
  assert.equal(result.warnings.some((item) => item.code === 'revision-id-repaired'), true);
  assert.equal(result.transcript.segments.every((segment) => segment.id.startsWith('r2-s')), true);
});

test('rifiuta una versione futura salvo richiesta esplicita di lettura', () => {
  const raw = validTranscript();
  raw.schemaVersion = 99;

  const rejected = repairTranscriptDocument(raw, 'r2');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'unsupported-schema');

  const accepted = repairTranscriptDocument(raw, 'r2', { ignoreSchemaVersion: true });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.transcript.schemaVersion, 99);
});

test('rifiuta un documento che non è un oggetto', () => {
  for (const value of [null, 'testo', 42, []]) {
    const result = repairTranscriptDocument(value, 'r2');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid-transcript');
  }
});
