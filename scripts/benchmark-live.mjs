#!/usr/bin/env node
// Benchmark riproducibile della trascrizione live.
//
// Simula la finestra mobile usata dall'app (chunk + overlap), trascrive ogni
// finestra con whisper-cli e confronta il testo unito con la trascrizione
// integrale dello stesso file. Misura anche la latenza media per chunk.
//
// Uso:
//   node scripts/benchmark-live.mjs --audio /percorso/audio.wav
//   node scripts/benchmark-live.mjs --audio test.wav --windows 3.5,8,10 --overlaps 0,2
//
// Opzioni:
//   --audio FILE      file WAV di riferimento (obbligatorio)
//   --model FILE      modello ggml (default ~/CrunchRecordings/.models/ggml-large-v3-turbo.bin)
//   --bin FILE        whisper-cli (default bin/whisper-cli)
//   --language CODE   lingua (default it)
//   --windows LIST    durate in secondi, separate da virgola (default 3.5,8,10)
//   --overlaps LIST   sovrapposizioni in secondi (default 0,2)
//   --json FILE       salva il riepilogo in JSON
//   --keep            non elimina i file temporanei

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'keep') { out.keep = true; continue; }
    out[key] = argv[++i];
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const audio = path.resolve(opts.audio || '');
const model = path.resolve(opts.model || path.join(os.homedir(), 'CrunchRecordings', '.models', 'ggml-large-v3-turbo.bin'));
const whisperBin = path.resolve(opts.bin || 'bin/whisper-cli');
const language = opts.language || 'it';
const windows = (opts.windows || '3.5,8,10').split(',').map(Number).filter((n) => n > 0);
const overlaps = (opts.overlaps || '0,2').split(',').map(Number).filter((n) => n >= 0);

if (!audio || !fs.existsSync(audio)) {
  console.error('Errore: specifica un file audio valido con --audio FILE');
  process.exit(1);
}
if (!fs.existsSync(model)) {
  console.error(`Errore: modello non trovato: ${model}`);
  process.exit(1);
}
if (!fs.existsSync(whisperBin)) {
  console.error(`Errore: whisper-cli non trovato: ${whisperBin}`);
  process.exit(1);
}

const ffmpeg = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']
  .find((candidate) => candidate === 'ffmpeg' || fs.existsSync(candidate));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crunch-bench-'));

function cutAudio(start, duration, outFile) {
  const res = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(start), '-t', String(duration),
    '-i', audio, '-ar', '16000', '-ac', '1', outFile,
  ], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`ffmpeg: ${res.stderr || res.error}`);
}

function runWhisper(file, prefix) {
  const started = Date.now();
  const res = spawnSync(whisperBin, [
    '--model', model,
    '--output-json-full',
    '--output-file', prefix,
    '--file', file,
    '--threads', '4',
    '--language', language,
    '--suppress-nst',
    '--no-speech-thold', '0.6',
    '--beam-size', '5',
    '--no-prints',
  ], { encoding: 'utf8' });
  const elapsed = (Date.now() - started) / 1000;
  if (res.status !== 0) throw new Error(`whisper-cli: ${res.stderr || res.error}`);
  const jsonPath = `${prefix}.json`;
  if (!fs.existsSync(jsonPath)) throw new Error('whisper-cli non ha prodotto JSON');
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  try { fs.unlinkSync(jsonPath); } catch (_) {}
  return { raw, elapsed };
}

// Converte i token (sottoparole) in parole con timestamp.
function wordsFromJson(raw) {
  const out = [];
  for (const seg of raw.transcription || []) {
    const segStart = seg.offsets ? Number(seg.offsets.from) / 1000 : 0;
    const segEnd = seg.offsets ? Number(seg.offsets.to) / 1000 : 0;
    const tokens = seg.tokens || [];

    if (tokens.length) {
      let current = null;
      for (const token of tokens) {
        const rawText = String(token.text || '');
        if (!rawText) continue;
        const start = token.offsets ? Number(token.offsets.from) / 1000 : segStart;
        const end = token.offsets ? Number(token.offsets.to) / 1000 : segEnd;
        const leadingSpace = /^\s/.test(rawText);
        const text = rawText.replace(/^\s+/, '');
        if (!text || /^\[_[^\]]*\]$/.test(text)) continue;
        if (leadingSpace || !current) {
          if (current) out.push(current);
          current = { start, end, text };
        } else {
          current.text += text;
          current.end = end;
        }
      }
      if (current) out.push(current);
    } else if (seg.text) {
      const text = String(seg.text)
        .replace(/\[_[^\]]*\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) out.push({ start: segStart, end: segEnd, text });
    }
  }
  return out;
}

function joinWords(words) {
  return words
    .map((w) => w.text)
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function mergeWords(existing, incoming, cutoff) {
  const kept = existing.filter((w) => w.start < cutoff);
  const merged = kept.concat(incoming.filter((w) => w.start >= cutoff))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const deduped = [];
  for (const word of merged) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.text.toLowerCase() === word.text.toLowerCase()) {
      prev.end = Math.max(prev.end, word.end);
      continue;
    }
    deduped.push(word);
  }
  return deduped;
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function wordErrorRate(reference, hypothesis) {
  const ref = normalize(reference).split(' ').filter(Boolean);
  const hyp = normalize(hypothesis).split(' ').filter(Boolean);
  const dp = Array.from({ length: ref.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= hyp.length; j++) dp[0][j] = j;
  for (let i = 1; i <= ref.length; i++) {
    for (let j = 1; j <= hyp.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[ref.length][hyp.length] / Math.max(1, ref.length);
}

function probeDuration() {
  const res = spawnSync(ffmpeg, ['-hide_banner', '-i', audio], { encoding: 'utf8' });
  const match = (res.stderr || '').match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error('Impossibile leggere la durata del file audio');
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

console.log(`File:       ${audio}`);
console.log(`Modello:    ${path.basename(model)}`);
console.log(`Lingua:     ${language}`);
console.log('');

// 1. Riferimento: trascrizione integrale dello stesso file.
console.log('Trascrizione integrale di riferimento…');
const fullPrefix = path.join(tmpDir, 'full');
const full = runWhisper(audio, fullPrefix);
const referenceText = joinWords(wordsFromJson(full.raw));
console.log(`Riferimento: ${referenceText.split(/\s+/).filter(Boolean).length} parole in ${full.elapsed.toFixed(1)} s`);
console.log('');

const duration = probeDuration();
const results = [];

// 2. Simulazione della finestra mobile.
for (const windowSeconds of windows) {
  for (const overlapSeconds of overlaps) {
    if (overlapSeconds >= windowSeconds) continue;
    const step = Math.max(1, windowSeconds - overlapSeconds);

    let words = [];
    let chunks = 0;
    let totalLatency = 0;
    let start = 0;

    while (start < duration - 0.25) {
      const length = Math.min(windowSeconds, duration - start);
      if (length < 1) break;

      const chunkFile = path.join(tmpDir, `chunk_${windowSeconds}_${overlapSeconds}_${chunks}.wav`);
      cutAudio(start, length, chunkFile);
      const prefix = path.join(tmpDir, `out_${windowSeconds}_${overlapSeconds}_${chunks}`);
      const { raw, elapsed } = runWhisper(chunkFile, prefix);
      const incoming = wordsFromJson(raw).map((w) => ({
        start: start + w.start,
        end: start + w.end,
        text: w.text,
      }));
      words = mergeWords(words, incoming, Math.max(0, start - 0.25));

      totalLatency += elapsed;
      chunks += 1;
      start += step;
    }

    const text = joinWords(words);
    const wer = wordErrorRate(referenceText, text);
    const avgLatency = chunks ? totalLatency / chunks : 0;
    results.push({
      windowSeconds,
      overlapSeconds,
      chunks,
      avgLatency: Number(avgLatency.toFixed(2)),
      totalLatency: Number(totalLatency.toFixed(2)),
      words: text.split(/\s+/).filter(Boolean).length,
      wer: Number(wer.toFixed(4)),
      text,
    });
  }
}

results.sort((a, b) => a.wer - b.wer);

console.log('Finestra | Overlap | Chunk | Latenza media | Parole | WER');
console.log('---------|---------|-------|---------------|--------|------');
for (const r of results) {
  console.log(
    `${String(r.windowSeconds).padStart(7)}s | ${String(r.overlapSeconds).padStart(6)}s | ` +
    `${String(r.chunks).padStart(5)} | ${String(`${r.avgLatency.toFixed(2)}s`).padStart(13)} | ` +
    `${String(r.words).padStart(6)} | ${formatPct(r.wer)}`,
  );
}

console.log('');
const best = results[0];
console.log(`Migliore: ${best.windowSeconds}s con ${best.overlapSeconds}s di overlap — WER ${formatPct(best.wer)}, ${best.avgLatency.toFixed(2)}s/chunk`);

if (opts.json) {
  const outPath = path.resolve(opts.json);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    audio,
    model: path.basename(model),
    language,
    duration,
    reference: referenceText,
    results,
  }, null, 2));
  console.log(`Riepilogo JSON: ${outPath}`);
}

if (!opts.keep) {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
} else {
  console.log(`File temporanei: ${tmpDir}`);
}
