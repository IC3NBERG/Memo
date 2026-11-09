'use strict';

const fs = require('fs');
const path = require('path');

const { SCHEMA_VERSIONS } = require('../transcript/constants');
const { HIGHLIGHT_END, HIGHLIGHT_START, buildFtsQuery, normalizeLimit } = require('./query');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notes (
  rec_id       TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  folder       TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  updated_at   TEXT,
  content_hash TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  name,
  folder,
  body,
  content = 'notes',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, name, folder, body)
  VALUES (new.rowid, new.name, new.folder, new.body);
END;

CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, name, folder, body)
  VALUES ('delete', old.rowid, old.name, old.folder, old.body);
END;

CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, name, folder, body)
  VALUES ('delete', old.rowid, old.name, old.folder, old.body);
  INSERT INTO notes_fts(rowid, name, folder, body)
  VALUES (new.rowid, new.name, new.folder, new.body);
END;
`;

function loadDefaultDatabase() {
  return require('better-sqlite3');
}

function initializeSchema(db) {
  const version = db.pragma('user_version', { simple: true });
  if (version > SCHEMA_VERSIONS.searchIndex) {
    throw new Error(
      `Indice di ricerca troppo nuovo (versione ${version}, supportata ${SCHEMA_VERSIONS.searchIndex})`,
    );
  }

  if (version === 0) {
    const migrate = db.transaction(() => {
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
    INSERT INTO notes (rec_id, name, folder, body, updated_at, content_hash)
    VALUES (@recId, @name, @folder, @body, @updatedAt, @contentHash)
    ON CONFLICT(rec_id) DO UPDATE SET
      name = excluded.name,
      folder = excluded.folder,
      body = excluded.body,
      updated_at = excluded.updated_at,
      content_hash = excluded.content_hash
  `);
  const removeStmt = db.prepare('DELETE FROM notes WHERE rec_id = ?');
  const countStmt = db.prepare('SELECT COUNT(*) AS total FROM notes');
  const clearStmt = db.prepare('DELETE FROM notes');
  const searchStmt = db.prepare(`
    SELECT
      n.rec_id AS recId,
      n.name AS name,
      n.folder AS folder,
      n.updated_at AS updatedAt,
      snippet(notes_fts, 2, char(1), char(2), ' … ', 24) AS snippet,
      bm25(notes_fts, 6.0, 2.0, 1.0) AS score
    FROM notes_fts
    JOIN notes n ON n.rowid = notes_fts.rowid
    WHERE notes_fts MATCH ?
    ORDER BY score
    LIMIT ?
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
      upsertStmt.run({
        recId: String(record.recId),
        name: String(record.name ?? ''),
        folder: String(record.folder ?? ''),
        body: String(record.body ?? ''),
        updatedAt: record.updatedAt ?? null,
        contentHash,
      });
      return { changed: true };
    },

    remove(recId) {
      const result = removeStmt.run(recId);
      return result.changes > 0;
    },

    search(rawQuery, options = {}) {
      const match = buildFtsQuery(rawQuery);
      if (!match) return [];
      const limit = normalizeLimit(options.limit);

      return searchStmt.all(match, limit).map((row) => ({
        recId: row.recId,
        name: row.name,
        folder: row.folder || null,
        updatedAt: row.updatedAt || null,
        snippet: row.snippet || '',
        score: row.score,
      }));
    },

    count() {
      return countStmt.get().total;
    },

    clear() {
      clearStmt.run();
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
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  initializeSchema,
  openSearchIndex,
  removeIndexFiles,
};
