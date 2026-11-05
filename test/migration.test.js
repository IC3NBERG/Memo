'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  BACKUP_DIR,
  REVISIONS_DIR,
  ensureRecordingMigrated,
} = require('../src/core/transcript/migrate');
const { sha256File } = require('../src/core/storage/atomic');
const { readActiveTranscript } = require('../src/core/transcript/store');
const { tempDir, copyFixture, readJson, cleanup } = require('./helpers');

function revisionPath(recDir, revisionId, file) {
  return path.join(recDir, REVISIONS_DIR, revisionId, file);
}

test('migra anteprima live in revisione r1 con backup e copie derivate', () => {
  const root = tempDir();
  try {
    const rec = copyFixture('live-preview', root);
    const result = ensureRecordingMigrated(rec);
    assert.equal(result.migrated, true);

    const metadata = readJson(path.join(rec, 'metadata.json'));
    assert.equal(metadata.schemaVersion, 2);
    assert.equal(metadata.activeRevisionId, 'r1');
    assert.equal(metadata.isLivePreview, true);
    assert.equal(metadata.isCompleteTranscript, false);
    assert.equal(metadata.revisions[0].kind, 'livePreview');
    assert.equal(metadata.revisions[0].model, null);

    const transcript = readJson(revisionPath(rec, 'r1', 'transcript.json'));
    assert.equal(transcript.kind, 'livePreview');
    assert.equal(transcript.source.timing, 'whole-recording');
    assert.equal(transcript.source.model, null);
    assert.equal(transcript.segments[0].id, 'r1-s0001');

    const edits = readJson(revisionPath(rec, 'r1', 'edits.json'));
    assert.equal(edits.sourceHash, sha256File(revisionPath(rec, 'r1', 'transcript.json')));
    assert.ok(fs.existsSync(path.join(rec, BACKUP_DIR, 'metadata.json')));
    assert.ok(fs.existsSync(path.join(rec, 'transcript.json')));
    assert.ok(fs.existsSync(path.join(rec, 'transcript.edits.json')));
    assert.ok(fs.existsSync(path.join(rec, 'transcript.txt')));

    const backupMetadataPath = path.join(rec, BACKUP_DIR, 'metadata.json');
    const backupBefore = fs.readFileSync(backupMetadataPath, 'utf8');
    assert.equal(ensureRecordingMigrated(rec).migrated, false);
    assert.equal(fs.readFileSync(backupMetadataPath, 'utf8'), backupBefore);
  } finally {
    cleanup(root);
  }
});

test('migra una traduzione come kind translation', () => {
  const root = tempDir();
  try {
    const rec = copyFixture('translated', root);
    ensureRecordingMigrated(rec);

    const metadata = readJson(path.join(rec, 'metadata.json'));
    assert.equal(metadata.isTranslated, true);
    assert.equal(metadata.isCompleteTranscript, true);

    const transcript = readJson(revisionPath(rec, 'r1', 'transcript.json'));
    assert.equal(transcript.kind, 'translation');
    assert.equal(transcript.source.targetLanguage, 'en');
    assert.equal(transcript.source.timing, 'segment');
    assert.equal(transcript.segments.length, 2);
  } finally {
    cleanup(root);
  }
});

test('migra txt-only in un segmento whole-recording', () => {
  const root = tempDir();
  try {
    const rec = copyFixture('txt-only', root);
    ensureRecordingMigrated(rec);

    const transcript = readJson(revisionPath(rec, 'r1', 'transcript.json'));
    assert.equal(transcript.source.format, 'legacy-txt');
    assert.equal(transcript.source.timing, 'whole-recording');
    assert.equal(transcript.segments.length, 1);
    assert.equal(transcript.segments[0].start, 0);
    assert.equal(transcript.segments[0].end, 31.5);
  } finally {
    cleanup(root);
  }
});

test('conserva il testo modificato v1 come legacyDocumentText', () => {
  const root = tempDir();
  try {
    const rec = copyFixture('edited-text', root);
    ensureRecordingMigrated(rec);

    const transcript = readJson(revisionPath(rec, 'r1', 'transcript.json'));
    const edits = readJson(revisionPath(rec, 'r1', 'edits.json'));
    assert.equal(
      transcript.segments.map((segment) => segment.text).join(' '),
      'Testo originale primo. Testo originale secondo.',
    );
    assert.equal(edits.legacyDocumentText, "Testo modificato dall'utente.");

    const view = readActiveTranscript(rec);
    assert.equal(view.success, true);
    assert.equal(view.transcript.text, "Testo modificato dall'utente.");
    assert.deepEqual(view.transcript.segments, []);
    assert.equal(view.transcript.legacyDocumentText, true);
  } finally {
    cleanup(root);
  }
});

test('rifiuta metadata corrotto senza toccare i file', () => {
  const root = tempDir();
  try {
    const rec = copyFixture('corrupt-metadata', root);
    assert.throws(
      () => ensureRecordingMigrated(rec),
      (err) => err.code === 'invalid-metadata',
    );
    assert.ok(fs.existsSync(path.join(rec, 'transcript.json')));
    assert.equal(fs.existsSync(path.join(rec, REVISIONS_DIR)), false);
  } finally {
    cleanup(root);
  }
});

test('rifiuta uno schema più nuovo', () => {
  const root = tempDir();
  try {
    const rec = copyFixture('live-preview', root);
    const metaPath = path.join(rec, 'metadata.json');
    const metadata = readJson(metaPath);
    metadata.schemaVersion = 99;
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    assert.throws(
      () => ensureRecordingMigrated(rec),
      (err) => err.code === 'unsupported-schema',
    );
  } finally {
    cleanup(root);
  }
});

test('recupera una migrazione interrotta da .backup-v1', () => {
  const root = tempDir();
  try {
    const rec = copyFixture('live-preview', root);
    ensureRecordingMigrated(rec);

    const originalMetadata = readJson(
      path.join(__dirname, 'fixtures', 'v1', 'live-preview', 'metadata.json'),
    );
    fs.writeFileSync(
      path.join(rec, 'metadata.json'),
      JSON.stringify(originalMetadata, null, 2),
    );

    const result = ensureRecordingMigrated(rec);
    assert.equal(result.migrated, true);
    assert.equal(readJson(path.join(rec, 'metadata.json')).activeRevisionId, 'r1');
    assert.ok(fs.existsSync(path.join(rec, BACKUP_DIR, 'metadata.json')));
    assert.ok(fs.existsSync(revisionPath(rec, 'r1', 'transcript.json')));
  } finally {
    cleanup(root);
  }
});

test('una registrazione v1 senza trascrizione diventa v2 senza inventare revisioni', () => {
  const root = tempDir();
  try {
    const rec = path.join(root, 'senza-trascrizione');
    fs.mkdirSync(rec, { recursive: true });
    fs.writeFileSync(
      path.join(rec, 'metadata.json'),
      JSON.stringify({
        name: 'Solo audio',
        date: '2025-07-08T07:00:00.000Z',
        folder: null,
        duration: 14,
        hasTranscript: false,
      }, null, 2),
    );
    fs.writeFileSync(path.join(rec, 'audio.wav'), 'RIFF');

    const result = ensureRecordingMigrated(rec);
    assert.equal(result.migrated, true);

    const metadata = readJson(path.join(rec, 'metadata.json'));
    assert.equal(metadata.schemaVersion, 2);
    assert.equal(metadata.hasTranscript, false);
    assert.equal(metadata.activeRevisionId, null);
    assert.deepEqual(metadata.revisions, []);
    assert.deepEqual(metadata.migrationWarnings, ['transcript-missing']);
    assert.equal(fs.existsSync(path.join(rec, REVISIONS_DIR)), false);
    assert.equal(
      readJson(path.join(rec, BACKUP_DIR, 'metadata.json')).schemaVersion,
      undefined,
    );
    assert.equal(readJson(path.join(rec, BACKUP_DIR, 'backup.json')).schemaVersion, 1);
  } finally {
    cleanup(root);
  }
});

test('un transcript JSON corrotto ripiega su transcript.txt', () => {
  const root = tempDir();
  try {
    const rec = path.join(root, 'json-rotto');
    fs.mkdirSync(rec, { recursive: true });
    fs.writeFileSync(
      path.join(rec, 'metadata.json'),
      JSON.stringify({
        name: 'Recupero txt',
        date: '2025-07-09T07:00:00.000Z',
        duration: 20,
        hasTranscript: true,
        isCompleteTranscript: true,
      }, null, 2),
    );
    fs.writeFileSync(path.join(rec, 'transcript.json'), '{ non-json');
    fs.writeFileSync(path.join(rec, 'transcript.txt'), 'Recuperato dal testo\n');

    ensureRecordingMigrated(rec);

    const metadata = readJson(path.join(rec, 'metadata.json'));
    assert.ok(metadata.migrationWarnings.includes('invalid-transcript-json'));

    const transcript = readJson(revisionPath(rec, 'r1', 'transcript.json'));
    assert.equal(transcript.source.format, 'legacy-txt');
    assert.equal(transcript.source.timing, 'whole-recording');
    assert.equal(transcript.segments[0].text, 'Recuperato dal testo');
    assert.equal(transcript.segments[0].end, 20);
  } finally {
    cleanup(root);
  }
});

test('un transcript v1 senza segmenti usa la durata come fallback', () => {
  const root = tempDir();
  try {
    const rec = path.join(root, 'solo-testo-json');
    fs.mkdirSync(rec, { recursive: true });
    fs.writeFileSync(
      path.join(rec, 'metadata.json'),
      JSON.stringify({
        name: 'Solo testo json',
        date: '2025-07-10T07:00:00.000Z',
        duration: 12.5,
        hasTranscript: true,
        isCompleteTranscript: true,
      }, null, 2),
    );
    fs.writeFileSync(
      path.join(rec, 'transcript.json'),
      JSON.stringify({ segments: [], text: 'Testo senza segmenti' }, null, 2),
    );

    ensureRecordingMigrated(rec);

    const transcript = readJson(revisionPath(rec, 'r1', 'transcript.json'));
    assert.equal(transcript.source.timing, 'whole-recording');
    assert.deepEqual(transcript.segments, [{
      id: 'r1-s0001',
      start: 0,
      end: 12.5,
      text: 'Testo senza segmenti',
    }]);
  } finally {
    cleanup(root);
  }
});

test('il backup v1 non contiene audio e conserva la lista dei file', () => {
  const root = tempDir();
  try {
    const rec = copyFixture('live-preview', root);
    fs.writeFileSync(path.join(rec, 'audio.wav'), 'RIFF');
    ensureRecordingMigrated(rec);

    const backup = readJson(path.join(rec, BACKUP_DIR, 'backup.json'));
    assert.equal(backup.schemaVersion, 1);
    assert.equal(backup.files.includes('audio.wav'), false);
    assert.ok(backup.files.includes('metadata.json'));
    assert.equal(fs.existsSync(path.join(rec, BACKUP_DIR, 'audio.wav')), false);
  } finally {
    cleanup(root);
  }
});

test('una cartella spostata viene migrata senza dipendere dal folder del metadata', () => {
  const root = tempDir();
  try {
    const rec = copyFixture('moved', root);
    ensureRecordingMigrated(rec);

    const metadata = readJson(path.join(rec, 'metadata.json'));
    assert.equal(metadata.folder, 'Gruppo vecchio');
    assert.equal(metadata.schemaVersion, 2);
    assert.equal(metadata.activeRevisionId, 'r1');
    assert.ok(fs.existsSync(revisionPath(rec, 'r1', 'transcript.json')));
  } finally {
    cleanup(root);
  }
});

test('una migrazione interrotta senza backup viene rifiutata', () => {
  const root = tempDir();
  try {
    const rec = copyFixture('live-preview', root);
    fs.mkdirSync(path.join(rec, REVISIONS_DIR, 'r1'), { recursive: true });

    assert.throws(
      () => ensureRecordingMigrated(rec),
      (err) => err.code === 'half-migration-no-backup',
    );
  } finally {
    cleanup(root);
  }
});
