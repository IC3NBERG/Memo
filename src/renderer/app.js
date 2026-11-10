/* ══════════════════════════════════════════════════════════════
   CRUNCH — app.js
   Logica completa con icone SVG ad hoc, Trascrizione Live istantanea (3.5s),
   Verifica Trascrizione Completa al 100%, Traduzione Metal e Gruppi
   ══════════════════════════════════════════════════════════════ */

'use strict';

const ICONS = window.MEMO_ICONS || {};
const API = window.crunchAPI || window.memoAPI;
const BlockModel = window.MemoBlockModel || {};

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
  folderOpenState: new Map(), // conserva l'apertura dei gruppi tra un refresh e l'altro
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
  timestampsPreferred: false,
  playerAudio: document.getElementById('hidden-audio'),

  // Revisioni e editor a blocchi
  revisions: [],
  activeRevisionId: null,
  edits: null,
  sourceSegments: [],
  editorMode: 'none',          // 'none' | 'blocks' | 'legacy'
  editorReadOnly: false,
  editorHistory: { past: [], future: [] },
  editorSaveTimer: null,
  editorSaving: false,
  editorPendingSave: false,
  editorVersion: 0,
  editorBlockInput: false,
  showHiddenBlocks: false,

  // Ricerca full-text
  searchResults: null,
  searchResultIds: new Set(),
  searchSeq: 0,
  searchTimer: null,

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

  // Revision bar (rimossa dalla UI: le revisioni restano archiviate su disco)
  revisionBar:         $('revision-bar'),
  revisionSelect:      $('revision-select'),
  revisionMeta:        $('revision-meta'),
  revisionHint:        $('revision-hint'),

  // Editor a blocchi
  blockEditor:         $('block-editor'),
  editorToolbar:       $('editor-toolbar'),
  btnUndo:             $('btn-undo'),
  btnRedo:             $('btn-redo'),
  editorSaveStatus:    $('editor-save-status'),
  btnAddGroup:         $('btn-add-group'),
  iconAddGroupSlot:    $('icon-add-group-slot'),
  btnToggleHidden:     $('btn-toggle-hidden'),
  editorBanner:        $('editor-banner'),
  groupsBar:           $('groups-bar'),
  blockList:           $('block-list'),
  hiddenBlocks:        $('hidden-blocks'),
  blockEmpty:          $('block-empty'),

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

  modalRename:         $('modal-rename'),
  modalRenameIconSlot: $('modal-rename-icon-slot'),
  renameTitle:         $('rename-title'),
  inputRename:         $('input-rename'),
  btnRenameCancel:     $('btn-rename-cancel'),
  btnRenameConfirm:    $('btn-rename-confirm'),

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
  if (UI.iconAddGroupSlot) UI.iconAddGroupSlot.innerHTML = ICONS.folderPlus;
  if (UI.btnUndo) UI.btnUndo.textContent = '↶';
  if (UI.btnRedo) UI.btnRedo.textContent = '↷';

  if (UI.iconPlayerPlaySlot) UI.iconPlayerPlaySlot.innerHTML = ICONS.play;
  if (UI.iconVolumeSlot) UI.iconVolumeSlot.innerHTML = ICONS.volume;

  if (UI.modalNewFolderIconSlot) UI.modalNewFolderIconSlot.innerHTML = ICONS.folderPlus;
  if (UI.modalRenameIconSlot) UI.modalRenameIconSlot.innerHTML = ICONS.edit;
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

// Dialog di rinomina basato su Promise: usato sia per i gruppi sia per le note.
let renameDialogResolver = null;

function openRenameDialog(title, initialValue = '') {
  if (!UI.modalRename) return Promise.resolve(null);
  return new Promise((resolve) => {
    renameDialogResolver = resolve;
    if (UI.renameTitle) UI.renameTitle.textContent = title;
    if (UI.inputRename) {
      UI.inputRename.value = initialValue || '';
      UI.modalRename.classList.remove('hidden');
      UI.inputRename.focus();
      UI.inputRename.select();
    } else {
      UI.modalRename.classList.remove('hidden');
    }
    updateBannerOffset();
  });
}

function closeRenameDialog(value) {
  if (!UI.modalRename) return;
  UI.modalRename.classList.add('hidden');
  const resolve = renameDialogResolver;
  renameDialogResolver = null;
  if (resolve) resolve(value);
  updateBannerOffset();
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
// Il font è opzionale: caricarlo dopo il primo paint evita di bloccare la UI
// (o di attendere il timeout di rete quando l'app è offline).
function loadAppFont() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap';
  document.head.appendChild(link);
}

async function init() {
  injectStaticIcons();
  loadAppFont();
  setupResizer();
  setupRecControls();
  setupTranscriptControls();
  setupEditorControls();
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
async function closeActiveRecording() {
  if (!state.activeRec) return;

  const closingRecDir = state.activeRec.recDir;

  // Salva eventuali modifiche prima di staccare la vista dalla nota.
  try { await saveTranscript(); } catch (_) {}
  if (!state.activeRec || state.activeRec.recDir !== closingRecDir) return;

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
  state.edits = null;
  state.sourceSegments = [];
  state.editorMode = 'none';
  state.editorHistory = { past: [], future: [] };
  state.revisions = [];
  state.activeRevisionId = null;
  state.showHiddenBlocks = false;
  renderRevisionBar();
  showBlockEditor(false);
  UI.transcriptContent.classList.remove('hidden');
  UI.transcriptContent.textContent = '';

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
        } else if (openModal === UI.modalRename) {
          UI.btnRenameCancel?.click();
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
    state.searchQuery = UI.searchInput.value.trim();
    UI.btnClearSearch?.classList.toggle('hidden', !state.searchQuery);

    clearTimeout(state.searchTimer);
    if (!state.searchQuery) {
      state.searchResults = null;
      state.searchResultIds = new Set();
      state.searchSeq += 1;
      scheduleLibraryRender();
      return;
    }

    // Debounce: l'indice FTS5 è veloce, ma non vogliamo una query per tasto.
    // Nel frattempo il filtro in memoria evita di mostrare risultati vecchi.
    state.searchResults = null;
    state.searchResultIds = new Set();
    state.searchTimer = setTimeout(() => runFullTextSearch(state.searchQuery), 180);
    scheduleLibraryRender();
  });

  UI.btnClearSearch?.addEventListener('click', () => {
    clearTimeout(state.searchTimer);
    UI.searchInput.value = '';
    state.searchQuery = '';
    state.searchResults = null;
    state.searchResultIds = new Set();
    state.searchSeq += 1;
    UI.btnClearSearch.classList.add('hidden');
    renderLibrary();
  });
}

async function runFullTextSearch(query) {
  const seq = ++state.searchSeq;

  try {
    const result = await API.searchQuery({ query, limit: 80 });
    if (seq !== state.searchSeq) return;
    if (result?.success && Array.isArray(result.results)) {
      state.searchResults = result.results;
      state.searchResultIds = new Set(result.results.map((item) => item.recId));
    } else {
      // Indice non disponibile: resta attivo il filtro in memoria.
      state.searchResults = null;
      state.searchResultIds = new Set();
    }
  } catch (_) {
    if (seq !== state.searchSeq) return;
    state.searchResults = null;
    state.searchResultIds = new Set();
  }

  renderLibrary();
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
    drawWaveform();
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
    // Annulla scarta subito l'audio: nessuna doppia conferma.
    resetRecordingState();
    restoreMainView();
    showToast('Registrazione annullata', 'info', 2000);
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
  waveformFillGrad = null;
  waveformLineGrad = null;
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

// Buffer riutilizzabili: evitano allocazioni e GC a 60 fps durante la REC.
let waveformDataArray = null;
let waveformX = null;
let waveformY = null;
let waveformFillGrad = null;
let waveformLineGrad = null;
let waveformGradW = 0;
let waveformGradH = 0;

function drawWaveform() {
  const canvas = UI.waveformCanvas;
  if (!canvas) return;

  // In pausa (o a registrazione ferma) non serve ridisegnare a 60 fps.
  if (!state.recording || state.paused) {
    paintIdleWaveform();
    return;
  }

  requestAnimationFrame(drawWaveform);

  const analyser = state.analyserNode;
  if (!analyser) {
    paintIdleWaveform();
    return;
  }
  if (document.hidden) return;

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const bufLen = analyser.frequencyBinCount;

  if (!waveformDataArray || waveformDataArray.length !== bufLen) {
    waveformDataArray = new Uint8Array(bufLen);
    waveformX = new Float32Array(bufLen);
    waveformY = new Float32Array(bufLen);
  }

  analyser.getByteTimeDomainData(waveformDataArray);

  ctx.clearRect(0, 0, W, H);

  const dpr = window.devicePixelRatio || 1;
  const mid = H / 2;
  const sliceWidth = W / bufLen;

  for (let i = 0; i < bufLen; i++) {
    const v = (waveformDataArray[i] - 128) / 128;
    waveformX[i] = i * sliceWidth;
    waveformY[i] = mid + v * mid * 0.78;
  }

  if (!waveformFillGrad || waveformGradW !== W || waveformGradH !== H) {
    waveformGradW = W;
    waveformGradH = H;

    waveformFillGrad = ctx.createLinearGradient(0, 0, 0, H);
    waveformFillGrad.addColorStop(0, 'rgba(232, 168, 73, 0.20)');
    waveformFillGrad.addColorStop(0.5, 'rgba(232, 168, 73, 0.04)');
    waveformFillGrad.addColorStop(1, 'rgba(232, 168, 73, 0.20)');

    waveformLineGrad = ctx.createLinearGradient(0, 0, W, 0);
    waveformLineGrad.addColorStop(0, '#D4723C');
    waveformLineGrad.addColorStop(0.5, '#F3C476');
    waveformLineGrad.addColorStop(1, '#D4723C');
  }

  // Nastro simmetrico: dà corpo all'onda senza appesantirla.
  ctx.beginPath();
  ctx.moveTo(waveformX[0], waveformY[0]);
  for (let i = 1; i < bufLen; i++) ctx.lineTo(waveformX[i], waveformY[i]);
  for (let i = bufLen - 1; i >= 0; i--) ctx.lineTo(waveformX[i], H - waveformY[i]);
  ctx.closePath();
  ctx.fillStyle = waveformFillGrad;
  ctx.fill();

  ctx.lineWidth = 1.8 * dpr;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = waveformLineGrad;
  ctx.shadowColor = 'rgba(232, 168, 73, 0.7)';
  ctx.shadowBlur = 8 * dpr;
  ctx.beginPath();
  ctx.moveTo(waveformX[0], waveformY[0]);
  for (let i = 1; i < bufLen; i++) ctx.lineTo(waveformX[i], waveformY[i]);
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
    state.timestampsPreferred = state.showTimestamps;
    renderTranscript();
  });

  UI.btnCopyAll?.addEventListener('click', () => {
    const text = currentTranscriptText();
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
      state.activeRec.hasTranscript = true;
      state.activeRec.isCompleteTranscript = true;
      state.activeRec.isLivePreview = false;
      state.activeRec.isTranslated = isTranslate;

      applyTranscriptResult({ transcript, revisionId: transcript?.revisionId });
      updateTranscriptStatusBadge();
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

// ══════════════════════════════════════════════════════════════
// 5b. REVISIONI E EDITOR A BLOCCHI
// ══════════════════════════════════════════════════════════════
function setupEditorControls() {
  UI.revisionSelect?.addEventListener('change', () => {
    handleRevisionChange(UI.revisionSelect.value);
  });

  UI.btnUndo?.addEventListener('click', undoEditor);
  UI.btnRedo?.addEventListener('click', redoEditor);

  UI.btnToggleHidden?.addEventListener('click', () => {
    state.showHiddenBlocks = !state.showHiddenBlocks;
    renderTranscript();
  });

  UI.btnAddGroup?.addEventListener('click', () => {
    if (state.editorReadOnly || state.editorMode !== 'blocks') return;
    showNewGroupForm();
  });

  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
    const target = document.activeElement;
    if (!target) return;

    const insideEditor = UI.blockEditor?.contains(target);
    const isLegacy = UI.transcriptContent === target;
    if (!insideEditor && !isLegacy) return;

    event.preventDefault();
    if (event.shiftKey) redoEditor();
    else undoEditor();
  });
}

function showBlockEditor(show) {
  UI.blockEditor?.classList.toggle('hidden', !show);
  UI.transcriptContent?.classList.toggle('hidden', show);
  if (show) UI.timestampsMargin?.classList.add('hidden');
  else UI.timestampsMargin?.classList.remove('hidden');
}

function resetTranscriptEditor() {
  state.editorMode = 'none';
  state.edits = null;
  state.sourceSegments = [];
  state.editorReadOnly = false;
  state.editorHistory = BlockModel.createHistory();
  showBlockEditor(false);
  UI.transcriptContent.textContent = '';
}

/**
 * Unico punto di ingresso per una vista trascrizione ricevuta dal main:
 * allinea overlay, revisione e modalità dell'editor.
 */
function applyTranscriptResult(result, { resetHistory = true } = {}) {
  const view = result?.transcript || result;
  if (!view) return;

  state.transcript = view;
  state.edits = view.edits ? BlockModel.cloneEdits(view.edits) : null;
  state.sourceSegments = Array.isArray(view.sourceSegments) ? view.sourceSegments : [];
  // Visualizzazione unica a blocco di testo (come v1.0.9): niente editor a blocchi.
  state.editorMode = 'none';
  state.editorReadOnly = view.editsStatus === 'stale-edits'
    || view.editsStatus === 'invalid-edits';
  state.activeRevisionId = result?.revisionId || view.revisionId || state.activeRevisionId;
  state.editorVersion += 1;

  if (resetHistory) state.editorHistory = BlockModel.createHistory();
  state.showHiddenBlocks = false;

  if (result?.metadata && state.activeRec) {
    const meta = result.metadata;
    state.activeRec.hasTranscript = !!meta.hasTranscript;
    state.activeRec.isCompleteTranscript = !!meta.isCompleteTranscript;
    state.activeRec.isLivePreview = !!meta.isLivePreview;
    state.activeRec.isTranslated = !!meta.isTranslated;
    if (meta.name) state.activeRec.name = meta.name;
    if (meta.folder !== undefined) state.activeRec.folder = meta.folder;
  }

  syncTimestampsToggle(view);
  setEditorStatus('', '');
  renderRevisionBar();
  renderTranscript();
}

async function loadRevisions(recDir = state.activeRec?.recDir) {
  if (!recDir || !API.revisionList) return;
  try {
    const result = await API.revisionList({ recDir });
    if (!state.activeRec || state.activeRec.recDir !== recDir) return;
    if (result?.success) {
      state.revisions = result.revisions || [];
      state.activeRevisionId = result.activeRevisionId || state.activeRevisionId;
      renderRevisionBar();
    }
  } catch (_) {}
}

function renderRevisionBar() {
  // La barra delle revisioni è stata rimossa dalla UI: le revisioni restano
  // archiviate su disco e vengono applicate automaticamente dal main.
  if (!UI.revisionBar) return;
  UI.revisionBar.classList.add('hidden');
  if (UI.revisionSelect) UI.revisionSelect.innerHTML = '';
  if (UI.revisionMeta) UI.revisionMeta.textContent = '';
  if (UI.revisionHint) UI.revisionHint.textContent = '';
}

async function handleRevisionChange(revisionId) {
  if (!revisionId || !state.activeRec || revisionId === state.activeRevisionId) return;
  if (!UI.revisionSelect) return;

  const recDir = state.activeRec.recDir;
  UI.revisionSelect.disabled = true;
  try {
    if (!state.editorReadOnly) {
      try { await flushEditorSave({ force: true }); } catch (_) {}
    }

    const result = await API.revisionSwitch({ recDir, revisionId });
    if (!state.activeRec || state.activeRec.recDir !== recDir) return;

    if (!result?.success) {
      showToast(result?.error || 'Impossibile cambiare revisione', 'error', 3500);
      renderRevisionBar();
      return;
    }

    applyTranscriptResult(result);
    await loadRevisions(recDir);
    updateTranscriptStatusBadge();
    showToast(`Revisione ${revisionId} attiva`, 'success', 1800);
  } catch (err) {
    showToast(err.message || 'Errore nel cambio revisione', 'error', 3500);
  } finally {
    UI.revisionSelect.disabled = false;
  }
}

function currentTranscriptText() {
  if (state.editorMode === 'blocks' && state.edits) {
    return BlockModel.projectText(state.sourceSegments, state.edits);
  }
  if (state.editorMode === 'legacy') {
    const legacy = UI.blockList?.querySelector('.legacy-document');
    return (legacy?.innerText || state.transcript?.legacyText || state.transcript?.text || '').trim();
  }
  return (UI.transcriptContent?.innerText || '').trim();
}

function setEditorStatus(kind, label) {
  if (!UI.editorSaveStatus) return;
  UI.editorSaveStatus.className = `editor-save-status ${kind || ''}`.trim();
  UI.editorSaveStatus.textContent = label || '';
}

function updateUndoRedoButtons() {
  const history = state.editorHistory || { past: [], future: [] };
  if (UI.btnUndo) UI.btnUndo.disabled = state.editorReadOnly || history.past.length === 0;
  if (UI.btnRedo) UI.btnRedo.disabled = state.editorReadOnly || history.future.length === 0;
}

function undoEditor() {
  if (state.editorMode !== 'blocks' || state.editorReadOnly) return;
  const previous = BlockModel.undo(state.editorHistory, state.edits);
  if (!previous) return;
  state.edits = previous;
  state.editorVersion += 1;
  renderTranscript();
  scheduleEditorSave(0);
}

function redoEditor() {
  if (state.editorMode !== 'blocks' || state.editorReadOnly) return;
  const next = BlockModel.redo(state.editorHistory, state.edits);
  if (!next) return;
  state.edits = next;
  state.editorVersion += 1;
  renderTranscript();
  scheduleEditorSave(0);
}

function commitEditorMutation(nextEdits) {
  if (state.editorReadOnly) return;
  BlockModel.pushHistory(state.editorHistory, state.edits);
  state.edits = nextEdits;
  state.editorVersion += 1;
  renderTranscript();
  scheduleEditorSave();
}

function scheduleEditorSave(delay = 900) {
  clearTimeout(state.editorSaveTimer);
  if (state.editorReadOnly) return;
  setEditorStatus('saving', 'Salvataggio…');
  state.editorSaveTimer = setTimeout(() => {
    flushEditorSave().catch(() => {});
  }, delay);
}

async function flushEditorSave({ force = false } = {}) {
  if (state.editorMode !== 'blocks' || !state.activeRec || !state.edits) return true;
  if (state.editorReadOnly) return true;

  clearTimeout(state.editorSaveTimer);
  state.editorSaveTimer = null;

  if (state.editorSaving) {
    state.editorPendingSave = true;
    return false;
  }

  const recDir = state.activeRec.recDir;
  const version = state.editorVersion;
  const snapshot = BlockModel.cloneEdits(state.edits);
  state.editorSaving = true;
  state.editorPendingSave = false;
  setEditorStatus('saving', 'Salvataggio…');

  try {
    const result = await API.editsSave({
      recDir,
      edits: snapshot,
      expectedEditRevision: snapshot.editRevision,
    });

    if (!state.activeRec || state.activeRec.recDir !== recDir) return true;

    if (!result?.success) {
      setEditorStatus('error', result?.error || 'Errore di salvataggio');
      if (result?.code === 'edit-revision-mismatch') {
        showToast('La trascrizione è stata modificata altrove. Ricarica la nota.', 'error', 4500);
      } else {
        showToast(result?.error || 'Errore di salvataggio', 'error', 4000);
      }
      return false;
    }

    if (version === state.editorVersion || force) {
      state.edits = BlockModel.cloneEdits(result.edits);
      state.transcript = result.transcript;
    } else {
      // L'utente ha continuato a scrivere: conserva le modifiche locali e
      // allinea solo il contatore ottimistico.
      state.edits.editRevision = result.edits.editRevision;
    }

    setEditorStatus('saved', 'Salvato');
    updateUndoRedoButtons();

    if (version !== state.editorVersion) {
      state.editorPendingSave = true;
    }
    return true;
  } catch (err) {
    setEditorStatus('error', 'Errore di salvataggio');
    showToast(err.message || 'Errore di salvataggio', 'error', 4000);
    return false;
  } finally {
    state.editorSaving = false;
    if (state.editorPendingSave && state.editorVersion !== version) {
      state.editorPendingSave = false;
      scheduleEditorSave(0);
    }
  }
}

function makeBlockButton(label, title, onClick, { disabled = false, className = 'block-btn' } = {}) {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.title = title;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function appendInlineForm(container, {
  placeholder,
  submitLabel,
  multiline = false,
  onSubmit,
  onCancel,
}) {
  const form = document.createElement('div');
  form.className = 'block-inline-form';

  const input = document.createElement(multiline ? 'textarea' : 'input');
  if (multiline) {
    input.rows = 2;
    input.style.resize = 'vertical';
  } else {
    input.type = 'text';
  }
  input.placeholder = placeholder;

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.textContent = submitLabel;

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Annulla';
  cancel.style.background = 'transparent';
  cancel.style.color = 'var(--text-muted)';

  const finish = () => {
    const value = input.value;
    form.remove();
    if (onSubmit) onSubmit(value);
  };

  submit.addEventListener('click', finish);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      finish();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      form.remove();
      if (onCancel) onCancel();
    }
  });
  cancel.addEventListener('click', () => {
    form.remove();
    if (onCancel) onCancel();
  });

  form.append(input, submit, cancel);
  container.appendChild(form);
  input.focus();
  return form;
}

function renderGroupsBar() {
  if (!UI.groupsBar) return;
  const groups = state.edits?.groups || [];
  UI.groupsBar.innerHTML = '';
  UI.groupsBar.classList.toggle('hidden', groups.length === 0);
  if (groups.length === 0) return;

  for (const group of groups) {
    const chip = document.createElement('span');
    chip.className = 'group-chip';

    const title = document.createElement('span');
    title.textContent = group.title;
    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = String((group.segmentIds || []).length);
    chip.append(title, count);

    if (!state.editorReadOnly) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `Elimina gruppo ${group.title}`;
      remove.addEventListener('click', async (event) => {
        event.stopPropagation();
        const ok = await confirmDialog(
          'Eliminare il gruppo?',
          `Il gruppo "${group.title}" verrà rimosso. I blocchi restano intatti.`,
          'Elimina',
          true,
        );
        if (!ok) return;
        commitEditorMutation(BlockModel.deleteGroup(state.edits, group.id));
      });
      chip.appendChild(remove);
    }

    UI.groupsBar.appendChild(chip);
  }
}

function showNewGroupForm() {
  if (!UI.groupsBar) return;
  UI.groupsBar.classList.remove('hidden');
  if (UI.groupsBar.querySelector('.block-inline-form')) return;

  appendInlineForm(UI.groupsBar, {
    placeholder: 'Nome del gruppo…',
    submitLabel: 'Crea',
    onSubmit: (value) => {
      const next = BlockModel.createGroup(state.edits, value);
      if (next.groups.length !== (state.edits.groups || []).length) {
        commitEditorMutation(next);
      }
    },
  });
}

function renderEditorBanner() {
  if (!UI.editorBanner) return;
  const banner = UI.editorBanner;
  banner.innerHTML = '';
  banner.className = 'editor-banner hidden';

  if (state.editorReadOnly) {
    banner.classList.remove('hidden');
    banner.classList.add('readonly');
    const strong = document.createElement('strong');
    strong.textContent = 'Overlay non allineato alla sorgente: sola lettura.';
    const text = document.createElement('div');
    text.textContent = 'Il testo originale è intatto. La copia modificata non viene applicata finché non viene riallineata o scartata.';
    const actions = document.createElement('div');
    actions.className = 'banner-actions';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Ricarica la revisione';
    reload.addEventListener('click', () => reloadActiveTranscript());
    actions.appendChild(reload);
    banner.append(strong, text, actions);
    return;
  }

  const warnings = state.transcript?.warnings || [];
  if (warnings.length > 0) {
    banner.classList.remove('hidden');
    const strong = document.createElement('strong');
    strong.textContent = 'Alcuni riferimenti dell’overlay sono stati ignorati.';
    const text = document.createElement('div');
    text.textContent = warnings.slice(0, 4).map((warning) => warning.code).join(', ');
    banner.append(strong, text);
  }
}

async function reloadActiveTranscript() {
  if (!state.activeRec) return;
  const recDir = state.activeRec.recDir;
  const result = await API.transcriptRead({ recDir });
  if (!state.activeRec || state.activeRec.recDir !== recDir) return;
  if (result?.success) {
    applyTranscriptResult(result);
    updateTranscriptStatusBadge();
  }
}

function renderHiddenBlocks(hidden) {
  if (!UI.hiddenBlocks) return;
  UI.hiddenBlocks.innerHTML = '';
  const show = state.showHiddenBlocks && hidden.length > 0;
  UI.hiddenBlocks.classList.toggle('hidden', !show);
  if (!show) return;

  const title = document.createElement('div');
  title.className = 'hidden-blocks-title';
  title.textContent = `Blocchi nascosti (${hidden.length})`;
  UI.hiddenBlocks.appendChild(title);

  for (const segment of hidden) {
    const row = document.createElement('div');
    row.className = 'hidden-block-row';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Mostra';
    button.disabled = state.editorReadOnly;
    button.addEventListener('click', () => {
      commitEditorMutation(BlockModel.setHidden(state.edits, segment.id, false));
    });

    const text = document.createElement('span');
    text.className = 'hidden-text';
    text.textContent = segment.text || '(vuoto)';

    row.append(button, text);
    UI.hiddenBlocks.appendChild(row);
  }
}

function createBlockRow(segment, index, total, visibleIds) {
  const row = document.createElement('div');
  row.className = 'block-row';
  row.dataset.segmentId = segment.id;

  const time = document.createElement('div');
  time.className = 'block-time';
  const canSeek = transcriptSupportsTimestamps(state.transcript);
  if (state.showTimestamps && canSeek) {
    time.textContent = formatTime(segment.start);
    time.title = `Vai a ${formatTime(segment.start)}`;
    time.addEventListener('click', () => seekPlayerTo(segment.start));
  } else {
    time.classList.add('no-seek');
    time.textContent = '·';
  }
  row.appendChild(time);

  const card = document.createElement('div');
  card.className = 'block-card';

  const text = document.createElement('div');
  text.className = 'block-text';
  text.textContent = segment.text;
  text.contentEditable = state.editorReadOnly ? 'false' : 'true';
  text.spellcheck = true;
  text.dataset.segmentId = segment.id;

  text.addEventListener('focus', () => {
    state.editorBlockInput = false;
  });
  text.addEventListener('input', () => {
    if (state.editorReadOnly) return;
    if (!state.editorBlockInput) {
      BlockModel.pushHistory(state.editorHistory, state.edits);
      state.editorBlockInput = true;
    }
    state.edits = BlockModel.setSegmentText(state.edits, segment.id, text.innerText);
    state.editorVersion += 1;
    updateUndoRedoButtons();
    scheduleEditorSave();
  });
  text.addEventListener('blur', () => {
    state.editorBlockInput = false;
    flushEditorSave().catch(() => {});
  });
  text.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      text.blur();
    }
  });

  card.appendChild(text);

  const footer = document.createElement('div');
  footer.className = 'block-footer';

  const actions = document.createElement('div');
  actions.className = 'block-actions';
  if (!state.editorReadOnly) {
    actions.appendChild(makeBlockButton('↑', 'Sposta su', () => {
      commitEditorMutation(BlockModel.moveSegment(state.edits, segment.id, -1, visibleIds));
    }, { disabled: index === 0 }));

    actions.appendChild(makeBlockButton('↓', 'Sposta giù', () => {
      commitEditorMutation(BlockModel.moveSegment(state.edits, segment.id, 1, visibleIds));
    }, { disabled: index === total - 1 }));

    actions.appendChild(makeBlockButton('#', 'Aggiungi tag', () => {
      if (card.querySelector('.block-inline-form')) return;
      appendInlineForm(card, {
        placeholder: 'Nuovo tag…',
        submitLabel: 'Aggiungi',
        onSubmit: (value) => {
          const next = BlockModel.addTag(state.edits, segment.id, value);
          if (next !== state.edits) commitEditorMutation(next);
        },
      });
    }));

    actions.appendChild(makeBlockButton('✎', 'Aggiungi annotazione', () => {
      if (card.querySelector('.block-inline-form')) return;
      appendInlineForm(card, {
        placeholder: 'Annotazione…',
        submitLabel: 'Salva',
        multiline: true,
        onSubmit: (value) => {
          const next = BlockModel.addAnnotation(state.edits, segment.id, value);
          if (next !== state.edits) commitEditorMutation(next);
        },
      });
    }));

    const groupCount = BlockModel.groupsForSegment(state.edits, segment.id).length;
    actions.appendChild(makeBlockButton(
      `⊞${groupCount ? ` ${groupCount}` : ''}`,
      'Gruppi del blocco',
      () => toggleGroupPicker(card, segment.id),
    ));

    actions.appendChild(makeBlockButton('⊘', 'Nascondi blocco', () => {
      commitEditorMutation(BlockModel.setHidden(state.edits, segment.id, true));
    }));
  }
  footer.appendChild(actions);

  for (const tag of state.edits?.tags?.[segment.id] || []) {
    const chip = document.createElement('span');
    chip.className = 'block-tag';
    chip.textContent = tag;
    if (!state.editorReadOnly) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `Rimuovi tag ${tag}`;
      remove.addEventListener('click', () => {
        commitEditorMutation(BlockModel.removeTag(state.edits, segment.id, tag));
      });
      chip.appendChild(remove);
    }
    footer.appendChild(chip);
  }

  for (const group of BlockModel.groupsForSegment(state.edits, segment.id)) {
    const label = document.createElement('span');
    label.className = 'block-group-label';
    label.textContent = group.title;
    footer.appendChild(label);
  }

  card.appendChild(footer);

  for (const annotation of state.edits?.annotations?.[segment.id] || []) {
    const note = document.createElement('div');
    note.className = 'block-note';
    if (!state.editorReadOnly) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Elimina annotazione';
      remove.addEventListener('click', () => {
        commitEditorMutation(BlockModel.removeAnnotation(state.edits, segment.id, annotation.id));
      });
      note.appendChild(remove);
    }
    note.appendChild(document.createTextNode(annotation.text));
    card.appendChild(note);
  }

  row.appendChild(card);
  return row;
}

function toggleGroupPicker(card, segmentId) {
  const existing = card.querySelector('.block-group-picker');
  if (existing) {
    existing.remove();
    return;
  }

  const groups = state.edits?.groups || [];
  if (groups.length === 0) {
    showToast('Crea prima un gruppo con “Nuovo gruppo”.', 'info', 2500);
    return;
  }

  const picker = document.createElement('div');
  picker.className = 'block-group-picker';

  for (const group of groups) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = (group.segmentIds || []).includes(segmentId);
    checkbox.disabled = state.editorReadOnly;
    checkbox.addEventListener('change', () => {
      commitEditorMutation(BlockModel.toggleSegmentInGroup(state.edits, group.id, segmentId));
    });
    label.append(checkbox, document.createTextNode(group.title));
    picker.appendChild(label);
  }

  card.appendChild(picker);
}

function renderBlockEditor() {
  showBlockEditor(true);
  UI.editorToolbar?.classList.remove('hidden');
  UI.blockList?.classList.remove('hidden');
  UI.hiddenBlocks?.classList.remove('hidden');
  UI.btnAddGroup?.classList.remove('hidden');
  UI.btnToggleHidden?.classList.remove('hidden');

  renderEditorBanner();
  renderGroupsBar();

  const blocks = BlockModel.visibleBlocks(state.sourceSegments, state.edits);
  const hidden = BlockModel.hiddenBlocks(state.sourceSegments, state.edits);
  const visibleIds = blocks.map((block) => block.id);

  UI.blockList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  blocks.forEach((segment, index) => {
    fragment.appendChild(createBlockRow(segment, index, blocks.length, visibleIds));
  });
  UI.blockList.appendChild(fragment);

  if (UI.btnToggleHidden) {
    UI.btnToggleHidden.disabled = hidden.length === 0;
    UI.btnToggleHidden.textContent = `Nascosti (${hidden.length})`;
  }
  if (UI.blockEmpty) UI.blockEmpty.classList.toggle('hidden', blocks.length > 0);
  if (UI.btnAddGroup) UI.btnAddGroup.disabled = state.editorReadOnly;

  renderHiddenBlocks(hidden);
  updateUndoRedoButtons();
}

function getLegacyEditorText() {
  const legacy = UI.blockList?.querySelector('.legacy-document');
  return (legacy?.innerText || state.transcript?.legacyText || state.transcript?.text || '').trim();
}

function renderLegacyEditor() {
  showBlockEditor(true);
  UI.editorToolbar?.classList.remove('hidden');
  UI.blockList?.classList.remove('hidden');
  UI.hiddenBlocks?.classList.add('hidden');
  UI.groupsBar?.classList.add('hidden');
  UI.btnAddGroup?.classList.add('hidden');
  UI.btnToggleHidden?.classList.add('hidden');
  UI.blockEmpty?.classList.add('hidden');
  UI.btnUndo && (UI.btnUndo.disabled = true);
  UI.btnRedo && (UI.btnRedo.disabled = true);

  const banner = UI.editorBanner;
  banner.innerHTML = '';
  banner.className = 'editor-banner';
  const strong = document.createElement('strong');
  strong.textContent = 'Testo del vecchio editor.';
  const text = document.createElement('div');
  text.textContent = state.sourceSegments.length <= 1
    ? 'Questo testo non è ancora diviso in blocchi. Puoi applicarlo all’unico blocco disponibile oppure conservarlo come nuova revisione.'
    : 'Questo testo non è riconducibile ai segmenti originali. Scegli se creare una nuova revisione con il testo attuale o ripristinare i segmenti originali.';
  const actions = document.createElement('div');
  actions.className = 'banner-actions';

  const convert = document.createElement('button');
  convert.type = 'button';
  convert.textContent = state.sourceSegments.length === 1
    ? 'Applica al blocco unico'
    : 'Crea revisione dal testo';
  convert.addEventListener('click', () => convertLegacyText());

  const restore = document.createElement('button');
  restore.type = 'button';
  restore.textContent = 'Ripristina segmenti originali';
  restore.disabled = state.sourceSegments.length === 0;
  restore.addEventListener('click', () => restoreLegacySegments());

  actions.append(convert, restore);
  banner.append(strong, text, actions);

  UI.blockList.innerHTML = '';
  const editor = document.createElement('div');
  editor.className = 'legacy-document block-card';
  editor.contentEditable = state.editorReadOnly ? 'false' : 'true';
  editor.spellcheck = true;
  editor.style.whiteSpace = 'pre-wrap';
  editor.style.lineHeight = '1.65';
  editor.style.minHeight = '160px';
  editor.textContent = state.transcript?.legacyText || state.transcript?.text || '';

  let legacyTimer = null;
  editor.addEventListener('input', () => {
    clearTimeout(legacyTimer);
    setEditorStatus('saving', 'Salvataggio…');
    legacyTimer = setTimeout(async () => {
      await saveLegacyTranscriptText(editor.innerText);
    }, 1200);
  });
  editor.addEventListener('blur', () => {
    clearTimeout(legacyTimer);
    saveLegacyTranscriptText(editor.innerText);
  });

  UI.blockList.appendChild(editor);
  setEditorStatus('', '');
}

async function saveLegacyTranscriptText(text) {
  if (!state.activeRec || state.editorMode !== 'legacy' || state.editorReadOnly) return true;
  const recDir = state.activeRec.recDir;
  state.transcript.text = text;

  try {
    const result = await API.transcriptSave({
      recDir,
      transcript: state.transcript,
    });
    if (!state.activeRec || state.activeRec.recDir !== recDir) return true;
    if (result?.success) {
      setEditorStatus('saved', 'Salvato');
      if (result.transcript?.edits) state.edits = BlockModel.cloneEdits(result.transcript.edits);
      return true;
    }
    setEditorStatus('error', result?.error || 'Errore di salvataggio');
    showToast(result?.error || 'Errore di salvataggio', 'error', 3500);
    return false;
  } catch (err) {
    setEditorStatus('error', 'Errore di salvataggio');
    showToast(err.message || 'Errore di salvataggio', 'error', 3500);
    return false;
  }
}

async function convertLegacyText() {
  if (!state.activeRec || state.editorReadOnly) return;
  const recDir = state.activeRec.recDir;
  const text = getLegacyEditorText();
  if (!text) {
    showToast('Il testo è vuoto: nulla da convertire.', 'info', 2500);
    return;
  }

  if (state.sourceSegments.length === 1) {
    const segmentId = state.sourceSegments[0].id;
    BlockModel.pushHistory(state.editorHistory, state.edits);
    state.edits = BlockModel.clearLegacyText(
      BlockModel.setSegmentText(state.edits, segmentId, text),
    );
    state.editorMode = 'blocks';
    state.editorVersion += 1;
    await flushEditorSave({ force: true });
    renderTranscript();
    showToast('Testo applicato al blocco unico.', 'success', 2500);
    return;
  }

  try {
    const result = await API.revisionCreateFromText({
      recDir,
      kind: state.transcript?.kind || 'transcription',
      text,
      timing: 'whole-recording',
    });
    if (!state.activeRec || state.activeRec.recDir !== recDir) return;
    if (!result?.success) {
      showToast(result?.error || 'Conversione non riuscita', 'error', 3500);
      return;
    }
    applyTranscriptResult(result);
    refreshLibrary();
    showToast(`Nuova revisione ${result.revisionId} creata dal testo legacy.`, 'success', 3500);
  } catch (err) {
    showToast(err.message || 'Conversione non riuscita', 'error', 3500);
  }
}

async function restoreLegacySegments() {
  if (!state.activeRec || state.editorReadOnly) return;
  const ok = await confirmDialog(
    'Ripristinare i segmenti originali?',
    'Il testo del vecchio editor verrà rimosso dall’overlay. Le revisioni e il testo originale restano intatti.',
    'Ripristina',
    true,
  );
  if (!ok) return;

  BlockModel.pushHistory(state.editorHistory, state.edits);
  state.edits = BlockModel.clearLegacyText(state.edits);
  state.editorMode = 'blocks';
  state.editorVersion += 1;
  await flushEditorSave({ force: true });
  renderTranscript();
  showToast('Segmenti originali ripristinati.', 'success', 2500);
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
  renderPlainTranscript();
}

function renderPlainTranscript() {
  const { segments, text } = state.transcript;
  const canShowTimestamps = state.showTimestamps && transcriptSupportsTimestamps(state.transcript);

  UI.blockEditor?.classList.add('hidden');
  UI.transcriptContent?.classList.remove('hidden');
  UI.timestampsMargin?.classList.remove('hidden');

  if (!canShowTimestamps || !segments || segments.length === 0) {
    UI.timestampsMargin.classList.remove('visible');
    UI.timestampsMargin.innerHTML = '';
    UI.transcriptContent.textContent = text || '';
  } else {
    UI.timestampsMargin.classList.add('visible');
    const tsFragment = document.createDocumentFragment();
    const textFragment = document.createDocumentFragment();

    segments.forEach(seg => {
      const tsEl = document.createElement('span');
      tsEl.className = 'ts-mark';
      tsEl.textContent = formatTime(seg.start);
      tsEl.title = `Vai a ${formatTime(seg.start)}`;
      tsEl.setAttribute('role', 'button');
      tsEl.tabIndex = 0;
      const seek = () => seekPlayerTo(seg.start);
      tsEl.addEventListener('click', seek);
      tsEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          seek();
        }
      });
      tsFragment.appendChild(tsEl);

      const span = document.createElement('span');
      span.style.display = 'block';
      span.style.lineHeight = '1.5em';
      span.textContent = seg.text + ' ';
      textFragment.appendChild(span);
    });

    UI.timestampsMargin.replaceChildren(tsFragment);
    UI.transcriptContent.replaceChildren(textFragment);
  }
}

/**
 * I timestamp per segmento esistono solo se la revisione ha timing "segment".
 * Per anteprime live e trascrizioni legacy c'è solo la durata complessiva:
 * il toggle va disabilitato, non mostrato con valori finti.
 */
function transcriptSupportsTimestamps(transcript) {
  const segments = Array.isArray(transcript?.sourceSegments) && transcript.sourceSegments.length > 0
    ? transcript.sourceSegments
    : transcript?.segments;
  return !!transcript
    && transcript.timing === 'segment'
    && Array.isArray(segments)
    && segments.length > 0
    && !transcript.legacyDocumentText;
}

function syncTimestampsToggle(transcript) {
  const toggle = UI.toggleTimestamps;
  if (!toggle) return;

  const supported = transcriptSupportsTimestamps(transcript);
  const wrapper = toggle.closest('.toggle-wrap');
  toggle.disabled = !supported;
  wrapper?.classList.toggle('is-disabled', !supported);
  if (wrapper) {
    wrapper.title = supported
      ? 'Mostra o nascondi i marcatori temporali'
      : 'Timestamp non disponibili: per questa trascrizione è nota solo la durata complessiva';
  }

  if (!supported) {
    toggle.checked = false;
    state.showTimestamps = false;
  } else {
    toggle.checked = !!state.timestampsPreferred;
    state.showTimestamps = toggle.checked;
  }
}

function seekPlayerTo(seconds) {
  const audio = state.playerAudio;
  if (!audio || !audio.src || !Number.isFinite(seconds)) return;
  const max = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
  audio.currentTime = max ? Math.min(Math.max(0, seconds), max) : Math.max(0, seconds);
}

async function saveTranscript() {
  if (!state.activeRec || !state.transcript) return;

  if (state.editorMode === 'blocks') {
    await flushEditorSave({ force: true });
    return;
  }

  if (state.editorMode === 'legacy') {
    const legacy = UI.blockList?.querySelector('.legacy-document');
    await saveLegacyTranscriptText(legacy?.innerText || state.transcript.text || '');
    return;
  }

  const text = UI.transcriptContent.innerText.trim();
  state.transcript.text = text;
  await API.transcriptSave({
    recDir: state.activeRec.recDir,
    transcript: state.transcript,
  });
}

async function exportTranscript(format) {
  if (!state.activeRec) return;
  const text = currentTranscriptText();
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
  if (state.searchQuery) runFullTextSearch(state.searchQuery);
}

function renderLibrary() {
  const fragment = document.createDocumentFragment();
  const scrollTop = UI.libraryTree.scrollTop;

  const { folders, unsorted } = state.library;
  const query = state.searchQuery;
  const resultMap = state.searchResults !== null
    ? new Map(state.searchResults.map((item) => [item.recId, item]))
    : null;

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
    fragment.appendChild(emptyMsg);
    UI.libraryTree.replaceChildren(fragment);
    UI.libraryTree.scrollTop = scrollTop;
    return;
  }

  // Cartelle gruppi
  folders.forEach(folder => {
    const filteredRecordings = filterRecordings(folder.recordings || [], query, resultMap);
    const matchesFolder = !query || folder.name.toLowerCase().includes(query.toLowerCase());
    if (!query || matchesFolder || filteredRecordings.length > 0) {
      const folderEl = createFolderElement({
        ...folder,
        recordings: query && !matchesFolder ? filteredRecordings : folder.recordings,
      }, query.length > 0);
      fragment.appendChild(folderEl);
    }
  });

  // Non categorizzate (mostrata solo se contiene registrazioni o se stiamo cercando)
  const filteredUnsorted = filterRecordings(unsorted || [], query, resultMap);
  if ((!query && (unsorted || []).length > 0) || (query && filteredUnsorted.length > 0)) {
    const unsortedFolder = {
      name: '_unsorted',
      displayName: 'Non categorizzate',
      recordings: query ? filteredUnsorted : unsorted,
      isSystem: true,
    };
    const unsortedEl = createFolderElement(unsortedFolder, query.length > 0);
    fragment.appendChild(unsortedEl);
  }

  // Nessun risultato per la ricerca
  if (fragment.childElementCount === 0 && query) {
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

    fragment.appendChild(emptyMsg);
  }

  UI.libraryTree.replaceChildren(fragment);
  UI.libraryTree.scrollTop = scrollTop;
}

// Coalesce i ridisegni della sidebar: evita un rebuild completo a ogni tasto.
let libraryRenderQueued = false;
function scheduleLibraryRender() {
  if (libraryRenderQueued) return;
  libraryRenderQueued = true;
  requestAnimationFrame(() => {
    libraryRenderQueued = false;
    renderLibrary();
  });
}

function filterRecordings(recs, query, resultMap = null) {
  if (!query) return recs;

  // Se l'indice FTS5 ha risposto, è lui la fonte dei risultati: niente
  // fallback parziale che mostrerebbe falsi positivi.
  if (resultMap) {
    return recs
      .filter((rec) => resultMap.has(rec.recDir))
      .map((rec) => ({ ...rec, searchResult: resultMap.get(rec.recDir) }));
  }

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

  // Conserva lo stato aperto/chiuso del gruppo anche dopo un refresh (es. dopo
  // l'eliminazione di una nota): il menu a tendina non deve richiudersi.
  const folderKey = isSystem ? '_unsorted' : folder.name;
  const savedOpen = state.folderOpenState.get(folderKey);
  let isOpen = autoExpand ? true : (savedOpen === undefined
    ? (recordings.length > 0 && !isSystem)
    : savedOpen);
  // Durante la ricerca l'apertura è forzata e non va memorizzata.
  if (!autoExpand) state.folderOpenState.set(folderKey, isOpen);

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
    state.folderOpenState.set(folderKey, isOpen);
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
  const dateTimeStr = formatDateTime(rec.date);
  nameEl.title = `${rec.name || rec.dirName}\nData: ${dateTimeStr || 'N/D'}\nDurata: ${formatDuration(rec.duration) || '0:00'}`;

  const meta = document.createElement('div');
  meta.className = 'rec-item-meta';

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

  if (rec.searchResult?.snippetParts?.length) {
    const snippet = document.createElement('div');
    snippet.className = 'rec-item-snippet';
    for (const part of rec.searchResult.snippetParts) {
      if (part.highlighted) {
        const mark = document.createElement('mark');
        mark.textContent = part.text;
        snippet.appendChild(mark);
      } else {
        snippet.appendChild(document.createTextNode(part.text));
      }
    }
    info.appendChild(snippet);
  }

  // Azioni su registrazione
  const actions = document.createElement('div');
  actions.className = 'rec-item-actions';

  const renameBtn = document.createElement('button');
  renameBtn.className = 'rec-action-btn';
  renameBtn.title = 'Rinomina registrazione';
  renameBtn.innerHTML = ICONS.edit;
  renameBtn.onclick = (e) => { e.stopPropagation(); renameRecording(rec); };

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

  actions.appendChild(renameBtn);
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
  if (state.activeRec && state.activeRec.recDir !== rec.recDir) {
    try { await flushEditorSave({ force: true }); } catch (_) {}
  }

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
  state.edits = null;
  state.sourceSegments = [];
  state.editorMode = 'none';
  state.editorReadOnly = false;
  state.editorHistory = BlockModel.createHistory();
  state.revisions = [];
  state.activeRevisionId = null;
  state.showHiddenBlocks = false;
  renderRevisionBar();
  showBlockEditor(false);
  UI.transcriptContent.textContent = '';
  UI.timestampsMargin.innerHTML = '';

  // Avvia le due letture in parallelo: la nota appare prima.
  const transcriptPromise = API.transcriptRead({ recDir: rec.recDir });
  const audioPromise = API.audioGetPath({ recDir: rec.recDir });

  const result = await transcriptPromise;

  // Se nel frattempo l'utente ha aperto un'altra nota, scarta questa risposta.
  if (!state.activeRec || state.activeRec.recDir !== rec.recDir) return;

  if (result.success && result.transcript) {
    applyTranscriptResult(result);
  } else {
    resetTranscriptEditor();
    syncTimestampsToggle(null);
  }

  // Aggiorna badge e pulsante di trascrizione
  updateTranscriptStatusBadge();

  // Carica audio nel player della barra inferiore
  const audioResult = await audioPromise;

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

  // Modal rinomina (gruppi e registrazioni)
  UI.btnRenameCancel?.addEventListener('click', () => closeRenameDialog(null));
  UI.btnRenameConfirm?.addEventListener('click', () => {
    const value = UI.inputRename?.value.trim();
    if (!value) { UI.inputRename?.focus(); return; }
    closeRenameDialog(value);
  });
  UI.inputRename?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') UI.btnRenameConfirm?.click();
  });
  UI.modalRename?.addEventListener('click', (e) => {
    if (e.target === UI.modalRename) closeRenameDialog(null);
  });

  // Doppio click sul titolo della nota per rinominarla.
  UI.recNameLabel?.addEventListener('dblclick', () => {
    if (state.activeRec) renameRecording(state.activeRec);
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
  const newName = await openRenameDialog(`Rinomina gruppo "${oldName}"`, oldName);
  if (!newName || newName === oldName) return;

  const activeIsInFolder = !!state.activeRec &&
    state.activeRec.recDir.split('/').slice(-2, -1)[0] === oldName;

  if (activeIsInFolder) await saveTranscript();

  const result = await API.folderRename({ oldName, newName });
  if (result.success) {
    // Mantieni lo stato aperto/chiuso anche dopo la rinomina del gruppo.
    if (state.folderOpenState.has(oldName)) {
      state.folderOpenState.set(result.name, state.folderOpenState.get(oldName));
      state.folderOpenState.delete(oldName);
    }

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

async function renameRecording(rec) {
  if (!rec?.recDir) return;
  const currentName = rec.name || rec.dirName || '';
  const newName = await openRenameDialog('Rinomina registrazione', currentName);
  if (!newName || newName === currentName) return;

  const result = await API.recordingRename({ recDir: rec.recDir, newName });
  if (!result?.success) {
    showToast(result?.error || 'Impossibile rinominare la registrazione', 'error', 3000);
    return;
  }

  const savedName = result.name || newName;
  rec.name = savedName;

  if (state.activeRec && state.activeRec.recDir === rec.recDir) {
    state.activeRec.name = savedName;
    if (UI.recNameLabel) UI.recNameLabel.textContent = savedName;
  }

  showToast(`Registrazione rinominata in "${savedName}"`, 'success', 2000);
  await refreshLibrary();
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
