'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createLogger, formatTail, sanitize } = require('../src/core/diagnostics/logger');
const { tempDir, cleanup } = require('./helpers');

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('il logger scrive JSON Lines con livello e timestamp', () => {
  const root = tempDir();
  try {
    const logger = createLogger({
      dir: root,
      now: () => new Date('2025-06-07T08:09:10.000Z'),
    });
    logger.info('app.ready', { version: '1.2.0', packaged: true });
    logger.debug('debug.hidden', { reason: 'sotto soglia' });

    const lines = readLines(logger.file);
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0], {
      ts: '2025-06-07T08:09:10.000Z',
      level: 'info',
      event: 'app.ready',
      version: '1.2.0',
      packaged: true,
    });
  } finally {
    cleanup(root);
  }
});

test('i contenuti utente vengono redatti e le stringhe troncate', () => {
  const clean = sanitize({
    transcript: 'testo segreto',
    audioData: 'base64',
    fileName: 'lezione.wav',
    nested: { text: 'contenuto', keep: 'ok' },
  });
  assert.equal(clean.transcript, '[redacted]');
  assert.equal(clean.audioData, '[redacted]');
  assert.equal(clean.fileName, '[redacted]');
  assert.equal(clean.nested.text, '[redacted]');
  assert.equal(clean.nested.keep, 'ok');

  const long = sanitize({ note: 'x'.repeat(1000), message: 'y'.repeat(1000) });
  assert.equal(long.note, '[redacted]');
  assert.equal(long.message.length, 501);
  assert.ok(long.message.endsWith('…'));
});

test('la rotazione mantiene un numero limitato di file', () => {
  const root = tempDir();
  try {
    const logger = createLogger({ dir: root, maxBytes: 300, maxFiles: 3 });
    for (let index = 0; index < 40; index += 1) {
      logger.info('evento', { index, payload: 'x'.repeat(40) });
    }

    const files = logger.files();
    assert.equal(files.length, 3);
    assert.ok(files.some((file) => file.name === 'crunch.log'));
    assert.ok(files.some((file) => file.name === 'crunch.1.log'));

    const all = files.slice().reverse().flatMap((file) => readLines(file.file));
    assert.ok(all.length < 40);
    assert.equal(all[all.length - 1].index, 39);
    assert.deepEqual(
      all.map((entry) => entry.index),
      all.map((entry) => entry.index).slice().sort((a, b) => a - b),
    );
  } finally {
    cleanup(root);
  }
});

test('tail, livello e formato testuale non espongono contenuti', () => {
  const root = tempDir();
  try {
    const logger = createLogger({ dir: root, level: 'warn' });
    logger.info('ignorato');
    logger.warn('search.index-failed', { error: 'timeout', transcript: 'segreto' });
    logger.error('app.crash', { code: 'E1' });

    const tail = logger.tail(10);
    assert.equal(tail.length, 2);
    const formatted = formatTail(tail);
    assert.match(formatted, /search\.index-failed/);
    assert.match(formatted, /transcript=\[redacted\]/);
    assert.doesNotMatch(formatted, /segreto/);
    assert.equal(logger.getLevel(), 'warn');
  } finally {
    cleanup(root);
  }
});
