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
  highpassNode: null,
  noiseGateNode: null,
  noiseGateAnalyser: null,
  noiseGateInterval: null,
  streamSource: null,
  micStream: null,
  modelReady: false,
  showTimestamps: false,
  playerAudio: document.getElementById('hidden-audio'),

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
  transcriptionTranslate: false,
};

// ─── Elementi DOM ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const UI = {
  // Titlebar
  brandIconSlot:       $('brand-icon-slot'),

  // Banners
  modelBanner:         $('model-banner'),
  modelIconSlot:       $('model-icon-slot'),
  modelProgressFill:   $('model-progress-fill'),
  modelProgressPct:    $('model-progress-pct'),
  modelBannerDesc:     $('model-banner-desc'),

  updateBanner:        $('update-banner'),
  updateIconSlot:      $('update-icon-slot'),
  updateBannerText:    $('update-banner-text'),
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
  transcriptContent:   $('transcript-content'),
  timestampsMargin:    $('timestamps-margin'),

  // Bottom Bar (Solo REC e timer)
  btnRec:              $('btn-rec'),
  recTimer:            $('rec-timer'),
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
  checkHpSlot:         $('check-hp-slot'),
  toggleNoisegate:     $('toggle-noisegate'),
  checkNgSlot:         $('check-ng-slot'),
  toggleCompressor:    $('toggle-compressor'),
  checkCompSlot:       $('check-comp-slot'),
  toggleAutogain:      $('toggle-autogain'),
  checkGainSlot:       $('check-gain-slot'),

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

  [UI.checkHpSlot, UI.checkNgSlot, UI.checkCompSlot, UI.checkGainSlot].forEach(slot => {
    if (slot) slot.innerHTML = ICONS.check;
  });

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

  // Versione app
  if (API?.getVersion) {
    try {
      const ver = await API.getVersion();
      if (UI.appVersionLabel && ver) UI.appVersionLabel.textContent = `Crunch v${ver}`;
    } catch (_) {}
  }

  // Carica libreria
  await refreshLibrary();

  // Controllo modello Whisper
  const modelOk = await API.modelCheck();
  if (modelOk) {
    state.modelReady = true;
  } else {
    startModelDownload();
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

  // Mostra schermata vuota / home
  UI.transcriptView.classList.add('hidden');
  UI.emptyState.classList.remove('hidden');

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
        } else {
          openModal.classList.add('hidden');
        }
        return;
      }
      if (state.activeRec && !state.recording) {
        closeActiveRecording();
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
  // Barra inferiore: solo REC (avvia registrazione)
  UI.btnRec.addEventListener('click', () => {
    if (!state.recording) startRecording();
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
  UI.toggleCenterLive?.addEventListener('change', () => {
    state.liveTranscriptionEnabled = UI.toggleCenterLive.checked;
    if (state.liveTranscriptionEnabled) {
      UI.liveTextContainer?.classList.remove('hidden');
      UI.liveOffHint?.classList.add('hidden');
      if (state.recording && !state.paused) {
        startLiveTranscriptionLoop();
      }
      showToast('Trascrizione Live attiva', 'info', 2000);
    } else {
      clearInterval(state.liveChunkInterval);
      state.liveChunkInterval = null;
      state.liveSampleBuffer = [];
      UI.liveTextContainer?.classList.add('hidden');
      UI.liveOffHint?.classList.remove('hidden');
      showToast('Trascrizione Live disattivata (risparmio batteria)', 'info', 2000);
    }
  });
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 16000,
        channelCount: 1,
      },
    });

    state.micStream = stream;
    state.audioContext = new AudioContext({ sampleRate: 16000 });
    const source = state.audioContext.createMediaStreamSource(stream);
    state.streamSource = source;

    // Pipeline audio avanzata
    const chain = buildAudioPipeline(source);

    // Cattura PCM separata per i chunk live: evita di ri-decodificare
    // l'intera registrazione a ogni intervallo.
    setupLiveAudioCapture(chain);

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

    // Mostra la vista centrale di registrazione
    UI.emptyState.classList.add('hidden');
    UI.transcriptView.classList.add('hidden');
    UI.recordingView?.classList.remove('hidden');

    UI.btnRec.classList.add('recording');
    if (UI.recCenterTimer) UI.recCenterTimer.textContent = '00:00:00';
    if (UI.recTimer) UI.recTimer.textContent = '00:00:00';
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
    if (state.micStream) {
      state.micStream.getTracks().forEach(t => t.stop());
      state.micStream = null;
    }
    if (state.audioContext) {
      try { state.audioContext.close(); } catch (_) {}
      state.audioContext = null;
    }
    showToast('Errore microfono: ' + err.message, 'error', 4000);
  }
}

function buildAudioPipeline(sourceNode) {
  const ctx = state.audioContext;
  let node = sourceNode;

  // 1. Filtro passa-alto (80Hz)
  if (UI.toggleHighpass.checked) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 80;
    hp.Q.value = 0.7;
    node.connect(hp);
    node = hp;
    state.highpassNode = hp;
  }

  // 2. Noise gate (-45 dB) con isteresi e rilascio graduale
  if (UI.toggleNoisegate.checked) {
    const gateAnalyser = ctx.createAnalyser();
    gateAnalyser.fftSize = 512;
    const gateGain = ctx.createGain();
    gateGain.gain.value = 1;

    // L'AnalyserNode lascia passare il segnale: analizza e poi va al gain
    node.connect(gateAnalyser);
    gateAnalyser.connect(gateGain);

    const timeData = new Float32Array(gateAnalyser.fftSize);
    const threshold = Math.pow(10, -45 / 20);
    const gateInterval = setInterval(() => {
      gateAnalyser.getFloatTimeDomainData(timeData);
      let sum = 0;
      for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
      const rms = Math.sqrt(sum / timeData.length);
      const now = ctx.currentTime;
      gateGain.gain.setTargetAtTime(
        rms >= threshold ? 1 : 0,
        now,
        rms >= threshold ? 0.02 : 0.12
      );
    }, 50);

    state.noiseGateNode = gateGain;
    state.noiseGateAnalyser = gateAnalyser;
    state.noiseGateInterval = gateInterval;
    node = gateGain;
  }

  // 3. Compressore dinamico
  if (UI.toggleCompressor.checked) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -48;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    node.connect(comp);
    node = comp;
    state.compressorNode = comp;
  }

  // 4. Auto-gain adattivo
  if (UI.toggleAutogain.checked) {
    const gain = ctx.createGain();
    gain.gain.value = 2.4;
    node.connect(gain);
    node = gain;
    state.gainNode = gain;
  }

  return node;
}

function cleanupAudioPipeline() {
  if (state.noiseGateInterval) {
    clearInterval(state.noiseGateInterval);
    state.noiseGateInterval = null;
  }
  if (state.noiseGateAnalyser) {
    try { state.noiseGateAnalyser.disconnect(); } catch (_) {}
    state.noiseGateAnalyser = null;
  }
  if (state.noiseGateNode) {
    try { state.noiseGateNode.disconnect(); } catch (_) {}
    state.noiseGateNode = null;
  }
}

// Cattura PCM in tempo reale per la trascrizione live: ogni intervallo
// inviamo solo i campioni nuovi, non l'intera lezione.
function setupLiveAudioCapture(chain) {
  const ctx = state.audioContext;
  const processor = ctx.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (e) => {
    if (!state.liveTranscriptionEnabled || !state.recording || state.paused) return;
    const input = e.inputBuffer.getChannelData(0);
    state.liveSampleBuffer.push(new Float32Array(input));
  };

  // Un nodo ScriptProcessor elabora solo se collegato alla destinazione:
  // il gain a 0 evita eco o doppio audio.
  const silentGain = ctx.createGain();
  silentGain.gain.value = 0;
  chain.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(ctx.destination);

  state.liveProcessorNode = processor;
  state.liveSilentGain = silentGain;
  state.liveSampleRate = ctx.sampleRate;
}

function cleanupLiveAudioCapture() {
  if (state.liveProcessorNode) {
    state.liveProcessorNode.onaudioprocess = null;
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
    state.liveSampleBuffer = [];
    UI.btnRec.classList.remove('recording');

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

    UI.btnRec.classList.remove('recording');
    if (UI.centerPauseText) UI.centerPauseText.textContent = 'Pausa';
    if (UI.centerPauseIconSlot) UI.centerPauseIconSlot.innerHTML = ICONS.pause;

    UI.recordingView?.classList.add('hidden');

    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.onstop = async () => {
        await saveRecording();
        resolve();
      };
      state.mediaRecorder.stop();
    } else {
      resolve();
    }

    // Cleanup cattura live e audio context
    cleanupLiveAudioCapture();
    cleanupAudioPipeline();
    if (state.micStream) {
      state.micStream.getTracks().forEach(t => t.stop());
      state.micStream = null;
    }
    if (state.audioContext) {
      state.audioContext.close();
      state.audioContext = null;
    }
  });
}

async function saveRecording() {
  if (state.audioChunks.length === 0) {
    showToast('Nessun audio registrato', 'error', 3000);
    UI.emptyState.classList.remove('hidden');
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
      UI.emptyState.classList.add('hidden');
      UI.transcriptView.classList.remove('hidden');
      if (state.playerAudio?.getAttribute('src')) {
        showPlayerOrWaveform('player');
      }
    } else {
      UI.transcriptView.classList.add('hidden');
      UI.emptyState.classList.remove('hidden');
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
  }, 1000);
}

// ─── Waveform ─────────────────────────────────────────────────
function setupWaveform() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const canvas = UI.waveformCanvas;
  const wrap = canvas.parentElement;
  if (!wrap) return;
  canvas.width = wrap.offsetWidth * window.devicePixelRatio;
  canvas.height = wrap.offsetHeight * window.devicePixelRatio;
  canvas.style.width = wrap.offsetWidth + 'px';
  canvas.style.height = wrap.offsetHeight + 'px';
}

function drawWaveform() {
  const canvas = UI.waveformCanvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const analyser = state.analyserNode;

  if (!analyser || !state.recording) {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#3F3228';
    ctx.lineWidth = 1 * window.devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    return;
  }

  requestAnimationFrame(drawWaveform);

  const bufLen = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufLen);
  analyser.getByteTimeDomainData(dataArray);

  ctx.clearRect(0, 0, W, H);

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#D4723C');
  grad.addColorStop(0.5, '#E8A849');
  grad.addColorStop(1, '#D4723C');

  ctx.lineWidth = 2 * window.devicePixelRatio;
  ctx.strokeStyle = grad;
  ctx.shadowColor = '#E8A849';
  ctx.shadowBlur = 6;
  ctx.beginPath();

  const sliceWidth = W / bufLen;
  let x = 0;

  for (let i = 0; i < bufLen; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * H) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }

  ctx.lineTo(W, H / 2);
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
    if (!state.modelReady) {
      showToast('Attendere: modello Whisper in caricamento...', 'info', 3000);
      return;
    }
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

    const isTranslate = typeof payload?.translate === 'boolean'
      ? payload.translate
      : state.transcriptionTranslate;

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
    showToast(isTranslate ? 'Traduzione in Inglese completata al 100%!' : 'Trascrizione integrale completata al 100%!', 'success', 3000);
  });

  API.onTranscriptionError((err) => {
    UI.transcribeProgress?.classList.add('hidden');
    UI.transcribeButtons?.classList.remove('hidden');
    showToast('Errore trascrizione: ' + err, 'error', 5000);
  });
}

// Loop trascrizione live rapida / istantanea (intervallo 3.5s)
function startLiveTranscriptionLoop() {
  clearInterval(state.liveChunkInterval);
  state.liveSampleBuffer = [];

  const runChunk = async () => {
    if (!state.recording || state.paused || state.liveTranscribing) return;

    const samples = takeLiveSamples();
    if (!samples) return;

    // Evita di inviare silenzio a Whisper: riduce allucinazioni e consumo GPU
    let energy = 0;
    for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
    const rms = Math.sqrt(energy / samples.length);
    if (rms < Math.pow(10, -50 / 20)) return;

    const isTranslate = UI.selectTranscribeMode?.value === 'translate';
    const sampleRate = state.liveSampleRate || 16000;

    state.liveTranscribing = true;
    try {
      const wavBuffer = encodeWav(samples, sampleRate);

      // Inviamo solo i campioni nuovi: costo costante per ogni intervallo
      const res = await API.transcriptionChunk({
        buffer: wavBuffer,
        language: 'auto',
        translate: isTranslate,
      });

      // Se la registrazione è terminata nel frattempo, non sporcare la nota
      if (!state.recording) return;

      if (res.success && res.text) {
        const text = res.text.trim();
        if (text) {
          state.liveTextAccumulated = state.liveTextAccumulated
            ? `${state.liveTextAccumulated} ${text}`
            : text;
          state.liveTextTranslated = isTranslate;

          // Aggiorna anteprima live al centro della schermata di registrazione
          if (UI.liveStreamText) {
            UI.liveStreamText.textContent = state.liveTextAccumulated;
            UI.liveStreamText.scrollTop = UI.liveStreamText.scrollHeight;
          }

          // Se la vista trascrizione è aperta, aggiorna subito il testo a video
          if (UI.transcriptContent && (state.activeRec || !UI.transcriptView.classList.contains('hidden'))) {
            UI.transcriptContent.textContent = state.liveTextAccumulated;
          }
        }
      }
    } catch (_) {
    } finally {
      state.liveTranscribing = false;
    }
  };

  // Esegui ogni 3.5 secondi per dare feedback immediato
  state.liveChunkInterval = setInterval(runChunk, 3500);
}

// Estrae e svuota i campioni PCM accumulati dall'ultimo invio
function takeLiveSamples() {
  if (!state.liveSampleBuffer.length) return null;

  let total = 0;
  for (const chunk of state.liveSampleBuffer) total += chunk.length;
  const minSamples = Math.round((state.liveSampleRate || 16000) * 0.4);
  if (total < minSamples) return null;

  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of state.liveSampleBuffer) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  state.liveSampleBuffer = [];
  return merged;
}

function startTranscription(rec, isTranslate = false) {
  if (!rec || !rec.recDir) return;

  state.transcriptionTranslate = isTranslate;

  UI.transcribeButtons?.classList.add('hidden');
  UI.transcribeProgress?.classList.remove('hidden');
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
}

function updateTranscriptStatusBadge() {
  if (!UI.transcriptStatusBadge) return;
  const rec = state.activeRec;
  if (!rec || !rec.hasTranscript) {
    UI.transcriptStatusBadge.className = 'transcript-status-badge hidden';
    UI.transcriptStatusBadge.innerHTML = '';
    if (UI.btnTranscribeText) UI.btnTranscribeText.textContent = 'Trascrivi';
    UI.btnTranscribeAfter?.classList.add('highlight');
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
    if (UI.btnTranscribeText) UI.btnTranscribeText.textContent = 'Ritrascrivi';
    UI.btnTranscribeAfter?.classList.remove('highlight');
  } else {
    // È un'anteprima Live parziale o non ancora verificata al 100%
    UI.transcriptStatusBadge.className = 'transcript-status-badge preview';
    UI.transcriptStatusBadge.innerHTML = `<span class="memo-icon icon-xs">${ICONS.sparkles || ''}</span><span>Anteprima Live (Parziale)</span>`;
    if (UI.btnTranscribeText) UI.btnTranscribeText.textContent = 'Perfeziona Completa (100%)';
    UI.btnTranscribeAfter?.classList.add('highlight');
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

  // Non categorizzate
  const filteredUnsorted = filterRecordings(unsorted || [], query);
  if (!query || filteredUnsorted.length > 0) {
    const unsortedFolder = {
      name: '_unsorted',
      displayName: 'Non categorizzate',
      recordings: query ? filteredUnsorted : unsorted,
      isSystem: true,
    };
    const unsortedEl = createFolderElement(unsortedFolder, query.length > 0);
    UI.libraryTree.appendChild(unsortedEl);
  }

  // Nessun risultato
  if (UI.libraryTree.children.length === 0 && query) {
    const emptyMsg = document.createElement('div');
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

  const chevron = document.createElement('span');
  chevron.className = 'folder-chevron';
  chevron.innerHTML = ICONS.chevronRight;

  const folderIcon = document.createElement('span');
  folderIcon.className = 'folder-icon';
  folderIcon.innerHTML = isSystem ? ICONS.folder : ICONS.folder;

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
  if (isOpen) {
    wrap.classList.add('open');
    chevron.classList.add('open');
  }

  header.addEventListener('click', () => {
    isOpen = !isOpen;
    wrap.classList.toggle('open', isOpen);
    chevron.classList.toggle('open', isOpen);
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

  // Mostra vista nota e nascondi altre viste
  UI.emptyState.classList.add('hidden');
  UI.recordingView?.classList.add('hidden');
  UI.transcriptView.classList.remove('hidden');
  UI.transcribeProgress?.classList.add('hidden');
  UI.transcribeButtons?.classList.remove('hidden');

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
  if (result.success && result.transcript) {
    state.transcript = result.transcript;
    renderTranscript();
  }

  // Aggiorna badge e pulsante di trascrizione
  updateTranscriptStatusBadge();

  // Carica audio nel player della barra inferiore
  const audioResult = await API.audioGetPath({ recDir: rec.recDir });
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
  if (which === 'player') {
    UI.playerControls.classList.remove('hidden');
    UI.waveformCanvas.parentElement.style.flex = '0';
    UI.waveformCanvas.parentElement.style.width = '0';
  } else {
    UI.playerControls.classList.add('hidden');
    UI.waveformCanvas.parentElement.style.flex = '1';
    UI.waveformCanvas.parentElement.style.width = '';
    resizeCanvas();
  }
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
          UI.transcriptView.classList.add('hidden');
          UI.emptyState.classList.remove('hidden');
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
    btn.className = 'move-folder-opt';
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
// 11. DOWNLOAD MODELLO WHISPER
// ══════════════════════════════════════════════════════════════
function startModelDownload() {
  UI.modelBanner.classList.remove('hidden');

  API.onModelProgress((data) => {
    UI.modelProgressFill.style.width = data.percent + '%';
    UI.modelProgressPct.textContent = data.percent + '%';
    const mb = Math.round(data.downloaded / (1024 * 1024));
    const totalMb = Math.round(data.total / (1024 * 1024));
    UI.modelBannerDesc.textContent = `Scaricamento modello neurale Large-v3 Turbo: ${mb} MB / ${totalMb} MB…`;
  });

  API.onModelDone(() => {
    state.modelReady = true;
    UI.modelBanner.classList.add('hidden');
    showToast('Modello Whisper pronto per l\'inferenza Metal!', 'success', 4000);
  });

  API.onModelError((err) => {
    UI.modelBannerDesc.textContent = `Errore download: ${err}. Riprova più tardi.`;
    showToast('Errore nel download del modello Whisper: ' + err, 'error', 6000);
  });

  API.modelDownload();
}

// ══════════════════════════════════════════════════════════════
// 12. AUTO-UPDATER
// ══════════════════════════════════════════════════════════════
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
      if (UI.updateBannerText) UI.updateBannerText.textContent = info.message;
      if (UI.btnUpdateAction) UI.btnUpdateAction.classList.add('hidden');
      showToast(info.message, 'info', 4000);
    } else if (info.type === 'downloaded') {
      UI.updateBanner?.classList.remove('hidden');
      if (UI.updateBannerText) UI.updateBannerText.textContent = info.message;
      if (UI.btnUpdateAction) UI.btnUpdateAction.classList.remove('hidden');
      showToast('Aggiornamento pronto! Clicca "Riavvia e Aggiorna"', 'success', 6000);
    } else if (info.type === 'not-available') {
      showToast('Crunch è già aggiornato all\'ultima versione', 'success', 2500);
    } else if (info.type === 'error') {
      showToast(`Aggiornamenti: ${info.message}`, 'error', 3500);
    }
  });

  API.onUpdateProgress?.((p) => {
    if (UI.updateBannerText) {
      UI.updateBannerText.textContent = `Scaricamento aggiornamento... ${p.percent}%`;
    }
  });
}

// ══════════════════════════════════════════════════════════════
// AVVIO
// ══════════════════════════════════════════════════════════════
init();
