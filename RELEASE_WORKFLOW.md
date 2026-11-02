# 🔄 Flusso di Rilascio e Aggiornamenti Automatici per Memo

- **Repository GitHub Ufficiale**: [https://github.com/IC3NBERG/Memo](https://github.com/IC3NBERG/Memo)
- **Target OS**: macOS (Apple Silicon arm64 — M1/M2/M3/M4)

Questo documento specifica il protocollo standard per aggiornare e distribuire **Memo** a tutti gli utenti. Quando l'utente chiede modifiche future, seguire sempre questi passaggi.

## 📌 Come funziona il rilascio automatico

Quando si implementano modifiche o nuove funzionalità:

1. **Incrementare la versione**:
   In `package.json`, incrementare il campo `"version"` (es. da `1.0.0` a `1.0.1` o `1.1.0`).

2. **Compilare la nuova release**:
   ```bash
   npm run build
   ```
   Questo genera:
   - `dist/Memo-X.X.X-arm64.dmg` (installer per nuovi utenti)
   - `dist/Memo-X.X.X-arm64-mac.zip` (pacchetto usato dall'auto-updater)
   - `dist/Memo-X.X.X-arm64.dmg.blockmap` e `dist/Memo-X.X.X-arm64-mac.zip.blockmap`

3. **Pubblicare su GitHub Release**:
   - Creare una nuova Release su GitHub associata al tag (es. `v1.0.1`).
   - Caricare nella release i file generati in `dist/` (in particolare `.zip`, `.dmg`, `.blockmap` e `latest-mac.yml`).
   - In alternativa, tramite comando con token GitHub configurato:
     ```bash
     npx electron-builder --mac -p always
     ```
   - Oppure tramite Git Tag se sono attive le GitHub Actions:
     ```bash
     git tag v1.0.1
     git push origin v1.0.1
     ```

4. **Comportamento dell'App per gli Utenti**:
   - Tutte le copie di Memo installate sui Mac controlleranno il repository ogni 3 ore (e all'avvio).
   - Non appena rilevano la nuova versione, la scaricheranno in background senza interrompere l'utente.
   - Mostreranno la notifica con il pulsante **"Riavvia e Aggiorna"**.
   - Con un click l'app si riavvierà con la nuova versione applicata.

