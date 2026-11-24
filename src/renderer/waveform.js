'use strict';

// ─── Waveform ─────────────────────────────────────────────────
function setupWaveform() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const canvas = UI.waveformCanvas;
  const wrap = canvas?.parentElement;
  if (!canvas || !wrap) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, wrap.offsetWidth);
  const h = Math.max(1, wrap.offsetHeight);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  waveformFillGrad = null;
  waveformLineGrad = null;
  if (!state.recording) paintIdleWaveform();
}

// Linea di riposo: traccia sottile e sfumata al centro della barra.
function paintIdleWaveform() {
  const canvas = UI.waveformCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const dpr = window.devicePixelRatio || 1;

  ctx.clearRect(0, 0, W, H);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark-warm';
  const color = isDark ? 'rgba(156, 179, 143, 0.45)' : 'rgba(94, 119, 85, 0.4)';

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineCap = 'round';
  ctx.setLineDash([2 * dpr, 7 * dpr]);
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Buffer riutilizzabili: evitano allocazioni e GC a 60 fps durante la REC.
let waveformDataArray = null;
let waveformX = null;
let waveformY = null;
let waveformFillGrad = null;
let waveformLineGrad = null;
let waveformGradW = 0;
let waveformGradH = 0;

function drawWaveform() {
  const canvas = UI.waveformCanvas;
  if (!canvas) return;

  // In pausa (o a registrazione ferma) non serve ridisegnare a 60 fps.
  if (!state.recording || state.paused) {
    paintIdleWaveform();
    return;
  }

  requestAnimationFrame(drawWaveform);

  const analyser = state.analyserNode;
  if (!analyser) {
    paintIdleWaveform();
    return;
  }
  if (document.hidden) return;

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const bufLen = analyser.frequencyBinCount;

  if (!waveformDataArray || waveformDataArray.length !== bufLen) {
    waveformDataArray = new Uint8Array(bufLen);
    waveformX = new Float32Array(bufLen);
    waveformY = new Float32Array(bufLen);
  }

  analyser.getByteTimeDomainData(waveformDataArray);

  ctx.clearRect(0, 0, W, H);

  const dpr = window.devicePixelRatio || 1;
  const mid = H / 2;
  const sliceWidth = W / bufLen;

  for (let i = 0; i < bufLen; i++) {
    const v = (waveformDataArray[i] - 128) / 128;
    waveformX[i] = i * sliceWidth;
    waveformY[i] = mid + v * mid * 0.78;
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark-warm';
  const themeKey = isDark ? 'dark' : 'light';

  if (!waveformFillGrad || waveformGradW !== W || waveformGradH !== H || waveformFillGrad._themeKey !== themeKey) {
    waveformGradW = W;
    waveformGradH = H;

    const sage = isDark ? '#9CB38F' : '#5E7755';
    const sageSoft = isDark ? 'rgba(156, 179, 143, 0.22)' : 'rgba(94, 119, 85, 0.20)';
    const pine = isDark ? '#7C9271' : '#2B4B44';

    waveformFillGrad = ctx.createLinearGradient(0, 0, 0, H);
    waveformFillGrad._themeKey = themeKey;
    waveformFillGrad.addColorStop(0, sageSoft);
    waveformFillGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
    waveformFillGrad.addColorStop(1, sageSoft);

    waveformLineGrad = ctx.createLinearGradient(0, 0, W, 0);
    waveformLineGrad.addColorStop(0, pine);
    waveformLineGrad.addColorStop(0.5, sage);
    waveformLineGrad.addColorStop(1, pine);
  }

  // Nastro simmetrico: dà corpo all'onda senza appesantirla.
  ctx.beginPath();
  ctx.moveTo(waveformX[0], waveformY[0]);
  for (let i = 1; i < bufLen; i++) ctx.lineTo(waveformX[i], waveformY[i]);
  for (let i = bufLen - 1; i >= 0; i--) ctx.lineTo(waveformX[i], H - waveformY[i]);
  ctx.closePath();
  ctx.fillStyle = waveformFillGrad;
  ctx.fill();

  ctx.lineWidth = 1.8 * dpr;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = waveformLineGrad;
  ctx.shadowColor = isDark ? 'rgba(156, 179, 143, 0.65)' : 'rgba(94, 119, 85, 0.45)';
  ctx.shadowBlur = 8 * dpr;
  ctx.beginPath();
  ctx.moveTo(waveformX[0], waveformY[0]);
  for (let i = 1; i < bufLen; i++) ctx.lineTo(waveformX[i], waveformY[i]);
  ctx.stroke();
  ctx.shadowBlur = 0;
}
