/* ══════════════════════════════════════════════════════════════
   CRUNCH — app.js
   Logica completa con icone SVG ad hoc, Trascrizione Live istantanea (3.5s),
   Verifica Trascrizione Completa al 100%, Traduzione Metal e Gruppi
   ══════════════════════════════════════════════════════════════ */

'use strict';

const ICONS = window.MEMO_ICONS || {};
const API = window.crunchAPI || window.memoAPI;

// ─── Toast Notifiche (Anti-ridondanza & Debounce) ────────────
const toastContainer = document.createElement('div');
toastContainer.id = 'toast-container';
document.body.appendChild(toastContainer);

const recentToastMessages = new Map();

function showToast(msg, type = 'info', duration = 3000) {
  if (!msg) return;
  const now = Date.now();
  // Se un messaggio identico è stato mostrato negli ultimi 3.5 secondi, evita la ridondanza
  if (recentToastMessages.has(msg) && (now - recentToastMessages.get(msg) < 3500)) {
    return;
  }
  recentToastMessages.set(msg, now);

  // Mantieni al massimo 2 toast simultanei a schermo
  while (toastContainer.children.length >= 2) {
    const oldest = toastContainer.firstElementChild;
    if (oldest) oldest.remove();
  }

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? ICONS.check : (type === 'error' ? ICONS.close : ICONS.sparkles);
  el.innerHTML = `<span class="memo-icon icon-sm">${icon || ''}</span>`;
  const textEl = document.createElement('span');
  textEl.textContent = msg;
  el.appendChild(textEl);
  toastContainer.appendChild(el);

  setTimeout(() => {
    el.classList.add('toast-exit');
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 250);
  }, duration);
}

// ─── Helpers ──────────────────────────────────────────────────
function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDuration(sec) {
  if (!sec || sec === 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const dateStr = d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
    const timeStr = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} · ${timeStr}`;
  } catch { return ''; }
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

// ─── Stato globale ────────────────────────────────────────────
const state = {
  library: { folders: [], unsorted: [] },
  searchQuery: '',
  activeRec: null,           // registrazione attiva nella vista
  transcript: null,          // trascrizione caricata
  recording: false,
  paused: false,
  recDuration: 0,
  recTimerInterval: null,
  mediaRecorder: null,
  audioChunks: [],
  audioContext: null,
  gainNode: null,
  analyserNode: null,
  compressorNode: null,
  compressorMakeupNode: null,
  highpassNode: null,
  noiseGateNode: null,
  noiseGateAnalyser: null,
  noiseGateInterval: null,
  agcNode: null,
  agcAnalyser: null,
  agcInterval: null,
  limiterNode: null,
  gateOpen: true,
  streamSource: null,
  micStream: null,
  modelReady: false,
  modelDownloading: false,
  modelDownloadWaiters: [],
  showTimestamps: false,
  playerAudio: document.getElementById('hidden-audio'),

  // Trascrizione / traduzione
  transcribing: false,
  transcriptionStarting: false,
  transcribeRecDir: null,
  translationModelReady: false,
  translationModelDownloading: false,
  translationDownloadWaiters: [],
  liveTranslationWarned: false,

  // Trascrizione Live istantanea (chunk PCM reali, non tutto l'audio accumulato)
  liveTranscriptionEnabled: false,
  liveChunkInterval: null,
  liveTextAccumulated: '',
  liveTextTranslated: false,
  liveSampleBuffer: [],
  liveSampleRate: 16000,
  liveProcessorNode: null,
  liveSilentGain: null,
  liveTranscribing: false,
  liveSamplesCaptured: 0,
  liveLastInferenceSamples: 0,
  liveWords: [],
  liveLanguage: null,
  liveEngine: null,
  // Finestra mobile: 8 s di audio con 2 s di sovrapposizione. La sovrapposizione
  // evita di tagliare le parole ai confini; il merge per timestamp elimina i duplicati.
  liveWindowSeconds: 8,
  liveOverlapSeconds: 2,
  liveTickMs: 2500,
  preAgcNode: null,
  transcriptionTranslate: false,
};

// ─── Elementi DOM ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const UI = {
  // Titlebar
  brandIconSlot:       $('brand-icon-slot'),

  // Banners
  bannerStack:         $('banner-stack'),
  modelBanner:         $('model-banner'),
  modelBannerTitle:    $('model-banner-title'),
  modelIconSlot:       $('model-icon-slot'),
  modelProgressFill:   $('model-progress-fill'),
  modelProgressPct:    $('model-progress-pct'),
  modelBannerDesc:     $('model-banner-desc'),

  updateBanner:        $('update-banner'),
  updateIconSlot:      $('update-icon-slot'),
  updateBannerTitle:   $('update-banner-title'),
  updateBannerText:    $('update-banner-text'),
  updateProgress:      $('update-progress'),
  updateProgressFill:  $('update-progress-fill'),
  updateProgressPct:   $('update-progress-pct'),
  btnUpdateAction:     $('btn-update-action'),
  btnUpdateDismiss:    $('btn-update-dismiss'),

  // Sidebar
  btnInfo:             $('btn-info'),
  iconInfoSlot:        $('icon-info-slot'),
  btnNewFolder:        $('btn-new-folder'),
  iconNewFolderSlot:   $('icon-new-folder-slot'),
  searchInput:         $('search-input'),
  searchIconSlot:      $('search-icon-slot'),
  btnClearSearch:      $('btn-clear-search'),
  libraryTree:         $('library-tree'),
  appVersionLabel:     $('app-version-label'),
  btnCheckUpdates:     $('btn-check-updates'),
  iconUpdateSlot:      $('icon-update-slot'),

  // Area centrale
  emptyState:          $('empty-state'),
  emptyIconSlot:       $('empty-icon-slot'),
  emptyRecIconSlot:    $('empty-rec-icon-slot'),
  btnEmptyNewRec:      $('btn-empty-new-rec'),
  recordingPill:       $('recording-pill'),
  recordingPillTimer:  $('recording-pill-timer'),
  recordingView:       $('recording-view'),
  recCenterTimer:      $('rec-center-timer'),
  toggleCenterLive:    $('toggle-center-live'),
  recLiveSparkIcon:    $('rec-live-spark-icon'),
  recBatteryInfoIcon:  $('rec-battery-info-icon'),
  liveTextContainer:   $('live-text-container'),
  liveStreamText:      $('live-stream-text'),
  liveOffHint:         $('live-off-hint'),
  btnCenterPause:      $('btn-center-pause'),
  centerPauseIconSlot: $('center-pause-icon-slot'),
  centerPauseText:     $('center-pause-text'),
  btnCenterStop:       $('btn-center-stop'),
  centerStopIconSlot:  $('center-stop-icon-slot'),
  transcriptView:      $('transcript-view'),

  // Toolbar trascrizione
  btnCloseNote:        $('btn-close-note'),
  iconBackSlot:        $('icon-back-slot'),
  breadcrumbFolder:    $('breadcrumb-folder'),
  recNameLabel:        $('rec-name-label'),
  toggleTimestamps:    $('toggle-timestamps'),
  iconClockSlot:       $('icon-clock-slot'),
  btnCopyAll:          $('btn-copy-all'),
  iconCopySlot:        $('icon-copy-slot'),
  btnExportTxt:        $('btn-export-txt'),
  iconTxtSlot:         $('icon-txt-slot'),
  btnExportMd:         $('btn-export-md'),
  iconMdSlot:          $('icon-md-slot'),

  // Barra controlli trascrizione
  transcribeBar:       $('transcribe-bar'),
  transcribeButtons:   $('transcribe-buttons'),
  btnTranscribeAfter:  $('btn-transcribe-after'),
  btnTranscribeText:   $('btn-transcribe-text'),
  iconTranscribeSlot:  $('icon-transcribe-slot'),
  selectTranscribeMode:$('select-transcribe-mode'),
  iconTranslateSlot:   $('icon-translate-slot'),
  transcriptStatusBadge: $('transcript-status-badge'),
  transcribeProgress:  $('transcribe-progress'),
  transcribeProgressFill: $('transcribe-progress-fill'),
  transcribeProgressPct:  $('transcribe-progress-pct'),
  transcribeStatusText:   $('transcribe-status-text'),

  // Editor trascrizione
  transcriptArea:      $('transcript-area'),
  transcriptContent:   $('transcript-content'),
  timestampsMargin:    $('timestamps-margin'),
  transcribeOverlay:   $('transcribe-overlay'),
  transcribeOverlayTitle: $('transcribe-overlay-title'),
  transcribeOverlaySub:   $('transcribe-overlay-sub'),

  // Bottom Bar (Solo REC e timer)
  btnRec:              $('btn-rec'),
  recTimer:            $('rec-timer'),
  waveformWrap:        $('waveform-wrap'),
  waveformCanvas:      $('waveform-canvas'),

  playerControls:      $('player-controls'),
  btnPlayPause:        $('btn-play-pause'),
  iconPlayerPlaySlot:  $('icon-player-play-slot'),
  playerSeek:          $('player-seek'),
  playerTime:          $('player-time'),
  playerVolume:        $('player-volume'),
  iconVolumeSlot:      $('icon-volume-slot'),

  // Preprocessing toggles
  toggleHighpass:      $('toggle-highpass'),
  toggleNoisegate:     $('toggle-noisegate'),
  toggleCompressor:    $('toggle-compressor'),
  toggleAutogain:      $('toggle-autogain'),

  // Modali
  modalFolder:         $('modal-folder'),
  modalNewFolderIconSlot: $('modal-newfolder-icon-slot'),
  inputFolderName:     $('input-folder-name'),
  btnFolderCancel:     $('btn-folder-cancel'),
  btnFolderConfirm:    $('btn-folder-confirm'),

  modalMove:           $('modal-move'),
  modalMoveIconSlot:   $('modal-move-icon-slot'),
  moveFolderList:      $('move-folder-list'),
  btnMoveCancel:       $('btn-move-cancel'),

  modalConfirm:        $('modal-confirm'),
  modalTrashIconSlot:  $('modal-trash-icon-slot'),
  confirmTitle:        $('confirm-title'),
  confirmMessage:      $('confirm-message'),
  btnConfirmCancel:    $('btn-confirm-cancel'),
  btnConfirmOk:        $('btn-confirm-ok'),

  modalSaveName:       $('modal-save-name'),
  modalRecIconSlot:    $('modal-rec-icon-slot'),
  inputRecName:        $('input-rec-name'),
  selectRecFolder:     $('select-rec-folder'),
  btnSaveCancel:       $('btn-save-cancel'),
  btnSaveConfirm:      $('btn-save-confirm'),

  modalInfo:           $('modal-info'),
  modalInfoIconSlot:   $('modal-info-icon-slot'),
  infoMicIconSlot:     $('info-mic-icon-slot'),
  infoSlidersIconSlot: $('info-sliders-icon-slot'),
  infoCpuIconSlot:     $('info-cpu-icon-slot'),
  btnInfoClose:        $('btn-info-close'),
  btnInfoOk:           $('btn-info-ok'),
};

// ══════════════════════════════════════════════════════════════
// 1. INIEZIONE ICONE SVG AD HOC
// ══════════════════════════════════════════════════════════════
function injectStaticIcons() {
  if (UI.brandIconSlot) UI.brandIconSlot.innerHTML = ICONS.mic;
  if (UI.modelIconSlot) UI.modelIconSlot.innerHTML = ICONS.cpu;
  if (UI.updateIconSlot) UI.updateIconSlot.innerHTML = ICONS.sparkles;
  if (UI.iconInfoSlot) UI.iconInfoSlot.innerHTML = ICONS.info;
  if (UI.iconNewFolderSlot) UI.iconNewFolderSlot.innerHTML = ICONS.folderPlus;
  if (UI.searchIconSlot) UI.searchIconSlot.innerHTML = ICONS.search;
  if (UI.iconUpdateSlot) UI.iconUpdateSlot.innerHTML = ICONS.refresh;

  if (UI.emptyIconSlot) UI.emptyIconSlot.innerHTML = ICONS.audioWave;
  if (UI.emptyRecIconSlot) UI.emptyRecIconSlot.innerHTML = ICONS.mic;

  // Icone vista registrazione centrale
  if (UI.recLiveSparkIcon) UI.recLiveSparkIcon.innerHTML = ICONS.sparkles;
  if (UI.recBatteryInfoIcon) UI.recBatteryInfoIcon.innerHTML = ICONS.info;
  if (UI.centerPauseIconSlot) UI.centerPauseIconSlot.innerHTML = ICONS.pause;
  if (UI.centerStopIconSlot) UI.centerStopIconSlot.innerHTML = ICONS.stop;

  if (UI.iconBackSlot) UI.iconBackSlot.innerHTML = ICONS.back;
  if (UI.iconClockSlot) UI.iconClockSlot.innerHTML = ICONS.clock;
  if (UI.iconCopySlot) UI.iconCopySlot.innerHTML = ICONS.copy;
  if (UI.iconTxtSlot) UI.iconTxtSlot.innerHTML = ICONS.download;
  if (UI.iconMdSlot) UI.iconMdSlot.innerHTML = ICONS.download;

  if (UI.iconTranscribeSlot) UI.iconTranscribeSlot.innerHTML = ICONS.sparkles;
  if (UI.iconTranslateSlot) UI.iconTranslateSlot.innerHTML = ICONS.translate;

  if (UI.iconPlayerPlaySlot) UI.iconPlayerPlaySlot.innerHTML = ICONS.play;
  if (UI.iconVolumeSlot) UI.iconVolumeSlot.innerHTML = ICONS.volume;

  if (UI.modalNewFolderIconSlot) UI.modalNewFolderIconSlot.innerHTML = ICONS.folderPlus;
  if (UI.modalMoveIconSlot) UI.modalMoveIconSlot.innerHTML = ICONS.move;
  if (UI.modalTrashIconSlot) UI.modalTrashIconSlot.innerHTML = ICONS.trash;
  if (UI.modalRecIconSlot) UI.modalRecIconSlot.innerHTML = ICONS.mic;

  if (UI.modalInfoIconSlot) UI.modalInfoIconSlot.innerHTML = ICONS.info;
  if (UI.infoMicIconSlot) UI.infoMicIconSlot.innerHTML = ICONS.mic;
  if (UI.infoSlidersIconSlot) UI.infoSlidersIconSlot.innerHTML = ICONS.sliders;
  if (UI.infoCpuIconSlot) UI.infoCpuIconSlot.innerHTML = ICONS.cpu;
}

// ══════════════════════════════════════════════════════════════
// 1b. GESTIONE VISTE, BANNER E STATO UI
// ══════════════════════════════════════════════════════════════

// Garantisce che sia visibile UNA SOLA vista centrale: elimina le sovrapposizioni.
function showMainView(view) {
  const showEmpty = view === 'empty';
  const showRecording = view === 'recording';
  const showTranscript = view === 'transcript';

  UI.emptyState.classList.toggle('hidden', !showEmpty);
  UI.recordingView?.classList.toggle('hidden', !showRecording);
  UI.transcriptView.classList.toggle('hidden', !showTranscript);

  updateRecordingPill();
}

// Pill flottante visibile quando registriamo ma stiamo guardando un'altra nota.
function updateRecordingPill() {
  if (!UI.recordingPill) return;
  const recordingViewHidden = UI.recordingView?.classList.contains('hidden') !== false;
  const shouldShow = state.recording && recordingViewHidden;
  UI.recordingPill.classList.toggle('hidden', !shouldShow);
  UI.recordingPill.classList.toggle('paused', !!state.paused);
}

// Il banner stack è fisso: misuriamo la sua altezza per non coprire l'app.
function updateBannerOffset() {
  const stack = UI.bannerStack;
  const height = stack ? stack.offsetHeight : 0;
  document.documentElement.style.setProperty('--banner-offset', `${height}px`);
}

function setPreprocTogglesEnabled(enabled) {
  [UI.toggleHighpass, UI.toggleNoisegate, UI.toggleCompressor, UI.toggleAutogain].forEach(input => {
    if (!input) return;
    input.disabled = !enabled;
    const label = input.closest('.preproc-toggle');
    if (label) {
      if (!label.dataset.originalTitle) label.dataset.originalTitle = label.title;
      label.classList.toggle('disabled', !enabled);
      label.title = enabled
        ? label.dataset.originalTitle
        : 'Preprocessing bloccato durante la registrazione: si applica dalla prossima REC';
    }
  });
}

// Confirm modale basata su Promise (riutilizzabile da download e azioni).
function confirmDialog(title, message, okLabel = 'Conferma', danger = false) {
  return new Promise((resolve) => {
    if (!UI.modalConfirm) { resolve(false); return; }

    UI.confirmTitle.textContent = title;
    UI.confirmMessage.textContent = message;
    UI.btnConfirmOk.textContent = okLabel;
    UI.btnConfirmOk.classList.toggle('btn-danger', danger);
    UI.btnConfirmOk.classList.toggle('btn-primary', !danger);
    UI.modalConfirm.classList.remove('hidden');

    const finish = (result) => {
      UI.modalConfirm.classList.add('hidden');
      UI.btnConfirmOk.onclick = null;
      UI.btnConfirmCancel.onclick = null;
      UI.modalConfirm.onclick = null;
      resolve(result);
    };

    UI.btnConfirmOk.onclick = () => finish(true);
    UI.btnConfirmCancel.onclick = () => finish(false);
    UI.modalConfirm.onclick = (e) => {
      if (e.target === UI.modalConfirm) finish(false);
    };
  });
}

function setTranscribing(active, mode = 'transcribe') {
  state.transcribing = active;

  UI.transcribeBar?.classList.toggle('transcribing', active);
  UI.transcriptArea?.classList.toggle('transcribing', active);
  UI.transcribeOverlay?.classList.toggle('hidden', !active);
  UI.btnTranscribeAfter?.classList.toggle('is-loading', active);
  if (UI.btnTranscribeAfter) UI.btnTranscribeAfter.disabled = active;

  if (active) {
    if (UI.transcribeOverlayTitle) {
      UI.transcribeOverlayTitle.textContent = mode === 'translate'
        ? 'Traduzione in corso…'
        : 'Trascrizione in corso…';
    }
    if (UI.transcribeOverlaySub) {
      UI.transcribeOverlaySub.textContent = mode === 'translate'
        ? 'Il modello di traduzione sta elaborando l’audio'
        : 'Elaborazione con GPU Metal';
    }
    if (UI.btnTranscribeText) {
      UI.btnTranscribeText.textContent = mode === 'translate' ? 'Traduzione…' : 'Trascrizione…';
    }
  } else if (UI.btnTranscribeAfter) {
    UI.btnTranscribeAfter.disabled = false;
    updateTranscriptStatusBadge();
  }
}


// ══════════════════════════════════════════════════════════════
// 2. AVVIO & SETUP
// ══════════════════════════════════════════════════════════════
async function init() {
  injectStaticIcons();
  setupResizer();
  setupRecControls();
  setupTranscriptControls();
  setupPlayerControls();
  setupModalHandlers();
  setupSearchControls();
  setupWaveform();
  setupKeyboardNavigation();
  setupUpdaterControls();
  setupModelDownloadListeners();
  setupTranslationModelListeners();

  window.addEventListener('resize', updateBannerOffset);
  updateBannerOffset();

  // Versione app
  if (API?.getVersion) {
    try {
      const ver = await API.getVersion();
      if (UI.appVersionLabel && ver) UI.appVersionLabel.textContent = `Crunch v${ver}`;
    } catch (_) {}
  }

  // Carica libreria
  await refreshLibrary();

  // Controllo modelli: nessun download automatico. I modelli restano dormienti
  // e vengono scaricati solo quando l'utente richiede trascrizione o traduzione.
  state.modelReady = await API.modelCheck();

  try {
    state.translationModelReady = await API.modelCheckTranslation();
  } catch (_) {
    state.translationModelReady = false;
  }
}

// ══════════════════════════════════════════════════════════════
// 3. NAVIGAZIONE & USCITA DA NOTA
// ══════════════════════════════════════════════════════════════
function closeActiveRecording() {
  if (!state.activeRec) return;

  // Salva eventuali modifiche
  saveTranscript();

  // Ferma player audio se in riproduzione
  if (state.playerAudio && !state.playerAudio.paused) {
    state.playerAudio.pause();
    state.playerAudio.currentTime = 0;
  }
  showPlayerOrWaveform('waveform');

  // Deseleziona visivamente nella sidebar
  document.querySelectorAll('.rec-item').forEach(el => el.classList.remove('active'));

  // Reset stato attivo
  state.activeRec = null;
  state.transcript = null;

  // Se una registrazione è in corso torniamo alla vista REC, mai alla home.
  showMainView(state.recording ? 'recording' : 'empty');

  showToast('Nota chiusa', 'info', 1500);
}

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Esc: Chiudi modal se aperto, altrimenti esci dalla nota
    if (e.key === 'Escape') {
      const openModal = document.querySelector('.modal-overlay:not(.hidden)');
      if (openModal) {
        if (openModal === UI.modalSaveName) {
          // Non chiudere silenziosamente: chiedi conferma prima di scartare
          UI.btnSaveCancel?.click();
        } else if (openModal === UI.modalConfirm) {
          UI.btnConfirmCancel?.click();
        } else {
          openModal.classList.add('hidden');
        }
        updateBannerOffset();
        return;
      }
      if (state.activeRec) {
        closeActiveRecording();
      } else if (state.recording) {
        showMainView('recording');
      }
    }
  });

  UI.btnCloseNote?.addEventListener('click', closeActiveRecording);
  UI.btnEmptyNewRec?.addEventListener('click', () => {
    if (!state.recording) startRecording();
  });
}

function setupSearchControls() {
  UI.searchInput?.addEventListener('input', () => {
    state.searchQuery = UI.searchInput.value.trim().toLowerCase();
    UI.btnClearSearch?.classList.toggle('hidden', !state.searchQuery);
    renderLibrary();
  });

  UI.btnClearSearch?.addEventListener('click', () => {
    UI.searchInput.value = '';
    state.searchQuery = '';
    UI.btnClearSearch.classList.add('hidden');
    renderLibrary();
  });
}

// ══════════════════════════════════════════════════════════════
// 4. REGISTRAZIONE & AUDIO PIPELINE
// ══════════════════════════════════════════════════════════════
function setupRecControls() {
  // Barra inferiore: REC avvia, oppure riporta alla registrazione in corso.
  UI.btnRec.addEventListener('click', () => {
    if (state.recording) {
      showMainView('recording');
      return;
    }
    startRecording();
  });

  // Pill flottante: torna alla registrazione mentre navighi le note.
  UI.recordingPill?.addEventListener('click', () => {
    if (state.recording) showMainView('recording');
  });

  // Controlli centrali durante la registrazione attiva (Pausa e Termina)
  UI.btnCenterPause?.addEventListener('click', () => {
    if (!state.recording) return;
    if (state.paused) resumeRecording();
    else pauseRecording();
  });

  UI.btnCenterStop?.addEventListener('click', () => {
    if (!state.recording) return;
    stopRecording();
  });

  // Toggle Live al centro
  UI.toggleCenterLive?.addEventListener('change', async () => {
    if (UI.toggleCenterLive.checked && !state.modelReady) {
      const ready = await ensureTranscriptionModel();
      if (!ready) {
        UI.toggleCenterLive.checked = false;
        state.liveTranscriptionEnabled = false;
        UI.liveTextContainer?.classList.add('hidden');
        UI.liveOffHint?.classList.remove('hidden');
        showToast('Trascrizione Live non attivata: modello non scaricato.', 'info', 3000);
        return;
      }
    }

    state.liveTranscriptionEnabled = UI.toggleCenterLive.checked;
    if (state.liveTranscriptionEnabled) {
      UI.liveTextContainer?.classList.remove('hidden');
      UI.liveOffHint?.classList.add('hidden');
      prewarmLiveEngine();
      if (state.recording && !state.paused) {
        startLiveTranscriptionLoop();
      }
      showToast('Trascrizione Live attiva', 'info', 2000);
    } else {
      clearInterval(state.liveChunkInterval);
      state.liveChunkInterval = null;
      state.liveSampleBuffer = [];
      state.liveSamplesCaptured = 0;
      state.liveLastInferenceSamples = 0;
      state.liveWords = [];
      state.liveTextAccumulated = '';
      state.liveLanguage = null;
      UI.liveTextContainer?.classList.add('hidden');
      UI.liveOffHint?.classList.remove('hidden');
      showToast('Trascrizione Live disattivata (risparmio batteria)', 'info', 2000);
    }
  });
}

async function startRecording() {
  if (state.recording) {
    showMainView('recording');
    return;
  }

  // Se c'è una nota aperta la salviamo e la chiudiamo: la nuova registrazione
  // non deve mai scrivere dentro la nota che stavi leggendo.
  if (state.activeRec) {
    try { await saveTranscript(); } catch (_) {}
    state.activeRec = null;
    state.transcript = null;
    document.querySelectorAll('.rec-item').forEach(el => el.classList.remove('active'));
  }

  if (state.playerAudio && !state.playerAudio.paused) {
    state.playerAudio.pause();
    state.playerAudio.currentTime = 0;
  }
  showPlayerOrWaveform('waveform');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 1 },
      },
    });

    state.micStream = stream;
    try {
      state.audioContext = new AudioContext({ sampleRate: 16000 });
    } catch (_) {
      // Fallback: alcuni device non accettano un sample rate forzato.
      state.audioContext = new AudioContext();
    }
    const source = state.audioContext.createMediaStreamSource(stream);
    state.streamSource = source;

    // Pipeline audio avanzata
    const chain = buildAudioPipeline(source);

    // Cattura PCM separata per i chunk live: evita di ri-decodificare
    // l'intera registrazione a ogni intervallo. Preleva prima dell'AGC.
    await setupLiveAudioCapture(state.preAgcNode || chain);

    // Analyser per Waveform
    state.analyserNode = state.audioContext.createAnalyser();
    state.analyserNode.fftSize = 256;
    chain.connect(state.analyserNode);

    // Destination per MediaRecorder
    const dest = state.audioContext.createMediaStreamDestination();
    chain.connect(dest);

    state.mediaRecorder = new MediaRecorder(dest.stream, {
      mimeType: 'audio/webm;codecs=opus',
    });
    state.audioChunks = [];

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };

    state.mediaRecorder.start(100);

    state.recording = true;
    state.paused = false;
    state.recDuration = 0;
    state.liveSampleBuffer = [];
    state.liveTextAccumulated = '';
    state.liveTextTranslated = false;
    state.liveTranscribing = false;
    state.liveSamplesCaptured = 0;
    state.liveLastInferenceSamples = 0;
    state.liveWords = [];
    state.liveLanguage = null;
    state.liveEngine = null;

    // Mostra la vista centrale di registrazione (una sola vista alla volta)
    showMainView('recording');
    setPreprocTogglesEnabled(false);

    UI.btnRec.classList.add('recording');
    if (UI.recCenterTimer) UI.recCenterTimer.textContent = '00:00:00';
    if (UI.recTimer) UI.recTimer.textContent = '00:00:00';
    if (UI.recordingPillTimer) UI.recordingPillTimer.textContent = '00:00:00';
    if (UI.centerPauseText) UI.centerPauseText.textContent = 'Pausa';
    if (UI.centerPauseIconSlot) UI.centerPauseIconSlot.innerHTML = ICONS.pause;

    if (UI.liveStreamText) {
      UI.liveStreamText.innerHTML = '<span class="live-placeholder-text">In ascolto della voce…</span>';
    }

    startTimer();
    drawWaveform();

    // Se il toggle live è abilitato, avvia il loop rapido
    if (UI.toggleCenterLive?.checked) {
      state.liveTranscriptionEnabled = true;
      UI.liveTextContainer?.classList.remove('hidden');
      UI.liveOffHint?.classList.add('hidden');
      prewarmLiveEngine();
      startLiveTranscriptionLoop();
    } else {
      state.liveTranscriptionEnabled = false;
      UI.liveTextContainer?.classList.add('hidden');
      UI.liveOffHint?.classList.remove('hidden');
    }

    showToast('Registrazione avviata', 'info', 1500);
  } catch (err) {
    cleanupLiveAudioCapture();
    cleanupAudioPipeline();
    setPreprocTogglesEnabled(true);
    if (state.micStream) {
      state.micStream.getTracks().forEach(t => t.stop());
      state.micStream = null;
    }
    if (state.audioContext) {
      try { state.audioContext.close(); } catch (_) {}
      state.audioContext = null;
    }
    showMainView('empty');
    showToast('Errore microfono: ' + err.message, 'error', 4000);
  }
}

function buildAudioPipeline(sourceNode) {
  const ctx = state.audioContext;
  let node = sourceNode;

  // Reset riferimenti (evita nodi stantii tra una REC e l'altra)
  state.highpassNode = null;
  state.compressorNode = null;
  state.compressorMakeupNode = null;
  state.noiseGateNode = null;
  state.noiseGateAnalyser = null;
  state.noiseGateInterval = null;
  state.agcNode = null;
  state.agcAnalyser = null;
  state.agcInterval = null;
  state.limiterNode = null;
  state.preAgcNode = null;
  state.gateOpen = true;

  // 1. Filtro passa-alto (80 Hz, Butterworth Q=0.707)
  if (UI.toggleHighpass.checked) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 80;
    hp.Q.value = 0.707;
    node.connect(hp);
    node = hp;
    state.highpassNode = hp;
  }

  // 2. Noise gate (-45 dB) con isteresi, hold e attenuazione morbida
  if (UI.toggleNoisegate.checked) {
    const gateAnalyser = ctx.createAnalyser();
    gateAnalyser.fftSize = 1024;
    gateAnalyser.smoothingTimeConstant = 0.2;
    const gateGain = ctx.createGain();
    gateGain.gain.value = 1;

    // L'AnalyserNode lascia passare il segnale: analizza e poi va al gain
    node.connect(gateAnalyser);
    gateAnalyser.connect(gateGain);

    const timeData = new Float32Array(gateAnalyser.fftSize);
    const OPEN_THRESHOLD = Math.pow(10, -42 / 20);   // isteresi superiore
    const CLOSE_THRESHOLD = Math.pow(10, -50 / 20);  // isteresi inferiore
    const FLOOR_GAIN = Math.pow(10, -60 / 20);       // −60 dB, non zero
    const HOLD_MS = 250;
    let lastSpeechAt = performance.now();
    let gateOpen = true;

    const gateInterval = setInterval(() => {
      if (state.paused) return;

      gateAnalyser.getFloatTimeDomainData(timeData);
      let sum = 0;
      for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
      const rms = Math.sqrt(sum / timeData.length);
      const nowMs = performance.now();

      if (rms >= OPEN_THRESHOLD) {
        gateOpen = true;
        lastSpeechAt = nowMs;
      } else if (gateOpen && rms <= CLOSE_THRESHOLD && nowMs - lastSpeechAt > HOLD_MS) {
        gateOpen = false;
      }

      state.gateOpen = gateOpen;
      gateGain.gain.setTargetAtTime(
        gateOpen ? 1 : FLOOR_GAIN,
        ctx.currentTime,
        gateOpen ? 0.005 : 0.12
      );
    }, 20);

    state.noiseGateNode = gateGain;
    state.noiseGateAnalyser = gateAnalyser;
    state.noiseGateInterval = gateInterval;
    node = gateGain;
  }

  // 3. Compressore dinamico + makeup gain
  if (UI.toggleCompressor.checked) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -28;
    comp.knee.value = 18;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.22;
    node.connect(comp);

    const makeup = ctx.createGain();
    makeup.gain.value = 1.4; // ≈ +3 dB
    comp.connect(makeup);

    node = makeup;
    state.compressorNode = comp;
    state.compressorMakeupNode = makeup;
  }

  // Punto di prelievo per la live: prima dell'AGC, così la soglia del
  // silenzio misura il segnale reale e non il rumore già amplificato.
  state.preAgcNode = node;

  // 4. Auto-Gain reale (AGC): misura l'RMS e regola il guadagno nel tempo
  if (UI.toggleAutogain.checked) {
    const agcAnalyser = ctx.createAnalyser();
    agcAnalyser.fftSize = 2048;
    agcAnalyser.smoothingTimeConstant = 0.3;
    const agcGain = ctx.createGain();
    agcGain.gain.value = 1;

    node.connect(agcAnalyser);
    agcAnalyser.connect(agcGain);

    const timeData = new Float32Array(agcAnalyser.fftSize);
    const TARGET_RMS = Math.pow(10, -20 / 20); // −20 dBFS
    const MIN_GAIN = 0.5;
    const MAX_GAIN = 8;
    let currentGain = 1;

    const agcInterval = setInterval(() => {
      if (state.paused || !state.gateOpen) return;

      agcAnalyser.getFloatTimeDomainData(timeData);
      let sum = 0;
      for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
      const rms = Math.sqrt(sum / timeData.length);

      // Non amplificare il silenzio o il solo rumore di fondo.
      if (rms < Math.pow(10, -45 / 20)) return;

      const desired = Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET_RMS / Math.max(rms, 1e-4)));
      // Riduzione rapida per evitare picchi, aumento lento per non pompare.
      const factor = desired < currentGain ? 0.35 : 0.12;
      currentGain = currentGain + (desired - currentGain) * factor;
      currentGain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, currentGain));
      agcGain.gain.setTargetAtTime(currentGain, ctx.currentTime, 0.15);
    }, 100);

    state.agcNode = agcGain;
    state.agcAnalyser = agcAnalyser;
    state.agcInterval = agcInterval;
    node = agcGain;
  }

  // 5. Limiter finale: garantisce che il segnale non saturi mai
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.06;
  node.connect(limiter);
  node = limiter;
  state.limiterNode = limiter;

  return node;
}

function cleanupAudioPipeline() {
  if (state.noiseGateInterval) {
    clearInterval(state.noiseGateInterval);
    state.noiseGateInterval = null;
  }
  if (state.agcInterval) {
    clearInterval(state.agcInterval);
    state.agcInterval = null;
  }

  const nodes = [
    state.noiseGateAnalyser,
    state.noiseGateNode,
    state.compressorNode,
    state.compressorMakeupNode,
    state.agcAnalyser,
    state.agcNode,
    state.limiterNode,
    state.highpassNode,
  ];

  nodes.forEach(node => {
    if (!node) return;
    try { node.disconnect(); } catch (_) {}
  });

  state.noiseGateAnalyser = null;
  state.noiseGateNode = null;
  state.compressorNode = null;
  state.compressorMakeupNode = null;
  state.agcAnalyser = null;
  state.agcNode = null;
  state.limiterNode = null;
  state.highpassNode = null;
  state.gateOpen = true;
}

// Cattura PCM in tempo reale per la trascrizione live. Usa un AudioWorklet
// (thread audio dedicato) e ripiega su ScriptProcessor solo se non disponibile.
function appendLiveSamples(samples) {
  if (!state.liveTranscriptionEnabled || !state.recording || state.paused) return;
  state.liveSampleBuffer.push(samples);
  state.liveSamplesCaptured += samples.length;
  trimLiveSampleBuffer();
}

function trimLiveSampleBuffer() {
  const sr = state.liveSampleRate || 16000;
  const maxSamples = Math.round((state.liveWindowSeconds + 2) * sr);
  let total = 0;
  for (const chunk of state.liveSampleBuffer) total += chunk.length;

  while (total > maxSamples && state.liveSampleBuffer.length) {
    const first = state.liveSampleBuffer[0];
    const excess = total - maxSamples;
    if (first.length <= excess) {
      state.liveSampleBuffer.shift();
      total -= first.length;
    } else {
      state.liveSampleBuffer[0] = first.subarray(excess);
      total -= excess;
    }
  }
}

const LIVE_WORKLET_SOURCE = `
class LiveCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel && channel.length) {
      const copy = new Float32Array(channel);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('live-capture', LiveCaptureProcessor);
`;

async function createLiveWorkletNode(ctx) {
  const candidates = [];
  try {
    candidates.push(new URL('live-capture-worklet.js', window.location.href).href);
  } catch (_) {}
  try {
    candidates.push(URL.createObjectURL(new Blob([LIVE_WORKLET_SOURCE], {
      type: 'application/javascript',
    })));
  } catch (_) {}

  for (const url of candidates) {
    try {
      await ctx.audioWorklet.addModule(url);
      return new AudioWorkletNode(ctx, 'live-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
    } catch (_) {}
  }
  return null;
}

async function setupLiveAudioCapture(chain) {
  const ctx = state.audioContext;
  state.liveSampleRate = ctx.sampleRate;

  let node = await createLiveWorkletNode(ctx);
  if (node) {
    node.port.onmessage = (e) => appendLiveSamples(new Float32Array(e.data));
  } else {
    // Fallback per contesti in cui AudioWorklet non è disponibile.
    node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      appendLiveSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
  }

  // Un nodo di cattura elabora solo se collegato alla destinazione:
  // il gain a 0 evita eco o doppio audio.
  const silentGain = ctx.createGain();
  silentGain.gain.value = 0;
  chain.connect(node);
  node.connect(silentGain);
  silentGain.connect(ctx.destination);

  state.liveProcessorNode = node;
  state.liveSilentGain = silentGain;
}

function cleanupLiveAudioCapture() {
  if (state.liveProcessorNode) {
    try { state.liveProcessorNode.port.onmessage = null; } catch (_) {}
    try { state.liveProcessorNode.onaudioprocess = null; } catch (_) {}
    try { state.liveProcessorNode.disconnect(); } catch (_) {}
    state.liveProcessorNode = null;
  }
  if (state.liveSilentGain) {
    try { state.liveSilentGain.disconnect(); } catch (_) {}
    state.liveSilentGain = null;
  }
  state.liveSampleBuffer = [];
}

function pauseRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    state.mediaRecorder.pause();
    state.paused = true;
    clearInterval(state.recTimerInterval);
    clearInterval(state.liveChunkInterval);
    state.liveChunkInterval = null;
    // Non azzeriamo il buffer: alla ripresa la finestra resta continua
    // e il merge per timestamp evita duplicati.
    UI.btnRec.classList.remove('recording');
    updateRecordingPill();

    if (UI.centerPauseText) UI.centerPauseText.textContent = 'Riprendi';
    if (UI.centerPauseIconSlot) UI.centerPauseIconSlot.innerHTML = ICONS.play;

    showToast('Registrazione in pausa', 'info', 1500);
  }
}

function resumeRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === 'paused') {
    state.mediaRecorder.resume();
    state.paused = false;
    startTimer();
    if (state.liveTranscriptionEnabled) {
      startLiveTranscriptionLoop();
    }
    UI.btnRec.classList.add('recording');
    updateRecordingPill();

    if (UI.centerPauseText) UI.centerPauseText.textContent = 'Pausa';
    if (UI.centerPauseIconSlot) UI.centerPauseIconSlot.innerHTML = ICONS.pause;

    showToast('Registrazione ripresa', 'info', 1500);
  }
}

function stopRecording() {
  return new Promise((resolve) => {
    clearInterval(state.recTimerInterval);
    clearInterval(state.liveChunkInterval);
    state.liveChunkInterval = null;
    state.recording = false;
    state.paused = false;
    state.gateOpen = true;

    UI.btnRec.classList.remove('recording');
    if (UI.centerPauseText) UI.centerPauseText.textContent = 'Pausa';
    if (UI.centerPauseIconSlot) UI.centerPauseIconSlot.innerHTML = ICONS.pause;

    setPreprocTogglesEnabled(true);
    showMainView(state.activeRec ? 'transcript' : 'empty');

    // Il cleanup avviene DOPO onstop: altrimenti l'ultimo chunk audio
    // prodotto da MediaRecorder andrebbe perso.
    const finalize = async () => {
      cleanupLiveAudioCapture();
      cleanupAudioPipeline();

      if (state.micStream) {
        state.micStream.getTracks().forEach(t => t.stop());
        state.micStream = null;
      }
      if (state.audioContext) {
        try { await state.audioContext.close(); } catch (_) {}
        state.audioContext = null;
      }

      await saveRecording();
      resolve();
    };

    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.onstop = finalize;
      state.mediaRecorder.stop();
    } else {
      finalize();
    }
  });
}

async function saveRecording() {
  if (state.audioChunks.length === 0) {
    showToast('Nessun audio registrato', 'error', 3000);
    showMainView(state.activeRec ? 'transcript' : 'empty');
    return;
  }

  try {
    const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    const wavBuffer = await convertToWav(arrayBuffer);

    showSaveNameModal(wavBuffer);
  } catch (err) {
    showToast('Errore nel salvataggio: ' + err.message, 'error', 4000);
  }
}

async function convertToWav(webmBuffer) {
  const tmpCtx = new AudioContext({ sampleRate: 16000 });
  const decoded = await tmpCtx.decodeAudioData(webmBuffer.slice(0));
  await tmpCtx.close();

  return encodeWav(decoded.getChannelData(0), decoded.sampleRate);
}

// Converte campioni Float32 in un WAV PCM 16 bit mono
function encodeWav(samples, sampleRate) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;

  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return buffer;
}

function showSaveNameModal(wavBuffer) {
  UI.selectRecFolder.innerHTML = '<option value="">— Nessun gruppo —</option>';
  state.library.folders.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.name;
    opt.textContent = f.name;
    UI.selectRecFolder.appendChild(opt);
  });

  UI.inputRecName.value = '';
  UI.modalSaveName.classList.remove('hidden');
  UI.inputRecName.focus();

  let saving = false;

  const resetRecordingState = () => {
    UI.modalSaveName.classList.add('hidden');
    showPlayerOrWaveform('waveform');
    UI.recTimer.textContent = '00:00:00';
    state.recDuration = 0;
    state.audioChunks = [];
    state.liveTextAccumulated = '';
    state.liveTextTranslated = false;
  };

  const restoreMainView = () => {
    if (state.activeRec) {
      showMainView('transcript');
      if (state.playerAudio?.getAttribute('src')) {
        showPlayerOrWaveform('player');
      }
    } else {
      showMainView(state.recording ? 'recording' : 'empty');
    }
  };

  const cancel = () => {
    if (saving) return;
    showConfirmModal(
      'Scartare la registrazione?',
      'La registrazione non è ancora stata salvata. Se continui verrà persa definitivamente.',
      () => {
        resetRecordingState();
        restoreMainView();
        showToast('Registrazione scartata', 'info', 2000);
      }
    );
  };

  const save = async () => {
    if (saving) return;

    const name = UI.inputRecName.value.trim() || 'Lezione';
    const folder = UI.selectRecFolder.value || null;

    saving = true;
    UI.btnSaveConfirm.disabled = true;

    try {
      const result = await API.recordingSave({
        buffer: wavBuffer,
        name,
        folder,
      });

      if (!result.success) {
        // Non chiudere la modale: l'utente può riprovare senza perdere l'audio
        showToast('Errore salvataggio: ' + result.error, 'error', 4000);
        return;
      }

      await API.recordingUpdateDuration({
        recDir: result.recDir,
        duration: state.recDuration,
      });

      // Se c'era del testo accumulato dalla trascrizione live, salvalo come anteprima parziale
      if (state.liveTextAccumulated) {
        const transcriptObj = {
          segments: [{ start: 0, end: state.recDuration, text: state.liveTextAccumulated }],
          text: state.liveTextAccumulated
        };
        await API.transcriptSave({
          recDir: result.recDir,
          transcript: transcriptObj,
          isLivePreview: true,
          isTranslated: state.liveTextTranslated,
        });
      }

      showToast(`Registrazione salvata: ${name}`, 'success', 2500);
      await refreshLibrary();

      // Apri automaticamente la registrazione appena salvata
      const library = state.library;
      let saved = library.unsorted.find(r => r.recDir === result.recDir);
      if (!saved) {
        for (const f of library.folders) {
          const found = f.recordings.find(r => r.recDir === result.recDir);
          if (found) { saved = found; break; }
        }
      }

      resetRecordingState();
      if (saved) {
        openRecording(saved);
      } else {
        restoreMainView();
      }
    } catch (err) {
      showToast('Errore nel salvataggio: ' + err.message, 'error', 4000);
    } finally {
      saving = false;
      UI.btnSaveConfirm.disabled = false;
    }
  };

  UI.btnSaveConfirm.onclick = save;
  UI.inputRecName.onkeydown = (e) => { if (e.key === 'Enter') save(); };
  UI.btnSaveCancel.onclick = cancel;
  UI.modalSaveName.onclick = (e) => {
    if (e.target === UI.modalSaveName) cancel();
  };
}

// ─── Timer registrazione ──────────────────────────────────────
function startTimer() {
  state.recTimerInterval = setInterval(() => {
    state.recDuration++;
    const h = Math.floor(state.recDuration / 3600);
    const m = Math.floor((state.recDuration % 3600) / 60);
    const s = state.recDuration % 60;
    const timeStr = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    if (UI.recTimer) UI.recTimer.textContent = timeStr;
    if (UI.recCenterTimer) UI.recCenterTimer.textContent = timeStr;
    if (UI.recordingPillTimer) UI.recordingPillTimer.textContent = timeStr;
  }, 1000);
}

// ─── Waveform ─────────────────────────────────────────────────
function setupWaveform() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const canvas = UI.waveformCanvas;
  const wrap = canvas?.parentElement;
  if (!canvas || !wrap) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, wrap.offsetWidth);
  const h = Math.max(1, wrap.offsetHeight);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  if (!state.recording) paintIdleWaveform();
}

// Linea di riposo: traccia sottile e sfumata al centro della barra.
function paintIdleWaveform() {
  const canvas = UI.waveformCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const dpr = window.devicePixelRatio || 1;

  ctx.clearRect(0, 0, W, H);

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(232, 168, 73, 0)');
  grad.addColorStop(0.5, 'rgba(232, 168, 73, 0.34)');
  grad.addColorStop(1, 'rgba(232, 168, 73, 0)');

  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineCap = 'round';
  ctx.setLineDash([2 * dpr, 7 * dpr]);
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawWaveform() {
  const canvas = UI.waveformCanvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const analyser = state.analyserNode;

  if (!analyser || !state.recording) {
    paintIdleWaveform();
    return;
  }

  requestAnimationFrame(drawWaveform);

  const bufLen = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufLen);
  analyser.getByteTimeDomainData(dataArray);

  ctx.clearRect(0, 0, W, H);

  const dpr = window.devicePixelRatio || 1;
  const mid = H / 2;
  const sliceWidth = W / bufLen;
  const points = new Array(bufLen);

  for (let i = 0; i < bufLen; i++) {
    const v = (dataArray[i] - 128) / 128;
    points[i] = { x: i * sliceWidth, y: mid + v * mid * 0.78 };
  }

  // Nastro simmetrico: dà corpo all'onda senza appesantirla.
  const fill = ctx.createLinearGradient(0, 0, 0, H);
  fill.addColorStop(0, 'rgba(232, 168, 73, 0.20)');
  fill.addColorStop(0.5, 'rgba(232, 168, 73, 0.04)');
  fill.addColorStop(1, 'rgba(232, 168, 73, 0.20)');
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < bufLen; i++) ctx.lineTo(points[i].x, points[i].y);
  for (let i = bufLen - 1; i >= 0; i--) ctx.lineTo(points[i].x, H - points[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#D4723C');
  grad.addColorStop(0.5, '#F3C476');
  grad.addColorStop(1, '#D4723C');

  ctx.lineWidth = 1.8 * dpr;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = grad;
  ctx.shadowColor = 'rgba(232, 168, 73, 0.7)';
  ctx.shadowBlur = 8 * dpr;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < bufLen; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ══════════════════════════════════════════════════════════════
// 5. TRASCRIZIONE & TRASCRIZIONE LIVE ISTANTANEA
// ══════════════════════════════════════════════════════════════
function setupTranscriptControls() {
  // Trascrizione / Traduzione nota attiva
  UI.btnTranscribeAfter?.addEventListener('click', () => {
    if (!state.activeRec) return;
    const mode = UI.selectTranscribeMode?.value || 'transcribe'; // 'transcribe' | 'translate'
    startTranscription(state.activeRec, mode === 'translate');
  });

  UI.toggleTimestamps?.addEventListener('change', () => {
    state.showTimestamps = UI.toggleTimestamps.checked;
    renderTranscript();
  });

  UI.btnCopyAll?.addEventListener('click', () => {
    const text = UI.transcriptContent?.innerText.trim();
    if (!text) { showToast('Nessun testo da copiare', 'info', 1500); return; }
    navigator.clipboard.writeText(text).then(() => showToast('Testo copiato negli appunti!', 'success', 1500));
  });

  UI.btnExportTxt?.addEventListener('click', () => exportTranscript('txt'));
  UI.btnExportMd?.addEventListener('click', () => exportTranscript('md'));

  // Auto-salvataggio testo modificato
  let saveTimeout;
  UI.transcriptContent?.addEventListener('input', () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveTranscript(), 1500);
  });

  // Registrazione dei listener IPC UNA SOLA VOLTA all'avvio dell'app
  API.onTranscriptionProgress((pct) => {
    UI.transcribeProgress?.classList.remove('indeterminate');
    if (UI.transcribeProgressFill) UI.transcribeProgressFill.style.width = pct + '%';
    if (UI.transcribeProgressPct) UI.transcribeProgressPct.textContent = pct + '%';
  });

  API.onTranscriptionDone((payload) => {
    // Retrocompatibilità: il main ora invia { recDir, transcript, translate }
    const transcript = payload?.transcript || payload;
    const completedRecDir = payload?.recDir;
    const isForActive = state.activeRec &&
      (!completedRecDir || state.activeRec.recDir === completedRecDir);

    UI.transcribeProgress?.classList.add('hidden');
    UI.transcribeButtons?.classList.remove('hidden');
    UI.transcribeProgress?.classList.remove('indeterminate');

    const isTranslate = typeof payload?.translate === 'boolean'
      ? payload.translate
      : state.transcriptionTranslate;

    setTranscribing(false);
    state.transcribeRecDir = null;

    if (isForActive) {
      state.transcript = transcript;
      state.activeRec.hasTranscript = true;
      state.activeRec.isCompleteTranscript = true;
      state.activeRec.isLivePreview = false;
      state.activeRec.isTranslated = isTranslate;

      updateTranscriptStatusBadge();
      renderTranscript();
    }

    refreshLibrary();
    showToast(isTranslate ? 'Traduzione in inglese completata al 100%!' : 'Trascrizione integrale completata al 100%!', 'success', 3000);
  });

  API.onTranscriptionError((err) => {
    UI.transcribeProgress?.classList.add('hidden');
    UI.transcribeButtons?.classList.remove('hidden');
    UI.transcribeProgress?.classList.remove('indeterminate');
    setTranscribing(false);
    state.transcribeRecDir = null;

    const message = typeof err === 'string' ? err : (err?.message || 'Errore sconosciuto');
    const code = typeof err === 'object' ? err?.code : null;

    if (code === 'translation-model-missing') {
      state.translationModelReady = false;
      showToast('Modello di traduzione non disponibile: avvia di nuovo la traduzione per scaricarlo.', 'info', 5000);
      return;
    }

    showToast('Errore trascrizione: ' + message, 'error', 5000);
  });
}

// Precarica il modello live (whisper-server) senza bloccare la registrazione.
function prewarmLiveEngine() {
  if (!state.modelReady) return;
  const translate = UI.selectTranscribeMode?.value === 'translate' && state.translationModelReady;
  API.transcriptionPrewarm?.({ translate }).catch?.(() => {});
}

// Loop di trascrizione live: finestra mobile di 8 s con 2 s di sovrapposizione.
// Il primo feedback arriva dopo 3,5 s; a regime avanza di 6 s per volta.
function startLiveTranscriptionLoop() {
  clearInterval(state.liveChunkInterval);
  state.liveChunkInterval = null;

  const sr = state.liveSampleRate || 16000;
  const minFirstSamples = Math.round(3.5 * sr);
  const fullWindowSamples = Math.round(state.liveWindowSeconds * sr);
  const steadyStepSamples = Math.round(
    Math.max(1, state.liveWindowSeconds - (state.liveOverlapSeconds || 2)) * sr
  );
  const earlyStepSamples = Math.round(2 * sr);

  const runChunk = async () => {
    if (!state.recording || state.paused || state.liveTranscribing) return;

    const captured = state.liveSamplesCaptured;
    if (captured < minFirstSamples) return;

    // Prima che la finestra sia piena aggiorna spesso (feedback rapido);
    // a regime avanza di finestra−overlap per non ricalcolare troppo.
    const requiredNew = captured >= fullWindowSamples ? steadyStepSamples : earlyStepSamples;
    if (state.liveLastInferenceSamples &&
        captured - state.liveLastInferenceSamples < requiredNew) return;

    const windowSamples = Math.min(captured, Math.round(state.liveWindowSeconds * sr));
    const samples = AudioDSP.collectLiveWindow(state.liveSampleBuffer, windowSamples);
    if (!samples) return;
    const windowStart = Math.max(0, (captured - samples.length) / sr);

    // VAD sul segnale pre-AGC: scarta silenzio e rumore di fondo prima di Whisper.
    const level = AudioDSP.measureRms(samples);
    const silenceFloor = Math.pow(10, -45 / 20);
    if (level < silenceFloor || (state.gateOpen === false && level < Math.pow(10, -38 / 20))) {
      state.liveLastInferenceSamples = captured;
      return;
    }

    // Il taglio dei bordi sposta l'inizio del parlato: l'offset va sommato
    // ai timestamp restituiti da Whisper, altrimenti le parole slittano.
    const trimmed = AudioDSP.trimSilence(samples, state.liveSampleRate || 16000);
    const prepared = AudioDSP.normalizeForWhisper(trimmed.samples);
    if (!prepared || prepared.length < Math.round(0.5 * sr)) {
      state.liveLastInferenceSamples = captured;
      return;
    }
    const speechStart = windowStart + trimmed.offsetSamples / sr;

    const wantsTranslate = UI.selectTranscribeMode?.value === 'translate';
    const isTranslate = wantsTranslate && state.translationModelReady;
    let translatedThisChunk = isTranslate;
    if (wantsTranslate && !state.translationModelReady && !state.liveTranslationWarned) {
      state.liveTranslationWarned = true;
      showToast('Traduzione live non disponibile: il modello di traduzione non è ancora scaricato. Registro in lingua originale.', 'info', 5000);
    }

    // Contesto breve: aiuta la continuità di nomi e termini tra un chunk e l'altro.
    // In traduzione il testo accumulato è inglese: non va usato come prompt
    // per l'audio italiano, quindi lo si omette.
    const prompt = isTranslate ? '' : state.liveTextAccumulated.slice(-200).trim();

    state.liveTranscribing = true;
    try {
      const wavBuffer = encodeWav(prepared, sr);

      let res = await API.transcriptionChunk({
        buffer: wavBuffer,
        language: state.liveLanguage || 'auto',
        translate: isTranslate,
        prompt,
      });

      // Se il modello di traduzione non c'è, ripieghiamo sulla trascrizione
      // originale invece di perdere il chunk.
      if (!res.success && res.code === 'translation-model-missing') {
        state.translationModelReady = false;
        translatedThisChunk = false;
        res = await API.transcriptionChunk({
          buffer: wavBuffer,
          language: state.liveLanguage || 'auto',
          translate: false,
          prompt,
        });
        if (!state.liveTranslationWarned) {
          state.liveTranslationWarned = true;
          showToast('Modello di traduzione assente: anteprima live in lingua originale.', 'info', 5000);
        }
      }

      // Se la registrazione è terminata nel frattempo, non sporcare la nota
      if (!state.recording) return;

      if (res.success) {
        // Blocca la lingua dopo il primo rilevamento: evita che chunk brevi
        // vengano interpretati in una lingua diversa.
        if (!state.liveLanguage && res.language && res.language !== 'auto') {
          state.liveLanguage = res.language;
        }
        state.liveEngine = res.engine || state.liveEngine;
        mergeLiveResult(res, speechStart, translatedThisChunk);
      }
    } catch (_) {
    } finally {
      state.liveTranscribing = false;
      state.liveLastInferenceSamples = captured;
    }
  };

  state.liveChunkInterval = setInterval(runChunk, state.liveTickMs || 2500);
  runChunk();
}

// Unisce il risultato del chunk alla trascrizione live usando i timestamp:
// le parole nella zona di sovrapposizione vengono sostituite, non duplicate.
function mergeLiveResult(res, windowStart, translated) {
  const cutoff = Math.max(0, windowStart - 0.25);
  const incoming = [];

  for (const seg of res.segments || []) {
    const segStart = Number(seg.start || 0);
    const segEnd = Number(seg.end || 0);
    const segWords = Array.isArray(seg.words) && seg.words.length
      ? seg.words
      : [{ start: segStart, end: segEnd, text: seg.text }];

    for (const word of segWords) {
      const text = String(word.text || '').trim();
      if (!text || /^\[_[^\]]*\]$/.test(text)) continue;
      const start = windowStart + Number(word.start || 0);
      if (start < cutoff) continue;
      incoming.push({
        start,
        end: windowStart + Number(word.end || 0),
        text,
      });
    }
  }

  if (!incoming.length && res.text) {
    incoming.push({ start: windowStart, end: windowStart, text: res.text.trim() });
  }

  const kept = state.liveWords.filter((w) => w.start < cutoff);
  const merged = kept.concat(incoming).sort((a, b) => a.start - b.start || a.end - b.end);

  // Deduplica parole identiche consecutive ai confini di chunk.
  const deduped = [];
  for (const word of merged) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.text.toLowerCase() === word.text.toLowerCase()) {
      prev.end = Math.max(prev.end, word.end);
      continue;
    }
    deduped.push(word);
  }

  state.liveWords = deduped;
  state.liveTextAccumulated = deduped
    .map((w) => w.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
  state.liveTextTranslated = translated;

  // Aggiorna SOLO l'anteprima live della vista registrazione.
  // Mai il testo di una nota aperta in parallelo.
  if (UI.liveStreamText) {
    UI.liveStreamText.textContent = state.liveTextAccumulated || 'In ascolto della voce…';
    UI.liveStreamText.scrollTop = UI.liveStreamText.scrollHeight;
    UI.liveStreamText.classList.add('live-typing');
  }
}

async function startTranscription(rec, isTranslate = false) {
  if (!rec || !rec.recDir) return;
  if (state.transcribing || state.transcriptionStarting) {
    if (state.transcribing) showToast('Una trascrizione è già in corso. Attendi che termini.', 'info', 3000);
    return;
  }

  state.transcriptionStarting = true;

  try {
    // La traduzione richiede il modello dedicato: lo scarichiamo SOLO ora,
    // quando l'utente la richiede esplicitamente (modello dormiente).
    if (isTranslate) {
      const ready = await ensureTranslationModel();
      if (!ready) {
        showToast('Traduzione annullata: serve il modello di traduzione.', 'info', 3500);
        return;
      }
    } else {
      const ready = await ensureTranscriptionModel();
      if (!ready) {
        showToast('Trascrizione annullata: serve il modello di trascrizione.', 'info', 3500);
        return;
      }
    }

    // Se durante l'attesa del download l'utente ha chiuso o cambiato nota,
    // non avviare l'elaborazione sulla nota sbagliata.
    if (!state.activeRec || state.activeRec.recDir !== rec.recDir) return;

    state.transcriptionTranslate = isTranslate;
    state.transcribeRecDir = rec.recDir;

    setTranscribing(true, isTranslate ? 'translate' : 'transcribe');

    UI.transcribeButtons?.classList.add('hidden');
    UI.transcribeProgress?.classList.remove('hidden');
    UI.transcribeProgress?.classList.remove('indeterminate');
    if (UI.transcribeProgressFill) UI.transcribeProgressFill.style.width = '0%';
    if (UI.transcribeProgressPct) UI.transcribeProgressPct.textContent = '0%';
    if (UI.transcribeStatusText) {
      UI.transcribeStatusText.textContent = isTranslate
        ? 'Traduzione in corso con GPU Metal…'
        : 'Decodifica integrale 100% con GPU Metal…';
    }

    API.transcriptionStart({
      audioPath: rec.audioPath,
      recDir: rec.recDir,
      language: 'auto',
      translate: isTranslate,
    });
  } finally {
    state.transcriptionStarting = false;
  }
}

function updateTranscriptStatusBadge() {
  if (!UI.transcriptStatusBadge) return;
  const rec = state.activeRec;

  // Durante l'elaborazione il testo del pulsante è gestito da setTranscribing.
  if (!state.transcribing) {
    UI.btnTranscribeAfter?.classList.remove('is-loading');
  }

  if (!rec || !rec.hasTranscript) {
    UI.transcriptStatusBadge.className = 'transcript-status-badge hidden';
    UI.transcriptStatusBadge.innerHTML = '';
    if (!state.transcribing && UI.btnTranscribeText) UI.btnTranscribeText.textContent = 'Trascrivi';
    if (!state.transcribing) UI.btnTranscribeAfter?.classList.add('highlight');
    return;
  }

  UI.transcriptStatusBadge.classList.remove('hidden');

  if (rec.isCompleteTranscript) {
    if (rec.isTranslated) {
      UI.transcriptStatusBadge.className = 'transcript-status-badge translated';
      UI.transcriptStatusBadge.innerHTML = `<span class="memo-icon icon-xs">${ICONS.translate || ''}</span><span>Traduzione Inglese (100% verificata)</span>`;
    } else {
      UI.transcriptStatusBadge.className = 'transcript-status-badge verified';
      UI.transcriptStatusBadge.innerHTML = `<span class="memo-icon icon-xs">${ICONS.check || ''}</span><span>Trascrizione Completa 100% (Verificata)</span>`;
    }
    if (!state.transcribing) {
      if (UI.btnTranscribeText) UI.btnTranscribeText.textContent = 'Ritrascrivi';
      UI.btnTranscribeAfter?.classList.remove('highlight');
    }
  } else {
    // È un'anteprima Live parziale o non ancora verificata al 100%
    UI.transcriptStatusBadge.className = 'transcript-status-badge preview';
    UI.transcriptStatusBadge.innerHTML = `<span class="memo-icon icon-xs">${ICONS.sparkles || ''}</span><span>Anteprima Live (Parziale)</span>`;
    if (!state.transcribing) {
      if (UI.btnTranscribeText) UI.btnTranscribeText.textContent = 'Perfeziona Completa (100%)';
      UI.btnTranscribeAfter?.classList.add('highlight');
    }
  }
}

function renderTranscript() {
  if (!state.transcript) return;

  const { segments, text } = state.transcript;

  if (!state.showTimestamps || !segments || segments.length === 0) {
    UI.timestampsMargin.classList.remove('visible');
    UI.timestampsMargin.innerHTML = '';
    UI.transcriptContent.textContent = text || '';
  } else {
    UI.timestampsMargin.classList.add('visible');
    UI.timestampsMargin.innerHTML = '';
    UI.transcriptContent.innerHTML = '';

    segments.forEach(seg => {
      const tsEl = document.createElement('span');
      tsEl.className = 'ts-mark';
      tsEl.textContent = formatTime(seg.start);
      UI.timestampsMargin.appendChild(tsEl);

      const span = document.createElement('span');
      span.style.display = 'block';
      span.style.lineHeight = '1.5em';
      span.textContent = seg.text + ' ';
      UI.transcriptContent.appendChild(span);
    });
  }
}

async function saveTranscript() {
  if (!state.activeRec || !state.transcript) return;
  const text = UI.transcriptContent.innerText.trim();
  state.transcript.text = text;
  await API.transcriptSave({
    recDir: state.activeRec.recDir,
    transcript: state.transcript,
  });
}

async function exportTranscript(format) {
  if (!state.activeRec) return;
  const text = UI.transcriptContent.innerText.trim();
  await API.transcriptExport({
    recDir: state.activeRec.recDir,
    format,
    text,
  });
}

// ══════════════════════════════════════════════════════════════
// 6. LIBRERIA & GESTIONE GRUPPI
// ══════════════════════════════════════════════════════════════
async function refreshLibrary() {
  state.library = await API.libraryGet();
  renderLibrary();
}

function renderLibrary() {
  UI.libraryTree.innerHTML = '';

  const { folders, unsorted } = state.library;
  const query = state.searchQuery;

  // Libreria completamente vuota: invito a creare la prima nota.
  if (!query && folders.length === 0 && (unsorted || []).length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'library-empty';

    const icon = document.createElement('span');
    icon.className = 'library-empty-icon';
    icon.innerHTML = ICONS.audioWave;

    const title = document.createElement('strong');
    title.textContent = 'Ancora nessuna nota';

    const hint = document.createElement('span');
    hint.textContent = 'Premi REC per registrare la tua prima lezione.';

    emptyMsg.appendChild(icon);
    emptyMsg.appendChild(title);
    emptyMsg.appendChild(hint);
    UI.libraryTree.appendChild(emptyMsg);
    return;
  }

  // Cartelle gruppi
  folders.forEach(folder => {
    const filteredRecordings = filterRecordings(folder.recordings || [], query);
    const matchesFolder = folder.name.toLowerCase().includes(query);
    if (!query || matchesFolder || filteredRecordings.length > 0) {
      const folderEl = createFolderElement({
        ...folder,
        recordings: query && !matchesFolder ? filteredRecordings : folder.recordings,
      }, query.length > 0);
      UI.libraryTree.appendChild(folderEl);
    }
  });

  // Non categorizzate (mostrata solo se contiene registrazioni o se stiamo cercando)
  const filteredUnsorted = filterRecordings(unsorted || [], query);
  if ((!query && (unsorted || []).length > 0) || (query && filteredUnsorted.length > 0)) {
    const unsortedFolder = {
      name: '_unsorted',
      displayName: 'Non categorizzate',
      recordings: query ? filteredUnsorted : unsorted,
      isSystem: true,
    };
    const unsortedEl = createFolderElement(unsortedFolder, query.length > 0);
    UI.libraryTree.appendChild(unsortedEl);
  }

  // Nessun risultato per la ricerca
  if (UI.libraryTree.children.length === 0 && query) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'library-empty';
    emptyMsg.style.padding = '20px 14px';
    emptyMsg.style.color = 'var(--text-muted)';
    emptyMsg.style.fontSize = '12px';
    emptyMsg.style.textAlign = 'center';

    const icon = document.createElement('span');
    icon.className = 'memo-icon icon-lg';
    icon.style.marginBottom = '6px';
    icon.style.opacity = '0.6';
    icon.innerHTML = ICONS.search;

    emptyMsg.appendChild(icon);
    emptyMsg.appendChild(document.createElement('br'));
    emptyMsg.appendChild(document.createTextNode('Nessuna registrazione trovata per "'));
    const strong = document.createElement('strong');
    strong.textContent = query;
    emptyMsg.appendChild(strong);
    emptyMsg.appendChild(document.createTextNode('"'));

    UI.libraryTree.appendChild(emptyMsg);
  }
}

function filterRecordings(recs, query) {
  if (!query) return recs;
  const q = query.toLowerCase();
  return recs.filter(r => {
    const nameMatch = (r.name || r.dirName || '').toLowerCase().includes(q);
    const textMatch = (r.searchText || '').toLowerCase().includes(q);
    return nameMatch || textMatch;
  });
}

function createFolderElement(folder, autoExpand = false) {
  const isSystem = folder.isSystem;
  const displayName = folder.displayName || folder.name;
  const recordings = folder.recordings || [];

  const wrap = document.createElement('div');
  wrap.className = 'folder-wrap';

  const header = document.createElement('div');
  header.className = 'folder-header';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');

  const chevron = document.createElement('span');
  chevron.className = 'folder-chevron';
  chevron.innerHTML = ICONS.chevronRight;

  const folderIcon = document.createElement('span');
  folderIcon.className = 'folder-icon';
  folderIcon.innerHTML = isSystem ? ICONS.inbox : ICONS.folder;

  const name = document.createElement('span');
  name.className = 'folder-name';
  name.textContent = displayName;

  const count = document.createElement('span');
  count.className = 'folder-count';
  count.textContent = recordings.length;

  header.appendChild(chevron);
  header.appendChild(folderIcon);
  header.appendChild(name);
  header.appendChild(count);

  if (!isSystem) {
    const actions = document.createElement('div');
    actions.className = 'folder-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'folder-action-btn';
    renameBtn.title = 'Rinomina gruppo';
    renameBtn.innerHTML = ICONS.edit;
    renameBtn.onclick = (e) => { e.stopPropagation(); renameFolder(folder.name); };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'folder-action-btn danger';
    deleteBtn.title = 'Elimina gruppo';
    deleteBtn.innerHTML = ICONS.trash;
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteFolder(folder.name); };

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    header.appendChild(actions);
  }

  const recList = document.createElement('div');
  recList.className = 'folder-recordings';

  recordings.forEach(rec => {
    const recEl = createRecordingElement(rec, isSystem ? null : folder.name);
    recList.appendChild(recEl);
  });

  let isOpen = autoExpand || (recordings.length > 0 && !isSystem);

  const applyOpenState = () => {
    wrap.classList.toggle('open', isOpen);
    chevron.classList.toggle('open', isOpen);
    header.setAttribute('aria-expanded', String(isOpen));
    folderIcon.innerHTML = isOpen
      ? (isSystem ? ICONS.inbox : ICONS.folderOpen)
      : (isSystem ? ICONS.inbox : ICONS.folder);
  };
  applyOpenState();

  const toggleOpen = () => {
    isOpen = !isOpen;
    applyOpenState();
  };

  header.addEventListener('click', toggleOpen);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleOpen();
    }
  });

  wrap.appendChild(header);
  wrap.appendChild(recList);
  return wrap;
}

function createRecordingElement(rec, folderName) {
  const el = document.createElement('div');
  el.className = 'rec-item' + (rec.hasTranscript ? ' has-transcript' : '');
  el.dataset.recDir = rec.recDir;

  // Preserva selezione attiva
  if (state.activeRec && state.activeRec.recDir === rec.recDir) {
    el.classList.add('active');
  }

  const icon = document.createElement('span');
  icon.className = 'rec-item-icon';
  icon.innerHTML = rec.hasTranscript ? ICONS.document : ICONS.mic;

  const info = document.createElement('div');
  info.className = 'rec-item-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'rec-item-name';
  nameEl.textContent = rec.name || rec.dirName;
  nameEl.title = `${rec.name || rec.dirName}\nData: ${formatDateTime(rec.date) || 'N/D'}\nDurata: ${formatDuration(rec.duration) || '0:00'}`;

  const meta = document.createElement('div');
  meta.className = 'rec-item-meta';

  const dateTimeStr = formatDateTime(rec.date);
  if (dateTimeStr) {
    const dtSpan = document.createElement('span');
    dtSpan.className = 'rec-meta-date';
    dtSpan.textContent = dateTimeStr;
    meta.appendChild(dtSpan);
  }

  if (rec.duration) {
    const durSpan = document.createElement('span');
    durSpan.className = 'rec-meta-dur';
    durSpan.textContent = (dateTimeStr ? '· ' : '') + formatDuration(rec.duration);
    meta.appendChild(durSpan);
  }

  info.appendChild(nameEl);
  info.appendChild(meta);

  // Azioni su registrazione
  const actions = document.createElement('div');
  actions.className = 'rec-item-actions';

  const moveBtn = document.createElement('button');
  moveBtn.className = 'rec-action-btn';
  moveBtn.title = 'Sposta in un altro gruppo';
  moveBtn.innerHTML = ICONS.move;
  moveBtn.onclick = (e) => { e.stopPropagation(); showMoveModal(rec); };

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'rec-action-btn danger';
  deleteBtn.title = 'Elimina registrazione';
  deleteBtn.innerHTML = ICONS.trash;
  deleteBtn.onclick = (e) => { e.stopPropagation(); confirmDeleteRecording(rec); };

  actions.appendChild(moveBtn);
  actions.appendChild(deleteBtn);

  el.appendChild(icon);
  el.appendChild(info);
  el.appendChild(actions);

  el.addEventListener('click', () => openRecording(rec, folderName));

  return el;
}

// ══════════════════════════════════════════════════════════════
// 7. APRI REGISTRAZIONE
// ══════════════════════════════════════════════════════════════
async function openRecording(rec, folderName) {
  state.activeRec = rec;

  // Mostra vista nota e nascondi le altre viste (una sola vista alla volta)
  showMainView('transcript');
  UI.transcribeProgress?.classList.add('hidden');
  UI.transcribeButtons?.classList.remove('hidden');

  // Se stiamo trascrivendo un'altra nota, resettiamo l'animazione locale.
  if (!(state.transcribing && state.transcribeRecDir === rec.recDir)) {
    UI.transcribeBar?.classList.remove('transcribing');
    UI.transcriptArea?.classList.remove('transcribing');
    UI.transcribeOverlay?.classList.add('hidden');
    UI.btnTranscribeAfter?.classList.remove('is-loading');
    if (UI.btnTranscribeAfter) UI.btnTranscribeAfter.disabled = false;
  }

  // Breadcrumb
  const displayFolder = rec.folder || folderName || 'Non categorizzate';
  UI.breadcrumbFolder.textContent = displayFolder === '_unsorted' ? 'Non categorizzate' : displayFolder;
  UI.recNameLabel.textContent = rec.name || rec.dirName;

  // Evidenzia elemento attivo nella sidebar
  document.querySelectorAll('.rec-item').forEach(el => {
    el.classList.toggle('active', el.dataset.recDir === rec.recDir);
  });

  // Carica trascrizione esistente
  state.transcript = null;
  UI.transcriptContent.textContent = '';
  UI.timestampsMargin.innerHTML = '';

  const result = await API.transcriptRead({ recDir: rec.recDir });

  // Se nel frattempo l'utente ha aperto un'altra nota, scarta questa risposta.
  if (!state.activeRec || state.activeRec.recDir !== rec.recDir) return;

  if (result.success && result.transcript) {
    state.transcript = result.transcript;
    renderTranscript();
  }

  // Aggiorna badge e pulsante di trascrizione
  updateTranscriptStatusBadge();

  // Carica audio nel player della barra inferiore
  const audioResult = await API.audioGetPath({ recDir: rec.recDir });

  if (!state.activeRec || state.activeRec.recDir !== rec.recDir) return;

  if (audioResult.success) {
    loadAudio(audioResult.audioPath);
  }
}

// ══════════════════════════════════════════════════════════════
// 8. PLAYER AUDIO
// ══════════════════════════════════════════════════════════════
function setupPlayerControls() {
  const audio = state.playerAudio;

  UI.btnPlayPause.addEventListener('click', () => {
    if (audio.paused) {
      audio.play();
      UI.iconPlayerPlaySlot.innerHTML = ICONS.pause;
    } else {
      audio.pause();
      UI.iconPlayerPlaySlot.innerHTML = ICONS.play;
    }
  });

  audio.addEventListener('timeupdate', () => {
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    UI.playerSeek.value = pct;
    UI.playerTime.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
  });

  audio.addEventListener('ended', () => {
    UI.iconPlayerPlaySlot.innerHTML = ICONS.play;
  });

  UI.playerSeek.addEventListener('input', () => {
    if (audio.duration) audio.currentTime = (UI.playerSeek.value / 100) * audio.duration;
  });

  UI.playerVolume.addEventListener('input', () => {
    audio.volume = UI.playerVolume.value;
  });
}

function loadAudio(src) {
  const audio = state.playerAudio;
  audio.src = src;
  audio.load();
  UI.iconPlayerPlaySlot.innerHTML = ICONS.play;
  showPlayerOrWaveform('player');
}

function showPlayerOrWaveform(which) {
  const isPlayer = which === 'player';
  UI.playerControls.classList.toggle('hidden', !isPlayer);
  UI.waveformWrap.classList.toggle('hidden', isPlayer);
  if (!isPlayer) resizeCanvas();
}

// ══════════════════════════════════════════════════════════════
// 9. MODALI & OPERAZIONI GRUPPI
// ══════════════════════════════════════════════════════════════
function setupModalHandlers() {
  UI.btnNewFolder.addEventListener('click', () => {
    UI.inputFolderName.value = '';
    UI.modalFolder.classList.remove('hidden');
    UI.inputFolderName.focus();
  });
  UI.btnFolderCancel.addEventListener('click', () => UI.modalFolder.classList.add('hidden'));
  UI.inputFolderName.addEventListener('keydown', e => { if (e.key === 'Enter') UI.btnFolderConfirm.click(); });
  UI.btnFolderConfirm.addEventListener('click', async () => {
    const name = UI.inputFolderName.value.trim();
    if (!name) return;
    const result = await API.folderCreate({ name });
    UI.modalFolder.classList.add('hidden');
    if (result.success) {
      showToast(`Gruppo "${result.name}" creato`, 'success', 2000);
      await refreshLibrary();
    } else {
      showToast(result.error, 'error', 3000);
    }
  });

  // Modal Guida & Architettura (i)
  UI.btnInfo?.addEventListener('click', () => {
    UI.modalInfo?.classList.remove('hidden');
  });
  UI.btnInfoClose?.addEventListener('click', () => {
    UI.modalInfo?.classList.add('hidden');
  });
  UI.btnInfoOk?.addEventListener('click', () => {
    UI.modalInfo?.classList.add('hidden');
  });

  [UI.modalFolder, UI.modalMove, UI.modalConfirm, UI.modalInfo].forEach(modal => {
    if (!modal) return;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });
}

async function renameFolder(oldName) {
  const newName = prompt(`Nuovo nome per il gruppo "${oldName}":`, oldName);
  if (!newName || newName === oldName) return;

  const activeIsInFolder = !!state.activeRec &&
    state.activeRec.recDir.split('/').slice(-2, -1)[0] === oldName;

  if (activeIsInFolder) await saveTranscript();

  const result = await API.folderRename({ oldName, newName });
  if (result.success) {
    if (activeIsInFolder && state.activeRec) {
      const parts = state.activeRec.recDir.split('/');
      parts[parts.length - 2] = result.name;
      state.activeRec.recDir = parts.join('/');
      state.activeRec.audioPath = `${state.activeRec.recDir}/audio.wav`;
      state.activeRec.folder = result.name;
    }

    showToast(`Gruppo rinominato in "${result.name}"`, 'success', 2000);
    await refreshLibrary();

    if (activeIsInFolder && state.activeRec) {
      openRecording(state.activeRec);
    }
  } else {
    showToast(result.error, 'error', 3000);
  }
}

function deleteFolder(name) {
  showConfirmModal(
    'Elimina Gruppo',
    `Eliminare il gruppo "${name}"? Le registrazioni al suo interno non verranno cancellate ma spostate in "Non categorizzate".`,
    async () => {
      const activeIsInFolder = !!state.activeRec &&
        state.activeRec.recDir.split('/').slice(-2, -1)[0] === name;

      if (activeIsInFolder) await saveTranscript();

      const result = await API.folderDelete({ name });
      if (result.success) {
        if (activeIsInFolder) {
          // La nota aperta è stata spostata: chiudila per evitare percorsi stale
          if (state.playerAudio) {
            state.playerAudio.pause();
            state.playerAudio.removeAttribute('src');
            state.playerAudio.load();
          }
          state.activeRec = null;
          state.transcript = null;
          showMainView(state.recording ? 'recording' : 'empty');
          UI.transcribeProgress?.classList.add('hidden');
          UI.transcribeButtons?.classList.remove('hidden');
          showPlayerOrWaveform('waveform');
        }
        showToast(`Gruppo "${name}" eliminato`, 'info', 2000);
        await refreshLibrary();
      } else {
        showToast(result.error, 'error', 3000);
      }
    }
  );
}

function showMoveModal(rec) {
  UI.moveFolderList.innerHTML = '';

  const addOption = (name, label) => {
    const btn = document.createElement('button');
    btn.className = 'move-folder-item';
    btn.innerHTML = `<span class="memo-icon icon-sm">${ICONS.folder}</span><span>${label}</span>`;
    btn.onclick = async () => {
      UI.modalMove.classList.add('hidden');
      const result = await API.recordingMove({
        recDir: rec.recDir,
        targetFolder: name,
      });
      if (result.success) {
        showToast('Registrazione spostata', 'success', 2000);
        await refreshLibrary();
        if (state.activeRec && state.activeRec.recDir === rec.recDir) {
          state.activeRec.recDir = result.newPath;
          state.activeRec.folder = name || null;
          openRecording(state.activeRec, name);
        }
      }
    };
    UI.moveFolderList.appendChild(btn);
  };

  addOption(null, 'Non categorizzate');
  state.library.folders.forEach(f => {
    if (f.name !== rec.folder) addOption(f.name, f.name);
  });

  UI.modalMove.classList.remove('hidden');
  UI.btnMoveCancel.onclick = () => UI.modalMove.classList.add('hidden');
}

function confirmDeleteRecording(rec) {
  showConfirmModal(
    'Elimina Registrazione',
    `Sei sicuro di voler eliminare "${rec.name || rec.dirName}"? L'azione è irreversibile.`,
    async () => {
      const result = await API.recordingDelete({ recDir: rec.recDir });
      if (result.success) {
        showToast('Registrazione eliminata', 'info', 2000);
        if (state.activeRec && state.activeRec.recDir === rec.recDir) {
          closeActiveRecording();
        }
        await refreshLibrary();
      }
    }
  );
}

function showConfirmModal(title, msg, onConfirm) {
  UI.confirmTitle.textContent = title;
  UI.confirmMessage.textContent = msg;
  UI.btnConfirmOk.textContent = 'Elimina';
  UI.btnConfirmOk.className = 'btn-danger';
  UI.modalConfirm.classList.remove('hidden');
  UI.btnConfirmOk.onclick = () => {
    UI.modalConfirm.classList.add('hidden');
    onConfirm();
  };
  UI.btnConfirmCancel.onclick = () => UI.modalConfirm.classList.add('hidden');
}

// ══════════════════════════════════════════════════════════════
// 10. RESIZER SIDEBAR
// ══════════════════════════════════════════════════════════════
function setupResizer() {
  const sidebar = $('sidebar');
  const resizer = $('resizer');
  let isResizing = false;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newW = Math.min(420, Math.max(200, e.clientX));
    sidebar.style.width = newW + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      resizeCanvas();
    }
  });
}

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

// ══════════════════════════════════════════════════════════════
// AVVIO
// ══════════════════════════════════════════════════════════════
init();
