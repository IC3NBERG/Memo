/* ══════════════════════════════════════════════════════════════
   CRUNCH — app.js
   Bootstrap del renderer: stato, elementi DOM, viste, player e comandi.
   I sottosistemi vivono in recording.js, editor.js, transcription.js,
   library.js, archive.js, modals.js, models.js, waveform.js.
   ══════════════════════════════════════════════════════════════ */

'use strict';

const ICONS = window.MEMO_ICONS || {};
const API = window.crunchAPI || window.memoAPI;
const BlockModel = window.MemoBlockModel || {};
const AudioSources = window.MemoAudioSources || {};

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
  audioSource: null,
  audioSourceKind: 'microphone',
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
  editsStatus: 'ok',           // 'ok' | 'stale-edits' | 'invalid-edits'
  sourceSegments: [],
  editorMode: 'none',          // 'none' | 'blocks' | 'legacy'
  editorReadOnly: false,
  transcriptSaveTimer: null,
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
  searchFilters: {
    folder: '',
    dateFrom: '',
    dateTo: '',
    duration: '',
    speaker: '',
  },
  searchFacets: { folders: [], speakers: [] },

  // Integrità e cestino
  integrityReport: null,
  archiveModalKind: null,
  archiveModalContext: null,

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
  btnToggleFilters:    $('btn-toggle-filters'),
  iconFilterSlot:      $('icon-filter-slot'),
  filterCount:         $('filter-count'),
  searchFilters:       $('search-filters'),
  filterFolder:        $('filter-folder'),
  filterDateFrom:      $('filter-date-from'),
  filterDateTo:        $('filter-date-to'),
  filterDuration:      $('filter-duration'),
  filterSpeaker:       $('filter-speaker'),
  btnResetFilters:     $('btn-reset-filters'),
  btnRebuildSearch:    $('btn-rebuild-search'),
  iconRebuildSlot:     $('icon-rebuild-slot'),
  btnVerifyArchive:    $('btn-verify-archive'),
  iconVerifySlot:      $('icon-verify-slot'),
  libraryTree:         $('library-tree'),
  appVersionLabel:     $('app-version-label'),
  btnOpenTrash:        $('btn-open-trash'),
  iconTrashSlot:       $('icon-trash-slot'),
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
  btnResetView:        $('btn-reset-view'),
  iconResetViewSlot:   $('icon-reset-view-slot'),
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

  modalArchive:        $('modal-archive'),
  modalArchiveIconSlot:$('modal-archive-icon-slot'),
  archiveModalTitle:   $('archive-modal-title'),
  archiveModalIntro:   $('archive-modal-intro'),
  archiveModalBody:    $('archive-modal-body'),
  btnArchiveSecondary: $('btn-archive-secondary'),
  btnArchiveClose:     $('btn-archive-close'),

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

  // Dock Verticale Sospeso (v1.4.0)
  btnDockRec:          $('btn-dock-rec'),
  dockIconRecSlot:     $('dock-icon-rec-slot'),
  btnDockHome:         $('btn-dock-home'),
  dockIconHomeSlot:    $('dock-icon-home-slot'),
  btnDockLibrary:      $('btn-dock-library'),
  dockIconLibrarySlot: $('dock-icon-library-slot'),
  btnDockSearch:       $('btn-dock-search'),
  dockIconSearchSlot:  $('dock-icon-search-slot'),
  btnDockEqualizer:    $('btn-dock-equalizer'),
  dockIconEqualizerSlot: $('dock-icon-equalizer-slot'),
  btnDockTrash:        $('btn-dock-trash'),
  dockIconTrashSlot:   $('dock-icon-trash-slot'),
  btnDockSettings:     $('btn-dock-settings'),
  dockIconSettingsSlot: $('dock-icon-settings-slot'),

  // Theme Switcher
  btnThemeToggle:      $('btn-theme-toggle'),
  themeToggleIconSlot: $('theme-toggle-icon-slot'),

  // Cassetto Studio Audio DSP
  btnToggleDspDrawer:  $('btn-toggle-dsp-drawer'),
  bottomDspIconSlot:   $('bottom-dsp-icon-slot'),
  dspDrawer:           $('dsp-drawer'),
  btnCloseDspDrawer:   $('btn-close-dsp-drawer'),
  dspDrawerIconSlot:   $('dsp-drawer-icon-slot'),

  // Home Dashboard Card Buttons & Slots
  btnDashNewGroup:     $('btn-dash-new-group'),
  btnDashOpenDsp:      $('btn-dash-open-dsp'),
  btnDashOpenPrivacy:  $('btn-dash-open-privacy'),
  cardIconRecSlot:     $('card-icon-rec-slot'),
  cardIconRecentSlot:  $('card-icon-recent-slot'),
  cardIconGroupsSlot:  $('card-icon-groups-slot'),
  cardIconRefineSlot:  $('card-icon-refine-slot'),
  cardIconDspSlot:     $('card-icon-dsp-slot'),
  cardIconVaultSlot:   $('card-icon-vault-slot'),
  cardIconAddGroupSlot: $('card-icon-add-group-slot'),
  cardIconSlidersSlot: $('card-icon-sliders-slot'),
  cardIconShieldSlot:  $('card-icon-shield-slot'),
  statIconNotesSlot:   $('stat-icon-notes-slot'),
  statIconTimeSlot:    $('stat-icon-time-slot'),
  statIconFoldersSlot: $('stat-icon-folders-slot'),
  statIconEngineSlot:  $('stat-icon-engine-slot'),
};

// ══════════════════════════════════════════════════════════════
// 1. INIEZIONE ICONE SVG AD HOC (ZERO EMOJI)
// ══════════════════════════════════════════════════════════════
function injectStaticIcons() {
  if (UI.brandIconSlot) UI.brandIconSlot.innerHTML = ICONS.waveformLogo || ICONS.mic;
  if (UI.modelIconSlot) UI.modelIconSlot.innerHTML = ICONS.cpu;
  if (UI.updateIconSlot) UI.updateIconSlot.innerHTML = ICONS.sparkles;
  if (UI.iconInfoSlot) UI.iconInfoSlot.innerHTML = ICONS.info;
  if (UI.iconNewFolderSlot) UI.iconNewFolderSlot.innerHTML = ICONS.folderPlus;
  if (UI.searchIconSlot) UI.searchIconSlot.innerHTML = ICONS.search;
  if (UI.iconFilterSlot) UI.iconFilterSlot.innerHTML = ICONS.filter || ICONS.sliders;
  if (UI.iconRebuildSlot) UI.iconRebuildSlot.innerHTML = ICONS.refresh;
  if (UI.iconVerifySlot) UI.iconVerifySlot.innerHTML = ICONS.shield;
  if (UI.iconTrashSlot) UI.iconTrashSlot.innerHTML = ICONS.trash;
  if (UI.iconResetViewSlot) UI.iconResetViewSlot.innerHTML = ICONS.refresh;
  if (UI.iconUpdateSlot) UI.iconUpdateSlot.innerHTML = ICONS.refresh;

  // Dock Verticale Sospeso (Pierre Sù)
  if (UI.dockIconRecSlot) UI.dockIconRecSlot.innerHTML = ICONS.mic;
  if (UI.dockIconHomeSlot) UI.dockIconHomeSlot.innerHTML = ICONS.home;
  if (UI.dockIconLibrarySlot) UI.dockIconLibrarySlot.innerHTML = ICONS.library;
  if (UI.dockIconSearchSlot) UI.dockIconSearchSlot.innerHTML = ICONS.search;
  if (UI.dockIconEqualizerSlot) UI.dockIconEqualizerSlot.innerHTML = ICONS.equalizer;
  if (UI.dockIconTrashSlot) UI.dockIconTrashSlot.innerHTML = ICONS.trash;
  if (UI.dockIconSettingsSlot) UI.dockIconSettingsSlot.innerHTML = ICONS.settings;

  // Cassetto Studio Audio DSP
  if (UI.bottomDspIconSlot) UI.bottomDspIconSlot.innerHTML = ICONS.equalizer;
  if (UI.dspDrawerIconSlot) UI.dspDrawerIconSlot.innerHTML = ICONS.equalizer;

  // Dashboard Statistiche
  if (UI.statIconNotesSlot) UI.statIconNotesSlot.innerHTML = ICONS.document;
  if (UI.statIconTimeSlot) UI.statIconTimeSlot.innerHTML = ICONS.clock;
  if (UI.statIconFoldersSlot) UI.statIconFoldersSlot.innerHTML = ICONS.folder;
  if (UI.statIconEngineSlot) UI.statIconEngineSlot.innerHTML = ICONS.cpu;

  // Dashboard Card Grid
  if (UI.cardIconRecSlot) UI.cardIconRecSlot.innerHTML = ICONS.mic;
  if (UI.cardIconRecentSlot) UI.cardIconRecentSlot.innerHTML = ICONS.history;
  if (UI.cardIconGroupsSlot) UI.cardIconGroupsSlot.innerHTML = ICONS.folder;
  if (UI.cardIconRefineSlot) UI.cardIconRefineSlot.innerHTML = ICONS.sparkles;
  if (UI.cardIconDspSlot) UI.cardIconDspSlot.innerHTML = ICONS.equalizer;
  if (UI.cardIconVaultSlot) UI.cardIconVaultSlot.innerHTML = ICONS.shieldCheck || ICONS.shield;
  if (UI.cardIconAddGroupSlot) UI.cardIconAddGroupSlot.innerHTML = ICONS.folderPlus;
  if (UI.cardIconSlidersSlot) UI.cardIconSlidersSlot.innerHTML = ICONS.sliders;
  if (UI.cardIconShieldSlot) UI.cardIconShieldSlot.innerHTML = ICONS.shield;

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
  if (UI.modalArchiveIconSlot) UI.modalArchiveIconSlot.innerHTML = ICONS.shield;
  if (UI.modalRecIconSlot) UI.modalRecIconSlot.innerHTML = ICONS.mic;

  if (UI.modalInfoIconSlot) UI.modalInfoIconSlot.innerHTML = ICONS.info;
  if (UI.infoMicIconSlot) UI.infoMicIconSlot.innerHTML = ICONS.mic;
  if (UI.infoSlidersIconSlot) UI.infoSlidersIconSlot.innerHTML = ICONS.sliders;
  if (UI.infoCpuIconSlot) UI.infoCpuIconSlot.innerHTML = ICONS.cpu;
}

// ══════════════════════════════════════════════════════════════
// 1b. GESTIONE VISTE, DOCK E TEMI
// ══════════════════════════════════════════════════════════════

function applyTheme(theme) {
  const current = theme === 'light-warm' ? 'light-warm' : 'dark-warm';
  if (current === 'light-warm') {
    document.documentElement.setAttribute('data-theme', 'light-warm');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try { localStorage.setItem('crunch-theme', current); } catch (_) {}
  if (UI.themeToggleIconSlot) {
    UI.themeToggleIconSlot.innerHTML = current === 'light-warm' ? ICONS.moon : ICONS.sun;
  }
}

function initTheme() {
  let saved = 'dark-warm';
  try { saved = localStorage.getItem('crunch-theme') || 'dark-warm'; } catch (_) {}
  applyTheme(saved);
  UI.btnThemeToggle?.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light-warm';
    applyTheme(isLight ? 'dark-warm' : 'light-warm');
  });
}

function setDockActive(tab) {
  document.querySelectorAll('.dock-btn').forEach(btn => btn.classList.remove('active'));
  if (tab === 'home') UI.btnDockHome?.classList.add('active');
  else if (tab === 'library') UI.btnDockLibrary?.classList.add('active');
  else if (tab === 'rec') UI.btnDockRec?.classList.add('active');
}

// Garantisce che sia visibile UNA SOLA vista centrale: elimina le sovrapposizioni.
function showMainView(view) {
  const showEmpty = view === 'empty';
  const showRecording = view === 'recording';
  const showTranscript = view === 'transcript';

  UI.emptyState.classList.toggle('hidden', !showEmpty);
  UI.recordingView?.classList.toggle('hidden', !showRecording);
  UI.transcriptView.classList.toggle('hidden', !showTranscript);

  if (showEmpty) setDockActive('home');
  else if (showRecording) setDockActive('rec');
  else if (showTranscript) setDockActive('library');

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
  initTheme();
  setupDockAndDashboard();
  setupResizer();
  setupRecControls();
  setupTranscriptControls();
  setupEditorControls();
  setupPlayerControls();
  setupModalHandlers();
  setupSearchControls();
  setupArchiveControls();
  setupWaveform();
  setupKeyboardNavigation();
  setupUpdaterControls();
  setupModelDownloadListeners();
  setupTranslationModelListeners();
  window.PrivacyUI?.setupPrivacyControls?.();
  window.PrivacyUI?.setupDiagnosticsControls?.();

  window.addEventListener('resize', updateBannerOffset);
  updateBannerOffset();

  // Versione app
  if (API?.getVersion) {
    try {
      const ver = await API.getVersion();
      if (UI.appVersionLabel && ver) UI.appVersionLabel.textContent = `v${ver}`;
    } catch (_) {}
  }

  // Il blocco applicativo deve coprire l'interfaccia prima di caricare i dati.
  await window.PrivacyUI?.initPrivacyLock?.();

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
  state.editsStatus = 'ok';
  clearTimeout(state.transcriptSaveTimer);
  state.transcriptSaveTimer = null;
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
  updateResetViewButton();

  // Se una registrazione è in corso torniamo alla vista REC, mai alla home.
  showMainView(state.recording ? 'recording' : 'empty');

  showToast('Nota chiusa', 'info', 1500);
}

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Con il blocco attivo la tastiera non deve raggiungere l'interfaccia.
    if (!document.getElementById('lock-screen')?.classList.contains('hidden')) return;

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
        } else if (openModal === UI.modalArchive) {
          closeArchiveModal();
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

function setupDockAndDashboard() {
  UI.btnDockRec?.addEventListener('click', () => {
    if (state.recording) {
      showMainView('recording');
    } else {
      startRecording();
    }
  });

  UI.btnDockHome?.addEventListener('click', () => {
    if (state.activeRec) {
      closeActiveRecording();
    } else {
      showMainView('empty');
    }
  });

  UI.btnDockLibrary?.addEventListener('click', () => {
    setDockActive('library');
    UI.libraryTree?.scrollIntoView({ behavior: 'smooth' });
  });

  UI.btnDockSearch?.addEventListener('click', () => {
    UI.searchInput?.focus();
    if (UI.searchFilters?.classList.contains('hidden')) {
      UI.btnToggleFilters?.click();
    }
  });

  UI.btnDockEqualizer?.addEventListener('click', () => {
    UI.dspDrawer?.classList.toggle('hidden');
    UI.btnToggleDspDrawer?.classList.toggle('active', !UI.dspDrawer?.classList.contains('hidden'));
  });

  UI.btnToggleDspDrawer?.addEventListener('click', () => {
    UI.dspDrawer?.classList.toggle('hidden');
    UI.btnToggleDspDrawer?.classList.toggle('active', !UI.dspDrawer?.classList.contains('hidden'));
  });

  UI.btnCloseDspDrawer?.addEventListener('click', () => {
    UI.dspDrawer?.classList.add('hidden');
    UI.btnToggleDspDrawer?.classList.remove('active');
  });

  UI.btnDockTrash?.addEventListener('click', () => {
    UI.btnOpenTrash?.click();
  });

  UI.btnDockSettings?.addEventListener('click', () => {
    UI.btnPrivacy?.click();
  });

  // Pulsanti interni alle card della dashboard
  UI.btnDashNewGroup?.addEventListener('click', () => {
    UI.btnNewFolder?.click();
  });

  UI.btnDashOpenDsp?.addEventListener('click', () => {
    UI.dspDrawer?.classList.remove('hidden');
    UI.btnToggleDspDrawer?.classList.add('active');
  });

  UI.btnDashOpenPrivacy?.addEventListener('click', () => {
    UI.btnPrivacy?.click();
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

  UI.btnToggleFilters?.addEventListener('click', () => {
    const panel = UI.searchFilters;
    if (!panel) return;
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    UI.btnToggleFilters.setAttribute('aria-expanded', String(opening));
    UI.btnToggleFilters.classList.toggle('active', opening);
    if (opening) loadSearchFacets();
  });

  const onFilterChange = () => {
    readSearchFiltersFromUI();
    runSearchWithFilters();
  };
  [UI.filterFolder, UI.filterDuration, UI.filterSpeaker].forEach((control) => {
    control?.addEventListener('change', onFilterChange);
  });
  [UI.filterDateFrom, UI.filterDateTo].forEach((control) => {
    control?.addEventListener('change', onFilterChange);
  });

  UI.btnResetFilters?.addEventListener('click', () => {
    state.searchFilters = {
      folder: '',
      dateFrom: '',
      dateTo: '',
      duration: '',
      speaker: '',
    };
    if (UI.filterFolder) UI.filterFolder.value = '';
    if (UI.filterDateFrom) UI.filterDateFrom.value = '';
    if (UI.filterDateTo) UI.filterDateTo.value = '';
    if (UI.filterDuration) UI.filterDuration.value = '';
    if (UI.filterSpeaker) UI.filterSpeaker.value = '';
    updateSearchFilterBadge();
    runSearchWithFilters();
  });

  UI.btnRebuildSearch?.addEventListener('click', rebuildSearchIndexFromUI);
}

function durationFilterBounds(key) {
  switch (key) {
    case 'under5': return [null, 300];
    case '5to20': return [300, 1200];
    case '20to60': return [1200, 3600];
    case 'over60': return [3600, null];
    default: return [null, null];
  }
}

function localDayIso(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function buildSearchFilterPayload() {
  const filters = state.searchFilters;
  const [durationMin, durationMax] = durationFilterBounds(filters.duration);
  return {
    folder: filters.folder === ''
      ? null
      : (filters.folder === '__unsorted__' ? '' : filters.folder),
    dateFrom: localDayIso(filters.dateFrom, false),
    dateTo: localDayIso(filters.dateTo, true),
    durationMin,
    durationMax,
    speaker: filters.speaker || null,
  };
}

function activeSearchFilterCount() {
  const filters = state.searchFilters;
  let count = 0;
  if (filters.folder) count += 1;
  if (filters.dateFrom) count += 1;
  if (filters.dateTo) count += 1;
  if (filters.duration) count += 1;
  if (filters.speaker) count += 1;
  return count;
}

function updateSearchFilterBadge() {
  const count = activeSearchFilterCount();
  if (UI.filterCount) {
    UI.filterCount.textContent = String(count);
    UI.filterCount.classList.toggle('hidden', count === 0);
  }
  UI.btnToggleFilters?.classList.toggle('has-filters', count > 0);
}

function readSearchFiltersFromUI() {
  state.searchFilters = {
    folder: UI.filterFolder?.value || '',
    dateFrom: UI.filterDateFrom?.value || '',
    dateTo: UI.filterDateTo?.value || '',
    duration: UI.filterDuration?.value || '',
    speaker: UI.filterSpeaker?.value || '',
  };
  updateSearchFilterBadge();
}

function runSearchWithFilters() {
  clearTimeout(state.searchTimer);
  if (!state.searchQuery) {
    scheduleLibraryRender();
    return;
  }

  // Invalida le risposte in volo: un filtro cambiato non deve essere
  // sovrascritto da una query partita con i filtri precedenti.
  state.searchSeq += 1;
  state.searchResults = null;
  state.searchResultIds = new Set();
  state.searchTimer = setTimeout(() => runFullTextSearch(state.searchQuery), 80);
  scheduleLibraryRender();
}

function renderSearchFilterOptions() {
  if (UI.filterFolder) {
    const folders = new Set();
    for (const folder of state.searchFacets.folders || []) {
      if (typeof folder === 'string' && folder) folders.add(folder);
    }
    for (const folder of state.library.folders || []) {
      if (folder?.name) folders.add(folder.name);
    }

    const hasUnsorted = (state.searchFacets.folders || []).includes('')
      || (state.library.unsorted || []).length > 0;
    const current = state.searchFilters.folder;
    const optionValues = new Set(['']);

    UI.filterFolder.replaceChildren();
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'Tutti i gruppi';
    UI.filterFolder.appendChild(allOption);

    if (hasUnsorted) {
      const unsortedOption = document.createElement('option');
      unsortedOption.value = '__unsorted__';
      unsortedOption.textContent = 'Non categorizzate';
      UI.filterFolder.appendChild(unsortedOption);
      optionValues.add('__unsorted__');
    }

    for (const folder of [...folders].sort((a, b) => a.localeCompare(b, 'it'))) {
      const option = document.createElement('option');
      option.value = folder;
      option.textContent = folder;
      UI.filterFolder.appendChild(option);
      optionValues.add(folder);
    }

    if (current && !optionValues.has(current)) {
      state.searchFilters.folder = '';
    }
    UI.filterFolder.value = state.searchFilters.folder;
  }

  if (UI.filterSpeaker) {
    const speakers = [...new Set(state.searchFacets.speakers || [])]
      .filter((speaker) => typeof speaker === 'string' && speaker)
      .sort((a, b) => a.localeCompare(b, 'it'));
    const current = state.searchFilters.speaker;
    const optionValues = new Set(['']);

    UI.filterSpeaker.replaceChildren();
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'Tutti gli speaker';
    UI.filterSpeaker.appendChild(allOption);

    for (const speaker of speakers) {
      const option = document.createElement('option');
      option.value = speaker;
      option.textContent = speaker;
      UI.filterSpeaker.appendChild(option);
      optionValues.add(speaker);
    }

    if (current && !optionValues.has(current)) {
      state.searchFilters.speaker = '';
    }
    UI.filterSpeaker.value = state.searchFilters.speaker;
  }

  updateSearchFilterBadge();
}

async function loadSearchFacets() {
  if (typeof API.searchFacets !== 'function') return;
  try {
    const result = await API.searchFacets();
    if (result?.success) {
      state.searchFacets = {
        folders: Array.isArray(result.folders) ? result.folders : [],
        speakers: Array.isArray(result.speakers) ? result.speakers : [],
      };
      renderSearchFilterOptions();
    }
  } catch (_) {
    // I filtri restano utilizzabili con i valori ricavati dalla libreria.
  }
}

async function rebuildSearchIndexFromUI() {
  const button = UI.btnRebuildSearch;
  if (!button || button.disabled) return;
  button.disabled = true;
  button.classList.add('is-loading');
  showToast('Ricostruzione dell’indice di ricerca…', 'info', 1800);

  try {
    const result = await API.searchRebuild();
    if (!result?.success) {
      showToast(result?.error || 'Ricostruzione dell’indice non riuscita', 'error', 4500);
      return;
    }

    await refreshLibrary();
    await loadSearchFacets();

    const parts = [`${result.indexed || 0} aggiornate`];
    if (result.skipped) parts.push(`${result.skipped} invariate`);
    if (result.failed) parts.push(`${result.failed} non indicizzabili`);
    showToast(`Indice ricostruito: ${parts.join(', ')}`, 'success', 3500);
  } catch (err) {
    showToast(err?.message || 'Ricostruzione dell’indice non riuscita', 'error', 4500);
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
  }
}

async function runFullTextSearch(query) {
  const seq = ++state.searchSeq;
  const filters = buildSearchFilterPayload();

  try {
    const result = await API.searchQuery({ query, limit: 80, filters });
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

  UI.btnResetView?.addEventListener('click', () => {
    resetTranscriptView().catch(() => {});
  });

  UI.btnCopyAll?.addEventListener('click', () => {
    const text = currentTranscriptText();
    if (!text) { showToast('Nessun testo da copiare', 'info', 1500); return; }
    navigator.clipboard.writeText(text).then(() => showToast('Testo copiato negli appunti!', 'success', 1500));
  });

  UI.btnExportTxt?.addEventListener('click', () => exportTranscript('txt'));
  UI.btnExportMd?.addEventListener('click', () => exportTranscript('md'));

  // Auto-salvataggio testo modificato
  UI.transcriptContent?.addEventListener('input', () => {
    updateResetViewButton();
    clearTimeout(state.transcriptSaveTimer);
    state.transcriptSaveTimer = setTimeout(() => saveTranscript(), 1500);
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
// AVVIO
// ══════════════════════════════════════════════════════════════
init();
