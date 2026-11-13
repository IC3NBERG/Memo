'use strict';

// ══════════════════════════════════════════════════════════════
// 5b. INTEGRITÀ ARCHIVIO, MANIFEST E CESTINO
// ══════════════════════════════════════════════════════════════
function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const decimals = index === 0 ? 0 : (size >= 100 ? 0 : (size >= 10 ? 1 : 2));
  return `${size.toFixed(decimals)} ${units[index]}`;
}

function setupArchiveControls() {
  UI.btnVerifyArchive?.addEventListener('click', () => openIntegrityReport(null));
  UI.btnOpenTrash?.addEventListener('click', openTrashPanel);
  UI.btnArchiveClose?.addEventListener('click', closeArchiveModal);
  UI.modalArchive?.addEventListener('click', (event) => {
    if (event.target === UI.modalArchive) closeArchiveModal();
  });

  API.onIntegrityReport?.((report) => {
    state.integrityReport = report;
    updateIntegrityBadge(report);
    if (!report) return;
    const { errors, warnings, recordings } = report.summary || {};
    if (report.status === 'error') {
      showToast(
        `Verifica archivio: ${errors} errori e ${warnings} avvisi su ${recordings} registrazioni. Apri lo scudo per i dettagli.`,
        'error',
        7000,
      );
    } else if (report.status === 'warning') {
      showToast(
        `Verifica archivio: ${warnings} avvisi su ${recordings} registrazioni.`,
        'info',
        5000,
      );
    }
  });
}

function updateIntegrityBadge(report) {
  if (!UI.btnVerifyArchive) return;
  const errors = report?.summary?.errors || 0;
  const warnings = report?.summary?.warnings || 0;
  UI.btnVerifyArchive.classList.toggle('has-issues', errors > 0);
  UI.btnVerifyArchive.classList.toggle('has-warnings', errors === 0 && warnings > 0);
  UI.btnVerifyArchive.title = report
    ? `Verifica integrità: ${errors} errori, ${warnings} avvisi`
    : "Verifica integrità e manifest dell'archivio";
}

function openArchiveModal({ title, intro, secondaryLabel, secondaryAction }) {
  if (!UI.modalArchive) return;
  UI.archiveModalTitle.textContent = title;
  UI.archiveModalIntro.textContent = intro || '';
  UI.archiveModalBody.replaceChildren();
  UI.btnArchiveSecondary.classList.toggle('hidden', !secondaryLabel);
  if (secondaryLabel) {
    UI.btnArchiveSecondary.textContent = secondaryLabel;
    UI.btnArchiveSecondary.onclick = secondaryAction;
  } else {
    UI.btnArchiveSecondary.onclick = null;
  }
  UI.modalArchive.classList.remove('hidden');
  updateBannerOffset();
}

function closeArchiveModal() {
  UI.modalArchive?.classList.add('hidden');
  state.archiveModalKind = null;
  state.archiveModalContext = null;
  updateBannerOffset();
}

async function openIntegrityReport(rec) {
  if (!API.integrityScan || !API.integrityScanAll) return;
  const result = rec
    ? await API.integrityScan({ recDir: rec.recDir, deep: true })
    : await API.integrityScanAll({ deep: true });

  if (!result?.success) {
    showToast(result?.error || 'Verifica integrità non riuscita', 'error', 4000);
    return;
  }

  const report = result.report;
  state.archiveModalKind = 'integrity';
  state.archiveModalContext = { rec };
  if (!rec) {
    state.integrityReport = report;
    updateIntegrityBadge(report);
  }

  const title = rec
    ? `Integrità · ${rec.name || rec.dirName || 'registrazione'}`
    : 'Integrità archivio';
  const intro = rec
    ? 'Verifica non invasiva di manifest, checksum SHA-256/512, metadata e trascrizioni. Nessun file è stato modificato.'
    : 'Verifica non invasiva di tutte le registrazioni: manifest, checksum SHA-256/512, metadata e trascrizioni. Nessun file è stato modificato.';
  openArchiveModal({
    title,
    intro,
    secondaryLabel: rec ? 'Rigenera manifest' : 'Rigenera manifest (tutte)',
    secondaryAction: async () => {
      const refreshed = await API.integrityRefresh(rec ? { recDir: rec.recDir } : {});
      if (refreshed?.success) {
        showToast(
          rec
            ? 'Manifest aggiornato.'
            : `Manifest aggiornato per ${refreshed.refreshed} registrazioni.`,
          'success',
          2500,
        );
        await openIntegrityReport(rec);
      } else {
        showToast(refreshed?.error || 'Aggiornamento manifest non riuscito', 'error', 4000);
      }
    },
  });

  renderIntegrityReport(report, rec);
}

function appendArchiveSection(body, title, status, issues, details) {
  const section = document.createElement('div');
  section.className = 'archive-section';

  const header = document.createElement('div');
  header.className = 'archive-section-header';

  const name = document.createElement('strong');
  name.textContent = title;
  header.appendChild(name);

  if (status) {
    const pill = document.createElement('span');
    pill.className = `archive-pill archive-pill-${status}`;
    pill.textContent = status === 'ok' ? 'OK' : (status === 'warning' ? 'Avvisi' : 'Errori');
    header.appendChild(pill);
  }

  section.appendChild(header);

  if (details) {
    const detail = document.createElement('div');
    detail.className = 'archive-section-details';
    detail.textContent = details;
    section.appendChild(detail);
  }

  if (!issues || issues.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'archive-empty';
    empty.textContent = 'Nessun problema rilevato.';
    section.appendChild(empty);
  } else {
    for (const item of issues) {
      const row = document.createElement('div');
      row.className = `archive-issue archive-issue-${item.severity || 'info'}`;

      const label = document.createElement('span');
      label.className = 'archive-issue-label';
      label.textContent = item.severity === 'error'
        ? 'Errore'
        : (item.severity === 'warning' ? 'Avviso' : 'Info');

      const message = document.createElement('span');
      message.textContent = item.message || item.code || '';

      row.appendChild(label);
      row.appendChild(message);
      section.appendChild(row);
    }
  }

  body.appendChild(section);
}

function manifestDetails(manifest) {
  if (!manifest) return '';
  if (manifest.code === 'missing-manifest') return 'Manifest assente';
  if (manifest.code === 'invalid-manifest') return `Manifest non valido: ${manifest.error || ''}`;
  const summary = manifest.summary || {};
  return [
    `${summary.total || 0} file`,
    formatBytes(manifest.totalBytes),
    `${summary.ok || 0} integri`,
    `${summary.modified || 0} modificati`,
    `${summary.missing || 0} mancanti`,
    `${summary.untracked || 0} non tracciati`,
  ].join(' · ');
}

function renderIntegrityReport(report, rec) {
  const body = UI.archiveModalBody;
  if (!body) return;

  if (rec && report) {
    appendArchiveSection(
      body,
      'Riepilogo',
      report.status,
      [],
      manifestDetails(report.manifest),
    );
    appendArchiveSection(body, 'Problemi rilevati', null, report.issues, null);
    return;
  }

  const summary = report?.summary || {};
  const summaryText = [
    `${summary.recordings || 0} registrazioni`,
    `${summary.ok || 0} integre`,
    `${summary.warnings || 0} con avvisi`,
    `${summary.errors || 0} con errori`,
    `${summary.missingFiles || 0} file mancanti`,
    `${summary.modifiedFiles || 0} file modificati`,
    `${summary.untrackedFiles || 0} file non tracciati`,
  ].join(' · ');
  appendArchiveSection(body, 'Riepilogo archivio', report?.status, [], summaryText);

  const recordings = Array.isArray(report?.recordings) ? report.recordings : [];
  const withIssues = recordings.filter((item) => item.issues && item.issues.length > 0);
  if (withIssues.length === 0) {
    appendArchiveSection(body, 'Registrazioni', 'ok', [], null);
    return;
  }

  for (const item of withIssues) {
    const details = [
      item.folder ? `Gruppo: ${item.folder}` : 'Gruppo: Non categorizzate',
      manifestDetails(item.manifest),
    ].filter(Boolean).join(' · ');
    appendArchiveSection(
      body,
      item.name || item.recDir,
      item.status,
      item.issues,
      details,
    );
  }
}

async function openTrashPanel() {
  if (!API.trashList) return;
  const result = await API.trashList();
  if (!result?.success) {
    showToast(result?.error || 'Impossibile leggere il cestino', 'error', 4000);
    return;
  }

  state.archiveModalKind = 'trash';
  state.archiveModalContext = { entries: result.entries };
  const entries = result.entries || [];
  openArchiveModal({
    title: 'Cestino',
    intro: entries.length > 0
      ? `${entries.length} registrazioni nel cestino. Il contenuto resta integro e può essere ripristinato nel gruppo originale.`
      : 'Il cestino è vuoto. Le registrazioni eliminate restano qui finché non vengono ripristinate o eliminate definitivamente.',
    secondaryLabel: entries.length > 0 ? 'Svuota cestino' : null,
    secondaryAction: entries.length > 0
      ? () => confirmEmptyTrash(entries)
      : null,
  });
  renderTrashPanel(entries);
}

function renderTrashPanel(entries) {
  const body = UI.archiveModalBody;
  if (!body) return;
  body.replaceChildren();

  if (!entries || entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'archive-empty archive-empty-large';
    empty.textContent = 'Nessuna registrazione nel cestino.';
    body.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'trash-item';

    const icon = document.createElement('span');
    icon.className = 'trash-item-icon';
    icon.innerHTML = ICONS.trash;

    const info = document.createElement('div');
    info.className = 'trash-item-info';

    const name = document.createElement('strong');
    name.textContent = entry.name || entry.originalName || entry.id;
    info.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'trash-item-meta';
    const group = entry.originalFolder || 'Non categorizzate';
    const count = Number.isFinite(Number(entry.fileCount))
      ? `${Number(entry.fileCount)} file`
      : 'file non contati';
    const size = Number.isFinite(Number(entry.totalBytes))
      ? formatBytes(entry.totalBytes)
      : '';
    meta.textContent = [
      formatDateTime(entry.trashedAt) || 'Data non disponibile',
      `Gruppo: ${group}`,
      count,
      size,
    ].filter(Boolean).join(' · ');
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'trash-item-actions';

    const restore = document.createElement('button');
    restore.className = 'btn-secondary btn-xs';
    restore.textContent = 'Ripristina';
    restore.onclick = () => restoreTrashEntry(entry.id);

    const purge = document.createElement('button');
    purge.className = 'btn-danger btn-xs';
    purge.textContent = 'Elimina definitivamente';
    purge.onclick = () => confirmPurgeTrashEntry(entry);

    actions.appendChild(restore);
    actions.appendChild(purge);

    row.appendChild(icon);
    row.appendChild(info);
    row.appendChild(actions);
    body.appendChild(row);
  }
}

async function restoreTrashEntry(trashId) {
  const result = await API.trashRestore({ trashId });
  if (!result?.success) {
    showToast(result?.error || 'Ripristino non riuscito', 'error', 4000);
    return;
  }
  showToast(
    `Registrazione ripristinata${result.folder ? ` nel gruppo «${result.folder}»` : ' in Non categorizzate'}.`,
    'success',
    3000,
  );
  await refreshLibrary();
  await openTrashPanel();
}

function confirmPurgeTrashEntry(entry) {
  const group = entry.originalFolder || 'Non categorizzate';
  const count = Number.isFinite(Number(entry.fileCount)) ? Number(entry.fileCount) : 'tutti i';
  showConfirmModal(
    'Elimina definitivamente',
    `Eliminare definitivamente «${entry.name || entry.originalName || entry.id}» dal gruppo «${group}»? L'azione è irreversibile e rimuove ${count} file (${formatBytes(entry.totalBytes)}).`,
    async () => {
      const result = await API.trashPurge({ trashId: entry.id });
      if (result?.success) {
        showToast('Registrazione eliminata definitivamente.', 'info', 2500);
        await openTrashPanel();
      } else {
        showToast(result?.error || 'Eliminazione non riuscita', 'error', 4000);
      }
    },
    { okText: 'Elimina definitivamente' },
  );
}

function confirmEmptyTrash(entries) {
  const files = entries.reduce((total, entry) => total + (Number(entry.fileCount) || 0), 0);
  const bytes = entries.reduce((total, entry) => total + (Number(entry.totalBytes) || 0), 0);
  showConfirmModal(
    'Svuota cestino',
    `Eliminare definitivamente ${entries.length} registrazioni (${files} file, ${formatBytes(bytes)})? L'azione non è reversibile.`,
    async () => {
      const result = await API.trashEmpty();
      if (result?.success) {
        showToast(
          result.removed > 0
            ? `Cestino svuotato: ${result.removed} registrazioni eliminate.`
            : 'Il cestino era già vuoto.',
          'info',
          3000,
        );
        await openTrashPanel();
      } else {
        showToast(result?.error || 'Svuotamento non riuscito', 'error', 4000);
      }
    },
    { okText: 'Svuota cestino' },
  );
}
