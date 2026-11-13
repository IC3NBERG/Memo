'use strict';

const fs = require('fs');
const path = require('path');

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FILES = 4;
const MAX_STRING = 500;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;

// Le chiavi che possono contenere contenuto dell'utente non devono mai finire
// nei log. La diagnostica registra eventi e metriche, non trascrizioni.
const SENSITIVE_KEY = /(transcript|content|text|note|prompt|audio|body|snippet|filename|filepath|path|name|title|speaker|voiceprint)/i;

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && !(value instanceof Error);
}

/**
 * Riduce un valore a qualcosa di serializzabile e privo di contenuti utente.
 * Non lancia mai: la diagnostica non deve poter rompere l'app.
 */
function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return '[ignored]';
  if (value instanceof Error) {
    const result = { name: value.name || 'Error', message: sanitize(value.message, depth + 1) };
    if (value.code) result.code = sanitize(value.code, depth + 1);
    return result;
  }
  if (depth >= MAX_DEPTH) return '[depth-limit]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitize(item, depth + 1));
  }
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1);
    }
    return result;
  }
  return String(value);
}

function timestampId(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function rotatedName(baseName, index) {
  if (index === 0) return `${baseName}.log`;
  return `${baseName}.${index}.log`;
}

function readLastLines(file, lineCount) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    return lines.slice(-lineCount);
  } catch (_) {
    return [];
  }
}

/**
 * Logger strutturato su file JSON Lines con rotazione per dimensione.
 * Ogni riga è un oggetto autonomo: `{ ts, level, event, ...campi }`.
 */
function createLogger({
  dir,
  level = process.env.CRUNCH_LOG_LEVEL || 'info',
  maxBytes = DEFAULT_MAX_BYTES,
  maxFiles = DEFAULT_MAX_FILES,
  now = () => new Date(),
  filePrefix = 'crunch',
} = {}) {
  if (!dir) throw new Error('createLogger: dir obbligatoria');

  const baseName = filePrefix;
  const threshold = LEVELS[level] ? level : 'info';
  let currentLevel = threshold;
  const logDir = dir;
  const logFile = path.join(logDir, rotatedName(baseName, 0));

  function ensureDir() {
    fs.mkdirSync(logDir, { recursive: true });
  }

  function rotate() {
    let size = 0;
    try { size = fs.statSync(logFile).size; } catch (_) { return; }
    if (size < maxBytes) return;

    if (maxFiles <= 1) {
      try { fs.truncateSync(logFile, 0); } catch (_) {}
      return;
    }

    try {
      for (let index = maxFiles - 1; index >= 1; index -= 1) {
        const source = path.join(logDir, rotatedName(baseName, index));
        const destination = path.join(logDir, rotatedName(baseName, index + 1));
        if (!fs.existsSync(source)) continue;
        if (index + 1 > maxFiles - 1) {
          fs.rmSync(source, { force: true });
        } else {
          fs.renameSync(source, destination);
        }
      }
      fs.renameSync(logFile, path.join(logDir, rotatedName(baseName, 1)));
    } catch (_) {
      // Se la rotazione fallisce, il file corrente resta utilizzabile.
    }
  }

  function write(levelName, event, fields) {
    if (LEVELS[levelName] < LEVELS[currentLevel]) return;
    const date = now();
    const entry = {
      ts: date.toISOString(),
      level: levelName,
      event: String(event || 'event'),
      ...sanitize(fields && isPlainObject(fields) ? fields : { value: fields }),
    };

    try {
      ensureDir();
      rotate();
      fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
    } catch (_) {
      // La diagnostica è best-effort: non deve mai bloccare l'operazione.
    }
  }

  const logger = {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    child(bindings = {}) {
      const base = sanitize(bindings);
      return {
        debug: (event, fields) => write('debug', event, { ...base, ...(isPlainObject(fields) ? fields : {}) }),
        info: (event, fields) => write('info', event, { ...base, ...(isPlainObject(fields) ? fields : {}) }),
        warn: (event, fields) => write('warn', event, { ...base, ...(isPlainObject(fields) ? fields : {}) }),
        error: (event, fields) => write('error', event, { ...base, ...(isPlainObject(fields) ? fields : {}) }),
        child: (extra) => logger.child({ ...bindings, ...extra }),
      };
    },
    setLevel(next) {
      if (LEVELS[next]) currentLevel = next;
    },
    getLevel() {
      return currentLevel;
    },
    tail(lines = 80) {
      const wanted = Math.max(1, Math.min(500, Number(lines) || 80));
      const collected = [];
      for (let index = maxFiles - 1; index >= 0; index -= 1) {
        const file = path.join(logDir, rotatedName(baseName, index));
        if (!fs.existsSync(file)) continue;
        collected.push(...readLastLines(file, wanted));
      }
      return collected.slice(-wanted);
    },
    files() {
      const entries = [];
      for (let index = 0; index < maxFiles; index += 1) {
        const file = path.join(logDir, rotatedName(baseName, index));
        try {
          const stat = fs.statSync(file);
          entries.push({ file, name: path.basename(file), bytes: stat.size, mtime: stat.mtime.toISOString() });
        } catch (_) {}
      }
      return entries;
    },
    get file() { return logFile; },
    get dir() { return logDir; },
    get maxBytes() { return maxBytes; },
    get maxFiles() { return maxFiles; },
  };

  return logger;
}

/**
 * Report testuale degli ultimi eventi, pensato per il pulsante "Copia report".
 * Non include contenuti: solo timestamp, livello ed evento.
 */
function formatTail(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return '(nessun evento registrato)';
  return lines.map((line) => {
    try {
      const entry = JSON.parse(line);
      const fields = Object.entries(entry)
        .filter(([key]) => !['ts', 'level', 'event'].includes(key))
        .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
        .join(' ');
      return `${entry.ts} [${String(entry.level || '').toUpperCase()}] ${entry.event}${fields ? ` · ${fields}` : ''}`;
    } catch (_) {
      return String(line).slice(0, MAX_STRING);
    }
  }).join('\n');
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILES,
  LEVELS,
  createLogger,
  formatTail,
  rotatedName,
  sanitize,
  timestampId,
};
