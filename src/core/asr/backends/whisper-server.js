'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

const { parseWhisperServerJson } = require('../parse');

/**
 * Gestisce il processo whisper-server e ne espone la capacità di chunk.
 *
 * Il server tiene il modello caldo tra un chunk e l'altro. Non è obbligatorio:
 * il servizio ASR lo usa se disponibile e ripiega su whisper-cli. Se il server
 * non parte, viene disabilitato per un intervallo per non rallentare ogni
 * richiesta con un tentativo destinato a fallire.
 */
function createWhisperServerBackend({
  binPath,
  spawnImpl = spawn,
  fetchImpl = globalThis.fetch,
  exists = fs.existsSync,
  now = Date.now,
  random = Math.random,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  portBase = 18000,
  portSpan = 2000,
  readyTimeoutMs = 20000,
  idleTimeoutMs = 5 * 60 * 1000,
  disabledTimeoutMs = 60000,
} = {}) {
  let server = null;
  let startingPromise = null;
  let idleTimer = null;
  let disabledUntil = 0;

  function isAvailable() {
    return !!binPath && exists(binPath);
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function stop() {
    clearIdleTimer();
    if (!server) return;
    const proc = server.proc;
    server = null;
    try { proc.kill('SIGTERM'); } catch (_) {}
  }

  function scheduleIdleStop() {
    clearIdleTimer();
    idleTimer = setTimeout(() => stop(), idleTimeoutMs);
    if (idleTimer.unref) idleTimer.unref();
  }

  async function waitForReady(port) {
    const deadline = now() + readyTimeoutMs;
    while (now() < deadline) {
      try {
        const res = await fetchImpl(`http://127.0.0.1:${port}/`, { method: 'GET' });
        if (res?.ok || res?.status === 404) return true;
      } catch (_) {}
      await sleep(250);
    }
    return false;
  }

  async function ensure(modelPath) {
    if (!isAvailable() || now() < disabledUntil) return null;

    if (server && server.modelPath === modelPath) {
      scheduleIdleStop();
      return server;
    }

    if (startingPromise) {
      const started = await startingPromise;
      if (started && started.modelPath === modelPath) return started;
    }

    stop();

    const port = portBase + Math.floor(random() * portSpan);
    let proc;
    try {
      proc = spawnImpl(binPath, [
        '--model', modelPath,
        '--host', '127.0.0.1',
        '--port', String(port),
        '--threads', '4',
        '--beam-size', '5',
        '--suppress-nst',
        '--no-speech-thold', '0.6',
        '--language', 'auto',
      ], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch (_) {
      return null;
    }

    const entry = { proc, port, modelPath };
    startingPromise = (async () => {
      const ready = await waitForReady(port);
      if (!ready) {
        disabledUntil = now() + disabledTimeoutMs;
        try { proc.kill('SIGTERM'); } catch (_) {}
        return null;
      }
      server = entry;
      proc.on('exit', () => {
        if (server === entry) server = null;
      });
      scheduleIdleStop();
      return entry;
    })();

    try {
      return await startingPromise;
    } finally {
      startingPromise = null;
    }
  }

  function disable(ms = disabledTimeoutMs) {
    disabledUntil = now() + ms;
    stop();
  }

  async function transcribeChunk(entry, buffer, { language, translate, prompt } = {}) {
    if (!entry) return { success: false, error: 'whisper-server non pronto' };
    if (typeof fetchImpl !== 'function') {
      return { success: false, error: 'fetch non disponibile' };
    }

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'audio/wav' }), 'chunk.wav');
    form.append('response_format', 'verbose_json');
    form.append('language', language || 'auto');
    form.append('translate', translate ? 'true' : 'false');
    form.append('token_timestamps', 'true');
    form.append('suppress_nst', 'true');
    form.append('no_speech_thold', '0.6');
    if (prompt) form.append('prompt', prompt);

    const res = await fetchImpl(`http://127.0.0.1:${entry.port}/inference`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) throw new Error(`whisper-server HTTP ${res.status}`);
    const data = await res.json();
    const parsed = parseWhisperServerJson(data);
    return {
      success: true,
      engine: 'server',
      text: parsed.text,
      language: parsed.language,
      segments: parsed.segments,
    };
  }

  return {
    kind: 'whisper-server',
    disable,
    ensure,
    isAvailable,
    stop,
    transcribeChunk,
    get entry() { return server; },
    get disabledUntil() { return disabledUntil; },
  };
}

module.exports = {
  createWhisperServerBackend,
};
