'use strict';

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
  const folder = (state.library.folders || []).find((item) => item.name === name);
  const recordings = folder?.recordings || [];
  const files = recordings.reduce((total, rec) => total + (Number(rec.fileCount) || 0), 0);
  const bytes = recordings.reduce((total, rec) => total + (Number(rec.totalBytes) || 0), 0);
  const details = recordings.length > 0
    ? ` Contiene ${recordings.length} registrazioni (${files} file, ${formatBytes(bytes)}).`
    : ' Il gruppo non contiene registrazioni.';
  showConfirmModal(
    'Elimina Gruppo',
    `Eliminare il gruppo "${name}"?${details} Le registrazioni non verranno cancellate ma spostate in "Non categorizzate".`,
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

async function confirmDeleteRecording(rec) {
  let stats = {
    name: rec.name || rec.dirName,
    folder: rec.folder || null,
    fileCount: rec.fileCount,
    totalBytes: rec.totalBytes,
  };
  try {
    const fresh = await API.recordingStats({ recDir: rec.recDir });
    if (fresh?.success) stats = fresh;
  } catch (_) {}

  const name = stats.name || rec.name || rec.dirName || 'registrazione';
  const group = stats.folder || 'Non categorizzate';
  const fileCount = Number(stats.fileCount);
  const totalBytes = Number(stats.totalBytes);
  const contents = Number.isFinite(fileCount)
    ? `${fileCount} file (${formatBytes(totalBytes)})`
    : 'tutti i file';

  showConfirmModal(
    'Sposta nel cestino',
    `Eliminare «${name}»? La registrazione contiene ${contents} nel gruppo «${group}». Verrà spostata nel cestino e potrà essere ripristinata; solo l'eliminazione definitiva dal cestino è irreversibile.`,
    async () => {
      const result = await API.recordingDelete({ recDir: rec.recDir });
      if (result.success) {
        showToast(
          `Spostata nel cestino: «${name}» (${contents}, gruppo «${group}»).`,
          'info',
          3500,
        );
        if (state.activeRec && state.activeRec.recDir === rec.recDir) {
          closeActiveRecording();
        }
        await refreshLibrary();
      } else {
        showToast(result.error || 'Eliminazione non riuscita', 'error', 4000);
      }
    },
    { okText: 'Sposta nel cestino' },
  );
}

function showConfirmModal(title, msg, onConfirm, { okText = 'Elimina', danger = true } = {}) {
  UI.confirmTitle.textContent = title;
  UI.confirmMessage.textContent = msg;
  UI.btnConfirmOk.textContent = okText;
  UI.btnConfirmOk.className = danger ? 'btn-danger' : 'btn-primary';
  UI.modalConfirm.classList.remove('hidden');
  UI.btnConfirmOk.onclick = () => {
    UI.modalConfirm.classList.add('hidden');
    onConfirm();
  };
  UI.btnConfirmCancel.onclick = () => UI.modalConfirm.classList.add('hidden');
}
