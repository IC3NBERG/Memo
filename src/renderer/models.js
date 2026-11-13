'use strict';

// ══════════════════════════════════════════════════════════════
// 11. MODELLI WHISPER (trascrizione + traduzione dormiente)
// ══════════════════════════════════════════════════════════════
const MODEL_BANNER_META = {
  transcription: {
    title: 'Modello di trascrizione richiesto',
    desc: 'Scaricamento del modello Large-v3 Turbo (≈1,5 GB)…',
  },
  translation: {
    title: 'Modello di traduzione richiesto',
    desc: 'Scaricamento del modello Medium (≈1,4 GB)…',
  },
};

function showModelBanner(kind = 'transcription') {
  const meta = MODEL_BANNER_META[kind] || MODEL_BANNER_META.transcription;
  if (UI.modelBannerTitle) UI.modelBannerTitle.textContent = meta.title;
  if (UI.modelBannerDesc) UI.modelBannerDesc.textContent = meta.desc;
  if (UI.modelProgressFill) UI.modelProgressFill.style.width = '0%';
  if (UI.modelProgressPct) UI.modelProgressPct.textContent = '0%';
  if (UI.modelIconSlot) UI.modelIconSlot.innerHTML = ICONS.download;
  UI.modelBanner?.classList.remove('hidden');
  updateBannerOffset();
}

function hideModelBanner() {
  UI.modelBanner?.classList.add('hidden');
  updateBannerOffset();
}

function updateModelProgress(kind, data) {
  if (!data) return;
  if (UI.modelProgressFill) UI.modelProgressFill.style.width = (data.percent || 0) + '%';
  if (UI.modelProgressPct) UI.modelProgressPct.textContent = (data.percent || 0) + '%';

  const mb = Math.round((data.downloaded || 0) / (1024 * 1024));
  const totalMb = Math.round((data.total || 0) / (1024 * 1024));
  const label = kind === 'translation' ? 'Medium' : 'Large-v3 Turbo';
  if (UI.modelBannerDesc) {
    UI.modelBannerDesc.textContent = totalMb > 0
      ? `Scaricamento modello ${label}: ${mb} MB / ${totalMb} MB…`
      : `Scaricamento modello ${label}: ${mb} MB…`;
  }
}

function resolveTranslationWaiters(ok) {
  const waiters = state.translationDownloadWaiters.splice(0);
  waiters.forEach(resolve => {
    try { resolve(ok); } catch (_) {}
  });
}

function resolveModelWaiters(ok) {
  const waiters = state.modelDownloadWaiters.splice(0);
  waiters.forEach(resolve => {
    try { resolve(ok); } catch (_) {}
  });
}

// Listener registrati UNA SOLA VOLTA all'avvio: nessun accumulo di handler.
function setupModelDownloadListeners() {
  API.onModelProgress((data) => {
    state.modelDownloading = true;
    updateModelProgress('transcription', data);
  });

  API.onModelDone(() => {
    state.modelReady = true;
    state.modelDownloading = false;
    hideModelBanner();
    showToast('Modello di trascrizione pronto per l\'inferenza Metal!', 'success', 4000);
    resolveModelWaiters(true);
  });

  API.onModelError((err) => {
    state.modelDownloading = false;
    if (UI.modelBannerDesc) {
      UI.modelBannerDesc.textContent = `Errore download: ${err}. Riprova più tardi.`;
    }
    updateBannerOffset();
    showToast('Errore nel download del modello: ' + err, 'error', 6000);
    resolveModelWaiters(false);
  });
}

function setupTranslationModelListeners() {
  API.onTranslationModelProgress((data) => {
    state.translationModelDownloading = true;
    updateModelProgress('translation', data);
  });

  API.onTranslationModelDone(() => {
    state.translationModelReady = true;
    state.translationModelDownloading = false;
    hideModelBanner();
    showToast('Modello di traduzione pronto: la traduzione in inglese è ora disponibile.', 'success', 4000);
    resolveTranslationWaiters(true);
  });

  API.onTranslationModelError((err) => {
    state.translationModelDownloading = false;
    if (UI.modelBannerDesc) {
      UI.modelBannerDesc.textContent = `Errore download traduzione: ${err}.`;
    }
    updateBannerOffset();
    showToast('Errore nel download del modello di traduzione: ' + err, 'error', 6000);
    resolveTranslationWaiters(false);
  });
}

function startModelDownload() {
  showModelBanner('transcription');
  state.modelDownloading = true;
  API.modelDownload();
}

// Scarica il modello di trascrizione SOLO quando serve davvero.
async function ensureTranscriptionModel() {
  if (state.modelReady) return true;

  if (state.modelDownloading) {
    return new Promise((resolve) => state.modelDownloadWaiters.push(resolve));
  }

  const ok = await confirmDialog(
    'Scaricare il modello di trascrizione?',
    'La trascrizione richiede il modello Large-v3 Turbo (≈1,5 GB). Verrà scaricato una sola volta e resterà disponibile offline. La registrazione audio funziona comunque anche senza modello.',
    'Scarica (1,5 GB)'
  );
  if (!ok) return false;

  const done = new Promise((resolve) => state.modelDownloadWaiters.push(resolve));
  startModelDownload();
  return done;
}

function downloadTranslationModel() {
  showModelBanner('translation');
  state.translationModelDownloading = true;
  API.modelDownloadTranslation();
}

// Scarica il modello di traduzione SOLO quando l'utente lo richiede davvero.
async function ensureTranslationModel() {
  if (state.translationModelReady) return true;

  // Download già in corso: attendiamo il suo esito senza duplicarlo.
  if (state.translationModelDownloading) {
    return new Promise((resolve) => state.translationDownloadWaiters.push(resolve));
  }

  const ok = await confirmDialog(
    'Scaricare il modello di traduzione?',
    'La traduzione in inglese richiede un modello dedicato (ggml-medium, ≈1,4 GB). Verrà scaricato una sola volta e resterà disponibile offline. Il modello di trascrizione non è in grado di tradurre.',
    'Scarica (1,4 GB)'
  );
  if (!ok) return false;

  const done = new Promise((resolve) => state.translationDownloadWaiters.push(resolve));
  downloadTranslationModel();
  return done;
}

// ══════════════════════════════════════════════════════════════
// 12. AUTO-UPDATER
// ══════════════════════════════════════════════════════════════

function formatUpdateSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

function setUpdateProgress(percent, indeterminate = false) {
  const wrap = UI.updateProgress;
  if (!wrap) return;
  wrap.classList.remove('hidden');
  wrap.classList.toggle('indeterminate', indeterminate);

  if (indeterminate) {
    if (UI.updateProgressPct) UI.updateProgressPct.textContent = '';
    return;
  }

  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)));
  if (UI.updateProgressFill) UI.updateProgressFill.style.width = `${pct}%`;
  if (UI.updateProgressPct) UI.updateProgressPct.textContent = `${pct}%`;
}

function setupUpdaterControls() {
  if (!API?.onUpdateStatus) return;

  UI.btnCheckUpdates?.addEventListener('click', async () => {
    showToast('Ricerca aggiornamenti...', 'info', 2000);
    try {
      const res = await API.checkForUpdates();
      if (!res.success && res.message) {
        showToast(res.message, 'info', 3000);
      } else if (!res.success && res.error) {
        showToast(`Verifica: ${res.error}`, 'error', 3500);
      }
    } catch (e) {
      showToast(`Errore: ${e.message}`, 'error', 3500);
    }
  });

  UI.btnUpdateDismiss?.addEventListener('click', () => {
    UI.updateBanner?.classList.add('hidden');
    updateBannerOffset();
  });

  UI.btnUpdateAction?.addEventListener('click', async () => {
    if (!UI.btnUpdateAction || UI.btnUpdateAction.disabled) return;
    UI.btnUpdateAction.disabled = true;
    try {
      const res = await API.restartAndInstall();
      if (res && res.success === false) {
        showToast(`Aggiornamenti: ${res.error}`, 'error', 6000);
      }
    } catch (e) {
      showToast(`Aggiornamenti: ${e.message}`, 'error', 6000);
    } finally {
      if (UI.btnUpdateAction) UI.btnUpdateAction.disabled = false;
    }
  });

  API.onUpdateStatus((info) => {
    if (!info) return;
    if (info.type === 'available') {
      UI.updateBanner?.classList.remove('hidden');
      UI.updateBanner?.classList.add('downloading');
      if (UI.updateBannerTitle) {
        UI.updateBannerTitle.textContent = info.version ? `Nuova versione v${info.version}` : 'Nuova versione disponibile';
      }
      if (UI.updateBannerText) UI.updateBannerText.textContent = info.message;
      if (UI.btnUpdateAction) UI.btnUpdateAction.classList.add('hidden');
      setUpdateProgress(0, true);
      updateBannerOffset();
      showToast(info.message, 'info', 4000);
    } else if (info.type === 'downloaded') {
      UI.updateBanner?.classList.remove('hidden');
      UI.updateBanner?.classList.remove('downloading');
      if (UI.updateBannerTitle) {
        UI.updateBannerTitle.textContent = info.version ? `Versione v${info.version} pronta` : 'Aggiornamento pronto';
      }
      if (UI.updateBannerText) UI.updateBannerText.textContent = 'Download completato. Riavvia per applicare l\'aggiornamento.';
      if (UI.btnUpdateAction) UI.btnUpdateAction.classList.remove('hidden');
      setUpdateProgress(100, false);
      updateBannerOffset();
      showToast('Aggiornamento pronto! Clicca "Riavvia e Aggiorna"', 'success', 6000);
    } else if (info.type === 'not-available') {
      showToast('Crunch è già aggiornato all\'ultima versione', 'success', 2500);
    } else if (info.type === 'error') {
      UI.updateBanner?.classList.remove('downloading');
      UI.updateProgress?.classList.add('hidden');
      showToast(`Aggiornamenti: ${info.message}`, 'error', 3500);
    }
  });

  API.onUpdateProgress?.((p) => {
    if (!p || !UI.updateBanner || UI.updateBanner.classList.contains('hidden')) return;

    UI.updateBanner.classList.add('downloading');
    const transferred = formatUpdateSize(p.transferred);
    const total = formatUpdateSize(p.total);
    if (UI.updateBannerText) {
      UI.updateBannerText.textContent = transferred && total
        ? `Scaricamento in corso · ${transferred} di ${total}`
        : 'Scaricamento in corso…';
    }
    setUpdateProgress(p.percent, false);
  });
}
