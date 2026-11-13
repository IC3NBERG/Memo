# CI/CD, firma e sicurezza delle release

Questo documento è la revisione formale del percorso che porta un commit a una
release installabile e aggiornabile. Copre i punti 8 e 9 dell'audit: pipeline,
versione/changelog, notarizzazione, firma degli aggiornamenti, entitlements e
test Gatekeeper/primo avvio/aggiornamento/ripristino.

Ultima revisione: 13 novembre 2026. Responsabile: maintainer del repository.

---

## 1. Pipeline

### Test (`.github/workflows/test.yml`)

| Job | Dove | Cosa esegue |
|---|---|---|
| `lint` | Ubuntu | `scripts/lint.mjs`, `scripts/verify-entitlements.mjs` |
| `unit` | Ubuntu, macOS, Windows (Node 20 e 24) | test Node e test con l'ABI di Electron |
| `e2e` | macOS | avvio Electron, preload, gruppi, salvataggio, cestino via CDP |
| `build` | macOS | `npm run build:dir` + smoke test del bundle |

La matrice copre i tre sistemi della promessa cross-platform anche se la
release pubblicata è solo macOS Apple Silicon. Il lint è volutamente senza
dipendenze esterne: controllo di sintassi, `require` rotti, JSON non validi,
`.only`, `debugger`, `console.log` nel codice di produzione, CRLF, spazi finali
e chiavi private accidentali.

Il workflow gira su ogni push e su ogni pull request. La build di PR non ha
credenziali: verifica struttura, primo avvio, entitlements e updater interno,
ma non pretende firma o notarizzazione.

### Release (`.github/workflows/release.yml`)

Un tag `v*` avvia due job:

1. **verify** — lint, revisione entitlements e `release.mjs check --strict`:
   tag annotato, commit su `origin/main`, versione allineata in
   `package.json`/`package-lock.json`, sezione presente nel `CHANGELOG.md`.
2. **release** — test, build Whisper Metal, build Electron senza pubblicazione,
   smoke test del bundle, firma Ed25519 dello ZIP, note generate dal changelog,
   pubblicazione con `gh`, verifica finale della release remota con
   `verify-releases --verify-signatures`.

La release non viene pubblicata se uno di questi passaggi fallisce. Il job
`release` non ricostruisce gli asset dopo lo smoke test: pubblica esattamente
il bundle che è stato verificato.

### Versione e changelog

La versione non viene dedotta dal tag: il tag deve corrispondere alla versione
già presente nei file. Il changelog è generato dai commit convenzionali ma può
essere rivisto a mano prima del commit di release.

```bash
npm run release:prepare -- patch   # oppure minor, major, x.y.z
npm run release:check -- --tag v1.3.0
npm run release:notes -- --tag v1.3.0
npm run verify-releases -- --tag v1.3.0 --strict --verify-signatures
```

`release:prepare` aggiorna `package.json`, `package-lock.json` e inserisce la
sezione nel `CHANGELOG.md`. Il commit e il tag restano espliciti:

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): v1.3.0"
git tag -a v1.3.0 -m "Crunch v1.3.0"
git push origin main v1.3.0
```

I tag precedenti alla 1.3.0 possono essere lightweight; dalla 1.3.0 la
verifica `--strict` richiede un tag annotato.

---

## 2. Firma e notarizzazione

La configurazione in `package.json` abilita:

- `hardenedRuntime: true`;
- `gatekeeperAssess: false` (la valutazione è fatta dallo smoke test);
- `entitlements` e `entitlementsInherit` espliciti;
- `notarize: true`.

`electron-builder` firma con `CSC_LINK`/`CSC_KEY_PASSWORD` e notarizza tramite
`notarytool` quando sono presenti `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` e
`APPLE_TEAM_ID`. Senza credenziali la build resta non firmata: è supportata
come fallback, ma non è una release "completa".

### Secret GitHub richiesti

| Secret | Uso |
|---|---|
| `MAC_CERTIFICATE_P12` | certificato Developer ID Application (base64 o URL) |
| `MAC_CERTIFICATE_PASSWORD` | password del certificato |
| `APPLE_ID` | account Apple per la notarizzazione |
| `APPLE_APP_SPECIFIC_PASSWORD` | password specifica dell'app |
| `APPLE_TEAM_ID` | Team ID Apple |
| `UPDATE_SIGNING_KEY` | chiave privata Ed25519 per gli aggiornamenti |
| `GITHUB_TOKEN` | fornito automaticamente da Actions |

Impostare la variabile di repository `REQUIRE_SIGNED_RELEASE=true` per rendere
obbligatorie firma e notarizzazione. Senza la variabile la pipeline produce
comunque una build non firmata, ma lo segnala e usa il fallback.

### Notarizzazione

La notarizzazione è obbligatoria per una release pubblica: Gatekeeper deve
approvare il bundle al primo avvio e l'aggiornamento nativo Squirrel richiede
una firma Developer ID valida. Lo smoke test esegue:

```bash
codesign --verify --deep --strict --verbose=2 Crunch.app
spctl --assess --type execute --verbose=4 Crunch.app
xcrun stapler validate Crunch.app   # solo con REQUIRE_NOTARIZED=1
```

---

## 3. Entitlements: revisione formale

I file approvati sono `assets/entitlements.mac.plist` (app) e
`assets/entitlements.mac.inherit.plist` (helper e framework). La revisione è
automatica con `npm run verify-entitlements` e viene eseguita in CI.

| Entitlement | Ambito | Motivo | Rischio residuo |
|---|---|---|---|
| `com.apple.security.cs.allow-jit` | main + inherit | V8 e Metal richiedono JIT con hardened runtime | consente JIT nel processo; mitigato da ASLR e hardened runtime |
| `com.apple.security.cs.allow-unsigned-executable-memory` | main + inherit | Electron e framework nativi allocano memoria eseguibile | non consente di caricare librerie arbitrarie da disco |
| `com.apple.security.cs.disable-library-validation` | main + inherit | carica `better-sqlite3` ricompilato e firmato nel bundle | attenuazione: nessun percorso di caricamento controllato dall'utente |
| `com.apple.security.device.audio-input` | main | microfono per la registrazione | nessuno: è la funzione primaria |
| `com.apple.security.network.client` | main | download modelli e controllo aggiornamenti | nessuno: solo HTTPS verso host noti |
| `com.apple.security.files.user-selected.read-write` | main | export TXT/Markdown tramite dialogo | limitato ai file scelti dall'utente |
| `com.apple.security.files.downloads.read-write` | main | update ZIP nella cartella Download | nessuno: l'updater scrive in `userData`, chiave mantenuta per compatibilità |

Sono vietati `get-task-allow`, `com.apple.security.cs.debugger`,
`allow-dyld-environment-variables`, `disable-executable-page-protection` e
`app-sandbox` (l'app non è sandboxed e non deve dichiararlo). Ogni nuova chiave
richiede una modifica all'allowlist in `scripts/verify-entitlements.mjs` e a
questa tabella.

Prossima revisione: alla prima release firmata e comunque entro 6 mesi.

---

## 4. Aggiornamenti

### Percorso principale: Squirrel.Mac

Se il bundle in esecuzione ha una firma Developer ID valida
(`codesign -dv` + `codesign --verify --deep --strict`), `electron-updater`
scarica e installa tramite Squirrel.Mac. La firma Apple del pacchetto è la
garanzia crittografica: non viene accettato un bundle con firma diversa.

### Fallback: updater interno

Se il bundle è ad-hoc o non firmato, Squirrel non può installare. L'updater
interno scarica lo ZIP della release, verifica:

1. lo **SHA-512** dichiarato in `latest-mac.yml`;
2. la **firma Ed25519** del digest, contenuta in `Crunch-X.Y.Z-arm64-mac.zip.sig`;
3. la **versione** dentro il bundle estratto;
4. al momento del riavvio, ripete la verifica di digest e firma sul file in cache.

Solo dopo estrae il bundle, conserva un backup in
`/tmp/Crunch-backup-*.app` e sostituisce l'app con uno script che attende la
chiusura del processo. Se la copia fallisce, il backup viene ripristinato e la
vecchia app riaperta. Il log è in `updater.log` nella cartella Logs.

### Chiave Ed25519

La chiave pubblica è incorporata in `src/main/update-public-key.js`; la privata
non entra nel repository. Per generare una nuova coppia:

```bash
node scripts/update-keygen.mjs --force
```

Copiare `.secrets/update-signing-key.pem` nel secret `UPDATE_SIGNING_KEY` e
pubblicare una release firmata con la nuova chiave. La rotazione richiede un
aggiornamento manuale per le versioni che incorporano la chiave precedente.
La firma viene creata da `scripts/sign-update.mjs` e verificata dall'updater e
da `verify-releases --verify-signatures`.

Il file `.sig` è un asset della release: se manca, l'updater interno rifiuta
l'aggiornamento e apre la pagina della release per un'installazione manuale.

### Fallback per build non firmate

Il primo passaggio a una versione con updater interno richiede un'installazione
manuale del DMG. Dalle versioni successive il pulsante "Riavvia e Aggiorna"
funziona anche senza firma Apple, perché la firma Ed25519 dell'aggiornamento è
indipendente dalla firma del bundle. Gatekeeper può richiedere il classico
"tasto destro → Apri" alla prima installazione di una build non notarizzata:
è documentato nel README e non viene nascosto all'utente.

---

## 5. Test di Gatekeeper, primo avvio, aggiornamento e ripristino

`scripts/smoke-release.sh` viene eseguito sulla build prima della
pubblicazione. Verifica:

1. versione del bundle uguale a `package.json`;
2. firma Developer ID e `codesign --verify`;
3. `spctl` e, con `REQUIRE_NOTARIZED=1`, il ticket di notarizzazione;
4. entitlements estratti dal bundle contro l'allowlist;
5. primo avvio reale con `Crunch --smoke-test` e creazione della cartella dati;
6. installazione dell'aggiornamento su una copia del bundle, presenza del
   backup e versione aggiornata (`scripts/smoke-updater.mjs`);
7. fallimento simulato della copia e ripristino del backup.

I test unitari in `test/updater.test.js` coprono checksum, firma, redirect,
download incompleti, estrazione, versione inattesa e script di installazione.
`test/entitlements.test.js` copre l'allowlist e la configurazione.

Comandi locali:

```bash
npm run smoke-release -- dist/mac-arm64/Crunch.app
REQUIRE_SIGNED=1 REQUIRE_NOTARIZED=1 npm run smoke-release -- dist/mac-arm64/Crunch.app
npm run test:updater
```

---

## 6. Stato rispetto all'audit

| Punto | Stato dopo questa modifica |
|---|---|
| Actions per test e build | ✅ lint, test, e2e e build in CI |
| Lint | ✅ `scripts/lint.mjs`, senza dipendenze |
| Matrice macOS/Windows/Linux | ✅ test su tre OS; release solo macOS |
| Test a ogni push/PR | ✅ |
| `verify-releases` | ✅ asset, versione, dimensioni, HTTP e firma |
| Versione e changelog automatici | ✅ `release:prepare` + sezione da commit; revisione manuale possibile |
| Notarizzazione | ✅ configurazione e workflow; richiede i secret |
| Updater interno come fallback | ✅ Squirrel primario per build firmate, interno per le altre |
| Firma crittografica update | ✅ Ed25519 sul digest SHA-512 |
| Revisione entitlements | ✅ allowlist, script e questa revisione |
| Test Gatekeeper/primo avvio/update/ripristino | ✅ smoke test sulla build |
| Fallback build non firmate documentato | ✅ qui e nel README |
