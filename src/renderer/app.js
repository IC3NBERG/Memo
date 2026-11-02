/* ══════════════════════════════════════════════════════════════
   MEMO — app.js
   Logica completa con icone SVG ad hoc, Trascrizione Live,
   Uscita da nota, Ricerca veloce e Navigazione migliorata
   ══════════════════════════════════════════════════════════════ */

'use strict';

const ICONS = window.MEMO_ICONS || {};

// ─── Toast Notifiche ──────────────────────────────────────────
const toastContainer = document.createElement('div');
toastContainer.id = 'toast-container';
document.body.appendChild(toastContainer);

function showToast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? ICONS.check : (type === 'error' ? ICONS.close : ICONS.sparkles);
  el.innerHTML = `<span class="memo-icon icon-sm">${icon || ''}</span><span>${msg}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), duration);
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
  streamSource: null,
  micStream: null,
  modelReady: false,
  showTimestamps: false,
  playerAudio: document.getElementById('hidden-audio'),

  // Trascrizione Live
  liveTranscriptionEnabled: false,
  liveChunkInterval: null,
  lastLiveChunkIndex: 0,
  liveTextAccumulated: '',
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
  btnTranscribeLive:   $('btn-transcribe-live'),
  iconLiveSlot:        $('icon-live-slot'),
  liveTranscribeText:  $('live-transcribe-text'),
  btnTranscribeAfter:  $('btn-transcribe-after'),
  iconTranscribeSlot:  $('icon-transcribe-slot'),
  selectTranscribeMode:$('select-transcribe-mode'),
  iconTranslateSlot:   $('icon-translate-slot'),
  liveIndicatorBadge:  $('live-indicator-badge'),
  liveIndicatorText:   $('live-indicator-text'),
  transcribeProgress:  $('transcribe-progress'),
  transcribeProgressFill: $('transcribe-progress-fill'),
  transcribeProgressPct:  $('transcribe-progress-pct'),
  transcribeStatusText:   $('transcribe-status-text'),

  // Editor trascrizione
  transcriptContent:   $('transcript-content'),
  timestampsMargin:    $('timestamps-margin'),

  // Bottom Bar (Rec & Player)
  btnRec:              $('btn-rec'),
  btnPause:            $('btn-pause'),
  iconPauseSlot:       $('icon-pause-slot'),
  btnStop:             $('btn-stop'),
  iconStopSlot:        $('icon-stop-slot'),
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
};

// ══════════════════════════════════════════════════════════════
// 1. INIEZIONE ICONE SVG AD HOC
// ══════════════════════════════════════════════════════════════
function injectStaticIcons() {
  if (UI.brandIconSlot) UI.brandIconSlot.innerHTML = ICONS.mic;
  if (UI.modelIconSlot) UI.modelIconSlot.innerHTML = ICONS.cpu;
  if (UI.updateIconSlot) UI.updateIconSlot.innerHTML = ICONS.sparkles;
  if (UI.iconNewFolderSlot) UI.iconNewFolderSlot.innerHTML = ICONS.folderPlus;
  if (UI.searchIconSlot) UI.searchIconSlot.innerHTML = ICONS.search;
  if (UI.iconUpdateSlot) UI.iconUpdateSlot.innerHTML = ICONS.refresh;

  if (UI.emptyIconSlot) UI.emptyIconSlot.innerHTML = ICONS.audioWave;
  if (UI.emptyRecIconSlot) UI.emptyRecIconSlot.innerHTML = ICONS.mic;

  if (UI.iconBackSlot) UI.iconBackSlot.innerHTML = ICONS.back;
  if (UI.iconClockSlot) UI.iconClockSlot.innerHTML = ICONS.clock;
  if (UI.iconCopySlot) UI.iconCopySlot.innerHTML = ICONS.copy;
  if (UI.iconTxtSlot) UI.iconTxtSlot.innerHTML = ICONS.download;
  if (UI.iconMdSlot) UI.iconMdSlot.innerHTML = ICONS.download;

  if (UI.iconLiveSlot) UI.iconLiveSlot.innerHTML = ICONS.micLive;
  if (UI.iconTranscribeSlot) UI.iconTranscribeSlot.innerHTML = ICONS.sparkles;
  if (UI.iconTranslateSlot) UI.iconTranslateSlot.innerHTML = ICONS.translate;

  if (UI.iconPauseSlot) UI.iconPauseSlot.innerHTML = ICONS.pause;
  if (UI.iconStopSlot) UI.iconStopSlot.innerHTML = ICONS.stop;
  if (UI.iconPlayerPlaySlot) UI.iconPlayerPlaySlot.innerHTML = ICONS.play;
  if (UI.iconVolumeSlot) UI.iconVolumeSlot.innerHTML = ICONS.volume;

  [UI.checkHpSlot, UI.checkNgSlot, UI.checkCompSlot, UI.checkGainSlot].forEach(slot => {
    if (slot) slot.innerHTML = ICONS.check;
  });

  if (UI.modalNewFolderIconSlot) UI.modalNewFolderIconSlot.innerHTML = ICONS.folderPlus;
  if (UI.modalMoveIconSlot) UI.modalMoveIconSlot.innerHTML = ICONS.move;
  if (UI.modalTrashIconSlot) UI.modalTrashIconSlot.innerHTML = ICONS.trash;
  if (UI.modalRecIconSlot) UI.modalRecIconSlot.innerHTML = ICONS.mic;
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
  if (window.memoAPI?.getVersion) {
    try {
      const ver = await window.memoAPI.getVersion();
      if (UI.appVersionLabel && ver) UI.appVersionLabel.textContent = `Memo v${ver}`;
    } catch (_) {}
  }

  // Carica libreria
  await refreshLibrary();

  // Controllo modello Whisper
  const modelOk = await window.memoAPI.modelCheck();
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
        openModal.classList.add('hidden');
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
  UI.btnRec.addEventListener('click', () => {
    if (!state.recording) startRecording();
  });

  UI.btnPause.addEventListener('click', () => {
    if (!state.recording) return;
    if (state.paused) resumeRecording();
    else pauseRecording();
  });

  UI.btnStop.addEventListener('click', () => {
    if (!state.recording) return;
    stopRecording();
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
    state.lastLiveChunkIndex = 0;
    state.liveTextAccumulated = '';

    // Aggiorna UI
    UI.btnRec.classList.add('recording');
    UI.btnPause.disabled = false;
    UI.btnStop.disabled = false;
    showPlayerOrWaveform('waveform');

    startTimer();
    drawWaveform();

    // Se la trascrizione live è attiva, avvia il ciclo di trascrizione live
    if (state.liveTranscriptionEnabled) {
      startLiveTranscriptionLoop();
    }

    showToast('Registrazione avviata', 'info', 1500);
  } catch (err) {
    showToast('Microfono non disponibile: ' + err.message, 'error', 4000);
  }
}

function buildAudioPipeline(source) {
  const ctx = state.audioContext;
  let node = source;

  // 1. High-pass filter (80Hz)
  if (UI.toggleHighpass.checked) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 80;
    hp.Q.value = 0.7;
    node.connect(hp);
    node = hp;
    state.highpassNode = hp;
  }

  // 2. Compressore dinamico
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

  // 3. Auto-gain adattivo
  if (UI.toggleAutogain.checked) {
    const gain = ctx.createGain();
    gain.gain.value = 2.4;
    node.connect(gain);
    node = gain;
    state.gainNode = gain;
  }

  return node;
}

function pauseRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    state.mediaRecorder.pause();
    state.paused = true;
    clearInterval(state.recTimerInterval);
    clearInterval(state.liveChunkInterval);
    UI.iconPauseSlot.innerHTML = ICONS.play;
    UI.btnPause.title = 'Riprendi registrazione';
    UI.btnRec.classList.remove('recording');
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
    UI.iconPauseSlot.innerHTML = ICONS.pause;
    UI.btnPause.title = 'Metti in pausa';
    UI.btnRec.classList.add('recording');
    showToast('Registrazione ripresa', 'info', 1500);
  }
}

function stopRecording() {
  return new Promise((resolve) => {
    clearInterval(state.recTimerInterval);
    clearInterval(state.liveChunkInterval);
    state.recording = false;
    state.paused = false;

    UI.btnRec.classList.remove('recording');
    UI.btnPause.disabled = true;
    UI.btnStop.disabled = true;
    UI.iconPauseSlot.innerHTML = ICONS.pause;
    UI.liveIndicatorBadge.classList.add('hidden');

    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.onstop = async () => {
        await saveRecording();
        resolve();
      };
      state.mediaRecorder.stop();
    } else {
      resolve();
    }

    // Cleanup audio context
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
  if (state.audioChunks.length === 0) return;

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

  const numChannels = 1;
  const sampleRate = decoded.sampleRate;
  const samples = decoded.getChannelData(0);
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
  UI.selectRecFolder.innerHTML = '<option value="">— Non categorizzata —</option>';
  state.library.folders.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.name;
    opt.textContent = f.name;
    UI.selectRecFolder.appendChild(opt);
  });

  UI.inputRecName.value = '';
  UI.modalSaveName.classList.remove('hidden');
  UI.inputRecName.focus();

  const save = async () => {
    const name = UI.inputRecName.value.trim() || 'Lezione';
    const folder = UI.selectRecFolder.value || null;
    UI.modalSaveName.classList.add('hidden');

    const result = await window.memoAPI.recordingSave({
      buffer: wavBuffer,
      name,
      folder,
    });

    if (result.success) {
      await window.memoAPI.recordingUpdateDuration({
        recDir: result.recDir,
        duration: state.recDuration,
      });

      // Se c'era del testo accumulato dalla trascrizione live, salvalo subito!
      if (state.liveTextAccumulated) {
        const transcriptObj = {
          segments: [{ start: 0, end: state.recDuration, text: state.liveTextAccumulated }],
          text: state.liveTextAccumulated
        };
        await window.memoAPI.transcriptSave({
          recDir: result.recDir,
          transcript: transcriptObj
        });
      }

      showToast(`Registrazione salvata: ${name}`, 'success', 2500);
      await refreshLibrary();

      // Apri automaticamente la registrazione
      const library = state.library;
      let saved = library.unsorted.find(r => r.recDir === result.recDir);
      if (!saved) {
        for (const f of library.folders) {
          const found = f.recordings.find(r => r.recDir === result.recDir);
          if (found) { saved = found; break; }
        }
      }
      if (saved) openRecording(saved);
    } else {
      showToast('Errore salvataggio: ' + result.error, 'error', 4000);
    }

    showPlayerOrWaveform('waveform');
    UI.recTimer.textContent = '00:00:00';
    state.recDuration = 0;
  };

  UI.btnSaveConfirm.onclick = save;
  UI.inputRecName.onkeydown = (e) => { if (e.key === 'Enter') save(); };
  UI.btnSaveCancel.onclick = () => {
    UI.modalSaveName.classList.add('hidden');
    showPlayerOrWaveform('waveform');
  };
}

// ─── Timer registrazione ──────────────────────────────────────
function startTimer() {
  state.recTimerInterval = setInterval(() => {
    state.recDuration++;
    const h = Math.floor(state.recDuration / 3600);
    const m = Math.floor((state.recDuration % 3600) / 60);
    const s = state.recDuration % 60;
    UI.recTimer.textContent =
      `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
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
// 5. TRASCRIZIONE & TRASCRIZIONE LIVE
// ══════════════════════════════════════════════════════════════
function setupTranscriptControls() {
  // Toggle Trascrizione Live
  UI.btnTranscribeLive.addEventListener('click', () => {
    state.liveTranscriptionEnabled = !state.liveTranscriptionEnabled;
    UI.btnTranscribeLive.classList.toggle('active', state.liveTranscriptionEnabled);
    if (state.liveTranscriptionEnabled) {
      showToast('Trascrizione Live ATTIVA durante la registrazione', 'success', 3000);
      if (state.recording && !state.paused) {
        startLiveTranscriptionLoop();
      }
    } else {
      clearInterval(state.liveChunkInterval);
      UI.liveIndicatorBadge.classList.add('hidden');
      showToast('Trascrizione Live disattivata', 'info', 2000);
    }
  });

  // Trascrizione post-registrazione
  UI.btnTranscribeAfter.addEventListener('click', () => {
    if (!state.activeRec) return;
    if (!state.modelReady) {
      showToast('Attendere: modello Whisper in caricamento...', 'info', 3000);
      return;
    }
    const mode = UI.selectTranscribeMode.value; // 'transcribe' | 'translate'
    startTranscription(state.activeRec, mode === 'translate');
  });

  UI.toggleTimestamps.addEventListener('change', () => {
    state.showTimestamps = UI.toggleTimestamps.checked;
    renderTranscript();
  });

  UI.btnCopyAll.addEventListener('click', () => {
    const text = UI.transcriptContent.innerText.trim();
    if (!text) { showToast('Nessun testo da copiare', 'info', 1500); return; }
    navigator.clipboard.writeText(text).then(() => showToast('Testo copiato negli appunti!', 'success', 1500));
  });

  UI.btnExportTxt.addEventListener('click', () => exportTranscript('txt'));
  UI.btnExportMd.addEventListener('click', () => exportTranscript('md'));

  // Auto-salvataggio testo modificato
  let saveTimeout;
  UI.transcriptContent.addEventListener('input', () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveTranscript(), 1500);
  });
}

// Loop trascrizione live ogni 12 secondi
function startLiveTranscriptionLoop() {
  clearInterval(state.liveChunkInterval);

  UI.liveIndicatorBadge.classList.remove('hidden');
  const isTranslate = UI.selectTranscribeMode.value === 'translate';
  UI.liveIndicatorText.textContent = isTranslate ? 'Traduzione Live in corso…' : 'Trascrizione Live in corso…';

  state.liveChunkInterval = setInterval(async () => {
    if (!state.recording || state.paused || state.audioChunks.length === 0) return;

    try {
      // Prendi l'audio accumulato
      const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
      const arrayBuffer = await blob.arrayBuffer();
      const wavBuffer = await convertToWav(arrayBuffer);

      // Invia al backend per trascrizione ultra-rapida con GPU Metal
      const res = await window.memoAPI.transcriptionChunk({
        buffer: wavBuffer,
        language: 'it',
        translate: isTranslate,
      });

      if (res.success && res.text) {
        state.liveTextAccumulated = res.text;
        // Se la vista trascrizione è aperta, aggiorna subito il testo a video!
        if (state.activeRec || !UI.transcriptView.classList.contains('hidden')) {
          UI.transcriptContent.textContent = res.text;
        }
      }
    } catch (_) {}
  }, 12000);
}

function startTranscription(rec, isTranslate = false) {
  if (!rec || !rec.recDir) return;

  UI.transcribeButtons.classList.add('hidden');
  UI.transcribeProgress.classList.remove('hidden');
  UI.transcribeProgressFill.style.width = '0%';
  UI.transcribeProgressPct.textContent = '0%';
  UI.transcribeStatusText.textContent = isTranslate ? 'Traduzione con Metal M4…' : 'Trascrizione con Metal M4…';

  window.memoAPI.transcriptionStart({
    audioPath: rec.audioPath,
    recDir: rec.recDir,
    language: 'it',
    translate: isTranslate,
  });

  window.memoAPI.onTranscriptionProgress((pct) => {
    UI.transcribeProgressFill.style.width = pct + '%';
    UI.transcribeProgressPct.textContent = pct + '%';
  });

  window.memoAPI.onTranscriptionDone((transcript) => {
    state.transcript = transcript;
    UI.transcribeProgress.classList.add('hidden');
    UI.transcribeButtons.classList.remove('hidden');

    if (state.activeRec) state.activeRec.hasTranscript = true;

    renderTranscript();
    refreshLibrary();
    showToast('Trascrizione completata!', 'success', 3000);
  });

  window.memoAPI.onTranscriptionError((err) => {
    UI.transcribeProgress.classList.add('hidden');
    UI.transcribeButtons.classList.remove('hidden');
    showToast('Errore trascrizione: ' + err, 'error', 5000);
  });
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
  await window.memoAPI.transcriptSave({
    recDir: state.activeRec.recDir,
    transcript: state.transcript,
  });
}

async function exportTranscript(format) {
  if (!state.activeRec) return;
  const text = UI.transcriptContent.innerText.trim();
  await window.memoAPI.transcriptExport({
    recDir: state.activeRec.recDir,
    format,
    text,
  });
}

// ══════════════════════════════════════════════════════════════
// 6. LIBRERIA & GESTIONE MATERIE
// ══════════════════════════════════════════════════════════════
async function refreshLibrary() {
  state.library = await window.memoAPI.libraryGet();
  renderLibrary();
}

function renderLibrary() {
  UI.libraryTree.innerHTML = '';

  const { folders, unsorted } = state.library;
  const query = state.searchQuery;

  // Cartelle materia
  folders.forEach(folder => {
    const filteredRecordings = filterRecordings(folder.recordings || [], query);
    // Se c'è ricerca e la cartella corrisponde o ha registrazioni corrispondenti
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
    emptyMsg.innerHTML = `<span class="memo-icon icon-lg" style="margin-bottom:6px; opacity:0.6;">${ICONS.search}</span><br/>Nessuna registrazione trovata per "<strong>${query}</strong>"`;
    UI.libraryTree.appendChild(emptyMsg);
  }
}

function filterRecordings(recs, query) {
  if (!query) return recs;
  return recs.filter(r => {
    const nameMatch = (r.name || r.dirName || '').toLowerCase().includes(query);
    return nameMatch;
  });
}

function createFolderElement(folder, autoExpand = false) {
  const isSystem = folder.isSystem;
  const displayName = folder.displayName || folder.name;
  const recordings = folder.recordings || [];

  const wrap = document.createElement('div');
  wrap.className = 'folder-wrap';

  const header = document.createElement('div');
  header.className = `folder-item ${autoExpand ? 'expanded' : ''}`;

  const arrow = document.createElement('span');
  arrow.className = 'folder-arrow';
  arrow.innerHTML = ICONS.chevronRight;

  const icon = document.createElement('span');
  icon.className = 'folder-icon';
  icon.innerHTML = isSystem ? ICONS.inbox : ICONS.folder;

  const name = document.createElement('span');
  name.className = 'folder-name';
  name.textContent = displayName;

  const count = document.createElement('span');
  count.className = 'folder-count';
  count.textContent = recordings.length;

  header.appendChild(arrow);
  header.appendChild(icon);
  header.appendChild(name);
  header.appendChild(count);

  // Azioni su cartella
  if (!isSystem) {
    const actions = document.createElement('div');
    actions.className = 'folder-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'folder-action-btn';
    renameBtn.title = 'Rinomina materia';
    renameBtn.innerHTML = ICONS.edit;
    renameBtn.onclick = (e) => { e.stopPropagation(); renameFolder(folder.name); };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'folder-action-btn danger';
    deleteBtn.title = 'Elimina materia';
    deleteBtn.innerHTML = ICONS.trash;
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteFolder(folder.name); };

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    header.appendChild(actions);
  }

  wrap.appendChild(header);

  // Lista registrazioni
  const list = document.createElement('div');
  list.className = `recordings-list ${autoExpand ? '' : 'hidden'}`;

  recordings.forEach(rec => {
    const recEl = createRecordingElement(rec, folder.name);
    list.appendChild(recEl);
  });

  wrap.appendChild(list);

  header.addEventListener('click', () => {
    const isExpanded = !list.classList.contains('hidden');
    list.classList.toggle('hidden', isExpanded);
    header.classList.toggle('expanded', !isExpanded);
    // Cambia icona cartella aperta/chiusa se non è inbox
    if (!isSystem) {
      icon.innerHTML = !isExpanded ? ICONS.folderOpen : ICONS.folder;
    }
  });

  return wrap;
}

function createRecordingElement(rec, folderName) {
  const el = document.createElement('div');
  el.className = `rec-item ${rec.hasTranscript ? 'has-transcript' : ''}`;
  if (state.activeRec && state.activeRec.recDir === rec.recDir) {
    el.classList.add('active');
  }

  const icon = document.createElement('span');
  icon.className = 'rec-item-icon';
  icon.innerHTML = rec.hasTranscript ? ICONS.document : ICONS.audioWave;

  const info = document.createElement('div');
  info.className = 'rec-item-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'rec-item-name';
  nameEl.textContent = rec.name || rec.dirName;

  const meta = document.createElement('div');
  meta.className = 'rec-item-meta';

  const badge = document.createElement('span');
  badge.className = `rec-badge-tag ${rec.hasTranscript ? 'badge-transcript' : 'badge-audio'}`;
  badge.textContent = rec.hasTranscript ? 'Testo' : 'Audio';
  meta.appendChild(badge);

  const parts = [];
  if (rec.date) parts.push(formatDate(rec.date));
  if (rec.duration) parts.push(formatDuration(rec.duration));
  if (parts.length > 0) {
    const textSpan = document.createElement('span');
    textSpan.textContent = parts.join(' · ');
    meta.appendChild(textSpan);
  }

  info.appendChild(nameEl);
  info.appendChild(meta);

  // Azioni su registrazione
  const actions = document.createElement('div');
  actions.className = 'rec-item-actions';

  const moveBtn = document.createElement('button');
  moveBtn.className = 'rec-action-btn';
  moveBtn.title = 'Sposta in altra materia';
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

  // Mostra vista nota e nascondi empty state
  UI.emptyState.classList.add('hidden');
  UI.transcriptView.classList.remove('hidden');

  // Breadcrumb
  const displayFolder = rec.folder || folderName || 'Non categorizzate';
  UI.breadcrumbFolder.textContent = displayFolder === '_unsorted' ? 'Non categorizzate' : displayFolder;
  UI.recNameLabel.textContent = rec.name || rec.dirName;

  // Evidenzia elemento attivo nella sidebar
  document.querySelectorAll('.rec-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.rec-item').forEach(el => {
    if (el.querySelector('.rec-item-name')?.textContent === (rec.name || rec.dirName)) {
      el.classList.add('active');
    }
  });

  // Carica trascrizione esistente
  state.transcript = null;
  UI.transcriptContent.textContent = '';
  UI.timestampsMargin.innerHTML = '';

  const result = await window.memoAPI.transcriptRead({ recDir: rec.recDir });
  if (result.success && result.transcript) {
    state.transcript = result.transcript;
    renderTranscript();
  }

  // Carica audio nel player della barra inferiore
  const audioResult = await window.memoAPI.audioGetPath({ recDir: rec.recDir });
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
// 9. MODALI & OPERAZIONI MATERIA
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
    const result = await window.memoAPI.folderCreate({ name });
    UI.modalFolder.classList.add('hidden');
    if (result.success) {
      showToast(`Materia "${result.name}" creata`, 'success', 2000);
      await refreshLibrary();
    } else {
      showToast(result.error, 'error', 3000);
    }
  });

  [UI.modalFolder, UI.modalMove, UI.modalConfirm, UI.modalSaveName].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });
}

async function renameFolder(oldName) {
  const newName = prompt(`Nuovo nome per "${oldName}":`, oldName);
  if (!newName || newName === oldName) return;
  const result = await window.memoAPI.folderRename({ oldName, newName });
  if (result.success) {
    showToast(`Rinominata in "${result.name}"`, 'success', 2000);
    await refreshLibrary();
  } else {
    showToast(result.error, 'error', 3000);
  }
}

function deleteFolder(name) {
  showConfirmModal(
    `Elimina materia "${name}"`,
    `Le registrazioni contenute saranno spostate in "Non categorizzate". Vuoi continuare?`,
    async () => {
      const result = await window.memoAPI.folderDelete({ name });
      if (result.success) {
        showToast('Materia eliminata', 'success', 2000);
        await refreshLibrary();
      } else {
        showToast(result.error, 'error', 3000);
      }
    }
  );
}

function showMoveModal(rec) {
  UI.moveFolderList.innerHTML = '';

  const unsortedBtn = document.createElement('button');
  unsortedBtn.className = 'move-folder-item';
  unsortedBtn.innerHTML = `<span class="memo-icon">${ICONS.inbox}</span> <span>Non categorizzate</span>`;
  unsortedBtn.onclick = () => moveRec(rec, null);
  UI.moveFolderList.appendChild(unsortedBtn);

  state.library.folders.forEach(f => {
    if (f.name === rec.folder) return;
    const btn = document.createElement('button');
    btn.className = 'move-folder-item';
    btn.innerHTML = `<span class="memo-icon">${ICONS.folder}</span> <span>${f.name}</span>`;
    btn.onclick = () => moveRec(rec, f.name);
    UI.moveFolderList.appendChild(btn);
  });

  UI.modalMove.classList.remove('hidden');
  UI.btnMoveCancel.onclick = () => UI.modalMove.classList.add('hidden');
}

async function moveRec(rec, targetFolder) {
  UI.modalMove.classList.add('hidden');
  const result = await window.memoAPI.recordingMove({
    recDir: rec.recDir,
    targetFolder,
  });
  if (result.success) {
    showToast(`Spostata in "${targetFolder || 'Non categorizzate'}"`, 'success', 2000);
    if (state.activeRec && state.activeRec.recDir === rec.recDir) {
      state.activeRec.recDir = result.newPath;
      state.activeRec.folder = targetFolder;
      UI.breadcrumbFolder.textContent = targetFolder || 'Non categorizzate';
    }
    await refreshLibrary();
  } else {
    showToast(result.error, 'error', 3000);
  }
}

function confirmDeleteRecording(rec) {
  showConfirmModal(
    'Elimina registrazione',
    `Eliminare "${rec.name || rec.dirName}"? Questa operazione cancellerà sia l'audio che la trascrizione.`,
    async () => {
      if (state.activeRec && state.activeRec.recDir === rec.recDir) {
        closeActiveRecording();
      }
      const result = await window.memoAPI.recordingDelete({ recDir: rec.recDir });
      if (result.success) {
        showToast('Registrazione eliminata', 'success', 2000);
        await refreshLibrary();
      } else {
        showToast(result.error, 'error', 3000);
      }
    }
  );
}

let confirmCallback = null;

function showConfirmModal(title, message, callback) {
  UI.confirmTitle.textContent = title;
  UI.confirmMessage.textContent = message;
  confirmCallback = callback;
  UI.modalConfirm.classList.remove('hidden');
}

UI.btnConfirmCancel.addEventListener('click', () => {
  UI.modalConfirm.classList.add('hidden');
  confirmCallback = null;
});
UI.btnConfirmOk.addEventListener('click', () => {
  UI.modalConfirm.classList.add('hidden');
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
});

// ══════════════════════════════════════════════════════════════
// 10. RESIZER SIDEBAR
// ══════════════════════════════════════════════════════════════
function setupResizer() {
  const resizer = $('resizer');
  const sidebar = $('sidebar');
  let isResizing = false;
  let startX, startW;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const delta = e.clientX - startX;
    const newW = Math.max(200, Math.min(420, startW + delta));
    sidebar.style.width = newW + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// ══════════════════════════════════════════════════════════════
// 11. DOWNLOAD MODELLO
// ══════════════════════════════════════════════════════════════
function startModelDownload() {
  document.body.classList.add('has-banner');
  UI.modelBanner.classList.remove('hidden');

  window.memoAPI.onModelProgress((data) => {
    const pct = data.percent;
    UI.modelProgressFill.style.width = pct + '%';
    UI.modelProgressPct.textContent = pct + '%';
    const mb = Math.round(data.downloaded / 1024 / 1024);
    const total = Math.round(data.total / 1024 / 1024);
    UI.modelBannerDesc.textContent = `Scaricamento modello Whisper AI… ${mb} MB / ${total} MB`;
  });

  window.memoAPI.onModelDone(() => {
    state.modelReady = true;
    UI.modelProgressFill.style.width = '100%';
    UI.modelProgressPct.textContent = '100%';
    UI.modelBannerDesc.textContent = 'Modello pronto!';
    setTimeout(() => {
      UI.modelBanner.classList.add('hidden');
      document.body.classList.remove('has-banner');
    }, 2000);
    showToast('Modello Whisper pronto', 'success', 4000);
  });

  window.memoAPI.onModelError((err) => {
    UI.modelBannerDesc.textContent = `Errore download: ${err}. Riavvia l'app.`;
    showToast('Errore download modello: ' + err, 'error', 6000);
  });

  window.memoAPI.modelDownload();
}

// ══════════════════════════════════════════════════════════════
// 12. AUTO-UPDATER
// ══════════════════════════════════════════════════════════════
function setupUpdaterControls() {
  if (!window.memoAPI?.onUpdateStatus) return;

  UI.btnCheckUpdates?.addEventListener('click', async () => {
    showToast('Ricerca aggiornamenti...', 'info', 2000);
    const res = await window.memoAPI.checkForUpdates();
    if (!res.success && res.message) {
      showToast(res.message, 'info', 3000);
    }
  });

  UI.btnUpdateDismiss?.addEventListener('click', () => {
    UI.updateBanner?.classList.add('hidden');
  });

  UI.btnUpdateAction?.addEventListener('click', () => {
    window.memoAPI.restartAndInstall();
  });

  window.memoAPI.onUpdateStatus((info) => {
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
      showToast('Memo è già aggiornato', 'success', 2500);
    }
  });

  window.memoAPI.onUpdateProgress?.((p) => {
    if (UI.updateBannerText) {
      UI.updateBannerText.textContent = `Scaricamento aggiornamento... ${p.percent}%`;
    }
  });
}

// ══════════════════════════════════════════════════════════════
// AVVIO
// ══════════════════════════════════════════════════════════════
init();
