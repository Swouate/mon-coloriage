// Extraction des traits : transforme une image en couleur en dessin au trait noir sur blanc.
// Combine deux détecteurs :
//  1. les contours sombres déjà dessinés (seuil adaptatif sur la luminance) ;
//  2. les frontières entre zones de couleur (Canny sur l'image lissée, canal le plus contrasté).
// Puis supprime les petites taches et épaissit les traits selon les réglages.

export const PRESETS = {
  dessin: { detail: 55, ink: 60, clean: 40, thickness: 1 },
  photo: { detail: 35, ink: 30, clean: 70, thickness: 1 },
};

/** Remplace la transparence par du blanc et renvoie {w,h,rgb:Float32Array[3*n]} */
function flatten(imageData) {
  const { width: w, height: h, data } = imageData;
  const n = w * h;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    rgb[i * 3] = data[i * 4] * a + 255 * (1 - a);
    rgb[i * 3 + 1] = data[i * 4 + 1] * a + 255 * (1 - a);
    rgb[i * 3 + 2] = data[i * 4 + 2] * a + 255 * (1 - a);
  }
  return { w, h, rgb };
}

/** Flou gaussien séparable sur un canal. */
function gaussian(src, w, h, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        acc += src[row + xx] * k[i + r];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        acc += tmp[yy * w + x] * k[i + r];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

/** Moyenne locale (boîte de rayon r) via image intégrale. */
function boxMean(src, w, h, r) {
  const W = w + 1;
  const integ = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += src[y * w + x];
      integ[(y + 1) * W + x + 1] = integ[y * W + x + 1] + rowSum;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = integ[y1 * W + x1] - integ[y0 * W + x1] - integ[y1 * W + x0] + integ[y0 * W + x0];
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/** Contours de Canny multi-canal. lowT/highT exprimés en niveaux (0-255). */
function canny(channels, w, h, lowT, highT) {
  const n = w * h;
  const mag = new Float32Array(n);
  const dir = new Uint8Array(n); // 0: horizontal, 1: 45°, 2: vertical, 3: 135°
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      let best = 0, bgx = 0, bgy = 0;
      for (const c of channels) {
        const gx = c[i - w + 1] + 2 * c[i + 1] + c[i + w + 1] - c[i - w - 1] - 2 * c[i - 1] - c[i + w - 1];
        const gy = c[i + w - 1] + 2 * c[i + w] + c[i + w + 1] - c[i - w - 1] - 2 * c[i - w] - c[i - w + 1];
        const m = gx * gx + gy * gy;
        if (m > best) { best = m; bgx = gx; bgy = gy; }
      }
      mag[i] = Math.sqrt(best) / 4; // ramené à l'échelle 0-255
      let a = Math.atan2(bgy, bgx) * 180 / Math.PI;
      if (a < 0) a += 180;
      dir[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
    }
  }
  // Suppression des non-maxima
  const nms = new Uint8Array(n); // 0 rien, 1 faible, 2 fort
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < lowT) continue;
      let a, b;
      switch (dir[i]) {
        case 0: a = mag[i - 1]; b = mag[i + 1]; break;
        case 1: a = mag[i - w - 1]; b = mag[i + w + 1]; break;
        case 2: a = mag[i - w]; b = mag[i + w]; break;
        default: a = mag[i - w + 1]; b = mag[i + w - 1]; break;
      }
      if (m >= a && m >= b) nms[i] = m >= highT ? 2 : 1;
    }
  }
  // Hystérésis
  const out = new Uint8Array(n);
  const stack = [];
  for (let i = 0; i < n; i++) if (nms[i] === 2) { out[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (nms[j] === 1 && !out[j]) { out[j] = 1; stack.push(j); }
    }
  }
  return out;
}

/** Supprime les composantes connexes (8-voisinage) plus petites que minSize pixels. */
function removeSmall(mask, w, h, minSize) {
  if (minSize <= 1) return mask;
  const seen = new Uint8Array(w * h);
  const comp = [];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    comp.length = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const i = stack.pop();
      comp.push(i);
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (comp.length < minSize) for (const i of comp) mask[i] = 0;
  }
  return mask;
}

/** Dilatation par un disque de rayon r. */
function dilate(mask, w, h, r) {
  if (r <= 0) return mask;
  const offs = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
    if (dx * dx + dy * dy <= r * r + 0.5) offs.push([dx, dy]);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (const [dx, dy] of offs) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = 1;
    }
  }
  return out;
}

/**
 * Détecte la couleur de fond (bords de l'image) et renvoie la boîte englobante du sujet,
 * ou null si le fond n'est pas uniforme (photo, décor…).
 */
export function subjectBox(imageData, tolerance = 40) {
  const { width: w, height: h } = imageData;
  const { rgb } = flatten(imageData);
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  let r = 0, g = 0, b = 0;
  for (const i of border) { r += rgb[i * 3]; g += rgb[i * 3 + 1]; b += rgb[i * 3 + 2]; }
  r /= border.length; g /= border.length; b /= border.length;
  const far = (i) => Math.abs(rgb[i * 3] - r) + Math.abs(rgb[i * 3 + 1] - g) + Math.abs(rgb[i * 3 + 2] - b) > tolerance;
  let outliers = 0;
  for (const i of border) if (far(i)) outliers++;
  if (outliers / border.length > 0.1) return null;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (far(y * w + x)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = Math.round(Math.max(w, h) * 0.01);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Produit le masque des traits (Uint8Array, 1 = encre).
 * settings: detail 0-100 (contours de couleur), ink 0-100 (contours sombres),
 *           clean 0-100 (suppression des taches), thickness 0-3 (épaisseur).
 */
export function extractLines(imageData, settings) {
  const { w, h, rgb } = flatten(imageData);
  const n = w * h;
  const scale = Math.max(w, h) / 1000; // les réglages sont pensés pour ~1000 px

  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    R[i] = rgb[i * 3]; G[i] = rgb[i * 3 + 1]; B[i] = rgb[i * 3 + 2];
    L[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
  }

  const mask = new Uint8Array(n);

  // 1. Traits sombres existants (seuil adaptatif)
  if (settings.ink > 0) {
    const Ls = gaussian(L, w, h, 0.8);
    const mean = boxMean(Ls, w, h, Math.max(4, Math.round(12 * scale)));
    const C = 70 - settings.ink * 0.6; // plus ink est haut, plus on capte les traits pâles
    const darkMax = 90 + settings.ink * 1.2;
    for (let i = 0; i < n; i++) if (Ls[i] < mean[i] - C && Ls[i] < darkMax) mask[i] = 1;
  }

  // 2. Frontières entre couleurs (Canny)
  if (settings.detail > 0) {
    const sigma = 1.0 + 0.6 * scale;
    const chans = [gaussian(R, w, h, sigma), gaussian(G, w, h, sigma), gaussian(B, w, h, sigma)];
    const high = 6 + (100 - settings.detail) * 0.7;
    const edges = canny(chans, w, h, high * 0.45, high);
    for (let i = 0; i < n; i++) if (edges[i]) mask[i] = 1;
  }

  // 3. Nettoyage et épaisseur
  const minSize = Math.round((settings.clean / 100) * 60 * scale) + 1;
  removeSmall(mask, w, h, minSize);
  const thick = dilate(mask, w, h, Math.round(settings.thickness * Math.max(1, scale * 0.8)));
  return { mask: thick, width: w, height: h };
}

/** Convertit un masque en canvas noir sur fond blanc, avec un léger anticrénelage. */
export function maskToCanvas(mask, w, h, doc = document) {
  const c = doc.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const f = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) f[i] = mask[i];
  const soft = gaussian(f, w, h, 0.7);
  for (let i = 0; i < w * h; i++) {
    const ink = Math.min(1, soft[i] * 1.8);
    const v = Math.round(255 * (1 - ink));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
