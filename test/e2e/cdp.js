'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const electronPath = require('electron');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, { timeoutMs = 20000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (value) return value;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timeout in attesa di ${file}`);
}

async function waitForJson(url, { timeoutMs = 20000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch (err) {
      lastError = err;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timeout in attesa di ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout connessione CDP')), 10000);
      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.ws.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(event.error || new Error('Errore WebSocket CDP'));
      }, { once: true });
    });

    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      this.events.push(message);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, { awaitPromise = true } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Errore di valutazione nella pagina');
    }
    return result.result?.value;
  }

  close() {
    try { this.ws?.close(); } catch (_) {}
  }
}

async function launchApp({ root = path.join(__dirname, '..', '..'), recordingsDir, timeoutMs = 30000 } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'crunch-e2e-profile-'));
  const env = {
    ...process.env,
    CRUNCH_RECORDINGS_DIR: recordingsDir,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, [
    root,
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
  ], { env, stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data.toString(); });

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  let client = null;
  try {
    const port = (await waitForFile(portFile, { timeoutMs })).split('\n')[0];
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, { timeoutMs });
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('Nessun target pagina nella finestra Electron');

    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');
    await client.send('Log.enable');

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ready = await client.evaluate(
        "document.readyState === 'complete' && !!window.crunchAPI && !!document.getElementById('app-layout')",
        { awaitPromise: false },
      );
      if (ready) break;
      await delay(100);
    }

    return {
      child,
      client,
      userDataDir,
      async close() {
        client?.close();
        try { child.kill('SIGTERM'); } catch (_) {}
        await Promise.race([
          new Promise((resolve) => child.once('exit', resolve)),
          delay(3000),
        ]);
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
      },
      collectErrors() {
        const errors = [];
        for (const event of client?.events || []) {
          if (event.method === 'Runtime.exceptionThrown') {
            errors.push(event.params.exceptionDetails?.text || 'Eccezione nel renderer');
          }
          if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
            errors.push(event.params.entry.text);
          }
        }
        return errors;
      },
      collectExceptions() {
        return (client?.events || [])
          .filter((event) => event.method === 'Runtime.exceptionThrown')
          .map((event) => event.params.exceptionDetails?.text || 'Eccezione nel renderer');
      },
      stderr: () => stderr,
    };
  } catch (err) {
    client?.close();
    try { child.kill('SIGKILL'); } catch (_) {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
    err.message += `\nElectron stderr:\n${stderr}`;
    throw err;
  }
}

module.exports = {
  CdpClient,
  delay,
  launchApp,
  waitForFile,
  waitForJson,
};
