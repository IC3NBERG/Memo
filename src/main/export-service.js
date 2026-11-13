'use strict';

const { exportFilename, writeExportFile } = require('../core/library/export');
const { readMetadataFile } = require('../core/library/metadata');

/**
 * Esporta la trascrizione corrente in TXT o Markdown.
 *
 * La scelta del percorso è iniettata (`choosePath`) per poter testare il
 * servizio senza Electron. Il file viene scritto una sola volta su percorso
 * confermato dall'utente.
 */
function createExportService({
  isValidRecordingDir,
  choosePath,
  reveal = () => {},
  readMetadata = readMetadataFile,
  writeFile = writeExportFile,
} = {}) {
  async function exportTranscript({ recDir, format, text } = {}) {
    try {
      if (!isValidRecordingDir(recDir)) {
        return { success: false, error: 'Registrazione non valida' };
      }

      const safeFormat = format === 'md' ? 'md' : 'txt';
      const meta = readMetadata(recDir) || {};
      const defaultName = exportFilename({ format: safeFormat, name: meta.name });
      const chosen = await choosePath({ format: safeFormat, defaultName, recDir });
      if (!chosen || chosen.canceled || !chosen.filePath) {
        return { success: false, canceled: true };
      }

      writeFile({
        filePath: chosen.filePath,
        format: safeFormat,
        name: meta.name,
        date: meta.date,
        text,
      });
      reveal(chosen.filePath);
      return { success: true, filePath: chosen.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { exportTranscript };
}

module.exports = {
  createExportService,
};
