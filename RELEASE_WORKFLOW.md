# 🔄 Flusso di Rilascio e Aggiornamenti Automatici per Crunch

- **Repository GitHub Ufficiale**: [https://github.com/IC3NBERG/Memo](https://github.com/IC3NBERG/Memo)
- **Target OS**: macOS (Apple Silicon arm64 — M1/M2/M3/M4)

Questo documento specifica il protocollo standard per aggiornare e distribuire **Crunch** a tutti gli utenti. Quando l'utente chiede modifiche future, seguire sempre questi passaggi.

## 📌 Come funziona il rilascio automatico

Quando si implementano modifiche o nuove funzionalità:

1. **Incrementare la versione**:
   In `package.json`, incrementare il campo `"version"` (es. da `1.0.6` a `1.0.7` o `1.1.0`).

2. **Compilare la nuova release**:
   ```bash
   npm run build
   ```
   Questo genera:
   - `dist/Crunch-X.X.X-arm64.dmg` (installer per nuovi utenti)
   - `dist/Crunch-X.X.X-arm64-mac.zip` (pacchetto usato dall'auto-updater)
   - `dist/Crunch-X.X.X-arm64.dmg.blockmap` e `dist/Crunch-X.X.X-arm64-mac.zip.blockmap`
   - `dist/latest-mac.yml` (manifest usato da electron-updater)

3. **Pubblicare su GitHub Release**:
   - Creare una nuova Release su GitHub associata al tag (es. `v1.0.6`).
   - Caricare nella release i file generati in `dist/` (in particolare `.zip`, `.dmg`, `.blockmap` e `latest-mac.yml`).
   - In alternativa, tramite comando con token GitHub configurato:
     ```bash
     npx electron-builder --mac -p always
     ```
   - Oppure tramite Git Tag se sono attive le GitHub Actions:
     ```bash
     git tag v1.0.6
     git push origin v1.0.6
     ```

4. **Comportamento dell'App per gli Utenti**:
   - Tutte le copie di Crunch installate sui Mac controlleranno il repository ogni 3 ore (e all'avvio).
   - Non appena rilevano la nuova versione, la scaricheranno in background senza interrompere l'utente.
   - Mostreranno la notifica con il pulsante **"Riavvia e Aggiorna"**.
   - Con un click l'app si riavvierà con la nuova versione applicata.

## ⚠️ Firma e notarizzazione (importante per l'auto-update)

Su macOS l'aggiornamento automatico nativo di `electron-updater` (Squirrel) richiede un'app firmata
con lo stesso Developer ID e notarizzata. Per le release pubbliche configurare `CSC_LINK` /
`CSC_KEY_PASSWORD` e le credenziali Apple per la notarizzazione.

## 🔁 Fallback per build non firmate

Crunch controlla la firma dell'app in esecuzione:

- **Build firmata con Developer ID** → usa l'aggiornamento nativo Squirrel.
- **Build ad-hoc/non firmata** → usa l'updater interno: scarica lo ZIP della Release, verifica lo
  SHA-512, sostituisce l'app conservando un backup e la riapre automaticamente.

Il primo passaggio a una versione che contiene questo meccanismo richiede un'installazione manuale
del DMG. Dalle versioni successive il pulsante **"Riavvia e Aggiorna"** funziona anche senza firma.
Il log dell'installazione si trova nella cartella Logs dell'app (`updater.log`); i backup restano
in `/tmp/Crunch-backup-*.app` fino al riavvio del Mac.

Il workflow GitHub Actions dichiara `permissions: contents: write` per poter creare la Release
con il `GITHUB_TOKEN` predefinito.
