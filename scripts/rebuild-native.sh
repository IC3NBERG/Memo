#!/usr/bin/env bash
# Ricompila better-sqlite3 per l'ABI di Electron in uso.
# Un solo modulo nativo: i test Node saltano i test SQLite quando l'ABI non
# combacia, mentre `npm run test:electron` esegue la suite completa.
set -euo pipefail
cd "$(dirname "$0")/.."

PYTHON_BIN="${PYTHON:-python3}"
if ! "$PYTHON_BIN" -c 'import distutils' >/dev/null 2>&1; then
  # Python 3.12+ ha rimosso distutils. Su macOS il Python di sistema lo ha
  # ancora: usiamolo come fallback senza toccare l'ambiente globale.
  if [ -x /usr/bin/python3 ] && /usr/bin/python3 -c 'import distutils' >/dev/null 2>&1; then
    PYTHON_BIN=/usr/bin/python3
  fi
fi

ELECTRON_VERSION=$(node -p "require('electron/package.json').version")

PYTHON="$PYTHON_BIN" npx electron-rebuild \
  -f \
  -w better-sqlite3 \
  --build-from-source \
  --version "$ELECTRON_VERSION"
