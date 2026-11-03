# 🎙️ Crunch

**Registra, trascrivi e comprendi le tue lezioni — interamente sul tuo Mac.**

Crunch è un'app nativa per macOS Apple Silicon che registra audio, lo trascrive in tempo reale e offline con Whisper, e trasforma la trascrizione in un archivio interrogabile: gruppi, ricerca, timestamp, esportazione e riproduzione sincronizzata.

> **Stato attuale: v1.0.6 — macOS (Apple Silicon).**
> Windows e Linux sono nella roadmap e verranno supportati: vedi [Piattaforme e promessa cross-platform](#-piattaforme-e-promessa-cross-platform).

---

## Indice

- [Il goal](#-il-goal)
- [Come funziona il software](#-come-funziona-il-software)
- [Struttura del progetto](#-struttura-del-progetto)
- [I modelli AI: scelta e funzionamento](#-i-modelli-ai-scelta-e-funzionamento)
- [Integrazione con Apple](#-integrazione-con-apple)
- [Privacy, dati e sicurezza](#-privacy-dati-e-sicurezza)
- [Piattaforme e promessa cross-platform](#-piattaforme-e-promessa-cross-platform)
- [Roadmap: i prossimi punti da sviluppare](#-roadmap-i-prossimi-punti-da-sviluppare)
- [Avvio rapido e build](#-avvio-rapido-e-build)
- [Dati utili](#-dati-utili)
- [Limiti attuali](#-limiti-attuali)
- [FAQ](#-faq)
- [Crediti](#-crediti)

---

## 🎯 Il goal

### Il problema

Una lezione universitaria dura 1–2 ore e contiene tre cose diverse che oggi vengono confuse in un unico blob:

1. **il contenuto** (concetti, definizioni, formule);
2. **le decisioni e le azioni** (cosa è stato deciso, cosa c'è da fare, cosa resta aperto);
3. **le persone** (chi ha detto cosa, chi ha risposto, chi ha sollevato un'obiezione).

Le app di note registrano l'audio ma non lo rendono utilizzabile: la trascrizione è un muro di testo, non è collegata ai minuti, non distingue le voci, non permette di riascoltare un passaggio preciso, e per riassumere bisogna copiare tutto in un servizio cloud. Il risultato è che lo studente riascolta l'intera lezione per trovare dieci minuti utili, oppure rinuncia.

### La tesi di Crunch

> **La trascrizione non è il prodotto finale: è il livello dati su cui costruire studio, ricerca e sintesi.**

Crunch vuole diventare un **quaderno di lezione locale e verificabile**: ogni parola resta collegata all'audio originale, ogni sintesi resta collegata alle sue fonti, ogni modifica dell'utente non distrugge il dato grezzo.

### I quattro principi

| Principio | Significato concreto |
|---|---|
| **Local-first** | Audio, trascrizioni, modelli e note vivono sul dispositivo. Il cloud non è un requisito, è un'eccezione. |
| **Verificabile** | Ogni riassunto, highlight o citazione deve poter essere ricondotto a un blocco e a un timestamp ascoltabile. Niente output "fidati di me". |
| **Non distruttivo** | Il transcript originale è immutabile. L'utente lavora su blocchi, sezioni, tag e annotazioni, non sovrascrivendo la fonte. |
| **Nativo dove serve** | Metal e Core ML su Apple Silicon per avere velocità da GPU senza inviare audio a un server. |

### Cosa deve diventare Crunch

Un flusso unico, dalla cattedra allo studio:

```
Registra → Trascrive → Separa le voci → Struttura in blocchi → Cerca e riascolta → Riassume con citazioni → Esporta
```

Oggi Crunch copre in modo solido i primi due passi e parte del terzo (organizzazione, ricerca, timestamp, esportazione). I passi successivi — diarizzazione, editor a blocchi, sintesi citabile, ricerca full-text, doppia sorgente audio — sono descritti nella [roadmap](#-roadmap-i-prossimi-punti-da-sviluppare).

### Non-obiettivi

- Non è un'app di meeting aziendale con bot che partecipa alle call.
- Non è un servizio cloud: non esiste un account obbligatorio né un upload dei dati.
- Non è un trascrittore "magico": la qualità dipende da microfono, rumore e lingua. Crunch rende esplicito cosa è live e cosa è definitivo.

---

## ⚙️ Come funziona il software

### Pipeline completa

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. CATTURA                                                           │
│    microfono → Web Audio API → 16 kHz mono Float32                   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│ 2. PREPROCESSING (4 toggle, attivi per default)                      │
│    passa-alto 80 Hz → noise gate -45 dB → compressore → auto-gain    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
              ┌────────────────┴─────────────────┐
              │                                  │
┌─────────────▼─────────────┐      ┌─────────────▼──────────────────────┐
│ 3a. ANTEPRIMA LIVE        │      │ 3b. REGISTRAZIONE DEFINITIVA       │
│ chunk PCM ogni 3,5 s      │      │ MediaRecorder (Opus/WebM)          │
│ solo campioni nuovi       │      │ → decode → WAV PCM 16 bit mono     │
│ whisper.cpp + Metal       │      │ → ~/CrunchRecordings/.../audio.wav │
│ output senza timestamp    │      │ persistito su disco                │
└─────────────┬─────────────┘      └─────────────┬──────────────────────┘
              │                                  │
              ▼                                  ▼
      testo di anteprima              ┌────────────────────────────────┐
      (parziale, sostituibile)        │ 4. TRASCRIZIONE COMPLETA 100%   │
                                      │ whisper-cli sul WAV originale   │
                                      │ JSON con segmenti + offset ms    │
                                      │ + TXT + SRT/VTT/CSV opzionali    │
                                      └───────────────┬────────────────┘
                                                      │
                                      ┌───────────────▼────────────────┐
                                      │ 5. CONSULTAZIONE                │
                                      │ libreria a gruppi, ricerca      │
                                      │ testuale, timestamp, player,    │
                                      │ copia, export TXT/Markdown      │
                                      └────────────────────────────────┘
```

### 1. Cattura audio

Il renderer chiede il microfono con `getUserMedia` a **16.000 Hz, mono**, disattivando echo cancellation, noise suppression e auto-gain di sistema: quei filtri sono pensati per le chiamate, non per la trascrizione, e possono tagliare parti utili del parlato. Il preprocessing è gestito da Crunch, in modo trasparente e disattivabile.

### 2. Preprocessing audio

I quattro toggle sono una catena DSP costruita con la Web Audio API:

| Stadio | Parametro | A cosa serve |
|---|---|---|
| **Passa-alto** | 80 Hz, Q 0.7 | rimuove rimbombi, passi, vibrazioni del tavolo, rumore di condizionatori |
| **Noise gate** | soglia −45 dB, isteresi 20/120 ms | chiude il segnale nelle pause, riducendo fruscio e respiri |
| **Compressore** | threshold −48 dB, knee 10, ratio 6:1, attack 3 ms, release 150 ms | rende comprensibili i passaggi a bassa voce senza saturare le esclamazioni |
| **Auto-gain** | guadagno 2.4× | mantiene uniforme il volume se il docente si muove |

La stessa catena alimenta tre rami: il **MediaRecorder** per il file definitivo, lo **ScriptProcessor** per i chunk live e un **AnalyserNode** per la forma d'onda a 60 fps.

### 3. Due modalità di trascrizione (e perché sono diverse)

**Anteprima live (≈3,5 s).** Ogni 3,5 secondi Crunch preleva solo i campioni PCM accumulati dall'ultimo invio, costruisce un WAV temporaneo e invoca `whisper-cli` con `--no-timestamps`. I chunk sotto −50 dB RMS vengono scartati per evitare che Whisper "allucini" parole sul silenzio. Il testo viene concatenato e mostrato in tempo reale.

**Trascrizione completa (100%).** Quando la lezione è finita, il file `audio.wav` originale viene rianalizzato per intero. Questa è la trascrizione di riferimento: produce segmenti con offset in millisecondi, e sostituisce l'anteprima. È il motivo per cui Crunch distingue esplicitamente `isLivePreview` da `isCompleteTranscript`: un'anteprima non è mai spacciata per definitiva.

> **Perché due passaggi?** Il live serve a *vedere che sta funzionando* e a non perdere l'orientamento durante la lezione. La decodifica integrale serve a *non perdere parole*. Sono due obiettivi con compromessi diversi tra latenza e accuratezza.

### 4. Salvataggio e libreria

Alla fine della registrazione il WebM/Opus viene decodificato e convertito in **WAV PCM 16 bit mono** a 16 kHz, poi scritto in una cartella con timestamp nel nome. Una barriera anti-sovrascrittura aggiunge un progressivo se la cartella esiste già: due registrazioni non possono mai collidere.

La libreria è ricostruita leggendo il filesystem, che è la fonte di verità (non un database separato). Ogni registrazione è una cartella autonoma e portabile: copiarla altrove significa copiare tutto.

### 5. Consultazione

- **Gruppi** (materie/progetti) con creazione, rinomina ed eliminazione sicura: eliminare un gruppo **non elimina** le registrazioni, le sposta in `_unsorted`.
- **Ricerca** nella sidebar su nome e testo della trascrizione (ricerca per sottostringa, case-insensitive).
- **Timestamp** attivabili/disattivabili accanto ai segmenti.
- **Player** integrato con seek, volume e tempo corrente.
- **Copia** dell'intero transcript ed **export** `.txt` o `.md`.
- **Rinomina** della registrazione con doppio clic.

---

## 🗂️ Struttura del progetto

### Architettura Electron

Crunch usa il modello a tre livelli di Electron, con isolamento rigoroso:

```
┌────────────────────────────────────────────────────────────┐
│  RENDERER  (src/renderer/)                                 │
│  UI, Web Audio API, MediaRecorder, player, editor          │
│  contextIsolation: true · nodeIntegration: false            │
│  nessun accesso diretto a filesystem o processi             │
└───────────────────────────┬────────────────────────────────┘
                            │  window.crunchAPI / memoAPI
┌───────────────────────────▼────────────────────────────────┐
│  PRELOAD  (src/main/preload.js)                            │
│  contextBridge: espone solo le funzioni whitelist          │
└───────────────────────────┬────────────────────────────────┘
                            │  IPC (invoke/send/on)
┌───────────────────────────▼────────────────────────────────┐
│  MAIN  (src/main/main.js)                                  │
│  finestra, filesystem, whisper-cli, updater, dialoghi      │
│  validazione dei percorsi prima di ogni operazione          │
└────────────────────────────────────────────────────────────┘
```

### Albero dei file

```text
Crunch/
├── src/
│   ├── main/
│   │   ├── main.js        # processo principale: IPC, libreria, trascrizione, download modelli
│   │   ├── preload.js     # bridge sicuro renderer ↔ main
│   │   └── updater.js     # updater interno per build macOS non firmate (ZIP + SHA-512 + backup)
│   └── renderer/
│       ├── index.html     # struttura UI e modali (guida, gruppi, conferme)
│       ├── app.js         # stato, registrazione, pipeline audio, player, ricerca, export
│       ├── style.css      # tema, layout, animazioni, waveform
│       └── icons.js       # set di icone SVG inline
├── scripts/
│   ├── build-whisper.sh   # compila whisper.cpp con Metal per arm64 → bin/whisper-cli
│   └── generate-icon.sh   # genera l'icona .icns
├── assets/
│   ├── icons/icon.icns    # icona app
│   └── entitlements.mac.plist
├── bin/
│   └── whisper-cli        # binario nativo (incluso come extraResource nel pacchetto)
├── dist/                  # output di electron-builder (DMG, ZIP, .app)
├── package.json           # dipendenze, script di build, configurazione electron-builder
├── RELEASE_WORKFLOW.md    # procedura di release e aggiornamenti
└── README.md
```

### Dati dell'utente

Tutto vive in `~/CrunchRecordings/` (le installazioni precedenti migrano automaticamente da `~/MemoRecordings/`):

```text
~/CrunchRecordings/
├── .models/
│   ├── ggml-large-v3-turbo.bin   # modello principale (~1,5 GB)
│   └── ggml-medium.bin           # modello per la traduzione in inglese (~1,5 GB)
├── _unsorted/                    # registrazioni senza gruppo
└── <Gruppo>/
    └── 2026-11-03_09-15-00_Diritto Privato/
        ├── audio.wav             # audio originale 16 kHz mono PCM 16 bit
        ├── metadata.json         # nome, data, gruppo, durata, flag trascrizione
        ├── transcript.json       # segmenti con start/end + testo completo
        ├── transcript.txt        # testo semplice (ricerca, export rapido)
        └── audio.json/.txt/.srt/.vtt/.csv   # output grezzi di whisper.cpp (se generati)
```

### Schema dei metadati

```json
{
  "name": "Diritto Privato",
  "date": "2026-11-03T09:15:00.000Z",
  "folder": "Giurisprudenza",
  "duration": 5400,
  "hasTranscript": true,
  "isCompleteTranscript": true,
  "isLivePreview": false,
  "isTranslated": false
}
```

### Schema della trascrizione

```json
{
  "segments": [
    { "start": 0.0, "end": 4.32, "text": "Oggi parliamo della nozione di obbligazione." },
    { "start": 4.32, "end": 9.81, "text": "La fonte può essere volontaria oppure legale." }
  ],
  "text": "Oggi parliamo della nozione di obbligazione. La fonte può essere volontaria oppure legale."
}
```

Gli offset di whisper.cpp arrivano in millisecondi e vengono convertiti in secondi. Questo formato è già pronto per le funzioni future di citazione, blocco e seek.

---

## 🧠 I modelli AI: scelta e funzionamento

### Cosa c'è sotto: Whisper

Crunch non usa un'API: esegue **Whisper** in locale tramite **whisper.cpp**, l'implementazione C/C++ ottimizzata del modello OpenAI. Whisper è un **transformer encoder–decoder** addestrato su centinaia di migliaia di ore di audio multilingua. Il funzionamento semplificato:

1. **Feature extraction** — l'audio a 16 kHz viene trasformato in uno spettrogramma log-Mel (finestre da 25 ms, hop 10 ms). Per questo il sample rate nativo è 16 kHz: evitare ricampionamenti inutili riduce artefatti.
2. **Encoder** — lo spettrogramma diventa una sequenza di rappresentazioni contestuali.
3. **Decoder** — genera i token di testo in modo autoregressivo, con token speciali per lingua, task (`transcribe` / `translate`), timestamp e fine segmento.
4. **Timestamp** — il decoder può emettere marcatori temporali, che whisper.cpp converte in offset per ogni segmento. Da qui nascono `start`/`end` nel `transcript.json`.

Il modello è **multilingua** e rileva automaticamente la lingua (`--language auto`), ma la traduzione supportata dal task nativo è **solo verso l'inglese**: Whisper non traduce arbitrary pair (es. italiano → francese).

### I modelli usati oggi

| Modello | File | Dimensione | Ruolo | Quando viene scaricato |
|---|---|---|---|---|
| **large-v3-turbo** | `ggml-large-v3-turbo.bin` | ≈1,5 GB | trascrizione (live e completa) | al primo avvio, automaticamente |
| **medium** | `ggml-medium.bin` | ≈1,5 GB | traduzione in inglese | solo quando l'utente sceglie "Traduci in inglese" |

**Perché `large-v3-turbo` come default.** È un large-v3 con decoder ridotto a 4 layer (≈809 milioni di parametri): conserva l'encoder e quindi la qualità acustica del large-v3, ma decodifica molto più velocemente. È il compromesso giusto per lezioni lunghe su un laptop.

**Perché un modello separato per la traduzione.** `large-v3-turbo` è addestrato al task *transcribe* e non esegue affidabilmente il task *translate*. Crunch quindi non "finge" di tradurre con il modello sbagliato: usa `medium`, scaricato **solo su richiesta esplicita**, e lo tiene dormiente finché non serve. Questo evita di occupare ~1,5 GB in più per chi non traduce mai.

**Perché non `large-v3` di default.** Costa più RAM, più tempo e più batteria per un guadagno che nella maggior parte delle lezioni non è percettibile. Il piano è renderlo **selezionabile** per chi vuole la massima accuratezza (vedi roadmap).

### Logica di scelta del modello

```
                    ┌─────────────────────┐
                    │  L'utente trascrive │
                    └──────────┬──────────┘
                               │
                 ┌─────────────▼─────────────┐
                 │ Modalità "Traduci"?        │
                 └──────┬──────────────┬─────┘
                        │ sì           │ no
                        ▼              ▼
              ggml-medium.bin     ggml-large-v3-turbo.bin
              (scarica se manca)  (scarica al primo avvio)
                        │              │
                        └──────┬───────┘
                               ▼
                    whisper-cli + Metal
                    --threads 4 --language auto
```

Regole implementate in `src/main/main.js`:

- `model:check` verifica il modello di trascrizione; `model:check-translation` quello di traduzione.
- Se il modello richiesto manca, l'IPC restituisce un codice esplicito (`model-missing` / `translation-model-missing`) e la UI propone il download: nessun crash silenzioso.
- I download sono fatti in streaming su file `.tmp` e rinominati solo al completamento, con supporto ai redirect (Hugging Face → CDN) e limite di 10 redirect.
- La trascrizione live rifiuta chunk troppo corti (< 0,4 s) o troppo silenziosi (< −50 dB RMS).
- Una sola trascrizione completa alla volta (`activeTranscription`): niente processi concorrenti che si rubano la GPU.

### Come lavora whisper.cpp su Apple Silicon

- **Metal** abilita l'esecuzione dei kernel matrix-multiply sulla GPU.
- La **memoria unificata** permette a CPU e GPU di accedere agli stessi pesi senza copie: è il vantaggio principale di Apple Silicon rispetto a una GPU discreta.
- I calcoli avvengono in **FP16**, con `--threads 4` per la parte CPU.
- Il binario è compilato per **arm64** con `GGML_METAL=ON`. La build è **pinned** a un commit verificato (`482279b8…`) per evitare che un aggiornamento upstream rompa le release.
- La velocità indicativa è **fino a ~6× real-time** su Apple Silicon: un'ora di lezione si trascrive in circa 10–20 minuti a seconda del chip e del modello. Il live a chunk brevi ha latenza di pochi secondi, non è una garanzia di accuratezza.

### Cosa arriverà lato modelli

- **large-v3 selezionabile** per la massima accuratezza, con download opzionale e stima di RAM/tempo.
- **Diarizzazione** con modelli dedicati (embedding vocali + clustering), separati dal motore ASR.
- **Voice embedding persistente** per riconoscere le stesse voci tra lezioni diverse.
- **Modelli di sintesi locali** (LLM on-device) per riassunti citabili, senza inviare testo al cloud.
- **Core ML** come backend alternativo a Metal per alcune fasi, se porta vantaggi misurabili in consumo energetico.

> Nota: i nomi dei modelli futuri non sono ancora congelati. La scelta sarà guidata da tre criteri misurabili: accuratezza su italiano accademico, latenza su Apple Silicon e licenza compatibile con la distribuzione. La roadmap espone i requisiti, non annuncia integrazioni non ancora validate.

---

## 🍎 Integrazione con Apple

| Aspetto | Implementazione |
|---|---|
| **Chip** | Apple Silicon arm64 (M1 e successivi). La build è `arm64` only: niente Intel, niente Rosetta per il motore ASR. |
| **Accelerazione** | whisper.cpp compilato con `GGML_METAL=ON`; GPU Apple via Metal, FP16, memoria unificata. |
| **Finestra** | `titleBarStyle: 'hiddenInset'`, traffic lights in posizione nativa, tema scuro `#1E1A17`. |
| **Permessi** | `NSMicrophoneUsageDescription` in `extendInfo`; macOS chiede l'autorizzazione al primo utilizzo del microfono. |
| **Distribuzione** | DMG + ZIP per `arm64` via `electron-builder`, con layout di installazione drag-to-Applications. |
| **Firma** | Le build attuali possono non essere firmate con Developer ID. Per questo esiste un **updater interno**: scarica lo ZIP, verifica lo **SHA-512**, sostituisce il bundle con backup e riavvia. Se l'app è firmata, usa invece Squirrel.Mac standard. |
| **Aggiornamenti** | Controllo all'avvio (dopo 4 s) e ogni 3 ore; stato e progresso mostrati in UI; fallback alla pagina release se il pacchetto non è pronto. |
| **Integrazione audio futura** | Per la doppia sorgente (microfono + audio di sistema) macOS richiede ScreenCaptureKit / Core Audio tap (macOS 13+). È il punto tecnico principale della modalità meeting. |

### Requisiti consigliati

- macOS 12 o successivo (consigliato macOS 13+ per le future funzioni di cattura audio di sistema).
- Apple Silicon (M1/M2/M3/M4).
- 8 GB di RAM (16 GB consigliati per large-v3 e per la diarizzazione).
- ~4 GB liberi: app, modello di trascrizione e modello di traduzione.
- Microfono funzionante e permesso concesso in *Impostazioni di Sistema → Privacy e Sicurezza → Microfono*.

### Perché Electron

Electron permette di riusare la stessa UI e la stessa pipeline Web Audio su macOS, Windows e Linux. Il motore pesante (Whisper) resta nativo e viene compilato per piattaforma. È una scelta deliberata in funzione della promessa cross-platform, non un ripiego.

---

## 🔒 Privacy, dati e sicurezza

### Cosa non lascia il dispositivo

Audio, trascrizioni, metadati, nomi dei gruppi, note e modelli **restano in `~/CrunchRecordings/`**. Non esiste telemetria, non esiste un account, non esiste un upload automatico.

### Le uniche connessioni di rete

| Connessione | Quando | Cosa viene inviato |
|---|---|---|
| Download modello da Hugging Face | primo avvio / prima traduzione | solo la richiesta HTTP del file |
| Controllo aggiornamenti su GitHub Releases | all'avvio e ogni 3 ore | versione client e richiesta di metadati release |
| Download aggiornamento | quando disponibile | nessun dato utente |

Nessuna di queste connessioni contiene audio o testo della trascrizione. Se disconnetti il Mac dopo aver scaricato i modelli, Crunch continua a funzionare completamente offline.

### Sicurezza applicativa

- `contextIsolation: true`, `nodeIntegration: false`: il renderer non può usare Node.
- Il preload espone solo una whitelist di funzioni (`window.crunchAPI`).
- **Validazione dei percorsi**: ogni operazione su file verifica che il path risolto sia dentro `~/CrunchRecordings/` e che il nome del gruppo non contenga separatori o `..`.
- La trascrizione accetta solo file audio interni alla registrazione richiesta.
- Le operazioni distruttive sono conservative: eliminare un gruppo sposta le registrazioni in `_unsorted`; se trova file non gestiti, si ferma senza cancellare nulla.
- Anti-sovrascrittura su registrazioni e spostamenti.

### Attenzione a dati sensibili

Le registrazioni di lezioni possono contenere voci di terzi e informazioni personali. La responsabilità di informare i partecipanti e di rispettare la normativa applicabile (in UE: GDPR, in particolare per dati biometrici come le impronte vocali) è dell'utente. Le future funzioni di riconoscimento speaker persistente dovranno prevedere **consenso esplicito, possibilità di cancellare un voiceprint e conservazione locale**.

---

## 🌍 Piattaforme e promessa cross-platform

**Oggi Crunch è macOS Apple Silicon.** Non è una limitazione accidentale: è il punto di partenza scelto per avere Metal, memoria unificata e un'esperienza controllata end-to-end.

**L'impegno è portare Crunch su Windows e Linux.** L'architettura è già predisposta: Electron per l'interfaccia, whisper.cpp per l'inferenza, filesystem locale come fonte di verità, nessuna dipendenza da API cloud. Le differenze reali sono tre, e vanno affrontate esplicitamente:

| Area | macOS (oggi) | Windows (pianificato) | Linux (pianificato) |
|---|---|---|---|
| **Backend ASR** | Metal | Vulkan / CUDA / CPU | Vulkan / CUDA / ROCm / CPU |
| **Audio di sistema** | ScreenCaptureKit / Core Audio tap | WASAPI loopback | PipeWire / PulseAudio monitor source |
| **Packaging** | DMG + ZIP arm64 | NSIS installer + portable ZIP | AppImage + .deb |
| **Firma/update** | Squirrel.Mac o updater interno | electron-updater / NSIS | AppImage updater |
| **Percorsi dati** | `~/CrunchRecordings/` | `%USERPROFILE%\CrunchRecordings\` | `~/.local/share/CrunchRecordings/` (XDG) |

### Come verrà mantenuta la promessa

1. **Estrarre il core** — spostare ASR, gestione modelli e storage in un modulo indipendente dalla UI, con test su file WAV di riferimento.
2. **Backend per piattaforma** — compilare whisper.cpp con il backend disponibile e selezionarlo a runtime; fallback CPU sempre garantito.
3. **Cattura multi-sorgente** — implementare l'astrazione `AudioSource` (microfono, sistema, mix) con implementazioni native per piattaforma.
4. **Parità di dati** — stesso schema `metadata.json`/`transcript.json` su tutte le piattaforme, così un archivio è portabile.
5. **Build CI** — matrice macOS/Windows/Linux con artefatti firmati e test di regressione sulla trascrizione.
6. **Nessuna feature macOS-only nel core** — le unicità Apple (Metal, Core ML, integrazione di sistema) restano backend opzionali, non prerequisiti.

Non verranno annunciate date finché una build Windows/Linux non sarà realmente utilizzabile: la promessa è la direzione e la portabilità dei dati, non un countdown artificiale.

---

## 🗺️ Roadmap: i prossimi punti da sviluppare

Legenda: ✅ già presente · 🚧 da sviluppare · 🔭 esplorativo

### A. Intelligenza delle voci

#### 1. Diarizzazione speaker 🚧
**Cosa.** Separare le voci con modelli dedicati e mostrare le etichette `Speaker A`, `Speaker B`, … Ogni etichetta è rinominabile (es. "Prof. Rossi", "Studentessa 2") e il nome si propaga a tutti i segmenti di quella voce.

**Perché.** Sapere *chi* ha detto una cosa è spesso più importante del *cosa*: domande, obiezioni, risposte e turni di parola.

**Come.** Pipeline separata dall'ASR: embedding vocali per segmento (modelli tipo WeSpeaker/pyannote/sherpa-onnx), clustering con numero di speaker stimato, allineamento dei cluster ai segmenti Whisper. I risultati vengono salvati come `speaker_id` per segmento, **senza modificare** il testo.

**Criterio di accettazione.** Due voci distinte su una registrazione pulita vengono separate con etichette coerenti; rinominare uno speaker aggiorna la vista e l'export; il transcript originale resta recuperabile.

#### 2. Riconoscimento speaker persistente 🚧
**Cosa.** Voice embedding per associare automaticamente le stesse voci ai nomi nei meeting successivi.

**Perché.** Evita di rietichettare ogni volta le stesse persone e rende l'archivio interrogabile per persona ("cosa ha detto Rossi nella lezione 4?").

**Come.** Archivio locale di voiceprint (vettori + nome + data + consenso), soglia di similarità configurabile, matching con margine per evitare falsi positivi. Ogni associazione automatica è **proposta e confermabile**, mai imposta.

**Criterio di accettazione.** Su una seconda registrazione la stessa voce viene proposta con il nome già assegnato; l'utente può correggere; il voiceprint è cancellabile.

#### 3. Gestione sovrapposizioni 🚧
**Cosa.** Conservare entrambe le voci quando due persone parlano insieme, invece di sovrascriverle.

**Perché.** Nelle discussioni reali le sovrapposizioni contengono spesso la parte più interessante (interruzioni, correzioni, domande).

**Come.** Diarizzazione *overlap-aware*: segmenti con più speaker attivi, trascrizione per traccia quando possibile, rappresentazione esplicita nel formato dati (`speakers: ["A","B"]`, `overlap: true`) e indicazione visiva nell'editor. Nei casi non separabili, il testo viene conservato come "segmento misto" invece di essere scartato.

**Criterio di accettazione.** Un tratto con due voci simultanee non perde testo e mostra entrambi gli speaker; l'utente può riascoltare e correggere.

### B. Il transcript come dato strutturato

#### 4. Trascrizione word/segment-level con timestamp 🚧
**Cosa.** Ogni frase — e in prospettiva ogni parola — collegata al minuto (e al secondo) esatto dell'audio.

**Perché.** È il prerequisito di tutto il resto: seek, citazioni, blocchi, sintesi selettiva.

**Come.** Oggi whisper.cpp produce già segmenti con offset; il passo successivo è la granularità word-level (token timestamp) e un ID stabile per segmento/blocco, salvato in `transcript.json`.

**Criterio di accettazione.** Ogni segmento ha `id`, `start`, `end`; il click su un timestamp porta il player a quel punto; gli ID sopravvivono a salvataggi e riaperture.

#### 5. Editor a blocchi non distruttivo 🚧
**Cosa.** Il transcript resta intatto; l'utente sposta, raggruppa, tagga e annota blocchi.

**Perché.** Studiare significa riorganizzare, non riscrivere. Oggi l'editor è un `contenteditable` che può disallineare il testo dai segmenti: va superato.

**Come.** Modello dati a blocchi immutabili + viste/ordini dell'utente salvati separatamente. Drag & drop, gruppi, tag, note, undo/redo. La trascrizione originale resta una sorgente in sola lettura; ogni modifica è un livello sopra.

**Criterio di accettazione.** Spostare o raggruppare blocchi non altera il testo originale né i timestamp; "ripristina vista originale" funziona; export riflette la vista scelta.

#### 6. Sezioni manuali 🚧
**Cosa.** Creare sezioni "Decisioni", "Da fare", "Argomenti", "Domande" trascinando i blocchi originali.

**Perché.** Trasforma una lezione in un documento operativo, senza perdere il legame con la fonte.

**Come.** Sezioni come collezioni ordinate di riferimenti a BLOCK ID (non copie). Una sezione può contenere lo stesso blocco in più viste senza duplicare il dato.

**Criterio di accettazione.** Ogni elemento di sezione punta a un blocco esistente; eliminare una sezione non elimina i blocchi; export Markdown mantiene la struttura.

#### 7. Sintesi selettiva 🚧
**Cosa.** Riassunto generato solo sui blocchi o sull'intervallo scelto dall'utente.

**Perché.** Riassumere un'ora di lezione è meno utile che riassumere i 12 minuti che contano.

**Come.** Selezione esplicita (blocchi, intervallo temporale, sezione) → contesto delimitato → modello di sintesi locale → output con riferimenti. Se il contesto supera la finestra del modello, chunking con sintesi gerarchica e citazioni preservate.

**Criterio di accettazione.** Il riassunto cita solo blocchi selezionati; nessun contenuto inventato al di fuori delle fonti; l'utente può rigenerare con istruzioni diverse.

#### 8. Citazioni dei blocchi nel riassunto 🚧
**Cosa.** Ogni punto sintetizzato rimanda ai BLOCK ID e ai timestamp originali.

**Perché.** È la differenza tra un riassunto credibile e un testo da controllare interamente.

**Come.** Output strutturato (non solo prosa): ogni punto contiene `block_ids` e `citations`; la UI li rende cliccabili e apre il player al timestamp. Validazione automatica: citazioni inesistenti vengono rifiutate o segnalate.

**Criterio di accettazione.** Nessun punto senza fonte; click sulla citazione → blocco evidenziato + audio dal secondo corretto.

#### 9. Highlight automatici 🚧
**Cosa.** Proposta di decisioni, azioni, domande aperte e passaggi chiave, sempre verificabili.

**Perché.** Riduce il tempo di scansione e rende visibili cose che durante la lezione sono passate inosservate.

**Come.** Classificazione/Prompt locale su blocchi con schema tipizzato (`decision`, `action`, `question`, `key_point`), confidenza e link al blocco. Le proposte sono modificabili e dismissibili: nessun highlight è "vero" per decreto.

**Criterio di accettazione.** Ogni highlight ha tipo, confidenza e blocco sorgente; l'utente può accettare, modificare o scartare; nessun highlight senza evidenza testuale.

### C. Ricerca e riascolto

#### 10. Ricerca full-text ✅/🚧
**Cosa.** SQLite + FTS5 per trovare parole, speaker, argomenti e momenti dell'audio.

**Perché.** La ricerca attuale è una sottostringa su `transcript.txt`: funziona, ma non scala a migliaia di lezioni e non gestisce ranking, stemming, frasi o filtri per speaker.

**Come.** Indice SQLite FTS5 ricostruibile dai file (il filesystem resta la fonte di verità), tokenizer adatto all'italiano, ranking BM25, filtri per gruppo/speaker/data, risultati con snippet e timestamp. Migrazione e re-index automatici.

**Criterio di accettazione.** Query full-text su 1.000 ore in meno di 100 ms; risultati cliccabili che aprono il punto audio; indice ricostruibile senza perdita di dati.

#### 11. Riproduzione dal transcript ✅/🚧
**Cosa.** Clic sul timestamp per ascoltare il passaggio originale.

**Perché.** Verifica immediata: la trascrizione diventa un indice dell'audio, non un riassunto separato.

**Come.** Oggi i timestamp sono **visualizzati**; il passo successivo è renderli interattivi (`data-start` → `player.currentTime`), con evidenziazione del segmento in riproduzione e auto-scroll opzionale.

**Criterio di accettazione.** Click su un timestamp → il player salta al secondo esatto e suona; il segmento attivo è evidenziato.

#### 12. Architettura Apple Silicon ✅
**Cosa.** whisper.cpp con Metal/Core ML per trascrizione locale, più diarizzazione locale.

**Perché.** È il fondamento della promessa: velocità da GPU e privacy insieme.

**Come.** Già implementato per l'ASR (Metal, FP16, memoria unificata). La diarizzazione locale sarà aggiunta come secondo motore, con backend Metal dove disponibile e fallback CPU.

**Criterio di accettazione.** Trascrizione completa senza rete; nessun audio inviato fuori; uso GPU osservabile e nessuna dipendenza cloud.

### D. Audio, privacy, modelli e piattaforme

#### 13. Privacy offline ✅
**Cosa.** Audio, transcript, speaker e note restano sul dispositivo; nessun invio obbligatorio a cloud.

**Perché.** È un requisito, non un dettaglio di marketing.

**Come.** Storage locale, nessuna telemetria, rete solo per modelli e aggiornamenti. Le funzioni future (diarizzazione, sintesi) devono rispettare lo stesso vincolo: modelli locali o nessuna funzione.

**Criterio di accettazione.** Con rete disattivata, registrazione, trascrizione, consultazione ed export funzionano; un'analisi del traffico non mostra contenuti utente.

#### 14. Modalità doppia audio 🚧
**Cosa.** Microfono + audio di sistema per meeting, così si distinguono meglio partecipanti e contenuto condiviso.

**Perché.** Nelle lezioni online e nei meeting la voce del docente e l'audio della call arrivano da sorgenti diverse: catturarle separate migliora trascrizione, diarizzazione e attribuzione.

**Come.** Due tracce sincronizzate (mic e sistema) con timestamp comune, mix opzionale per l'ASR e tracce separate per la diarizzazione. Su macOS: ScreenCaptureKit / Core Audio tap. Su Windows: WASAPI loopback. Su Linux: PipeWire/PulseAudio monitor. Richiede gestione di drift, echo e permessi.

**Criterio di accettazione.** Le due sorgenti restano sincronizzate per un'ora; l'utente può ascoltare l'una o l'altra; il transcript indica la sorgente; nessuna dipendenza cloud.

#### 15. Modelli selezionabili 🚧
**Cosa.** `large-v3-turbo` predefinito per velocità, `large-v3` opzionale per massima accuratezza.

**Perché.** Utenti e hardware diversi hanno compromessi diversi. La scelta deve essere esplicita, non nascosta.

**Come.** Settings con modello ASR, modello di traduzione, backend (Metal/CPU), lingua e thread; download su richiesta con dimensione stimata e spazio libero; verifica integrità; fallback se il modello non è compatibile con la RAM.

**Criterio di accettazione.** Il cambio modello è persistente; l'app mostra sempre quale modello sta usando; un modello mancante non blocca le altre funzioni.

---

## 🚀 Avvio rapido e build

### Sviluppo

```bash
# 1. Dipendenze
npm install

# 2. Avvio in sviluppo
npm start
```

Al primo avvio Crunch crea `~/CrunchRecordings/` e scarica `ggml-large-v3-turbo.bin` (≈1,5 GB).

### Compilare whisper.cpp con Metal

```bash
npm run build-whisper
```

Lo script:

- clona `ggerganov/whisper.cpp` in `/tmp/whisper.cpp` (se assente);
- fa checkout del commit verificato `482279b8a18855ba741d7b88c30fcb3874691f59`;
- configura CMake con `GGML_METAL=ON` e `CMAKE_OSX_ARCHITECTURES=arm64`;
- compila in Release e copia il binario in `bin/whisper-cli`.

Per usare un commit diverso: `WHISPER_REF=<sha> npm run build-whisper`.

### Build dell'app

```bash
npm run build        # DMG + ZIP arm64 in dist/
npm run build:dir    # solo .app, senza installer (più veloce)
npm run install:app  # copia Crunch.app in /Applications
```

L'app pacchettizzata include `bin/` come `extraResources`, quindi `whisper-cli` è disponibile dentro il bundle.

### Struttura di una release

- `Crunch-<versione>-arm64.dmg` — installazione guidata.
- `Crunch-<versione>-arm64-mac.zip` — usata dall'updater interno.
- `latest-mac.yml` — metadati per `electron-updater`.
- Gli asset vengono pubblicati su GitHub Releases (`IC3NBERG/Memo`).

Vedi `RELEASE_WORKFLOW.md` per la procedura operativa completa.

---

## 📊 Dati utili

### Formati e prestazioni

| Voce | Valore |
|---|---|
| Sample rate | 16.000 Hz |
| Canali | 1 (mono) |
| Formato registrazione | WAV PCM 16 bit |
| Formato intermedio | WebM/Opus (MediaRecorder) |
| Spazio audio | ≈115 MB per ora (16 kHz × 16 bit × 3600 s) |
| Modello trascrizione | ≈1,5 GB |
| Modello traduzione | ≈1,5 GB |
| Thread CPU ASR | 4 |
| Intervallo live | 3,5 s |
| Soglia silenzio live | −50 dB RMS |
| Durata minima chunk | 0,4 s |
| Accuratezza trascrizione live | parziale, sostituita dalla completa |
| Accuratezza trascrizione completa | riferimento, segmenti con timestamp |
| Backend | whisper.cpp + Metal (arm64) |
| Rete richiesta | solo download modelli e aggiornamenti |

### Comandi IPC principali

| Canale | Tipo | Funzione |
|---|---|---|
| `recording:save` | invoke | salva WAV + metadata, anti-collisione |
| `recording:move` / `rename` / `delete` | invoke | gestione registrazioni |
| `transcription:start` | send | trascrizione completa (con `--output-json`) |
| `transcription:chunk` | invoke | trascrizione live di un chunk PCM |
| `transcript:read` / `save` / `export` | invoke | lettura, salvataggio, export |
| `library:get` | invoke | ricostruisce la libreria dal filesystem |
| `folder:create` / `rename` / `delete` | invoke | gestione gruppi |
| `model:check` / `download` | invoke/send | modello ASR |
| `model:check-translation` / `download-translation` | invoke/send | modello traduzione |
| `audio:get-path` | invoke | URL `file://` per il player |
| `app:check-for-updates` / `restart-and-install` | invoke | aggiornamenti |

### Flag di whisper-cli usati

```text
--model <path>          modello GGML
--file <audio.wav>      input
--output-file <prefix>  prefisso output
--output-json           segmenti con offset (trascrizione completa)
--output-txt            testo semplice
--print-progress        progresso parsing in UI
--threads 4             thread CPU
--language auto         rilevamento lingua
--translate             solo con modello medium
--no-timestamps         solo chunk live
```

### URL dei modelli

```text
https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin
```

### Scorciatoie e interazioni

| Azione | Come |
|---|---|
| Nuova registrazione | pulsante REC in basso |
| Pausa / riprendi | pulsante centrale durante la registrazione |
| Termina e salva | pulsante centrale "Termina" |
| Apri nota | clic sulla registrazione nella sidebar |
| Chiudi nota | pulsante "Chiudi" o `Esc` |
| Rinomina nota | doppio clic sul titolo |
| Cerca | campo in alto nella sidebar |
| Timestamp | toggle nella toolbar della nota |
| Export | pulsanti TXT / MD |
| Guida interna | icona `i` nella sidebar |

### Risoluzione problemi

| Sintomo | Causa probabile | Rimedio |
|---|---|---|
| "Modello Whisper non trovato" | download non completato | riapri l'app e lascia completare il download; controlla `~/CrunchRecordings/.models/` |
| "Modello di traduzione non trovato" | `ggml-medium.bin` assente | avvia una traduzione e accetta il download |
| "whisper-cli non trovato" | build nativa assente | `npm run build-whisper` |
| Nessun audio / trascrizione vuota | permesso microfono negato | Impostazioni di Sistema → Privacy → Microfono |
| App bloccata da Gatekeeper | build non firmata | tasto destro → Apri, oppure usa l'updater interno |
| Trascrizione lenta | modello grande, GPU occupata, batteria | chiudi app pesanti, mantieni il Mac alimentato |
| Testo live impreciso | chunk brevi e silenzio | normale: usa la trascrizione completa a fine lezione |

---

## ⚠️ Limiti attuali

- Solo **macOS Apple Silicon**; Windows e Linux sono pianificati, non ancora disponibili.
- **Nessuna diarizzazione**: non ci sono etichette Speaker A/B.
- **Nessun riconoscimento persistente** delle voci.
- **Nessuna gestione delle sovrapposizioni**: il testo può essere ambiguo quando due persone parlano insieme.
- L'editor è **testuale** (`contenteditable`), non ancora a blocchi non distruttivi: modificare il testo può disallinearlo dai segmenti.
- I **timestamp sono visualizzati ma non cliccabili**.
- La ricerca è per sottostringa, **non ancora FTS5**.
- **Nessuna cattura dell'audio di sistema**: solo microfono.
- **Nessuna sintesi automatica** e nessun highlight.
- Solo un modello ASR alla volta; `large-v3` non è ancora selezionabile.
- I file non sono cifrati at-rest: la privacy dipende dai permessi del Mac e dal backup.

Queste assenze sono deliberate e tracciate: la roadmap sopra è la lista delle prossime iterazioni.

---

## ❓ FAQ

**Crunch invia l'audio a un server?**
No. L'inferenza avviene in locale con whisper.cpp. La rete serve solo per scaricare i modelli e controllare gli aggiornamenti.

**Serve una connessione a internet per usarlo?**
Solo al primo avvio (download modello). Poi funziona offline.

**Posso usarlo su un Mac Intel?**
No: la build è arm64 e il motore è compilato per Apple Silicon. Il supporto ad altre architetture non è in roadmap a breve.

**Quanto spazio occupa un'ora di lezione?**
Circa 115 MB di audio, più la trascrizione (pochi MB).

**La trascrizione live è definitiva?**
No, è un'anteprima. La trascrizione completa sul WAV originale è quella di riferimento e sostituisce l'anteprima.

**Posso tradurre in francese o spagnolo?**
Non oggi: Whisper supporta nativamente la traduzione solo verso l'inglese. Il modello `medium` è dedicato a questo.

**I miei dati sono al sicuro se disinstallo l'app?**
Le registrazioni stanno in `~/CrunchRecordings/` e non vengono cancellate dalla disinstallazione. Fai comunque backup: i file non sono cifrati.

**Posso spostare l'archivio su un altro Mac?**
Sì: copia `~/CrunchRecordings/` e i modelli in `.models/` (oppure lascia che vengano riscaricati).

**Perché due modelli da 1,5 GB?**
Perché la traduzione richiede un modello addestrato al task `translate`; il modello di trascrizione non è adatto. Il secondo viene scaricato solo se richiesto.

**Quando arriveranno Windows e Linux?**
Non ci sono date annunciate. La direzione è impegnativa e l'architettura è già predisposta; vedi [Piattaforme e promessa cross-platform](#-piattaforme-e-promessa-cross-platform).

---

## 🙏 Crediti

- **[whisper.cpp](https://github.com/ggerganov/whisper.cpp)** e **ggml** — inferenza locale efficiente.
- **OpenAI Whisper** — architettura e pesi del modello.
- **Electron** — runtime desktop cross-platform.
- **electron-builder** / **electron-updater** — packaging e aggiornamenti.

---

<p align="center"><strong>Crunch</strong> — la lezione resta sul tuo Mac. E resta verificabile.</p>
