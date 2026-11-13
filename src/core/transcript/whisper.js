'use strict';

const fs = require('fs');
const path = require('path');

const transcriptStore = require('./store');
const { buildWhisperArgs } = require('../asr/backends/whisper-cli');

const STAGING_PREFIX = '.tmp-whisper-';

function stagingDirName({ now = Date.now(), random = Math.random } = {}) {
  return `${STAGING_PREFIX}${now}-${random().toString(36).slice(2, 8)}`;
}

/**
 * Whisper deve scrivere nella stessa filesystem della registrazione: solo così
 * il passaggio a `.revisions/rN/` può essere un rename atomico.
 */
function createWhisperStaging(recDir, options = {}) {
  const stagingDir = path.join(recDir, stagingDirName(options));
  fs.mkdirSync(stagingDir, { recursive: true });
  return stagingDir;
}

function cleanupStaging(stagingDir) {
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  } catch (_) {}
}

function whisperOutputPrefix(stagingDir) {
  return path.join(stagingDir, 'audio');
}

/**
 * Legge l'output di whisper-cli dalla staging. I segmenti grezzi (con offsets
 * in millisecondi) vengono normalizzati dal revision store, così esiste una
 * sola conversione ms → secondi in tutto il codice.
 */
function readWhisperOutput(stagingDir) {
  const outputPrefix = whisperOutputPrefix(stagingDir);
  const jsonPath = `${outputPrefix}.json`;
  const txtPath = `${outputPrefix}.txt`;

  if (fs.existsSync(jsonPath)) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const segments = Array.isArray(raw?.transcription) ? raw.transcription : [];
    const joined = segments
      .map((segment) => String(segment?.text ?? '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
    const text = joined || String(raw?.text ?? '').trim();
    return { segments, text, format: 'whisper-json' };
  }

  if (fs.existsSync(txtPath)) {
    return {
      segments: [],
      text: fs.readFileSync(txtPath, 'utf8').trim(),
      format: 'whisper-txt',
    };
  }

  return null;
}

function publishWhisperOutput(recDir, stagingDir, {
  model = null,
  language = null,
  translate = false,
  store = transcriptStore,
} = {}) {
  const output = readWhisperOutput(stagingDir);
  if (!output) {
    return { success: false, code: 'empty-output', error: 'Nessun output Whisper' };
  }

  return store.createRevision(recDir, {
    kind: translate ? 'translation' : 'transcription',
    source: {
      engine: 'whisper-cli',
      model,
      language: language || null,
      targetLanguage: translate ? 'en' : null,
      complete: true,
      translated: !!translate,
      timing: output.segments.length > 0 ? 'segment' : 'whole-recording',
      format: output.format,
      createdAt: new Date().toISOString(),
    },
    segments: output.segments,
    text: output.text,
  });
}

module.exports = {
  STAGING_PREFIX,
  buildWhisperArgs,
  cleanupStaging,
  createWhisperStaging,
  publishWhisperOutput,
  readWhisperOutput,
  stagingDirName,
  whisperOutputPrefix,
};
