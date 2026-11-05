# Crunch

**Trascrizione locale e knowledge base verificabile per studio, formazione e lavoro.**

Crunch è un'applicazione desktop per macOS Apple Silicon che registra, trascrive offline con Whisper e organizza lezioni, riunioni e sessioni di formazione in un archivio ricercabile. Audio, trascrizioni e note restano sul dispositivo; ogni contenuto resta collegato al minuto esatto dell'audio originale.

[![Platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-000000?logo=apple&logoColor=white)](#integrazione-con-apple)
[![Engine](https://img.shields.io/badge/engine-whisper.cpp%20%2B%20Metal-2563EB)](#i-modelli-ai-scelta-e-funzionamento)
[![Privacy](https://img.shields.io/badge/privacy-100%25%20locale-15803D)](#privacy-dati-e-sicurezza)
[![Version](https://img.shields.io/badge/version-1.1.0-6B7280)](#)

> **Stato attuale: v1.1.0 — macOS (Apple Silicon).**
> Windows e Linux sono nella roadmap e verranno supportati: vedi [Piattaforme e promessa cross-platform](#piattaforme-e-promessa-cross-platform).

---

## Indice

- [A chi è rivolto](#a-chi-è-rivolto)
- [Il goal](#il-goal)
- [Stato del prodotto](#stato-del-prodotto)
- [Come funziona il software](#come-funziona-il-software)
- [Struttura del progetto](#struttura-del-progetto)
- [I modelli AI: scelta e funzionamento](#i-modelli-ai-scelta-e-funzionamento)
- [Integrazione con Apple](#integrazione-con-apple)
- [Privacy, dati e sicurezza](#privacy-dati-e-sicurezza)
- [Piattaforme e promessa cross-platform](#piattaforme-e-promessa-cross-platform)
- [Roadmap: i prossimi punti da sviluppare](#roadmap-i-prossimi-punti-da-sviluppare)
- [Avvio rapido e build](#avvio-rapido-e-build)
- [Dati utili](#dati-utili)
- [Limiti attuali](#limiti-attuali)
- [FAQ](#faq)
- [Crediti](#crediti)

---

## A chi è rivolto

Crunch nasce per due pubblici che condividono lo stesso problema: **non perdere informazioni dette a voce e doverle ritrovare rapidamente**. Lo studente lo usa per studiare; il professionista per documentare. L'archivio, il metodo e i dati sono gli stessi.

| Profilo | Esigenza tipica | Valore di Crunch |
|---|---|---|
| **Studente universitario** | seguire una lezione di 1–2 ore, ritrovare un passaggio, preparare l'esame | trascrizione completa, timestamp, gruppi per materia, export Markdown da integrare negli appunti |
| **Professionista** | documentare una riunione, un'intervista o una formazione senza trascrivere a mano | registrazione e trascrizione locali, ricerca nel testo, export TXT/Markdown per verbali e note operative |
| **Consulente / formatore** | conservare ore di contenuti e citarli con precisione | archivio portabile, trascrizioni con segmenti temporali, nessun upload a servizi terzi |
| **Team e ricerca** | costruire una base di conoscenza verificabile e riservata | storage locale, struttura a gruppi, dati in formati aperti; in roadmap ricerca full-text, sintesi con citazioni e diarizzazione |

### Valore per lo studente

- **Ripasso mirato.** Non si riascolta l'intera lezione: si cerca una parola, si individua il segmento e si controlla il minuto corrispondente.
- **Appunti per materia.** Ogni registrazione appartiene a un gruppo; l'export Markdown produce materiale pronto da integrare nel proprio metodo di studio.
- **Continuità.** La trascrizione live dà orientamento durante la lezione; la trascrizione completa recupera ciò che l'anteprima non aveva colto.

### Valore per il professionista

- **Documentazione senza attrito.** La riunione o l'intervista diventa un testo ricercabile, senza passare da un servizio cloud.
- **Tracciabilità.** I segmenti conservano i tempi; le future funzioni di citazione collegheranno ogni sintesi alla fonte originale.
- **Riservatezza.** Audio, nomi dei gruppi e contenuti restano sul dispositivo, requisito essenziale per clienti, HR, legale e ricerca.
- **Portabilità.** L'archivio è composto da cartelle e file standard: nessun lock-in applicativo.

> **Nota di trasparenza.** Le capacità di editing strutturato, diarizzazione e sintesi sono in roadmap e sono indicate come tali nel documento. Crunch non presenta come disponibili funzioni non ancora implementate.

---

## Il goal

### Il problema

Una lezione universitaria, una riunione o una sessione di formazione produce tre livelli di informazione distinti:

1. **il contenuto** — concetti, definizioni, formule, argomentazioni;
2. **le decisioni e le azioni** — cosa è stato deciso, cosa va fatto, cosa resta aperto;
3. **le persone** — chi ha detto cosa, chi ha risposto, chi ha sollevato un'obiezione.

Gli strumenti comuni tendono a comprimere questi livelli in un'unica registrazione o in un trascritto piatto. Il testo non è collegato ai minuti, non distingue le voci, non permette di riascoltare un passaggio con precisione e, per ottenere una sintesi, richiede di copiare tutto in un servizio esterno. Lo studente riascolta l'intera lezione per individuare pochi minuti utili; il professionista riscrive a mano un verbale. In entrambi i casi si perde tracciabilità.

### La tesi di Crunch

> **La trascrizione non è il prodotto finale: è il livello dati su cui costruire studio, documentazione e sintesi.**

Crunch vuole essere un **quaderno operativo locale e verificabile**: ogni parola resta collegata all'audio originale, ogni sintesi resta collegata alle sue fonti, ogni riorganizzazione dell'utente non distrugge il dato grezzo.

### I quattro principi

| Principio | Significato concreto |
|---|---|
| **Local-first** | Audio, trascrizioni, modelli e note vivono sul dispositivo. Il cloud è un'eccezione, non un requisito. |
| **Verificabile** | Ogni riassunto, highlight o citazione deve poter essere ricondotto a un blocco e a un timestamp ascoltabile. |
| **Non distruttivo** | La trascrizione originale è immutabile. L'utente lavora su blocchi, sezioni, tag e annotazioni, senza sovrascrivere la fonte. |
| **Nativo dove serve** | Metal e Core ML su Apple Silicon per ottenere prestazioni da GPU senza inviare audio a un server. |

### Il flusso di prodotto

```
Registra → Trascrive → Separa le voci → Struttura in blocchi → Cerca e riascolta → Riassume con citazioni → Esporta
```

Oggi Crunch copre in modo solido i primi due passaggi e parte del terzo — organizzazione per gruppi, ricerca testuale, timestamp, riproduzione ed esportazione. I passaggi successivi (diarizzazione, editor a blocchi, sintesi citabile, ricerca full-text, doppia sorgente audio) sono descritti nella [roadmap](#roadmap-i-prossimi-punti-da-sviluppare).

### Non-obiettivi

- **Non è un bot per meeting.** Non partecipa alle call e non richiede integrazioni con calendari o piattaforme di videoconferenza.
- **Non è un servizio cloud.** Non esiste un account obbligatorio né un caricamento automatico dei dati.
- **Non è un trascrittore infallibile.** La qualità dipende da microfono, rumore e lingua; Crunch distingue esplicitamente ciò che è anteprima da ciò che è definitivo.

---

## Stato del prodotto

| Area | Disponibile nella v1.1.0 | In roadmap |
|---|---|---|
| Registrazione locale | ✅ microfono, pausa/ripresa, WAV 16 kHz | doppia sorgente microfono + sistema |
| Preprocessing audio | ✅ passa-alto, noise gate, compressore, AGC adattivo, limiter | preset per ambiente |
| Trascrizione | ✅ live a finestra mobile (8 s, overlap 2 s) e completa al 100% | word-level timestamp persistiti |
| Lingue | ✅ rilevamento automatico, traduzione in inglese con modello dedicato | selezione esplicita del modello |
| Organizzazione | ✅ gruppi, rinomina, spostamento, anti-sovrascrittura; revisioni immutabili | sezioni manuali, blocchi |
| Consultazione | ✅ ricerca testuale, timestamp cliccabili, player, copia, export | ricerca FTS5, evidenziazione del segmento attivo |
| Gestione modelli | ✅ dormienti: download solo su richiesta, offline dopo il primo scaricamento | verifica integrità e aggiornamento modelli |
| Intelligenza del contenuto | — | diarizzazione, speaker persistenti, highlight, sintesi citabile |
| Piattaforme | ✅ macOS Apple Silicon | Windows, Linux |

### Novità della v1.1.0

- **Archivio a revisioni immutabili**: ogni trascrizione vive in `.revisions/rN/` con ID stabili per segmento. Una nuova trascrizione o traduzione crea una nuova revisione; le precedenti restano archiviate e consultabili.
- **Editing non distruttivo**: testo corretto, segmenti nascosti, tag, annotazioni, ordine e gruppi stanno in un overlay separato (`edits.json`). La sorgente non viene mai riscritta; `sourceHash` segnala eventuali disallineamenti.
- **Migrazione automatica v1 → v2**: le registrazioni esistenti vengono convertite alla prima apertura, con backup in `.backup-v1/` e `metadata.json` scritto per ultimo come commit marker. Se la migrazione si interrompe, l'app recupera dal backup. La conversione è one-way per l'app; il backup resta per un rollback manuale.
- **Scritture atomiche e staging Whisper interno**: audio, metadata e revisioni non lasciano mai file parziali; whisper.cpp lavora in una staging temporanea dentro la registrazione.
- **Timestamp coerenti con il dato**: i marcatori sono cliccabili e portano il player al secondo esatto. Sono disponibili solo per le revisioni con timing per segmento; per anteprime live e trascrizioni legacy il toggle viene disabilitato invece di mostrare valori finti.
- **Download modelli più robusto**: redirect relativi, controllo della dimensione, cleanup dei file temporanei e blocco dei download concorrenti.
- **Base di test e CI**: 58 test Node su migrazione, proiezione, revisioni, path guard, staging, download e DSP live; workflow GitHub Actions su Node 20 e 24.

### Novità della v1.0.9

- **Finestra live da 8 s con 2 s di sovrapposizione**: il primo feedback resta a 3,5 s; finché la finestra non è piena gli aggiornamenti sono frequenti, poi avanzano di 6 s (8 − 2). Le parole ai confini non vengono più tagliate.
- **Merge per timestamp**: ogni chunk restituisce parole con offset; la zona di sovrapposizione viene sostituita invece di essere concatenata. Niente più duplicati o salti al confine tra chunk.
- **Lingua bloccata dopo il primo rilevamento**: `auto` viene usato solo per il primo chunk, poi la lingua resta stabile per tutta la sessione. `auto` resta il default della trascrizione completa.
- **AudioWorklet al posto di ScriptProcessor**: la cattura PCM gira nel thread audio dedicato e non perde buffer quando l'interfaccia è sotto carico.
- **Silenzio misurato prima dell'AGC**: la soglia VAD lavora sul segnale reale, non sul rumore già amplificato. Il chunk viene inoltre normalizzato a −20 dBFS e rifilato ai bordi.
- **Motore persistente**: `whisper-server` tiene il modello caricato tra un chunk e l'altro; se non è disponibile, Crunch ripiega automaticamente su `whisper-cli`. Latenza media per chunk: circa 1,9 s su M4 con finestra da 8 s.
- **Prompt di continuità**: gli ultimi 200 caratteri della trascrizione vengono passati come contesto, con `--suppress-nst` e soglia no-speech a 0,6 per ridurre le allucinazioni.
- **Benchmark riproducibile**: `npm run benchmark-live` confronta 3,5 s / 8 s / 10 s con e senza overlap, misura il WER rispetto alla trascrizione integrale e la latenza per chunk.

### Novità della v1.0.8

- **Barra di cattura audio ridisegnata**: accanto a REC compare una capsula dedicata con indicatore `MIC` e stato live. A riposo mostra una traccia tratteggiata; durante la registrazione l'onda diventa un nastro sfumato con alone ambra, il bordo si accende e il punto MIC pulsa in rosso.
- **Toggle preprocessing più puliti**: rimossi i segni di spunta; i quattro filtri ora sono pillole compatte che si illuminano quando sono attivi, lasciando più respiro alla forma d'onda.

### Novità della v1.0.7

- **Preprocessing audio reale**: passa-alto 80 Hz, noise gate con isteresi e hold, compressore dinamico, AGC adattivo e limiter finale, tutti descritti nella sezione [Preprocessing audio](#2-preprocessing-audio).
- **Traduzione in inglese effettiva**: nuovo modello dedicato `ggml-medium`, perché `large-v3-turbo` non esegue il task `translate`. In live, se il modello manca, l'anteprima resta in lingua originale con un avviso.
- **Modelli dormienti**: nessun download o caricamento all'avvio; il modello necessario viene richiesto con una conferma esplicita al primo utilizzo.
- **Interfaccia ridisegnata**: sidebar a gruppi più leggibile, banner a stack per download e aggiornamenti, logo animato nello stato vuoto, animazioni durante la trascrizione e pill REC flottante per tornare alla registrazione in corso.
- **Registrazione e note indipendenti**: cambiare nota mentre si registra non sovrappone più le viste e la trascrizione live non scrive nella nota aperta.

---

## Come funziona il software

### Pipeline completa

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. CATTURA                                                           │
│    microfono → Web Audio API → 16 kHz mono Float32                   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│ 2. PREPROCESSING (4 controlli, attivi per default)                   │
│    passa-alto 80 Hz → noise gate → compressore → AGC → limiter       │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
              ┌────────────────┴─────────────────┐
              │                                  │
┌─────────────▼─────────────┐      ┌─────────────▼──────────────────────┐
│ 3a. ANTEPRIMA LIVE        │      │ 3b. REGISTRAZIONE DEFINITIVA       │
│ finestra 8 s, overlap 2 s │      │ MediaRecorder (Opus/WebM)          │
│ AudioWorklet + VAD        │      │ → decode → WAV PCM 16 bit mono     │
│ whisper.cpp + Metal       │      │ → ~/CrunchRecordings/.../audio.wav │
│ merge per timestamp       │      │ persistito su disco                │
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

Il renderer richiede il microfono con `getUserMedia` a **16.000 Hz, mono**, disattivando echo cancellation, noise suppression e auto-gain di sistema: quei filtri sono progettati per le chiamate, non per la trascrizione, e possono attenuare parti utili del parlato. Il preprocessing è gestito da Crunch, in modo trasparente e disattivabile.

### 2. Preprocessing audio

I quattro controlli formano una catena DSP costruita con la Web Audio API:

| Stadio | Parametro | Funzione |
|---|---|---|
| **Passa-alto** | 80 Hz, Q 0,707 (Butterworth) | rimuove rimbombi, passi, vibrazioni del tavolo e rumore a bassa frequenza |
| **Noise gate** | apertura −42 dB, chiusura −50 dB, hold 250 ms, floor −60 dB | chiude il segnale nelle pause con isteresi e attenuazione morbida, senza tagliare l'attacco delle parole |
| **Compressore** | threshold −28 dB, knee 18 dB, ratio 3,5:1, attack 6 ms, release 220 ms, makeup +3 dB | rende comprensibili i passaggi a bassa voce senza saturare le esclamazioni |
| **Auto-gain (AGC)** | target −20 dBFS, guadagno adattivo 0,5×–8×, aggiornato ogni 100 ms | mantiene uniforme il volume se chi parla si muove o si allontana dal microfono |
| **Limiter** | ceiling −2 dB | evita saturazione e clipping sui picchi improvvisi |

L'AGC è reale: misura l'RMS del segnale e corregge il guadagno nel tempo, con riduzione rapida dei picchi e aumento graduale per evitare il "pompaggio". Il limiter finale è sempre attivo, mentre i quattro toggle si applicano dalla registrazione successiva: durante una REC sono bloccati per non alterare l'audio a metà lezione.

La stessa catena alimenta tre rami: il **MediaRecorder** per il file definitivo, l’**AudioWorklet** per i chunk live e un **AnalyserNode** per la forma d'onda a 60 fps.

### 3. Due modalità di trascrizione

**Anteprima live (finestra mobile).** Il primo feedback arriva dopo 3,5 s; poi Crunch trascrive una finestra di 8 s con 2 s di sovrapposizione (aggiornamenti frequenti all'inizio, poi ogni 6 s). La cattura avviene in un **AudioWorklet** sul thread audio e preleva il segnale **prima dell'AGC**: il VAD misura così il livello reale e scarta silenzio e rumore di fondo sotto −45 dB. Il chunk viene rifilato ai bordi e normalizzato a −20 dBFS. La lingua viene rilevata una sola volta e poi bloccata; `--suppress-nst` e una soglia no-speech di 0,6 riducono le allucinazioni. Ogni chunk restituisce parole con timestamp: la zona di sovrapposizione viene sostituita, non concatenata, quindi niente duplicati ai confini.

**Trascrizione completa (100%).** Al termine della sessione, il file `audio.wav` originale viene rianalizzato per intero. Questa è la trascrizione di riferimento: produce segmenti con offset in millisecondi e sostituisce l'anteprima. Crunch distingue esplicitamente `isLivePreview` da `isCompleteTranscript`, così un'anteprima non viene mai presentata come definitiva.

> **Perché due passaggi.** L'anteprima live serve a verificare il funzionamento e a mantenere l'orientamento durante la sessione. La decodifica integrale serve a non perdere parole. Sono due obiettivi con compromessi diversi tra latenza e accuratezza.

### 4. Salvataggio e libreria

Al termine della registrazione il WebM/Opus viene decodificato e convertito in **WAV PCM 16 bit mono** a 16 kHz, quindi scritto in una cartella con timestamp nel nome. Una barriera anti-sovrascrittura aggiunge un progressivo se la cartella esiste già: due registrazioni non possono collidere.

La libreria viene ricostruita leggendo il filesystem, che è la fonte di verità. Ogni registrazione è una cartella autonoma e portabile: copiarla altrove significa copiare tutto il necessario.

### 5. Consultazione

- **Gruppi** (materie, progetti, clienti) con creazione, rinomina ed eliminazione sicura: eliminare un gruppo **non elimina** le registrazioni, le sposta in `_unsorted`.
- **Ricerca** nella sidebar su nome e testo della trascrizione (sottostringa, case-insensitive).
- **Timestamp** attivabili e disattivabili accanto ai segmenti.
- **Player** integrato con seek, volume e tempo corrente.
- **Copia** dell'intero transcript ed **export** `.txt` o `.md`.
- **Rinomina** della registrazione con doppio clic.

---

## Struttura del progetto

### Architettura Electron

Crunch adotta il modello a tre livelli di Electron, con isolamento rigoroso:

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
│   ├── core/                # logica pura, testabile senza Electron
│   │   ├── library/         # creazione registrazioni, metadata atomico
│   │   ├── models/          # download dei modelli con staging e redirect
│   │   ├── schema/          # JSON Schema di metadata, transcript e edits
│   │   ├── storage/         # scritture atomiche, path guard realpath
│   │   └── transcript/      # revisioni, migrazione v1→v2, proiezione, whisper
│   ├── main/
│   │   ├── main.js          # processo principale: finestra, IPC, libreria, trascrizione
│   │   ├── handlers.js      # handler IPC puri per recording:save e transcript:read/save
│   │   ├── preload.js       # bridge sicuro renderer ↔ main
│   │   └── updater.js       # updater interno per build macOS non firmate (ZIP + SHA-512 + backup)
│   └── renderer/
│       ├── index.html       # struttura UI e modali (guida, gruppi, conferme)
│       ├── app.js           # stato, registrazione, pipeline audio, player, ricerca, export
│       ├── audio-dsp.js     # RMS, trim del silenzio, normalizzazione e finestra live
│       ├── style.css        # tema, layout, animazioni, waveform
│       └── icons.js         # set di icone SVG inline
├── test/                    # 58 test Node (node:test) e fixture v1 sintetiche
├── scripts/
│   ├── build-whisper.sh     # compila whisper.cpp con Metal per arm64 → bin/whisper-cli
│   └── generate-icon.sh     # genera l'icona .icns
├── assets/
│   ├── icons/icon.icns      # icona app
│   └── entitlements.mac.plist
├── bin/
│   └── whisper-cli          # binario nativo (incluso come extraResource nel pacchetto)
├── dist/                  # output di electron-builder (DMG, ZIP, .app)
├── package.json           # dipendenze, script di build, configurazione electron-builder
├── RELEASE_WORKFLOW.md    # procedura di release e aggiornamenti
└── README.md
```

### Dati dell'utente

Tutti i dati risiedono in `~/CrunchRecordings/`; le installazioni precedenti migrano automaticamente da `~/MemoRecordings/`:

```text
~/CrunchRecordings/
├── .models/
│   ├── ggml-large-v3-turbo.bin   # modello principale (~1,5 GB)
│   └── ggml-medium.bin           # modello per la traduzione in inglese (~1,4 GB)
├── _unsorted/                    # registrazioni senza gruppo
└── <Gruppo>/
    └── 2026-11-03_09-15-00_Diritto Privato/
        ├── audio.wav             # audio originale 16 kHz mono PCM 16 bit
        ├── metadata.json         # commit marker: activeRevisionId e indice revisioni
        ├── .revisions/
        │   ├── r1/
        │   │   ├── transcript.json   # sorgente canonica della revisione
        │   │   └── edits.json        # overlay: testo, nascosti, tag, ordine, gruppi
        │   └── r2/                   # nuova trascrizione o traduzione
        │       ├── transcript.json
        │       └── edits.json
        ├── transcript.json       # copia derivata della revisione attiva
        ├── transcript.edits.json # copia derivata dell'overlay attivo
        ├── transcript.txt        # testo effettivo (ricerca, export rapido)
        └── .backup-v1/           # backup della migrazione, mai cancellato automaticamente
```

Le copie nella root della registrazione sono di compatibilità e possono essere rigenerate: la fonte di verità è sempre `.revisions/rN/`. Una nuova trascrizione non sovrascrive la precedente, la archivia.

### Schema dei metadati

```json
{
  "schemaVersion": 2,
  "id": "uuid",
  "createdAt": "2026-11-03T09:15:00.000Z",
  "updatedAt": "2026-11-03T10:02:00.000Z",
  "name": "Diritto Privato",
  "date": "2026-11-03T09:15:00.000Z",
  "folder": "Giurisprudenza",
  "duration": 5400,
  "hasTranscript": true,
  "isCompleteTranscript": true,
  "isLivePreview": false,
  "isTranslated": false,
  "activeRevisionId": "r2",
  "revisions": [
    {
      "revisionId": "r1",
      "kind": "livePreview",
      "createdAt": "2026-11-03T09:15:00.000Z",
      "complete": false,
      "translated": false,
      "timing": "whole-recording"
    },
    {
      "revisionId": "r2",
      "kind": "transcription",
      "createdAt": "2026-11-03T10:02:00.000Z",
      "complete": true,
      "translated": false,
      "timing": "segment"
    }
  ],
  "previewReplacedAt": "2026-11-03T10:02:00.000Z"
}
```

`metadata.json` è scritto per ultimo durante la migrazione: finché è v1, la registrazione è v1. `migrationWarnings` conserva eventuali anomalie trovate durante la conversione.

### Schema della trascrizione

```json
{
  "schemaVersion": 2,
  "revisionId": "r2",
  "kind": "transcription",
  "source": {
    "engine": "whisper-cli",
    "model": "ggml-large-v3-turbo.bin",
    "language": "it",
    "targetLanguage": null,
    "complete": true,
    "translated": false,
    "timing": "segment",
    "format": "whisper-json"
  },
  "segments": [
    { "id": "r2-s0001", "start": 0.0, "end": 4.32, "text": "Oggi parliamo della nozione di obbligazione." },
    { "id": "r2-s0002", "start": 4.32, "end": 9.81, "text": "La fonte può essere volontaria oppure legale." }
  ]
}
```

Gli offset di whisper.cpp arrivano in millisecondi e vengono convertiti in secondi una sola volta, nel revision store. Gli ID sono 1-based (`r2-s0001`) e restano stabili per la revisione: l'overlay li usa per riferirsi ai segmenti senza modificarli. Quando `timing` è `whole-recording` (anteprima live o trascrizione legacy) la UI non offre timestamp per segmento. Il contratto completo è in [`DATA_FORMAT.md`](DATA_FORMAT.md).

---

## I modelli AI: scelta e funzionamento

### Che cosa c'è sotto: Whisper

Crunch non usa un'API: esegue **Whisper** in locale tramite **whisper.cpp**, l'implementazione C/C++ ottimizzata del modello OpenAI. Whisper è un **transformer encoder–decoder** addestrato su centinaia di migliaia di ore di audio multilingua. Il funzionamento semplificato:

1. **Feature extraction** — l'audio a 16 kHz viene trasformato in uno spettrogramma log-Mel (finestre da 25 ms, hop 10 ms). Per questo il sample rate nativo è 16 kHz: evitare ricampionamenti inutili riduce artefatti.
2. **Encoder** — lo spettrogramma diventa una sequenza di rappresentazioni contestuali.
3. **Decoder** — genera i token di testo in modo autoregressivo, con token speciali per lingua, task (`transcribe` / `translate`), timestamp e fine segmento.
4. **Timestamp** — il decoder può emettere marcatori temporali, che whisper.cpp converte in offset per ogni segmento. Da qui derivano `start` e `end` nel `transcript.json`.

Il modello è **multilingua** e rileva automaticamente la lingua (`--language auto`), ma la traduzione supportata dal task nativo è **solo verso l'inglese**: Whisper non traduce coppie arbitrarie (ad esempio italiano → francese).

### I modelli usati oggi

| Modello | File | Dimensione | Ruolo | Download |
|---|---|---|---|---|
| **large-v3-turbo** | `ggml-large-v3-turbo.bin` | ≈1,5 GB | trascrizione (live e completa) | alla prima trascrizione richiesta |
| **medium** | `ggml-medium.bin` | ≈1,4 GB | traduzione in inglese | solo quando si sceglie "Traduci" |

**Modelli dormienti.** All'avvio Crunch verifica soltanto la presenza dei file: non scarica e non carica alcun modello. L'app parte subito e resta leggera; il download viene proposto con una conferma esplicita nel momento in cui la funzione viene richiesta. Dopo il primo scaricamento i modelli restano disponibili offline in `~/CrunchRecordings/.models/`.

**Perché `large-v3-turbo` come default.** È un large-v3 con decoder ridotto a 4 layer (≈809 milioni di parametri): conserva l'encoder e quindi la qualità acustica del large-v3, ma decodifica con maggiore velocità. È il compromesso più adatto a sessioni lunghe su un laptop.

**Perché un modello separato per la traduzione.** `large-v3-turbo` è addestrato al task *transcribe* e non esegue in modo affidabile il task *translate*: verificato sul binario incluso, restituisce il testo in lingua originale. Crunch non forza il modello su un compito per cui non è ottimizzato: usa `medium`, scaricato **solo su richiesta esplicita** e mantenuto inattivo finché non serve. Questo evita di occupare ~1,4 GB aggiuntivi per chi non traduce.

**Perché non `large-v3` di default.** Richiede più RAM, più tempo e più batteria per un beneficio non sempre percepibile. Il piano è renderlo **selezionabile** per chi necessita della massima accuratezza.

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
              (scarica se manca)  (scarica alla prima trascrizione)
                        │              │
                        └──────┬───────┘
                               ▼
                    whisper-cli + Metal
                    --threads 4 --language auto
```

Regole implementate in `src/main/main.js`:

- `model:check` verifica il modello di trascrizione; `model:check-translation` quello di traduzione.
- Se il modello richiesto manca, l'IPC restituisce un codice esplicito (`model-missing` / `translation-model-missing`) e la UI propone il download: nessun errore silenzioso.
- Se in modalità live manca il modello di traduzione, l'anteprima continua in lingua originale con un avviso una tantum, invece di interrompere la lezione.
- I download sono in streaming su file `.tmp`, protetti da avvii concorrenti, e vengono rinominati solo al completamento, con supporto ai redirect (Hugging Face → CDN) e limite di 10 redirect.
- La trascrizione live rifiuta chunk troppo corti (< 0,5 s) o troppo silenziosi (< −45 dB RMS misurati prima dell'AGC); il segnale viene rifilato e normalizzato a −20 dBFS.
- Una sola trascrizione completa alla volta (`activeTranscription`): nessun processo concorrente che competa per la GPU.

### Come lavora whisper.cpp su Apple Silicon

- **Metal** abilita l'esecuzione dei kernel matrix-multiply sulla GPU.
- La **memoria unificata** consente a CPU e GPU di accedere agli stessi pesi senza copie: è il vantaggio principale di Apple Silicon rispetto a una GPU discreta.
- I calcoli avvengono in **FP16**, con `--threads 4` per la parte CPU.
- Il binario è compilato per **arm64** con `GGML_METAL=ON`. La build è **pinned** a un commit verificato (`482279b8…`) per evitare che un aggiornamento upstream comprometta le release.
- La velocità indicativa è **fino a ~6× real-time** su Apple Silicon: un'ora di audio richiede circa 10–20 minuti a seconda del chip e del modello. L'anteprima live ha latenza di pochi secondi e non costituisce garanzia di accuratezza.

### Prossimi sviluppi lato modelli

- **large-v3 selezionabile** per la massima accuratezza, con download opzionale e stima di RAM e tempo.
- **Diarizzazione** con modelli dedicati (embedding vocali e clustering), separati dal motore ASR.
- **Voice embedding persistente** per riconoscere le stesse voci tra sessioni diverse.
- **Modelli di sintesi locali** per riassunti citabili, senza inviare testo al cloud.
- **Core ML** come backend alternativo a Metal per le fasi in cui produce vantaggi misurabili in consumo energetico.

> I nomi dei modelli futuri non sono ancora definitivi. La scelta sarà guidata da tre criteri misurabili: accuratezza sull'italiano accademico e professionale, latenza su Apple Silicon e licenza compatibile con la distribuzione. La roadmap espone requisiti, non integrazioni non ancora validate.

---

## Integrazione con Apple

| Aspetto | Implementazione |
|---|---|
| **Chip** | Apple Silicon arm64 (M1 e successivi). Build `arm64` only: nessun supporto Intel e nessun Rosetta per il motore ASR. |
| **Accelerazione** | whisper.cpp compilato con `GGML_METAL=ON`; GPU Apple via Metal, FP16, memoria unificata. |
| **Finestra** | `titleBarStyle: 'hiddenInset'`, traffic lights in posizione nativa, tema scuro `#1E1A17`. |
| **Permessi** | `NSMicrophoneUsageDescription` in `extendInfo`; macOS richiede l'autorizzazione al primo utilizzo del microfono. |
| **Distribuzione** | DMG + ZIP per `arm64` via `electron-builder`, con layout drag-to-Applications. |
| **Firma** | Le build attuali possono non essere firmate con Developer ID. Per questo esiste un **updater interno**: scarica lo ZIP, verifica lo **SHA-512**, sostituisce il bundle con backup e riavvia. Se l'app è firmata, usa Squirrel.Mac. |
| **Aggiornamenti** | Controllo all'avvio (dopo 4 s) e ogni 3 ore; stato e progresso in UI; fallback alla pagina release se il pacchetto non è pronto. |
| **Audio di sistema (roadmap)** | La doppia sorgente richiede ScreenCaptureKit / Core Audio tap (macOS 13+). È il principale requisito tecnico della modalità meeting. |

### Requisiti consigliati

- macOS 12 o successivo (consigliato macOS 13+ per le future funzioni di cattura audio di sistema).
- Apple Silicon (M1/M2/M3/M4).
- 8 GB di RAM (16 GB consigliati per large-v3 e per la diarizzazione).
- ~4 GB liberi: applicazione, modello di trascrizione e modello di traduzione.
- Microfono funzionante e permesso concesso in *Impostazioni di Sistema → Privacy e Sicurezza → Microfono*.

### Perché Electron

Electron consente di riutilizzare la stessa interfaccia e la stessa pipeline Web Audio su macOS, Windows e Linux. Il motore pesante (Whisper) resta nativo e viene compilato per piattaforma. È una scelta deliberata in funzione del supporto cross-platform, non un ripiego.

---

## Privacy, dati e sicurezza

### Cosa non lascia il dispositivo

Audio, trascrizioni, metadati, nomi dei gruppi, note e modelli **restano in `~/CrunchRecordings/`**. Non esiste telemetria, non esiste un account, non esiste un upload automatico.

### Le uniche connessioni di rete

| Connessione | Momento | Dati inviati |
|---|---|---|
| Download modello da Hugging Face | prima trascrizione / prima traduzione richiesta | solo la richiesta HTTP del file |
| Controllo aggiornamenti su GitHub Releases | all'avvio e ogni 3 ore | versione client e richiesta di metadati release |
| Download aggiornamento | quando disponibile | nessun dato utente |

Nessuna di queste connessioni contiene audio o testo della trascrizione. Dopo il download dei modelli, Crunch funziona completamente offline.

### Sicurezza applicativa

- `contextIsolation: true`, `nodeIntegration: false`: il renderer non può usare Node.
- Il preload espone solo una whitelist di funzioni (`window.crunchAPI`).
- **Validazione dei percorsi**: ogni operazione su file verifica che il path risolto sia dentro `~/CrunchRecordings/` e che il nome del gruppo non contenga separatori o `..`.
- La trascrizione accetta solo file audio interni alla registrazione richiesta.
- Le operazioni distruttive sono conservative: eliminare un gruppo sposta le registrazioni in `_unsorted`; se rileva file non gestiti, si arresta senza cancellare nulla.
- Anti-sovrascrittura su registrazioni e spostamenti.

### Uso responsabile e conformità

Le registrazioni di lezioni, riunioni e colloqui possono contenere voci di terzi e informazioni personali. La responsabilità di informare i partecipanti e di rispettare la normativa applicabile è dell'utente.

In contesti professionali e in UE è opportuno considerare:

- **Base giuridica e consenso** per la registrazione, secondo il contesto (didattico, aziendale, ricerca).
- **Minimizzazione e conservazione** — registrare solo ciò che serve e definire una politica di retention.
- **Dati biometrici** — le future funzioni di riconoscimento vocale persistente trattano impronte vocali: dovranno prevedere consenso esplicito, possibilità di cancellazione e conservazione locale.
- **Cifratura** — i file non sono attualmente cifrati at-rest: la riservatezza dipende dai permessi del Mac, da FileVault e dalle policy di backup.
- **Accesso** — su macchine condivise, proteggere l'account macOS e la cartella `~/CrunchRecordings/`.

---

## Piattaforme e promessa cross-platform

**Oggi Crunch è disponibile per macOS Apple Silicon.** Non è una limitazione accidentale: è il punto di partenza scelto per integrare Metal, memoria unificata e un'esperienza controllata end-to-end.

**L'impegno è portare Crunch su Windows e Linux.** L'architettura è già predisposta: Electron per l'interfaccia, whisper.cpp per l'inferenza, filesystem locale come fonte di verità, nessuna dipendenza da API cloud. Le differenze reali sono tre e vengono affrontate esplicitamente:

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
4. **Parità dei dati** — stesso schema `metadata.json`/`transcript.json` su tutte le piattaforme, così un archivio è portabile.
5. **Build CI** — matrice macOS/Windows/Linux con artefatti firmati e test di regressione sulla trascrizione.
6. **Nessuna funzionalità macOS-only nel core** — le specificità Apple (Metal, Core ML, integrazione di sistema) restano backend opzionali, non prerequisiti.

Non verranno annunciate date finché una build Windows/Linux non sarà realmente utilizzabile: la promessa riguarda la direzione e la portabilità dei dati, non un countdown artificiale.

---

## Roadmap: i prossimi punti da sviluppare

Legenda: ✅ disponibile · 🚧 da sviluppare · 🔭 esplorativo

### A. Intelligenza delle voci

#### 1. Diarizzazione speaker 🚧

**Cosa.** Separare le voci con modelli dedicati e mostrare le etichette `Speaker A`, `Speaker B`, ecc. Ogni etichetta è rinominabile (ad esempio "Prof. Rossi", "Cliente", "Studentessa 2") e il nome si propaga a tutti i segmenti di quella voce.

**Perché.** Sapere *chi* ha detto una cosa è spesso più importante del *cosa*: domande, obiezioni, risposte e turni di parola.

**Come.** Pipeline separata dall'ASR: embedding vocali per segmento (modelli tipo WeSpeaker, pyannote o sherpa-onnx), clustering con stima del numero di speaker, allineamento dei cluster ai segmenti Whisper. I risultati vengono salvati come `speaker_id` per segmento, **senza modificare** il testo.

**Criterio di accettazione.** Due voci distinte su una registrazione pulita vengono separate con etichette coerenti; rinominare uno speaker aggiorna vista ed export; il transcript originale resta recuperabile.

#### 2. Riconoscimento speaker persistente 🚧

**Cosa.** Voice embedding per associare automaticamente le stesse voci ai nomi nelle sessioni successive.

**Perché.** Evita di rietichettare ogni volta le stesse persone e rende l'archivio interrogabile per persona ("cosa ha detto Rossi nella lezione 4?").

**Come.** Archivio locale di voiceprint (vettori, nome, data e consenso), soglia di similarità configurabile, matching con margine per limitare i falsi positivi. Ogni associazione automatica è **proposta e confermabile**, mai imposta.

**Criterio di accettazione.** Su una seconda registrazione la stessa voce viene proposta con il nome già assegnato; l'utente può correggere; il voiceprint è cancellabile.

#### 3. Gestione sovrapposizioni 🚧

**Cosa.** Conservare entrambe le voci quando due persone parlano contemporaneamente, invece di sovrascriverle.

**Perché.** Nelle discussioni reali le sovrapposizioni contengono spesso la parte più rilevante: interruzioni, correzioni, domande.

**Come.** Diarizzazione *overlap-aware*: segmenti con più speaker attivi, trascrizione per traccia quando possibile, rappresentazione esplicita nel formato dati (`speakers: ["A","B"]`, `overlap: true`) e indicazione visiva nell'editor. Nei casi non separabili, il testo viene conservato come "segmento misto" invece di essere scartato.

**Criterio di accettazione.** Un tratto con due voci simultanee non perde testo e mostra entrambi gli speaker; l'utente può riascoltare e correggere.

### B. La trascrizione come dato strutturato

#### 4. Trascrizione word/segment-level con timestamp ✅/🚧

**Cosa.** Ogni frase — e in prospettiva ogni parola — collegata al minuto e al secondo esatto dell'audio.

**Perché.** È il prerequisito di seek, citazioni, blocchi e sintesi selettiva.

**Come.** I segmenti con `id`, `start` ed `end` sono implementati dalla v1.1.0 e restano stabili dentro la revisione. Il passo successivo è la granularità word-level (token timestamp) persistita accanto ai segmenti.

**Criterio di accettazione.** Ogni segmento ha `id`, `start`, `end`; il clic su un timestamp porta il player a quel punto; gli ID sopravvivono a salvataggi e riaperture. Soddisfatto per i segmenti; resta la granularità parola.

#### 5. Editor a blocchi non distruttivo 🚧

**Cosa.** La trascrizione resta intatta; l'utente sposta, raggruppa, tagga e annota blocchi.

**Perché.** Organizzare il materiale è parte del lavoro di studio e di documentazione. L'editor attuale è un `contenteditable` che può disallineare il testo dai segmenti: va superato.

**Come.** Modello dati a blocchi immutabili, con viste e ordini dell'utente salvati separatamente. Drag & drop, gruppi, tag, note, undo/redo. La trascrizione originale resta una sorgente in sola lettura; ogni modifica è un livello sopra.

**Criterio di accettazione.** Spostare o raggruppare blocchi non altera il testo originale né i timestamp; "ripristina vista originale" funziona; l'export riflette la vista scelta.

#### 6. Sezioni manuali 🚧

**Cosa.** Creare sezioni "Decisioni", "Da fare", "Argomenti", "Domande" trascinando i blocchi originali.

**Perché.** Trasforma una sessione in un documento operativo, senza perdere il legame con la fonte.

**Come.** Sezioni come collezioni ordinate di riferimenti a BLOCK ID, non copie. Una sezione può contenere lo stesso blocco in più viste senza duplicare il dato.

**Criterio di accettazione.** Ogni elemento di sezione punta a un blocco esistente; eliminare una sezione non elimina i blocchi; l'export Markdown mantiene la struttura.

#### 7. Sintesi selettiva 🚧

**Cosa.** Riassunto generato solo sui blocchi o sull'intervallo scelto dall'utente.

**Perché.** Riassumere un'ora di materiale è meno utile che riassumere i dodici minuti rilevanti.

**Come.** Selezione esplicita (blocchi, intervallo temporale, sezione) → contesto delimitato → modello di sintesi locale → output con riferimenti. Se il contesto supera la finestra del modello, chunking con sintesi gerarchica e citazioni preservate.

**Criterio di accettazione.** Il riassunto cita solo blocchi selezionati; nessun contenuto inventato al di fuori delle fonti; l'utente può rigenerare con istruzioni diverse.

#### 8. Citazioni dei blocchi nel riassunto 🚧

**Cosa.** Ogni punto sintetizzato rimanda ai BLOCK ID e ai timestamp originali.

**Perché.** È la differenza tra un riassunto verificabile e un testo da controllare interamente.

**Come.** Output strutturato, non solo prosa: ogni punto contiene `block_ids` e `citations`; la UI li rende cliccabili e apre il player al timestamp. Validazione automatica: le citazioni inesistenti vengono rifiutate o segnalate.

**Criterio di accettazione.** Nessun punto senza fonte; clic sulla citazione → blocco evidenziato e audio dal secondo corretto.

#### 9. Highlight automatici 🚧

**Cosa.** Proposta di decisioni, azioni, domande aperte e passaggi chiave, sempre verificabili.

**Perché.** Riduce il tempo di scansione e rende visibili elementi che durante la sessione sono passati inosservati.

**Come.** Classificazione o prompt locale sui blocchi con schema tipizzato (`decision`, `action`, `question`, `key_point`), confidenza e link al blocco. Le proposte sono modificabili e dismissibili.

**Criterio di accettazione.** Ogni highlight ha tipo, confidenza e blocco sorgente; l'utente può accettare, modificare o scartare; nessun highlight senza evidenza testuale.

### C. Ricerca e riascolto

#### 10. Ricerca full-text ✅/🚧

**Cosa.** SQLite + FTS5 per trovare parole, speaker, argomenti e momenti dell'audio.

**Perché.** La ricerca attuale è una sottostringa su `transcript.txt`: funziona su piccoli archivi, ma non scala a migliaia di sessioni e non gestisce ranking, stemming, frasi o filtri per speaker.

**Come.** Indice SQLite FTS5 ricostruibile dai file (il filesystem resta la fonte di verità), tokenizer adatto all'italiano, ranking BM25, filtri per gruppo, speaker e data, risultati con snippet e timestamp. Migrazione e re-index automatici.

**Criterio di accettazione.** Query full-text su 1.000 ore in meno di 100 ms; risultati cliccabili che aprono il punto audio; indice ricostruibile senza perdita di dati.

#### 11. Riproduzione dal transcript ✅/🚧

**Cosa.** Clic sul timestamp per ascoltare il passaggio originale.

**Perché.** Consente la verifica immediata: la trascrizione diventa un indice dell'audio, non un riassunto separato.

**Come.** Dalla v1.1.0 i timestamp sono cliccabili e attivabili da tastiera: il player salta al secondo esatto. Restano l'evidenziazione del segmento in riproduzione e l'auto-scroll opzionale.

**Criterio di accettazione.** Clic su un timestamp → il player salta al secondo esatto e riproduce; il segmento attivo è evidenziato. Il seek è soddisfatto; l'evidenziazione è in roadmap.

#### 12. Architettura Apple Silicon ✅

**Cosa.** whisper.cpp con Metal/Core ML per la trascrizione locale e, in prospettiva, diarizzazione locale.

**Perché.** È il fondamento della proposta: prestazioni da GPU e privacy nello stesso prodotto.

**Come.** Già implementato per l'ASR (Metal, FP16, memoria unificata). La diarizzazione locale sarà aggiunta come secondo motore, con backend Metal dove disponibile e fallback CPU.

**Criterio di accettazione.** Trascrizione completa senza rete; nessun audio inviato all'esterno; utilizzo GPU osservabile e nessuna dipendenza cloud.

### D. Audio, privacy, modelli e piattaforme

#### 13. Privacy offline ✅

**Cosa.** Audio, transcript, speaker e note restano sul dispositivo; nessun invio obbligatorio al cloud.

**Perché.** È un requisito di prodotto, non un dettaglio di comunicazione.

**Come.** Storage locale, nessuna telemetria, rete solo per modelli e aggiornamenti. Le funzioni future (diarizzazione, sintesi) dovranno rispettare lo stesso vincolo: modelli locali o nessuna funzione.

**Criterio di accettazione.** Con rete disattivata, registrazione, trascrizione, consultazione ed export funzionano; un'analisi del traffico non mostra contenuti utente.

#### 14. Modalità doppia audio 🚧

**Cosa.** Microfono e audio di sistema per meeting e lezioni online, così da distinguere partecipanti e contenuto condiviso.

**Perché.** Nelle sessioni online la voce dei partecipanti e l'audio della call arrivano da sorgenti diverse: catturarle separatamente migliora trascrizione, diarizzazione e attribuzione.

**Come.** Due tracce sincronizzate (microfono e sistema) con timestamp comune, mix opzionale per l'ASR e tracce separate per la diarizzazione. Su macOS: ScreenCaptureKit / Core Audio tap. Su Windows: WASAPI loopback. Su Linux: PipeWire/PulseAudio monitor. Richiede gestione di drift, eco e permessi.

**Criterio di accettazione.** Le due sorgenti restano sincronizzate per un'ora; l'utente può ascoltare l'una o l'altra; il transcript indica la sorgente; nessuna dipendenza cloud.

#### 15. Modelli selezionabili 🚧

**Cosa.** `large-v3-turbo` predefinito per velocità, `large-v3` opzionale per la massima accuratezza.

**Perché.** Utenti e hardware diversi hanno compromessi diversi; la scelta deve essere esplicita.

**Come.** Impostazioni con modello ASR, modello di traduzione, backend (Metal/CPU), lingua e thread; download su richiesta con dimensione stimata e spazio libero; verifica di integrità; fallback se il modello non è compatibile con la RAM disponibile.

**Criterio di accettazione.** Il cambio modello è persistente; l'app mostra sempre quale modello sta usando; un modello mancante non blocca le altre funzioni.

---

## Avvio rapido e build

### Sviluppo

```bash
# 1. Dipendenze
npm install

# 2. Avvio in sviluppo
npm start
```

Al primo avvio Crunch crea `~/CrunchRecordings/` ma **non scarica alcun modello**. Il download di `ggml-large-v3-turbo.bin` (≈1,5 GB) viene proposto alla prima trascrizione e quello di `ggml-medium.bin` (≈1,4 GB) alla prima traduzione.

### Compilare whisper.cpp con Metal

```bash
npm run build-whisper
```

Lo script:

- clona `ggerganov/whisper.cpp` in `/tmp/whisper.cpp` (se assente);
- esegue il checkout del commit verificato `482279b8a18855ba741d7b88c30fcb3874691f59`;
- configura CMake con `GGML_METAL=ON` e `CMAKE_OSX_ARCHITECTURES=arm64`;
- compila in Release e copia il binario in `bin/whisper-cli`.

Per usare un commit diverso: `WHISPER_REF=<sha> npm run build-whisper`.

### Build dell'applicazione

```bash
npm run build        # DMG + ZIP arm64 in dist/
npm run build:dir    # solo .app, senza installer
npm run install:app  # copia Crunch.app in /Applications
```

L'app pacchettizzata include `bin/` come `extraResources`: `whisper-cli`, `whisper-server` e le librerie `libggml`/`libwhisper` sono dentro il bundle. Lo script di build imposta il rpath a `@executable_path`, così i binari non dipendono da `/tmp/whisper.cpp` e funzionano anche su un Mac dove il sorgente non è presente.

### Struttura di una release

- `Crunch-<versione>-arm64.dmg` — installazione guidata.
- `Crunch-<versione>-arm64-mac.zip` — usata dall'updater interno.
- `latest-mac.yml` — metadati per `electron-updater`.
- Gli asset vengono pubblicati su GitHub Releases (`IC3NBERG/Memo`).

Vedi `RELEASE_WORKFLOW.md` per la procedura operativa completa.

---

## Dati utili

### Formati e prestazioni

| Voce | Valore |
|---|---|
| Sample rate | 16.000 Hz |
| Canali | 1 (mono) |
| Formato registrazione | WAV PCM 16 bit |
| Formato intermedio | WebM/Opus (MediaRecorder) |
| Spazio audio | ≈115 MB per ora (16 kHz × 16 bit × 3600 s) |
| Modello trascrizione | ≈1,5 GB |
| Modello traduzione | ≈1,4 GB |
| Thread CPU ASR | 4 |
| Prima anteprima live | 3,5 s |
| Finestra live | 8 s con 2 s di sovrapposizione |
| Aggiornamento live | ogni 2,5 s all'inizio, poi ogni 6 s |
| Soglia silenzio live | −45 dB RMS, misurata prima dell'AGC |
| Durata minima chunk | 0,5 s |
| Accuratezza trascrizione live | parziale, sostituita dalla completa |
| Accuratezza trascrizione completa | riferimento, segmenti con timestamp |
| Backend | whisper-server persistente + fallback whisper-cli, Metal (arm64) |
| Rete richiesta | solo download modelli e aggiornamenti |

### Benchmark della trascrizione live

Lo script `scripts/benchmark-live.mjs` (`npm run benchmark-live`) simula la finestra mobile, trascrive ogni chunk con `whisper-cli` e confronta il testo unito con la trascrizione integrale dello stesso file. Misura il **WER** (word error rate) e la latenza media per chunk.

```bash
npm run benchmark-live -- \
  --audio "$HOME/CrunchRecordings/_unsorted/test/audio.wav" \
  --model "$HOME/CrunchRecordings/.models/ggml-large-v3-turbo.bin" \
  --language it --windows 3.5,8,10 --overlaps 0,2
```

Risultato su una registrazione di prova di 72 s (italiano, `large-v3-turbo`, M4):

| Finestra | Overlap | Chunk | Latenza media | WER |
|---|---|---|---|---|
| **8 s** | **2 s** | 12 | 1,93 s | **6,2%** |
| 10 s | 0 s | 8 | 2,04 s | 7,3% |
| 8 s | 0 s | 9 | 1,82 s | 9,6% |
| 3,5 s | 0 s | 21 | 1,62 s | 12,4% |
| 10 s | 2 s | 9 | 1,89 s | 17,4% |
| 3,5 s | 2 s | 48 | 1,77 s | 19,7% |

La configurazione scelta per l'app è **8 s con 2 s di overlap**: è la più accurata e mantiene la latenza sotto i 2 s per chunk. Il WER resta un indicatore relativo: la trascrizione completa sul WAV originale è comunque il riferimento.

### Comandi IPC principali

| Canale | Tipo | Funzione |
|---|---|---|
| `recording:save` | invoke | salva WAV e metadata v2, con anti-collisione |
| `recording:move` / `rename` / `delete` | invoke | gestione registrazioni |
| `transcription:start` | send | trascrizione completa, pubblicata come nuova revisione |
| `transcription:prewarm` | invoke | carica il modello live nel server persistente |
| `transcription:chunk` | invoke | chunk PCM con timestamp, prompt e lingua bloccata |
| `transcript:read` / `save` / `export` | invoke | legge la revisione attiva, salva l'overlay, esporta |
| `library:get` | invoke | ricostruisce la libreria dal filesystem |
| `folder:create` / `rename` / `delete` | invoke | gestione gruppi |
| `model:check` / `download` | invoke/send | modello ASR |
| `model:check-translation` / `download-translation` | invoke/send | modello traduzione |
| `audio:get-path` | invoke | URL `file://` per il player |
| `app:check-for-updates` / `restart-and-install` | invoke | aggiornamenti |

### Flag di whisper-cli utilizzati

```text
--model <path>          modello GGML
--file <audio.wav>      input
--output-file <prefix>  prefisso output
--output-json           segmenti con offset (trascrizione completa)
--output-txt            testo semplice
--print-progress        progresso in UI
--threads 4             thread CPU
--language auto         rilevamento lingua
--translate             solo con modello medium
--output-json-full      parole con timestamp (chunk live)
--prompt <testo>        contesto breve tra chunk
--suppress-nst          riduce i token non-parlato
--no-speech-thold 0.6   soglia anti-allucinazione
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
| Preprocessing on/off | pillole Passa-alto / Noise Gate / Compressore / Auto-Gain in basso a destra |
| Pausa / riprendi | pulsante centrale durante la registrazione |
| Termina e salva | pulsante centrale "Termina" |
| Torna alla registrazione in corso | pill REC flottante o pulsante REC |
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
| "Modello Whisper non trovato" | download non ancora eseguito | avviare una trascrizione e accettare il download; verificare `~/CrunchRecordings/.models/` |
| "Modello di traduzione non trovato" | `ggml-medium.bin` assente | avviare una traduzione e accettare il download |
| "whisper-cli non trovato" | build nativa assente | eseguire `npm run build-whisper` |
| Nessun audio o trascrizione vuota | permesso microfono negato | Impostazioni di Sistema → Privacy → Microfono |
| App bloccata da Gatekeeper | build non firmata | tasto destro → Apri, oppure usare l'updater interno |
| Trascrizione lenta | modello grande, GPU occupata, batteria | chiudere applicazioni pesanti, mantenere il Mac alimentato |
| Testo live impreciso | rumore, voce lontana o lingua instabile | l'anteprima è parziale per definizione; la trascrizione completa sul WAV è il riferimento |

---

## Limiti attuali

- Disponibile solo per **macOS Apple Silicon**; Windows e Linux sono pianificati ma non ancora rilasciati.
- **Nessuna diarizzazione**: non sono presenti etichette Speaker A/B.
- **Nessun riconoscimento persistente** delle voci.
- **Nessuna gestione delle sovrapposizioni**: il testo può risultare ambiguo quando due persone parlano insieme.
- L'editor è **testuale** (`contenteditable`), non ancora a blocchi non distruttivi. La sorgente della revisione resta immutata: il testo riscritto finisce nell'overlay come `legacyDocumentText`, in attesa dell'editor a blocchi.
- I **timestamp sono cliccabili solo per le revisioni con timing per segmento**; anteprime live e trascrizioni legacy mostrano il solo testo.
- La ricerca è per sottostringa, **non ancora FTS5**.
- **Nessuna cattura dell'audio di sistema**: è supportato solo il microfono.
- **Nessuna sintesi automatica** e nessun highlight.
- Un solo modello ASR alla volta; `large-v3` non è ancora selezionabile.
- I file **non sono cifrati at-rest**: la privacy dipende dai permessi del Mac e dal backup.

Queste assenze sono deliberate e tracciate: la roadmap costituisce la lista delle prossime iterazioni.

---

## FAQ

**Crunch invia l'audio a un server?**
No. L'inferenza avviene in locale con whisper.cpp. La rete serve solo per scaricare i modelli e controllare gli aggiornamenti.

**Serve una connessione a internet per usarlo?**
Solo per il primo download dei modelli, quando richiedi la prima trascrizione o la prima traduzione. All'avvio non viene scaricato nulla: successivamente l'app funziona offline.

**Posso usarlo su un Mac Intel?**
No: la build è arm64 e il motore è compilato per Apple Silicon. Il supporto ad altre architetture non è in roadmap a breve.

**Quanto spazio occupa un'ora di audio?**
Circa 115 MB, più la trascrizione (pochi MB).

**La trascrizione live è definitiva?**
No, è un'anteprima. La trascrizione completa sul WAV originale è quella di riferimento e sostituisce l'anteprima.

**Posso tradurre in francese o spagnolo?**
Non oggi: Whisper supporta nativamente la traduzione solo verso l'inglese. Il modello `medium` è dedicato a questo compito.

**I miei dati sono al sicuro se disinstallo l'app?**
Le registrazioni risiedono in `~/CrunchRecordings/` e non vengono cancellate dalla disinstallazione. È comunque necessario un backup: i file non sono cifrati.

**Posso spostare l'archivio su un altro Mac?**
Sì: copiare `~/CrunchRecordings/` e i modelli in `.models/`, oppure lasciare che vengano riscaricati.

**Perché due modelli da 1,4–1,5 GB?**
Perché la traduzione richiede un modello addestrato al task `translate`; il modello di trascrizione non è adatto. Il secondo viene scaricato solo se richiesto.

**Crunch è adatto a un uso professionale?**
Sì, per documentazione locale di riunioni, interviste e formazione, nel rispetto degli obblighi di informativa e consenso. Le funzioni di sintesi e diarizzazione sono in roadmap; oggi il prodotto è un trascrittore e archivio locale affidabile, non un sistema di verbalizzazione automatica completo.

**Quando arriveranno Windows e Linux?**
Non ci sono date annunciate. La direzione è impegnativa e l'architettura è già predisposta; vedi [Piattaforme e promessa cross-platform](#piattaforme-e-promessa-cross-platform).

---

## Crediti

- **[whisper.cpp](https://github.com/ggerganov/whisper.cpp)** e **ggml** — inferenza locale efficiente.
- **OpenAI Whisper** — architettura e pesi del modello.
- **Electron** — runtime desktop cross-platform.
- **electron-builder** / **electron-updater** — packaging e aggiornamenti.

---

<p align="center"><strong>Crunch</strong> — la conoscenza resta sul dispositivo. E resta verificabile.</p>
