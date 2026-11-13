'use strict';

const fs = require('fs');
const path = require('path');

const { readJsonSafe } = require('../storage/atomic');
const { describeCompatibility, documentVersion, SUPPORTED_VERSIONS } = require('../transcript/compatibility');
const { validateEdits, validateMetadata, validateTranscript } = require('../transcript/validate');
const { readRevisionDocuments } = require('../transcript/store');
const { verifyManifest } = require('./manifest');

function issue(severity, code, message, details = {}) {
  return { severity, code, message, ...details };
}

function validateDocument(issues, label, validation) {
  for (const message of validation.errors || []) {
    issues.push(issue('error', 'invalid-document', `${label}: ${message}`, { document: label }));
  }
  for (const message of validation.warnings || []) {
    issues.push(issue('warning', 'document-warning', `${label}: ${message}`, { document: label }));
  }
}

function inspectRootTranscript(recDir, metadata, issues) {
  const jsonPath = path.join(recDir, 'transcript.json');
  const txtPath = path.join(recDir, 'transcript.txt');
  const hasJson = fs.existsSync(jsonPath);
  const hasTxt = fs.existsSync(txtPath);

  if (metadata?.hasTranscript && !hasJson && !hasTxt) {
    issues.push(issue(
      'warning',
      'transcript-missing',
      'Il metadata dichiara una trascrizione ma mancano transcript.json e transcript.txt',
    ));
  }

  if (hasJson) {
    const result = readJsonSafe(jsonPath);
    if (!result.ok) {
      issues.push(issue('error', 'invalid-transcript', `transcript.json non è JSON valido: ${result.error}`));
    }
  }
}

/**
 * Ispezione non invasiva: legge file e JSON, non migra, non corregge, non
 * scrive manifest e non aggiorna l'indice. `deep` controlla se ricalcolare gli
 * hash SHA-256/512 dei file; con false verifica presenza e dimensione, così
 * l'analisi d'avvio resta leggera.
 */
function inspectRecording(recDir, { deep = false } = {}) {
  const issues = [];
  const metadataResult = readJsonSafe(path.join(recDir, 'metadata.json'));
  let metadata = null;
  let metadataStatus = 'ok';
  let compatibility = null;

  if (!metadataResult.ok) {
    metadataStatus = metadataResult.code === 'ENOENT' ? 'missing' : 'invalid';
    issues.push(issue(
      'error',
      metadataStatus === 'missing' ? 'missing-metadata' : 'invalid-metadata',
      metadataStatus === 'missing'
        ? 'metadata.json mancante'
        : `metadata.json non è JSON valido: ${metadataResult.error}`,
    ));
  } else if (!metadataResult.value || typeof metadataResult.value !== 'object'
      || Array.isArray(metadataResult.value)) {
    metadataStatus = 'invalid';
    issues.push(issue('error', 'invalid-metadata', 'metadata.json non è un oggetto'));
  } else {
    metadata = metadataResult.value;
    const version = documentVersion(metadata, 'metadata');
    compatibility = describeCompatibility('metadata', version);

    if (compatibility.action === 'read-only-future') {
      metadataStatus = 'future';
      issues.push(issue('warning', 'future-schema', compatibility.message, {
        version,
        supportedMax: SUPPORTED_VERSIONS.metadata.max,
      }));
      const validation = validateMetadata(metadata, { ignoreSchemaVersion: true });
      if (!validation.ok) {
        metadataStatus = 'invalid';
        validateDocument(issues, 'metadata.json', validation);
      }
    } else if (compatibility.action === 'reject') {
      metadataStatus = 'unsupported';
      issues.push(issue('error', 'unsupported-schema', compatibility.message, { version }));
    } else if (version === 1) {
      metadataStatus = 'legacy';
      validateRootTranscript(issues, recDir, metadata);
    } else {
      const validation = validateMetadata(metadata);
      if (!validation.ok) {
        metadataStatus = 'invalid';
        validateDocument(issues, 'metadata.json', validation);
      } else {
        metadataStatus = 'ok';
      }
    }

    if (metadataStatus !== 'invalid' && metadataStatus !== 'unsupported') {
      inspectCommittedRevisions(recDir, metadata, issues, {
        allowFuture: metadataStatus === 'future',
      });
    }
  }

  if (metadataStatus === 'legacy') {
    inspectRootTranscript(recDir, metadata, issues);
  }

  const manifest = verifyManifest(recDir, { deep });
  if (manifest.code === 'missing-manifest') {
    issues.push(issue(
      'info',
      'missing-manifest',
      'Manifest con checksum assente: verifica disponibile solo dopo la sua creazione',
    ));
  } else if (manifest.code === 'invalid-manifest') {
    issues.push(issue('error', 'invalid-manifest', `Manifest non valido: ${manifest.error}`));
  }

  for (const file of manifest.files || []) {
    if (manifest.code === 'missing-manifest' || manifest.code === 'invalid-manifest') break;
    if (file.state === 'missing') {
      issues.push(issue('error', 'missing-file', `File mancante: ${file.path}`, { path: file.path }));
    } else if (file.state === 'modified') {
      issues.push(issue(
        'error',
        'modified-file',
        `File modificato o danneggiato: ${file.path}`,
        { path: file.path, reason: file.reason || null },
      ));
    } else if (file.state === 'untracked') {
      issues.push(issue(
        'warning',
        'untracked-file',
        `File non presente nel manifest: ${file.path}`,
        { path: file.path },
      ));
    }
  }

  const errorCount = issues.filter((item) => item.severity === 'error').length;
  const warningCount = issues.filter((item) => item.severity === 'warning').length;
  const status = errorCount > 0 ? 'error' : (warningCount > 0 ? 'warning' : 'ok');

  return {
    recDir,
    name: metadata?.name || path.basename(recDir),
    folder: metadata?.folder || null,
    status,
    metadataStatus,
    compatibility,
    manifest,
    summary: {
      errors: errorCount,
      warnings: warningCount,
      files: manifest.summary,
      totalBytes: manifest.totalBytes,
    },
    issues,
  };
}

function validateRootTranscript(issues, recDir, metadata) {
  const jsonPath = path.join(recDir, 'transcript.json');
  const result = readJsonSafe(jsonPath);
  if (!result.ok) {
    if (result.code !== 'ENOENT') {
      issues.push(issue('error', 'invalid-transcript', `transcript.json non è JSON valido: ${result.error}`));
    }
    return;
  }
  if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value)) {
    issues.push(issue('error', 'invalid-transcript', 'transcript.json non è un oggetto'));
  }
  if (metadata?.hasTranscript && !fs.existsSync(path.join(recDir, 'transcript.txt'))) {
    issues.push(issue('warning', 'transcript-txt-missing', 'transcript.txt mancante (verrà rigenerato)'));
  }
}

function inspectCommittedRevisions(recDir, metadata, issues, { allowFuture = false } = {}) {
  const revisions = Array.isArray(metadata.revisions) ? metadata.revisions : [];
  if (metadata.hasTranscript && !metadata.activeRevisionId) {
    issues.push(issue(
      'warning',
      'active-revision-missing',
      'hasTranscript è true ma activeRevisionId è nullo',
    ));
  }

  const inspected = new Set();
  for (const entry of revisions) {
    if (!entry || typeof entry.revisionId !== 'string') continue;
    inspected.add(entry.revisionId);
    const documents = inspectRevision(recDir, entry.revisionId, { allowFuture });
    if (!documents) continue;
    for (const item of documents) issues.push(item);
  }

  if (metadata.activeRevisionId && !inspected.has(metadata.activeRevisionId)) {
    issues.push(issue(
      'warning',
      'active-revision-unlisted',
      `La revisione attiva ${metadata.activeRevisionId} non è elencata in revisions`,
    ));
  }
}

function inspectRevision(recDir, revisionId, { allowFuture = false } = {}) {
  let documents;
  try {
    documents = readRevisionDocuments(recDir, revisionId, { allowFuture });
  } catch (err) {
    return [issue('error', 'invalid-transcript', `Revisione ${revisionId}: ${err.message}`, {
      revisionId,
    })];
  }

  if (!documents.ok) {
    return [issue('error', documents.code || 'invalid-transcript',
      `Revisione ${revisionId}: ${documents.error || 'non leggibile'}`, { revisionId })];
  }

  const issues = [];
  if (documents.readOnly && !allowFuture) {
    issues.push(issue(
      'warning',
      'future-schema',
      documents.compatibility?.message
        || `Revisione ${revisionId}: trascrizione con schema futuro aperta in sola lettura`,
      { revisionId, version: documents.compatibility?.version || null },
    ));
  }

  const transcriptValidation = validateTranscript(documents.transcript, {
    expectedRevisionId: revisionId,
    ignoreSchemaVersion: allowFuture || documents.readOnly,
  });
  if (!transcriptValidation.ok) {
    validateDocument(issues, `.revisions/${revisionId}/transcript.json`, transcriptValidation);
  }

  if (documents.repaired) {
    issues.push(issue(
      'warning',
      'transcript-repaired',
      `Revisione ${revisionId}: transcript non conforme riparato in memoria (nessuna scrittura)`,
      { revisionId, warnings: documents.warnings },
    ));
  }

  const editsValidation = validateEdits(documents.edits, { ignoreSchemaVersion: true });
  if (!editsValidation.ok) {
    issues.push(issue(
      'warning',
      'invalid-edits',
      `Revisione ${revisionId}: overlay non valido (${editsValidation.errors.join('; ')})`,
      { revisionId },
    ));
  } else if (documents.editsStatus !== 'ok') {
    issues.push(issue(
      'warning',
      documents.editsStatus,
      `Revisione ${revisionId}: overlay ${documents.editsStatus === 'stale-edits' ? 'disallineato' : documents.editsStatus}`,
      { revisionId },
    ));
  }

  return issues;
}

function collectRecordingDirs(recordingsDir) {
  const result = [];
  if (!fs.existsSync(recordingsDir)) return result;

  for (const group of fs.readdirSync(recordingsDir, { withFileTypes: true })) {
    if (!group.isDirectory() || group.name.startsWith('.')) continue;
    const groupPath = path.join(recordingsDir, group.name);
    let children = [];
    try {
      children = fs.readdirSync(groupPath, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const child of children) {
      if (child.isDirectory() && !child.name.startsWith('.')) {
        result.push(path.join(groupPath, child.name));
      }
    }
  }
  return result.sort();
}

function scanArchive({ recordingsDir, recDirs = null, deep = false } = {}) {
  const dirs = Array.isArray(recDirs) ? recDirs : collectRecordingDirs(recordingsDir);
  const recordings = dirs.map((recDir) => {
    try {
      return inspectRecording(recDir, { deep });
    } catch (err) {
      return {
        recDir,
        name: path.basename(recDir),
        folder: null,
        status: 'error',
        metadataStatus: 'error',
        compatibility: null,
        manifest: null,
        summary: { errors: 1, warnings: 0, files: null, totalBytes: 0 },
        issues: [issue('error', 'inspection-failed', err.message)],
      };
    }
  });

  const summary = {
    recordings: recordings.length,
    ok: recordings.filter((item) => item.status === 'ok').length,
    warnings: recordings.filter((item) => item.status === 'warning').length,
    errors: recordings.filter((item) => item.status === 'error').length,
    missingFiles: 0,
    modifiedFiles: 0,
    untrackedFiles: 0,
    noManifest: 0,
  };

  for (const recording of recordings) {
    summary.missingFiles += recording.manifest?.summary?.missing || 0;
    summary.modifiedFiles += recording.manifest?.summary?.modified || 0;
    summary.untrackedFiles += recording.manifest?.summary?.untracked || 0;
    if (recording.manifest?.code === 'missing-manifest') summary.noManifest += 1;
  }

  return {
    scannedAt: new Date().toISOString(),
    deep: !!deep,
    status: summary.errors > 0 ? 'error' : (summary.warnings > 0 ? 'warning' : 'ok'),
    summary,
    recordings,
  };
}

module.exports = {
  collectRecordingDirs,
  inspectRecording,
  scanArchive,
};
