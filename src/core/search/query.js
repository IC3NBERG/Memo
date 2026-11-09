'use strict';

const HIGHLIGHT_START = '\u0001';
const HIGHLIGHT_END = '\u0002';

/**
 * Trasforma il testo libero dell'utente in una query FTS5 sicura.
 * Ogni parola è tra virgolette (niente operatori interpretati) e l'ultima
 * diventa un prefisso, così la ricerca resta piacevole mentre si digita.
 */
function buildFtsQuery(raw) {
  const tokens = String(raw ?? '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);

  if (!tokens || tokens.length === 0) return null;

  return tokens
    .map((token, index) => {
      const escaped = token.replace(/"/g, '""');
      return index === tokens.length - 1 ? `"${escaped}"*` : `"${escaped}"`;
    })
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

module.exports = {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  buildFtsQuery,
  normalizeLimit,
  parseSnippet,
};
