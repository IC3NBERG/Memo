# Privacy operativa

Questo documento descrive cosa fa Crunch con i dati, dove li conserva, per
quanto tempo e come si cancellano. È la fonte di verità per le scelte di
prodotto su privacy, retention, voiceprint, macchine condivise e diagnostica.

Ultimo aggiornamento: versione 1.2.0.

---

## 1. Inventario dei dati

| Dato | Percorso | Contenuto | Derivato o fonte |
|---|---|---|---|
| Audio | `~/CrunchRecordings/<Gruppo>/<Registrazione>/audio.wav` | Voce e suoni ambientali | Fonte |
| Metadati | `.../metadata.json` | Nome, data, durata, revisione attiva | Fonte |
| Trascrizioni | `.../.revisions/rN/transcript.json` | Testo, segmenti, timestamp, speaker | Fonte |
| Overlay di editing | `.../.revisions/rN/edits.json` | Correzioni, blocchi nascosti, tag, note | Fonte |
| Manifest | `.../manifest.json` | Checksum SHA-256/512 dei file | Derivato |
| Cestino | `~/CrunchRecordings/.trash/` | Registrazioni eliminate, recuperabili | Fonte |
| Indice di ricerca | `~/CrunchRecordings/.index/search.sqlite3` | Copia indicizzata di nomi e testi | Derivato, ricostruibile |
| Impostazioni privacy | `~/CrunchRecordings/privacy.json` | Retention, consenso voiceprint, livello log | Fonte |
| Log diagnostici | `~/CrunchRecordings/.logs/` | Eventi tecnici senza contenuti utente | Derivato |
| Modelli AI | `~/CrunchRecordings/.models/` | Pesi Whisper | Riscaricabili |
| Blocco applicativo | `~/Library/Application Support/Crunch/privacy-lock.json` | Hash scrypt del codice, opzioni | Fonte, fuori archivio |
| Preferenze e cache update | `~/Library/Application Support/Crunch/` | Finestra, updater, preferenze | Locale |

Non esistono account, telemetria, sincronizzazione o upload automatico.

---

## 2. Cifratura a riposo

**Crunch non cifra i file dell'archivio.** Audio, trascrizioni, metadati,
indice e backup sono leggibili da qualunque processo con i permessi
dell'utente macOS. È una scelta dichiarata, non una svista: la cifratura
trasparente dei WAV e delle revisioni richiederebbe chiavi, migrazione dei
dati e un impatto diretto su playback, Whisper ed export.

Misure raccomandate e supportate dal sistema:

- attivare **FileVault** sul Mac: cifra l'intero disco a riposo;
- proteggere l'account macOS con password e blocco schermo;
- non archiviare `~/CrunchRecordings/` in servizi cloud non cifrati;
- usare backup cifrati (Time Machine cifrato o equivalenti);
- se serve riservatezza anche da altri processi dello stesso utente, usare
  un volume cifrato dedicato e impostare `CRUNCH_RECORDINGS_DIR` su quel
  volume.

La cifratura applicativa è un lavoro separato: non è simulata e non viene
dichiarata come disponibile.

---

## 3. Retention e cancellazione

Le soglie si impostano da **Privacy → Conservazione e cancellazione** e sono
salvate in `privacy.json`.

| Impostazione | Default | Comportamento |
|---|---|---|
| Cestino | 30 giorni | Gli elementi nel cestino più vecchi vengono eliminati definitivamente. `0` = mai. |
| Registrazioni | mai (`0`) | Le registrazioni più vecchie vengono **spostate nel cestino**, non cancellate. Da lì seguono la retention del cestino. |

La policy viene applicata:

- all'avvio dell'app;
- manualmente con **Applica ora**;
- con **Anteprima** è possibile vedere quanti elementi sarebbero coinvolti
  senza modificare nulla.

La cancellazione è a doppia soglia: prima la registrazione esce dalla
libreria e finisce nel cestino, poi il cestino scade. Nessuna registrazione
viene eliminata direttamente dalla retention delle registrazioni.

L'eliminazione manuale di una nota la sposta nel cestino. L'eliminazione
definitiva avviene solo dal cestino, con conferma esplicita.

---

## 4. Export completo

Da **Privacy → Archivio** è possibile esportare un archivio `.zip` con:

- gruppi, registrazioni, audio, metadati, revisioni, overlay, manifest e cestino;
- `privacy.json` (retention e consenso voiceprint);
- eventuali altri file presenti nell'archivio.

Sono esclusi per default:

- `.index/` (ricostruibile);
- `.logs/` (diagnostica, non contenuto);
- `.models/` (≈1,5 GB, riscaricabili). L'inclusione è un'opzione esplicita.

La destinazione deve essere scelta fuori da `~/CrunchRecordings/`. L'export
non modifica l'archivio e non richiede rete.

---

## 5. Eliminazione completa

**Privacy → Archivio → Elimina archivio** richiede di digitare `ELIMINA`.
Vengono rimossi:

- tutte le registrazioni e i gruppi;
- audio, trascrizioni, revisioni, overlay e manifest;
- cestino, indice di ricerca e log;
- qualunque altro file nell'archivio.

Restano, per scelta:

- `privacy.json`, perché contiene solo preferenze operative;
- `.models/`, salvo inclusione esplicita;
- `privacy-lock.json` in Application Support, perché è il blocco applicativo
  e non un dato dell'archivio.

Al termine l'app ricostruisce un archivio vuoto e si ricarica. L'operazione è
irreversibile e non viene eseguita in background.

---

## 6. Cosa resta dopo la disinstallazione

Disinstallare l'app (trascinando `Crunch.app` nel cestino) **non elimina i
dati**. Restano:

- `~/CrunchRecordings/`: audio, trascrizioni, revisioni, cestino, indice,
  log, modelli e `privacy.json`;
- `~/Library/Application Support/Crunch/`: preferenze, cache aggiornamenti e
  `privacy-lock.json`;
- eventuali backup di macOS o di altri strumenti;
- eventuali copie esportate dall'utente.

Per una rimozione completa: usare **Elimina archivio** prima di disinstallare,
poi cancellare `~/Library/Application Support/Crunch/` e le copie di backup.
La stessa lista è mostrata nell'app.

---

## 7. Voiceprint e consenso

Il riconoscimento vocale persistente **non è ancora disponibile**. Crunch non
crea, non salva e non confronta impronte vocali in questa versione.

Il modello di consenso è già definito in `privacy.json`:

```json
{
  "voiceprint": {
    "enabled": false,
    "consentVersion": null,
    "grantedAt": null,
    "revokedAt": null,
    "scope": "local-only"
  }
}
```

Regole:

- il consenso è **esplicito**, mai preselezionato;
- è revocabile in qualunque momento; la revoca registra `revokedAt` e
  disattiva `enabled`;
- lo scope è `local-only`: nessun voiceprint può lasciare il Mac;
- quando la funzione sarà attiva, ogni voiceprint dovrà essere cancellabile
  singolarmente e in blocco, e la revoca dovrà implicare la cancellazione
  delle impronte esistenti;
- l'associazione automatica sarà sempre una proposta confermabile, mai
  un'etichettatura imposta;
- il voiceprint è un dato biometrico: richiede una base giuridica e
  un'informativa adeguate nel contesto d'uso.

Il consenso registrato ora non attiva nulla: serve a rendere esplicito il
passaggio quando la funzione verrà introdotta.

---

## 8. Macchine condivise

Il **blocco applicativo** copre l'interfaccia:

- all'avvio, se un codice è impostato;
- alla perdita di fuoco, se l'opzione è attiva;
- dopo N minuti di inattività (default 5);
- manualmente con **Blocca ora**.

Il codice è salvato come hash **scrypt** con salt casuale in
`~/Library/Application Support/Crunch/privacy-lock.json`; non è mai scritto
in chiaro e non entra nell'export dell'archivio. Dopo 5 tentativi errati il
blocco viene sospeso per 30 secondi.

Limiti dichiarati:

- il blocco è un controllo dell'interfaccia, non una cifratura: chi ha
  accesso al filesystem può leggere i file;
- non sostituisce l'account macOS né FileVault;
- non protegge da un processo malevolo avviato dallo stesso utente.

Per una macchina condivisa usare account macOS separati (o utente ospite),
FileVault e, se necessario, un volume cifrato per l'archivio.

---

## 9. Diagnostica e log

I log sono **JSON Lines** in `~/CrunchRecordings/.logs/crunch.log`, con
livelli `debug`, `info`, `warn`, `error`. La rotazione è a 2 MB per file, con
un massimo di 4 file (corrente + 3 ruotati).

Contenuto dei log:

- timestamp, livello ed evento;
- versioni, piattaforma, codici di errore e metriche;
- mai audio, nomi delle note, trascrizioni, testi, annotazioni o snippet.

Il logger redige automaticamente le chiavi sensibili (`transcript`, `text`,
`content`, `note`, `audio`, `body`, `snippet`, `filepath`, `path`, `name`,
`title`, `speaker`, `voiceprint`) e tronca le stringhe lunghe. La diagnostica è
best-effort: un errore di scrittura non blocca l'app.

Il pannello **Diagnostica** mostra ambiente, percorsi, dimensioni, stato
dell'integrità, retention, voiceprint, blocco e gli ultimi eventi. **Copia
report** mette negli appunti un report testuale pensato per l'assistenza. Il
report non viene inviato da solo: nessuna telemetria, nessun upload.
Dell'integrità riporta solo lo stato aggregato (registrazioni, errori,
avvisi), mai i nomi delle note o i percorsi delle singole registrazioni.

I log possono essere cancellati con **Elimina archivio** o rimossi a mano.
Non contengono contenuti, ma possono contenere percorsi e codici di errore:
condividili solo con chi presta assistenza.

---

## 10. Conformità e uso responsabile

- Registrare lezioni, riunioni e colloqui può coinvolgere voci e dati di
  terzi: informare i partecipanti e scegliere la base giuridica spetta
  all'utente.
- La minimizzazione è supportata da retention e cestino; la cancellazione
  completa da **Elimina archivio**.
- I diritti di accesso e portabilità sono supportati dall'export completo.
- I dati restano locali: non c'è un responsabile del trattamento remoto.
- In UE, per il voiceprint servirà un consenso esplicito e una valutazione
  d'impatto adeguata prima dell'attivazione.

Questa documentazione descrive il comportamento del software, non sostituisce
una consulenza legale.
