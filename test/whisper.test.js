'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  buildWhisperArgs,
  cleanupStaging,
  createWhisperStaging,
  publishWhisperOutput,
  readWhisperOutput,
  whisperOutputPrefix,
} = require('../src/core/transcript/whisper');
const transcriptStore = require('../src/core/transcript/store');
const { tempDir, readJson, cleanup } = require('./helpers');

function createRecording(root) {
  const rec = path.join(root, 'rec');
  fs.mkdirSync(rec, { recursive: true });
  fs.writeFileSync(
    path.join(rec, 'metadata.json'),
    JSON.stringify(transcriptStore.createMetadataForNewRecording({
      name: 'Lezione',
      date: new Date('2025-06-07T08:00:00.000Z'),
    }), null, 2),
  );
  return rec;
}

test('la staging Whisper è interna alla registrazione', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const staging = createWhisperStaging(rec, { now: 123, random: () => 0.5 });

    assert.equal(path.dirname(staging), rec);
    assert.match(path.basename(staging), /^\.tmp-whisper-123-/);
    assert.ok(fs.existsSync(staging));
    assert.equal(whisperOutputPrefix(staging), path.join(staging, 'audio'));

    cleanupStaging(staging);
    assert.equal(fs.existsSync(staging), false);
  } finally {
    cleanup(root);
  }
});

test('buildWhisperArgs aggiunge --translate solo per la traduzione', () => {
  const base = {
    modelPath: '/models/ggml-large-v3-turbo.bin',
    outputPrefix: '/rec/.tmp-whisper-1/audio',
    audioPath: '/rec/audio.wav',
    language: 'it',
  };

  const normal = buildWhisperArgs({ ...base, translate: false });
  assert.equal(normal.includes('--translate'), false);
  assert.equal(normal[normal.indexOf('--language') + 1], 'it');

  const translated = buildWhisperArgs({ ...base, translate: true });
  assert.equal(translated.includes('--translate'), true);

  const auto = buildWhisperArgs({ ...base, language: null, translate: false });
  assert.equal(auto[auto.indexOf('--language') + 1], 'auto');
});

test('publishWhisperOutput converte gli offset Whisper e crea r1', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const staging = createWhisperStaging(rec);
    fs.writeFileSync(
      path.join(staging, 'audio.json'),
      JSON.stringify({
        transcription: [
          { offsets: { from: 0, to: 1234 }, text: ' Ciao ' },
          { offsets: { from: 1234, to: 2500 }, text: ' mondo ' },
        ],
      }),
    );

    const output = readWhisperOutput(staging);
    assert.equal(output.format, 'whisper-json');
    assert.equal(output.segments.length, 2);
    assert.equal(output.text, 'Ciao mondo');

    const result = publishWhisperOutput(rec, staging, {
      model: 'ggml-large-v3-turbo.bin',
      language: 'it',
      translate: false,
    });
    assert.equal(result.success, true);
    assert.equal(result.revisionId, 'r1');

    const transcript = readJson(path.join(rec, '.revisions', 'r1', 'transcript.json'));
    assert.equal(transcript.kind, 'transcription');
    assert.equal(transcript.source.model, 'ggml-large-v3-turbo.bin');
    assert.equal(transcript.source.language, 'it');
    assert.equal(transcript.source.timing, 'segment');
    assert.deepEqual(
      transcript.segments.map(({ id, start, end, text }) => ({ id, start, end, text })),
      [
        { id: 'r1-s0001', start: 0, end: 1.234, text: 'Ciao' },
        { id: 'r1-s0002', start: 1.234, end: 2.5, text: 'mondo' },
      ],
    );
  } finally {
    cleanup(root);
  }
});

test('publishWhisperOutput mappa la traduzione su kind translation', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const staging = createWhisperStaging(rec);
    fs.writeFileSync(
      path.join(staging, 'audio.json'),
      JSON.stringify({
        transcription: [{ offsets: { from: 0, to: 1000 }, text: 'Hello' }],
      }),
    );

    const result = publishWhisperOutput(rec, staging, {
      model: 'ggml-medium.bin',
      language: 'it',
      translate: true,
    });
    assert.equal(result.success, true);
    assert.equal(result.kind, 'translation');

    const transcript = readJson(path.join(rec, '.revisions', 'r1', 'transcript.json'));
    assert.equal(transcript.kind, 'translation');
    assert.equal(transcript.source.translated, true);
    assert.equal(transcript.source.targetLanguage, 'en');

    const metadata = readJson(path.join(rec, 'metadata.json'));
    assert.equal(metadata.isTranslated, true);
    assert.equal(metadata.activeRevisionId, 'r1');
  } finally {
    cleanup(root);
  }
});

test('publishWhisperOutput accetta il solo file txt', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const staging = createWhisperStaging(rec);
    fs.writeFileSync(path.join(staging, 'audio.txt'), 'Solo testo\n');

    const output = readWhisperOutput(staging);
    assert.equal(output.format, 'whisper-txt');
    assert.equal(output.text, 'Solo testo');

    const result = publishWhisperOutput(rec, staging, { translate: false });
    assert.equal(result.success, true);

    const transcript = readJson(path.join(rec, '.revisions', 'r1', 'transcript.json'));
    assert.equal(transcript.source.timing, 'whole-recording');
    assert.equal(transcript.segments.length, 1);
    assert.equal(transcript.segments[0].start, 0);
  } finally {
    cleanup(root);
  }
});

test('publishWhisperOutput segnala una staging vuota', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const staging = createWhisperStaging(rec);

    assert.equal(readWhisperOutput(staging), null);
    assert.deepEqual(publishWhisperOutput(rec, staging), {
      success: false,
      code: 'empty-output',
      error: 'Nessun output Whisper',
    });
  } finally {
    cleanup(root);
  }
});

test('readActiveTranscript rimuove solo le staging orfane più vecchie', () => {
  const root = tempDir();
  try {
    const rec = createRecording(root);
    const oldStaging = path.join(rec, '.tmp-whisper-old');
    const freshStaging = path.join(rec, '.tmp-whisper-fresh');
    fs.mkdirSync(oldStaging);
    fs.mkdirSync(freshStaging);

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(oldStaging, twoHoursAgo, twoHoursAgo);

    transcriptStore.readActiveTranscript(rec);

    assert.equal(fs.existsSync(oldStaging), false);
    assert.equal(fs.existsSync(freshStaging), true);
  } finally {
    cleanup(root);
  }
});
