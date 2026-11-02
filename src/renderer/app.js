/* ══════════════════════════════════════════════════════════════
   MEMO — app.js
   Logica completa: registrazione, trascrizione, libreria, UI
   ══════════════════════════════════════════════════════════════ */

'use strict';

// ─── Toast ────────────────────────────────────────────────────
const toastContainer = document.createElement('div');
toastContainer.id = 'toast-container';
document.body.appendChild(toastContainer);

function showToast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
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
  gateNode: null,             // simulato via gain
  streamSource: null,
  micStream: null,
  savedRecDir: null,          // cartella della registrazione appena salvata
  modelReady: false,
  showTimestamps: false,
  playerAudio: document.getElementById('hidden-audio'),
};

// ─── Elementi DOM ─────────────────────────────────────────────
const $  = (id) => document.getElementById(id);

const UI = {
  modelBanner:         $('model-banner'),
  modelProgressFill:   $('model-progress-fill'),
  modelProgressPct:    $('model-progress-pct'),
  modelBannerDesc:     $('model-banner-desc'),

  libraryTree:         $('library-tree'),
  emptyState:          $('empty-state'),
  transcriptView:      $('transcript-view'),

  recNameLabel:        $('rec-name-label'),
  toggleTimestamps:    $('toggle-timestamps'),
  btnCopyAll:          $('btn-copy-all'),
  btnExportTxt:        $('btn-export-txt'),
  btnExportMd:         $('btn-export-md'),

  transcribeButtons:   $('transcribe-buttons'),
  transcribeProgress:  $('transcribe-progress'),
  transcribeProgressFill: $('transcribe-progress-fill'),
  transcribeProgressPct:  $('transcribe-progress-pct'),
  transcribeStatusText:   $('transcribe-status-text'),
  btnTranscribeLive:   $('btn-transcribe-live'),
  btnTranscribeAfter:  $('btn-transcribe-after'),

  transcriptContent:   $('transcript-content'),
  timestampsMargin:    $('timestamps-margin'),

  btnRec:              $('btn-rec'),
  btnPause:            $('btn-pause'),
  btnStop:             $('btn-stop'),
  recTimer:            $('rec-timer'),
  waveformCanvas:      $('waveform-canvas'),

  recControls:         $('rec-controls'),
  playerControls:      $('player-controls'),
  btnPlayPause:        $('btn-play-pause'),
  playerSeek:          $('player-seek'),
  playerTime:          $('player-time'),
  playerVolume:        $('player-volume'),

  toggleHighpass:      $('toggle-highpass'),
  toggleNoisegate:     $('toggle-noisegate'),
  toggleCompressor:    $('toggle-compressor'),
  toggleAutogain:      $('toggle-autogain'),

  btnNewFolder:        $('btn-new-folder'),

  modalFolder:         $('modal-folder'),
  inputFolderName:     $('input-folder-name'),
  btnFolderCancel:     $('btn-folder-cancel'),
  btnFolderConfirm:    $('btn-folder-confirm'),

  modalMove:           $('modal-move'),
  moveFolderList:      $('move-folder-list'),
  btnMoveCancel:       $('btn-move-cancel'),

  modalConfirm:        $('modal-confirm'),
  confirmTitle:        $('confirm-title'),
  confirmMessage:      $('confirm-message'),
  btnConfirmCancel:    $('btn-confirm-cancel'),
  btnConfirmOk:        $('btn-confirm-ok'),

  modalSaveName:       $('modal-save-name'),
  inputRecName:        $('input-rec-name'),
  selectRecFolder:     $('select-rec-folder'),
  btnSaveCancel:       $('btn-save-cancel'),
  btnSaveConfirm:      $('btn-save-confirm'),

  updateBanner:        $('update-banner'),
  updateBannerText:    $('update-banner-text'),
  btnUpdateAction:     $('btn-update-action'),
  btnUpdateDismiss:    $('btn-update-dismiss'),
  appVersionLabel:     $('app-version-label'),
  btnCheckUpdates:     $('btn-check-updates'),
};

// ══════════════════════════════════════════════════════════════
// 1. AVVIO — Controllo modello e libreria
// ══════════════════════════════════════════════════════════════
async function init() {
  setupWindowControls();
  setupResizer();
  setupRecControls();
  setupTranscriptControls();
  setupPlayerControls();
  setupModalHandlers();
  setupWaveform();
  setupUpdaterControls();

  // Carica versione
  if (window.memoAPI.getVersion) {
    try {
      const ver = await window.memoAPI.getVersion();
      if (UI.appVersionLabel && ver) UI.appVersionLabel.textContent = `Memo v${ver}`;
    } catch (_) {}
  }

  // Carica libreria
  await refreshLibrary();

  // Controlla modello
  const modelOk = await window.memoAPI.modelCheck();
  if (modelOk) {
    state.modelReady = true;
    showToast('✅ Modello Whisper pronto', 'success', 2000);
  } else {
    startModelDownload();
  }
}

function setupUpdaterControls() {
  if (!window.memoAPI.onUpdateStatus) return;

  UI.btnCheckUpdates?.addEventListener('click', async () => {
    showToast('🔍 Ricerca aggiornamenti...', 'info', 2000);
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
      showToast(`✨ ${info.message}`, 'info', 4000);
    } else if (info.type === 'downloaded') {
      UI.updateBanner?.classList.remove('hidden');
      if (UI.updateBannerText) UI.updateBannerText.textContent = info.message;
      if (UI.btnUpdateAction) UI.btnUpdateAction.classList.remove('hidden');
      showToast('🎉 Aggiornamento pronto! Clicca "Riavvia e Aggiorna"', 'success', 6000);
    } else if (info.type === 'not-available') {
      showToast('✅ Memo è già aggiornato', 'success', 2500);
    }
  });

  window.memoAPI.onUpdateProgress?.((p) => {
    if (UI.updateBannerText) {
      UI.updateBannerText.textContent = `Scaricamento aggiornamento... ${p.percent}%`;
    }
  });
}

// ══════════════════════════════════════════════════════════════
// 2. DOWNLOAD MODELLO
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
    UI.modelBannerDesc.textContent = 'Modello pronto! 🎉';
    setTimeout(() => {
      UI.modelBanner.classList.add('hidden');
      document.body.classList.remove('has-banner');
    }, 2000);
    showToast('✅ Modello Whisper scaricato e pronto!', 'success', 4000);
  });

  window.memoAPI.onModelError((err) => {
    UI.modelBannerDesc.textContent = `Errore download: ${err}. Riavvia l'app.`;
    showToast('❌ Errore download modello: ' + err, 'error', 6000);
  });

  window.memoAPI.modelDownload();
}

// ══════════════════════════════════════════════════════════════
// 3. REGISTRAZIONE AUDIO
// ══════════════════════════════════════════════════════════════
function setupRecControls() {
  UI.btnRec.addEventListener('click', () => {
    if (!state.recording) {
      startRecording();
    }
  });

  UI.btnPause.addEventListener('click', () => {
    if (!state.recording) return;
    if (state.paused) {
      resumeRecording();
    } else {
      pauseRecording();
    }
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

    // Pipeline di preprocessing
    const chain = buildAudioPipeline(source);

    // Analyser per waveform (sempre dopo la pipeline)
    state.analyserNode = state.audioContext.createAnalyser();
    state.analyserNode.fftSize = 256;
    chain.connect(state.analyserNode);

    // Destination per registrazione
    const dest = state.audioContext.createMediaStreamDestination();
    chain.connect(dest);

    state.mediaRecorder = new MediaRecorder(dest.stream, {
      mimeType: 'audio/webm;codecs=opus',
    });
    state.audioChunks = [];

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };

    state.mediaRecorder.start(100); // chunk ogni 100ms

    state.recording = true;
    state.paused = false;
    state.recDuration = 0;
    state.savedRecDir = null;

    // Aggiorna UI
    UI.btnRec.classList.add('recording');
    UI.btnRec.querySelector('.rec-dot').style.display = 'inline-block';
    UI.btnPause.disabled = false;
    UI.btnStop.disabled = false;
    showPlayerOrWaveform('waveform');

    startTimer();
    drawWaveform();

    showToast('🔴 Registrazione avviata', 'info', 1500);
  } catch (err) {
    showToast('❌ Microfono non disponibile: ' + err.message, 'error', 4000);
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
    comp.threshold.value = -50;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    node.connect(comp);
    node = comp;
    state.compressorNode = comp;
  }

  // 3. Auto-gain (GainNode con gain elevato per voci distanti)
  if (UI.toggleAutogain.checked) {
    const gain = ctx.createGain();
    gain.gain.value = 2.5;
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
    UI.btnPause.textContent = '▶';
    UI.btnPause.title = 'Riprendi';
    UI.btnRec.classList.remove('recording');
    showToast('⏸ Registrazione in pausa', 'info', 1500);
  }
}

function resumeRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === 'paused') {
    state.mediaRecorder.resume();
    state.paused = false;
    startTimer();
    UI.btnPause.textContent = '⏸';
    UI.btnPause.title = 'Pausa';
    UI.btnRec.classList.add('recording');
    showToast('🔴 Registrazione ripresa', 'info', 1500);
  }
}

function stopRecording() {
  return new Promise((resolve) => {
    clearInterval(state.recTimerInterval);
    state.recording = false;
    state.paused = false;

    UI.btnRec.classList.remove('recording');
    UI.btnPause.disabled = true;
    UI.btnStop.disabled = true;
    UI.btnPause.textContent = '⏸';

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
    // Converti WebM/Opus → ArrayBuffer
    const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();

    // Converti in WAV tramite AudioContext offline
    const wavBuffer = await convertToWav(arrayBuffer);

    // Mostra modal per il nome
    showSaveNameModal(wavBuffer);
  } catch (err) {
    showToast('❌ Errore nel salvataggio: ' + err.message, 'error', 4000);
  }
}

async function convertToWav(webmBuffer) {
  // Usa un AudioContext temporaneo per decodificare e ricodificare come WAV
  const tmpCtx = new AudioContext({ sampleRate: 16000 });
  const decoded = await tmpCtx.decodeAudioData(webmBuffer.slice(0));
  await tmpCtx.close();

  // Crea WAV manualmente
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
  view.setUint32(16, 16, true);           // chunk size
  view.setUint16(20, 1, true);            // PCM
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
  // Aggiorna la select con le cartelle disponibili
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
      state.savedRecDir = result.recDir;
      // Aggiorna durata
      await window.memoAPI.recordingUpdateDuration({
        recDir: result.recDir,
        duration: state.recDuration,
      });
      showToast(`✅ Registrazione salvata: ${name}`, 'success', 2500);
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
      if (saved) openRecording(saved);
    } else {
      showToast('❌ Errore salvataggio: ' + result.error, 'error', 4000);
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
let waveAnimFrame;

function setupWaveform() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const canvas = UI.waveformCanvas;
  const wrap = canvas.parentElement;
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
    // Disegna piatta se non sta registrando
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#3F3228';
    ctx.lineWidth = 1 * window.devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    return;
  }

  waveAnimFrame = requestAnimationFrame(drawWaveform);

  const bufLen = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufLen);
  analyser.getByteTimeDomainData(dataArray);

  ctx.clearRect(0, 0, W, H);

  // Disegna la forma d'onda con gradiente ambra
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
// 4. TRASCRIZIONE
// ══════════════════════════════════════════════════════════════
function setupTranscriptControls() {
  UI.btnTranscribeAfter.addEventListener('click', () => {
    if (!state.activeRec) return;
    if (!state.modelReady) {
      showToast('⏳ Attendere: il modello Whisper è ancora in download…', 'info', 3000);
      return;
    }
    startTranscription(state.activeRec);
  });

  UI.toggleTimestamps.addEventListener('change', () => {
    state.showTimestamps = UI.toggleTimestamps.checked;
    renderTranscript();
  });

  UI.btnCopyAll.addEventListener('click', () => {
    const text = UI.transcriptContent.innerText.trim();
    if (!text) { showToast('Nessun testo da copiare', 'info', 1500); return; }
    navigator.clipboard.writeText(text).then(() => showToast('📋 Testo copiato!', 'success', 1500));
  });

  UI.btnExportTxt.addEventListener('click', () => exportTranscript('txt'));
  UI.btnExportMd.addEventListener('click', () => exportTranscript('md'));

  // Salva automaticamente quando l'utente modifica il testo
  let saveTimeout;
  UI.transcriptContent.addEventListener('input', () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveTranscript(), 1500);
  });
}

function startTranscription(rec) {
  if (!rec || !rec.recDir) return;

  // Mostra progress
  UI.transcribeButtons.classList.add('hidden');
  UI.transcribeProgress.classList.remove('hidden');
  UI.transcribeProgressFill.style.width = '0%';
  UI.transcribeProgressPct.textContent = '0%';
  UI.transcribeStatusText.textContent = 'Analisi audio in corso…';

  window.memoAPI.transcriptionStart({
    audioPath: rec.audioPath,
    recDir: rec.recDir,
  });

  window.memoAPI.onTranscriptionProgress((pct) => {
    UI.transcribeProgressFill.style.width = pct + '%';
    UI.transcribeProgressPct.textContent = pct + '%';
  });

  window.memoAPI.onTranscriptionDone((transcript) => {
    state.transcript = transcript;
    UI.transcribeProgress.classList.add('hidden');
    UI.transcribeButtons.classList.remove('hidden');

    // Aggiorna rec locale
    if (state.activeRec) state.activeRec.hasTranscript = true;

    renderTranscript();
    refreshLibrary();
    showToast('✅ Trascrizione completata!', 'success', 3000);
  });

  window.memoAPI.onTranscriptionError((err) => {
    UI.transcribeProgress.classList.add('hidden');
    UI.transcribeButtons.classList.remove('hidden');
    showToast('❌ Errore trascrizione: ' + err, 'error', 5000);
  });
}

function renderTranscript() {
  if (!state.transcript) return;

  const { segments, text } = state.transcript;

  if (!state.showTimestamps || !segments || segments.length === 0) {
    // Testo pulito
    UI.timestampsMargin.classList.remove('visible');
    UI.timestampsMargin.innerHTML = '';
    UI.transcriptContent.textContent = text || '';
  } else {
    // Con timestamps nel margine
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
// 5. LIBRERIA
// ══════════════════════════════════════════════════════════════
async function refreshLibrary() {
  state.library = await window.memoAPI.libraryGet();
  renderLibrary();
}

function renderLibrary() {
  UI.libraryTree.innerHTML = '';

  const { folders, unsorted } = state.library;

  // Cartelle materia
  folders.forEach(folder => {
    const folderEl = createFolderElement(folder);
    UI.libraryTree.appendChild(folderEl);
  });

  // Non categorizzate
  const unsortedFolder = {
    name: '_unsorted',
    displayName: 'Non categorizzate',
    recordings: unsorted,
    isSystem: true,
  };
  const unsortedEl = createFolderElement(unsortedFolder);
  UI.libraryTree.appendChild(unsortedEl);
}

function createFolderElement(folder) {
  const isSystem = folder.isSystem;
  const displayName = folder.displayName || folder.name;
  const recordings = folder.recordings || [];

  const wrap = document.createElement('div');
  wrap.className = 'folder-wrap';

  // Header cartella
  const header = document.createElement('div');
  header.className = 'folder-item';

  const arrow = document.createElement('span');
  arrow.className = 'folder-arrow';
  arrow.textContent = '▶';

  const icon = document.createElement('span');
  icon.className = 'folder-icon';
  icon.textContent = isSystem ? '📥' : '📁';

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

  // Azioni cartella (non per sistema)
  if (!isSystem) {
    const actions = document.createElement('div');
    actions.className = 'folder-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'folder-action-btn';
    renameBtn.title = 'Rinomina';
    renameBtn.textContent = '✏️';
    renameBtn.onclick = (e) => { e.stopPropagation(); renameFolder(folder.name); };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'folder-action-btn danger';
    deleteBtn.title = 'Elimina cartella';
    deleteBtn.textContent = '🗑️';
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteFolder(folder.name); };

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    header.appendChild(actions);
  }

  wrap.appendChild(header);

  // Lista registrazioni
  const list = document.createElement('div');
  list.className = 'recordings-list hidden';

  recordings.forEach(rec => {
    const recEl = createRecordingElement(rec, folder.name);
    list.appendChild(recEl);
  });

  wrap.appendChild(list);

  // Toggle espansione
  header.addEventListener('click', () => {
    const isExpanded = !list.classList.contains('hidden');
    list.classList.toggle('hidden', isExpanded);
    header.classList.toggle('expanded', !isExpanded);
  });

  return wrap;
}

function createRecordingElement(rec, folderName) {
  const el = document.createElement('div');
  el.className = 'rec-item';
  if (state.activeRec && state.activeRec.recDir === rec.recDir) {
    el.classList.add('active');
  }

  const icon = document.createElement('span');
  icon.className = 'rec-item-icon';
  icon.textContent = rec.hasTranscript ? '📄' : '🎵';

  const info = document.createElement('div');
  info.className = 'rec-item-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'rec-item-name';
  nameEl.textContent = rec.name || rec.dirName;

  const meta = document.createElement('div');
  meta.className = 'rec-item-meta';
  const parts = [];
  if (rec.date) parts.push(formatDate(rec.date));
  if (rec.duration) parts.push(formatDuration(rec.duration));
  meta.textContent = parts.join(' · ');

  info.appendChild(nameEl);
  info.appendChild(meta);

  // Azioni
  const actions = document.createElement('div');
  actions.className = 'rec-item-actions';

  const moveBtn = document.createElement('button');
  moveBtn.className = 'rec-action-btn';
  moveBtn.title = 'Sposta';
  moveBtn.textContent = '↗️';
  moveBtn.onclick = (e) => { e.stopPropagation(); showMoveModal(rec); };

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'rec-action-btn danger';
  deleteBtn.title = 'Elimina';
  deleteBtn.textContent = '🗑️';
  deleteBtn.onclick = (e) => { e.stopPropagation(); confirmDeleteRecording(rec); };

  actions.appendChild(moveBtn);
  actions.appendChild(deleteBtn);

  el.appendChild(icon);
  el.appendChild(info);
  el.appendChild(actions);

  el.addEventListener('click', () => openRecording(rec));

  return el;
}

// ═ Apri registrazione ════════════════════════════════════════
async function openRecording(rec) {
  state.activeRec = rec;

  // Aggiorna UI
  UI.emptyState.classList.add('hidden');
  UI.transcriptView.classList.remove('hidden');
  UI.recNameLabel.textContent = rec.name || rec.dirName;

  // Marca elemento attivo nella sidebar
  document.querySelectorAll('.rec-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.rec-item').forEach(el => {
    if (el.querySelector('.rec-item-name')?.textContent === (rec.name || rec.dirName)) {
      el.classList.add('active');
    }
  });

  // Carica trascrizione
  state.transcript = null;
  UI.transcriptContent.textContent = '';
  UI.timestampsMargin.innerHTML = '';

  const result = await window.memoAPI.transcriptRead({ recDir: rec.recDir });
  if (result.success && result.transcript) {
    state.transcript = result.transcript;
    renderTranscript();
  }

  // Carica audio nel player
  const audioResult = await window.memoAPI.audioGetPath({ recDir: rec.recDir });
  if (audioResult.success) {
    loadAudio(audioResult.audioPath);
  }
}

// ══════════════════════════════════════════════════════════════
// 6. PLAYER AUDIO
// ══════════════════════════════════════════════════════════════
function setupPlayerControls() {
  const audio = state.playerAudio;

  UI.btnPlayPause.addEventListener('click', () => {
    if (audio.paused) {
      audio.play();
      UI.btnPlayPause.textContent = '⏸';
    } else {
      audio.pause();
      UI.btnPlayPause.textContent = '▶';
    }
  });

  audio.addEventListener('timeupdate', () => {
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    UI.playerSeek.value = pct;
    UI.playerTime.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
  });

  audio.addEventListener('ended', () => {
    UI.btnPlayPause.textContent = '▶';
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
  UI.btnPlayPause.textContent = '▶';
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
// 7. CARTELLE & OPERAZIONI LIBRERIA
// ══════════════════════════════════════════════════════════════
function setupModalHandlers() {
  // Nuova cartella
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
      showToast(`📁 Materia "${result.name}" creata`, 'success', 2000);
      await refreshLibrary();
    } else {
      showToast('❌ ' + result.error, 'error', 3000);
    }
  });

  // Chiudi modal con click fuori
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
    showToast(`✅ Rinominata in "${result.name}"`, 'success', 2000);
    await refreshLibrary();
  } else {
    showToast('❌ ' + result.error, 'error', 3000);
  }
}

function deleteFolder(name) {
  showConfirmModal(
    `Elimina materia "${name}"`,
    `Le registrazioni saranno spostate in "Non categorizzate". Vuoi continuare?`,
    async () => {
      const result = await window.memoAPI.folderDelete({ name });
      if (result.success) {
        showToast(`🗑️ Materia eliminata`, 'success', 2000);
        await refreshLibrary();
      } else {
        showToast('❌ ' + result.error, 'error', 3000);
      }
    }
  );
}

function showMoveModal(rec) {
  UI.moveFolderList.innerHTML = '';

  // Opzione non categorizzata
  const unsortedBtn = document.createElement('button');
  unsortedBtn.className = 'move-folder-item';
  unsortedBtn.textContent = '📥 Non categorizzate';
  unsortedBtn.onclick = () => moveRec(rec, null);
  UI.moveFolderList.appendChild(unsortedBtn);

  // Cartelle materia
  state.library.folders.forEach(f => {
    if (f.name === rec.folder) return; // skip cartella corrente
    const btn = document.createElement('button');
    btn.className = 'move-folder-item';
    btn.textContent = `📁 ${f.name}`;
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
    showToast(`✅ Spostata in "${targetFolder || 'Non categorizzate'}"`, 'success', 2000);
    // Aggiorna il percorso nella selezione attiva
    if (state.activeRec && state.activeRec.recDir === rec.recDir) {
      state.activeRec.recDir = result.newPath;
      state.activeRec.folder = targetFolder;
    }
    await refreshLibrary();
  } else {
    showToast('❌ ' + result.error, 'error', 3000);
  }
}

function confirmDeleteRecording(rec) {
  showConfirmModal(
    'Elimina registrazione',
    `Eliminare "${rec.name || rec.dirName}"? Questa azione non è reversibile.`,
    async () => {
      if (state.activeRec && state.activeRec.recDir === rec.recDir) {
        state.activeRec = null;
        UI.transcriptView.classList.add('hidden');
        UI.emptyState.classList.remove('hidden');
        state.playerAudio.src = '';
        showPlayerOrWaveform('waveform');
      }
      const result = await window.memoAPI.recordingDelete({ recDir: rec.recDir });
      if (result.success) {
        showToast('🗑️ Registrazione eliminata', 'success', 2000);
        await refreshLibrary();
      } else {
        showToast('❌ ' + result.error, 'error', 3000);
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
// 8. RESIZER SIDEBAR
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
    const newW = Math.max(180, Math.min(400, startW + delta));
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
// 9. CONTROLLI FINESTRA (Semaforo nativo macOS)
// ══════════════════════════════════════════════════════════════
function setupWindowControls() {
  $('btn-minimize')?.addEventListener('click', () => window.memoAPI.windowMinimize());
  $('btn-close')?.addEventListener('click', () => window.memoAPI.windowClose());
}

// ══════════════════════════════════════════════════════════════
// AVVIO
// ══════════════════════════════════════════════════════════════
init();

