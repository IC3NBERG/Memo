# 🔄 Flusso di rilascio e aggiornamenti automatici per Crunch

- **Repository GitHub ufficiale**: [https://github.com/IC3NBERG/Memo](https://github.com/IC3NBERG/Memo)
- **Target OS**: macOS (Apple Silicon arm64 — M1/M2/M3/M4)
- **Documento di sicurezza**: [`docs/RELEASE_SECURITY.md`](docs/RELEASE_SECURITY.md)

Questo documento descrive il protocollo per pubblicare **Crunch**. La pipeline
è automatica sul tag, ma versione, changelog e tag restano passaggi espliciti
e verificabili.

## 📌 Pipeline

### Test su ogni push e PR

`.github/workflows/test.yml` esegue:

- lint senza dipendenze (`scripts/lint.mjs`);
- revisione entitlements;
- test Node e test con l'ABI di Electron su **Ubuntu, macOS e Windows**
  (Node 20 e 24);
- E2E Electron su macOS;
- build del bundle macOS + smoke test di primo avvio e updater.

### Release su tag

`.github/workflows/release.yml` parte da un tag `v*` e:

1. verifica tag annotato, commit su `origin/main`, versione allineata in
   `package.json`/`package-lock.json` e sezione presente nel `CHANGELOG.md`;
2. esegue lint, test e revisione entitlements;
3. compila whisper.cpp e il bundle Electron **senza pubblicare**;
4. esegue lo smoke test di firma, Gatekeeper, primo avvio, aggiornamento e
   ripristino;
5. firma lo ZIP con Ed25519 e crea `<zip>.sig`;
6. genera le note dal changelog e pubblica gli asset con `gh`;
7. verifica la release remota con `verify-releases --verify-signatures`.

Se un passaggio fallisce, la release non viene pubblicata.

## 🧾 Preparare una release

1. **Incrementare versione e changelog**:
   ```bash
   npm run release:prepare -- patch   # oppure minor, major, x.y.z
   ```
   Il comando aggiorna `package.json`, `package-lock.json` e `CHANGELOG.md`
   partendo dai commit convenzionali (`feat`, `fix`, `docs`, ...). Rivedere il
   testo prima di procedere.

2. **Verificare**:
   ```bash
   npm run lint
   npm test
   npm run release:check -- --tag v1.3.0
   ```

3. **Commit e tag annotato**:
   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore(release): v1.3.0"
   git tag -a v1.3.0 -m "Crunch v1.3.0"
   git push origin main v1.3.0
   ```
   I tag lightweight non sono accettati per le release dalla 1.3.0.

4. **Attendere la pipeline**. Gli asset prodotti sono:
   - `Crunch-X.X.X-arm64.dmg`
   - `Crunch-X.X.X-arm64-mac.zip`
   - `Crunch-X.X.X-arm64.dmg.blockmap`
   - `Crunch-X.X.X-arm64-mac.zip.blockmap`
   - `Crunch-X.X.X-arm64-mac.zip.sig`
   - `latest-mac.yml`

## 🔐 Secret e variabili GitHub

| Nome | Tipo | Uso |
|---|---|---|
| `MAC_CERTIFICATE_P12` | secret | certificato Developer ID Application |
| `MAC_CERTIFICATE_PASSWORD` | secret | password del certificato |
| `APPLE_ID` | secret | account Apple per la notarizzazione |
| `APPLE_APP_SPECIFIC_PASSWORD` | secret | password specifica dell'app |
| `APPLE_TEAM_ID` | secret | Team ID Apple |
| `UPDATE_SIGNING_KEY` | secret | chiave privata Ed25519 degli aggiornamenti |
| `REQUIRE_SIGNED_RELEASE` | variabile | `true` rende firma e notarizzazione obbligatorie |

Senza i secret Apple la pipeline produce una build non firmata: è supportata
dal fallback, ma non è una release completa. Senza `UPDATE_SIGNING_KEY` la
pipeline si ferma, perché lo ZIP non sarebbe verificabile.

Per generare la chiave di firma degli aggiornamenti:

```bash
node scripts/update-keygen.mjs --force
# copiare il contenuto di .secrets/update-signing-key.pem nel secret
# UPDATE_SIGNING_KEY, poi conservarlo in un password manager
```

La chiave pubblica viene incorporata in `src/main/update-public-key.js` e
committata. La rotazione richiede una release firmata con la nuova chiave.

## ✅ Checklist obbligatoria

Ogni release pubblicata deve avere:

- **Tag annotato** pushato e puntato a un commit su `main`.
- **Versione allineata** in `package.json` e `package-lock.json`.
- **Sezione nel changelog** per la versione del tag.
- **Sei asset** elencati sopra, incluso `.sig`.
- **Manifest corretto**: `latest-mac.yml` con versione del tag e dimensioni
  coerenti.
- **Firma Ed25519 valida** dello ZIP, verificata da `verify-releases`.
- **Download funzionante**: DMG e ZIP rispondono HTTP 200.
- **Workflow verde** e smoke test superato.
- **Titolo e note in italiano**, senza emoji, con la versione esplicita.

Verifica automatica di tutte le release (o di una sola):

```bash
npm run verify-releases
npm run verify-releases -- --tag v1.3.0 --strict --verify-signatures
```

Lo script è in sola lettura. Controlla tag, commit, asset, manifest, firma e
raggiungibilità, e termina con codice diverso da zero se trova errori. Per
saltare i controlli HTTP:

```bash
npm run verify-releases -- --skip-http
```

## ⚠️ Firma e notarizzazione

Per le release pubbliche configurare `CSC_LINK`/`CSC_KEY_PASSWORD` e le
credenziali Apple (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).
`electron-builder` usa hardened runtime, gli entitlements approvati e
`notarytool`.

Lo smoke test esegue `codesign --verify`, `spctl` e, con
`REQUIRE_NOTARIZED=1`, `xcrun stapler validate`. Su una release firmata ma non
notarizzata lo script avvisa; con `REQUIRE_SIGNED_RELEASE=true` la pipeline
fallisce.

## 🔁 Aggiornamenti

- **Build firmata Developer ID** → `electron-updater` usa Squirrel.Mac; la
  firma Apple del pacchetto è la garanzia crittografica.
- **Build ad-hoc/non firmata** → fallback interno: scarica lo ZIP, verifica
  SHA-512 e firma Ed25519 del digest, sostituisce l'app conservando un backup e
  la riapre. Se la copia fallisce, ripristina il backup.

Il primo passaggio a una versione con updater interno richiede un'installazione
manuale del DMG. Dalle versioni successive il pulsante **"Riavvia e Aggiorna"**
funziona anche senza firma Apple. Il log è in `updater.log` nella cartella
Logs; i backup restano in `/tmp/Crunch-backup-*.app` fino al riavvio del Mac.

Per una build non notarizzata Gatekeeper può richiedere "tasto destro → Apri"
alla prima installazione: è il fallback documentato, non un errore silenzioso.

## 🧪 Test manuali utili

```bash
# Primo avvio e ciclo aggiornamento su una copia del bundle
bash scripts/smoke-release.sh dist/mac-arm64/Crunch.app

# Solo updater (estrazione, backup, ripristino)
node scripts/smoke-updater.mjs dist/mac-arm64/Crunch.app

# Test unitari di firma, checksum e script di installazione
npm run test:updater
```

Il workflow dichiara `permissions: contents: write` per creare la Release con
il `GITHUB_TOKEN` predefinito e `actions: read` per controllare lo stato delle
esecuzioni. La revisione completa di firma, entitlements e minacce è in
[`docs/RELEASE_SECURITY.md`](docs/RELEASE_SECURITY.md).
