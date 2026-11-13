'use strict';

// ══════════════════════════════════════════════════════════════
// 6. LIBRERIA & GESTIONE GRUPPI
// ══════════════════════════════════════════════════════════════
async function refreshLibrary() {
  state.library = await API.libraryGet();
  renderSearchFilterOptions();
  renderLibrary();
  if (state.searchQuery) runFullTextSearch(state.searchQuery);
  loadSearchFacets();
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

    // Con l'indice disponibile la ricerca è già completa (nome, gruppo,
    // metadati e testo): non serve mostrare l'intero gruppo solo perché il
    // nome del gruppo contiene la query, altrimenti i filtri verrebbero
    // aggirati. Il fallback in memoria mantiene il comportamento precedente.
    const showFolder = !query
      || filteredRecordings.length > 0
      || (!resultMap && matchesFolder);
    if (showFolder) {
      const recordings = !query
        ? folder.recordings
        : (filteredRecordings.length > 0
          ? filteredRecordings
          : (resultMap ? [] : folder.recordings));
      const folderEl = createFolderElement({
        ...folder,
        recordings,
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
    emptyMsg.appendChild(document.createTextNode(
      activeSearchFilterCount() > 0
        ? 'Nessun risultato con i filtri attivi per "'
        : 'Nessuna registrazione trovata per "',
    ));
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

  if (rec.searchResult && Number.isFinite(rec.searchResult.matchStart)) {
    const jump = document.createElement('span');
    jump.className = 'rec-item-match-time';
    jump.textContent = `▶ ${formatTime(rec.searchResult.matchStart)}`;
    jump.title = `Apri la nota al punto audio ${formatTime(rec.searchResult.matchStart)}`;
    meta.appendChild(jump);
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

  const verifyBtn = document.createElement('button');
  verifyBtn.className = 'rec-action-btn';
  verifyBtn.title = 'Verifica integrità della registrazione';
  verifyBtn.innerHTML = ICONS.shield;
  verifyBtn.onclick = (e) => { e.stopPropagation(); openIntegrityReport(rec); };

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'rec-action-btn danger';
  deleteBtn.title = 'Sposta nel cestino';
  deleteBtn.innerHTML = ICONS.trash;
  deleteBtn.onclick = (e) => { e.stopPropagation(); confirmDeleteRecording(rec); };

  actions.appendChild(renameBtn);
  actions.appendChild(moveBtn);
  actions.appendChild(verifyBtn);
  actions.appendChild(deleteBtn);

  el.appendChild(icon);
  el.appendChild(info);
  el.appendChild(actions);

  el.addEventListener('click', () => {
    const seekTo = rec.searchResult && Number.isFinite(rec.searchResult.matchStart)
      ? rec.searchResult.matchStart
      : null;
    openRecording(rec, folderName, { seekTo });
  });

  return el;
}

// ══════════════════════════════════════════════════════════════
// 7. APRI REGISTRAZIONE
// ══════════════════════════════════════════════════════════════
async function openRecording(rec, folderName, options = {}) {
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
    if (Number.isFinite(options.seekTo)) {
      seekPlayerWhenReady(options.seekTo);
    }
  }
}
