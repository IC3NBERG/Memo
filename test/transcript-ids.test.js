'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  revisionId,
  revisionNumber,
  segmentId,
  nextRevisionNumber,
  normalizeSegments,
} = require('../src/core/transcript/ids');

test('revisionId e segmentId sono 1-based e leggibili', () => {
  assert.equal(revisionId(1), 'r1');
  assert.equal(revisionId(12), 'r12');
  assert.equal(revisionNumber('r12'), 12);
  assert.equal(revisionNumber('r0'), null);
  assert.equal(segmentId('r2', 1), 'r2-s0001');
  assert.equal(segmentId('r2', 14), 'r2-s0014');
});

test('nextRevisionNumber considera metadata e directory orfane', () => {
  const metadata = { revisions: [{ revisionId: 'r1' }, { revisionId: 'r3' }] };
  assert.equal(nextRevisionNumber(metadata, ['r2', 'r7']), 8);
  assert.equal(nextRevisionNumber({ revisions: [] }, []), 1);
});

test('normalizeSegments converte offset Whisper da ms a secondi', () => {
  const result = normalizeSegments([
    { offsets: { from: 0, to: 1234 }, text: ' ciao ' },
    { offsets: { from: 1234, to: 2500 }, text: 'mondo' },
  ], 'r1');

  assert.deepEqual(result, [
    { id: 'r1-s0001', start: 0, end: 1.234, text: 'ciao' },
    { id: 'r1-s0002', start: 1.234, end: 2.5, text: 'mondo' },
  ]);
});

test('normalizeSegments usa fallbackEnd per un segmento senza fine', () => {
  const result = normalizeSegments([{ start: 0, end: 0, text: 'testo' }], 'r1', {
    fallbackEnd: 42,
  });
  assert.equal(result[0].end, 42);
});
