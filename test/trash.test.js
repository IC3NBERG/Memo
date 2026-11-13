'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  TRASH_DIR,
  TRASH_ENTRY_FILE,
  emptyTrash,
  listTrash,
  moveToTrash,
  purgeTrashEntry,
  restoreFromTrash,
  trashRoot,
} = require('../src/core/library/trash');
const { writeManifest } = require('../src/core/library/manifest');
const { createMetadataForNewRecording } = require('../src/core/transcript/store');
const { tempDir, readJson, cleanup } = require('./helpers');

function setup(root) {
  const recordingsDir = path.join(root, 'archive');
  const unsortedDir = path.join(recordingsDir, '_unsorted');
  const groupDir = path.join(recordingsDir, 'Università');
  fs.mkdirSync(unsortedDir, { recursive: true });
  fs.mkdirSync(groupDir, { recursive: true });
  return { recordingsDir, unsortedDir, groupDir };
}

function createRecording(baseDir, name, folder = null) {
  const rec = path.join(baseDir, name);
  fs.mkdirSync(rec, { recursive: true });
  fs.writeFileSync(path.join(rec, 'audio.wav'), 'RIFF-audio');
  const metadata = createMetadataForNewRecording({
    name,
    date: new Date('2025-06-07T08:00:00.000Z'),
    folder,
  });
  fs.writeFileSync(path.join(rec, 'metadata.json'), JSON.stringify(metadata, null, 2));
  writeManifest(rec);
  return rec;
}

test('sposta una registrazione nel cestino senza eliminarla', () => {
  const root = tempDir();
  try {
    const { recordingsDir, groupDir } = setup(root);
    const rec = createRecording(groupDir, 'Lezione', 'Università');

    const result = moveToTrash({
      recordingsDir,
      recDir: rec,
      now: () => new Date('2025-06-07T09:00:00.000Z'),
    });
    assert.equal(result.success, true);
    assert.equal(fs.existsSync(rec), false);
    assert.equal(fs.existsSync(result.trashDir), true);
    assert.equal(fs.readFileSync(path.join(result.trashDir, 'audio.wav'), 'utf8'), 'RIFF-audio');
    assert.equal(result.entry.originalFolder, 'Università');
    assert.equal(result.entry.originalName, 'Lezione');
    assert.equal(result.entry.name, 'Lezione');
    assert.equal(result.entry.fileCount, 2);
    assert.equal(result.entry.trashedAt, '2025-06-07T09:00:00.000Z');

    const entryOnDisk = readJson(path.join(result.trashDir, TRASH_ENTRY_FILE));
    assert.equal(entryOnDisk.id, result.trashId);
    assert.equal(entryOnDisk.originalRelativePath, 'Università/Lezione');
  } finally {
    cleanup(root);
  }
});

test('elenca il cestino e ripristina nella cartella originale', () => {
  const root = tempDir();
  try {
    const { recordingsDir, groupDir } = setup(root);
    const rec = createRecording(groupDir, 'Lezione', 'Università');
    const moved = moveToTrash({ recordingsDir, recDir: rec });

    const entries = listTrash({ recordingsDir });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, moved.trashId);
    assert.equal(entries[0].dir, moved.trashDir);

    const restored = restoreFromTrash({
      recordingsDir,
      unsortedDir: path.join(recordingsDir, '_unsorted'),
      trashId: moved.trashId,
    });
    assert.equal(restored.success, true);
    assert.equal(restored.folder, 'Università');
    assert.equal(path.dirname(restored.recDir), groupDir);
    assert.equal(fs.existsSync(path.join(restored.recDir, TRASH_ENTRY_FILE)), false);
    assert.equal(readJson(path.join(restored.recDir, 'metadata.json')).folder, 'Università');

    assert.deepEqual(listTrash({ recordingsDir }), []);
  } finally {
    cleanup(root);
  }
});

test('se il gruppo originale non esiste più il ripristino usa _unsorted', () => {
  const root = tempDir();
  try {
    const { recordingsDir, unsortedDir, groupDir } = setup(root);
    const rec = createRecording(groupDir, 'Lezione', 'Università');
    const moved = moveToTrash({ recordingsDir, recDir: rec });
    fs.rmSync(groupDir, { recursive: true, force: true });

    const restored = restoreFromTrash({ recordingsDir, unsortedDir, trashId: moved.trashId });
    assert.equal(restored.success, true);
    assert.equal(restored.folder, null);
    assert.equal(path.dirname(restored.recDir), unsortedDir);
    assert.equal(readJson(path.join(restored.recDir, 'metadata.json')).folder, null);
  } finally {
    cleanup(root);
  }
});

test('non sovrascrive una registrazione omonima al ripristino', () => {
  const root = tempDir();
  try {
    const { recordingsDir, groupDir } = setup(root);
    const rec = createRecording(groupDir, 'Lezione', 'Università');
    const moved = moveToTrash({ recordingsDir, recDir: rec });
    createRecording(groupDir, 'Lezione', 'Università');

    const restored = restoreFromTrash({
      recordingsDir,
      unsortedDir: path.join(recordingsDir, '_unsorted'),
      trashId: moved.trashId,
    });
    assert.equal(restored.success, true);
    assert.notEqual(path.basename(restored.recDir), 'Lezione');
    assert.match(path.basename(restored.recDir), /^Lezione_1$/);
  } finally {
    cleanup(root);
  }
});

test('elimina definitivamente solo dal cestino', () => {
  const root = tempDir();
  try {
    const { recordingsDir, groupDir } = setup(root);
    const first = createRecording(groupDir, 'Prima', 'Università');
    const second = createRecording(groupDir, 'Seconda', 'Università');
    const movedFirst = moveToTrash({ recordingsDir, recDir: first });
    const movedSecond = moveToTrash({ recordingsDir, recDir: second });

    const purged = purgeTrashEntry({ recordingsDir, trashId: movedFirst.trashId });
    assert.equal(purged.success, true);
    assert.equal(fs.existsSync(movedFirst.trashDir), false);
    assert.equal(fs.existsSync(movedSecond.trashDir), true);

    const emptied = emptyTrash({ recordingsDir });
    assert.equal(emptied.success, true);
    assert.equal(emptied.removed, 1);
    assert.equal(fs.existsSync(trashRoot(recordingsDir)), true);
    assert.deepEqual(fs.readdirSync(trashRoot(recordingsDir)), []);
  } finally {
    cleanup(root);
  }
});

test('rifiuta ID del cestino non validi o elementi inesistenti', () => {
  const root = tempDir();
  try {
    const { recordingsDir } = setup(root);
    const rec = createRecording(path.join(recordingsDir, 'Università'), 'Lezione', 'Università');
    moveToTrash({ recordingsDir, recDir: rec });

    for (const trashId of ['../fuori', 'a/b', 'a\\b', '.', '..', '', null]) {
      assert.equal(purgeTrashEntry({ recordingsDir, trashId }).success, false);
      assert.equal(
        restoreFromTrash({
          recordingsDir,
          unsortedDir: path.join(recordingsDir, '_unsorted'),
          trashId,
        }).success,
        false,
      );
    }

    assert.equal(purgeTrashEntry({ recordingsDir, trashId: 'manca' }).code, 'not-found');
    assert.equal(
      restoreFromTrash({
        recordingsDir,
        unsortedDir: path.join(recordingsDir, '_unsorted'),
        trashId: 'manca',
      }).code,
      'not-found',
    );
    assert.equal(TRASH_DIR, '.trash');
  } finally {
    cleanup(root);
  }
});

test('moveToTrash rifiuta percorsi mancanti senza creare il cestino', () => {
  const root = tempDir();
  try {
    const invalid = moveToTrash({ recordingsDir: root, recDir: path.join(root, 'manca') });
    assert.equal(invalid.success, false);
    assert.equal(invalid.code, 'not-found');
    assert.equal(fs.existsSync(trashRoot(root)), false);
  } finally {
    cleanup(root);
  }
});
