'use strict';

const os = require('os');
const path = require('path');

const { archiveStats } = require('../core/privacy/archive');
const { formatTail } = require('../core/diagnostics/logger');
const { readPrivacySettings } = require('../core/privacy/settings');

function displayPath(target, home = os.homedir()) {
  if (!target) return '';
  return target.startsWith(home) ? `~${target.slice(home.length)}` : target;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const decimals = index === 0 ? 0 : (size >= 100 ? 0 : (size >= 10 ? 1 : 2));
  return `${size.toFixed(decimals)} ${units[index]}`;
}

function integrityLine(report) {
  if (!report) return 'non ancora eseguita';
  const summary = report.summary || {};
  return `${report.status || 'sconosciuto'} · ${summary.recordings ?? 0} registrazioni · `
    + `${summary.errors ?? 0} errori · ${summary.warnings ?? 0} avvisi`;
}

/**
 * Del report di integrità conserviamo solo lo stato aggregato: l'elenco delle
 * registrazioni contiene percorsi e nomi delle note, che la diagnostica non
 * deve esporre.
 */
function summarizeIntegrity(report) {
  if (!report) return null;
  const summary = report.summary || {};
  return {
    status: report.status || 'sconosciuto',
    generatedAt: report.generatedAt || null,
    summary: {
      recordings: summary.recordings ?? 0,
      errors: summary.errors ?? 0,
      warnings: summary.warnings ?? 0,
    },
  };
}

/**
 * Costruisce il report diagnostico. Non legge audio, trascrizioni, nomi delle
 * note o contenuti: solo metriche, percorsi applicativi e stati.
 */
function createDiagnosticsService({
  app,
  recordingsDir,
  modelsDir,
  indexPath,
  logsDir,
  library,
  search,
  logger,
  privacySettingsPath,
  lockService,
  getLastIntegrityReport = () => null,
  platform = process.platform,
  arch = process.arch,
  release = os.release,
  totalmem = os.totalmem,
} = {}) {
  function searchCount() {
    try {
      const index = search?.getIndex?.();
      return index && typeof index.count === 'function' ? index.count() : null;
    } catch (_) {
      return null;
    }
  }

  function collect() {
    const settings = readPrivacySettings(privacySettingsPath);
    const lock = lockService?.status?.() || { enabled: false };
    const stats = archiveStats({
      recordingsDir,
      modelsDir,
      indexPath,
      logsDir,
    });

    const report = {
      generatedAt: new Date().toISOString(),
      app: {
        version: app?.getVersion?.() || 'sconosciuta',
        packaged: !!app?.isPackaged,
        electron: process.versions.electron || null,
        chrome: process.versions.chrome || null,
        node: process.versions.node || null,
      },
      system: {
        platform,
        arch,
        release: release(),
        totalMemoryBytes: totalmem(),
      },
      paths: {
        recordings: displayPath(recordingsDir),
        models: displayPath(modelsDir),
        logs: displayPath(logsDir),
        searchIndex: displayPath(indexPath),
      },
      archive: {
        ...stats,
        searchDocuments: searchCount(),
      },
      integrity: summarizeIntegrity(getLastIntegrityReport()),
      privacy: {
        retention: settings.retention,
        voiceprintConsent: {
          enabled: settings.voiceprint.enabled,
          consentVersion: settings.voiceprint.consentVersion,
          grantedAt: settings.voiceprint.grantedAt,
          revokedAt: settings.voiceprint.revokedAt,
        },
        lockEnabled: !!lock.enabled,
        autoLockMinutes: lock.autoLockMinutes ?? null,
        lockOnBlur: !!lock.lockOnBlur,
      },
      logs: {
        level: logger?.getLevel?.() || 'info',
        directory: displayPath(logsDir),
        files: logger?.files?.().map((file) => ({
          name: file.name,
          bytes: file.bytes,
          mtime: file.mtime,
        })) || [],
        tail: logger?.tail?.(40) || [],
      },
    };

    return report;
  }

  function buildText(report = collect()) {
    const lock = report.privacy.lockEnabled
      ? `attivo (auto-lock ${report.privacy.autoLockMinutes} min`
        + `${report.privacy.lockOnBlur ? ', blocco alla perdita di fuoco' : ''})`
      : 'non attivo';
    const voiceprint = report.privacy.voiceprintConsent;
    const voiceprintLine = voiceprint.enabled
      ? `consenso registrato il ${voiceprint.grantedAt || 'n/d'} (v${voiceprint.consentVersion || '?'})`
      : (voiceprint.revokedAt
        ? `consenso revocato il ${voiceprint.revokedAt}`
        : 'consenso non prestato');

    return [
      'Crunch — Report diagnostico',
      `Generato: ${report.generatedAt}`,
      '',
      `App: ${report.app.version}${report.app.packaged ? ' (pacchetto)' : ' (sviluppo)'}`,
      `Runtime: Electron ${report.app.electron || '—'} · Chromium ${report.app.chrome || '—'} · Node ${report.app.node || '—'}`,
      `Sistema: ${report.system.platform} ${report.system.arch} · ${report.system.release}`,
      `Memoria: ${formatBytes(report.system.totalMemoryBytes)}`,
      '',
      `Archivio: ${report.paths.recordings}`,
      `Registrazioni: ${report.archive.recordingsCount} · ${formatBytes(report.archive.recordingsBytes)}`,
      `Cestino: ${report.archive.trashCount} elementi`,
      `File archivio: ${report.archive.archiveFiles} · ${formatBytes(report.archive.archiveBytes)}`,
      `Modelli: ${formatBytes(report.archive.modelsBytes)}`,
      `Indice ricerca: ${formatBytes(report.archive.indexBytes)} · ${report.archive.searchDocuments ?? 'n/d'} documenti`,
      `Log: ${formatBytes(report.archive.logsBytes)} (${report.logs.files.length} file, livello ${report.logs.level})`,
      '',
      `Integrità: ${integrityLine(report.integrity)}`,
      `Retention: cestino ${report.privacy.retention.trashDays === 0 ? 'mai' : `${report.privacy.retention.trashDays} giorni`}`
        + ` · registrazioni ${report.privacy.retention.recordingsDays === 0 ? 'mai' : `${report.privacy.retention.recordingsDays} giorni`}`,
      `Voiceprint: ${voiceprintLine}`,
      `Blocco applicativo: ${lock}`,
      '',
      'Ultimi eventi:',
      formatTail(report.logs.tail),
      '',
    ].join('\n');
  }

  function copyReport(clipboard) {
    const report = collect();
    const text = buildText(report);
    try {
      clipboard.writeText(text);
      return { success: true, text, report };
    } catch (err) {
      return { success: false, error: err.message, text, report };
    }
  }

  function openLogs(shell) {
    try {
      if (!logsDir) return { success: false, error: 'Cartella log non disponibile' };
      shell.openPath(logsDir);
      return { success: true, dir: displayPath(logsDir) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return {
    buildText,
    collect,
    copyReport,
    openLogs,
  };
}

module.exports = {
  createDiagnosticsService,
  displayPath,
  formatBytes,
  integrityLine,
  summarizeIntegrity,
};
