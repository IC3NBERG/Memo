'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../src/renderer/block-model');

const segments = [
  { id: 'r1-s0001', start: 0, end: 1, text: 'prima' },
  { id: 'r1-s0002', start: 1, end: 2, text: 'seconda' },
  { id: 'r1-s0003', start: 2, end: 3, text: 'terza' },
];

function edits(overrides = {}) {
  return {
    segmentText: {},
    hiddenSegmentIds: [],
    tags: {},
    annotations: {},
    order: null,
    groups: [],
    ...overrides,
  };
}

test('visibleBlocks applica override, ordine parziale e blocchi nascosti', () => {
  const overlay = edits({
    segmentText: { 'r1-s0002': 'seconda corretta' },
    hiddenSegmentIds: ['r1-s0001'],
    order: ['r1-s0003', 'r1-s0002'],
  });

  assert.deepEqual(model.visibleBlocks(segments, overlay).map((block) => block.id), [
    'r1-s0003',
    'r1-s0002',
  ]);
  assert.equal(model.visibleBlocks(segments, overlay)[1].text, 'seconda corretta');
  assert.deepEqual(model.hiddenBlocks(segments, overlay).map((block) => block.id), ['r1-s0001']);
  assert.equal(model.projectText(segments, overlay), 'terza seconda corretta');
  assert.deepEqual(model.orderedIds(segments, overlay), [
    'r1-s0003',
    'r1-s0002',
    'r1-s0001',
  ]);
});

test('setSegmentText e setHidden non mutano l’overlay originale', () => {
  const original = edits();
  const edited = model.setSegmentText(original, 'r1-s0001', 'nuovo');
  const hidden = model.setHidden(edited, 'r1-s0002', true);

  assert.equal(original.segmentText['r1-s0001'], undefined);
  assert.equal(edited.segmentText['r1-s0001'], 'nuovo');
  assert.deepEqual(hidden.hiddenSegmentIds, ['r1-s0002']);
  assert.deepEqual(model.setHidden(hidden, 'r1-s0002', false).hiddenSegmentIds, []);
});

test('tag e annotazioni sono deduplicati e rimovibili', () => {
  let overlay = model.addTag(edits(), 'r1-s0001', '  importante  ');
  overlay = model.addTag(overlay, 'r1-s0001', 'importante');
  overlay = model.addTag(overlay, 'r1-s0001', '');
  assert.deepEqual(overlay.tags['r1-s0001'], ['importante']);

  overlay = model.addAnnotation(overlay, 'r1-s0001', 'Da rivedere', {
    id: 'a1',
    createdAt: '2025-06-07T08:00:00.000Z',
  });
  assert.deepEqual(overlay.annotations['r1-s0001'], [{
    id: 'a1',
    text: 'Da rivedere',
    createdAt: '2025-06-07T08:00:00.000Z',
  }]);

  overlay = model.removeAnnotation(overlay, 'r1-s0001', 'a1');
  assert.deepEqual(overlay.annotations, {});
  overlay = model.removeTag(overlay, 'r1-s0001', 'importante');
  assert.deepEqual(overlay.tags, {});
});

test('hasOverlayContent riconosce ogni parte dell’overlay e ignora i metadati', () => {
  assert.equal(model.hasOverlayContent(null), false);
  assert.equal(model.hasOverlayContent({ segmentText: {}, hiddenSegmentIds: [], tags: {}, annotations: {}, order: null, groups: [] }), false);
  assert.equal(model.hasOverlayContent({ revisionId: 'r1', sourceHash: 'abc', editRevision: 3 }), false);
  assert.equal(model.hasOverlayContent(edits({ segmentText: { 'r1-s0001': 'x' } })), true);
  assert.equal(model.hasOverlayContent(edits({ hiddenSegmentIds: ['r1-s0001'] })), true);
  assert.equal(model.hasOverlayContent(edits({ tags: { 'r1-s0001': ['x'] } })), true);
  assert.equal(model.hasOverlayContent(edits({ annotations: { 'r1-s0001': [{ id: 'a1' }] } })), true);
  assert.equal(model.hasOverlayContent(edits({ order: ['r1-s0001'] })), true);
  assert.equal(model.hasOverlayContent(edits({ groups: [{ id: 'g1', segmentIds: [] }] })), true);
  assert.equal(model.hasOverlayContent({ legacyDocumentText: 'testo' }), true);
});

test('resetOverlay azzera tutte le viste e preserva i metadati di allineamento', () => {
  const overlay = edits({
    revisionId: 'r1',
    sourceHash: 'hash',
    editRevision: 4,
    segmentText: { 'r1-s0001': 'corretto' },
    hiddenSegmentIds: ['r1-s0002'],
    tags: { 'r1-s0001': ['importante'] },
    annotations: { 'r1-s0001': [{ id: 'a1', text: 'nota' }] },
    order: ['r1-s0002', 'r1-s0001'],
    groups: [{ id: 'g1', title: 'Gruppo', segmentIds: ['r1-s0001'] }],
    legacyDocumentText: 'testo legacy',
  });

  const clean = model.resetOverlay(overlay);
  assert.deepEqual(clean.segmentText, {});
  assert.deepEqual(clean.hiddenSegmentIds, []);
  assert.deepEqual(clean.tags, {});
  assert.deepEqual(clean.annotations, {});
  assert.equal(clean.order, null);
  assert.deepEqual(clean.groups, []);
  assert.equal(clean.legacyDocumentText, undefined);
  assert.equal(clean.revisionId, 'r1');
  assert.equal(clean.sourceHash, 'hash');
  assert.equal(clean.editRevision, 4);
  assert.equal(model.hasOverlayContent(clean), false);

  // L'overlay di partenza non viene mutato.
  assert.equal(overlay.segmentText['r1-s0001'], 'corretto');
  assert.equal(overlay.legacyDocumentText, 'testo legacy');
});

test('i gruppi sono nomi condivisi e un segmento può stare in più gruppi', () => {
  let overlay = model.createGroup(edits(), 'Introduzione', { id: 'g1' });
  overlay = model.createGroup(overlay, 'Esame', { id: 'g2' });
  overlay = model.toggleSegmentInGroup(overlay, 'g1', 'r1-s0001');
  overlay = model.toggleSegmentInGroup(overlay, 'g2', 'r1-s0001');

  assert.deepEqual(overlay.groups[0].segmentIds, ['r1-s0001']);
  assert.deepEqual(overlay.groups[1].segmentIds, ['r1-s0001']);
  assert.equal(model.groupsForSegment(overlay, 'r1-s0001').length, 2);

  overlay = model.toggleSegmentInGroup(overlay, 'g1', 'r1-s0001');
  assert.deepEqual(overlay.groups[0].segmentIds, []);
  overlay = model.renameGroup(overlay, 'g2', 'Ripasso');
  assert.equal(overlay.groups[1].title, 'Ripasso');
  overlay = model.deleteGroup(overlay, 'g2');
  assert.deepEqual(overlay.groups.map((group) => group.id), ['g1']);
});

test('moveSegment riordina solo i blocchi visibili', () => {
  const overlay = model.moveSegment(edits(), 'r1-s0002', -1, [
    'r1-s0001',
    'r1-s0002',
    'r1-s0003',
  ]);
  assert.deepEqual(overlay.order, ['r1-s0002', 'r1-s0001', 'r1-s0003']);
  assert.deepEqual(
    model.moveSegment(overlay, 'r1-s0002', -1, overlay.order).order,
    overlay.order,
  );
});

test('undo e redo ripristinano snapshot completi', () => {
  const history = model.createHistory();
  const first = edits();
  const second = model.setSegmentText(first, 'r1-s0001', 'modificato');

  model.pushHistory(history, first);
  const undone = model.undo(history, second);
  assert.equal(undone.segmentText['r1-s0001'], undefined);
  const redone = model.redo(history, undone);
  assert.equal(redone.segmentText['r1-s0001'], 'modificato');
  assert.equal(model.undo(model.createHistory(), first), null);
});

test('legacyDocumentText viene riconosciuto solo se stringa', () => {
  assert.equal(model.hasLegacyText(edits({ legacyDocumentText: 'testo' })), true);
  assert.equal(model.hasLegacyText(edits({ legacyDocumentText: 1 })), false);
  assert.equal(
    model.clearLegacyText(edits({ legacyDocumentText: 'testo' })).legacyDocumentText,
    undefined,
  );
});
