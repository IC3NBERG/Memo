# 🔄 Flusso di Rilascio e Aggiornamenti Automatici per Crunch

- **Repository GitHub Ufficiale**: [https://github.com/IC3NBERG/Memo](https://github.com/IC3NBERG/Memo)
- **Target OS**: macOS (Apple Silicon arm64 — M1/M2/M3/M4)

Questo documento specifica il protocollo standard per aggiornare e distribuire **Crunch** a tutti gli utenti. Quando l'utente chiede modifiche future, seguire sempre questi passaggi.

## 📌 Come funziona il rilascio automatico

Quando si implementano modifiche o nuove funzionalità:

1. **Incrementare la versione**:
   In `package.json`, incrementare il campo `"version"` (es. da `1.0.5` a `1.0.6` o `1.1.0`).

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
   - Creare una nuova Release su GitHub associata al tag (es. `v1.0.5`).
   - Caricare nella release i file generati in `dist/` (in particolare `.zip`, `.dmg`, `.blockmap` e `latest-mac.yml`).
   - In alternativa, tramite comando con token GitHub configurato:
     ```bash
     npx electron-builder --mac -p always
     ```
   - Oppure tramite Git Tag se sono attive le GitHub Actions:
     ```bash
     git tag v1.0.5
     git push origin v1.0.5
     ```

4. **Comportamento dell'App per gli Utenti**:
   - Tutte le copie di Crunch installate sui Mac controlleranno il repository ogni 3 ore (e all'avvio).
   - Non appena rilevano la nuova versione, la scaricheranno in background senza interrompere l'utente.
   - Mostreranno la notifica con il pulsante **"Riavvia e Aggiorna"**.
   - Con un click l'app si riavvierà con la nuova versione applicata.

## ⚠️ Firma e notarizzazione (importante per l'auto-update)

Su macOS l'aggiornamento automatico di `electron-updater` richiede un'app firmata e notarizzata.
Per le release pubbliche configurare `CSC_LINK` / `CSC_KEY_PASSWORD` (certificato Developer ID)
e le credenziali Apple per la notarizzazione. Senza firma la build resta installabile manualmente,
ma l'aggiornamento automatico può non essere applicato dal sistema.

Il workflow GitHub Actions dichiara `permissions: contents: write` per poter creare la Release
con il `GITHUB_TOKEN` predefinito.
