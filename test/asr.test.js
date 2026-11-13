'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  MODEL_MISSING,
  TRANSLATION_MODEL_MISSING,
  createModelResolver,
} = require('../src/core/asr/models');
const { parseProgress } = require('../src/core/asr/backends/whisper-cli');
const {
  parseWhisperCliJson,
  parseWhisperServerJson,
  wordsFromTokens,
} = require('../src/core/asr/parse');
const { createAsrService } = require('../src/core/asr/service');

function resolver({ transcription = true, translation = false } = {}) {
  const files = new Set();
  if (transcription) files.add(path.join('/models', 'ggml-large-v3-turbo.bin'));
  if (translation) files.add(path.join('/models', 'ggml-medium.bin'));
  return createModelResolver({
    modelsDir: '/models',
    legacyModelsDir: '/old/.models',
    exists: (file) => files.has(file),
  });
}

test('model resolver distingue model-missing e translation-model-missing', () => {
  const models = resolver({ transcription: true, translation: false });

  assert.deepEqual(
    {
      ready: models.status(false).ready,
      code: models.status(false).code,
      path: models.status(false).path,
    },
    { ready: true, code: null, path: '/models/ggml-large-v3-turbo.bin' },
  );

  assert.equal(models.status(true).code, TRANSLATION_MODEL_MISSING);
  assert.equal(models.status(true).message, 'Modello di traduzione non trovato. Scaricalo per tradurre in inglese.');
  assert.equal(MODEL_MISSING, 'model-missing');
});

test('model resolver preferisce il modello legacy se il primario manca', () => {
  const models = createModelResolver({
    modelsDir: '/models',
    legacyModelsDir: '/old/.models',
    exists: (file) => file === '/old/.models/ggml-large-v3-turbo.bin',
  });
  assert.equal(models.status(false).ready, true);
  assert.equal(models.status(false).path, '/old/.models/ggml-large-v3-turbo.bin');
});

test('il servizio ASR restituisce i codici model-missing senza toccare i backend', async () => {
  let touched = 0;
  const service = createAsrService({
    models: resolver({ transcription: false, translation: false }),
    chunkBackends: [{
      kind: 'fake',
      isAvailable: () => true,
      transcribeChunk: () => { touched += 1; return Promise.resolve({ success: true }); },
    }],
  });

  assert.deepEqual(await service.transcribeChunk({ buffer: Buffer.from('x') }), {
    success: false,
    code: MODEL_MISSING,
    error: 'Modello Whisper non trovato in ~/CrunchRecordings/.models.',
  });
  assert.deepEqual(await service.transcribeChunk({ buffer: Buffer.from('x'), translate: true }), {
    success: false,
    code: TRANSLATION_MODEL_MISSING,
    error: 'Modello di traduzione non trovato. Scaricalo per tradurre in inglese.',
  });
  assert.equal(touched, 0);
});

test('il servizio ASR ripiega sul backend successivo e disabilita il server caduto', async () => {
  const calls = [];
  let disabled = false;
  const service = createAsrService({
    models: resolver(),
    chunkBackends: [{
      kind: 'whisper-server',
      isAvailable: () => true,
      ensure: async () => ({ port: 1 }),
      transcribeChunk: async () => { calls.push('server'); throw new Error('server down'); },
      disable: () => { disabled = true; },
    }, {
      kind: 'whisper-cli',
      isAvailable: () => true,
      transcribeChunk: async () => { calls.push('cli'); return { success: true, engine: 'cli', text: 'ok' }; },
    }],
  });

  const result = await service.transcribeChunk({ buffer: Buffer.from('x') });
  assert.deepEqual(result, { success: true, engine: 'cli', text: 'ok' });
  assert.deepEqual(calls, ['server', 'cli']);
  assert.equal(disabled, true);
});

test('il servizio ASR rifiuta audio vuoto e backend assenti', async () => {
  const service = createAsrService({ models: resolver(), chunkBackends: [] });
  assert.deepEqual(await service.transcribeChunk({ buffer: Buffer.alloc(0) }), {
    success: false,
    code: 'empty-audio',
    error: 'Audio mancante',
  });
  assert.deepEqual(await service.transcribeChunk({ buffer: Buffer.from('x') }), {
    success: false,
    code: 'asr-unavailable',
    error: 'Motore whisper-cli non trovato.',
  });
});

test('il servizio ASR prewarm usa il modello tradotto quando richiesto', async () => {
  const seen = [];
  const service = createAsrService({
    models: resolver({ transcription: true, translation: true }),
    chunkBackends: [{
      kind: 'fake',
      isAvailable: () => true,
      ensure: async (modelPath) => { seen.push(modelPath); return {}; },
      transcribeChunk: async () => ({ success: true }),
    }],
  });

  assert.deepEqual(await service.prewarm({ translate: true }), { success: true, engine: 'fake' });
  assert.deepEqual(seen, ['/models/ggml-medium.bin']);
});

test('parseWhisperCliJson converte offset ms in secondi e ricompone le parole', () => {
  const parsed = parseWhisperCliJson({
    result: { language: 'it' },
    transcription: [{
      offsets: { from: 1000, to: 2400 },
      text: ' gatto ',
      tokens: [
        { text: ' g', offsets: { from: 1000, to: 1100 } },
        { text: 'atto', offsets: { from: 1100, to: 1400 } },
        { text: ' nero', offsets: { from: 1500, to: 2400 } },
      ],
    }],
  });

  assert.equal(parsed.language, 'it');
  assert.equal(parsed.text, 'gatto');
  assert.equal(parsed.segments[0].start, 1);
  assert.equal(parsed.segments[0].end, 2.4);
  assert.deepEqual(parsed.segments[0].words, [
    { start: 1, end: 1.4, text: 'gatto' },
    { start: 1.5, end: 2.4, text: 'nero' },
  ]);
});

test('i token speciali non diventano parole', () => {
  assert.deepEqual(
    wordsFromTokens([
      { text: '[_BEG_]', start: 0, end: 0 },
      { text: ' Ciao', start: 0, end: 0.5 },
    ], 0, 1),
    [{ start: 0, end: 0.5, text: 'Ciao' }],
  );
});

test('parseWhisperServerJson usa testo, lingua e parole del server', () => {
  const parsed = parseWhisperServerJson({
    text: ' Buongiorno ',
    language: 'it',
    segments: [{
      start: 0,
      end: 1.25,
      text: ' Buongiorno ',
      words: [{ word: ' Buongiorno', start: 0, end: 1.25 }],
    }],
  });

  assert.equal(parsed.text, 'Buongiorno');
  assert.equal(parsed.language, 'it');
  assert.deepEqual(parsed.segments[0].words, [{ start: 0, end: 1.25, text: 'Buongiorno' }]);
});

test('parseProgress estrae solo percentuali valide', () => {
  assert.equal(parseProgress('progress = 42%'), 42);
  assert.equal(parseProgress('whisper_print_progress_callback: progress = 150%'), 100);
  assert.equal(parseProgress('nessuna percentuale'), null);
});
