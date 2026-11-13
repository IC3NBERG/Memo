'use strict';

const { stemItalian } = require('./stemmer');

const HIGHLIGHT_START = '\u0001';
const HIGHLIGHT_END = '\u0002';

function escapeToken(token) {
  return token.replace(/"/g, '""');
}

function termClause(token, prefix) {
  const stem = stemItalian(token);
  const variants = stem && stem !== token ? [token, stem] : [token];
  const clauses = variants.map((variant) => {
    const escaped = escapeToken(variant);
    return prefix ? `"${escaped}"*` : `"${escaped}"`;
  });
  return clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0];
}

/**
 * Trasforma il testo libero dell'utente in una query FTS5 sicura.
 * Ogni parola è tra virgolette (niente operatori interpretati); per ogni
 * parola si prova sia la forma originale sia la radice italiana. L'ultima
 * parola diventa un prefisso, così la ricerca resta piacevole mentre si digita.
 */
function buildFtsQuery(raw) {
  const tokens = String(raw ?? '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);

  if (!tokens || tokens.length === 0) return null;

  return tokens
    .map((token, index) => termClause(token, index === tokens.length - 1))
    .join(' AND ');
}

/**
 * Trasforma il risultato di snippet() in testo semplice + intervalli da
 * evidenziare. Il renderer non deve mai interpretare HTML proveniente
 * dall'indice: qui restano solo stringhe e offset.
 */
function parseSnippet(marked) {
  const text = String(marked ?? '');
  const parts = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf(HIGHLIGHT_START, cursor);
    if (start === -1) {
      parts.push({ text: text.slice(cursor), highlighted: false });
      break;
    }
    if (start > cursor) {
      parts.push({ text: text.slice(cursor, start), highlighted: false });
    }
    const end = text.indexOf(HIGHLIGHT_END, start + 1);
    if (end === -1) {
      parts.push({ text: text.slice(start + 1), highlighted: true });
      break;
    }
    parts.push({ text: text.slice(start + 1, end), highlighted: true });
    cursor = end + 1;
  }

  return parts.filter((part) => part.text.length > 0);
}

function normalizeLimit(value, fallback = 30, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

function normalizeIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeDuration(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function normalizeSpeaker(value) {
  if (typeof value !== 'string') return null;
  const speaker = value.trim();
  return speaker || null;
}

const UNSORTED_FILTER = '__unsorted__';

/**
 * Filtri ammessi dal confine IPC. Il gruppo vuoto distingue "tutti i gruppi"
 * (null) da "_unsorted" (stringa vuota nell'indice).
 */
function normalizeFilters(input = {}) {
  const source = input && typeof input === 'object' ? input : {};

  let folder = null;
  if (source.folder === UNSORTED_FILTER || source.folder === '_unsorted' || source.folder === '') {
    folder = '';
  } else if (typeof source.folder === 'string') {
    folder = source.folder.trim() || null;
  }

  let durationMin = normalizeDuration(source.durationMin);
  let durationMax = normalizeDuration(source.durationMax);
  if (durationMin !== null && durationMax !== null && durationMin > durationMax) {
    [durationMin, durationMax] = [durationMax, durationMin];
  }

  return {
    folder,
    dateFrom: normalizeIsoDate(source.dateFrom),
    dateTo: normalizeIsoDate(source.dateTo),
    durationMin,
    durationMax,
    speaker: normalizeSpeaker(source.speaker),
  };
}

module.exports = {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  UNSORTED_FILTER,
  buildFtsQuery,
  normalizeFilters,
  normalizeLimit,
  parseSnippet,
};
