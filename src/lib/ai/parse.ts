'use client';

import { MODELS, loadOrt, loadSession, type Progress } from './models';
import { context2d, createCanvas } from './canvas';

// Labels of the SegFormer clothes model.
export const PART = {
  background: 0, hat: 1, hair: 2, sunglasses: 3, upperClothes: 4, skirt: 5, pants: 6, dress: 7, belt: 8,
  leftShoe: 9, rightShoe: 10, face: 11, leftLeg: 12, rightLeg: 13, leftArm: 14, rightArm: 15, bag: 16, scarf: 17,
} as const;

/** What each pixel of the shopper's photo is (hair, face, shirt, trousers…), on a coarse grid covering the photo. */
export type Parsing = { labels: Uint8Array; width: number; height: number };

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const INPUT = 512;

async function run(person: HTMLCanvasElement, onProgress?: Progress): Promise<Parsing> {
  const ort = await loadOrt();
  const session = await loadSession(MODELS.clothes, onProgress);
  onProgress?.('Finding the clothes you are wearing…');

  // The model sees the person on white (the cut-out has no background), fitted into 512×512 without squashing.
  const scale = INPUT / Math.max(person.width, person.height);
  const drawnW = person.width * scale, drawnH = person.height * scale;
  const offsetX = (INPUT - drawnW) / 2, offsetY = (INPUT - drawnH) / 2;
  const canvas = createCanvas(INPUT, INPUT);
  const ctx = context2d(canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, INPUT, INPUT);
  ctx.drawImage(person, offsetX, offsetY, drawnW, drawnH);
  const pixels = ctx.getImageData(0, 0, INPUT, INPUT).data;
  const plane = INPUT * INPUT;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) data[c * plane + i] = (pixels[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }

  const outputs = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, INPUT, INPUT]) });
  const logits = outputs[session.outputNames[0]];
  const [, classes, height, width] = logits.dims as number[];
  const scores = logits.data as Float32Array;
  const cells = width * height;
  // Keep only the part of the grid covering the photo (not the white margins).
  const cell = INPUT / width;
  const x0 = Math.floor(offsetX / cell), y0 = Math.floor(offsetY / cell);
  const cropW = Math.max(1, Math.round(drawnW / cell)), cropH = Math.max(1, Math.round(drawnH / cell));
  const labels = new Uint8Array(cropW * cropH);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const i = Math.min(height - 1, y0 + y) * width + Math.min(width - 1, x0 + x);
      let best = 0, bestScore = -Infinity;
      for (let c = 0; c < classes; c++) {
        const s = scores[c * cells + i];
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      labels[y * cropW + x] = best;
    }
  }
  return { labels, width: cropW, height: cropH };
}

const cache = new WeakMap<HTMLCanvasElement, Promise<Parsing | null>>();

/**
 * Parses the shopper's photo once (per photo). Returns null if the model can't run on this device,
 * in which case dressing falls back to layering clothes on top.
 */
export function parseClothes(person: HTMLCanvasElement, onProgress?: Progress): Promise<Parsing | null> {
  let result = cache.get(person);
  if (!result) {
    result = run(person, onProgress).catch((error) => {
      console.error('Clothes parsing unavailable:', error);
      return null;
    });
    cache.set(person, result);
  }
  return result;
}

/**
 * A soft mask (white, alpha = how sure) of the given parts, sized width × height,
 * i.e. the same size as the photo the parsing was made from.
 */
export function partMask(parsing: Parsing, parts: number[], width: number, height: number): HTMLCanvasElement {
  const small = createCanvas(parsing.width, parsing.height);
  const smallCtx = context2d(small);
  const image = smallCtx.createImageData(parsing.width, parsing.height);
  const wanted = new Set(parts);
  for (let i = 0; i < parsing.labels.length; i++) {
    if (wanted.has(parsing.labels[i])) {
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = 255;
      image.data[i * 4 + 3] = 255;
    }
  }
  smallCtx.putImageData(image, 0, 0);
  const mask = createCanvas(width, height);
  const ctx = context2d(mask);
  ctx.imageSmoothingQuality = 'high';
  // The grid is coarse: scale smoothly and soften the edge by about one grid cell.
  ctx.filter = `blur(${Math.max(1, Math.round(width / parsing.width / 2))}px)`;
  ctx.drawImage(small, 0, 0, width, height);
  return mask;
}

/** Average colour of the given parts in the photo (e.g. skin from face, arms and legs), or null if none are visible. */
export function averageColor(person: HTMLCanvasElement, parsing: Parsing, parts: number[]): [number, number, number] | null {
  const { width, height } = person;
  const pixels = context2d(person).getImageData(0, 0, width, height).data;
  const wanted = new Set(parts);
  let r = 0, g = 0, b = 0, n = 0;
  // Sample every few pixels; enough for an average.
  const step = Math.max(1, Math.floor(Math.min(width, height) / 200));
  for (let y = 0; y < height; y += step) {
    const gy = Math.min(parsing.height - 1, Math.floor((y / height) * parsing.height));
    for (let x = 0; x < width; x += step) {
      const gx = Math.min(parsing.width - 1, Math.floor((x / width) * parsing.width));
      if (!wanted.has(parsing.labels[gy * parsing.width + gx])) continue;
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 200) continue;
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];
      n++;
    }
  }
  return n > 20 ? [r / n, g / n, b / n] : null;
}
