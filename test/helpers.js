'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function tempDir(prefix = 'crunch-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function copyFixture(name, rootDir) {
  const source = path.join(__dirname, 'fixtures', 'v1', name);
  const destination = path.join(rootDir, name);
  fs.cpSync(source, destination, { recursive: true });
  return destination;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = {
  tempDir,
  copyFixture,
  readJson,
  cleanup,
};
