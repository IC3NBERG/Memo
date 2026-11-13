# Formato dati di Crunch

Questo documento descrive il contratto dati dell'archivio locale. La fonte di
verità resta il filesystem: i file JSON sono l'archivio, non un database.

## Versioni

Le versioni sono indipendenti per tipo di documento.

| File | `schemaVersion` |
|---|---:|
| `metadata.json` | 2 |
| `.revisions/rN/transcript.json` | 2 |
| `.revisions/rN/edits.json` | 1 |
| `manifest.json` | 1 |
| `.trash/<id>/.trash-entry.json` | 1 |
| `.index/search.sqlite3` | `PRAGMA user_version = 2` |

Ogni documento è versionato in modo indipendente. L'app:

- migra le versioni precedenti supportate (v1 → v2) in modo lazy e con backup;
- legge e scrive la versione corrente;
- apre in **sola lettura** una versione futura se i campi noti restano validi;
- rifiuta senza toccare i file una versione futura con struttura nota non valida.

In nessun caso una versione futura viene degradata o riscritta. Il dettaglio
della politica è in [Compatibilità e versioni future](#compatibilità-e-versioni-future).

## Layout di una registrazione

```text
<archivio>/<gruppo>/<registrazione>/
  audio.wav
  metadata.json                  # commit marker, activeRevisionId
  .revisions/
    r1/
      transcript.json            # sorgente canonica
      edits.json                 # overlay canonico
    r2/
      transcript.json
      edits.json
  transcript.json                # copia derivata della revisione attiva
  transcript.edits.json          # copia derivata dell'overlay attivo
  transcript.txt                 # derivato dal testo effettivo
  manifest.json                  # inventario con checksum SHA-256/SHA-512
  .backup-v1/                    # backup della migrazione v1, mai auto-cancellato
  .tmp-*                         # staging temporaneo, non è dato utente
```

Le copie nella root della registrazione sono di compatibilità e possono essere
rigenerate. Non sono mai la sorgente. La revisione attiva è indicata da
`metadata.activeRevisionId`.

Il cestino vive fuori dai gruppi:

```text
<archivio>/
  .trash/
    <timestamp>__<uuid>/
      .trash-entry.json          # metadati di ripristino, non è dato utente
      audio.wav
      metadata.json
      …
```

## ID

- Revisione: `r1`, `r2`, … monotono per registrazione.
- Segmento: `${revisionId}-s${indice}`, con indice **1-based** a 4 cifre:
  `r2-s0001`, `r2-s0014`.
- Gli array JavaScript restano 0-based; l'1-based è solo nell'ID.

Whisper non è deterministico tra esecuzioni: una nuova trascrizione è una nuova
revisione con nuovi ID. Le revisioni precedenti restano in `.revisions/` e non
vengono cancellate.

## `metadata.json` v2

Campi principali:

```json
{
  "schemaVersion": 2,
  "id": "uuid",
  "createdAt": "2025-01-02T10:00:00.000Z",
  "updatedAt": "2025-01-02T10:00:00.000Z",
  "name": "Lezione",
  "date": "2025-01-02T10:00:00.000Z",
  "folder": "Università",
  "duration": 123.4,
  "hasTranscript": true,
  "isCompleteTranscript": true,
  "isLivePreview": false,
  "isTranslated": false,
  "activeRevisionId": "r2",
  "revisions": [
    {
      "revisionId": "r1",
      "kind": "livePreview",
      "createdAt": "2025-01-02T10:00:00.000Z",
      "complete": false,
      "translated": false,
      "model": null,
      "language": null,
      "targetLanguage": null,
      "timing": "whole-recording"
    }
  ],
  "previewReplacedAt": "2025-01-02T10:05:00.000Z"
}
```

`metadata.json` è scritto per ultimo durante la migrazione: è il commit marker.
Finché è v1, la registrazione è v1.

`speaker` (stringa) e `speakers` (array di stringhe) sono campi opzionali usati
per il filtro speaker della ricerca quando la diarizzazione o un'annotazione
manuale forniscono le etichette. Non sono obbligatori e la migrazione non li
inventa.

## `transcript.json` v2

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
    "format": "v1-json",
    "createdAt": "2025-01-02T10:05:00.000Z"
  },
  "segments": [
    {
      "id": "r2-s0001",
      "start": 0,
      "end": 2.4,
      "text": "Testo originale."
    }
  ]
}
```

- `kind`: `transcription`, `translation`, `livePreview`.
- `source.timing`:
  - `segment`: timestamp per segmento affidabili (Whisper normale/tradotto);
  - `whole-recording`: solo la durata complessiva è nota (live preview,
    legacy-txt). La UI non deve abilitare seek o timestamp cliccabili per
    segmento.
- `source.model`, `source.language`, `source.engine` possono essere `null` se la
  v1 non li tracciava. La migrazione non inventa valori.
- Un segmento può avere un campo opzionale `speaker` (stringa). È preservato
  dalla normalizzazione e usato dall'indice per il filtro speaker; la
  diarizzazione automatica non è ancora implementata.
- I segmenti sono immutabili dopo la creazione della revisione.

## `edits.json` v1

```json
{
  "schemaVersion": 1,
  "revisionId": "r2",
  "sourceHash": "sha256:...",
  "editRevision": 3,
  "segmentText": {
    "r2-s0001": "Testo corretto."
  },
  "hiddenSegmentIds": ["r2-s0002"],
  "tags": {
    "r2-s0001": ["importante"]
  },
  "annotations": {
    "r2-s0001": [
      { "id": "a1", "text": "Da rivedere", "createdAt": "2025-01-02T10:06:00.000Z" }
    ]
  },
  "order": ["r2-s0001", "r2-s0002"],
  "groups": [
    { "id": "g1", "title": "Introduzione", "segmentIds": ["r2-s0001"] }
  ]
}
```

- `sourceHash` è lo SHA-256 dei byte della sorgente canonica. Se non combacia,
  l'overlay è `stale`: non viene applicato e resta in sola lettura. Azioni
  previste: scartarlo oppure riportarlo sulla revisione corrente per
  sovrapposizione temporale, con conferma dell'utente.
- `editRevision` è il contatore per il salvataggio ottimistico.
- `order` può essere parziale: gli ID mancanti vanno in coda nell'ordine della
  sorgente. Duplicati e ID sconosciuti vengono ignorati e segnalati.
- I gruppi sono raccolte nominate; un segmento può stare in più gruppi. ID
  orfani vengono ignorati e segnalati.
- `legacyDocumentText` è un campo temporaneo di compatibilità con il vecchio
  editor contenteditable: conserva il testo completo modificato quando non è
  riconducibile ai segmenti. La UI lo mostra in modalità dedicata e offre solo
  due azioni esplicite: applicarlo all'unico segmento (se ce n'è uno) oppure
  creare una nuova revisione dal testo; "ripristina segmenti originali" rimuove
  il campo. Non viene mai applicato implicitamente alla sorgente.
- "Ripristina vista originale" (`edits:reset`) svuota l'intero overlay della
  revisione attiva: `segmentText`, `hiddenSegmentIds`, `tags`, `annotations`,
  `order`, `groups` e `legacyDocumentText`. Incrementa `editRevision` e
  riscrive le copie derivate; la sorgente non viene toccata. Se l'overlay era
  `stale` o `invalid`, viene scartato e sostituito da uno vuoto allineato alla
  sorgente corrente.

## Proiezione effettiva

Testo e segmenti effettivi si ottengono da:

1. sorgente;
2. override testuali per ID;
3. rimozione dei segmenti nascosti;
4. ordine `order`, con ID mancanti in coda.

`transcript.txt`, export e indice di ricerca usano la proiezione effettiva.

L'indice FTS5 vive fuori dalla registrazione, in `<archivio>/.index/`, perché è
condiviso dall'intero archivio.

## Stato dell'overlay

La vista espone `editsStatus`:

- `ok`: overlay assente o allineato; il testo è modificabile.
- `stale-edits`: `sourceHash` non combacia con la sorgente; l'overlay non viene
  applicato e la UI apre la revisione in sola lettura, proponendo la ricarica.
- `invalid-edits`: schema o riferimenti non validi; stesso trattamento, senza
  scritture automatiche.

Non esiste merge automatico. Il salvataggio overlay è ottimistico su
`editRevision`: se il contatore atteso non coincide, la richiesta fallisce con
`edit-revision-mismatch` e la UI invita a ricaricare.

## Migrazione v1 → v2

- Lazy, per singola registrazione, all'apertura o all'indicizzazione.
- Backup in `.backup-v1/`, portabile e mai cancellato automaticamente.
- Scrittura atomica; `metadata.json` v2 scritto per ultimo.
- Se file v2 esistono ma `metadata` è ancora v1, la migrazione era interrotta:
  si recupera da `.backup-v1` e si riprova. Senza backup si rifiuta l'apertura.
- Mappatura:
  - `isLivePreview` → `kind: "livePreview"`;
  - altrimenti `isTranslated` → `kind: "translation"` con
    `targetLanguage: "en"`;
  - altrimenti `kind: "transcription"`.
- Solo `transcript.txt` → un segmento `0 → duration`, `source.format:
  "legacy-txt"`, `timing: "whole-recording"`.
- `transcript.text` diverso dai segmenti → `edits.legacyDocumentText`; la
  sorgente originale resta intatta.

## `manifest.json` v1

Inventario dei file della registrazione con checksum doppio:

```json
{
  "schemaVersion": 1,
  "recordingId": "uuid",
  "algorithms": ["sha256", "sha512"],
  "createdAt": "2025-01-02T10:00:00.000Z",
  "updatedAt": "2025-01-02T10:05:00.000Z",
  "fileCount": 4,
  "totalBytes": 12345678,
  "files": [
    {
      "path": "audio.wav",
      "size": 12345000,
      "mtimeMs": 1735812000000,
      "sha256": "sha256:…",
      "sha512": "sha512:…"
    }
  ]
}
```

- Descrive solo file regolari, ricorsivamente, con percorso relativo e separatore
  `/`. Non segue i symlink.
- Ignora `manifest.json` stesso, `.trash-entry.json`, `.DS_Store` e i file
  temporanei (`.tmp-*`), così non si autoinventaria e non include staging.
- `recordingId` è copiato da `metadata.json`; può essere `null` se il metadata
  non è leggibile.
- L'aggiornamento è incrementale: una voce viene riusata se percorso, dimensione
  e `mtimeMs` non cambiano. I file nuovi o toccati vengono ri-hashati.
- È un aiuto all'integrità, non un requisito: un errore di scrittura del manifest
  non deve mai far fallire il salvataggio dei dati utente. Se manca o è corrotto,
  può essere ricostruito dalla verifica integrità.

## Integrità e verifica

L'ispezione è **non invasiva**: legge file e JSON, ma non migra, non corregge,
non scrive manifest e non aggiorna l'indice. Due livelli:

- **superficiale** (`deep: false`): presenza, dimensione, JSON valido, versioni e
  coerenza dei riferimenti. È quella usata dalla scansione d'avvio, eseguita in
  background per non bloccare la prima schermata;
- **profonda** (`deep: true`): ricalcola SHA-256 e SHA-512 di ogni file e li
  confronta con il manifest. È quella attivata dalla verifica manuale nell'UI.

Un report contiene `status` (`ok`, `warning`, `error`), un riepilogo con
registrazioni e file mancanti/modificati/non tracciati, e l'elenco degli
`issues`. I codici principali:

- `missing-metadata`, `invalid-metadata`, `unsupported-schema`;
- `invalid-transcript`, `transcript-repaired`, `active-revision-missing`;
- `missing-manifest`, `invalid-manifest`;
- `missing-file`, `modified-file` (`reason`: `size`, `hash`, `unreadable`),
  `untracked-file`.

Una trascrizione non conforme viene riparata **solo in memoria** per poterla
mostrare; la sorgente canonica non viene mai riscritta e la riparazione è
segnalata come avviso. Nessun report modifica l'archivio.

## Cestino e ripristino

- L'eliminazione dalla UI non cancella i file: sposta la cartella in
  `<archivio>/.trash/<timestamp>__<uuid>/`.
- `.trash-entry.json` conserva `trashedAt`, nome visibile, nome cartella
  originale, gruppo originale, percorso relativo, numero file, dimensione e
  presenza del manifest.
- Il ripristino rimette la registrazione nel gruppo originale se esiste ancora,
  altrimenti in `_unsorted/`. In caso di nome già occupato aggiunge `_1`, `_2`, …
  senza sovrascrivere nulla. `.trash-entry.json` viene rimosso e il metadata
  aggiornato con il gruppo effettivo.
- La cancellazione definitiva avviene solo dal cestino (singolo elemento o
  svuotamento), con conferma esplicita.
- Il cestino è escluso dall'indice di ricerca e dalla libreria. I manifest delle
  registrazioni non includono `.trash-entry.json`.

## Compatibilità e versioni future

| Versione del documento | Azione |
|---|---|
| precedente supportata (v1) | migrazione lazy con backup |
| corrente | lettura e scrittura |
| futura, campi noti validi | apertura in sola lettura |
| futura, campi noti non validi | rifiuto senza scritture |
| precedente al minimo supportato | rifiuto senza scritture |

In sola lettura:

- non si esegue migrazione né downgrade;
- non si riscrivono sorgenti, overlay, copie derivate o `metadata.json`;
- `createRevision`, `saveEdits`, `resetOverlay`, `switchActiveRevision` e
  `saveLegacyTranscript` rispondono `read-only-future`;
- anche gli aggiornamenti generici del metadata vengono rifiutati;
- la UI mostra un banner esplicito e disabilita l'editing.

La stessa politica vale per `metadata.json` e per le trascrizioni: una revisione
con schema futuro apre la registrazione in sola lettura anche se il metadata è
alla versione corrente, purché i campi noti siano validi.

## Revisioni e traduzioni

- Una nuova trascrizione crea una nuova revisione; la precedente resta
  archiviata.
- Una traduzione è una revisione `kind: "translation"` distinta.
- L'anteprima live è `kind: "livePreview"`; quando viene sostituita, si valorizza
  `metadata.previewReplacedAt`.
- Cambiare revisione attiva è una sola scrittura atomica di `metadata.json`.

## Indice di ricerca

- SQLite è un indice ricostruibile, non fonte di verità: si trova in
  `<archivio>/.index/search.sqlite3` e può essere cancellato a app chiusa.
- `PRAGMA user_version = 2`. Una versione più nuova viene rifiutata, non
  degradata; una versione precedente viene ricreata vuota e ripopolata dal
  filesystem.
- Indicizza la revisione attiva e il testo effettivo (override, nascosti e
  ordine inclusi), più nome, gruppo, data, durata e speaker. I segmenti
  proiettati sono indicizzati separatamente per restituire il timestamp del
  punto audio migliore.
- Non indicizza cestino, backup o revisioni archiviate.
- Tokenizer `unicode61 remove_diacritics 2`; query sanitizzata in token quotati,
  con forma originale e radice italiana, prefisso sull'ultima parola; ranking
  BM25 e snippet senza HTML.
- I filtri (`folder`, `dateFrom`, `dateTo`, `durationMin`, `durationMax`,
  `speaker`) sono applicati nell'indice, non nel renderer. Per `folder`,
  `null`/assente significa tutti i gruppi, `''` significa `_unsorted` e una
  stringa è il nome del gruppo. Lo speaker è letto dai segmenti e dai campi
  `speaker`/`speakers` del metadata quando presenti.
- L'indice si sincronizza all'avvio in background e, se non ancora pronto, alla
  prima ricerca. `recording:delete` sposta la registrazione nel cestino e rimuove
  le righe dall'indice; il ripristino la reindicizza. La rimozione definitiva
  avviene solo con purge o svuotamento del cestino. `move`, `rename`,
  `folder:rename`, `folder:delete`, salvataggi di trascrizione, cambio revisione
  e salvataggio overlay aggiornano l'indice nella stessa operazione.
- `secure_delete = ON`, WAL e checkpoint; la ricostruzione completa è esposta da
  `search:rebuild` e dal pulsante nella sidebar.
- Il modulo nativo `better-sqlite3` è escluso dall'archivio asar
  (`asarUnpack`) e ricompilato per l'ABI di Electron con
  `scripts/rebuild-native.sh`.
