'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('compareVersions ordina le versioni semantiche', async () => {
  const { compareVersions } = await import('../scripts/release.mjs');
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0', '1.3.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.throws(() => compareVersions('1.2', '1.2.0'), /Versione non valida/);
});

test('bumpVersion calcola patch, minor, major e versioni esplicite', async () => {
  const { bumpVersion } = await import('../scripts/release.mjs');
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(bumpVersion('1.2.3', '3.4.5'), '3.4.5');
  assert.throws(() => bumpVersion('1.2.3', 'release'), /Incremento non valido/);
});

test('formatEntries raggruppa i commit convenzionali e ignora le release', async () => {
  const { formatEntries } = await import('../scripts/release.mjs');
  const notes = formatEntries([
    { subject: 'feat(editor): aggiunge i timestamp cliccabili' },
    { subject: 'fix: corregge il salvataggio' },
    { subject: 'docs: aggiorna il README' },
    { subject: 'chore(release): v1.2.0' },
    { subject: 'feat(editor): aggiunge i timestamp cliccabili' },
  ]);

  assert.match(notes, /### Novità/);
  assert.match(notes, /\*\*editor:\*\* Aggiunge i timestamp cliccabili/);
  assert.match(notes, /### Correzioni/);
  assert.match(notes, /### Documentazione/);
  assert.doesNotMatch(notes, /v1\.2\.0/);
  assert.equal((notes.match(/timestamp cliccabili/g) || []).length, 1);
});

test('il changelog corrente contiene la versione del package', async () => {
  const { checkRelease, readVersions } = await import('../scripts/release.mjs');
  const versions = readVersions();
  const result = checkRelease(`v${versions.package}`);
  assert.deepEqual(result.problems, []);
});
