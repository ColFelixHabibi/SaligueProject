'use client';

import { context2d, createCanvas, loadImage } from './canvas';
import { PART, parseClothes, partMask } from './parse';

// The rule: start from the shopper's own photo and take ONLY the new garment from the AI's picture, plus the
// small areas the change reveals. Whatever else the AI redraws (other clothes, skin, tattoos, jewellery, the
// background) is thrown away, so a try-on can never damage the rest of the person.
//
//   garment  the new garment, where the AI drew it                     → from the AI
//   old      where the old garment was (a shorter new top shows skin) → from the AI
//   reveal   skin that only shows now (shorter sleeves or legs)       → from the AI
//   protect  face, hair, hat, glasses, shoes, bag                     → always from the photo
const GARMENT: Record<string, number[]> = {
  top: [PART.upperClothes, PART.scarf],
  outerwear: [PART.upperClothes, PART.scarf],
  bottom: [PART.pants, PART.skirt, PART.belt],
  dress: [PART.dress, PART.upperClothes, PART.skirt, PART.pants, PART.belt],
};
const LIMBS: Record<string, number[]> = {
  top: [PART.leftArm, PART.rightArm],
  outerwear: [PART.leftArm, PART.rightArm],
  bottom: [PART.leftLeg, PART.rightLeg],
  dress: [PART.leftArm, PART.rightArm, PART.leftLeg, PART.rightLeg],
};
const PROTECT = [PART.face, PART.hair, PART.hat, PART.sunglasses, PART.leftShoe, PART.rightShoe, PART.bag];
const CLOTHES: number[] = [PART.upperClothes, PART.skirt, PART.pants, PART.dress, PART.belt, PART.scarf];

/** The AI changed more than it was asked to (e.g. turned shorts into a skirt), so its picture can't be used cleanly. */
export class LookRejected extends Error {}

/**
 * Checks the AI's picture before using it: the new garment must really be there, and where the old garment
 * was, the AI must not have drawn other clothes (that area can't be restored from the photo).
 */
function check(before: { labels: Uint8Array }, after: { labels: Uint8Array }, garment: number[]) {
  const isGarment = new Set(garment);
  const other = new Set(CLOTHES.filter((c) => !isGarment.has(c)));
  let oldArea = 0, newArea = 0, conflict = 0;
  const n = Math.min(before.labels.length, after.labels.length);
  for (let i = 0; i < n; i++) {
    const b = before.labels[i], a = after.labels[i];
    if (isGarment.has(b)) oldArea++;
    if (isGarment.has(a)) newArea++;
    if (isGarment.has(b) && !isGarment.has(a) && other.has(a)) conflict++;
  }
  if (oldArea > 50 && newArea < oldArea * 0.35) throw new LookRejected('The AI did not draw the garment.');
  if (conflict > Math.max(30, newArea * 0.04)) throw new LookRejected('The AI changed other clothes too.');
}

function toCanvas(img: HTMLImageElement) {
  const canvas = createCanvas(img.naturalWidth, img.naturalHeight);
  context2d(canvas).drawImage(img, 0, 0);
  return canvas;
}

/**
 * The try-on AI fits the photo into its own frame (768×1024, centred on white) and may redraw more than
 * the garment (e.g. trousers when only a top was asked for). This puts its picture back onto the
 * original photo and keeps only the part that should change: the old and the new garment's area.
 * Returns a JPEG data URL the size of the original.
 */
export async function keepOnlyChanged(originalUrl: string, resultUrl: string, category: string): Promise<string> {
  const garment = GARMENT[category];
  const [originalImage, resultImage] = await Promise.all([loadImage(originalUrl), loadImage(resultUrl)]);
  const original = toCanvas(originalImage);
  const { width, height } = original;

  // Undo the AI's "fit and centre".
  const scale = Math.min(resultImage.naturalWidth / width, resultImage.naturalHeight / height);
  const fittedW = Math.floor(width * scale), fittedH = Math.floor(height * scale);
  const left = Math.floor((resultImage.naturalWidth - fittedW) / 2), top = Math.floor((resultImage.naturalHeight - fittedH) / 2);
  const result = createCanvas(width, height);
  const resultCtx = context2d(result);
  resultCtx.imageSmoothingQuality = 'high';
  resultCtx.drawImage(resultImage, left, top, fittedW, fittedH, 0, 0, width, height);
  if (!garment) return result.toDataURL('image/jpeg', 0.92);

  // One after the other: the parsing model runs one picture at a time.
  const before = await parseClothes(original);
  const after = await parseClothes(result);
  if (!before || !after) return result.toDataURL('image/jpeg', 0.92);

  check(before, after, garment);
  const layer = (parsing: typeof before, parts: number[]) => partMask(parsing, parts, width, height);
  // What may come from the AI.
  const change = createCanvas(width, height);
  const changeCtx = context2d(change);
  changeCtx.drawImage(layer(after, garment), 0, 0); // the new garment
  changeCtx.drawImage(layer(before, garment), 0, 0); // where the old one was
  const reveal = createCanvas(width, height); // limbs that show now but didn't before
  const revealCtx = context2d(reveal);
  revealCtx.drawImage(layer(after, LIMBS[category]), 0, 0);
  revealCtx.globalCompositeOperation = 'destination-out';
  revealCtx.drawImage(layer(before, LIMBS[category]), 0, 0);
  changeCtx.drawImage(reveal, 0, 0);
  changeCtx.globalCompositeOperation = 'destination-out';
  changeCtx.drawImage(layer(before, PROTECT), 0, 0);
  changeCtx.drawImage(layer(after, PROTECT), 0, 0);

  // Widen a little with a short soft edge, so the seam falls just outside the garment and doesn't show.
  const edge = Math.max(2, Math.round(Math.max(width, height) * 0.004));
  const soft = createCanvas(width, height);
  const softCtx = context2d(soft);
  softCtx.filter = `blur(${edge}px)`;
  softCtx.drawImage(change, 0, 0);
  const pixels = softCtx.getImageData(0, 0, width, height);
  for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = Math.min(255, pixels.data[i] * 3);
  softCtx.putImageData(pixels, 0, 0);

  // The photo everywhere; the AI's picture only inside the change.
  const taken = createCanvas(width, height);
  const takenCtx = context2d(taken);
  takenCtx.drawImage(result, 0, 0);
  takenCtx.globalCompositeOperation = 'destination-in';
  takenCtx.drawImage(soft, 0, 0);
  const out = createCanvas(width, height);
  const outCtx = context2d(out);
  outCtx.drawImage(original, 0, 0);
  outCtx.drawImage(taken, 0, 0);
  return out.toDataURL('image/jpeg', 0.92);
}
