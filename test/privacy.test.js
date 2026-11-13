'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  DEFAULT_PRIVACY_SETTINGS,
  normalizePrivacySettings,
  readPrivacySettings,
  setVoiceprintConsent,
  writePrivacySettings,
} = require('../src/core/privacy/settings');
const {
  buildExportArgs,
  deleteArchiveContents,
} = require('../src/core/privacy/archive');
const { applyRetention } = require('../src/core/privacy/retention');
const { hashPasscode, validatePasscode, verifyPasscode } = require('../src/core/privacy/passcode');
const { createLockService } = require('../src/main/lock-service');
const { TRASH_DIR, TRASH_ENTRY_FILE } = require('../src/core/library/trash');
const { tempDir, cleanup, readJson } = require('./helpers');

function makeRecording(root, group, name, createdAt) {
  const dir = path.join(root, group, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio.wav'), 'RIFF');
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
    schemaVersion: 2,
    id: name,
    createdAt,
    updatedAt: createdAt,
    name,
    duration: 10,
  }, null, 2));
  return dir;
}

function makeTrashEntry(root, id, trashedAt) {
  const dir = path.join(root, TRASH_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio.wav'), 'RIFF');
  fs.writeFileSync(path.join(dir, TRASH_ENTRY_FILE), JSON.stringify({
    schemaVersion: 1,
    id,
    trashedAt,
    name: id,
    originalName: id,
    originalFolder: null,
  }, null, 2));
  return dir;
}

test('le impostazioni privacy normalizzano valori fuori scala e livelli sconosciuti', () => {
  const normalized = normalizePrivacySettings({
    retention: { trashDays: 99999, recordingsDays: -3 },
    diagnostics: { level: 'verbose' },
    voiceprint: { enabled: true, grantedAt: '2025-01-01T00:00:00.000Z', consentVersion: 7 },
    ignorato: true,
  });

  assert.equal(normalized.retention.trashDays, 3650);
  assert.equal(normalized.retention.recordingsDays, 0);
  assert.equal(normalized.diagnostics.level, 'info');
  assert.equal(normalized.voiceprint.enabled, true);
  assert.equal(normalized.voiceprint.consentVersion, 7);
  assert.equal(normalized.ignorato, undefined);
  assert.deepEqual(readPrivacySettings(path.join(tempDir(), 'assente.json')), normalizePrivacySettings(DEFAULT_PRIVACY_SETTINGS));
});

test('il consenso voiceprint è esplicito, locale e revocabile', () => {
  const granted = setVoiceprintConsent(DEFAULT_PRIVACY_SETTINGS, true, {
    at: '2025-06-01T10:00:00.000Z',
  });
  assert.equal(granted.voiceprint.enabled, true);
  assert.equal(granted.voiceprint.scope, 'local-only');
  assert.equal(granted.voiceprint.grantedAt, '2025-06-01T10:00:00.000Z');

  const revoked = setVoiceprintConsent(granted, false, {
    at: '2025-06-02T10:00:00.000Z',
  });
  assert.equal(revoked.voiceprint.enabled, false);
  assert.equal(revoked.voiceprint.revokedAt, '2025-06-02T10:00:00.000Z');
  assert.equal(revoked.voiceprint.grantedAt, '2025-06-01T10:00:00.000Z');
});

test('le impostazioni privacy vengono scritte in modo atomico e rilette', () => {
  const root = tempDir();
  try {
    const file = path.join(root, 'privacy.json');
    const written = writePrivacySettings(file, {
      retention: { trashDays: 7, recordingsDays: 90 },
      voiceprint: { enabled: true, grantedAt: '2025-06-01T10:00:00.000Z' },
    });
    const onDisk = readJson(file);
    assert.equal(onDisk.retention.trashDays, 7);
    assert.deepEqual(readPrivacySettings(file), written);
  } finally {
    cleanup(root);
  }
});

test('la retention elimina dal cestino e sposta nel cestino senza cancellare', () => {
  const root = tempDir();
  try {
    const oldRec = makeRecording(root, 'Corso', 'vecchia', '2020-01-01T00:00:00.000Z');
    const freshRec = makeRecording(root, 'Corso', 'nuova', '2026-06-01T00:00:00.000Z');
    const trashed = makeTrashEntry(root, '2020-01-01T00-00-00-000Z__old', '2020-01-01T00:00:00.000Z');

    const now = () => new Date('2026-06-15T00:00:00.000Z');
    const preview = applyRetention({
      recordingsDir: root,
      settings: { retention: { trashDays: 30, recordingsDays: 365 } },
      now,
      dryRun: true,
    });
    assert.equal(preview.purgedTrash.length, 1);
    assert.equal(preview.trashedRecordings.length, 1);
    assert.ok(fs.existsSync(oldRec));
    assert.ok(fs.existsSync(trashed));

    const applied = applyRetention({
      recordingsDir: root,
      settings: { retention: { trashDays: 30, recordingsDays: 365 } },
      now,
    });
    assert.equal(applied.success, true);
    assert.equal(applied.purgedTrash.length, 1);
    assert.equal(applied.trashedRecordings.length, 1);
    assert.equal(fs.existsSync(trashed), false);
    assert.equal(fs.existsSync(oldRec), false);
    assert.ok(fs.existsSync(freshRec));
    assert.equal(fs.readdirSync(path.join(root, TRASH_DIR)).length, 1);
  } finally {
    cleanup(root);
  }
});

test('l’export esclude indice, log e modelli salvo richiesta', () => {
  const base = buildExportArgs({ destination: '/tmp/archivio.zip' });
  assert.ok(base.includes('.index/*'));
  assert.ok(base.includes('.logs/*'));
  assert.ok(base.includes('.models/*'));

  const full = buildExportArgs({ destination: '/tmp/archivio.zip', includeModels: true });
  assert.equal(full.includes('.models/*'), false);
});

test('la cancellazione totale preserva impostazioni e, se richiesto, i modelli', () => {
  const root = tempDir();
  try {
    makeRecording(root, 'Corso', 'lezione', '2026-01-01T00:00:00.000Z');
    fs.mkdirSync(path.join(root, TRASH_DIR, 'x'), { recursive: true });
    fs.mkdirSync(path.join(root, '.index'), { recursive: true });
    fs.writeFileSync(path.join(root, '.index', 'search.sqlite3'), 'db');
    fs.mkdirSync(path.join(root, '.logs'), { recursive: true });
    fs.writeFileSync(path.join(root, '.logs', 'crunch.log'), 'log');
    fs.mkdirSync(path.join(root, '.models'), { recursive: true });
    fs.writeFileSync(path.join(root, '.models', 'model.bin'), 'model');
    fs.writeFileSync(path.join(root, 'privacy.json'), '{}');

    const result = deleteArchiveContents({ recordingsDir: root, includeModels: false });
    assert.equal(result.success, true);
    assert.equal(fs.existsSync(path.join(root, 'Corso')), false);
    assert.equal(fs.existsSync(path.join(root, TRASH_DIR)), false);
    assert.equal(fs.existsSync(path.join(root, '.index')), false);
    assert.equal(fs.existsSync(path.join(root, '.logs')), false);
    assert.ok(fs.existsSync(path.join(root, '.models', 'model.bin')));
    assert.ok(fs.existsSync(path.join(root, 'privacy.json')));
    assert.ok(fs.existsSync(path.join(root, '_unsorted')));

    const full = deleteArchiveContents({ recordingsDir: root, includeModels: true });
    assert.equal(full.success, true);
    assert.equal(fs.existsSync(path.join(root, '.models')), false);
  } finally {
    cleanup(root);
  }
});

test('il codice di blocco è salvato come hash scrypt e verificato in modo sicuro', () => {
  assert.equal(validatePasscode('123').ok, false);
  assert.equal(validatePasscode('1234').ok, true);

  const record = hashPasscode('1234');
  assert.equal(record.algorithm, 'scrypt');
  assert.notEqual(record.hash, '1234');
  assert.equal(record.hash.includes('1234'), false);
  assert.equal(verifyPasscode('1234', record), true);
  assert.equal(verifyPasscode('9999', record), false);
  assert.equal(verifyPasscode('1234', { ...record, salt: '00' }), false);
});

test('il lock service imposta, verifica, aggiorna e rimuove il blocco', () => {
  const root = tempDir();
  try {
    const lock = createLockService({ file: path.join(root, 'lock.json') });
    assert.equal(lock.status().enabled, false);

    const set = lock.setPasscode({ passcode: '4321' });
    assert.equal(set.success, true);
    assert.equal(lock.status().enabled, true);
    assert.equal(lock.verify({ passcode: '0000' }).success, false);
    assert.equal(lock.verify({ passcode: '4321' }).success, true);

    const options = lock.updateOptions({ autoLockMinutes: 15, lockOnBlur: true });
    assert.equal(options.autoLockMinutes, 15);
    assert.equal(options.lockOnBlur, true);

    assert.equal(lock.disable({ passcode: '0000' }).success, false);
    assert.equal(lock.disable({ passcode: '4321' }).success, true);
    assert.equal(lock.status().enabled, false);
  } finally {
    cleanup(root);
  }
});
