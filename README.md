# 🎙️ Memo

App macOS per registrare e trascrivere lezioni universitarie. Electron + whisper.cpp (Metal).

## Avvio rapido (sviluppo)

```bash
npm start
```

## Setup produzione: compila whisper-cli reale

```bash
# Installa cmake se non presente
brew install cmake

# Compila whisper.cpp con Metal (GPU Apple Silicon M4)
npm run build-whisper
```

Dopo la compilazione, in `bin/whisper-cli` troverai il vero binario accelerato Metal.  
Al primo avvio dell'app, il modello `large-v3-turbo` (≈1.5 GB) verrà scaricato automaticamente.

## Build DMG finale

```bash
npm run build
```

Il DMG sarà in `dist/`.

## Struttura

```
Memo/
├── src/
│   ├── main/
│   │   ├── main.js       ← Processo principale Electron
│   │   └── preload.js    ← Bridge sicuro IPC
│   └── renderer/
│       ├── index.html    ← UI principale
│       ├── style.css     ← Design premium dark warm
│       └── app.js        ← Logica UI completa
├── assets/
│   ├── icons/            ← Icona app
│   └── entitlements.mac.plist
├── bin/
│   └── whisper-cli       ← Binario whisper.cpp (compilare con build-whisper)
└── scripts/
    ├── build-whisper.sh  ← Compila whisper.cpp con Metal
    └── generate-icon.sh  ← Genera icona .icns
```

## File salvati

```
~/MemoRecordings/
├── .models/
│   └── ggml-large-v3-turbo.bin   ← Modello AI (auto-download)
├── Analisi Matematica/
│   └── 2024-11-02_Lezione/
│       ├── audio.wav
│       ├── transcript.json
│       ├── transcript.txt
│       └── metadata.json
└── _unsorted/                     ← Non categorizzate
```

