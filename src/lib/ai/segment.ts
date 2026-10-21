'use client';

import { MODELS, loadSession, loadOrt, type Progress } from './models';
import { context2d, createCanvas, fitWithin, sizeOf, type ImageSource } from './canvas';

export type CutoutKind = 'person' | 'item';

// Largest edge processed. Keeps phones responsive while preserving detail.
const MAX_WORKING_EDGE = 1600;

function toTensorData(
  source: ImageSource,
  width: number,
  height: number,
  mean: number[],
  std: number[]
): Float32Array {
  const canvas = createCanvas(width, height);
  const ctx = context2d(canvas);
  ctx.drawImage(source, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const plane = width * height;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      data[c * plane + i] = (pixels[i * 4 + c] / 255 - mean[c]) / std[c];
    }
  }
  return data;
}

let running: Promise<unknown> = Promise.resolve();
function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const next = running.then(task, task);
  running = next.catch(() => {});
  return next;
}

// Runs the matting/segmentation network and returns a mask in [0, 1] with its size.
async function predictMask(source: ImageSource, kind: CutoutKind, onProgress?: Progress) {
  const ort = await loadOrt();
  const session = await loadSession(kind === 'person' ? MODELS.person : MODELS.item, onProgress);
  onProgress?.(kind === 'person' ? 'Removing background…' : 'Cutting out the item…');

  let width: number, height: number, mean: number[], std: number[];
  if (kind === 'person') {
    // MODNet: shortest edge 512, both sides multiples of 32, normalized to [-1, 1].
    const size = sizeOf(source);
    const scale = 512 / Math.min(size.width, size.height);
    width = Math.max(32, Math.round((size.width * scale) / 32) * 32);
    height = Math.max(32, Math.round((size.height * scale) / 32) * 32);
    mean = [0.5, 0.5, 0.5];
    std = [0.5, 0.5, 0.5];
  } else {
    // U-2-Netp: fixed 320x320 input, ImageNet normalization.
    width = 320;
    height = 320;
    mean = [0.485, 0.456, 0.406];
    std = [0.229, 0.224, 0.225];
  }

  const input = new ort.Tensor('float32', toTensorData(source, width, height, mean, std), [1, 3, height, width]);
  // A model can only run one image at a time; queue overlapping requests.
  const outputs = await runExclusive(() => session.run({ [session.inputNames[0]]: input }));
  const outputName = session.outputNames.includes('1959') ? '1959' : session.outputNames[0];
  const raw = outputs[outputName].data as Float32Array;

  const mask = new Float32Array(width * height);
  if (kind === 'item') {
    // U-2-Net outputs relative saliency; stretch to the full [0, 1] range.
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < mask.length; i++) {
      if (raw[i] < min) min = raw[i];
      if (raw[i] > max) max = raw[i];
    }
    const range = max - min || 1;
    for (let i = 0; i < mask.length; i++) mask[i] = (raw[i] - min) / range;
  } else {
    for (let i = 0; i < mask.length; i++) mask[i] = Math.min(1, Math.max(0, raw[i]));
  }
  removeSpeckles(mask, width, height);
  return { mask, width, height };
}

// Drops small detached blobs (e.g. bits of a car or furniture next to the person),
// keeping every piece at least 15% the size of the largest one.
function removeSpeckles(mask: Float32Array, width: number, height: number) {
  const labels = new Int32Array(mask.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (labels[start] !== -1 || mask[start] < 0.5) continue;
    const id = sizes.length;
    let size = 0;
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      const neighbors = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width];
      for (const n of neighbors) {
        if (n >= 0 && n < mask.length && labels[n] === -1 && mask[n] >= 0.5) {
          labels[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  if (sizes.length <= 1) return;
  const keep = Math.max(...sizes) * 0.15;

  // Faint pixels belong to the nearest solid piece; spread kept/dropped status to them.
  const dropped = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (labels[i] >= 0 && sizes[labels[i]] < keep) dropped[i] = 1;
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < mask.length; i++) {
      if (labels[i] >= 0 || dropped[i] || mask[i] === 0) continue;
      const x = i % width;
      if ((x > 0 && dropped[i - 1]) || (x < width - 1 && dropped[i + 1]) || dropped[i - width] || dropped[i + width]) dropped[i] = 1;
    }
  }
  for (let i = 0; i < mask.length; i++) if (dropped[i]) mask[i] = 0;
}

/**
 * Removes the background. The returned canvas has the original pixels untouched;
 * only the alpha channel changes, so the person or item looks exactly as photographed.
 */
/**
 * A person has no holes: spots the model left see-through inside the body (shiny fabric, dark clothes against
 * a light wall) are filled, and the edge is softened by about one pixel so it isn't jagged when enlarged.
 */
function cleanPersonMask(mask: Float32Array | number[], width: number, height: number): Float32Array {
  const out = Float32Array.from(mask);
  // Background = see-through pixels connected to the photo's border. Anything see-through not connected is a hole.
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!outside[i] && out[i] < 0.5) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width, y = (i - x) / width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
  for (let i = 0; i < out.length; i++) if (!outside[i] && out[i] < 0.5) out[i] = 1;
  // Soften the edge: 3×3 average, only where the mask changes.
  const soft = Float32Array.from(out);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += out[i + dy * width + dx];
      const avg = sum / 9;
      if (avg > 0.02 && avg < 0.98) soft[i] = avg;
    }
  }
  return soft;
}

export async function removeBackground(
  source: ImageSource,
  kind: CutoutKind,
  onProgress?: Progress
): Promise<HTMLCanvasElement> {
  const working = fitWithin(source, MAX_WORKING_EDGE);
  const { mask: raw, width, height } = await predictMask(working, kind, onProgress);
  const mask = kind === 'person' ? cleanPersonMask(raw, width, height) : raw;

  // Upscale the mask smoothly to the photo's size.
  const maskCanvas = createCanvas(width, height);
  const maskCtx = context2d(maskCanvas);
  const maskImage = maskCtx.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    maskImage.data[i * 4 + 3] = Math.round(mask[i] * 255);
  }
  maskCtx.putImageData(maskImage, 0, 0);

  const scaledMask = createCanvas(working.width, working.height);
  const scaledCtx = context2d(scaledMask);
  scaledCtx.imageSmoothingQuality = 'high';
  scaledCtx.drawImage(maskCanvas, 0, 0, working.width, working.height);
  const alpha = scaledCtx.getImageData(0, 0, working.width, working.height).data;

  const out = createCanvas(working.width, working.height);
  const outCtx = context2d(out);
  outCtx.drawImage(working, 0, 0);
  const pixels = outCtx.getImageData(0, 0, out.width, out.height);
  for (let i = 3; i < pixels.data.length; i += 4) {
    // Clean up faint haze around the subject without touching its edges.
    const a = alpha[i];
    pixels.data[i] = a < 12 ? 0 : a;
  }
  outCtx.putImageData(pixels, 0, 0);
  return out;
}
