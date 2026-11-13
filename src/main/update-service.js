'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { autoUpdater } = require('electron-updater');

const manualUpdater = require('./updater');

/**
 * Aggiornamenti: Squirrel.Mac per build firmate con Developer ID (meccanismo
 * principale), download ZIP + firma Ed25519 + sostituzione con backup per
 * build ad-hoc/non firmate (fallback). Il controller non registra IPC: espone
 * metodi che `ipc.js` collega ai canali.
 */
function createUpdateController({ app, shell, getWindow = () => null } = {}) {
  let manualUpdate = null;
  let manualDownloadVersion = null;
  let usesManualUpdater = false;

  // Pulisce tutti gli installer scaricati (.zip, .sig, .part), la cache di
  // electron-updater e le directory temporanee orfane all'avvio.
  function purgeOldUpdateCache() {
    try {
      const updatesDir = path.join(app.getPath('userData'), 'updates');
      if (fs.existsSync(updatesDir)) {
        const files = fs.readdirSync(updatesDir);
        for (const file of files) {
          try {
            fs.rmSync(path.join(updatesDir, file), { recursive: true, force: true });
          } catch (_) {}
        }
      }

      // Pulisce anche la cache di electron-updater se presente
      try {
        const userCache = app.getPath('userCache');
        const electronUpdaterCache = path.join(userCache, 'crunch-updater');
        if (fs.existsSync(electronUpdaterCache)) {
          fs.rmSync(electronUpdaterCache, { recursive: true, force: true });
        }
      } catch (_) {}

      // Elimina vecchi backup o cartelle temporanee orfane in os.tmpdir()
      const tmpDir = os.tmpdir();
      if (fs.existsSync(tmpDir)) {
        const entries = fs.readdirSync(tmpDir);
        for (const entry of entries) {
          if (/^Crunch-backup-.*\.app$/i.test(entry) || /^crunch-update-/i.test(entry)) {
            try {
              fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
            } catch (_) {}
          }
        }
      }
    } catch (_) {}
  }

  function sendStatus(payload) {
    getWindow()?.webContents.send('update:status', payload);
  }

  function sendProgress(payload) {
    getWindow()?.webContents.send('update:progress', payload);
  }

  async function startManualUpdateDownload(info) {
    if (manualUpdate && manualUpdate.version === info.version && fs.existsSync(manualUpdate.file)) {
      const cached = await manualUpdater.verifyUpdateFile(
        manualUpdate.file,
        manualUpdate.sha512,
        manualUpdate.signature,
      );
      if (cached.ok) {
        sendStatus({
          type: 'downloaded',
          version: manualUpdate.version,
          message: `Versione v${manualUpdate.version} già scaricata e pronta. Clicca per riavviare.`,
        });
        return;
      }
      manualUpdate = null;
    }
    if (manualDownloadVersion === info.version) return;

    const files = Array.isArray(info.files) ? info.files : [];
    const zipFile = files.find((file) => typeof file.url === 'string' && /\.zip($|\?)/i.test(file.url));
    if (!zipFile) {
      sendStatus({
        type: 'error',
        message: 'La release non contiene un pacchetto ZIP aggiornabile.',
      });
      return;
    }

    const fileName = path.basename(decodeURIComponent(zipFile.url.split('?')[0]));
    const dest = path.join(app.getPath('userData'), 'updates', fileName);
    const url = /^https?:\/\//i.test(zipFile.url)
      ? zipFile.url
      : `https://github.com/IC3NBERG/Memo/releases/download/v${info.version}/${encodeURIComponent(fileName)}`;
    const signatureUrl = (() => {
      const parsed = new URL(url);
      parsed.pathname = `${parsed.pathname}.sig`;
      return parsed.toString();
    })();

    manualDownloadVersion = info.version;
    try {
      let digest = zipFile.sha512;
      if (!(await manualUpdater.fileMatchesSha512(dest, zipFile.sha512))) {
        const downloaded = await manualUpdater.downloadFile({
          url,
          dest,
          sha512: zipFile.sha512,
          onProgress: (progress) => sendProgress(progress),
        });
        digest = downloaded.sha512;
      }
      if (!digest) digest = await manualUpdater.sha512File(dest);

      // La firma Ed25519 copre il digest SHA-512 ed è obbligatoria: senza di
      // essa il pacchetto non viene mai estratto o installato.
      const signature = await manualUpdater.downloadText(signatureUrl);
      const verification = await manualUpdater.verifyUpdateFile(dest, digest, signature);
      if (!verification.ok) {
        fs.rmSync(dest, { force: true });
        throw new Error('Firma crittografica dell\'aggiornamento non valida');
      }

      const signatureFile = `${dest}.sig`;
      fs.writeFileSync(signatureFile, `${signature}\n`);
      manualUpdate = {
        version: info.version,
        file: dest,
        sha512: verification.sha512,
        signature,
        signatureFile,
      };
      sendStatus({
        type: 'downloaded',
        version: info.version,
        message: `Versione v${info.version} scaricata, verificata e pronta. Clicca per riavviare.`,
      });
    } catch (err) {
      sendStatus({ type: 'error', message: `Download aggiornamento fallito: ${err.message}` });
    } finally {
      manualDownloadVersion = null;
    }
  }

  function setup() {
    const bundlePath = manualUpdater.getAppBundlePath(app.getPath('exe'));
    usesManualUpdater = !manualUpdater.isDeveloperIdSigned(bundlePath);

    // Pulisci la cache dei vecchi aggiornamenti all'avvio
    purgeOldUpdateCache();

    autoUpdater.autoDownload = !usesManualUpdater;
    autoUpdater.autoInstallOnAppQuit = !usesManualUpdater;

    autoUpdater.on('checking-for-update', () => {
      sendStatus({ type: 'checking', message: 'Verifica aggiornamenti...' });
    });
    autoUpdater.on('update-available', (info) => {
      sendStatus({
        type: 'available',
        version: info.version,
        message: `Trovata nuova versione v${info.version}. Download in corso...`,
      });
      if (usesManualUpdater) startManualUpdateDownload(info);
    });
    autoUpdater.on('update-not-available', (info) => {
      sendStatus({
        type: 'not-available',
        version: info?.version || app.getVersion(),
        message: 'Crunch è già aggiornato all\'ultima versione.',
      });
    });
    autoUpdater.on('error', (err) => {
      sendStatus({
        type: 'error',
        message: err ? (err.message || String(err)) : 'Errore durante la ricerca aggiornamenti',
      });
    });
    autoUpdater.on('download-progress', (progress) => {
      sendProgress({
        percent: Math.round(progress.percent || 0),
        transferred: progress.transferred,
        total: progress.total,
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      sendStatus({
        type: 'downloaded',
        version: info.version,
        message: `Versione v${info.version} scaricata e pronta. Clicca per riavviare.`,
      });
    });

    if (app.isPackaged) {
      setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 4000);
      setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 3 * 60 * 60 * 1000);
    }
  }

  async function checkForUpdates() {
    if (!app.isPackaged) {
      return { success: false, message: 'Aggiornamenti automatici attivi nell\'app installata (Release).' };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, updateInfo: result?.updateInfo };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function restartAndInstall() {
    if (!usesManualUpdater) {
      autoUpdater.quitAndInstall();
      return { success: true };
    }

    if (!manualUpdate || !fs.existsSync(manualUpdate.file)) {
      shell.openExternal(manualUpdater.RELEASES_URL);
      return {
        success: false,
        action: 'open-release',
        error: 'Aggiornamento non ancora scaricato: ho aperto la pagina della release.',
      };
    }

    const bundlePath = manualUpdater.getAppBundlePath(app.getPath('exe'));
    if (!bundlePath) return { success: false, error: 'Percorso dell\'app non riconosciuto.' };

    try {
      // Riverifica al momento dell'installazione: il file in cache potrebbe
      // essere stato modificato dopo il download.
      const verification = await manualUpdater.verifyUpdateFile(
        manualUpdate.file,
        manualUpdate.sha512,
        manualUpdate.signature,
      );
      if (!verification.ok) {
        fs.rmSync(manualUpdate.file, { force: true });
        manualUpdate = null;
        return { success: false, error: 'Il pacchetto di aggiornamento non supera la verifica della firma.' };
      }

      const logPath = path.join(app.getPath('logs'), 'updater.log');
      const result = manualUpdater.installUpdate({
        zipPath: manualUpdate.file,
        expectedVersion: manualUpdate.version,
        appBundlePath: bundlePath,
        currentPid: process.pid,
        logPath,
        launch: true,
      });
      setTimeout(() => app.quit(), 400);
      return { success: true, logPath: result.logPath, backupPath: result.backupPath };
    } catch (err) {
      return { success: false, error: `Impossibile avviare l'aggiornamento: ${err.message}` };
    }
  }

  return {
    checkForUpdates,
    restartAndInstall,
    setup,
  };
}

module.exports = {
  createUpdateController,
};
