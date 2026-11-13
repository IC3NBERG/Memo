#!/bin/bash
# Pubblica una release GitHub con gli asset prodotti da electron-builder.
# Le note sono generate da scripts/release.mjs e il tag deve esistere già.
#
# Uso:
#   bash scripts/publish-release.sh v1.3.0 release-notes.md
#
# Richiede `gh` autenticato (GH_TOKEN in CI) e il tag annotato già pushato.

set -euo pipefail

TAG="${1:-}"
NOTES_FILE="${2:-}"

if [ -z "$TAG" ] || [ -z "$NOTES_FILE" ]; then
  echo "Uso: bash scripts/publish-release.sh vX.Y.Z <note.md>" >&2
  exit 1
fi

if [ ! -f "$NOTES_FILE" ]; then
  echo "Errore: file note non trovato: $NOTES_FILE" >&2
  exit 1
fi

if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Errore: tag $TAG assente nel repository." >&2
  exit 1
fi

shopt -s nullglob
VERSION=$(node -p "require('./package.json').version")
ASSETS=(
  "dist/Crunch-${VERSION}-arm64.dmg"
  "dist/Crunch-${VERSION}-arm64-mac.zip"
  "dist/Crunch-${VERSION}-arm64.dmg.blockmap"
  "dist/Crunch-${VERSION}-arm64-mac.zip.blockmap"
  "dist/Crunch-${VERSION}-arm64-mac.zip.sig"
  "dist/latest-mac.yml"
)
shopt -u nullglob

if [ "${#ASSETS[@]}" -eq 0 ]; then
  echo "Errore: nessun asset in dist/. Esegui prima la build." >&2
  exit 1
fi

for required in "${ASSETS[@]}"; do
  if [ ! -f "$required" ]; then
    echo "Errore: asset richiesto mancante: $required" >&2
    exit 1
  fi
done

TITLE="Crunch $TAG"

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "Release $TAG già presente: aggiorno asset e note (clobber)."
  gh release upload "$TAG" "${ASSETS[@]}" --clobber
  gh release edit "$TAG" --title "$TITLE" --notes-file "$NOTES_FILE" --latest
else
  echo "Creo la release $TAG."
  gh release create "$TAG" "${ASSETS[@]}" \
    --verify-tag \
    --title "$TITLE" \
    --notes-file "$NOTES_FILE" \
    --latest
fi

echo "Release $TAG pubblicata con ${#ASSETS[@]} asset."
