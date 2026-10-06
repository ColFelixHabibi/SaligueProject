'use client';

export type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export function sizeOf(source: ImageSource) {
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  return { width: source.width, height: source.height };
}

export function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function context2d(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Image processing is not supported in this browser.');
  return ctx;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read this image.'));
    img.src = src;
  });
}

export async function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await loadImage(url);
  } finally {
    // The decoded image stays usable after the object URL is revoked.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Downscales (never upscales) so the longest edge is at most maxEdge.
export function fitWithin(source: ImageSource, maxEdge: number): HTMLCanvasElement {
  const { width, height } = sizeOf(source);
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = createCanvas(width * scale, height * scale);
  const ctx = context2d(canvas);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Bounding box of pixels whose alpha is above the threshold, or null if the canvas is empty.
export function alphaBounds(canvas: HTMLCanvasElement, threshold = 24) {
  const { width, height } = canvas;
  const data = context2d(canvas).getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export type Box = { x: number; y: number; width: number; height: number; area: number };

// Separate visible pieces of a cut-out (e.g. the two shoes of a pair), largest first.
// Labels a downscaled copy for speed and returns boxes in full-size coordinates.
export function alphaComponents(canvas: HTMLCanvasElement, threshold = 64, maxSide = 256): Box[] {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const small = fitWithin(canvas, Math.max(canvas.width, canvas.height) * scale);
  const { width, height } = small;
  const alpha = context2d(small).getImageData(0, 0, width, height).data;
  const labels = new Int32Array(width * height).fill(-1);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let start = 0; start < width * height; start++) {
    if (labels[start] !== -1 || alpha[start * 4 + 3] <= threshold) continue;
    const id = boxes.length;
    let minX = width, minY = height, maxX = 0, maxY = 0, area = 0;
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width, y = (i - x) / width;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
      for (const n of neighbors) {
        if (n >= 0 && labels[n] === -1 && alpha[n * 4 + 3] > threshold) {
          labels[n] = id;
          stack.push(n);
        }
      }
    }
    const s = 1 / scale;
    boxes.push({ x: minX * s, y: minY * s, width: (maxX - minX + 1) * s, height: (maxY - minY + 1) * s, area: area * s * s });
  }
  return boxes.sort((a, b) => b.area - a.area);
}

export function cropCanvas(canvas: HTMLCanvasElement, box: { x: number; y: number; width: number; height: number }) {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const w = Math.min(canvas.width - x, Math.ceil(box.width));
  const h = Math.min(canvas.height - y, Math.ceil(box.height));
  const out = createCanvas(w, h);
  context2d(out).drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

/**
 * Width of a garment's body (excluding sleeves): the median width of the solid run through
 * the middle column, measured across the middle-lower part of the item.
 */
export function garmentBodyWidth(canvas: HTMLCanvasElement, threshold = 64): number {
  const { width, height } = canvas;
  const alpha = context2d(canvas).getImageData(0, 0, width, height).data;
  const opaque = (x: number, y: number) => alpha[(y * width + x) * 4 + 3] > threshold;
  const runs: number[] = [];
  for (let f = 0.45; f <= 0.75; f += 0.05) {
    const y = Math.min(height - 1, Math.round(height * f));
    // Start from the opaque pixel nearest the center of the row.
    let cx = Math.round(width / 2);
    for (let d = 0; d < width * 0.15 && !opaque(cx, y); d++) {
      if (opaque(Math.round(width / 2) + d, y)) cx = Math.round(width / 2) + d;
      else if (opaque(Math.round(width / 2) - d, y)) cx = Math.round(width / 2) - d;
    }
    if (!opaque(cx, y)) continue;
    let left = cx, right = cx;
    while (left > 0 && opaque(left - 1, y)) left--;
    while (right < width - 1 && opaque(right + 1, y)) right++;
    runs.push(right - left + 1);
  }
  if (runs.length === 0) return width * 0.6;
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length / 2)];
}

// Crops a cut-out to its visible pixels plus a small margin.
export function trimTransparent(canvas: HTMLCanvasElement, margin = 4): HTMLCanvasElement {
  const box = alphaBounds(canvas);
  if (!box) return canvas;
  const x = Math.max(0, box.x - margin);
  const y = Math.max(0, box.y - margin);
  const w = Math.min(canvas.width - x, box.width + margin * 2);
  const h = Math.min(canvas.height - y, box.height + margin * 2);
  const out = createCanvas(w, h);
  context2d(out).drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

// Flattens onto a solid background inside a centered square (used for AI embeddings).
export function squareOnBackground(source: ImageSource, size: number, background = '#ffffff') {
  const { width, height } = sizeOf(source);
  const out = createCanvas(size, size);
  const ctx = context2d(out);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);
  const scale = (size * 0.9) / Math.max(width, height);
  const w = width * scale, h = height * scale;
  ctx.drawImage(source, (size - w) / 2, (size - h) / 2, w, h);
  return out;
}

// Encodes to a data URL under maxLength characters, shrinking quality and size as needed.
// Transparent images use WebP (keeps alpha), falling back to PNG where WebP encoding is unsupported.
export function encodeCanvas(
  source: ImageSource,
  { transparent, maxLength, maxEdge }: { transparent: boolean; maxLength: number; maxEdge: number }
): string {
  let current = fitWithin(source, maxEdge);
  let quality = 0.85;
  for (let attempt = 0; attempt < 10; attempt++) {
    let url: string;
    if (transparent) {
      url = current.toDataURL('image/webp', quality);
      if (!url.startsWith('data:image/webp')) url = current.toDataURL('image/png');
    } else {
      const flat = createCanvas(current.width, current.height);
      const ctx = context2d(flat);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(current, 0, 0);
      url = flat.toDataURL('image/jpeg', quality);
    }
    if (url.length <= maxLength) return url;
    if (quality > 0.6 && !url.startsWith('data:image/png')) quality -= 0.1;
    else current = fitWithin(current, Math.max(current.width, current.height) * 0.8);
  }
  throw new Error('This image is too large. Please choose a smaller photo.');
}
