'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const AudioDSP = require('../src/renderer/audio-dsp');

function samples(values) {
  return Float32Array.from(values);
}

function approx(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≠ ${expected}`);
}

test('measureRms calcola la radice quadratica media', () => {
  approx(AudioDSP.measureRms(samples([0.5, -0.5, 0.5, -0.5])), 0.5);
  approx(AudioDSP.measureRms(samples([0, 0, 0])), 0);
  approx(AudioDSP.measureRms(samples([])), 0);
});

test('trimSilence taglia i bordi e riporta l’offset', () => {
  const input = new Float32Array(1000);
  for (let i = 200; i <= 800; i += 1) input[i] = 0.5;

  const result = AudioDSP.trimSilence(input, 1000);

  assert.equal(result.offsetSamples, 50);
  assert.equal(result.samples.length, 901);
  assert.equal(result.samples[0], 0);
  assert.equal(result.samples[149], 0);
  assert.equal(result.samples[150], 0.5);
  assert.equal(result.samples[900], 0);
});

test('trimSilence lascia intatto un buffer completamente silenzioso', () => {
  const input = new Float32Array(500);
  const result = AudioDSP.trimSilence(input, 16000);

  assert.equal(result.samples, input);
  assert.equal(result.offsetSamples, 0);
});

test('trimSilence non taglia un segnale troppo breve', () => {
  const input = new Float32Array(1000);
  input[500] = 0.5;

  const result = AudioDSP.trimSilence(input, 1000);
  assert.equal(result.samples, input);
  assert.equal(result.offsetSamples, 0);
});

test('normalizeForWhisper porta il chunk verso −20 dBFS', () => {
  const input = samples([0.05, -0.05, 0.05, -0.05]);
  const output = AudioDSP.normalizeForWhisper(input);

  approx(AudioDSP.measureRms(output), Math.pow(10, -20 / 20), 1e-5);
  approx(output[0], 0.1, 1e-5);
  approx(output[1], -0.1, 1e-5);
});

test('normalizeForWhisper satura senza superare ±1', () => {
  const output = AudioDSP.normalizeForWhisper(samples([0.9, -0.9]));
  assert.ok(output[0] <= 1);
  assert.ok(output[1] >= -1);
});

test('normalizeForWhisper restituisce null per il silenzio', () => {
  assert.equal(AudioDSP.normalizeForWhisper(samples([0, 0, 0])), null);
  assert.equal(AudioDSP.normalizeForWhisper(samples([])), null);
});

test('collectLiveWindow prende gli ultimi campioni attraverso i chunk', () => {
  const chunks = [
    samples([1, 2]),
    samples([3, 4, 5]),
  ];

  assert.deepEqual(
    Array.from(AudioDSP.collectLiveWindow(chunks, 3)),
    [3, 4, 5],
  );
  assert.deepEqual(
    Array.from(AudioDSP.collectLiveWindow(chunks, 4)),
    [2, 3, 4, 5],
  );
  assert.deepEqual(
    Array.from(AudioDSP.collectLiveWindow(chunks, 10)),
    [1, 2, 3, 4, 5],
  );
  assert.equal(AudioDSP.collectLiveWindow([], 10), null);
});
