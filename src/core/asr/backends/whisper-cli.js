'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { parseWhisperCliJson } = require('../parse');

const CHUNK_PREFIX = 'crunch_chunk_';

function buildWhisperArgs({ modelPath, outputPrefix, audioPath, language, translate }) {
  const args = [
    '--model', modelPath,
    '--output-file', outputPrefix,
    '--output-json',
    '--output-txt',
    '--print-progress',
    '--file', audioPath,
    '--threads', '4',
    '--language', language || 'auto',
  ];
  if (translate) args.push('--translate');
  return args;
}

function chunkArgs({ modelPath, outputPrefix, audioPath, language, translate, prompt }) {
  const args = [
    '--model', modelPath,
    '--output-json-full',
    '--output-file', outputPrefix,
    '--file', audioPath,
    '--threads', '4',
    '--language', language || 'auto',
    '--suppress-nst',
    '--no-speech-thold', '0.6',
    '--beam-size', '5',
    '--no-prints',
  ];
  if (prompt) args.push('--prompt', prompt, '--carry-initial-prompt');
  if (translate) args.push('--translate');
  return args;
}

const PROGRESS_RE = /(\d+)%/;

function parseProgress(line) {
  const match = String(line).match(PROGRESS_RE);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  return Number.isNaN(value) ? null : Math.max(0, Math.min(100, value));
}

/**
 * Backend ASR basato su whisper-cli.
 *
 * Espone due capacità indipendenti:
 * - `transcribeFile`: trascrizione integrale con staging e progress;
 * - `transcribeChunk`: chunk PCM live con output JSON completo.
 *
 * Il backend non conosce la libreria, il modello scelto né i codici di errore
 * model-missing: quelle decisioni appartengono al servizio ASR.
 */
function createWhisperCliBackend({
  binPath,
  spawnImpl = spawn,
  fsImpl = fs,
  tempDir = os.tmpdir(),
  now = Date.now,
  random = Math.random,
} = {}) {
  function isAvailable() {
    return !!binPath && fsImpl.existsSync(binPath);
  }

  function transcribeFile({
    modelPath,
    outputPrefix,
    audioPath,
    language,
    translate = false,
    onProgress = () => {},
  }) {
    if (!isAvailable()) {
      return Promise.resolve({ success: false, error: 'Motore whisper-cli non trovato.' });
    }

    const args = buildWhisperArgs({ modelPath, outputPrefix, audioPath, language, translate });
    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawnImpl(binPath, args);
      } catch (err) {
        resolve({ success: false, error: err.message });
        return;
      }

      const handleLine = (data) => {
        const pct = parseProgress(data.toString());
        if (pct !== null) onProgress(pct);
      };
      proc.stderr?.on('data', handleLine);
      proc.stdout?.on('data', handleLine);

      proc.on('close', (code) => {
        if (code === 0) resolve({ success: true });
        else resolve({ success: false, error: `whisper-cli terminato con errore (codice ${code})` });
      });
      proc.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  }

  function transcribeChunk({ buffer, modelPath, language, translate = false, prompt = '' }) {
    if (!isAvailable()) {
      return Promise.resolve({ success: false, error: 'whisper-cli non trovato' });
    }

    const id = `${now()}_${random().toString(36).slice(2, 6)}`;
    const wavPath = path.join(tempDir, `${CHUNK_PREFIX}${id}.wav`);
    const outputPrefix = path.join(tempDir, `${CHUNK_PREFIX}out_${id}`);
    const jsonPath = `${outputPrefix}.json`;

    try {
      fsImpl.writeFileSync(wavPath, Buffer.from(buffer));
    } catch (err) {
      return Promise.resolve({ success: false, error: err.message });
    }

    const cleanup = () => {
      try { if (fsImpl.existsSync(wavPath)) fsImpl.unlinkSync(wavPath); } catch (_) {}
      try { if (fsImpl.existsSync(jsonPath)) fsImpl.unlinkSync(jsonPath); } catch (_) {}
    };

    const args = chunkArgs({
      modelPath,
      outputPrefix,
      audioPath: wavPath,
      language,
      translate,
      prompt,
    });

    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawnImpl(binPath, args);
      } catch (err) {
        cleanup();
        resolve({ success: false, error: err.message });
        return;
      }

      let stderr = '';
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        try {
          if (code !== 0) {
            resolve({ success: false, error: `whisper exit code ${code}: ${stderr.slice(-200)}` });
            return;
          }
          if (!fsImpl.existsSync(jsonPath)) {
            resolve({ success: false, error: 'Risposta whisper-cli priva di JSON' });
            return;
          }
          const raw = JSON.parse(fsImpl.readFileSync(jsonPath, 'utf8'));
          const parsed = parseWhisperCliJson(raw);
          resolve({
            success: true,
            engine: 'cli',
            text: parsed.text,
            language: parsed.language,
            segments: parsed.segments,
          });
        } catch (err) {
          resolve({ success: false, error: err.message });
        } finally {
          cleanup();
        }
      });

      proc.on('error', (err) => {
        cleanup();
        resolve({ success: false, error: err.message });
      });
    });
  }

  return {
    kind: 'whisper-cli',
    isAvailable,
    transcribeChunk,
    transcribeFile,
  };
}

module.exports = {
  buildWhisperArgs,
  chunkArgs,
  createWhisperCliBackend,
  parseProgress,
};
