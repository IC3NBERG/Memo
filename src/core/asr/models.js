'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_TRANSCRIPTION_MODEL = 'ggml-large-v3-turbo.bin';
const DEFAULT_TRANSLATION_MODEL = 'ggml-medium.bin';

const MODEL_MISSING = 'model-missing';
const TRANSLATION_MODEL_MISSING = 'translation-model-missing';

function modelMissingCode(translate) {
  return translate ? TRANSLATION_MODEL_MISSING : MODEL_MISSING;
}

function modelMissingMessage(translate) {
  return translate
    ? 'Modello di traduzione non trovato. Scaricalo per tradurre in inglese.'
    : 'Modello Whisper non trovato in ~/CrunchRecordings/.models.';
}

/**
 * Risolve il modello ASR per il task richiesto. La traduzione usa un modello
 * dedicato: `large-v3-turbo` non esegue in modo affidabile il task translate.
 *
 * I percorsi sono restituiti anche quando il file non esiste: il chiamante può
 * mostrarli o usarli per il download. `status()` è l'unico punto che decide se
 * il modello è pronto e quale codice di errore restituire.
 */
function createModelResolver({
  modelsDir,
  legacyModelsDir = null,
  transcriptionModel = DEFAULT_TRANSCRIPTION_MODEL,
  translationModel = DEFAULT_TRANSLATION_MODEL,
  exists = fs.existsSync,
} = {}) {
  if (!modelsDir) throw new Error('modelsDir obbligatorio');

  function modelPath(translate = false) {
    const filename = translate ? translationModel : transcriptionModel;
    const primary = path.join(modelsDir, filename);
    if (exists(primary)) return primary;
    if (legacyModelsDir) {
      const legacy = path.join(legacyModelsDir, filename);
      if (exists(legacy)) return legacy;
    }
    return primary;
  }

  function status(translate = false) {
    const resolvedPath = modelPath(translate);
    const ready = exists(resolvedPath);
    return {
      ready,
      translate: !!translate,
      path: resolvedPath,
      filename: translate ? translationModel : transcriptionModel,
      code: ready ? null : modelMissingCode(translate),
      message: ready ? null : modelMissingMessage(translate),
    };
  }

  return {
    modelPath,
    status,
    translationModel,
    transcriptionModel,
  };
}

module.exports = {
  DEFAULT_TRANSCRIPTION_MODEL,
  DEFAULT_TRANSLATION_MODEL,
  MODEL_MISSING,
  TRANSLATION_MODEL_MISSING,
  createModelResolver,
  modelMissingCode,
  modelMissingMessage,
};
