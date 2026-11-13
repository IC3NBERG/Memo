# Changelog

Tutte le modifiche rilevanti di Crunch. Il formato segue
[Keep a Changelog](https://keepachangelog.com/it/1.1.0/) e il versioning
[Semantic Versioning](https://semver.org/lang/it/).

## [1.3.0] - 2026-11-13

### Novità
- **aggiornamenti:** eliminazione automatica e completa di tutti gli installer (`.zip`, `.sig`, `.part`), file temporanei e backup post-installazione; pulizia della cache all'avvio dell'applicazione.
- **sistema:** risoluzione della duplicazione di Crunch in Spotlight e Launchpad eliminando le cartelle di estrazione orfane in `$TMPDIR` e bloccando l'indicizzazione delle cartelle di build.
- **privacy:** retention configurabile con anteprima e applicazione all'avvio, consenso voiceprint esplicito e revocabile, blocco applicativo per macchine condivise con hash scrypt.
- **privacy:** export `.zip` completo dell'archivio ed eliminazione totale con conferma digitata.
- **diagnostica:** logger JSON Lines con livelli, redazione delle chiavi sensibili e rotazione 2 MB × 4; pannello diagnostica con ambiente, percorsi, archivio, integrità aggregata, privacy e copia del report.
- **integrità:** manifest SHA-256 e SHA-512 per registrazione con scansione non invasiva e cestino con ripristino.

### Documentazione
- Pulizia completa delle versioni dal README a favore del CHANGELOG.
- Aggiunge `docs/PRIVACY.md` e linee guida di release sicure.

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
