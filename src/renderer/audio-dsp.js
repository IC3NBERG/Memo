/**
 * DSP di base per la cattura live.
 *
 * Modulo caricato sia dal renderer (<script src="audio-dsp.js">) sia dai test
 * Node: niente API Electron, niente stato globale.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AudioDSP = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SAMPLE_RATE = 16000;

  function measureRms(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, samples.length));
  }

  /**
   * Taglia il silenzio ai bordi e restituisce anche l'offset in campioni:
   * i timestamp di Whisper sono relativi all'audio tagliato e vanno
   * riallineati alla finestra originale.
   */
  function trimSilence(samples, sampleRate = DEFAULT_SAMPLE_RATE) {
    const threshold = 0.008; // ≈ −42 dB
    let start = 0;
    let end = samples.length - 1;
    while (start < end && Math.abs(samples[start]) < threshold) start += 1;
    while (end > start && Math.abs(samples[end]) < threshold) end -= 1;

    if (end - start < samples.length * 0.05) {
      return { samples, offsetSamples: 0 };
    }

    const pad = Math.round((sampleRate || DEFAULT_SAMPLE_RATE) * 0.15);
    start = Math.max(0, start - pad);
    end = Math.min(samples.length - 1, end + pad);
    return { samples: samples.subarray(start, end + 1), offsetSamples: start };
  }

  /**
   * Normalizza il chunk a −20 dBFS: Whisper riceve un livello costante,
   * senza dipendere dal pompaggio dell'AGC.
   */
  function normalizeForWhisper(samples) {
    const rms = measureRms(samples);
    if (!Number.isFinite(rms) || rms <= 1e-5) return null;

    const target = Math.pow(10, -20 / 20);
    const gain = Math.min(8, Math.max(0.5, target / rms));
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
    }
    return out;
  }

  /**
   * Prende gli ultimi `windowSamples` campioni dai chunk accumulati,
   * scorrendoli dal più vecchio al più recente.
   */
  function collectLiveWindow(chunks, windowSamples) {
    let total = 0;
    for (const chunk of chunks) total += chunk.length;
    if (!total) return null;

    const take = Math.min(windowSamples, total);
    const out = new Float32Array(take);
    let skip = total - take;
    let written = 0;

    for (const chunk of chunks) {
      if (skip >= chunk.length) {
        skip -= chunk.length;
        continue;
      }
      const slice = skip > 0 ? chunk.subarray(skip) : chunk;
      skip = 0;
      const n = Math.min(slice.length, take - written);
      out.set(slice.subarray(0, n), written);
      written += n;
      if (written >= take) break;
    }

    return written ? out.subarray(0, written) : null;
  }

  return {
    DEFAULT_SAMPLE_RATE,
    collectLiveWindow,
    measureRms,
    normalizeForWhisper,
    trimSilence,
  };
}));
