// Eigene Produktfotos auf dem Gerät aufbereiten: verkleinern, hellen Hintergrund entfernen,
// mittig in ein Quadrat setzen. Alles läuft lokal im Browser, nichts wird hochgeladen.

export const PHOTO_SIZE = 480;
const WORK_MAX = 1000;   // Kantenlänge für die Bearbeitung (schnell genug auf dem iPhone)
const MARGIN = 0.07;

/**
 * Entfernt hellen, einfarbigen Hintergrund, der mit dem Bildrand verbunden ist (Flood-Fill),
 * und setzt dort Transparenz. Arbeitet direkt auf ImageData-artigen Daten.
 * @param {{data: Uint8ClampedArray, width: number, height: number}} image
 * @returns {{x: number, y: number, width: number, height: number} | null} Motiv-Rahmen oder null,
 *   wenn der Rand nicht überwiegend hell und einfarbig ist
 */
export function removeLightBackground({ data, width: w, height: h }) {
  const n = w * h;
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);

  let light = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (const p of border) {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    if (Math.min(r, g, b) >= 205 && Math.max(r, g, b) - Math.min(r, g, b) <= 30) { light++; sr += r; sg += g; sb += b; }
  }
  if (light / border.length < 0.7) return null;
  const bg = [sr / light, sg / light, sb / light];
  const tolerance = 34;
  const isBackground = (p) => Math.abs(data[p * 4] - bg[0]) <= tolerance
    && Math.abs(data[p * 4 + 1] - bg[1]) <= tolerance
    && Math.abs(data[p * 4 + 2] - bg[2]) <= tolerance;

  const background = new Uint8Array(n);
  const queue = new Int32Array(n);
  let tail = 0;
  for (const p of border) {
    if (!background[p] && isBackground(p)) { background[p] = 1; queue[tail++] = p; }
  }
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    const x = p % w;
    const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
    for (const q of neighbours) {
      if (q >= 0 && !background[q] && isBackground(q)) { background[q] = 1; queue[tail++] = q; }
    }
  }

  // Weiche Kante (3×3-Mittel) und Rahmen um das Motiv.
  let minX = w; let minY = h; let maxX = -1; let maxY = -1; let foreground = 0;
  const alpha = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          sum += background[yy * w + xx] ? 0 : 255;
          count++;
        }
      }
      const a = Math.round(sum / count);
      alpha[y * w + x] = a;
      if (a > 8) {
        foreground++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const share = foreground / n;
  if (share < 0.02 || share > 0.95) return null;
  for (let p = 0; p < n; p++) data[p * 4 + 3] = alpha[p];
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Rechteck für das Einpassen ins Quadrat: `fill` = randlos zuschneiden, sonst mit Rand einpassen. */
export function fitRect(srcWidth, srcHeight, size, { fill = false, margin = MARGIN } = {}) {
  const inner = size * (1 - 2 * margin);
  const factor = fill ? Math.max(size / srcWidth, size / srcHeight) : Math.min(inner / srcWidth, inner / srcHeight);
  const width = srcWidth * factor;
  const height = srcHeight * factor;
  return { x: (size - width) / 2, y: (size - height) / 2, width, height };
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* Ausweichweg unten */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvas(width, height) {
  const c = document.createElement('canvas');
  c.width = Math.round(width);
  c.height = Math.round(height);
  return c;
}

/**
 * Foto-Datei → quadratisches Bild als Data-URL.
 * @returns {Promise<{dataUrl: string, cutOut: boolean}>}
 */
export async function processPhoto(file, size = PHOTO_SIZE) {
  if (!file?.type?.startsWith('image/') && !/\.(jpe?g|png|heic|webp)$/i.test(file?.name ?? '')) {
    throw new Error('Das ist kein Foto.');
  }
  const bitmap = await loadBitmap(file);
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  if (!srcW || !srcH) throw new Error('Das Foto konnte nicht gelesen werden.');

  const scale = Math.min(1, WORK_MAX / Math.max(srcW, srcH));
  const work = canvas(srcW * scale, srcH * scale);
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(bitmap, 0, 0, work.width, work.height);
  bitmap.close?.();

  const pixels = wctx.getImageData(0, 0, work.width, work.height);
  const subject = removeLightBackground(pixels);

  const out = canvas(size, size);
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  if (subject) {
    wctx.putImageData(pixels, 0, 0);
    const r = fitRect(subject.width, subject.height, size);
    octx.drawImage(work, subject.x, subject.y, subject.width, subject.height, r.x, r.y, r.width, r.height);
  } else {
    const r = fitRect(work.width, work.height, size, { fill: true });
    octx.drawImage(work, r.x, r.y, r.width, r.height);
  }

  // WebP ist am kleinsten; sonst PNG (mit Transparenz) bzw. JPEG (ohne).
  let dataUrl = out.toDataURL('image/webp', 0.85);
  if (!dataUrl.startsWith('data:image/webp')) dataUrl = subject ? out.toDataURL('image/png') : out.toDataURL('image/jpeg', 0.85);
  return { dataUrl, cutOut: Boolean(subject) };
}
