'use strict';

const fs = require('fs');
const path = require('path');

const { SCHEMA_VERSIONS } = require('../transcript/constants');
const {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  buildFtsQuery,
  normalizeFilters,
  normalizeLimit,
} = require('./query');
const { stemText } = require('./stemmer');

const FTS_TOKENIZER = 'unicode61 remove_diacritics 2';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notes (
  rec_id       TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  folder       TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  name_stem    TEXT NOT NULL DEFAULT '',
  folder_stem  TEXT NOT NULL DEFAULT '',
  body_stem    TEXT NOT NULL DEFAULT '',
  started_at   TEXT,
  duration     REAL NOT NULL DEFAULT 0,
  updated_at   TEXT,
  content_hash TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  name,
  folder,
  body,
  name_stem,
  folder_stem,
  body_stem,
  content = 'notes',
  content_rowid = 'rowid',
  tokenize = '${FTS_TOKENIZER}'
);

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, name, folder, body, name_stem, folder_stem, body_stem)
  VALUES (new.rowid, new.name, new.folder, new.body, new.name_stem, new.folder_stem, new.body_stem);
END;

CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, name, folder, body, name_stem, folder_stem, body_stem)
  VALUES ('delete', old.rowid, old.name, old.folder, old.body, old.name_stem, old.folder_stem, old.body_stem);
END;

CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, name, folder, body, name_stem, folder_stem, body_stem)
  VALUES ('delete', old.rowid, old.name, old.folder, old.body, old.name_stem, old.folder_stem, old.body_stem);
  INSERT INTO notes_fts(rowid, name, folder, body, name_stem, folder_stem, body_stem)
  VALUES (new.rowid, new.name, new.folder, new.body, new.name_stem, new.folder_stem, new.body_stem);
END;

CREATE TABLE IF NOT EXISTS segments (
  rec_id  TEXT NOT NULL,
  seq     INTEGER NOT NULL,
  start   REAL NOT NULL DEFAULT 0,
  end     REAL NOT NULL DEFAULT 0,
  text    TEXT NOT NULL DEFAULT '',
  text_stem TEXT NOT NULL DEFAULT '',
  speaker TEXT,
  PRIMARY KEY (rec_id, seq)
);

CREATE INDEX IF NOT EXISTS segments_rec_idx ON segments(rec_id);
CREATE INDEX IF NOT EXISTS segments_speaker_idx ON segments(speaker);

CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
  text,
  text_stem,
  content = 'segments',
  content_rowid = 'rowid',
  tokenize = '${FTS_TOKENIZER}'
);

CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
  INSERT INTO segments_fts(rowid, text, text_stem)
  VALUES (new.rowid, new.text, new.text_stem);
END;

CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, text, text_stem)
  VALUES ('delete', old.rowid, old.text, old.text_stem);
END;

CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, text, text_stem)
  VALUES ('delete', old.rowid, old.text, old.text_stem);
  INSERT INTO segments_fts(rowid, text, text_stem)
  VALUES (new.rowid, new.text, new.text_stem);
END;

CREATE TABLE IF NOT EXISTS recording_speakers (
  rec_id  TEXT NOT NULL,
  speaker TEXT NOT NULL,
  PRIMARY KEY (rec_id, speaker)
);

CREATE INDEX IF NOT EXISTS recording_speakers_speaker_idx
  ON recording_speakers(speaker);
`;

function loadDefaultDatabase() {
  return require('better-sqlite3');
}

function dropSchema(db) {
  db.exec(`
    DROP TABLE IF EXISTS notes_fts;
    DROP TABLE IF EXISTS notes;
    DROP TABLE IF EXISTS segments_fts;
    DROP TABLE IF EXISTS segments;
    DROP TABLE IF EXISTS recording_speakers;
  `);
}

function initializeSchema(db) {
  const version = db.pragma('user_version', { simple: true });
  if (version > SCHEMA_VERSIONS.searchIndex) {
    throw new Error(
      `Indice di ricerca troppo nuovo (versione ${version}, supportata ${SCHEMA_VERSIONS.searchIndex})`,
    );
  }

  // L'indice è ricostruibile: se il formato è vecchio lo ricreiamo vuoto e la
  // sincronizzazione dal filesystem lo ripopola al primo avvio.
  if (version !== 0 && version < SCHEMA_VERSIONS.searchIndex) {
    const rebuild = db.transaction(() => {
      dropSchema(db);
      db.exec(SCHEMA_SQL);
      db.pragma(`user_version = ${SCHEMA_VERSIONS.searchIndex}`);
    });
    rebuild();
    return;
  }

  if (version === 0) {
    const migrate = db.transaction(() => {
      // Un indice senza versione può essere il residuo di una creazione
      // interrotta: essendo ricostruibile, ripartiamo da zero.
      dropSchema(db);
      db.exec(SCHEMA_SQL);
      db.pragma(`user_version = ${SCHEMA_VERSIONS.searchIndex}`);
    });
    migrate();
    return;
  }

  db.exec(SCHEMA_SQL);
}

function openSearchIndex({
  dbPath,
  Database = null,
  readOnly = false,
} = {}) {
  if (!dbPath) throw new Error('dbPath mancante');

  const fsModule = fs;
  fsModule.mkdirSync(path.dirname(dbPath), { recursive: true });

  const DatabaseCtor = Database || loadDefaultDatabase();
  const db = new DatabaseCtor(dbPath, { readonly: readOnly });

  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('secure_delete = ON');
    if (!readOnly) initializeSchema(db);
  } catch (err) {
    try { db.close(); } catch (_) {}
    throw err;
  }

  const selectHash = db.prepare('SELECT content_hash FROM notes WHERE rec_id = ?');
  const upsertStmt = db.prepare(`
    INSERT INTO notes (
      rec_id, name, folder, body, name_stem, folder_stem, body_stem,
      started_at, duration, updated_at, content_hash
    )
    VALUES (
      @recId, @name, @folder, @body, @nameStem, @folderStem, @bodyStem,
      @startedAt, @duration, @updatedAt, @contentHash
    )
    ON CONFLICT(rec_id) DO UPDATE SET
      name = excluded.name,
      folder = excluded.folder,
      body = excluded.body,
      name_stem = excluded.name_stem,
      folder_stem = excluded.folder_stem,
      body_stem = excluded.body_stem,
      started_at = excluded.started_at,
      duration = excluded.duration,
      updated_at = excluded.updated_at,
      content_hash = excluded.content_hash
  `);
  const removeStmt = db.prepare('DELETE FROM notes WHERE rec_id = ?');
  const removeSegmentsStmt = db.prepare('DELETE FROM segments WHERE rec_id = ?');
  const removeSpeakersStmt = db.prepare('DELETE FROM recording_speakers WHERE rec_id = ?');
  const insertSegmentStmt = db.prepare(`
    INSERT INTO segments (rec_id, seq, start, end, text, text_stem, speaker)
    VALUES (@recId, @seq, @start, @end, @text, @textStem, @speaker)
  `);
  const insertSpeakerStmt = db.prepare(`
    INSERT OR IGNORE INTO recording_speakers (rec_id, speaker) VALUES (?, ?)
  `);
  const countStmt = db.prepare('SELECT COUNT(*) AS total FROM notes');
  const clearStmt = db.prepare('DELETE FROM notes');
  const clearSegmentsStmt = db.prepare('DELETE FROM segments');
  const clearSpeakersStmt = db.prepare('DELETE FROM recording_speakers');

  const searchStmt = db.prepare(`
    SELECT
      n.rec_id AS recId,
      n.name AS name,
      n.folder AS folder,
      n.started_at AS startedAt,
      n.duration AS duration,
      n.updated_at AS updatedAt,
      snippet(notes_fts, 2, char(1), char(2), ' … ', 24) AS snippet,
      bm25(notes_fts, 8.0, 3.0, 1.0, 6.0, 2.0, 0.8) AS score
    FROM notes_fts
    JOIN notes n ON n.rowid = notes_fts.rowid
    WHERE notes_fts MATCH @match
      AND (@folder IS NULL OR n.folder = @folder)
      AND (@dateFrom IS NULL OR n.started_at >= @dateFrom)
      AND (@dateTo IS NULL OR n.started_at <= @dateTo)
      AND (@durationMin IS NULL OR n.duration >= @durationMin)
      AND (@durationMax IS NULL OR n.duration <= @durationMax)
      AND (@speaker IS NULL OR EXISTS (
        SELECT 1 FROM recording_speakers rs
        WHERE rs.rec_id = n.rec_id AND rs.speaker = @speaker
      ))
    ORDER BY score
    LIMIT @limit
  `);

  const segmentSearchStmt = db.prepare(`
    SELECT
      s.rec_id AS recId,
      s.start AS start,
      s.end AS end,
      s.speaker AS speaker,
      snippet(segments_fts, 0, char(1), char(2), ' … ', 20) AS snippet,
      bm25(segments_fts, 1.0, 0.8) AS score
    FROM segments_fts
    JOIN segments s ON s.rowid = segments_fts.rowid
    WHERE segments_fts MATCH @match
      AND (@speaker IS NULL OR s.speaker = @speaker)
    ORDER BY score
    LIMIT @limit
  `);

  const upsertTransaction = db.transaction((record) => {
    upsertStmt.run(record);
    removeSegmentsStmt.run(record.recId);
    removeSpeakersStmt.run(record.recId);

    for (let index = 0; index < record.segments.length; index += 1) {
      const segment = record.segments[index];
      insertSegmentStmt.run({
        recId: record.recId,
        seq: index,
        start: segment.start,
        end: segment.end,
        text: segment.text,
        textStem: stemText(segment.text),
        speaker: segment.speaker || null,
      });
    }

    for (const speaker of record.speakers) {
      insertSpeakerStmt.run(record.recId, speaker);
    }
  });

  const removeTransaction = db.transaction((recId) => {
    removeSpeakersStmt.run(recId);
    removeSegmentsStmt.run(recId);
    return removeStmt.run(recId);
  });

  const clearTransaction = db.transaction(() => {
    clearSpeakersStmt.run();
    clearSegmentsStmt.run();
    clearStmt.run();
  });

  const foldersStmt = db.prepare(`
    SELECT DISTINCT folder FROM notes ORDER BY folder COLLATE NOCASE
  `);
  const speakersStmt = db.prepare(`
    SELECT DISTINCT speaker FROM recording_speakers ORDER BY speaker COLLATE NOCASE
  `);

  return {
    dbPath,

    getContentHash(recId) {
      const row = selectHash.get(recId);
      return row ? row.content_hash : null;
    },

    upsert(record) {
      const contentHash = String(record.contentHash ?? '');
      const current = selectHash.get(record.recId);
      if (current && current.content_hash === contentHash) {
        return { changed: false };
      }

      const speakers = Array.isArray(record.speakers)
        ? record.speakers.map((speaker) => String(speaker).trim()).filter(Boolean)
        : [];
      const segments = Array.isArray(record.segments)
        ? record.segments.map((segment) => ({
          start: Number.isFinite(Number(segment.start)) ? Number(segment.start) : 0,
          end: Number.isFinite(Number(segment.end)) ? Number(segment.end) : 0,
          text: String(segment.text ?? ''),
          speaker: segment.speaker ? String(segment.speaker).trim() || null : null,
        }))
        : [];

      const name = String(record.name ?? '');
      const folder = String(record.folder ?? '');
      const body = String(record.body ?? '');

      upsertTransaction({
        recId: String(record.recId),
        name,
        folder,
        body,
        nameStem: stemText(name),
        folderStem: stemText(folder),
        bodyStem: stemText(body),
        startedAt: record.startedAt ?? null,
        duration: Number.isFinite(Number(record.duration)) ? Number(record.duration) : 0,
        updatedAt: record.updatedAt ?? null,
        contentHash,
        speakers,
        segments,
      });
      return { changed: true };
    },

    remove(recId) {
      const result = removeTransaction(recId);
      return result.changes > 0;
    },

    search(rawQuery, options = {}) {
      const match = buildFtsQuery(rawQuery);
      if (!match) return [];
      const limit = normalizeLimit(options.limit);
      const filters = normalizeFilters(options.filters);

      const rows = searchStmt.all({
        match,
        limit,
        folder: filters.folder,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        durationMin: filters.durationMin,
        durationMax: filters.durationMax,
        speaker: filters.speaker,
      });
      if (rows.length === 0) return [];

      // Il primo segmento per ogni registrazione fornisce il punto audio più
      // pertinente. La query è separata per non appesantire il ranking del
      // documento e per poter filtrare anche per speaker.
      const segmentLimit = Math.min(800, Math.max(60, limit * 8));
      const segmentRows = segmentSearchStmt.all({
        match,
        limit: segmentLimit,
        speaker: filters.speaker,
      });
      const bestSegmentByRec = new Map();
      for (const segment of segmentRows) {
        if (!bestSegmentByRec.has(segment.recId)) {
          bestSegmentByRec.set(segment.recId, segment);
        }
      }

      return rows.map((row) => {
        const segment = bestSegmentByRec.get(row.recId) || null;
        return {
          recId: row.recId,
          name: row.name,
          folder: row.folder || null,
          startedAt: row.startedAt || null,
          duration: Number.isFinite(row.duration) ? row.duration : 0,
          updatedAt: row.updatedAt || null,
          snippet: segment?.snippet || row.snippet || '',
          matchStart: Number.isFinite(segment?.start) ? segment.start : null,
          matchEnd: Number.isFinite(segment?.end) ? segment.end : null,
          matchSpeaker: segment?.speaker || null,
          score: row.score,
        };
      });
    },

    facets() {
      return {
        folders: foldersStmt.all().map((row) => row.folder),
        speakers: speakersStmt.all().map((row) => row.speaker),
      };
    },

    count() {
      return countStmt.get().total;
    },

    clear() {
      clearTransaction();
    },

    close() {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.pragma('optimize');
      } catch (_) {}
      db.close();
    },

    // Esposti per i test e per il rebuild esplicito.
    _db: db,
  };
}

function removeIndexFiles(dbPath) {
  for (const target of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { fs.unlinkSync(target); } catch (_) {}
  }
}

module.exports = {
  FTS_TOKENIZER,
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  initializeSchema,
  openSearchIndex,
  removeIndexFiles,
};
