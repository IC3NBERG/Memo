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
| `manifest.json` (futuro) | 1 |
| `.index/search.sqlite3` | `PRAGMA user_version = 1` |

`schemaVersion` più nuovo di quello supportato: l'app rifiuta di aprire la
registrazione, non degrada e non modifica nulla.

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
  .backup-v1/                    # backup della migrazione v1, mai auto-cancellato
  .tmp-*                         # staging temporaneo, non è dato utente
```

Le copie nella root della registrazione sono di compatibilità e possono essere
rigenerate. Non sono mai la sorgente. La revisione attiva è indicata da
`metadata.activeRevisionId`.

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
- `PRAGMA user_version = 1`. Una versione più nuova viene rifiutata, non
  degradata.
- Indicizza la revisione attiva e il testo effettivo (override, nascosti e
  ordine inclusi), più nome, gruppo e data di aggiornamento.
- Non indicizza cestino, backup o revisioni archiviate.
- Tokenizer `unicode61 remove_diacritics 2`; query sanitizzata in token quotati,
  con prefisso sull'ultima parola; ranking BM25 e snippet senza HTML.
- L'indice si sincronizza all'avvio in background e, se non ancora pronto, alla
  prima ricerca. `recording:delete` elimina le righe prima di rimuovere i file;
  `move`, `rename`, `folder:rename`, `folder:delete`, salvataggi di trascrizione,
  cambio revisione e salvataggio overlay aggiornano l'indice nella stessa
  operazione.
- `secure_delete = ON`, WAL e checkpoint; la ricostruzione completa è esposta da
  `search:rebuild`.
- Il modulo nativo `better-sqlite3` è escluso dall'archivio asar
  (`asarUnpack`) e ricompilato per l'ABI di Electron con
  `scripts/rebuild-native.sh`.
