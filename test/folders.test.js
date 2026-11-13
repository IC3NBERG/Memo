'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createFolder,
  deleteFolder,
  normalizeFolderName,
  renameFolder,
} = require('../src/core/library/folders');
const { readMetadataFile } = require('../src/core/library/metadata');
const { createMetadataForNewRecording } = require('../src/core/transcript/store');
const { tempDir, readJson, cleanup } = require('./helpers');

function setup(root) {
  const recordingsDir = path.join(root, 'archive');
  const unsortedDir = path.join(recordingsDir, '_unsorted');
  fs.mkdirSync(unsortedDir, { recursive: true });
  return { recordingsDir, unsortedDir };
}

function createRecording(recordingsDir, folder, dirName) {
  const recDir = path.join(recordingsDir, folder, dirName);
  fs.mkdirSync(recDir, { recursive: true });
  fs.writeFileSync(
    path.join(recDir, 'metadata.json'),
    JSON.stringify(createMetadataForNewRecording({
      name: dirName,
      date: new Date('2025-06-07T08:00:00.000Z'),
      folder: folder === '_unsorted' ? null : folder,
    }), null, 2),
  );
  return recDir;
}

test('createFolder sanitizza il nome e rifiuta duplicati e nomi riservati', () => {
  const root = tempDir();
  try {
    const { recordingsDir } = setup(root);

    assert.deepEqual(createFolder({ recordingsDir, name: '../Storia?!' }), {
      success: true,
      name: 'Storia',
      path: path.join(recordingsDir, 'Storia'),
    });
    assert.equal(createFolder({ recordingsDir, name: 'Storia' }).code, 'folder-exists');
    assert.equal(createFolder({ recordingsDir, name: '_unsorted' }).code, 'invalid-folder');
    assert.equal(createFolder({ recordingsDir, name: '   ' }).code, 'invalid-folder');
    assert.equal(normalizeFolderName('  Diritto/Privato  '), 'DirittoPrivato');
  } finally {
    cleanup(root);
  }
});

test('renameFolder sposta il gruppo e allinea il metadata delle registrazioni', () => {
  const root = tempDir();
  try {
    const { recordingsDir } = setup(root);
    createFolder({ recordingsDir, name: 'Storia' });
    const first = createRecording(recordingsDir, 'Storia', '2025-06-07_Lezione');
    createRecording(recordingsDir, 'Storia', '2025-06-08_Lezione');

    const result = renameFolder({ recordingsDir, oldName: 'Storia', newName: 'Storia Moderna' });

    assert.equal(result.success, true);
    assert.equal(result.name, 'Storia Moderna');
    assert.equal(fs.existsSync(path.join(recordingsDir, 'Storia')), false);
    assert.equal(fs.existsSync(first), false);
    assert.deepEqual(fs.readdirSync(path.join(recordingsDir, 'Storia Moderna')).sort(), [
      '2025-06-07_Lezione',
      '2025-06-08_Lezione',
    ]);
    assert.equal(result.moved.length, 2);
    assert.equal(result.moved[0].from, first);
    assert.equal(
      readMetadataFile(result.moved[0].to).folder,
      'Storia Moderna',
    );
  } finally {
    cleanup(root);
  }
});

test('renameFolder rifiuta gruppi mancanti, nomi invalidi e collisioni', () => {
  const root = tempDir();
  try {
    const { recordingsDir } = setup(root);
    createFolder({ recordingsDir, name: 'Storia' });
    createFolder({ recordingsDir, name: 'Diritto' });

    assert.equal(
      renameFolder({ recordingsDir, oldName: 'Storia', newName: 'Diritto' }).code,
      'folder-exists',
    );
    assert.equal(
      renameFolder({ recordingsDir, oldName: 'Manca', newName: 'Nuovo' }).code,
      'folder-not-found',
    );
    assert.equal(
      renameFolder({ recordingsDir, oldName: 'Storia', newName: '_unsorted' }).code,
      'invalid-folder',
    );
  } finally {
    cleanup(root);
  }
});

test('deleteFolder sposta le registrazioni in _unsorted senza sovrascrivere', () => {
  const root = tempDir();
  try {
    const { recordingsDir, unsortedDir } = setup(root);
    createFolder({ recordingsDir, name: 'Storia' });
    createRecording(recordingsDir, 'Storia', '2025-06-07_Lezione');
    createRecording(recordingsDir, 'Storia', '2025-06-08_Lezione');

    // Collisione: esiste già una registrazione con lo stesso nome in _unsorted.
    const existing = createRecording(recordingsDir, '_unsorted', '2025-06-07_Lezione');

    const result = deleteFolder({ recordingsDir, unsortedDir, name: 'Storia' });

    assert.equal(result.success, true);
    assert.equal(fs.existsSync(path.join(recordingsDir, 'Storia')), false);
    assert.equal(fs.existsSync(existing), true);
    assert.equal(result.moved.length, 2);
    assert.ok(fs.existsSync(path.join(unsortedDir, '2025-06-07_Lezione_1')));
    assert.equal(readMetadataFile(path.join(unsortedDir, '2025-06-07_Lezione_1')).folder, null);
    assert.equal(readMetadataFile(existing).folder, null);
  } finally {
    cleanup(root);
  }
});

test('deleteFolder si ferma prima di toccare registrazioni se trova file non gestiti', () => {
  const root = tempDir();
  try {
    const { recordingsDir, unsortedDir } = setup(root);
    createFolder({ recordingsDir, name: 'Storia' });
    const rec = createRecording(recordingsDir, 'Storia', '2025-06-07_Lezione');
    fs.writeFileSync(path.join(recordingsDir, 'Storia', 'note.txt'), 'non gestito');

    const result = deleteFolder({ recordingsDir, unsortedDir, name: 'Storia' });

    assert.equal(result.success, false);
    assert.equal(result.code, 'unmanaged-files');
    assert.equal(fs.existsSync(rec), true);
    assert.equal(fs.existsSync(path.join(unsortedDir, '2025-06-07_Lezione')), false);
    assert.match(result.error, /nessuna registrazione è stata spostata/);
  } finally {
    cleanup(root);
  }
});

test('deleteFolder ignora .DS_Store e gestisce gruppi vuoti o inesistenti', () => {
  const root = tempDir();
  try {
    const { recordingsDir, unsortedDir } = setup(root);
    createFolder({ recordingsDir, name: 'Vuoto' });
    fs.writeFileSync(path.join(recordingsDir, 'Vuoto', '.DS_Store'), '');

    assert.equal(deleteFolder({ recordingsDir, unsortedDir, name: 'Vuoto' }).success, true);
    assert.equal(fs.existsSync(path.join(recordingsDir, 'Vuoto')), false);
    assert.equal(
      deleteFolder({ recordingsDir, unsortedDir, name: 'Manca' }).code,
      'folder-not-found',
    );
    assert.equal(
      deleteFolder({ recordingsDir, unsortedDir, name: '_unsorted' }).code,
      'invalid-folder',
    );
  } finally {
    cleanup(root);
  }
});

test('deleteFolder mantiene il metadata leggibile dopo lo spostamento', () => {
  const root = tempDir();
  try {
    const { recordingsDir, unsortedDir } = setup(root);
    createFolder({ recordingsDir, name: 'Storia' });
    createRecording(recordingsDir, 'Storia', '2025-06-07_Lezione');

    const result = deleteFolder({ recordingsDir, unsortedDir, name: 'Storia' });
    const metadata = readJson(path.join(result.moved[0].to, 'metadata.json'));

    assert.equal(metadata.name, '2025-06-07_Lezione');
    assert.equal(metadata.folder, null);
  } finally {
    cleanup(root);
  }
});
