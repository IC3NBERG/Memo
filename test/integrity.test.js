'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { scanArchive, inspectRecording } = require('../src/core/library/integrity');
const { writeManifest } = require('../src/core/library/manifest');
const { createMetadataForNewRecording, createRevision } = require('../src/core/transcript/store');
const { tempDir, copyFixture, readJson, cleanup } = require('./helpers');

function createRecording(root, name = 'Lezione') {
  const rec = path.join(root, name);
  fs.mkdirSync(rec, { recursive: true });
  fs.writeFileSync(path.join(rec, 'audio.wav'), 'RIFF-audio-0123456789');
  const metadata = createMetadataForNewRecording({
    name,
    date: new Date('2025-06-07T08:00:00.000Z'),
    folder: null,
  });
  fs.writeFileSync(path.join(rec, 'metadata.json'), JSON.stringify(metadata, null, 2));
  const revision = createRevision(rec, {
    kind: 'transcription',
    source: { engine: 'whisper-cli', model: null, language: 'it', complete: true },
    segments: [
      { start: 0, end: 5, text: 'primo' },
      { start: 5, end: 10, text: 'secondo' },
    ],
  });
  assert.equal(revision.success, true);
  writeManifest(rec);
  return rec;
}

function revisionFile(rec, revisionId, file) {
  return path.join(rec, '.revisions', revisionId, file);
}

test('una registrazione integra non produce problemi', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const report = inspectRecording(rec, { deep: true });

    assert.equal(report.status, 'ok');
    assert.equal(report.metadataStatus, 'ok');
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
    assert.equal(report.summary.files.ok, report.summary.files.total);
    assert.deepEqual(report.issues, []);
  } finally {
    cleanup(root);
  }
});

test('segnala file mancanti, modificati e non tracciati senza scrivere', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const before = fs.readFileSync(path.join(rec, 'metadata.json'), 'utf8');

    fs.writeFileSync(path.join(rec, 'audio.wav'), 'RIFF-audio-XXXXXXXXXX');
    const modified = inspectRecording(rec, { deep: true });
    assert.equal(modified.status, 'error');
    assert.equal(modified.issues.some((item) => item.code === 'modified-file'), true);

    fs.unlinkSync(path.join(rec, 'transcript.txt'));
    fs.writeFileSync(path.join(rec, 'extra.txt'), 'extra');
    const report = inspectRecording(rec, { deep: true });
    assert.equal(report.status, 'error');
    assert.equal(report.issues.some((item) => item.code === 'missing-file'), true);
    assert.equal(report.issues.some((item) => item.code === 'untracked-file'), true);

    assert.equal(fs.readFileSync(path.join(rec, 'metadata.json'), 'utf8'), before);
  } finally {
    cleanup(root);
  }
});

test('la scansione superficiale non ricalcola gli hash', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    fs.writeFileSync(path.join(rec, 'audio.wav'), 'RIFF-audio-XXXXXXXXXX');

    const shallow = inspectRecording(rec, { deep: false });
    assert.equal(shallow.status, 'ok');
    assert.equal(shallow.manifest.summary.unverified, shallow.manifest.summary.total);

    const deep = inspectRecording(rec, { deep: true });
    assert.equal(deep.status, 'error');
    assert.equal(deep.issues.some((item) => item.code === 'modified-file'), true);
  } finally {
    cleanup(root);
  }
});

test('un manifest assente è un avviso informativo, non un errore', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    fs.unlinkSync(path.join(rec, 'manifest.json'));

    const report = inspectRecording(rec, { deep: true });
    assert.equal(report.status, 'ok');
    assert.equal(report.issues.some((item) => item.code === 'missing-manifest'), true);
    assert.equal(report.issues.find((item) => item.code === 'missing-manifest').severity, 'info');
  } finally {
    cleanup(root);
  }
});

test('segnala metadata e trascrizioni non validi', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    fs.writeFileSync(path.join(rec, 'metadata.json'), '{ rotto');
    const metadataReport = inspectRecording(rec, { deep: false });
    assert.equal(metadataReport.metadataStatus, 'invalid');
    assert.equal(metadataReport.issues.some((item) => item.code === 'invalid-metadata'), true);
  } finally {
    cleanup(root);
  }

  const root2 = tempDir();
  try {
    const rec = createRecording(root2);
    fs.writeFileSync(revisionFile(rec, 'r1', 'transcript.json'), '{ rotto');
    writeManifest(rec);
    const report = inspectRecording(rec, { deep: false });
    assert.equal(report.status, 'error');
    assert.equal(report.issues.some((item) => item.code === 'invalid-transcript'), true);
  } finally {
    cleanup(root2);
  }
});

test('ripara in memoria un transcript non conforme e lo segnala', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const transcriptPath = revisionFile(rec, 'r1', 'transcript.json');
    const transcript = readJson(transcriptPath);
    transcript.segments = [
      { id: 'r1-s0001', start: 0, end: 5, text: 'uno' },
      { id: 'r1-s0001', start: 5, end: 10, text: 'duplicato' },
      { id: 'r9-s0009', start: 10, end: 8, text: 'revisione sbagliata' },
      null,
      { start: 'x', end: 'y', text: 42 },
    ];
    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
    writeManifest(rec);

    const report = inspectRecording(rec, { deep: true });
    assert.equal(report.status, 'warning');
    assert.equal(report.issues.some((item) => item.code === 'transcript-repaired'), true);
    assert.equal(report.issues.some((item) => item.code === 'invalid-transcript'), false);
    assert.equal(report.summary.errors, 0);

    // La riparazione è solo in memoria: i byte su disco restano quelli scritti.
    assert.deepEqual(readJson(transcriptPath).segments, transcript.segments);
  } finally {
    cleanup(root);
  }
});

test('scanArchive non migra né scrive durante la scansione', () => {
  const root = tempDir();
  try {
    const recordingsDir = path.join(root, 'archive');
    const group = path.join(recordingsDir, 'Gruppo');
    fs.mkdirSync(group, { recursive: true });
    const rec = copyFixture('live-preview', group);
    const metadataPath = path.join(rec, 'metadata.json');
    const before = fs.readFileSync(metadataPath, 'utf8');

    const report = scanArchive({ recordingsDir, deep: false });
    assert.equal(report.recordings.length, 1);
    assert.equal(report.recordings[0].metadataStatus, 'legacy');
    assert.equal(report.summary.noManifest, 1);
    assert.equal(fs.readFileSync(metadataPath, 'utf8'), before);
    assert.equal(fs.existsSync(path.join(rec, '.revisions')), false);
    assert.equal(fs.existsSync(path.join(rec, 'manifest.json')), false);

    const second = scanArchive({ recordingsDir, recDirs: [rec], deep: true });
    assert.equal(second.recordings.length, 1);
    assert.equal(second.deep, true);
    assert.equal(fs.readFileSync(metadataPath, 'utf8'), before);
  } finally {
    cleanup(root);
  }
});

test('scanArchive aggrega stato e conteggi dell’archivio', () => {
  const root = tempDir();
  try {
    const recordingsDir = path.join(root, 'archive');
    const group = path.join(recordingsDir, 'Gruppo');
    fs.mkdirSync(group, { recursive: true });
    const good = createRecording(group, 'Buona');
    const bad = createRecording(group, 'Danneggiata');
    fs.unlinkSync(path.join(bad, 'audio.wav'));

    const report = scanArchive({ recordingsDir, deep: true });
    assert.equal(report.summary.recordings, 2);
    assert.equal(report.summary.ok, 1);
    assert.equal(report.summary.errors, 1);
    assert.equal(report.summary.missingFiles, 1);
    assert.equal(report.status, 'error');
    assert.equal(report.recordings.find((item) => item.recDir === good).status, 'ok');
    assert.equal(report.recordings.find((item) => item.recDir === bad).status, 'error');
  } finally {
    cleanup(root);
  }
});
