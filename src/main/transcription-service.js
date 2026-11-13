'use strict';

const { createAsrService } = require('../core/asr/service');
const { createWhisperCliBackend } = require('../core/asr/backends/whisper-cli');
const { createWhisperServerBackend } = require('../core/asr/backends/whisper-server');
const {
  cleanupStaging,
  createWhisperStaging,
  publishWhisperOutput,
  whisperOutputPrefix,
} = require('../core/transcript/whisper');

/**
 * Orchestrazione della trascrizione: nessun dettaglio di Electron.
 *
 * L'interfaccia ASR è composta da:
 * - un resolver dei modelli che produce `model-missing` /
 *   `translation-model-missing`;
 * - un backend server (modello caldo) con fallback CLI per i chunk live;
 * - un backend CLI per la trascrizione integrale con staging atomica.
 */
function createTranscriptionService({
  models,
  binPath,
  serverBinPath,
  store,
  cliBackend = null,
  serverBackend = null,
  asr = null,
} = {}) {
  const cli = cliBackend || createWhisperCliBackend({ binPath });
  const server = serverBackend || createWhisperServerBackend({ binPath: serverBinPath });
  const service = asr || createAsrService({
    models,
    chunkBackends: [server, cli],
    fullBackend: cli,
  });

  let active = false;

  function prewarm({ translate = false } = {}) {
    return service.prewarm({ translate });
  }

  function transcribeChunk(payload = {}) {
    return service.transcribeChunk(payload);
  }

  /**
   * Avvia la trascrizione integrale. I callback ricevono gli stessi payload
   * storici degli eventi IPC.
   */
  function startFull({
    audioPath,
    recDir,
    language,
    translate = false,
    onProgress = () => {},
    onDone = () => {},
    onError = () => {},
  } = {}) {
    if (active) {
      const error = 'Una trascrizione è già in corso. Attendi che termini.';
      onError(error);
      return { success: false, code: 'busy', error };
    }

    const status = models.status(translate);
    if (!status.ready) {
      onError({ code: status.code, message: status.message });
      return { success: false, code: status.code, error: status.message };
    }

    if (!cli.isAvailable()) {
      const error = 'Motore whisper-cli non trovato.';
      onError(error);
      return { success: false, code: 'asr-unavailable', error };
    }

    let stagingDir;
    try {
      stagingDir = createWhisperStaging(recDir);
    } catch (err) {
      onError(err.message);
      return { success: false, error: err.message };
    }

    const outputPrefix = whisperOutputPrefix(stagingDir);
    const cleanup = () => cleanupStaging(stagingDir);
    active = true;

    let task;
    try {
      task = service.transcribeFile({
        audioPath,
        outputPrefix,
        language,
        translate,
        onProgress,
      });
    } catch (err) {
      active = false;
      cleanup();
      onError(err.message);
      return { success: false, error: err.message };
    }

    task.then((result) => {
      if (!result?.success) {
        cleanup();
        onError(result?.error || 'Trascrizione non riuscita');
        return;
      }

      try {
        const published = publishWhisperOutput(recDir, stagingDir, {
          model: models.status(translate).filename,
          language,
          translate,
          store,
        });
        cleanup();

        if (!published.success) {
          onError(published.error || 'Trascrizione vuota');
          return;
        }

        onDone({
          recDir,
          transcript: published.transcript,
          translate: !!translate,
        });
      } catch (err) {
        cleanup();
        onError(err.message);
      }
    }).catch((err) => {
      cleanup();
      onError(err.message);
    }).finally(() => {
      active = false;
    });

    return { success: true, started: true };
  }

  function stop() {
    service.stop?.();
  }

  return {
    isActive: () => active,
    models,
    prewarm,
    startFull,
    stop,
    transcribeChunk,
  };
}

module.exports = {
  createTranscriptionService,
};
