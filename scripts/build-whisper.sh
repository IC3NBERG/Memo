#!/bin/bash
# ══════════════════════════════════════════════════════════════
# build-whisper.sh
# Compila whisper.cpp con Metal (GPU Apple Silicon) per arm64
# Output: bin/whisper-cli
# ══════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_ROOT/bin"

echo "🔨 Compilazione whisper.cpp con Metal per arm64..."

# Clona whisper.cpp se non esiste
WHISPER_DIR="/tmp/whisper.cpp"
# Commit verificato con Crunch 1.0.5: evita che un aggiornamento upstream
# rompa la build di release.
WHISPER_REF="${WHISPER_REF:-482279b8a18855ba741d7b88c30fcb3874691f59}"

if [ ! -d "$WHISPER_DIR" ]; then
  echo "📥 Clonazione whisper.cpp..."
  git clone https://github.com/ggerganov/whisper.cpp.git "$WHISPER_DIR"
else
  echo "✅ whisper.cpp già scaricato, aggiornamento..."
  cd "$WHISPER_DIR" && git fetch origin
fi

cd "$WHISPER_DIR"
git checkout "$WHISPER_REF"

echo "⚙️  Build con Metal (GPU M4)..."
cmake -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_METAL=ON \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DWHISPER_BUILD_EXAMPLES=ON

cmake --build build --config Release -j$(sysctl -n hw.logicalcpu)

echo "📦 Copio binari e librerie in $BIN_DIR..."
mkdir -p "$BIN_DIR"
cp build/bin/whisper-cli "$BIN_DIR/whisper-cli"
cp build/bin/whisper-server "$BIN_DIR/whisper-server"
cp -a build/bin/libwhisper*.dylib "$BIN_DIR/"
cp -a build/bin/libggml*.dylib "$BIN_DIR/"
chmod +x "$BIN_DIR/whisper-cli" "$BIN_DIR/whisper-server"

# Le dylib devono essere trovate dentro l'app, non in /tmp/whisper.cpp.
# Un rpath assoluto funziona in sviluppo ma rompe la build distribuita.
for bin in whisper-cli whisper-server; do
  install_name_tool -delete_rpath "$WHISPER_DIR/build/bin" "$BIN_DIR/$bin" 2>/dev/null || true
  install_name_tool -add_rpath "@executable_path" "$BIN_DIR/$bin" 2>/dev/null || true
done

# Su Apple Silicon i binari modificati vanno firmati, anche solo ad-hoc.
codesign --force --sign - "$BIN_DIR"/*.dylib "$BIN_DIR/whisper-cli" "$BIN_DIR/whisper-server" >/dev/null 2>&1 || true

echo ""
echo "✅ whisper-cli e whisper-server compilati in bin/"
echo "   Dimensione: $(du -sh "$BIN_DIR" | cut -f1)"
echo ""
echo "🚀 Ora puoi avviare l'app con: npm start"

