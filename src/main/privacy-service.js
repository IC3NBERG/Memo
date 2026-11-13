'use strict';

const path = require('path');

const { archiveStats, createArchiveZip, deleteArchiveContents } = require('../core/privacy/archive');
const { applyRetention, listRecordings } = require('../core/privacy/retention');
const {
  readPrivacySettings,
  setVoiceprintConsent,
  writePrivacySettings,
} = require('../core/privacy/settings');

const UNINSTALL_RESIDUES = Object.freeze([
  'L’app e i suoi file di supporto in ~/Library/Application Support/Crunch (preferenze, blocco applicativo e cache di aggiornamento).',
  'L’archivio in ~/CrunchRecordings: audio, trascrizioni, revisioni, manifest, cestino, indice di ricerca, log e modelli AI.',
  'Le eventuali copie di backup di macOS (Time Machine o altri strumenti) restano soggette alla policy di backup dell’utente.',
  'I log diagnostici in ~/CrunchRecordings/.logs non contengono audio, nomi delle note o trascrizioni.',
]);

/**
 * Servizi privacy: impostazioni, retention, export e cancellazione totale.
 * Non conosce Electron: dialog, clipboard e shell restano nel livello IPC.
 */
function createPrivacyService({
  recordingsDir,
  modelsDir,
  indexPath,
  logsDir,
  privacySettingsPath,
  search,
  logger = null,
  now = () => new Date(),
} = {}) {
  function getSettings() {
    return { success: true, settings: readPrivacySettings(privacySettingsPath) };
  }

  function updateSettings({ retention, diagnostics, voiceprintEnabled } = {}) {
    try {
      const current = readPrivacySettings(privacySettingsPath);
      let next = {
        ...current,
        retention: retention
          ? { ...current.retention, ...retention }
          : current.retention,
        diagnostics: diagnostics
          ? { ...current.diagnostics, ...diagnostics }
          : current.diagnostics,
      };
      if (voiceprintEnabled !== undefined) {
        next = setVoiceprintConsent(next, voiceprintEnabled === true, { at: now().toISOString() });
      }
      const settings = writePrivacySettings(privacySettingsPath, next);
      logger?.setLevel?.(settings.diagnostics.level);
      logger?.info('privacy.settings-updated', {
        trashDays: settings.retention.trashDays,
        recordingsDays: settings.retention.recordingsDays,
        voiceprint: settings.voiceprint.enabled,
      });
      return { success: true, settings };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function retentionPreview() {
    try {
      const settings = readPrivacySettings(privacySettingsPath);
      const preview = applyRetention({ recordingsDir, settings, now, dryRun: true });
      return {
        success: true,
        settings: settings.retention,
        trashCandidates: preview.purgedTrash.length,
        recordingCandidates: preview.trashedRecordings.length,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function applyRetentionNow() {
    try {
      const settings = readPrivacySettings(privacySettingsPath);
      const result = applyRetention({ recordingsDir, settings, now });
      for (const moved of result.trashedRecordings) {
        search?.removeRecording?.(moved.recDir);
      }
      logger?.info('privacy.retention-applied', {
        purgedTrash: result.purgedTrash.length,
        trashedRecordings: result.trashedRecordings.length,
        errors: result.errors.length,
      });
      return { success: result.success, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function getStats() {
    const stats = archiveStats({ recordingsDir, modelsDir, indexPath, logsDir });
    return {
      success: true,
      stats: {
        ...stats,
        uninstallResidues: [...UNINSTALL_RESIDUES],
      },
    };
  }

  async function exportArchive({ destination, includeModels = false } = {}) {
    if (!destination || typeof destination !== 'string') {
      return { success: false, error: 'Destinazione non valida' };
    }
    logger?.info('privacy.export-started', { includeModels: !!includeModels });
    const result = await createArchiveZip({
      recordingsDir,
      destination: path.resolve(destination),
      includeModels: !!includeModels,
    });
    if (result.success) {
      logger?.info('privacy.export-done', { bytes: result.bytes, includeModels: !!includeModels });
    } else {
      logger?.error('privacy.export-failed', { error: result.error });
    }
    return result;
  }

  function deleteArchive({ confirm, includeModels = false } = {}) {
    if (confirm !== 'ELIMINA') {
      return { success: false, error: 'Conferma non valida: scrivi ELIMINA per procedere.' };
    }
    const recordingsBefore = listRecordings(recordingsDir).length;
    logger?.warn('privacy.delete-all-started', {
      recordings: recordingsBefore,
      includeModels: !!includeModels,
    });

    try {
      search?.close?.();
      const result = deleteArchiveContents({ recordingsDir, includeModels: !!includeModels });
      if (!result.success) {
        return { success: false, error: 'Alcuni elementi non sono stati eliminati.', ...result };
      }
      const rebuilt = search?.rebuild?.();
      logger?.warn('privacy.delete-all-done', {
        removed: result.removed,
        includeModels: !!includeModels,
      });
      return {
        success: true,
        removed: result.removed,
        keptModels: result.keptModels,
        searchRebuilt: !!rebuilt?.success,
      };
    } catch (err) {
      logger?.error('privacy.delete-all-failed', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  return {
    applyRetentionNow,
    deleteArchive,
    exportArchive,
    getSettings,
    getStats,
    retentionPreview,
    updateSettings,
  };
}

module.exports = {
  UNINSTALL_RESIDUES,
  createPrivacyService,
};
