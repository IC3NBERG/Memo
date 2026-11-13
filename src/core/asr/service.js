'use strict';

const { modelMissingCode, modelMissingMessage } = require('./models');

/**
 * Facciata unica verso i backend ASR.
 *
 * Responsabilità:
 * - verificare che il modello giusto sia presente e restituire i codici
 *   `model-missing` / `translation-model-missing`;
 * - scegliere il backend di chunk disponibile (server → CLI);
 * - ripiegare sulla CLI se il server è caduto;
 * - esporre un'unica API al processo main.
 */
function createAsrService({
  models,
  chunkBackends = [],
  fullBackend = null,
} = {}) {
  if (!models || typeof models.status !== 'function') {
    throw new Error('models resolver obbligatorio');
  }

  function missing(translate) {
    return {
      success: false,
      code: modelMissingCode(translate),
      error: modelMissingMessage(translate),
    };
  }

  function availableBackends() {
    return chunkBackends.filter((backend) => backend?.isAvailable?.() ?? true);
  }

  async function prewarm({ translate = false } = {}) {
    const status = models.status(translate);
    if (!status.ready) return missing(translate);

    for (const backend of availableBackends()) {
      if (typeof backend.ensure !== 'function') {
        return { success: true, engine: backend.kind };
      }
      try {
        const entry = await backend.ensure(status.path);
        if (entry) return { success: true, engine: backend.kind };
      } catch (_) {}
    }

    return { success: false, engine: 'cli', error: 'Server ASR non disponibile' };
  }

  async function transcribeChunk({ buffer, language, translate = false, prompt } = {}) {
    const status = models.status(translate);
    if (!status.ready) return missing(translate);
    if (!buffer || buffer.length === 0) {
      return { success: false, code: 'empty-audio', error: 'Audio mancante' };
    }

    const backends = availableBackends();
    if (backends.length === 0) {
      return {
        success: false,
        code: 'asr-unavailable',
        error: 'Motore whisper-cli non trovato.',
      };
    }

    let lastError = null;
    for (const backend of backends) {
      try {
        let entry = null;
        if (typeof backend.ensure === 'function') {
          entry = await backend.ensure(status.path);
          if (!entry) continue;
        }
        const result = await backend.transcribeChunk(entry, Buffer.from(buffer), {
          language,
          translate,
          prompt,
        });
        if (result?.success) return result;
        lastError = result?.error || lastError;
      } catch (err) {
        lastError = err.message;
        if (typeof backend.disable === 'function') backend.disable();
      }
    }

    return {
      success: false,
      code: 'asr-failed',
      error: lastError || 'Trascrizione non riuscita',
    };
  }

  function transcribeFile({ audioPath, outputPrefix, language, translate = false, onProgress } = {}) {
    const status = models.status(translate);
    if (!status.ready) return Promise.resolve(missing(translate));
    if (!fullBackend) {
      return Promise.resolve({
        success: false,
        code: 'asr-unavailable',
        error: 'Motore whisper-cli non trovato.',
      });
    }
    return fullBackend.transcribeFile({
      modelPath: status.path,
      outputPrefix,
      audioPath,
      language,
      translate,
      onProgress,
    });
  }

  function stop() {
    for (const backend of chunkBackends) {
      try { backend.stop?.(); } catch (_) {}
    }
  }

  return {
    models,
    prewarm,
    stop,
    transcribeChunk,
    transcribeFile,
  };
}

module.exports = {
  createAsrService,
};
