#!/bin/bash
# Verifica in sola lettura di tutte le release pubblicate.
# Vedi scripts/verify-releases.mjs per i controlli eseguiti.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"
exec node scripts/verify-releases.mjs "$@"
