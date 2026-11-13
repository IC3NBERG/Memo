# Changelog

Tutte le modifiche rilevanti di Crunch. Il formato segue
[Keep a Changelog](https://keepachangelog.com/it/1.1.0/) e il versioning
[Semantic Versioning](https://semver.org/lang/it/).

## [1.4.0] - 2026-11-13

Riprogettazione completa dell'interfaccia grafica (UI/UX) e dell'iconografia per
macOS. Introduce la navigazione dock fluttuante in glassmorphism, la nuova Home
Dashboard «Panoramica Studio» a card grid terrose, supporto duale per i temi
Dark Warm e Light Warm («Carta/Sabbia»), riorganizzazione dei controlli DSP in un
cassetto dedicato, zero emoji con icone SVG vettoriali personalizzate e nuova
icona dell'applicazione macOS Sage Waveform.

### Novità
- **interfaccia — icona macOS:** nuova icona vettoriale Apple macOS «Sage Waveform» su sfondo squircle verde salvia (#93A47E) con forma d'onda acustica e playhead ad ago. Generati file `icon.png` (1024×1024), `icon.icns` e `icon.svg`.
- **interfaccia — zero emoji:** eliminata ogni emoji dall'applicazione a favore di un set completo di icone vettoriali SVG personalizzate e coerenti (`home`, `library`, `settings`, `equalizer`, `history`, `sun`, `moon`, `filter`, `waveformLogo`, `shieldCheck`).
- **navigazione — dock verticale:** barra di navigazione laterale sospesa (#nav-dock) in stile capsule e frosted glass (sfocatura 20px) con indicatori di stato attivi a disco circolare per l'accesso immediato a Studio REC, Dashboard, Libreria, Cerca, Filtri DSP, Cestino e Impostazioni.
- **dashboard — panoramica studio:** nuova schermata iniziale a card grid squircle terrose (verde salvia, pino, ambra, sabbia) con indicatori statistici in tempo reale (numero note, ore/minuti archiviati, materie e stato Metal), card di avvio rapido, ultime lezioni, gruppi e note da perfezionare, affiancate da un'illustrazione paesaggistica rilassante.
- **temi — dark e light warm:** supporto per doppio tema visivo (Dark Warm predefinito e Light Warm editoriale su tinte carta e pergamena) con commutatore istantaneo nella barra del titolo e persistenza della preferenza.
- **audio — cassetto DSP:** riorganizzazione dei 4 filtri audio (passa-alto, noise gate, compressore, auto-gain) in un cassetto a scomparsa fluttuante (`#dsp-drawer`), lasciando la barra inferiore focalizzata sulla forma d'onda del microfono e sul player audio.

## [1.3.0] - 2026-11-13

Release di consolidamento dell'archivio e della distribuzione. Introduce
controlli di privacy e diagnostica, integrità verificabile delle registrazioni,
manutenzione automatica degli installer e una pipeline di release firmata e
verificata. La rifattorizzazione separa core, servizi main e renderer, così ogni
comportamento critico resta testabile senza Electron.

### Novità
- **aggiornamenti:** al termine dell'installazione l'updater elimina lo ZIP scaricato, la firma `.sig`, i file parziali `.part`, i backup `Crunch-backup-*.app` e le cartelle temporanee `crunch-update-*`. All'avvio l'app svuota la cache degli aggiornamenti (`updates/` e cache di `electron-updater`) e ripulisce `$TMPDIR` e `/tmp` dai residui dei tentativi precedenti.
- **sistema:** la pulizia dei residui in `$TMPDIR` elimina le copie dell'app che Spotlight e Launchpad indicizzavano come duplicati di Crunch; `dist/` viene esclusa dall'indicizzazione tramite `.metadata_never_index`, così le cartelle di build non compaiono più nel sistema.
- **privacy — retention:** soglie configurabili per cestino (default 30 giorni, `0` = mai) e registrazioni (`0` = mai), con anteprima che non modifica nulla, applicazione manuale con «Applica ora» e applicazione automatica all'avvio. Le registrazioni scadute passano prima nel cestino e solo dopo alla scadenza del cestino, senza cancellazioni dirette dalla libreria.
- **privacy — voiceprint:** consenso esplicito, versionato e revocabile, salvato in `privacy.json` con ambito `local-only`. La revoca disattiva l'uso del voiceprint e lascia al chiamante la cancellazione delle impronte già archiviate.
- **privacy — blocco applicativo:** codice di sblocco per macchine condivise conservato solo come hash `scrypt` (N=16384, r=8, p=1) con salt casuale, lunghezza 4–128 caratteri, blocco automatico configurabile (1–120 minuti, default 5), blocco alla perdita del focus e limite dei tentativi (5 errori in 5 minuti, blocco temporaneo di 30 secondi). Il file vive in `~/Library/Application Support/Crunch/`, fuori dall'archivio esportabile.
- **privacy — export e cancellazione:** export `.zip` dell'archivio con registrazioni, cestino e impostazioni; indice, log e modelli AI sono esclusi per default, mentre i modelli si possono includere su richiesta. La cancellazione totale richiede la conferma digitata `ELIMINA` e consente di scegliere separatamente se eliminare anche i modelli AI.
- **diagnostica:** logger JSON Lines con livelli `debug`, `info`, `warn`, `error`, rotazione a 2 MB × 4 file, troncamento di stringhe e array e redazione automatica delle chiavi sensibili (trascrizioni, nomi, percorsi, audio, speaker, voiceprint). Il pannello mostra ambiente, percorsi applicativi, statistiche dell'archivio, integrità aggregata e stato privacy, e permette di copiare il report negli appunti senza leggere audio, trascrizioni o nomi delle note.
- **integrità:** manifest per registrazione con hash SHA-256 e SHA-512 di ogni file, scansione non invasiva (veloce su presenza e dimensione, profonda ricalcolando gli hash) e cestino con metadati di provenienza, ripristino nella posizione originale ed eliminazione definitiva.
- **trascrizioni:** validazione e riparazione di `transcript.json`, `edits.json` e `metadata.json`, con normalizzazione di segmenti, revisioni e timestamp. La compatibilità è esplicita per le versioni passate (migrazione lazy con backup `.backup-v1`), correnti e future (apertura in sola lettura, nessun downgrade e nessuna scrittura).
- **ricerca:** indice FTS5 arricchito con uno stemmer italiano leggero e deterministico, che riduce suffissi e vocali finali per rendere trovabili le forme flesse (ad esempio cellula/cellule), mantenendo ricerca per nome, gruppo e corpo con filtri e highlight.
- **ASR:** facciata unica verso i backend con verifica del modello, prewarm, scelta automatica tra `whisper-server` e `whisper-cli` e fallback alla CLI quando il server non è disponibile, con i codici stabili `model-missing` e `translation-model-missing`.
- **audio:** astrazione `AudioSource` per microfono, audio di sistema e mix, con vincoli espliciti (nessuna cancellazione dell'eco, nessun noise suppression, mono) e chiusura deterministica di tracce e contesto audio.
- **interfaccia:** pannello Privacy con retention, voiceprint, export e cancellazione; pannello Diagnostica con report copiabile; gestione del blocco applicativo e nuova organizzazione modulare di editor, libreria, modali, modelli, registrazione e trascrizione.

### Correzioni
- **CI:** non viene più esportato un `CSC_LINK` vuoto verso `electron-builder`, che faceva fallire la build non firmata.
- **CI:** la verifica del tag nella pipeline di release riconosce correttamente il tag annotato e non lo confonde con il commit a cui punta.
- **Windows:** risoluzione dei percorsi con `path.join` negli script e nei test, rebuild nativo del postinstall e allineamento dello smoke test dell'updater alla pulizia dei backup.
- **test:** il controllo di release non richiede più un tag locale quando viene usato dai test unitari.

### Ristrutturazione
- `src/main/main.js` è stato ridotto al bootstrap: servizi separati per archivio, ricerca, trascrizione, privacy, diagnostica, export, blocco applicativo e aggiornamenti, con `ipc.js` come unico punto di registrazione dei canali e `preload.js` come unica superficie esposta al renderer.
- Il renderer è stato diviso in moduli (`editor.js`, `library.js`, `recording.js`, `transcription.js`, `privacy.js`, `models.js`, `modals.js`, `archive.js`, `audio-sources.js`, `block-model.js`, `waveform.js`), lasciando in `app.js` solo stato e orchestrazione.
- Il core non importa più Electron: dipendenze come `dialog`, `shell`, `spawn`, clock e path guard vengono iniettate, così i servizi sono testabili con archivi temporanei e fake.
- Introdotte convenzioni di modulo documentate (`docs/MODULE_CONVENTIONS.md`) e una suite estesa a ASR, audio, compatibilità, diagnostica, export, gruppi, integrità, IPC, manifest, logger, privacy, script di release, revisioni, ricerca, trascrizioni, cestino e updater.

### Test
- Suite unitaria su Node 20 e 24, eseguita su Ubuntu, macOS e Windows, più test con l'ABI di Electron e test E2E macOS via CDP (avvio, preload, gruppi, salvataggio e cestino).
- Test dedicati per updater ed entitlements, revisione automatica degli entitlements approvati e smoke test del bundle (versione, firma, Gatekeeper, primo avvio, aggiornamento e ripristino).

### Documentazione
- Pulizia completa delle versioni dal README a favore del CHANGELOG.
- Nuovi `docs/PRIVACY.md` (inventario dei dati, cifratura a riposo, retention, voiceprint, macchine condivise e diagnostica) e `docs/RELEASE_SECURITY.md` (CI/CD, firma Developer ID, notarizzazione, entitlements, chiave Ed25519 e verifica delle release).
- Aggiornati `DATA_FORMAT.md`, `RELEASE_WORKFLOW.md` e `docs/MODULE_CONVENTIONS.md`; README riorganizzato per obiettivi, architettura, modelli AI, privacy, diagnostica e cross-platform.

### Manutenzione
- Nuovi script di release: `release.mjs` (check, note e prepare), `publish-release.sh`, `sign-update.mjs`, `update-keygen.mjs`, `verify-entitlements.mjs`, `verify-releases.mjs`, `smoke-release.sh`, `run-tests.mjs`, `lint.mjs` e `rebuild-native.mjs`.
- Pipeline di release: controllo strict di tag annotato, versione e commit su `origin/main`, lint, test, entitlements, build di Whisper con Metal, smoke test del bundle, firma Ed25519 dello ZIP, pubblicazione esatta del bundle verificato e controllo finale della release remota.

## [1.0.0] - 2026-11-02

### Novità
- Initial commit of Memo macOS app with Metal whisper.cpp and auto-update

### Manutenzione
- Configure repository to IC3NBERG/Memo for auto-updates

## [1.0.1] - 2026-11-02

### Novità
- **ux:** Replace emojis with custom SVG icons, add close note navigation, live transcription loop, search filtering

## [1.0.2] - 2026-11-02

### Correzioni
- **renderer:** Resolve ICONS redeclaration error, rename Materie to Gruppi, and add architecture & guide info modal (v1.0.2)

## [1.0.3] - 2026-11-02

### Novità
- **ux:** Active recording view with live transcription toggle, fixed note item dimensions with datetime, anti-spam toasts, and visual effects (v1.0.3)

## [1.0.4] - 2026-11-02

### Novità
- Rename to Crunch v1.0.4, live transcription 3.5s, 100% transcript verification, single rec button, anti-overwrite recordings

## [1.0.5] - 2026-11-02

### Correzioni
- Sicurezza dati, trascrizione live e release 1.0.5

## [1.0.6] - 2026-11-02

### Novità
- Updater interno per build macOS non firmate (v1.0.6)

## [1.0.7] - 2026-11-03

### Novità
- Preprocessing audio reale, traduzione inglese dedicata e UI ridisegnata (v1.0.7)

### Documentazione
- README professionale per studenti e professionisti
- README completo con goal, architettura, modelli AI, roadmap e cross-platform

## [1.0.8] - 2026-11-03

### Novità
- **ui:** Barra di cattura audio ridisegnata e toggle senza spunte (v1.0.8)

### Documentazione
- Aggiorna README a v1.0.7 (preprocessing, traduzione, modelli dormienti)

## [1.0.9] - 2026-11-04

### Novità
- **live:** Finestra 8 s con overlap, merge per timestamp e motore persistente (v1.0.9)

## [1.1.0] - 2026-11-09

### Novità
- **editor:** Revisioni, overlay a blocchi e ricerca FTS5
- **player:** Timestamp coerenti con il timing della revisione
- **data:** Schema v2, revisioni canoniche e migrazione lazy v1 (A0)

### Ristrutturazione
- **download:** Download modelli atomico e testato
- **a0.5:** Metadata atomico e DSP live testabile

### Documentazione
- Prepara README e versione per la v1.1.0

### Manutenzione
- **release:** Verifica automatica delle release e checklist di pubblicazione

## [1.2.0] - 2026-11-10

### Novità
- Editor testuale unico, gruppi stabili e release v1.2.0
