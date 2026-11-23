// Mise en page : grand dessin au trait + miniature en couleur dans le coin supérieur gauche.

export const PAGE = { width: 1240, height: 1754 }; // A4 portrait à 150 ppp
const MARGIN = 50;
const GAP = 24;

/** Rectangle d'encre (boîte englobante) dans un masque. */
function inkBox(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Calcule la position du dessin pour qu'il soit le plus grand possible sans que
 * ses traits ne chevauchent la miniature (les zones blanches peuvent passer dessous).
 */
export function computeLayout(mask, w, h, thumbAspect, withThumb) {
  const box = inkBox(mask, w, h);
  const W = PAGE.width, H = PAGE.height;
  const availW = W - 2 * MARGIN, availH = H - 2 * MARGIN;

  // Miniature : au plus 30 % de la largeur et 25 % de la hauteur de la page.
  let thumb = null;
  if (withThumb) {
    let tw = W * 0.3, th = tw / thumbAspect;
    if (th > H * 0.25) { th = H * 0.25; tw = th * thumbAspect; }
    thumb = { x: MARGIN, y: MARGIN, w: tw, h: th };
  }

  const sMax = Math.min(availW / box.w, availH / box.h);
  if (!thumb) {
    const s = sMax;
    return { thumb, art: { box, s, x: (W - box.w * s) / 2, y: (H - box.h * s) / 2 } };
  }

  // Masque réduit (grille) pour tester rapidement les collisions.
  const G = 4; // taille de cellule en pixels source
  const gw = Math.ceil(box.w / G), gh = Math.ceil(box.h / G);
  const grid = new Uint8Array(gw * gh);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
    if (mask[(y + box.y) * w + x + box.x]) grid[((y / G) | 0) * gw + ((x / G) | 0)] = 1;
  }
  const forbidden = { x0: thumb.x - GAP, y0: thumb.y - GAP, x1: thumb.x + thumb.w + GAP, y1: thumb.y + thumb.h + GAP };
  const collides = (s, ox, oy) => {
    // cellules du dessin qui tombent dans la zone interdite
    const cx0 = Math.max(0, Math.floor((forbidden.x0 - ox) / (s * G)));
    const cy0 = Math.max(0, Math.floor((forbidden.y0 - oy) / (s * G)));
    const cx1 = Math.min(gw - 1, Math.floor((forbidden.x1 - ox) / (s * G)));
    const cy1 = Math.min(gh - 1, Math.floor((forbidden.y1 - oy) / (s * G)));
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) if (grid[y * gw + x]) return true;
    return false;
  };
  // Positions candidates : du centre de la page vers le coin inférieur droit.
  const placements = (s) => {
    const aw = box.w * s, ah = box.h * s;
    const cx = (W - aw) / 2, cy = (H - ah) / 2;
    const rx = W - MARGIN - aw, by = H - MARGIN - ah;
    const res = [];
    const steps = 8;
    for (let j = 0; j <= steps; j++) for (let i = 0; i <= steps; i++) {
      res.push({ x: cx + ((rx - cx) * i) / steps, y: cy + ((by - cy) * j) / steps, cost: i * i + j * j });
    }
    return res.sort((a, b) => a.cost - b.cost);
  };
  const fit = (s) => placements(s).find((p) => !collides(s, p.x, p.y));

  let lo = 0, hi = sMax, best = null;
  const top = fit(sMax);
  if (top) best = { s: sMax, p: top };
  else {
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      const p = fit(mid);
      if (p) { lo = mid; best = { s: mid, p }; } else hi = mid;
    }
  }
  if (!best) best = { s: sMax * 0.5, p: { x: W - MARGIN - box.w * sMax * 0.5, y: H - MARGIN - box.h * sMax * 0.5 } };
  return { thumb, art: { box, s: best.s, x: best.p.x, y: best.p.y } };
}

/** Dessine la page finale. */
export function renderPage(canvas, lineCanvas, mask, thumbSource, thumbRect, withThumb) {
  canvas.width = PAGE.width;
  canvas.height = PAGE.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PAGE.width, PAGE.height);
  const layout = computeLayout(mask, lineCanvas.width, lineCanvas.height, thumbRect.w / thumbRect.h, withThumb);
  const { box, s, x, y } = layout.art;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Le blanc du dessin ne doit pas masquer la miniature : on dessine en "multiply".
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(lineCanvas, box.x, box.y, box.w, box.h, x, y, box.w * s, box.h * s);
  ctx.globalCompositeOperation = 'source-over';
  if (layout.thumb) {
    const t = layout.thumb;
    ctx.drawImage(thumbSource, thumbRect.x, thumbRect.y, thumbRect.w, thumbRect.h, t.x, t.y, t.w, t.h);
  }
  return layout;
}
