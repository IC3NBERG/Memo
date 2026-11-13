'use strict';

/**
 * Normalizzazione degli output dei backend ASR.
 *
 * Tutti i parser restituiscono segmenti con tempi in secondi e parole con
 * timestamp in secondi. Gli offset grezzi di whisper.cpp sono in millisecondi
 * e vengono convertiti qui una sola volta, così il resto del core non deve
 * conoscere il formato del motore.
 */

const SPECIAL_TOKEN = /^\[_[^\]]*\]$/;

function cleanText(value) {
  return String(value ?? '')
    .replace(/\[_[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * I token di whisper.cpp includono sottoparole, spazi iniziali e token
 * speciali. Lo spazio iniziale marca l'inizio di una nuova parola:
 * `"g"` + `"atto"` diventa `"gatto"`.
 */
function wordsFromTokens(tokens, segStart, segEnd) {
  const words = [];
  let current = null;

  for (const token of tokens || []) {
    const raw = String(token?.word ?? token?.text ?? '');
    if (!raw) continue;

    const start = token?.offsets
      ? Number(token.offsets.from) / 1000
      : Number(token?.start ?? segStart);
    const end = token?.offsets
      ? Number(token.offsets.to) / 1000
      : Number(token?.end ?? segEnd);
    const leadingSpace = /^\s/.test(raw);
    const text = raw.replace(/^\s+/, '');
    if (!text || SPECIAL_TOKEN.test(text)) continue;

    if (leadingSpace || !current) {
      if (current) words.push(current);
      current = { start, end, text };
    } else {
      current.text += text;
      current.end = end;
    }
  }

  if (current) words.push(current);
  return words;
}

/** Output di whisper-cli con `--output-json-full`. */
function parseWhisperCliJson(raw) {
  const segments = [];
  for (const segment of raw?.transcription || []) {
    const start = segment?.offsets ? Number(segment.offsets.from) / 1000 : 0;
    const end = segment?.offsets ? Number(segment.offsets.to) / 1000 : 0;
    const text = cleanText(segment?.text);
    const words = wordsFromTokens(segment?.tokens, start, end);
    segments.push({
      start,
      end,
      text,
      words: words.length ? words : [{ start, end, text }],
    });
  }

  return {
    language: raw?.result?.language || null,
    segments,
    text: segments.map((segment) => segment.text).filter(Boolean).join(' ').trim(),
  };
}

/** Risposta JSON di whisper-server (`/inference`). */
function parseWhisperServerJson(raw) {
  const segments = (raw?.segments || []).map((segment) => {
    const start = Number(segment?.start || 0);
    const end = Number(segment?.end || 0);
    const text = String(segment?.text || '').trim();
    const words = wordsFromTokens(segment?.words, start, end);
    return {
      start,
      end,
      text,
      words: words.length ? words : [{ start, end, text }],
    };
  });

  return {
    language: raw?.language || raw?.detected_language || null,
    segments,
    text: String(raw?.text || '').trim() || segments.map((segment) => segment.text).join(' ').trim(),
  };
}

module.exports = {
  cleanText,
  parseWhisperCliJson,
  parseWhisperServerJson,
  wordsFromTokens,
};
