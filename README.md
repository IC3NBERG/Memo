# 🎙️ Crunch

App nativa macOS per registrare, visualizzare e trascrivere lezioni universitarie con accelerazione Metal su Apple Silicon.

## Caratteristiche principali

- **Trascrizione Live istantanea (3.5s)**: campionamento continuo durante la lezione con GPU Apple Metal.
- **Verifica Completa 100%**: elaborazione ad alta precisione post-lezione del file WAV originale per non perdere alcuna parola o formula.
- **Traduzione Automatica in Inglese**: motore neurale Whisper multilingua con rilevamento automatico della lingua.
- **Organizzazione a Gruppi**: catalogazione note per materia o progetto con ricerca istantanea.
- **Privacy Totale**: 100% locale e offline in `~/CrunchRecordings/`.

## Avvio rapido (sviluppo)

```bash
npm start
```

## Setup produzione: compila whisper-cli con Metal

```bash
# Compila whisper.cpp con Metal (GPU Apple Silicon)
npm run build-whisper
```

Il binario compilato risiede in `bin/whisper-cli`.  
Al primo avvio, il modello `large-v3-turbo` (≈1.5 GB) viene scaricato automaticamente.

## Build DMG e App

```bash
npm run build
```

Il pacchetto installabile DMG e l'app `Crunch.app` vengono generati in `dist/`.
