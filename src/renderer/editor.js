'use strict';

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
  state.editsStatus = 'ok';
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
  state.editsStatus = view.editsStatus === 'stale-edits' || view.editsStatus === 'invalid-edits'
    ? view.editsStatus
    : 'ok';
  state.sourceSegments = Array.isArray(view.sourceSegments) ? view.sourceSegments : [];
  // Visualizzazione unica a blocco di testo (come v1.0.9): niente editor a blocchi.
  state.editorMode = 'none';
  state.editorReadOnly = !!view.readOnly
    || view.editsStatus === 'stale-edits'
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

/**
 * C'è qualcosa da ripristinare se l'overlay contiene una vista dell'utente,
 * se è disallineato (va scartato) o se il testo a schermo è modificato ma non
 * ancora salvato.
 */
function overlayHasChanges() {
  if (state.editsStatus === 'stale-edits' || state.editsStatus === 'invalid-edits') return true;
  if (BlockModel.hasOverlayContent(state.edits)) return true;
  if (state.editorMode === 'none' && state.transcript) {
    const onScreen = (UI.transcriptContent?.innerText || '').trim();
    const saved = String(state.transcript.text || '').trim();
    return onScreen !== saved;
  }
  return false;
}

function updateResetViewButton() {
  const button = UI.btnResetView;
  if (!button) return;
  const available = !!state.activeRec && !!state.transcript && overlayHasChanges();
  button.disabled = !available;
  button.title = available
    ? 'Ripristina la vista originale: rimuove correzioni, blocchi nascosti, tag, annotazioni, ordine e gruppi. La sorgente resta intatta.'
    : 'La vista è già quella originale';
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

  if (state.transcript?.readOnly) {
    banner.classList.remove('hidden');
    banner.classList.add('readonly');
    const strong = document.createElement('strong');
    strong.textContent = 'Registrazione aperta in sola lettura: schema più recente.';
    const text = document.createElement('div');
    text.textContent = state.transcript.compatibility?.message
      || 'I file usano una versione non supportata da questa build. Nessuna modifica verrà scritta.';
    banner.append(strong, text);
    return;
  }

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
    strong.textContent = state.transcript?.repaired
      ? 'Trascrizione non conforme riparata in memoria.'
      : 'Alcuni riferimenti dell’overlay sono stati ignorati.';
    const text = document.createElement('div');
    text.textContent = warnings
      .slice(0, 4)
      .map((warning) => warning.message || warning.code)
      .join(' · ');
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
      if (result.transcript?.edits) {
        state.edits = BlockModel.cloneEdits(result.transcript.edits);
        state.editsStatus = 'ok';
      }
      updateResetViewButton();
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
