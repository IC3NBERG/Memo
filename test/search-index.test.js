'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

let Database = null;
try {
  // Il binario nativo è compilato per l'ABI del Node che esegue i test.
  // Se non è disponibile (es. rebuild per Electron), i test SQLite si saltano
  // senza introdurre una seconda toolchain.
  Database = require('better-sqlite3');
  const probe = new Database(':memory:');
  probe.exec('CREATE VIRTUAL TABLE probe_fts USING fts5(x)');
  probe.close();
} catch (_) {
  Database = null;
}

const { openSearchIndex } = require('../src/core/search/index');
const { buildFtsQuery, parseSnippet } = require('../src/core/search/query');
const { tempDir, cleanup } = require('./helpers');

const sqliteTest = Database ? test : test.skip;

function record(overrides = {}) {
  return {
    recId: '/archive/Lezione',
    name: 'Lezione',
    folder: 'Università',
    body: 'La fotosintesi clorofilliana trasforma la luce in energia.',
    updatedAt: '2025-06-07T08:00:00.000Z',
    contentHash: 'hash-1',
    ...overrides,
  };
}

test('buildFtsQuery neutralizza operatori e usa il prefisso sull’ultima parola', () => {
  assert.equal(buildFtsQuery('  '), null);
  assert.equal(buildFtsQuery('NEUR*'), '"neur"*');
  assert.equal(buildFtsQuery('foto sintesi'), '"foto" AND "sintesi"*');
  assert.equal(buildFtsQuery('"quote"'), '"quote"*');
  assert.equal(buildFtsQuery('perché'), '"perché"*');
});

test('parseSnippet restituisce testo e intervalli senza HTML', () => {
  const parts = parseSnippet('prima \u0001parola\u0002 dopo');
  assert.deepEqual(parts, [
    { text: 'prima ', highlighted: false },
    { text: 'parola', highlighted: true },
    { text: ' dopo', highlighted: false },
  ]);
});

sqliteTest('l’indice FTS5 cerca nel testo, nel nome e nel gruppo', () => {
  const root = tempDir();
  try {
    const index = openSearchIndex({ dbPath: path.join(root, '.index', 'search.sqlite3') });

    assert.equal(index.upsert(record()).changed, true);
    assert.equal(index.upsert(record()).changed, false);
    index.upsert(record({
      recId: '/archive/Altra',
      name: 'Appunti di biologia',
      folder: '_unsorted',
      body: 'Il nucleo contiene il DNA.',
      contentHash: 'hash-2',
    }));

    assert.equal(index.count(), 2);

    const bodyMatch = index.search('fotosintesi');
    assert.equal(bodyMatch.length, 1);
    assert.equal(bodyMatch[0].recId, '/archive/Lezione');
    assert.match(bodyMatch[0].snippet, /\u0001fotosintesi\u0002/);

    const nameMatch = index.search('biologia');
    assert.equal(nameMatch.length, 1);
    assert.equal(nameMatch[0].recId, '/archive/Altra');

    const folderMatch = index.search('universita');
    assert.equal(folderMatch.length, 1);
    assert.equal(folderMatch[0].recId, '/archive/Lezione');

    assert.equal(index.search('inesistente').length, 0);
    assert.equal(index.search('   ').length, 0);

    assert.equal(index.remove('/archive/Lezione'), true);
    assert.equal(index.count(), 1);
    index.close();
  } finally {
    cleanup(root);
  }
});

sqliteTest('l’indice rimuove i segni diacritici e persiste tra riaperture', () => {
  const root = tempDir();
  try {
    const dbPath = path.join(root, '.index', 'search.sqlite3');
    const index = openSearchIndex({ dbPath });
    index.upsert(record({ body: 'Perché la cellula è viva?', contentHash: 'hash-accent' }));
    assert.equal(index.search('perche').length, 1);
    index.close();

    const reopened = openSearchIndex({ dbPath });
    assert.equal(reopened.count(), 1);
    assert.equal(reopened.search('cellula').length, 1);
    assert.equal(reopened._db.pragma('user_version', { simple: true }), 1);
    reopened.close();
  } finally {
    cleanup(root);
  }
});

sqliteTest('una versione futura dell’indice viene rifiutata', () => {
  const root = tempDir();
  try {
    const dbPath = path.join(root, 'search.sqlite3');
    const first = openSearchIndex({ dbPath });
    first._db.pragma('user_version = 99');
    first.close();

    assert.throws(() => openSearchIndex({ dbPath }), /troppo nuovo/);
  } finally {
    cleanup(root);
  }
});
