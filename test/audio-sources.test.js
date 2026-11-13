'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MIC_CONSTRAINTS,
  KINDS,
  createAudioSource,
  createMicrophoneSource,
  createMixedAudioSource,
  createSystemAudioSource,
} = require('../src/renderer/audio-sources');

function fakeTrack(kind) {
  return { kind, stopped: false, stop() { this.stopped = true; } };
}

function fakeStream(tracks = [fakeTrack('audio')]) {
  return {
    tracks,
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
  };
}

class FakeAudioContext {
  constructor(options = {}) {
    this.options = options;
    this.closed = false;
    this.nodes = [];
  }

  createMediaStreamSource(stream) {
    const node = {
      stream,
      connected: [],
      disconnect() { this.disconnected = true; },
      connect(target) { this.connected.push(target); },
    };
    this.nodes.push(node);
    return node;
  }

  createGain() {
    const node = {
      connected: [],
      disconnect() { this.disconnected = true; },
      connect(target) { this.connected.push(target); },
    };
    this.nodes.push(node);
    return node;
  }

  async close() { this.closed = true; }
}

test('la sorgente microfono applica i vincoli e rilascia tutto alla chiusura', async () => {
  const track = fakeTrack('audio');
  const stream = fakeStream([track]);
  let received = null;

  const source = createMicrophoneSource({
    getUserMedia: async (constraints) => {
      received = constraints;
      return stream;
    },
  });

  const handle = await source.open({ AudioContextCtor: FakeAudioContext, sampleRate: 16000 });
  assert.equal(handle.kind, 'microphone');
  assert.equal(handle.stream, stream);
  assert.deepEqual(received, { audio: DEFAULT_MIC_CONSTRAINTS });
  assert.equal(handle.context.options.sampleRate, 16000);
  assert.equal(handle.sourceNode.stream, stream);

  await handle.close();
  assert.equal(track.stopped, true);
  assert.equal(handle.context, null);
  assert.equal(handle.sourceNode, null);
  await handle.close(); // idempotente
});

test('la sorgente microfono ripiega su AudioContext senza sample rate forzato', async () => {
  class StrictContext extends FakeAudioContext {
    constructor(options) {
      if (options?.sampleRate) throw new Error('sample rate non supportato');
      super(options);
    }
  }

  const source = createMicrophoneSource({ getUserMedia: async () => fakeStream() });
  const handle = await source.open({ AudioContextCtor: StrictContext, sampleRate: 16000 });
  assert.equal(handle.context.options.sampleRate, undefined);
  await handle.close();
});

test('la sorgente di sistema ferma subito la traccia video', async () => {
  const audio = fakeTrack('audio');
  const video = fakeTrack('video');
  const stream = fakeStream([audio, video]);

  const source = createSystemAudioSource({ getDisplayMedia: async () => stream });
  const handle = await source.open({ AudioContextCtor: FakeAudioContext });

  assert.equal(handle.kind, 'system');
  assert.equal(video.stopped, true);
  assert.equal(audio.stopped, false);

  await handle.close();
  assert.equal(audio.stopped, true);
});

test('la sorgente mixed collega microfono e sistema allo stesso gain', async () => {
  const micStream = fakeStream([fakeTrack('audio')]);
  const systemStream = fakeStream([fakeTrack('audio'), fakeTrack('video')]);

  const source = createMixedAudioSource({
    getUserMedia: async () => micStream,
    getDisplayMedia: async () => systemStream,
  });
  const handle = await source.open({ AudioContextCtor: FakeAudioContext });
  const context = handle.context;

  assert.equal(handle.kind, 'mixed');
  assert.equal(handle.sourceNode.connected.length, 0);
  assert.equal(context.nodes.filter((node) => node.stream).length, 2);
  const mix = context.nodes.find((node) => !node.stream);
  assert.equal(handle.sourceNode, mix);

  await handle.close();
  assert.equal(context.closed, true);
  assert.equal(micStream.tracks[0].stopped, true);
  assert.equal(systemStream.tracks[0].stopped, true);
});

test('mixed rilascia il microfono se l’audio di sistema viene rifiutato', async () => {
  const track = fakeTrack('audio');
  const source = createMixedAudioSource({
    getUserMedia: async () => fakeStream([track]),
    getDisplayMedia: async () => { throw new Error('permesso negato'); },
  });

  await assert.rejects(() => source.open({ AudioContextCtor: FakeAudioContext }), /permesso negato/);
  assert.equal(track.stopped, true);
});

test('createAudioSource espone le tre implementazioni e rifiuta le sconosciute', () => {
  assert.deepEqual(KINDS.sort(), ['microphone', 'mixed', 'system']);
  assert.equal(createAudioSource('microphone', {}).kind, 'microphone');
  assert.throws(() => createAudioSource('telefono', {}), /Sorgente audio sconosciuta/);
});
