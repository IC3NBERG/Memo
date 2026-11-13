#!/bin/bash
# Smoke test macOS della release: firma, notarizzazione, entitlements, primo
# avvio e installazione/ripristino dell'updater interno.
#
# Uso:
#   bash scripts/smoke-release.sh [dist/mac-arm64/Crunch.app]
#
# Variabili:
#   REQUIRE_SIGNED=1      fallisce se il bundle non è firmato Developer ID
#   REQUIRE_NOTARIZED=1   fallisce se Gatekeeper non approva il bundle

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-$ROOT/dist/mac-arm64/Crunch.app}"
REQUIRE_SIGNED="${REQUIRE_SIGNED:-0}"
REQUIRE_NOTARIZED="${REQUIRE_NOTARIZED:-0}"

step() { printf '\n== %s ==\n' "$1"; }
fail() { echo "FALLITO: $1" >&2; exit 1; }
warn() { echo "AVVISO: $1" >&2; }

[ -d "$APP" ] || fail "bundle non trovato: $APP"
[ -f "$APP/Contents/Info.plist" ] || fail "Info.plist mancante"

step "Versione del bundle"
BUNDLE_VERSION=$(plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist")
PACKAGE_VERSION=$(node -p "require('$ROOT/package.json').version")
[ "$BUNDLE_VERSION" = "$PACKAGE_VERSION" ] || fail "versione bundle $BUNDLE_VERSION ≠ package.json $PACKAGE_VERSION"
echo "versione $BUNDLE_VERSION"

step "Firma del codice"
SIGNED=0
if codesign -dv --verbose=2 "$APP" >/tmp/crunch-codesign.txt 2>&1; then
  if grep -q 'Authority=Developer ID Application' /tmp/crunch-codesign.txt; then
    SIGNED=1
    codesign --verify --deep --strict --verbose=2 "$APP" || fail "firma del codice non valida"
    echo "firma Developer ID valida"
  else
    echo "firma ad-hoc o non Developer ID"
  fi
else
  echo "bundle non firmato"
fi

if [ "$SIGNED" = "1" ]; then
  if spctl --assess --type execute --verbose=4 "$APP" >/tmp/crunch-spctl.txt 2>&1; then
    echo "Gatekeeper: approvato"
  elif [ "$REQUIRE_NOTARIZED" = "1" ]; then
    cat /tmp/crunch-spctl.txt >&2 || true
    fail "Gatekeeper non approva il bundle (notarizzazione assente)"
  else
    warn "Gatekeeper non approva il bundle: release non notarizzata"
  fi
  if [ "$REQUIRE_NOTARIZED" = "1" ]; then
    xcrun stapler validate "$APP" >/dev/null || fail "ticket di notarizzazione non applicato"
  fi
else
  if [ "$REQUIRE_SIGNED" = "1" ]; then
    fail "release non firmata (REQUIRE_SIGNED=1)"
  fi
  warn "build non firmata: gli utenti passeranno dall'updater interno"
fi

step "Entitlements"
ENTITLEMENTS_FILE=$(mktemp)
if codesign -d --entitlements :- "$APP" >"$ENTITLEMENTS_FILE" 2>/dev/null && [ -s "$ENTITLEMENTS_FILE" ]; then
  node "$ROOT/scripts/verify-entitlements.mjs" --plist "$ENTITLEMENTS_FILE" || fail "entitlements non approvati"
else
  warn "nessun entitlement estratto dal bundle"
fi
rm -f "$ENTITLEMENTS_FILE"

step "Primo avvio"
ARCHIVE_ROOT=$(mktemp -d)
smoke_log=$(mktemp)
trap 'rm -rf "$ARCHIVE_ROOT" "$smoke_log" /tmp/crunch-codesign.txt /tmp/crunch-spctl.txt' EXIT
CRUNCH_RECORDINGS_DIR="$ARCHIVE_ROOT/archive" \
  "$APP/Contents/MacOS/Crunch" --smoke-test >"$smoke_log" 2>&1 || {
    cat "$smoke_log" >&2
    fail "l'app non completa il primo avvio"
  }
grep -q 'CRUNCH_SMOKE_OK' "$smoke_log" || fail "marcatore di smoke test assente"
[ -d "$ARCHIVE_ROOT/archive" ] || fail "la cartella dei dati non è stata creata"
echo "primo avvio ok"

step "Updater: installazione con backup e ripristino"
node "$ROOT/scripts/smoke-updater.mjs" "$APP"

echo
echo "Smoke test della release superato."
