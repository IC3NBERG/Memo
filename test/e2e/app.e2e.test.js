'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { launchApp } = require('./cdp');
const { tempDir, cleanup } = require('../helpers');

const enabled = process.env.CRUNCH_E2E === '1';

test('E2E: l’app avvia, parla con il main e gestisce un gruppo completo', {
  skip: enabled ? false : 'Imposta CRUNCH_E2E=1 per eseguire gli E2E Electron',
  timeout: 90000,
}, async () => {
  const root = tempDir('crunch-e2e-');
  const recordingsDir = path.join(root, 'archive');
  fs.mkdirSync(recordingsDir, { recursive: true });

  const app = await launchApp({ recordingsDir });
  try {
    const boot = await app.client.evaluate(`(async () => ({
      title: document.title,
      brand: document.querySelector('.app-name')?.textContent || null,
      hasApi: !!window.crunchAPI,
      version: await window.crunchAPI.getVersion(),
      modules: [
        'setupWaveform',
        'renderLibrary',
        'renderTranscript',
        'renderBlockEditor',
        'setupModelDownloadListeners',
        'openTrashPanel',
      ].filter((name) => typeof window[name] !== 'function'),
    }))()`);

    assert.equal(boot.title, 'Crunch');
    assert.equal(boot.brand, 'Crunch');
    assert.equal(boot.hasApi, true);
    assert.equal(typeof boot.version, 'string');
    assert.deepEqual(boot.modules, []);

    // Un gruppo viene creato, rinominato ed eliminato attraverso i confini IPC.
    const created = await app.client.evaluate(
      "window.crunchAPI.folderCreate({ name: 'E2E Storia' })",
    );
    assert.equal(created.success, true);
    assert.equal(created.name, 'E2E Storia');

    const afterCreate = await app.client.evaluate('window.crunchAPI.libraryGet()');
    assert.deepEqual(afterCreate.folders.map((folder) => folder.name), ['E2E Storia']);

    const renamed = await app.client.evaluate(
      "window.crunchAPI.folderRename({ oldName: 'E2E Storia', newName: 'E2E Moderna' })",
    );
    assert.equal(renamed.success, true);
    const afterRename = await app.client.evaluate('window.crunchAPI.libraryGet()');
    assert.deepEqual(afterRename.folders.map((folder) => folder.name), ['E2E Moderna']);

    const deleted = await app.client.evaluate(
      "window.crunchAPI.folderDelete({ name: 'E2E Moderna' })",
    );
    assert.equal(deleted.success, true);
    const afterDelete = await app.client.evaluate('window.crunchAPI.libraryGet()');
    assert.deepEqual(afterDelete.folders, []);

    // Salvataggio anti-sovrascrittura: due registrazioni con lo stesso nome.
    const save = `window.crunchAPI.recordingSave({
      buffer: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]),
      name: 'E2E Lezione',
      folder: 'E2E Moderna',
    })`;
    const first = await app.client.evaluate(
      `(async () => { await window.crunchAPI.folderCreate({ name: 'E2E Moderna' }); return ${save}; })()`,
    );
    const second = await app.client.evaluate(save);
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.notEqual(first.recDir, second.recDir);

    const library = await app.client.evaluate('window.crunchAPI.libraryGet()');
    const folder = library.folders.find((item) => item.name === 'E2E Moderna');
    assert.equal(folder.recordings.length, 2);

    const trash = await app.client.evaluate('window.crunchAPI.trashList()');
    assert.equal(trash.success, true);
    assert.equal(trash.entries.length, 0);

    const removed = await app.client.evaluate(
      `window.crunchAPI.recordingDelete(${JSON.stringify({ recDir: first.recDir })})`,
    );
    assert.equal(removed.success, true);
    const trashAfter = await app.client.evaluate('window.crunchAPI.trashList()');
    assert.equal(trashAfter.entries.length, 1);
    assert.equal(fs.existsSync(first.recDir), false);

    // Privacy operativa e diagnostica: IPC, moduli renderer e pannelli.
    const privacy = await app.client.evaluate(`(async () => ({
      settings: await window.crunchAPI.privacyGetSettings(),
      stats: await window.crunchAPI.privacyStats(),
      lock: await window.crunchAPI.lockStatus(),
      diagnostics: await window.crunchAPI.diagnosticsGet(),
      ui: {
        privacyButton: !!document.getElementById('btn-privacy'),
        diagnosticsButton: !!document.getElementById('btn-diagnostics'),
        privacyModal: !!document.getElementById('modal-privacy'),
        diagnosticsModal: !!document.getElementById('modal-diagnostics'),
        lockScreen: !!document.getElementById('lock-screen'),
        api: typeof window.PrivacyUI?.setupPrivacyControls === 'function',
      },
    }))()`);
    assert.equal(privacy.settings.success, true);
    assert.equal(privacy.settings.settings.retention.trashDays, 30);
    assert.equal(privacy.stats.success, true);
    assert.equal(privacy.lock.enabled, false);
    assert.equal(privacy.diagnostics.success, true);
    assert.equal(privacy.diagnostics.report.app.version, boot.version);
    assert.deepEqual(privacy.ui, {
      privacyButton: true,
      diagnosticsButton: true,
      privacyModal: true,
      diagnosticsModal: true,
      lockScreen: true,
      api: true,
    });

    const panels = await app.client.evaluate(`(async () => {
      document.getElementById('btn-privacy').click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const privacyOpen = !document.getElementById('modal-privacy').classList.contains('hidden');
      const trashDays = document.getElementById('privacy-trash-days').value;
      const stats = document.getElementById('privacy-stats').textContent;
      document.getElementById('btn-privacy-ok').click();

      document.getElementById('btn-diagnostics').click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const diagnosticsOpen = !document.getElementById('modal-diagnostics').classList.contains('hidden');
      const cards = document.querySelectorAll('#diagnostics-summary .diagnostics-card').length;
      document.getElementById('btn-diagnostics-ok').click();
      return { privacyOpen, trashDays, stats, diagnosticsOpen, cards };
    })()`);
    assert.equal(panels.privacyOpen, true);
    assert.equal(panels.trashDays, '30');
    assert.match(panels.stats, /registrazioni/);
    assert.equal(panels.diagnosticsOpen, true);
    assert.ok(panels.cards >= 3);

    const lockRoundTrip = await app.client.evaluate(`(async () => {
      const set = await window.crunchAPI.lockSetPasscode({ passcode: '4321' });
      const wrong = await window.crunchAPI.lockVerify({ passcode: '0000' });
      const right = await window.crunchAPI.lockVerify({ passcode: '4321' });
      const disabled = await window.crunchAPI.lockDisable({ passcode: '4321' });
      return {
        set: set.success,
        wrong: wrong.success,
        right: right.success,
        disabled: disabled.success,
        finalStatus: await window.crunchAPI.lockStatus(),
      };
    })()`);
    assert.equal(lockRoundTrip.set, true);
    assert.equal(lockRoundTrip.wrong, false);
    assert.equal(lockRoundTrip.right, true);
    assert.equal(lockRoundTrip.disabled, true);
    assert.equal(lockRoundTrip.finalStatus.enabled, false);

    assert.deepEqual(app.collectExceptions(), []);
  } finally {
    await app.close();
    cleanup(root);
  }
});
