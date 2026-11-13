'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createWhisperCliBackend } = require('../src/core/asr/backends/whisper-cli');
const {
  cleanupStaging,
  createWhisperStaging,
  publishWhisperOutput,
  whisperOutputPrefix,
} = require('../src/core/transcript/whisper');
const { createMetadataForNewRecording } = require('../src/core/transcript/store');
const { tempDir, readJson, cleanup } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const WAV = path.join(__dirname, 'fixtures', 'audio', 'reference.wav');
const BIN = path.join(ROOT, 'bin', 'whisper-cli');
const MODEL = process.env.CRUNCH_WHISPER_MODEL
  || path.join(os.homedir(), 'CrunchRecordings', '.models', 'ggml-large-v3-turbo.bin');
const available = fs.existsSync(WAV) && fs.existsSync(BIN) && fs.existsSync(MODEL);

test('trascrizione completa del WAV di riferimento', {
  skip: available ? false : 'WAV, whisper-cli o modello non disponibili',
  timeout: 120000,
}, async () => {
  const root = tempDir();
  try {
    const rec = path.join(root, 'Lezione');
    fs.mkdirSync(rec);
    fs.writeFileSync(
      path.join(rec, 'metadata.json'),
      JSON.stringify(createMetadataForNewRecording({
        name: 'Lezione',
        date: new Date('2025-06-07T08:00:00.000Z'),
      }), null, 2),
    );

    const staging = createWhisperStaging(rec);
    const backend = createWhisperCliBackend({ binPath: BIN });

    const result = await backend.transcribeFile({
      modelPath: MODEL,
      outputPrefix: whisperOutputPrefix(staging),
      audioPath: WAV,
      language: 'it',
      translate: false,
    });
    assert.equal(result.success, true);

    const published = publishWhisperOutput(rec, staging, {
      model: path.basename(MODEL),
      language: 'it',
      translate: false,
    });
    cleanupStaging(staging);

    assert.equal(published.success, true);
    assert.equal(published.revisionId, 'r1');
    assert.equal(published.kind, 'transcription');

    const transcript = readJson(path.join(rec, '.revisions', 'r1', 'transcript.json'));
    const text = transcript.segments.map((segment) => segment.text).join(' ');
    assert.match(text, /prova/i);
    assert.match(text, /trascrizione automatica/i);
    assert.ok(transcript.segments[0].end > transcript.segments[0].start);
    assert.equal(transcript.source.language, 'it');
    assert.equal(transcript.source.complete, true);
  } finally {
    cleanup(root);
  }
});
