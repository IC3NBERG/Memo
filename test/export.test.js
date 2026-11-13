'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  buildExportContent,
  exportFilename,
  writeExportFile,
} = require('../src/core/library/export');
const { tempDir, cleanup } = require('./helpers');

test('buildExportContent lascia intatto il testo TXT', () => {
  assert.equal(buildExportContent({
    format: 'txt',
    name: 'Lezione',
    date: '2025-06-07T08:00:00.000Z',
    text: 'Prima riga\nSeconda riga',
  }), 'Prima riga\nSeconda riga');
});

test('buildExportContent aggiunge frontespizio e data al Markdown', () => {
  const content = buildExportContent({
    format: 'md',
    name: 'Diritto Privato',
    date: '2025-06-07T08:00:00.000Z',
    text: 'Contenuto',
  });

  assert.match(content, /^# Diritto Privato\n\n_Registrato il 07\/06\/2025_\n\n---\n\nContenuto$/);
});

test('buildExportContent gestisce formato sconosciuto, nome e data mancanti', () => {
  assert.equal(buildExportContent({ format: 'pdf', text: 'x' }), 'x');
  assert.equal(
    buildExportContent({ format: 'md', text: 'x' }),
    '# Trascrizione\n\n_Registrato il N/A_\n\n---\n\nx',
  );
  assert.equal(
    buildExportContent({ format: 'md', date: 'non-una-data', text: 'x' }),
    '# Trascrizione\n\n_Registrato il N/A_\n\n---\n\nx',
  );
});

test('exportFilename usa estensione coerente con il formato', () => {
  assert.equal(exportFilename({ format: 'md', name: 'Lezione' }), 'Lezione.md');
  assert.equal(exportFilename({ format: 'txt', name: 'Lezione' }), 'Lezione.txt');
  assert.equal(exportFilename({ format: 'rtf' }), 'trascrizione.txt');
});

test('writeExportFile scrive il contenuto finale nel percorso scelto', () => {
  const dir = tempDir();
  try {
    const filePath = path.join(dir, 'Lezione.md');
    const result = writeExportFile({
      filePath,
      format: 'md',
      name: 'Lezione',
      date: '2025-06-07T08:00:00.000Z',
      text: 'Testo',
    });

    assert.equal(result.success, true);
    assert.deepEqual(result, {
      success: true,
      filePath,
      content: '# Lezione\n\n_Registrato il 07/06/2025_\n\n---\n\nTesto',
    });
    assert.equal(fs.readFileSync(filePath, 'utf8'), result.content);
  } finally {
    cleanup(dir);
  }
});
