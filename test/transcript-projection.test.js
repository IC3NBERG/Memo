'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { projectTranscript } = require('../src/core/transcript/projection');

function source() {
  return {
    segments: [
      { id: 'r1-s0001', start: 0, end: 5, text: 'uno' },
      { id: 'r1-s0002', start: 5, end: 10, text: 'due' },
      { id: 'r1-s0003', start: 10, end: 15, text: 'tre' },
    ],
  };
}

test('applica override, hidden e order parziale', () => {
  const projected = projectTranscript(source(), {
    segmentText: { 'r1-s0002': 'due corretto' },
    hiddenSegmentIds: ['r1-s0003'],
    order: ['r1-s0002'],
    groups: [],
  });

  assert.deepEqual(projected.segments.map((segment) => segment.id), ['r1-s0002', 'r1-s0001']);
  assert.equal(projected.text, 'due corretto uno');
  assert.equal(projected.warnings.length, 0);
});

test('ID orfani e duplicati producono warning senza bloccare la vista', () => {
  const projected = projectTranscript(source(), {
    hiddenSegmentIds: ['r1-s9999'],
    order: ['r1-s0001', 'r1-s0001', 'r1-s9999'],
    groups: [{ id: 'g1', title: 'Gruppo', segmentIds: ['r1-s9999'] }],
  });

  assert.deepEqual(projected.segments.map((segment) => segment.id), [
    'r1-s0001',
    'r1-s0002',
    'r1-s0003',
  ]);
  assert.ok(projected.warnings.some((item) => item.code === 'unknown-segment-id'));
  assert.ok(projected.warnings.some((item) => item.code === 'duplicate-segment-id'));
});

test('legacyDocumentText ha precedenza sul testo proiettato', () => {
  const projected = projectTranscript(source(), {
    segmentText: { 'r1-s0001': 'ignorato' },
    legacyDocumentText: 'testo completo modificato',
  });

  assert.equal(projected.legacyDocumentText, true);
  assert.equal(projected.text, 'testo completo modificato');
  assert.deepEqual(projected.segments, []);
  assert.equal(projected.effectiveSegments.length, 3);
});
