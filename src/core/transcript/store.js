'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { SCHEMA_VERSIONS } = require('./constants');
const {
  ensureDirSync,
  listDirectories,
  readJsonSafe,
  removeDirIfExists,
  sha256File,
  writeJsonAtomicSync,
  writeTextAtomicSync,
} = require('../storage/atomic');
const { normalizeSegments, nextRevisionNumber, revisionNumber } = require('./ids');
const { projectTranscript } = require('./projection');
const { validateTranscript, validateEdits } = require('./validate');
const {
  REVISIONS_DIR,
  ensureRecordingMigrated,
  readMetadataStrict,
} = require('./migrate');

function nowIso() {
  return new Date().toISOString();
}

function emptyEdits(revisionId, sourceHash) {
  return {
    schemaVersion: SCHEMA_VERSIONS.edits,
    revisionId,
    sourceHash,
    editRevision: 0,
    segmentText: {},
    hiddenSegmentIds: [],
    tags: {},
    annotations: {},
    order: null,
    groups: [],
  };
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function createMetadataForNewRecording({ name, date, folder }) {
  const timestamp = date instanceof Date ? date.toISOString() : nowIso();
  return {
    schemaVersion: SCHEMA_VERSIONS.metadata,
    id: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    name: String(name || 'Lezione'),
    date: timestamp,
    folder: folder || null,
    duration: 0,
    hasTranscript: false,
    isCompleteTranscript: false,
    isLivePreview: false,
    isTranslated: false,
    activeRevisionId: null,
    revisions: [],
    previewReplacedAt: null,
  };
}

function updateMetadata(recDir, mutate) {
  const metadata = readMetadataStrict(recDir);
  const next = mutate({ ...metadata });
  next.updatedAt = nowIso();
  writeJsonAtomicSync(path.join(recDir, 'metadata.json'), next);
  return next;
}

function revisionDir(recDir, revisionId) {
  return path.join(recDir, REVISIONS_DIR, revisionId);
}

function readRevisionDocuments(recDir, revisionId) {
  const dir = revisionDir(recDir, revisionId);
  const transcriptResult = readJsonSafe(path.join(dir, 'transcript.json'));

  if (!transcriptResult.ok) {
    return {
      ok: false,
      code: transcriptResult.code === 'ENOENT' ? 'missing-revision' : 'invalid-transcript',
      error: transcriptResult.error,
    };
  }

  const transcriptValidation = validateTranscript(transcriptResult.value);
  if (!transcriptValidation.ok) {
    return {
      ok: false,
      code: 'invalid-transcript',
      error: transcriptValidation.errors.join('; '),
    };
  }

  const sourceHash = sha256File(path.join(dir, 'transcript.json'));
  const editsResult = readJsonSafe(path.join(dir, 'edits.json'));
  let edits = editsResult.ok ? editsResult.value : emptyEdits(revisionId, sourceHash);
  let editsStatus = 'ok';
  let editsError = null;

  if (!editsResult.ok) {
    editsStatus = editsResult.code === 'ENOENT' ? 'missing-edits' : 'invalid-edits';
    editsError = editsResult.error;
  } else {
    const editsValidation = validateEdits(edits);
    if (!editsValidation.ok) {
      editsStatus = 'invalid-edits';
      editsError = editsValidation.errors.join('; ');
    } else if (edits.revisionId !== revisionId || edits.sourceHash !== sourceHash) {
      editsStatus = 'stale-edits';
      editsError = 'edits.json non corrisponde alla revisione o alla sorgente';
    }
  }

  if (editsStatus !== 'ok') {
    edits = emptyEdits(revisionId, sourceHash);
  }

  return {
    ok: true,
    transcript: transcriptResult.value,
    edits,
    sourceHash,
    editsStatus,
    editsError,
  };
}

function writeDerived(recDir, transcript, edits) {
  writeJsonAtomicSync(path.join(recDir, 'transcript.json'), transcript);
  writeJsonAtomicSync(path.join(recDir, 'transcript.edits.json'), edits);
  const projected = projectTranscript(transcript, edits);
  writeTextAtomicSync(path.join(recDir, 'transcript.txt'), projected.text);
}

function refreshDerived(recDir, metadata) {
  if (!metadata?.activeRevisionId) return;
  const documents = readRevisionDocuments(recDir, metadata.activeRevisionId);
  if (!documents.ok) return;
  writeDerived(recDir, documents.transcript, documents.edits);
}

function buildView(transcript, edits, editsStatus = 'ok') {
  const projected = projectTranscript(transcript, edits);
  return {
    segments: projected.segments,
    text: projected.text,
    legacyDocumentText: projected.legacyDocumentText,
    warnings: projected.warnings,
    revisionId: transcript.revisionId,
    kind: transcript.kind,
    timing: transcript.source?.timing || 'segment',
    source: transcript.source,
    editsStatus,
  };
}

function cleanupOrphanStaging(recDir, { maxAgeMs = 60 * 60 * 1000 } = {}) {
  let entries = [];
  try {
    entries = fs.readdirSync(recDir, { withFileTypes: true });
  } catch (_) {
    return;
  }

  const threshold = Date.now() - maxAgeMs;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('.tmp-whisper-') && !entry.name.startsWith('.tmp-revision-')) continue;
    const target = path.join(recDir, entry.name);
    try {
      const stat = fs.statSync(target);
      if (stat.mtimeMs < threshold) removeDirIfExists(target);
    } catch (_) {}
  }
}

function readActiveTranscript(recDir) {
  cleanupOrphanStaging(recDir);
  const { metadata } = ensureRecordingMigrated(recDir);

  if (!metadata.activeRevisionId) {
    return {
      success: false,
      code: 'no-transcript',
      error: 'Nessuna trascrizione',
      metadata,
    };
  }

  const documents = readRevisionDocuments(recDir, metadata.activeRevisionId);
  if (!documents.ok) {
    return {
      success: false,
      code: documents.code,
      error: documents.error || 'Trascrizione non leggibile',
      metadata,
    };
  }

  try {
    refreshDerived(recDir, metadata);
  } catch (_) {
    // Le copie derivate sono rigenerabili: non bloccare l'apertura.
  }

  return {
    success: true,
    transcript: buildView(documents.transcript, documents.edits, documents.editsStatus),
    metadata,
    revisionId: metadata.activeRevisionId,
    kind: documents.transcript.kind,
    editsStatus: documents.editsStatus,
  };
}

function sourceTiming(kind, segments, requested) {
  if (requested === 'segment' || requested === 'whole-recording') return requested;
  if (kind === 'livePreview') return 'whole-recording';
  return segments.length > 0 ? 'segment' : 'whole-recording';
}

function revisionEntry(transcript) {
  return {
    revisionId: transcript.revisionId,
    kind: transcript.kind,
    createdAt: transcript.source.createdAt || nowIso(),
    complete: !!transcript.source.complete,
    translated: !!transcript.source.translated,
    model: transcript.source.model ?? null,
    language: transcript.source.language ?? null,
    targetLanguage: transcript.source.targetLanguage ?? null,
    timing: transcript.source.timing,
  };
}

function findRevisionEntry(metadata, revisionId) {
  return (metadata.revisions || []).find((item) => item.revisionId === revisionId) || null;
}

function createRevision(recDir, {
  kind,
  source = {},
  segments: rawSegments = [],
  text = '',
  edits: providedEdits = null,
}) {
  const { metadata } = ensureRecordingMigrated(recDir);
  const revisionsDir = path.join(recDir, REVISIONS_DIR);
  ensureDirSync(revisionsDir);

  const nextNumber = nextRevisionNumber(metadata, listDirectories(revisionsDir));
  const revId = `r${nextNumber}`;
  let segments = normalizeSegments(rawSegments, revId, {
    fallbackEnd: Number(metadata.duration) || 0,
  });

  if (segments.length === 0 && String(text || '').trim()) {
    segments = [{
      id: `${revId}-s0001`,
      start: 0,
      end: Number(metadata.duration) || 0,
      text: String(text).trim(),
    }];
  }

  if (segments.length === 0) {
    return { success: false, code: 'empty-transcript', error: 'Nessun testo da salvare' };
  }

  const timing = sourceTiming(kind, segments, source.timing);
  const transcript = {
    schemaVersion: SCHEMA_VERSIONS.transcript,
    revisionId: revId,
    kind,
    source: {
      engine: source.engine ?? null,
      model: source.model ?? null,
      language: source.language ?? null,
      targetLanguage: source.targetLanguage ?? null,
      complete: source.complete ?? (kind !== 'livePreview'),
      translated: source.translated ?? (kind === 'translation'),
      timing,
      format: source.format ?? null,
      createdAt: source.createdAt || nowIso(),
    },
    segments,
  };

  const staging = path.join(recDir, `.tmp-revision-${crypto.randomUUID()}`);
  ensureDirSync(staging);

  try {
    const transcriptPath = path.join(staging, 'transcript.json');
    writeJsonAtomicSync(transcriptPath, transcript);
    const sourceHash = sha256File(transcriptPath);
    const edits = providedEdits
      ? { ...providedEdits, revisionId: revId, sourceHash }
      : emptyEdits(revId, sourceHash);
    writeJsonAtomicSync(path.join(staging, 'edits.json'), edits);

    const target = revisionDir(recDir, revId);
    if (fs.existsSync(target)) {
      removeDirIfExists(staging);
      return { success: false, code: 'revision-exists', error: `Revisione ${revId} già esistente` };
    }
    fs.renameSync(staging, target);

    const oldEntry = metadata.activeRevisionId
      ? findRevisionEntry(metadata, metadata.activeRevisionId)
      : null;

    const nextMetadata = updateMetadata(recDir, (draft) => {
      const entry = revisionEntry(transcript);
      const revisions = (draft.revisions || [])
        .filter((item) => item.revisionId !== revId)
        .concat(entry)
        .sort((a, b) => (revisionNumber(a.revisionId) || 0) - (revisionNumber(b.revisionId) || 0));

      draft.revisions = revisions;
      draft.activeRevisionId = revId;
      draft.hasTranscript = true;
      draft.isCompleteTranscript = !!transcript.source.complete;
      draft.isLivePreview = kind === 'livePreview';
      draft.isTranslated = kind === 'translation' || !!transcript.source.translated;
      draft.transcriptKind = kind;
      draft.transcriptTiming = timing;
      if (oldEntry?.kind === 'livePreview' && kind !== 'livePreview') {
        draft.previewReplacedAt = nowIso();
      }
      return draft;
    });

    writeDerived(recDir, transcript, edits);

    return {
      success: true,
      transcript: buildView(transcript, edits),
      metadata: nextMetadata,
      revisionId: revId,
      kind,
    };
  } catch (err) {
    removeDirIfExists(staging);
    throw err;
  }
}

function saveLegacyTranscript(recDir, { transcript, isLivePreview, isTranslated }) {
  const { metadata } = ensureRecordingMigrated(recDir);
  const incomingText = String(transcript?.text ?? '');
  const incomingSegments = Array.isArray(transcript?.segments) ? transcript.segments : [];

  if (!metadata.activeRevisionId) {
    const kind = isLivePreview ? 'livePreview' : (isTranslated ? 'translation' : 'transcription');
    return createRevision(recDir, {
      kind,
      source: {
        engine: null,
        model: null,
        language: null,
        targetLanguage: isTranslated ? 'en' : null,
        complete: !isLivePreview,
        translated: !!isTranslated,
        timing: isLivePreview ? 'whole-recording' : (incomingSegments.length > 0 ? 'segment' : 'whole-recording'),
        format: 'legacy-save',
      },
      segments: incomingSegments,
      text: incomingText,
    });
  }

  const documents = readRevisionDocuments(recDir, metadata.activeRevisionId);
  if (!documents.ok) {
    return {
      success: false,
      code: documents.code,
      error: documents.error || 'Trascrizione non leggibile',
    };
  }

  if (documents.editsStatus !== 'ok') {
    return {
      success: false,
      code: documents.editsStatus,
      error: documents.editsError || 'Overlay non allineato alla sorgente',
    };
  }

  const currentView = buildView(documents.transcript, documents.edits, documents.editsStatus);
  const currentText = normalizeText(currentView.text);
  const nextText = normalizeText(incomingText);

  if (currentText !== nextText) {
    const edits = {
      ...documents.edits,
      editRevision: (documents.edits.editRevision || 0) + 1,
      legacyDocumentText: nextText,
      sourceHash: documents.sourceHash,
    };
    writeJsonAtomicSync(
      path.join(revisionDir(recDir, metadata.activeRevisionId), 'edits.json'),
      edits,
    );
    writeDerived(recDir, documents.transcript, edits);
  }

  const nextMetadata = updateMetadata(recDir, (draft) => {
    draft.hasTranscript = true;
    if (typeof isLivePreview === 'boolean') draft.isLivePreview = isLivePreview;
    if (typeof isTranslated === 'boolean') draft.isTranslated = isTranslated;
    return draft;
  });

  return {
    success: true,
    transcript: buildView(
      documents.transcript,
      currentText !== nextText
        ? {
            ...documents.edits,
            editRevision: (documents.edits.editRevision || 0) + 1,
            legacyDocumentText: nextText,
            sourceHash: documents.sourceHash,
          }
        : documents.edits,
      documents.editsStatus,
    ),
    metadata: nextMetadata,
    revisionId: metadata.activeRevisionId,
  };
}

function saveEdits(recDir, nextEdits, { expectedEditRevision } = {}) {
  const { metadata } = ensureRecordingMigrated(recDir);
  if (!metadata.activeRevisionId) {
    return { success: false, code: 'no-transcript', error: 'Nessuna trascrizione attiva' };
  }

  const documents = readRevisionDocuments(recDir, metadata.activeRevisionId);
  if (!documents.ok) {
    return { success: false, code: documents.code, error: documents.error };
  }

  if (expectedEditRevision !== undefined
      && documents.edits.editRevision !== expectedEditRevision) {
    return {
      success: false,
      code: 'edit-revision-mismatch',
      error: 'Overlay modificato altrove: ricaricare la trascrizione',
      editRevision: documents.edits.editRevision,
    };
  }

  const validIds = new Set(documents.transcript.segments.map((segment) => segment.id));
  const clean = {
    schemaVersion: SCHEMA_VERSIONS.edits,
    revisionId: metadata.activeRevisionId,
    sourceHash: documents.sourceHash,
    editRevision: (documents.edits.editRevision || 0) + 1,
    segmentText: {},
    hiddenSegmentIds: [],
    tags: {},
    annotations: {},
    order: null,
    groups: [],
  };

  for (const [id, value] of Object.entries(nextEdits?.segmentText || {})) {
    if (validIds.has(id) && typeof value === 'string') clean.segmentText[id] = value;
  }
  clean.hiddenSegmentIds = [...new Set(
    (nextEdits?.hiddenSegmentIds || []).filter((id) => validIds.has(id)),
  )];
  for (const [id, value] of Object.entries(nextEdits?.tags || {})) {
    if (validIds.has(id) && Array.isArray(value)) clean.tags[id] = value.map(String);
  }
  for (const [id, value] of Object.entries(nextEdits?.annotations || {})) {
    if (validIds.has(id) && Array.isArray(value)) clean.annotations[id] = value;
  }
  if (Array.isArray(nextEdits?.order)) {
    const seen = new Set();
    clean.order = nextEdits.order.filter((id) => {
      if (!validIds.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  clean.groups = (Array.isArray(nextEdits?.groups) ? nextEdits.groups : [])
    .map((group) => ({
      ...group,
      segmentIds: [...new Set((group.segmentIds || []).filter((id) => validIds.has(id)))],
    }));
  if (typeof nextEdits?.legacyDocumentText === 'string') {
    clean.legacyDocumentText = nextEdits.legacyDocumentText;
  }

  writeJsonAtomicSync(
    path.join(revisionDir(recDir, metadata.activeRevisionId), 'edits.json'),
    clean,
  );
  writeDerived(recDir, documents.transcript, clean);

  return {
    success: true,
    transcript: buildView(documents.transcript, clean),
    edits: clean,
    revisionId: metadata.activeRevisionId,
  };
}

function switchActiveRevision(recDir, revisionId) {
  const { metadata } = ensureRecordingMigrated(recDir);
  const entry = findRevisionEntry(metadata, revisionId);
  if (!entry) {
    return { success: false, code: 'revision-not-found', error: `Revisione ${revisionId} non trovata` };
  }

  const documents = readRevisionDocuments(recDir, revisionId);
  if (!documents.ok) {
    return { success: false, code: documents.code, error: documents.error };
  }

  const nextMetadata = updateMetadata(recDir, (draft) => {
    draft.activeRevisionId = revisionId;
    draft.hasTranscript = true;
    draft.isCompleteTranscript = !!entry.complete;
    draft.isLivePreview = entry.kind === 'livePreview';
    draft.isTranslated = entry.kind === 'translation' || !!entry.translated;
    draft.transcriptKind = entry.kind;
    draft.transcriptTiming = entry.timing;
    return draft;
  });

  writeDerived(recDir, documents.transcript, documents.edits);

  return {
    success: true,
    transcript: buildView(documents.transcript, documents.edits, documents.editsStatus),
    metadata: nextMetadata,
    revisionId,
    kind: entry.kind,
  };
}

function listRevisions(recDir) {
  const { metadata } = ensureRecordingMigrated(recDir);
  return (metadata.revisions || [])
    .slice()
    .sort((a, b) => (revisionNumber(a.revisionId) || 0) - (revisionNumber(b.revisionId) || 0));
}

function readMetadata(recDir) {
  const { metadata } = ensureRecordingMigrated(recDir);
  return metadata;
}

module.exports = {
  createMetadataForNewRecording,
  createRevision,
  ensureRecordingMigrated,
  listRevisions,
  readActiveTranscript,
  readMetadata,
  readRevisionDocuments,
  saveEdits,
  saveLegacyTranscript,
  switchActiveRevision,
};
