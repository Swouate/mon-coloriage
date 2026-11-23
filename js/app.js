import { extractLines, maskToCanvas, subjectBox, PRESETS } from './linework.js';
import { renderPage } from './layout.js';
import { canvasToPdf } from './pdf.js';

const WORK_MAX = 1400; // taille de travail max (px) pour l'extraction
const WORK_MIN = 1100; // les petites images sont agrandies pour des traits plus lisses
const $ = (id) => document.getElementById(id);

const els = {
  file: $('file'), drop: $('drop'), editor: $('editor'), page: $('page'), busy: $('busy'),
  detail: $('detail'), ink: $('ink'), clean: $('clean'), thickness: $('thickness'),
  thumb: $('withThumb'), crop: $('autoCrop'), png: $('dlPng'), pdf: $('dlPdf'), share: $('share'),
  again: $('again'), error: $('error'),
};

let source = null; // { canvas, name }

function setPreset(name) {
  const p = PRESETS[name];
  for (const k of Object.keys(p)) els[k].value = p[k];
  document.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('active', b.dataset.preset === name));
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = !msg;
}

/** Décode un fichier image (JPEG, PNG, WebP, GIF, BMP, HEIC sur iPhone…) dans un canvas. */
async function decode(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('format')); };
      img.src = url;
    });
  }
  const w = bmp.width, h = bmp.height;
  const long = Math.max(w, h);
  const s = long > WORK_MAX ? WORK_MAX / long : long < WORK_MIN ? WORK_MIN / long : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

async function loadFile(file) {
  if (!file) return;
  showError('');
  try {
    const canvas = await decode(file);
    source = { canvas, name: file.name.replace(/\.[^.]+$/, '') || 'coloriage' };
    els.drop.hidden = true;
    els.editor.hidden = false;
    generate();
  } catch {
    showError("Impossible de lire cette image. Essayez un fichier JPEG, PNG, WebP ou GIF.");
  }
}

let pending = 0;
function generate() {
  if (!source) return;
  const ticket = ++pending;
  els.busy.hidden = false;
  // Laisse le navigateur afficher l'indicateur avant le calcul.
  setTimeout(() => {
    if (ticket !== pending) return;
    const { canvas } = source;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let crop = els.crop.checked ? subjectBox(data) : null;
    if (crop) data = ctx.getImageData(crop.x, crop.y, crop.w, crop.h);
    else crop = { x: 0, y: 0, w: canvas.width, h: canvas.height };
    const settings = {
      detail: +els.detail.value, ink: +els.ink.value, clean: +els.clean.value, thickness: +els.thickness.value,
    };
    const { mask, width, height } = extractLines(data, settings);
    const lines = maskToCanvas(mask, width, height);
    renderPage(els.page, lines, mask, canvas, crop, els.thumb.checked);
    els.busy.hidden = true;
  }, 30);
}

function pngBlob() {
  return new Promise((r) => els.page.toBlob(r, 'image/png'));
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// --- Événements ---
els.file.addEventListener('change', (e) => loadFile(e.target.files[0]));
els.drop.addEventListener('dragover', (e) => { e.preventDefault(); els.drop.classList.add('over'); });
els.drop.addEventListener('dragleave', () => els.drop.classList.remove('over'));
els.drop.addEventListener('drop', (e) => { e.preventDefault(); els.drop.classList.remove('over'); loadFile(e.dataTransfer.files[0]); });

let debounce;
for (const k of ['detail', 'ink', 'clean', 'thickness']) {
  els[k].addEventListener('input', () => {
    document.querySelectorAll('[data-preset]').forEach((b) => b.classList.remove('active'));
    clearTimeout(debounce);
    debounce = setTimeout(generate, 150);
  });
}
els.thumb.addEventListener('change', generate);
els.crop.addEventListener('change', generate);
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { setPreset(b.dataset.preset); generate(); }));

els.png.addEventListener('click', async () => download(await pngBlob(), `${source.name}-coloriage.png`));
els.pdf.addEventListener('click', () => download(canvasToPdf(els.page), `${source.name}-coloriage.pdf`));
els.share.addEventListener('click', async () => {
  const file = new File([await pngBlob()], `${source.name}-coloriage.png`, { type: 'image/png' });
  try {
    await navigator.share({ files: [file], title: 'Coloriage' });
  } catch (e) {
    if (e.name !== 'AbortError') download(file, file.name);
  }
});
if (!(navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] }))) {
  els.share.hidden = true;
}
els.again.addEventListener('click', () => {
  els.file.value = '';
  els.editor.hidden = true;
  els.drop.hidden = false;
  source = null;
});

setPreset('dessin');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
