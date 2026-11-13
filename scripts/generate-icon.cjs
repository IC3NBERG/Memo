// scripts/generate-icon.cjs
// Genera la nuova icona di Crunch per macOS in stile "Sage Waveform" (Verde Salvia)
// Zero emoji - Design vettoriale puro ad alta fedeltà con squircle Apple,
// barre acustiche arrotondate e cursore playhead con perni sferici.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(ROOT, 'assets', 'icons');

// SVG Master a 1024x1024
const SVG_MARKUP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <!-- Gradiente di fondo Verde Salvia con luce zenitale naturale -->
    <linearGradient id="sageGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#A5B492" />
      <stop offset="60%" stop-color="#93A47E" />
      <stop offset="100%" stop-color="#849570" />
    </linearGradient>

    <!-- Ombra interna morbida Apple macOS -->
    <radialGradient id="innerShine" cx="50%" cy="18%" r="65%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22" />
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.04" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.12" />
    </radialGradient>

    <!-- Ombra di caduta del glifo audio bianco -->
    <filter id="waveformShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#46543A" flood-opacity="0.32" />
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#46543A" flood-opacity="0.22" />
    </filter>

    <!-- Bordo sottile di rilievo (bevel) macOS -->
    <linearGradient id="rimStroke" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.35" />
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.08" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.25" />
    </linearGradient>

    <clipPath id="squircleClip">
      <!-- Squircle Apple macOS canonico a 1024x1024 (area 824x824 centrata con padding 100) -->
      <rect x="100" y="100" width="824" height="824" rx="185" ry="185" />
    </clipPath>
  </defs>

  <!-- Ombra globale esterna icona macOS -->
  <rect x="100" y="108" width="824" height="824" rx="185" ry="185" fill="#000000" opacity="0.20" filter="url(#waveformShadow)" />

  <!-- Corpo principale Squircle Verde Salvia -->
  <rect x="100" y="100" width="824" height="824" rx="185" ry="185" fill="url(#sageGrad)" stroke="url(#rimStroke)" stroke-width="3" />
  <!-- Luce zenitale / glass overlay -->
  <rect x="100" y="100" width="824" height="824" rx="185" ry="185" fill="url(#innerShine)" clip-path="url(#squircleClip)" />

  <!-- Forma d'onda acustica bianca centrale con ago di lettura -->
  <g id="waveform" filter="url(#waveformShadow)" fill="#FAF9F6">
    <!-- Barre lato sinistro (attacco e crescendo) -->
    <!-- bar 1 (estrema sx) -->
    <rect x="180" y="500" width="24" height="24" rx="12" />
    <!-- bar 2 -->
    <rect x="214" y="496" width="24" height="32" rx="12" />
    <!-- bar 3 -->
    <rect x="248" y="492" width="24" height="40" rx="12" />
    <!-- bar 4 -->
    <rect x="282" y="474" width="24" height="76" rx="12" />
    <!-- bar 5 -->
    <rect x="316" y="428" width="24" height="168" rx="12" />
    <!-- bar 6 -->
    <rect x="350" y="388" width="24" height="248" rx="12" />
    <!-- bar 7 (picco 1) -->
    <rect x="384" y="296" width="24" height="432" rx="12" />
    <!-- bar 8 -->
    <rect x="418" y="336" width="24" height="352" rx="12" />
    <!-- bar 9 (picco 2) -->
    <rect x="452" y="394" width="24" height="236" rx="12" />
    <!-- bar 10 -->
    <rect x="486" y="438" width="24" height="148" rx="12" />

    <!-- AGO PLAYHEAD VERTICALE CON TESTINE SFERICHE (CENTRATO A X=524) -->
    <!-- Asta dell'ago -->
    <rect x="520" y="278" width="18" height="468" rx="9" />
    <!-- Perno sferico superiore -->
    <circle cx="529" cy="272" r="24" />
    <!-- Perno sferico inferiore -->
    <circle cx="529" cy="752" r="24" />

    <!-- Barre lato destro (decrescendo / coda) -->
    <!-- bar 11 -->
    <rect x="558" y="434" width="24" height="156" rx="12" />
    <!-- bar 12 -->
    <rect x="592" y="448" width="24" height="128" rx="12" />
    <!-- bar 13 -->
    <rect x="626" y="462" width="24" height="100" rx="12" />
    <!-- bar 14 -->
    <rect x="660" y="476" width="24" height="72" rx="12" />
    <!-- bar 15 -->
    <rect x="694" y="488" width="24" height="48" rx="12" />
    <!-- bar 16 -->
    <rect x="728" y="494" width="24" height="36" rx="12" />
    <!-- bar 17 -->
    <rect x="762" y="498" width="24" height="28" rx="12" />
    <!-- bar 18 (estrema dx) -->
    <rect x="796" y="500" width="24" height="24" rx="12" />
    <!-- punto terminale di eco -->
    <circle cx="838" cy="512" r="10" />
  </g>
</svg>`;

async function run() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
    svg { display: block; width: 1024px; height: 1024px; }
  </style>
</head>
<body>
  ${SVG_MARKUP}
</body>
</html>`;

  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  // Lasciamo il tempo per il rendering anti-aliased di Chromium
  await new Promise(r => setTimeout(r, 600));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const pngBuffer = image.toPNG();

  fs.mkdirSync(ICONS_DIR, { recursive: true });
  const masterPng = path.join(ICONS_DIR, 'icon.png');
  fs.writeFileSync(masterPng, pngBuffer);
  console.log('✓ Master icon.png (1024x1024) scritto in:', masterPng);

  // Scrivi anche l'SVG vettoriale per l'uso nell'app
  const svgPath = path.join(ICONS_DIR, 'icon.svg');
  fs.writeFileSync(svgPath, SVG_MARKUP);
  console.log('✓ Vector icon.svg scritto in:', svgPath);

  // Generazione del set multi-risoluzione per macOS (.iconset -> .icns)
  const iconsetDir = path.join(ICONS_DIR, 'Crunch.iconset');
  fs.mkdirSync(iconsetDir, { recursive: true });

  const sizes = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 }
  ];

  for (const s of sizes) {
    const outPath = path.join(iconsetDir, s.name);
    execFileSync('sips', ['-z', String(s.size), String(s.size), masterPng, '--out', outPath], { stdio: 'ignore' });
  }

  const icnsPath = path.join(ICONS_DIR, 'icon.icns');
  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'inherit' });
  console.log('✓ Apple multi-resolution icon.icns generato con successo:', icnsPath);

  // Pulizia della cartella temporanea iconset
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  console.log('✓ Generazione icone completata con successo!');

  app.quit();
}

app.whenReady().then(run);
