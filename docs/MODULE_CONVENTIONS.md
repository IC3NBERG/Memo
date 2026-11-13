# Convenzioni dei moduli

Queste regole valgono per tutto il repository. Servono a mantenere il core
testabile senza Electron, i confini IPC espliciti e le modifiche locali.

## Livelli

| Livello | Directory | Dipendenze consentite |
|---|---|---|
| Core | `src/core/` | solo Node e altri moduli `core` |
| Main services | `src/main/*-service.js`, `ipc.js` | `core`, Electron solo nei file di bootstrap/adapter |
| Bootstrap | `src/main/main.js` | Electron, servizi e moduli `core` |
| Renderer | `src/renderer/` | DOM, Web API e `window.crunchAPI` |
| Test | `test/` | `node:test`, moduli `core`, servizi con dipendenze iniettate |

Regole:

1. **Il core non importa Electron.** Niente `app`, `BrowserWindow`, `ipcMain`,
   `dialog` o `shell` dentro `src/core/`.
2. **I servizi main non registrano IPC.** Espongono metodi; `src/main/ipc.js`
   traduce canali, eventi e payload.
3. **Il renderer non accede al filesystem.** Ogni operazione passa dal preload
   (`window.crunchAPI`).
4. **Le dipendenze esterne si iniettano.** Un servizio riceve `pathGuard`,
   `dialog`, `choosePath`, `clock` o `spawn` come parametri, così il test usa
   un archivio temporaneo o un fake.

## Nomi e struttura

- File in `kebab-case`, funzioni in `camelCase`, costanti in `UPPER_SNAKE_CASE`.
- Un modulo esporta una factory (`createXService`) o funzioni pure; niente
  singleton impliciti nel core.
- I servizi main hanno suffisso `-service.js`; gli adapter Electron restano in
  `main.js`, `ipc.js` o `preload.js`.
- Nel renderer ogni file è uno script classico caricato da `index.html`. Le
  funzioni condivise sono dichiarazioni globali; lo stato applicativo resta in
  `app.js` (`state`) e gli elementi DOM in `UI`.

## Errori e risultati

- Gli handler restituiscono sempre un oggetto, mai un'eccezione al renderer.
- Forma consigliata: `{ success, code?, error?, ...dati }`.
- I codici sono stabili e in inglese kebab-case:
  `model-missing`, `translation-model-missing`, `invalid-folder`,
  `folder-exists`, `unmanaged-files`, `read-only-future`, `empty-audio`,
  `asr-unavailable`, `asr-failed`.
- I messaggi utente sono in italiano e non contengono percorsi assoluti non
  richiesti.

## Persistenza

- Ogni scrittura di dati utente passa da `core/storage/atomic.js`
  (`writeFileAtomicSync`, `writeJsonAtomicSync`, `writeTextAtomicSync`).
- La directory di una registrazione non viene mai sovrascritta: si alloca un
  nome libero con `allocateRecordingDir` / `uniqueDestinationPath`.
- Il filesystem è la fonte di verità; indice FTS5, manifest e file derivati
  sono ricostruibili.
- La staging Whisper resta dentro la registrazione (`recDir`) per permettere il
  rename atomico verso `.revisions/rN/`.

## ASR e audio

- L'interfaccia ASR è in `core/asr/`: il servizio decide i codici di modello
  mancante, i backend (`whisper-server`, `whisper-cli`) eseguono soltanto.
- Il renderer usa `AudioSource` (`audio-sources.js`) per microfono, sistema e
  mix. Pipeline DSP, MediaRecorder e UI non chiamano direttamente
  `getUserMedia`/`getDisplayMedia`.

## Test

- `npm run lint` controlla sintassi, `require` relativi, JSON, `.only`,
  `debugger`, CRLF, spazi finali e chiavi private accidentali.
- `npm test` esegue i test unitari e di integrazione leggeri su tutti i sistemi.
- `npm run test:electron` usa l'ABI di Electron per i test SQLite.
- `npm run test:e2e` avvia Electron e pilota l'app via CDP; richiede
  `CRUNCH_E2E=1` (lo script lo imposta).
- `npm run test:updater` copre checksum, firma Ed25519, backup e ripristino.
- `npm run verify-entitlements` verifica l'allowlist macOS; ogni nuova chiave
  richiede una modifica allo script e a `docs/RELEASE_SECURITY.md`.
- La trascrizione completa usa `test/fixtures/audio/reference.wav`. Il test si
  salta se mancano `bin/whisper-cli` o il modello; il percorso del modello può
  essere forzato con `CRUNCH_WHISPER_MODEL`.
- Un test per comportamento: percorso felice, errore di validazione e, quando
  c'è un confine di sicurezza, il tentativo di uscirne.
