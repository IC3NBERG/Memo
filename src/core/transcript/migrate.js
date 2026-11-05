'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  SCHEMA_VERSIONS,
} = require('./constants');
const {
  ensureDirSync,
  readJsonSafe,
  removeDirIfExists,
  sha256Json,
  sha256File,
  writeJsonAtomicSync,
  writeTextAtomicSync,
} = require('../storage/atomic');
const { normalizeSegments } = require('./ids');
const { projectTranscript } = require('./projection');
const { validateMetadata } = require('./validate');

const REVISIONS_DIR = '.revisions';
const BACKUP_DIR = '.backup-v1';
const BACKUP_FORMAT_VERSION = 1;

class MigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function readMetadataStrict(recDir) {
  const file = path.join(recDir, 'metadata.json');
  const result = readJsonSafe(file);

  if (!result.ok) {
    throw new MigrationError(
      result.code === 'ENOENT' ? 'missing-metadata' : 'invalid-metadata',
      result.code === 'ENOENT'
        ? 'metadata.json non trovato'
        : 'metadata.json non è JSON valido',
    );
  }

  if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value)) {
    throw new MigrationError('invalid-metadata', 'metadata.json non è un oggetto');
  }

  return result.value;
}

function mapV1Kind(metadata) {
  if (metadata.isLivePreview) return 'livePreview';
  if (metadata.isTranslated) return 'translation';
  return 'transcription';
}

function buildSource(metadata, kind, timing, format) {
  return {
    engine: null,
    model: null,
    language: null,
    targetLanguage: kind === 'translation' || metadata.isTranslated ? 'en' : null,
    complete: !!metadata.isCompleteTranscript,
    translated: !!metadata.isTranslated,
    timing,
    format,
  };
}

function readV1Transcript(recDir, metadata) {
  const duration = Number(metadata.duration) || 0;
  const transcriptPath = path.join(recDir, 'transcript.json');
  const txtPath = path.join(recDir, 'transcript.txt');
  const jsonResult = readJsonSafe(transcriptPath);
  const warnings = [];

  if (jsonResult.ok) {
    const raw = jsonResult.value;
    const rawSegments = Array.isArray(raw?.segments)
      ? raw.segments
      : (Array.isArray(raw?.transcription) ? raw.transcription : []);
    let segments = normalizeSegments(rawSegments, 'r1', { fallbackEnd: duration });
    let text = typeof raw?.text === 'string' ? raw.text.trim() : '';

    if (segments.length === 0 && text) {
      segments = [{
        id: 'r1-s0001',
        start: 0,
        end: duration,
        text,
      }];
    }

    if (!text && segments.length > 0) {
      text = segments.map((segment) => segment.text).join(' ').trim();
    }

    if (segments.length > 0 || text) {
      const kind = mapV1Kind(metadata);
      const timing = kind === 'livePreview' || rawSegments.length === 0
        ? 'whole-recording'
        : 'segment';
      const normalizedText = text.replace(/\s+/g, ' ').trim();
      const joined = segments.map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim();
      const legacyDocumentText = normalizedText && joined && normalizedText !== joined
        ? normalizedText
        : null;

      return {
        segments,
        text: normalizedText || joined,
        kind,
        timing,
        format: rawSegments.length > 0 ? 'v1-json' : 'v1-json-text-only',
        warnings,
        legacyDocumentText,
      };
    }
  } else if (jsonResult.code === 'INVALID_JSON') {
    warnings.push('invalid-transcript-json');
  }

  if (fs.existsSync(txtPath)) {
    let text = '';
    try {
      text = fs.readFileSync(txtPath, 'utf8').trim();
    } catch (_) {
      warnings.push('unreadable-transcript-txt');
    }

    if (text) {
      const kind = mapV1Kind(metadata);
      return {
        segments: [{
          id: 'r1-s0001',
          start: 0,
          end: duration,
          text,
        }],
        text,
        kind,
        timing: 'whole-recording',
        format: 'legacy-txt',
        warnings,
        legacyDocumentText: null,
      };
    }
  }

  return null;
}

function makeEdits(revisionId, sourceHash, legacyDocumentText = null) {
  const edits = {
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

  if (typeof legacyDocumentText === 'string') {
    edits.legacyDocumentText = legacyDocumentText;
  }

  return edits;
}

function buildV2(recDir, metadata) {
  const timestamp = nowIso();
  const v1 = readV1Transcript(recDir, metadata);
  const warnings = v1 ? [...v1.warnings] : [];

  const next = {
    ...metadata,
    schemaVersion: SCHEMA_VERSIONS.metadata,
    id: typeof metadata.id === 'string' && metadata.id
      ? metadata.id
      : crypto.randomUUID(),
    createdAt: typeof metadata.createdAt === 'string' && metadata.createdAt
      ? metadata.createdAt
      : (typeof metadata.date === 'string' && metadata.date ? metadata.date : timestamp),
    updatedAt: timestamp,
    name: typeof metadata.name === 'string' && metadata.name
      ? metadata.name
      : path.basename(recDir),
    date: typeof metadata.date === 'string' ? metadata.date : null,
    folder: typeof metadata.folder === 'string' ? metadata.folder : null,
    duration: Number(metadata.duration) || 0,
    hasTranscript: false,
    isCompleteTranscript: !!metadata.isCompleteTranscript,
    isLivePreview: !!metadata.isLivePreview,
    isTranslated: !!metadata.isTranslated,
    activeRevisionId: null,
    revisions: [],
    previewReplacedAt: typeof metadata.previewReplacedAt === 'string'
      ? metadata.previewReplacedAt
      : null,
    migrationWarnings: warnings,
  };

  if (!v1) {
    warnings.push('transcript-missing');
    next.hasTranscript = false;
    next.isCompleteTranscript = false;
    next.isLivePreview = false;
    next.isTranslated = false;
    return { metadata: next, transcript: null, edits: null };
  }

  const transcript = {
    schemaVersion: SCHEMA_VERSIONS.transcript,
    revisionId: 'r1',
    kind: v1.kind,
    source: buildSource(metadata, v1.kind, v1.timing, v1.format),
    segments: v1.segments,
  };

  const sourceHash = sha256Json(transcript);
  const edits = makeEdits('r1', sourceHash, v1.legacyDocumentText);

  next.hasTranscript = true;
  next.revisions = [{
    revisionId: 'r1',
    kind: v1.kind,
    createdAt: next.createdAt,
    complete: !!next.isCompleteTranscript,
    translated: !!next.isTranslated,
    model: null,
    language: null,
    targetLanguage: transcript.source.targetLanguage,
    timing: v1.timing,
  }];
  next.activeRevisionId = 'r1';

  return { metadata: next, transcript, edits };
}

function backupFileList(recDir) {
  const allowed = new Set(['.json', '.txt', '.srt', '.vtt', '.csv', '.md']);
  return fs.readdirSync(recDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => allowed.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .filter((name) => name !== 'audio.wav');
}

function createBackup(recDir) {
  const backupDir = path.join(recDir, BACKUP_DIR);
  if (fs.existsSync(backupDir)) return backupDir;

  const tmp = path.join(
    recDir,
    `${BACKUP_DIR}.tmp-${process.pid}-${Date.now()}`,
  );
  ensureDirSync(tmp);

  try {
    const files = backupFileList(recDir);
    for (const name of files) {
      fs.copyFileSync(path.join(recDir, name), path.join(tmp, name));
    }

    writeJsonAtomicSync(path.join(tmp, 'backup.json'), {
      schemaVersion: BACKUP_FORMAT_VERSION,
      createdAt: nowIso(),
      sourceSchemaVersion: metadataVersionFallback(recDir),
      files,
    });

    fs.renameSync(tmp, backupDir);
    return backupDir;
  } catch (err) {
    removeDirIfExists(tmp);
    throw err;
  }
}

function metadataVersionFallback(recDir) {
  const result = readJsonSafe(path.join(recDir, 'metadata.json'));
  return result.ok ? (Number(result.value?.schemaVersion) || 1) : 1;
}

function recoverFromBackup(recDir) {
  const backupDir = path.join(recDir, BACKUP_DIR);
  if (!fs.existsSync(backupDir)) {
    throw new MigrationError(
      'half-migration-no-backup',
      'Migrazione interrotta e backup v1 mancante: apertura rifiutata',
    );
  }

  for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === 'backup.json') continue;
    fs.copyFileSync(path.join(backupDir, entry.name), path.join(recDir, entry.name));
  }

  removeDirIfExists(path.join(recDir, REVISIONS_DIR));
  removeDirIfExists(path.join(recDir, '.tmp-whisper'));

  // Le copie derivate non fanno parte del formato v1.
  for (const name of ['transcript.edits.json']) {
    try { fs.unlinkSync(path.join(recDir, name)); } catch (_) {}
  }
}

function writeDerived(recDir, transcript, edits) {
  if (!transcript) return;
  writeJsonAtomicSync(path.join(recDir, 'transcript.json'), transcript);
  if (edits) writeJsonAtomicSync(path.join(recDir, 'transcript.edits.json'), edits);
  const projected = projectTranscript(transcript, edits);
  writeTextAtomicSync(path.join(recDir, 'transcript.txt'), projected.text);
}

function commitMigration(recDir, built) {
  if (built.transcript) {
    const revisionDir = path.join(recDir, REVISIONS_DIR, 'r1');
    ensureDirSync(revisionDir);
    const transcriptPath = path.join(revisionDir, 'transcript.json');
    writeJsonAtomicSync(transcriptPath, built.transcript);
    built.edits.sourceHash = sha256File(transcriptPath);
    writeJsonAtomicSync(path.join(revisionDir, 'edits.json'), built.edits);
  }

  // metadata.json è il commit marker: finché non è v2, la registrazione è v1.
  writeJsonAtomicSync(path.join(recDir, 'metadata.json'), built.metadata);

  if (built.transcript) {
    writeDerived(recDir, built.transcript, built.edits);
  }
}

function ensureRecordingMigrated(recDir) {
  const metadata = readMetadataStrict(recDir);
  const version = Number(metadata.schemaVersion) || 1;

  if (version > SCHEMA_VERSIONS.metadata) {
    throw new MigrationError(
      'unsupported-schema',
      `schemaVersion ${version} più nuovo di quello supportato (${SCHEMA_VERSIONS.metadata})`,
    );
  }

  if (version === SCHEMA_VERSIONS.metadata) {
    const validation = validateMetadata(metadata);
    if (!validation.ok) {
      throw new MigrationError(
        'invalid-metadata',
        `metadata v2 non valido: ${validation.errors.join('; ')}`,
      );
    }
    return { migrated: false, metadata };
  }

  if (version !== 1) {
    throw new MigrationError('unsupported-schema', `schemaVersion ${version} non supportato`);
  }

  const revisionsDir = path.join(recDir, REVISIONS_DIR);
  if (fs.existsSync(revisionsDir)) {
    // File v2 presenti ma metadata ancora v1: migrazione interrotta.
    recoverFromBackup(recDir);
    return ensureRecordingMigrated(recDir);
  }

  createBackup(recDir);
  const built = buildV2(recDir, metadata);
  commitMigration(recDir, built);

  return { migrated: true, metadata: built.metadata };
}

module.exports = {
  BACKUP_DIR,
  REVISIONS_DIR,
  MigrationError,
  ensureRecordingMigrated,
  readMetadataStrict,
  buildV2,
};
