'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createTranscriptionService } = require('../src/main/transcription-service');
const transcriptStore = require('../src/core/transcript/store');
const { tempDir, readJson, cleanup } = require('./helpers');

function recording(root) {
  const rec = path.join(root, 'Lezione');
  fs.mkdirSync(rec);
  fs.writeFileSync(
    path.join(rec, 'metadata.json'),
    JSON.stringify(transcriptStore.createMetadataForNewRecording({
      name: 'Lezione',
      date: new Date('2025-06-07T08:00:00.000Z'),
    }), null, 2),
  );
  return rec;
}

function models({ transcription = true, translation = false } = {}) {
  return {
    status(translate) {
      const ready = translate ? translation : transcription;
      return {
        ready,
        path: translate ? '/models/ggml-medium.bin' : '/models/ggml-large-v3-turbo.bin',
        filename: translate ? 'ggml-medium.bin' : 'ggml-large-v3-turbo.bin',
        code: ready ? null : (translate ? 'translation-model-missing' : 'model-missing'),
        message: ready ? null : (translate ? 'Modello di traduzione non trovato.' : 'Modello Whisper non trovato.'),
      };
    },
  };
}

function cliBackend({ writeOutput = true } = {}) {
  return {
    isAvailable: () => true,
    transcribeFile: async ({ outputPrefix, onProgress }) => {
      onProgress(50);
      onProgress(100);
      if (writeOutput) {
        fs.writeFileSync(`${outputPrefix}.json`, JSON.stringify({
          transcription: [{ offsets: { from: 0, to: 1000 }, text: ' Ciao mondo ' }],
        }));
      }
      return { success: true };
    },
  };
}

function serverBackend() {
  return {
    isAvailable: () => false,
    ensure: async () => null,
    transcribeChunk: async () => ({ success: false }),
  };
}

test('startFull restituisce i codici model-missing senza creare staging', async () => {
  const root = tempDir();
  try {
    const rec = recording(root);
    const service = createTranscriptionService({
      models: models({ transcription: false }),
      cliBackend: cliBackend(),
      serverBackend: serverBackend(),
      store: transcriptStore,
    });
    let error = null;

    const result = service.startFull({
      recDir: rec,
      audioPath: path.join(rec, 'audio.wav'),
      language: 'it',
      onError: (value) => { error = value; },
    });

    assert.equal(result.success, false);
    assert.equal(result.code, 'model-missing');
    assert.deepEqual(error, {
      code: 'model-missing',
      message: 'Modello Whisper non trovato.',
    });
    assert.deepEqual(fs.readdirSync(rec).sort(), ['metadata.json']);
  } finally {
    cleanup(root);
  }
});

test('startFull distingue translation-model-missing', () => {
  const service = createTranscriptionService({
    models: models({ transcription: true, translation: false }),
    cliBackend: cliBackend(),
    serverBackend: serverBackend(),
    store: transcriptStore,
  });
  let error = null;

  const result = service.startFull({
    recDir: '/tmp/non-usato',
    audioPath: '/tmp/non-usato/audio.wav',
    translate: true,
    onError: (value) => { error = value; },
  });

  assert.equal(result.code, 'translation-model-missing');
  assert.equal(error.code, 'translation-model-missing');
});

test('startFull pubblica la revisione e segnala il progresso', async () => {
  const root = tempDir();
  try {
    const rec = recording(root);
    const service = createTranscriptionService({
      models: models(),
      cliBackend: cliBackend(),
      serverBackend: serverBackend(),
      store: transcriptStore,
    });
    const progress = [];
    const done = await new Promise((resolve, reject) => {
      const started = service.startFull({
        recDir: rec,
        audioPath: path.join(rec, 'audio.wav'),
        language: 'it',
        onProgress: (value) => progress.push(value),
        onDone: resolve,
        onError: reject,
      });
      assert.equal(started.success, true);
    });

    assert.deepEqual(progress, [50, 100]);
    assert.equal(done.recDir, rec);
    assert.equal(done.translate, false);
    assert.equal(done.transcript.text, 'Ciao mondo');

    const transcript = readJson(path.join(rec, '.revisions', 'r1', 'transcript.json'));
    assert.equal(transcript.segments[0].text, 'Ciao mondo');
    assert.equal(transcript.segments[0].end, 1);
    assert.equal(transcript.source.model, 'ggml-large-v3-turbo.bin');
    assert.deepEqual(fs.readdirSync(rec).filter((name) => name.startsWith('.tmp-')), []);
  } finally {
    cleanup(root);
  }
});

test('startFull segnala output vuoto e ripulisce la staging', async () => {
  const root = tempDir();
  try {
    const rec = recording(root);
    const service = createTranscriptionService({
      models: models(),
      cliBackend: cliBackend({ writeOutput: false }),
      serverBackend: serverBackend(),
      store: transcriptStore,
    });

    const error = await new Promise((resolve) => {
      service.startFull({
        recDir: rec,
        audioPath: path.join(rec, 'audio.wav'),
        onError: resolve,
      });
    });

    assert.equal(error, 'Nessun output Whisper');
    assert.deepEqual(fs.readdirSync(rec).filter((name) => name.startsWith('.tmp-')), []);
  } finally {
    cleanup(root);
  }
});

test('startFull rifiuta una seconda trascrizione concorrente', async () => {
  const root = tempDir();
  try {
    const rec = recording(root);
    let release;
    const cli = {
      isAvailable: () => true,
      transcribeFile: () => new Promise((resolve) => { release = resolve; }),
    };
    const service = createTranscriptionService({
      models: models(),
      cliBackend: cli,
      serverBackend: serverBackend(),
      store: transcriptStore,
    });

    service.startFull({ recDir: rec, audioPath: path.join(rec, 'audio.wav') });
    assert.equal(service.isActive(), true);

    const second = service.startFull({ recDir: rec, audioPath: path.join(rec, 'audio.wav') });
    assert.equal(second.success, false);
    assert.equal(second.code, 'busy');

    release({ success: false, error: 'stop' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(service.isActive(), false);
  } finally {
    cleanup(root);
  }
});
