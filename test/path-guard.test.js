'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createPathGuard } = require('../src/core/storage/path-guard');
const { tempDir, cleanup } = require('./helpers');

test('path guard accetta solo percorsi interni reali', () => {
  const root = tempDir();
  const outside = tempDir();
  try {
    const rec = path.join(root, 'gruppo', 'lezione');
    fs.mkdirSync(rec, { recursive: true });
    const guard = createPathGuard(root);

    assert.equal(guard.isInside(rec), true);
    assert.equal(guard.isValidRecordingDir(rec), true);
    assert.equal(guard.isInside(root), false);
    assert.equal(guard.isInside(path.join(root, '..', 'fuori')), false);
    assert.equal(guard.isInsideOrEqual(root), true);

    const newPath = path.join(root, 'gruppo', 'nuova');
    assert.equal(guard.isValidParentForNewPath(path.join(newPath, 'audio.wav')), true);

    const linkOutside = path.join(root, 'link-fuori');
    fs.symlinkSync(outside, linkOutside, 'dir');
    assert.equal(guard.isInside(linkOutside), false);
    assert.equal(guard.isValidRecordingDir(linkOutside), false);

    const insideDir = path.join(root, 'gruppo');
    const linkInside = path.join(root, 'link-dentro');
    fs.symlinkSync(insideDir, linkInside, 'dir');
    assert.equal(guard.isInside(linkInside), true);
  } finally {
    cleanup(root);
    cleanup(outside);
  }
});
