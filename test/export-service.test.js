'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createExportService } = require('../src/main/export-service');
const { tempDir, cleanup } = require('./helpers');

test('exportTranscript rifiuta un percorso fuori archivio', async () => {
  const service = createExportService({
    isValidRecordingDir: () => false,
    choosePath: () => { throw new Error('non deve aprire il dialogo'); },
  });

  assert.deepEqual(await service.exportTranscript({
    recDir: '/fuori',
    format: 'txt',
    text: 'x',
  }), { success: false, error: 'Registrazione non valida' });
});

test('exportTranscript non scrive nulla se l’utente annulla', async () => {
  const calls = [];
  const service = createExportService({
    isValidRecordingDir: () => true,
    readMetadata: () => ({ name: 'Lezione', date: '2025-06-07T08:00:00.000Z' }),
    choosePath: async (options) => {
      calls.push(options);
      return { canceled: true };
    },
    writeFile: () => { throw new Error('non deve scrivere'); },
  });

  assert.deepEqual(await service.exportTranscript({
    recDir: '/archive/Lezione',
    format: 'md',
    text: 'Contenuto',
  }), { success: false, canceled: true });
  assert.equal(calls[0].defaultName, 'Lezione.md');
});

test('exportTranscript sceglie il nome, scrive e rivela il file', async () => {
  const dir = tempDir();
  try {
    const filePath = path.join(dir, 'Lezione.txt');
    const revealed = [];
    const service = createExportService({
      isValidRecordingDir: () => true,
      readMetadata: () => ({ name: 'Lezione', date: '2025-06-07T08:00:00.000Z' }),
      choosePath: async ({ format, defaultName }) => {
        assert.equal(format, 'txt');
        assert.equal(defaultName, 'Lezione.txt');
        return { filePath };
      },
      reveal: (value) => revealed.push(value),
    });

    const result = await service.exportTranscript({
      recDir: '/archive/Lezione',
      format: 'txt',
      text: 'Contenuto',
    });

    assert.deepEqual(result, { success: true, filePath });
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'Contenuto');
    assert.deepEqual(revealed, [filePath]);
  } finally {
    cleanup(dir);
  }
});

test('exportTranscript converte gli errori in un risultato, non in un’eccezione', async () => {
  const service = createExportService({
    isValidRecordingDir: () => true,
    readMetadata: () => ({ name: 'Lezione' }),
    choosePath: async () => ({ filePath: '/non/scrivibile.txt' }),
    writeFile: () => { throw new Error('EACCES'); },
  });

  assert.deepEqual(await service.exportTranscript({
    recDir: '/archive/Lezione',
    format: 'txt',
    text: 'x',
  }), { success: false, error: 'EACCES' });
});
