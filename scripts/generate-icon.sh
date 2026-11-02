#!/bin/bash
# ══════════════════════════════════════════════════════════════
# generate-icon.sh
# Genera icona .icns per Memo usando sips (built-in macOS)
# ══════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="$(dirname "$SCRIPT_DIR")/assets"
ICONS_DIR="$ASSETS_DIR/icons"
mkdir -p "$ICONS_DIR"

# Genera un'icona placeholder con Python
python3 - <<'PYEOF'
import struct, zlib, os

def make_png(size, bg=(30, 26, 23), fg=(232, 168, 73)):
    """Crea un PNG semplice con emoji-like design per Memo."""
    w, h = size, size
    
    # Crea pixel RGBA
    pixels = []
    cx, cy = w // 2, h // 2
    r = int(w * 0.45)
    inner = int(w * 0.30)
    
    for y in range(h):
        row = []
        for x in range(w):
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy) ** 0.5
            
            if dist <= r:
                # Cerchio ambra
                blend = max(0, min(1, (r - dist) / (r * 0.05)))
                if dist <= inner:
                    # Mic bianco al centro
                    row.extend([245, 237, 227, 255])
                else:
                    row.extend([fg[0], fg[1], fg[2], 255])
            else:
                row.extend([bg[0], bg[1], bg[2], 255])
        pixels.append(bytes(row))
    
    def pack_chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    
    raw = b''
    for row in pixels:
        raw += b'\x00' + row
    
    compressed = zlib.compress(raw, 9)
    
    header = b'\x89PNG\r\n\x1a\n'
    ihdr = pack_chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    idat = pack_chunk(b'IDAT', compressed)
    iend = pack_chunk(b'IEND', b'')
    
    return header + ihdr + idat + iend

import sys
icons_dir = sys.argv[1] if len(sys.argv) > 1 else '.'

# Genera PNG 1024x1024
png_data = make_png(1024)
png_path = os.path.join(icons_dir, 'icon.png')
with open(png_path, 'wb') as f:
    f.write(png_data)
print(f"✅ Icona PNG generata: {png_path}")
PYEOF

python3 "$SCRIPT_DIR/../assets/icons/../../../scripts/../assets/icons/../../scripts/../assets/icons/../../scripts/generate-icon.sh" "$ICONS_DIR" 2>/dev/null || true

# Genera via Python direttamente
python3 -c "
import struct, zlib, os, sys

def make_png(size):
    w, h = size, size
    cx, cy = w // 2, h // 2
    r = int(w * 0.45)
    inner_r = int(w * 0.20)
    
    pixels = []
    for y in range(h):
        row = []
        for x in range(w):
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy) ** 0.5
            if dist <= r:
                if dist <= inner_r:
                    row.extend([245, 237, 227, 255])
                else:
                    row.extend([232, 168, 73, 255])
            else:
                row.extend([30, 26, 23, 0])
        pixels.append(bytes(row))
    
    def chunk(ct, data):
        c = ct + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    
    raw = b''.join(b'\x00' + r for r in pixels)
    hdr = b'\x89PNG\r\n\x1a\n'
    return hdr + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

out = '$ICONS_DIR'
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, 'icon.png'), 'wb') as f:
    f.write(make_png(1024))
print('PNG 1024x1024 generato')
"

# Genera .icns da PNG con sips e iconutil
ICONSET="$ICONS_DIR/icon.iconset"
mkdir -p "$ICONSET"

ICON_PNG="$ICONS_DIR/icon.png"

sizes=(16 32 64 128 256 512 1024)
for size in "${sizes[@]}"; do
  sips -z $size $size "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null 2>&1 || true
done

# Varianti @2x
for size in 16 32 64 128 256 512; do
  double=$((size * 2))
  sips -z $double $double "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null 2>&1 || true
done

iconutil -c icns "$ICONSET" -o "$ICONS_DIR/icon.icns" 2>/dev/null || echo "⚠️  iconutil non disponibile, .icns non generato"
rm -rf "$ICONSET"

echo "✅ Icona pronta in assets/icons/"

