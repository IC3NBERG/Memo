'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createLogger } = require('../src/core/diagnostics/logger');
const { createDiagnosticsService, displayPath, formatBytes } = require('../src/main/diagnostics-service');
const { tempDir, cleanup } = require('./helpers');

test('displayPath accorcia la home e formatBytes usa unità leggibili', () => {
  assert.equal(displayPath('/Users/mario/CrunchRecordings', '/Users/mario'), '~/CrunchRecordings');
  assert.equal(displayPath('/tmp/file', '/Users/mario'), '/tmp/file');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.50 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.00 MB');
});

test('il report diagnostico aggrega metriche senza contenuti utente', () => {
  const root = tempDir();
  try {
    const recordingsDir = path.join(root, 'archive');
    const logsDir = path.join(recordingsDir, '.logs');
    const modelsDir = path.join(recordingsDir, '.models');
    const indexPath = path.join(recordingsDir, '.index', 'search.sqlite3');
    const settingsPath = path.join(recordingsDir, 'privacy.json');
    fs.mkdirSync(path.join(recordingsDir, 'Corso', 'lezione'), { recursive: true });
    fs.writeFileSync(path.join(recordingsDir, 'Corso', 'lezione', 'audio.wav'), 'RIFF');
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(path.join(modelsDir, 'model.bin'), 'x'.repeat(100));
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, 'db');
    fs.writeFileSync(settingsPath, JSON.stringify({
      retention: { trashDays: 10, recordingsDays: 0 },
      voiceprint: { enabled: false },
    }));

    const logger = createLogger({ dir: logsDir });
    logger.warn('search.index-failed', { error: 'timeout', transcript: 'segreto' });

    let clipboardText = '';
    const diagnostics = createDiagnosticsService({
      app: { getVersion: () => '1.2.0', isPackaged: true },
      recordingsDir,
      modelsDir,
      indexPath,
      logsDir,
      logger,
      privacySettingsPath: settingsPath,
      lockService: { status: () => ({ enabled: true, autoLockMinutes: 5, lockOnBlur: false }) },
      getLastIntegrityReport: () => ({
        status: 'warning',
        generatedAt: '2026-01-01T00:00:00.000Z',
        summary: { recordings: 1, errors: 0, warnings: 2 },
        recordings: [{ recDir: '/Users/mario/CrunchRecordings/Corso/lezione', name: 'Lezione privata' }],
      }),
      platform: 'darwin',
      arch: 'arm64',
      release: () => '24.0.0',
      totalmem: () => 16 * 1024 * 1024 * 1024,
    });

    const report = diagnostics.collect();
    assert.equal(report.app.version, '1.2.0');
    assert.equal(report.archive.recordingsCount, 1);
    assert.equal(report.archive.modelsBytes, 100);
    assert.equal(report.privacy.retention.trashDays, 10);
    assert.equal(report.privacy.lockEnabled, true);
    assert.equal(report.integrity.status, 'warning');
    assert.deepEqual(report.integrity.summary, { recordings: 1, errors: 0, warnings: 2 });
    assert.equal(report.integrity.recordings, undefined);
    assert.doesNotMatch(JSON.stringify(report), /Lezione privata|Corso\/lezione/);

    const text = diagnostics.buildText(report);
    assert.match(text, /Crunch — Report diagnostico/);
    assert.match(text, /Registrazioni: 1/);
    assert.match(text, /Integrità: warning/);
    assert.match(text, /Blocco applicativo: attivo/);
    assert.match(text, /transcript=\[redacted\]/);
    assert.doesNotMatch(text, /segreto/);

    const copy = diagnostics.copyReport({ writeText: (value) => { clipboardText = value; } });
    assert.equal(copy.success, true);
    assert.equal(clipboardText, diagnostics.buildText(copy.report));
  } finally {
    cleanup(root);
  }
});
