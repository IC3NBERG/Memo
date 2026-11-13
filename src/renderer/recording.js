'use strict';

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
    const audioSource = AudioSources.createMicrophoneSource({
      getUserMedia: navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),
    });
    const opened = await audioSource.open({
      AudioContextCtor: window.AudioContext,
      sampleRate: 16000,
    });

    state.audioSource = audioSource;
    state.audioSourceKind = opened.kind;
    state.micStream = opened.stream;
    state.audioContext = opened.context;
    const source = opened.sourceNode;
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
    await releaseAudioSource();
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

async function releaseAudioSource() {
  const source = state.audioSource;
  state.audioSource = null;
  if (source) {
    await source.close();
  } else {
    if (state.micStream) {
      state.micStream.getTracks().forEach((track) => track.stop());
    }
    if (state.audioContext) {
      try { await state.audioContext.close(); } catch (_) {}
    }
  }
  state.micStream = null;
  state.audioContext = null;
  state.streamSource = null;
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

      await releaseAudioSource();

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
