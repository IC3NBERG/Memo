'use strict';

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
  updateResetViewButton();
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

/**
 * Il risultato di ricerca può chiedere di aprire la nota su un punto audio che
 * non è ancora caricato. Aspettiamo i metadati del file invece di scartare il
 * seek, così il click funziona anche la prima volta che si apre la nota.
 */
function seekPlayerWhenReady(seconds) {
  const audio = state.playerAudio;
  if (!audio || !audio.src || !Number.isFinite(seconds)) return;

  if (audio.readyState >= 1) {
    seekPlayerTo(seconds);
    return;
  }

  const onLoaded = () => {
    audio.removeEventListener('loadedmetadata', onLoaded);
    seekPlayerTo(seconds);
  };
  audio.addEventListener('loadedmetadata', onLoaded);
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

  const recDir = state.activeRec.recDir;
  const text = UI.transcriptContent.innerText.trim();
  state.transcript.text = text;
  const result = await API.transcriptSave({
    recDir,
    transcript: state.transcript,
  });
  if (!state.activeRec || state.activeRec.recDir !== recDir) return;
  if (result?.success && result.transcript) {
    state.transcript = result.transcript;
    if (result.transcript.edits) {
      state.edits = BlockModel.cloneEdits(result.transcript.edits);
      state.editsStatus = 'ok';
    }
  }
  updateResetViewButton();
}

/**
 * "Ripristina vista originale": azzera l'intero overlay della revisione attiva
 * (testo corretto, blocchi nascosti, tag, annotazioni, ordine, gruppi e testo
 * legacy) senza toccare sorgente, timestamp, audio o revisioni archiviate.
 */
async function resetTranscriptView() {
  if (!state.activeRec || !state.transcript) return;
  if (!overlayHasChanges()) {
    showToast('La vista è già quella originale.', 'info', 2000);
    return;
  }

  const ok = await confirmDialog(
    'Ripristinare la vista originale?',
    'Verranno rimossi correzioni del testo, blocchi nascosti, tag, annotazioni, ordine e gruppi di questa vista. La trascrizione originale, i timestamp, l’audio e le revisioni archiviate restano intatti.',
    'Ripristina',
    true,
  );
  if (!ok) return;

  const recDir = state.activeRec.recDir;

  // Nessun autosave in volo deve riapplicare il testo appena scartato.
  clearTimeout(state.transcriptSaveTimer);
  state.transcriptSaveTimer = null;
  clearTimeout(state.editorSaveTimer);
  state.editorSaveTimer = null;

  if (state.editorMode === 'blocks' && !state.editorReadOnly) {
    try { await flushEditorSave({ force: true }); } catch (_) {}
  }
  if (!state.activeRec || state.activeRec.recDir !== recDir) return;

  setEditorStatus('saving', 'Salvataggio…');
  try {
    const result = typeof API.editsReset === 'function'
      ? await API.editsReset({ recDir })
      : await API.editsSave({
          recDir,
          edits: BlockModel.resetOverlay(state.edits),
          expectedEditRevision: state.edits?.editRevision,
        });

    if (!state.activeRec || state.activeRec.recDir !== recDir) return;
    if (!result?.success) {
      setEditorStatus('error', result?.error || 'Ripristino non riuscito');
      showToast(result?.error || 'Ripristino non riuscito', 'error', 3500);
      return;
    }

    state.transcript = result.transcript;
    state.edits = result.edits
      ? BlockModel.cloneEdits(result.edits)
      : BlockModel.resetOverlay(state.edits);
    state.editsStatus = 'ok';
    state.sourceSegments = Array.isArray(result.transcript?.sourceSegments)
      ? result.transcript.sourceSegments
      : state.sourceSegments;
    state.editorVersion += 1;
    state.editorHistory = BlockModel.createHistory();
    state.showHiddenBlocks = false;
    state.editorReadOnly = false;

    syncTimestampsToggle(state.transcript);
    setEditorStatus('saved', 'Salvato');
    renderTranscript();
    updateTranscriptStatusBadge();
    showToast('Vista originale ripristinata.', 'success', 2500);
  } catch (err) {
    setEditorStatus('error', 'Ripristino non riuscito');
    showToast(err.message || 'Ripristino non riuscito', 'error', 3500);
  }
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
