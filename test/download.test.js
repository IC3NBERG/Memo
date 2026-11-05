'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Readable } = require('stream');

const { downloadFile, writeResponse } = require('../src/core/models/download');
const { tempDir, cleanup } = require('./helpers');

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    }),
  };
}

test('downloadFile salva il file solo a download completato', async () => {
  const dir = tempDir();
  const { server, baseUrl, close } = await startServer((req, res) => {
    res.writeHead(200, { 'content-length': '11' });
    res.end('model-bytes');
  });

  try {
    const targetPath = path.join(dir, 'models', 'model.bin');
    const progress = [];
    const result = await downloadFile({
      url: `${baseUrl}/model.bin`,
      targetPath,
      onProgress: (data) => progress.push(data),
    });

    assert.equal(result.targetPath, targetPath);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'model-bytes');
    assert.equal(fs.existsSync(`${targetPath}.tmp`), false);
    assert.equal(progress[0].percent, 0);
    assert.equal(progress[progress.length - 1].percent, 100);
    assert.equal(progress[progress.length - 1].downloaded, 11);
  } finally {
    await close();
    cleanup(dir);
  }
});

test('downloadFile segue i redirect anche relativi', async () => {
  const dir = tempDir();
  const { server, baseUrl, close } = await startServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/model.bin' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-length': '5' });
    res.end('hello');
  });

  try {
    const targetPath = path.join(dir, 'model.bin');
    await downloadFile({ url: `${baseUrl}/redirect`, targetPath });
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'hello');
  } finally {
    await close();
    cleanup(dir);
  }
});

test('downloadFile rifiuta uno status HTTP diverso da 200', async () => {
  const dir = tempDir();
  const { server, baseUrl, close } = await startServer((req, res) => {
    res.writeHead(404);
    res.end('not found');
  });

  try {
    const targetPath = path.join(dir, 'model.bin');
    await assert.rejects(
      () => downloadFile({ url: `${baseUrl}/missing`, targetPath }),
      /HTTP 404/,
    );
    assert.equal(fs.existsSync(targetPath), false);
    assert.equal(fs.existsSync(`${targetPath}.tmp`), false);
  } finally {
    await close();
    cleanup(dir);
  }
});

test('downloadFile ripulisce il temporaneo se la connessione si interrompe', async () => {
  const dir = tempDir();
  const { server, baseUrl, close } = await startServer((req, res) => {
    res.writeHead(200, { 'content-length': '10' });
    res.write('abc');
    res.destroy();
  });

  try {
    const targetPath = path.join(dir, 'model.bin');
    await assert.rejects(() => downloadFile({ url: `${baseUrl}/model.bin`, targetPath }));
    assert.equal(fs.existsSync(targetPath), false);
    assert.equal(fs.existsSync(`${targetPath}.tmp`), false);
  } finally {
    await close();
    cleanup(dir);
  }
});

test('writeResponse rifiuta un download troncato ma chiuso correttamente', async () => {
  const dir = tempDir();
  try {
    const res = Readable.from([Buffer.from('abc')]);
    res.headers = { 'content-length': '10' };
    const targetPath = path.join(dir, 'model.bin');

    await assert.rejects(
      () => writeResponse(res, targetPath, () => {}),
      /Download incompleto/,
    );
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'abc');
  } finally {
    cleanup(dir);
  }
});

test('downloadFile interrompe i redirect infiniti', async () => {
  const dir = tempDir();
  const { server, baseUrl, close } = await startServer((req, res) => {
    res.writeHead(302, { location: '/loop' });
    res.end();
  });

  try {
    const targetPath = path.join(dir, 'model.bin');
    await assert.rejects(
      () => downloadFile({ url: `${baseUrl}/loop`, targetPath, maxRedirects: 2 }),
      /Troppi redirect/,
    );
    assert.equal(fs.existsSync(targetPath), false);
  } finally {
    await close();
    cleanup(dir);
  }
});
