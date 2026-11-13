'use strict';

// ══════════════════════════════════════════════════════════════
// PRIVACY OPERATIVA, BLOCCO APPLICATIVO E DIAGNOSTICA
// ══════════════════════════════════════════════════════════════

const PrivacyIcons = window.MEMO_ICONS || {};

const privacyEl = (id) => document.getElementById(id);

const privacyState = {
  settings: null,
  stats: null,
  lock: { enabled: false, autoLockMinutes: 5, lockOnBlur: false },
  idleTimer: null,
  locked: false,
  diagnostics: null,
};

function privacyFormatBytes(bytes) {
  if (typeof formatBytes === 'function') return formatBytes(bytes);
  return `${Number(bytes) || 0} B`;
}

function privacySetText(id, text) {
  const node = privacyEl(id);
  if (node) node.textContent = text;
}

function privacyEscape(value) {
  return String(value ?? '');
}

function privacyNote(message, type = 'info') {
  if (typeof showToast === 'function') showToast(message, type);
}

function injectPrivacyIcons() {
  const map = {
    'icon-privacy-slot': PrivacyIcons.shield,
    'icon-diagnostics-slot': PrivacyIcons.activity,
    'modal-privacy-icon-slot': PrivacyIcons.shield,
    'modal-diagnostics-icon-slot': PrivacyIcons.activity,
    'privacy-retention-icon-slot': PrivacyIcons.clock,
    'privacy-voiceprint-icon-slot': PrivacyIcons.audioWave,
    'privacy-lock-icon-slot': PrivacyIcons.lock,
    'privacy-archive-icon-slot': PrivacyIcons.shield,
    'privacy-uninstall-icon-slot': PrivacyIcons.trash,
    'privacy-export-icon-slot': PrivacyIcons.download,
    'diagnostics-log-icon-slot': PrivacyIcons.activity,
    'modal-delete-icon-slot': PrivacyIcons.trash,
    'lock-icon-slot': PrivacyIcons.lock,
  };
  for (const [id, icon] of Object.entries(map)) {
    const node = privacyEl(id);
    if (node && icon) node.innerHTML = icon;
  }
}

// ─── Impostazioni ─────────────────────────────────────────────
function fillPrivacySettings(settings) {
  if (!settings) return;
  privacyState.settings = settings;
  const trash = privacyEl('privacy-trash-days');
  const recordings = privacyEl('privacy-recordings-days');
  const voiceprint = privacyEl('privacy-voiceprint-consent');
  if (trash) trash.value = String(settings.retention.trashDays);
  if (recordings) recordings.value = String(settings.retention.recordingsDays);
  if (voiceprint) voiceprint.checked = settings.voiceprint.enabled === true;

  const voice = settings.voiceprint;
  let voiceState = 'Nessun consenso registrato.';
  if (voice.enabled) {
    voiceState = `Consenso prestato il ${new Date(voice.grantedAt).toLocaleString('it-IT')} · solo locale.`;
  } else if (voice.revokedAt) {
    voiceState = `Consenso revocato il ${new Date(voice.revokedAt).toLocaleString('it-IT')}.`;
  }
  privacySetText('privacy-voiceprint-state', voiceState);
}

function fillLockState(lock) {
  privacyState.lock = lock || { enabled: false, autoLockMinutes: 5, lockOnBlur: false };
  const minutes = privacyEl('privacy-lock-minutes');
  const blur = privacyEl('privacy-lock-on-blur');
  if (minutes) minutes.value = String(lock?.autoLockMinutes || 5);
  if (blur) blur.checked = lock?.lockOnBlur === true;

  privacySetText(
    'privacy-lock-state',
    lock?.enabled
      ? `Blocco attivo · auto-lock ${lock.autoLockMinutes} min${lock.lockOnBlur ? ' · anche alla perdita di fuoco' : ''}`
      : 'Blocco non attivo.',
  );

  const disableBtn = privacyEl('btn-privacy-lock-disable');
  if (disableBtn) disableBtn.disabled = !lock?.enabled;
  armIdleLock();
}

function renderPrivacyStats(stats) {
  privacyState.stats = stats;
  if (!stats) return;
  privacySetText(
    'privacy-stats',
    `${stats.recordingsCount} registrazioni · cestino ${stats.trashCount} elementi · `
    + `${privacyFormatBytes(stats.recordingsBytes)} di dati · `
    + `${privacyFormatBytes(stats.modelsBytes)} di modelli · `
    + `${privacyFormatBytes(stats.logsBytes)} di log`,
  );

  const list = privacyEl('privacy-uninstall-list');
  if (!list) return;
  list.replaceChildren();
  for (const line of stats.uninstallResidues || []) {
    const item = document.createElement('li');
    item.textContent = line;
    list.appendChild(item);
  }
}

async function loadPrivacyPanel() {
  try {
    const [settingsResult, statsResult, lockResult] = await Promise.all([
      API.privacyGetSettings(),
      API.privacyStats(),
      API.lockStatus ? API.lockStatus() : Promise.resolve(null),
    ]);
    if (settingsResult?.success) fillPrivacySettings(settingsResult.settings);
    if (statsResult?.success) renderPrivacyStats(statsResult.stats);
    if (lockResult) fillLockState(lockResult);
  } catch (err) {
    privacyNote(err?.message || 'Impossibile leggere le impostazioni privacy', 'error');
  }
}

async function saveRetentionInputs() {
  const trashDays = Number(privacyEl('privacy-trash-days')?.value || 0);
  const recordingsDays = Number(privacyEl('privacy-recordings-days')?.value || 0);
  const result = await API.privacyUpdateSettings({
    retention: { trashDays, recordingsDays },
  });
  if (result?.success) {
    fillPrivacySettings(result.settings);
  } else {
    privacyNote(result?.error || 'Salvataggio non riuscito', 'error');
  }
  return result;
}

async function previewRetention() {
  const saved = await saveRetentionInputs();
  if (!saved?.success) return;
  const preview = await API.privacyRetentionPreview();
  if (!preview?.success) {
    privacyNote(preview?.error || 'Anteprima non disponibile', 'error');
    return;
  }
  privacySetText(
    'privacy-retention-result',
    `Da eliminare dal cestino: ${preview.trashCandidates} · da spostare nel cestino: ${preview.recordingCandidates}`,
  );
}

async function applyRetention() {
  const saved = await saveRetentionInputs();
  if (!saved?.success) return;
  const preview = await API.privacyRetentionPreview();
  if (preview?.success && preview.trashCandidates === 0 && preview.recordingCandidates === 0) {
    privacySetText('privacy-retention-result', 'Nessun elemento da elaborare con le soglie attuali.');
    return;
  }

  const ok = typeof confirmDialog === 'function'
    ? await confirmDialog(
      'Applicare la retention?',
      `Verranno eliminati ${preview?.trashCandidates || 0} elementi dal cestino e spostate nel cestino ${preview?.recordingCandidates || 0} registrazioni.`,
      'Applica',
      true,
    )
    : true;
  if (!ok) return;

  const result = await API.privacyApplyRetention();
  if (!result?.success) {
    privacyNote(result?.error || 'Retention non applicata per intero', 'error');
  } else {
    privacyNote(
      `Retention applicata: ${result.purgedTrash?.length || 0} eliminati, `
      + `${result.trashedRecordings?.length || 0} spostati nel cestino.`,
      'success',
    );
    privacySetText(
      'privacy-retention-result',
      `${result.purgedTrash?.length || 0} eliminati dal cestino · ${result.trashedRecordings?.length || 0} spostati nel cestino`,
    );
  }
  await loadPrivacyPanel();
  if (typeof refreshLibrary === 'function') refreshLibrary();
}

async function toggleVoiceprintConsent() {
  const enabled = privacyEl('privacy-voiceprint-consent')?.checked === true;
  if (enabled && typeof confirmDialog === 'function') {
    const ok = await confirmDialog(
      'Consenso al voiceprint',
      'Confermi il consenso al riconoscimento vocale persistente locale? La funzione non è ancora attiva; il consenso sarà usato solo in futuro e potrà essere revocato.',
      'Acconsento',
      false,
    );
    if (!ok) {
      const input = privacyEl('privacy-voiceprint-consent');
      if (input) input.checked = false;
      return;
    }
  }
  const result = await API.privacyUpdateSettings({ voiceprintEnabled: enabled });
  if (result?.success) {
    fillPrivacySettings(result.settings);
    privacyNote(enabled ? 'Consenso registrato solo in locale.' : 'Consenso revocato.', 'success');
  } else {
    privacyNote(result?.error || 'Aggiornamento non riuscito', 'error');
    const input = privacyEl('privacy-voiceprint-consent');
    if (input) input.checked = !enabled;
  }
}

// ─── Blocco applicativo ──────────────────────────────────────
function showLockScreen() {
  const screen = privacyEl('lock-screen');
  if (!screen) return;
  privacyState.locked = true;
  screen.classList.remove('hidden');
  const input = privacyEl('lock-passcode');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 50);
  }
  privacySetText('lock-error', '');
  clearTimeout(privacyState.idleTimer);
}

function hideLockScreen() {
  privacyState.locked = false;
  privacyEl('lock-screen')?.classList.add('hidden');
  const input = privacyEl('lock-passcode');
  if (input) input.value = '';
  privacySetText('lock-error', '');
  armIdleLock();
}

async function unlockArchive() {
  const input = privacyEl('lock-passcode');
  const button = privacyEl('btn-lock-unlock');
  const passcode = input?.value || '';
  if (!passcode) {
    privacySetText('lock-error', 'Inserisci il codice.');
    return;
  }
  if (button) button.disabled = true;
  const result = await API.lockVerify({ passcode }).catch((err) => ({ success: false, error: err.message }));
  if (button) button.disabled = false;
  if (result?.success) {
    hideLockScreen();
    return;
  }
  privacySetText('lock-error', result?.error || 'Codice non corretto.');
  if (input) {
    input.value = '';
    input.focus();
  }
  if (result?.retryAfterMs) {
    if (button) button.disabled = true;
    setTimeout(() => { if (button) button.disabled = false; }, result.retryAfterMs);
  }
}

function armIdleLock() {
  clearTimeout(privacyState.idleTimer);
  if (!privacyState.lock?.enabled || privacyState.locked) return;
  const minutes = Math.max(1, Number(privacyState.lock.autoLockMinutes) || 5);
  privacyState.idleTimer = setTimeout(() => {
    if (!privacyState.locked) showLockScreen();
  }, minutes * 60 * 1000);
}

function resetIdleLock() {
  if (privacyState.locked) return;
  armIdleLock();
}

async function setLockPasscode() {
  const current = privacyEl('privacy-lock-current')?.value || '';
  const passcode = privacyEl('privacy-lock-passcode')?.value || '';
  const confirm = privacyEl('privacy-lock-passcode-confirm')?.value || '';

  if (passcode !== confirm) {
    privacyNote('I due codici non coincidono.', 'error');
    return;
  }
  if (passcode.length < 4) {
    privacyNote('Il codice deve avere almeno 4 caratteri.', 'error');
    return;
  }

  const result = await API.lockSetPasscode({ passcode, currentPasscode: current });
  if (!result?.success) {
    privacyNote(result?.error || 'Impossibile impostare il codice', 'error');
    return;
  }
  for (const id of ['privacy-lock-current', 'privacy-lock-passcode', 'privacy-lock-passcode-confirm']) {
    const input = privacyEl(id);
    if (input) input.value = '';
  }
  fillLockState(result);
  privacyNote('Blocco applicativo attivo.', 'success');
}

async function disableLock() {
  const passcode = privacyEl('privacy-lock-current')?.value
    || privacyEl('privacy-lock-passcode')?.value
    || '';
  if (!passcode) {
    privacyNote('Inserisci il codice attuale per rimuovere il blocco.', 'error');
    return;
  }
  const result = await API.lockDisable({ passcode });
  if (!result?.success) {
    privacyNote(result?.error || 'Codice non corretto', 'error');
    return;
  }
  fillLockState({ ...privacyState.lock, enabled: false });
  privacyNote('Blocco rimosso.', 'success');
}

async function saveLockOptions() {
  const autoLockMinutes = Number(privacyEl('privacy-lock-minutes')?.value || 5);
  const lockOnBlur = privacyEl('privacy-lock-on-blur')?.checked === true;
  const result = await API.lockUpdateOptions({ autoLockMinutes, lockOnBlur });
  if (result?.success) {
    fillLockState(result);
  } else {
    privacyNote(result?.error || 'Preferenze di blocco non salvate', 'error');
  }
}

function setupLockOnBlur() {
  window.addEventListener('blur', () => {
    if (!privacyState.lock?.enabled || !privacyState.lock.lockOnBlur) return;
    setTimeout(() => {
      if (!document.hasFocus() && !privacyState.locked) showLockScreen();
    }, 200);
  });
}

async function initPrivacyLock() {
  try {
    const lock = await API.lockStatus();
    fillLockState(lock);
    if (lock?.enabled) showLockScreen();
  } catch (_) {
    fillLockState({ enabled: false, autoLockMinutes: 5, lockOnBlur: false });
  }
}

// ─── Export e cancellazione ──────────────────────────────────
async function exportArchive() {
  const includeModels = privacyEl('privacy-include-models')?.checked === true;
  const button = privacyEl('btn-privacy-export');
  if (button) button.disabled = true;
  const result = await API.privacyExportArchive({ includeModels })
    .catch((err) => ({ success: false, error: err.message }));
  if (button) button.disabled = false;
  if (result?.canceled) return;
  if (result?.success) {
    privacyNote(`Archivio esportato (${privacyFormatBytes(result.bytes)}).`, 'success', 5000);
  } else {
    privacyNote(result?.error || 'Export non riuscito', 'error', 5000);
  }
}

function openDeleteArchiveModal() {
  const modal = privacyEl('modal-delete-archive');
  if (!modal) return;
  const input = privacyEl('delete-archive-confirm');
  const confirmButton = privacyEl('btn-delete-archive-confirm');
  const models = privacyEl('delete-archive-models');
  if (input) input.value = '';
  if (confirmButton) confirmButton.disabled = true;
  if (models) models.checked = privacyEl('privacy-include-models')?.checked === true;
  modal.classList.remove('hidden');
  if (typeof updateBannerOffset === 'function') updateBannerOffset();
  setTimeout(() => input?.focus(), 40);
}

function closeDeleteArchiveModal() {
  privacyEl('modal-delete-archive')?.classList.add('hidden');
  if (typeof updateBannerOffset === 'function') updateBannerOffset();
}

async function confirmDeleteArchive() {
  const confirm = privacyEl('delete-archive-confirm')?.value || '';
  const includeModels = privacyEl('delete-archive-models')?.checked === true;
  const button = privacyEl('btn-delete-archive-confirm');
  if (button) button.disabled = true;

  const result = await API.privacyDeleteArchive({ confirm, includeModels })
    .catch((err) => ({ success: false, error: err.message }));

  if (!result?.success) {
    if (button) button.disabled = false;
    privacyNote(result?.error || 'Eliminazione non riuscita', 'error', 5000);
    return;
  }

  closeDeleteArchiveModal();
  privacyNote('Archivio eliminato. L’app verrà ricaricata.', 'success', 3000);
  setTimeout(() => window.location.reload(), 700);
}

// ─── Diagnostica ─────────────────────────────────────────────
function diagnosticsRow(label, value, extraClass = '') {
  const row = document.createElement('div');
  row.className = `diagnostics-row ${extraClass}`.trim();
  const name = document.createElement('span');
  name.className = 'diagnostics-label';
  name.textContent = label;
  const data = document.createElement('span');
  data.className = 'diagnostics-value';
  data.textContent = privacyEscape(value);
  row.append(name, data);
  return row;
}

function diagnosticsSection(title, rows) {
  const section = document.createElement('div');
  section.className = 'diagnostics-card';
  const heading = document.createElement('h4');
  heading.textContent = title;
  section.appendChild(heading);
  for (const [label, value] of rows) section.appendChild(diagnosticsRow(label, value));
  return section;
}

function formatLogTail(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return 'Nessun evento registrato.';
  return lines.map((line) => {
    try {
      const entry = JSON.parse(line);
      const fields = Object.entries(entry)
        .filter(([key]) => !['ts', 'level', 'event'].includes(key))
        .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
        .join(' ');
      return `${entry.ts} [${String(entry.level || '').toUpperCase()}] ${entry.event}${fields ? ` · ${fields}` : ''}`;
    } catch (_) {
      return String(line);
    }
  }).join('\n');
}

function renderDiagnostics(report) {
  privacyState.diagnostics = report;
  const summary = privacyEl('diagnostics-summary');
  if (summary && report) {
    summary.replaceChildren(
      diagnosticsSection('Ambiente', [
        ['Versione', `${report.app.version}${report.app.packaged ? ' (pacchetto)' : ' (sviluppo)'}`],
        ['Runtime', `Electron ${report.app.electron || '—'} · Chromium ${report.app.chrome || '—'}`],
        ['Node', report.app.node || '—'],
        ['Sistema', `${report.system.platform} ${report.system.arch} · ${report.system.release}`],
      ]),
      diagnosticsSection('Archivio', [
        ['Percorso', report.paths.recordings],
        ['Registrazioni', `${report.archive.recordingsCount} · ${privacyFormatBytes(report.archive.recordingsBytes)}`],
        ['Cestino', `${report.archive.trashCount} elementi`],
        ['Indice ricerca', `${privacyFormatBytes(report.archive.indexBytes)} · ${report.archive.searchDocuments ?? 'n/d'} documenti`],
        ['Modelli', privacyFormatBytes(report.archive.modelsBytes)],
        ['Log', `${privacyFormatBytes(report.archive.logsBytes)} · livello ${report.logs.level}`],
      ]),
      diagnosticsSection('Integrità e privacy', [
        ['Ultima verifica', report.integrity
          ? `${report.integrity.status} · ${report.integrity.summary?.errors ?? 0} errori · ${report.integrity.summary?.warnings ?? 0} avvisi`
          : 'non ancora eseguita'],
        ['Retention cestino', report.privacy.retention.trashDays === 0 ? 'mai' : `${report.privacy.retention.trashDays} giorni`],
        ['Retention registrazioni', report.privacy.retention.recordingsDays === 0 ? 'mai' : `${report.privacy.retention.recordingsDays} giorni`],
        ['Voiceprint', report.privacy.voiceprintConsent.enabled ? 'consenso prestato' : 'consenso non attivo'],
        ['Blocco', report.privacy.lockEnabled ? `attivo · ${report.privacy.autoLockMinutes} min` : 'non attivo'],
      ]),
    );
  }

  const tail = privacyEl('diagnostics-tail');
  if (tail) tail.textContent = formatLogTail(report?.logs?.tail);
  const level = privacyEl('diagnostics-level');
  if (level && report?.logs?.level) level.value = report.logs.level;
}

async function loadDiagnostics() {
  const result = await API.diagnosticsGet().catch((err) => ({ success: false, error: err.message }));
  if (!result?.success) {
    privacyNote(result?.error || 'Diagnostica non disponibile', 'error');
    return;
  }
  renderDiagnostics(result.report);
}

function openDiagnosticsModal() {
  const modal = privacyEl('modal-diagnostics');
  if (!modal) return;
  modal.classList.remove('hidden');
  if (typeof updateBannerOffset === 'function') updateBannerOffset();
  loadDiagnostics();
}

function closeDiagnosticsModal() {
  privacyEl('modal-diagnostics')?.classList.add('hidden');
  if (typeof updateBannerOffset === 'function') updateBannerOffset();
}

async function copyDiagnosticsReport() {
  const result = await API.diagnosticsCopy().catch((err) => ({ success: false, error: err.message }));
  if (result?.success) {
    privacyNote('Report diagnostico copiato negli appunti.', 'success');
    return;
  }
  const text = await API.diagnosticsText().catch(() => null);
  if (text?.success) {
    try {
      await navigator.clipboard.writeText(text.text);
      privacyNote('Report diagnostico copiato negli appunti.', 'success');
      return;
    } catch (_) {}
  }
  privacyNote(result?.error || 'Copia del report non riuscita', 'error');
}

// ─── Setup ───────────────────────────────────────────────────
function setupPrivacyControls() {
  injectPrivacyIcons();

  const modal = privacyEl('modal-privacy');
  privacyEl('btn-privacy')?.addEventListener('click', () => {
    modal?.classList.remove('hidden');
    if (typeof updateBannerOffset === 'function') updateBannerOffset();
    loadPrivacyPanel();
  });
  const close = () => {
    modal?.classList.add('hidden');
    if (typeof updateBannerOffset === 'function') updateBannerOffset();
  };
  privacyEl('btn-privacy-close')?.addEventListener('click', close);
  privacyEl('btn-privacy-ok')?.addEventListener('click', close);
  modal?.addEventListener('click', (event) => { if (event.target === modal) close(); });

  privacyEl('btn-privacy-preview')?.addEventListener('click', previewRetention);
  privacyEl('btn-privacy-apply')?.addEventListener('click', applyRetention);
  privacyEl('privacy-voiceprint-consent')?.addEventListener('change', toggleVoiceprintConsent);

  privacyEl('btn-privacy-lock-set')?.addEventListener('click', setLockPasscode);
  privacyEl('btn-privacy-lock-disable')?.addEventListener('click', disableLock);
  privacyEl('btn-privacy-lock-now')?.addEventListener('click', () => {
    if (!privacyState.lock?.enabled) {
      privacyNote('Imposta prima un codice di blocco.', 'info');
      return;
    }
    showLockScreen();
  });
  privacyEl('privacy-lock-minutes')?.addEventListener('change', saveLockOptions);
  privacyEl('privacy-lock-on-blur')?.addEventListener('change', saveLockOptions);

  privacyEl('btn-privacy-export')?.addEventListener('click', exportArchive);
  privacyEl('btn-privacy-delete')?.addEventListener('click', openDeleteArchiveModal);

  const deleteModal = privacyEl('modal-delete-archive');
  privacyEl('btn-delete-archive-cancel')?.addEventListener('click', closeDeleteArchiveModal);
  deleteModal?.addEventListener('click', (event) => {
    if (event.target === deleteModal) closeDeleteArchiveModal();
  });
  privacyEl('delete-archive-confirm')?.addEventListener('input', (event) => {
    const button = privacyEl('btn-delete-archive-confirm');
    if (button) button.disabled = event.target.value !== 'ELIMINA';
  });
  privacyEl('btn-delete-archive-confirm')?.addEventListener('click', confirmDeleteArchive);

  privacyEl('btn-lock-unlock')?.addEventListener('click', unlockArchive);
  privacyEl('lock-passcode')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') unlockArchive();
  });

  window.addEventListener('pointerdown', resetIdleLock, { passive: true });
  window.addEventListener('keydown', resetIdleLock);
  window.addEventListener('wheel', resetIdleLock, { passive: true });
  setupLockOnBlur();
}

function setupDiagnosticsControls() {
  const modal = privacyEl('modal-diagnostics');
  privacyEl('btn-diagnostics')?.addEventListener('click', openDiagnosticsModal);
  const close = () => closeDiagnosticsModal();
  privacyEl('btn-diagnostics-close')?.addEventListener('click', close);
  privacyEl('btn-diagnostics-ok')?.addEventListener('click', close);
  modal?.addEventListener('click', (event) => { if (event.target === modal) close(); });
  privacyEl('btn-diagnostics-refresh')?.addEventListener('click', loadDiagnostics);
  privacyEl('btn-diagnostics-copy')?.addEventListener('click', copyDiagnosticsReport);
  privacyEl('btn-diagnostics-open-logs')?.addEventListener('click', async () => {
    const result = await API.diagnosticsOpenLogs().catch((err) => ({ success: false, error: err.message }));
    if (!result?.success) privacyNote(result?.error || 'Cartella log non disponibile', 'error');
  });
  privacyEl('diagnostics-level')?.addEventListener('change', async (event) => {
    const result = await API.privacyUpdateSettings({
      diagnostics: { level: event.target.value },
    }).catch((err) => ({ success: false, error: err.message }));
    if (!result?.success) {
      privacyNote(result?.error || 'Livello log non aggiornato', 'error');
      return;
    }
    privacyNote('Livello dei log aggiornato.', 'success');
    loadDiagnostics();
  });
}

window.PrivacyUI = {
  initPrivacyLock,
  setupDiagnosticsControls,
  setupPrivacyControls,
};
