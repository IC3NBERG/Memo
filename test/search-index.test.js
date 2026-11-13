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
const { buildFtsQuery, normalizeFilters, parseSnippet } = require('../src/core/search/query');
const { stemItalian } = require('../src/core/search/stemmer');
const { tempDir, cleanup } = require('./helpers');

const sqliteTest = Database ? test : test.skip;

function record(overrides = {}) {
  return {
    recId: '/archive/Lezione',
    name: 'Lezione',
    folder: 'Università',
    body: 'La fotosintesi clorofilliana trasforma la luce in energia.',
    startedAt: '2025-06-07T08:00:00.000Z',
    duration: 900,
    speakers: ['Mario'],
    segments: [
      {
        start: 42,
        end: 48,
        text: 'La fotosintesi clorofilliana trasforma la luce in energia.',
        speaker: 'Mario',
      },
    ],
    updatedAt: '2025-06-07T08:00:00.000Z',
    contentHash: 'hash-1',
    ...overrides,
  };
}

test('buildFtsQuery neutralizza operatori, radici italiane e prefisso sull’ultima parola', () => {
  assert.equal(buildFtsQuery('  '), null);
  assert.equal(buildFtsQuery('NEUR*'), '"neur"*');
  assert.equal(buildFtsQuery('foto sintesi'), '("foto" OR "fot") AND ("sintesi"* OR "sintes"*)');
  assert.equal(buildFtsQuery('"quote"'), '("quote"* OR "quot"*)');
  assert.equal(buildFtsQuery('perché'), '("perché"* OR "perch"*)');
});

test('parseSnippet restituisce testo e intervalli senza HTML', () => {
  const parts = parseSnippet('prima \u0001parola\u0002 dopo');
  assert.deepEqual(parts, [
    { text: 'prima ', highlighted: false },
    { text: 'parola', highlighted: true },
    { text: ' dopo', highlighted: false },
  ]);
});

test('lo stemmer leggero normalizza forme flesse senza toccare le radici corte', () => {
  assert.equal(stemItalian('cellula'), 'cellul');
  assert.equal(stemItalian('cellule'), 'cellul');
  assert.equal(stemItalian('respirare'), 'respir');
  assert.equal(stemItalian('respirazione'), 'respir');
  assert.equal(stemItalian('perché'), 'perch');
  assert.equal(stemItalian('vita'), 'vit');
  assert.equal(stemItalian('bio'), 'bio');
});

test('normalizeFilters valida date, durata, speaker e gruppo non ordinato', () => {
  const filters = normalizeFilters({
    folder: '__unsorted__',
    dateFrom: '2025-06-01T00:00:00.000Z',
    dateTo: 'non-una-data',
    durationMin: 300,
    durationMax: 60,
    speaker: '  Mario ',
  });

  assert.deepEqual(filters, {
    folder: '',
    dateFrom: '2025-06-01T00:00:00.000Z',
    dateTo: null,
    durationMin: 60,
    durationMax: 300,
    speaker: 'Mario',
  });
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
    assert.equal(bodyMatch[0].matchStart, 42);
    assert.match(bodyMatch[0].snippet, /\u0001fotosintesi\u0002/);

    const nameMatch = index.search('biologia');
    assert.equal(nameMatch.length, 1);
    assert.equal(nameMatch[0].recId, '/archive/Altra');
    assert.equal(nameMatch[0].matchStart, null);

    const folderMatch = index.search('universita');
    assert.equal(folderMatch.length, 1);
    assert.equal(folderMatch[0].recId, '/archive/Lezione');

    assert.equal(index.search('inesistente').length, 0);
    assert.equal(index.search('   ').length, 0);

    // Filtri combinabili: gruppo, data, durata e speaker.
    assert.equal(index.search('fotosintesi', { filters: { folder: 'Università' } }).length, 1);
    assert.equal(index.search('fotosintesi', { filters: { folder: '__unsorted__' } }).length, 0);
    assert.equal(index.search('fotosintesi', { filters: { folder: '' } }).length, 0);
    assert.equal(index.search('fotosintesi', {
      filters: { dateFrom: '2025-06-07T00:00:00.000Z', dateTo: '2025-06-07T23:59:59.999Z' },
    }).length, 1);
    assert.equal(index.search('fotosintesi', {
      filters: { dateFrom: '2025-06-08T00:00:00.000Z' },
    }).length, 0);
    assert.equal(index.search('fotosintesi', { filters: { durationMin: 600, durationMax: 1200 } }).length, 1);
    assert.equal(index.search('fotosintesi', { filters: { durationMax: 300 } }).length, 0);
    assert.equal(index.search('fotosintesi', { filters: { speaker: 'Mario' } }).length, 1);
    assert.equal(index.search('fotosintesi', { filters: { speaker: 'Luisa' } }).length, 0);

    const facets = index.facets();
    assert.deepEqual(facets.folders.sort(), ['Università', '_unsorted'].sort());
    assert.deepEqual(facets.speakers, ['Mario']);

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
    assert.equal(index.search('cellule').length, 1);
    index.close();

    const reopened = openSearchIndex({ dbPath });
    assert.equal(reopened.count(), 1);
    assert.equal(reopened.search('cellula').length, 1);
    assert.equal(reopened._db.pragma('user_version', { simple: true }), 2);
    reopened.close();
  } finally {
    cleanup(root);
  }
});

sqliteTest('lo stemming rende equivalenti forme flesse e derivate', () => {
  const root = tempDir();
  try {
    const index = openSearchIndex({ dbPath: path.join(root, 'search.sqlite3') });
    index.upsert(record({
      body: 'La respirazione cellulare avviene nella cellula.',
      segments: [{
        start: 5,
        end: 9,
        text: 'La respirazione cellulare avviene nella cellula.',
      }],
      contentHash: 'hash-stem',
    }));

    assert.equal(index.search('respirare').length, 1);
    assert.equal(index.search('cellule').length, 1);
    assert.equal(index.search('respirazione')[0].matchStart, 5);
    index.close();
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
