/* ══════════════════════════════════════════════════════════════
   AudioSource — astrazione delle sorgenti audio del renderer.

   Contratto:
     source.kind                 'microphone' | 'system' | 'mixed'
     source.open(options)        → handle { kind, stream, context, sourceNode, close() }
     source.close()              rilascia tracce e contesto aperti

   Le implementazioni native (microfono, audio di sistema, mix) restano qui;
   la pipeline DSP e la UI non conoscono `getUserMedia` o `getDisplayMedia`.
   ══════════════════════════════════════════════════════════════ */

(function attachAudioSources(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MemoAudioSources = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  const DEFAULT_MIC_CONSTRAINTS = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 1 },
  };

  function createContext(ContextCtor, sampleRate) {
    if (typeof ContextCtor !== 'function') {
      throw new Error('AudioContext non disponibile');
    }
    if (!sampleRate) return new ContextCtor();
    try {
      return new ContextCtor({ sampleRate });
    } catch (_) {
      return new ContextCtor();
    }
  }

  function stopStream(stream) {
    try {
      stream?.getTracks?.().forEach((track) => track.stop());
    } catch (_) {}
  }

  function createHandle({ kind, stream, context, sourceNode, streams = [stream], extraCleanups = [] }) {
    let closed = false;
    return {
      kind,
      get stream() { return stream; },
      get context() { return context; },
      get sourceNode() { return sourceNode; },
      async close() {
        if (closed) return;
        closed = true;
        try { sourceNode?.disconnect?.(); } catch (_) {}
        for (const item of streams) stopStream(item);
        for (const cleanup of extraCleanups) {
          try { cleanup(); } catch (_) {}
        }
        try { await context?.close?.(); } catch (_) {}
        stream = null;
        context = null;
        sourceNode = null;
      },
    };
  }

  function createMicrophoneSource({
    getUserMedia,
    constraints = DEFAULT_MIC_CONSTRAINTS,
  } = {}) {
    let active = null;
    return {
      kind: 'microphone',
      supports: () => typeof getUserMedia === 'function',
      async open({ AudioContextCtor = globalThis.AudioContext, sampleRate = 16000 } = {}) {
        if (typeof getUserMedia !== 'function') {
          throw new Error('Microfono non disponibile');
        }
        const stream = await getUserMedia({ audio: { ...constraints } });
        let context;
        let sourceNode;
        try {
          context = createContext(AudioContextCtor, sampleRate);
          sourceNode = context.createMediaStreamSource(stream);
        } catch (err) {
          stopStream(stream);
          try { await context?.close?.(); } catch (_) {}
          throw err;
        }
        active = createHandle({ kind: 'microphone', stream, context, sourceNode });
        return active;
      },
      async close() {
        await active?.close();
        active = null;
      },
    };
  }

  function createSystemAudioSource({
    getDisplayMedia,
    constraints = { audio: true, video: true },
  } = {}) {
    let active = null;
    return {
      kind: 'system',
      supports: () => typeof getDisplayMedia === 'function',
      async open({ AudioContextCtor = globalThis.AudioContext, sampleRate = 16000 } = {}) {
        if (typeof getDisplayMedia !== 'function') {
          throw new Error('Audio di sistema non disponibile');
        }
        const stream = await getDisplayMedia({ ...constraints });
        // Il video serve solo a ottenere la traccia audio: va fermato subito.
        stream.getVideoTracks?.().forEach((track) => track.stop());

        let context;
        let sourceNode;
        try {
          context = createContext(AudioContextCtor, sampleRate);
          sourceNode = context.createMediaStreamSource(stream);
        } catch (err) {
          stopStream(stream);
          try { await context?.close?.(); } catch (_) {}
          throw err;
        }
        active = createHandle({ kind: 'system', stream, context, sourceNode });
        return active;
      },
      async close() {
        await active?.close();
        active = null;
      },
    };
  }

  /**
   * Mix di più sorgenti in un unico nodo. Il contesto è condiviso: i flussi
   * originali restano attivi finché l'handle non viene chiuso.
   */
  function createMixedAudioSource({ getUserMedia, getDisplayMedia } = {}) {
    let active = null;
    return {
      kind: 'mixed',
      supports: () => typeof getUserMedia === 'function' && typeof getDisplayMedia === 'function',
      async open({ AudioContextCtor = globalThis.AudioContext, sampleRate = 16000 } = {}) {
        if (typeof getUserMedia !== 'function' || typeof getDisplayMedia !== 'function') {
          throw new Error('Mix audio non disponibile');
        }

        const micStream = await getUserMedia({ audio: { ...DEFAULT_MIC_CONSTRAINTS } });
        let systemStream;
        try {
          systemStream = await getDisplayMedia({ audio: true, video: true });
        } catch (err) {
          stopStream(micStream);
          throw err;
        }
        systemStream.getVideoTracks?.().forEach((track) => track.stop());

        let context;
        let mix;
        let micNode;
        let systemNode;
        try {
          context = createContext(AudioContextCtor, sampleRate);
          mix = context.createGain();
          micNode = context.createMediaStreamSource(micStream);
          systemNode = context.createMediaStreamSource(systemStream);
          micNode.connect(mix);
          systemNode.connect(mix);
        } catch (err) {
          stopStream(micStream);
          stopStream(systemStream);
          try { await context?.close?.(); } catch (_) {}
          throw err;
        }

        active = createHandle({
          kind: 'mixed',
          stream: systemStream,
          context,
          sourceNode: mix,
          streams: [micStream, systemStream],
          extraCleanups: [
            () => { try { micNode.disconnect(); } catch (_) {} },
            () => { try { systemNode.disconnect(); } catch (_) {} },
          ],
        });
        return active;
      },
      async close() {
        await active?.close();
        active = null;
      },
    };
  }

  const factories = {
    microphone: createMicrophoneSource,
    system: createSystemAudioSource,
    mixed: createMixedAudioSource,
  };

  function createAudioSource(kind = 'microphone', dependencies = {}) {
    const factory = factories[kind];
    if (!factory) throw new Error(`Sorgente audio sconosciuta: ${kind}`);
    return factory(dependencies);
  }

  return {
    DEFAULT_MIC_CONSTRAINTS,
    KINDS: Object.keys(factories),
    createAudioSource,
    createMicrophoneSource,
    createMixedAudioSource,
    createSystemAudioSource,
  };
});
