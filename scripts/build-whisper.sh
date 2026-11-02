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
if [ ! -d "$WHISPER_DIR" ]; then
  echo "📥 Clonazione whisper.cpp..."
  git clone https://github.com/ggerganov/whisper.cpp.git "$WHISPER_DIR"
else
  echo "✅ whisper.cpp già scaricato, aggiornamento..."
  cd "$WHISPER_DIR" && git pull
fi

cd "$WHISPER_DIR"

echo "⚙️  Build con Metal (GPU M4)..."
cmake -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_METAL=ON \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DWHISPER_BUILD_EXAMPLES=ON

cmake --build build --config Release -j$(sysctl -n hw.logicalcpu)

echo "📦 Copio il binario in $BIN_DIR..."
mkdir -p "$BIN_DIR"
cp build/bin/whisper-cli "$BIN_DIR/whisper-cli"
chmod +x "$BIN_DIR/whisper-cli"

echo ""
echo "✅ whisper-cli compilato e copiato in bin/whisper-cli"
echo "   Dimensione: $(du -sh "$BIN_DIR/whisper-cli" | cut -f1)"
echo ""
echo "🚀 Ora puoi avviare l'app con: npm start"

