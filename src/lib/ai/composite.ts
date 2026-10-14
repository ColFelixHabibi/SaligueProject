'use client';

import { context2d, createCanvas, loadImage } from './canvas';
import { PART, parseClothes, partMask } from './parse';

// What a realistic try-on of each kind of item may change; everything else stays exactly as photographed.
// Arms and legs are included because new sleeves or trouser legs can be longer or shorter than the old ones.
const CHANGED_PARTS: Record<string, number[]> = {
  top: [PART.upperClothes, PART.leftArm, PART.rightArm, PART.scarf],
  outerwear: [PART.upperClothes, PART.leftArm, PART.rightArm, PART.scarf],
  bottom: [PART.pants, PART.skirt, PART.belt, PART.leftLeg, PART.rightLeg],
  dress: [
    PART.upperClothes, PART.dress, PART.skirt, PART.pants, PART.belt, PART.scarf,
    PART.leftArm, PART.rightArm, PART.leftLeg, PART.rightLeg,
  ],
};

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
  const parts = CHANGED_PARTS[category];
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
  if (!parts) return result.toDataURL('image/jpeg', 0.92);

  // One after the other: the parsing model runs one picture at a time.
  const before = await parseClothes(original);
  const after = await parseClothes(result);
  if (!before || !after) return result.toDataURL('image/jpeg', 0.92);

  // Where the old garment was or the new one is, slightly widened with a soft edge.
  const mask = createCanvas(width, height);
  const maskCtx = context2d(mask);
  maskCtx.drawImage(partMask(before, parts, width, height), 0, 0);
  maskCtx.drawImage(partMask(after, parts, width, height), 0, 0);
  const grow = createCanvas(width, height);
  const growCtx = context2d(grow);
  growCtx.filter = `blur(${Math.max(2, Math.round(Math.max(width, height) * 0.006))}px)`;
  growCtx.drawImage(mask, 0, 0);
  const soft = growCtx.getImageData(0, 0, width, height);
  for (let i = 3; i < soft.data.length; i += 4) soft.data[i] = Math.min(255, soft.data[i] * 2.5);
  growCtx.putImageData(soft, 0, 0);

  // The AI's picture inside that area, the original photo everywhere else.
  const changed = createCanvas(width, height);
  const changedCtx = context2d(changed);
  changedCtx.drawImage(result, 0, 0);
  changedCtx.globalCompositeOperation = 'destination-in';
  changedCtx.drawImage(grow, 0, 0);
  const out = createCanvas(width, height);
  const outCtx = context2d(out);
  outCtx.drawImage(original, 0, 0);
  outCtx.drawImage(changed, 0, 0);
  return out.toDataURL('image/jpeg', 0.92);
}
