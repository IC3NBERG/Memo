'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  writeJsonAtomicSync,
  readJsonSafe,
  sha256File,
  sha256Json,
} = require('../src/core/storage/atomic');
const { tempDir, cleanup } = require('./helpers');

test('scrittura JSON atomica non lascia file temporanei', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'metadata.json');
    writeJsonAtomicSync(file, { schemaVersion: 2, name: 'uno' });
    writeJsonAtomicSync(file, { schemaVersion: 2, name: 'due' });

    assert.deepEqual(readJsonSafe(file).value, { schemaVersion: 2, name: 'due' });
    assert.deepEqual(fs.readdirSync(dir), ['metadata.json']);
  } finally {
    cleanup(dir);
  }
});

test('readJsonSafe distingue file mancante e JSON invalido', () => {
  const dir = tempDir();
  try {
    assert.equal(readJsonSafe(path.join(dir, 'missing.json')).code, 'ENOENT');
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ nope');
    assert.equal(readJsonSafe(path.join(dir, 'broken.json')).code, 'INVALID_JSON');
  } finally {
    cleanup(dir);
  }
});

test('sha256File e sha256Json cambiano con il contenuto', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'a.json');
    writeJsonAtomicSync(file, { a: 1 });
    const first = sha256File(file);
    writeJsonAtomicSync(file, { a: 2 });
    assert.notEqual(first, sha256File(file));
    assert.match(first, /^sha256:[a-f0-9]{64}$/);
    assert.notEqual(sha256Json({ a: 1 }), sha256Json({ a: 2 }));
  } finally {
    cleanup(dir);
  }
});
