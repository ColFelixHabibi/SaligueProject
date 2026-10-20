'use client';

import { context2d, createCanvas, loadImage } from './canvas';
import { PART, parseClothes, partMask } from './parse';

// What must stay exactly as photographed for each kind of item: face, hair, shoes and the clothes not being
// changed. Everything else comes from the AI's picture, so the new garment (sleeves included) is always whole
// and never mixed with the old one.
const KEEP_PARTS: Record<string, number[]> = {
  top: [PART.background, PART.hat, PART.hair, PART.sunglasses, PART.face, PART.skirt, PART.pants, PART.leftShoe, PART.rightShoe, PART.leftLeg, PART.rightLeg, PART.bag, PART.belt],
  outerwear: [PART.background, PART.hat, PART.hair, PART.sunglasses, PART.face, PART.skirt, PART.pants, PART.leftShoe, PART.rightShoe, PART.leftLeg, PART.rightLeg, PART.bag, PART.belt],
  bottom: [PART.background, PART.hat, PART.hair, PART.sunglasses, PART.face, PART.upperClothes, PART.leftArm, PART.rightArm, PART.leftShoe, PART.rightShoe, PART.bag, PART.scarf],
  dress: [PART.background, PART.hat, PART.hair, PART.sunglasses, PART.face, PART.leftShoe, PART.rightShoe, PART.bag],
};
// Bare skin the AI may redraw: kept from the photo wherever it is skin in both pictures (real skin tone,
// bracelets, rings, hands), and taken from the AI only where the new garment changes what shows (longer or
// shorter sleeves or legs).
const SKIN_PARTS: Record<string, number[]> = {
  top: [PART.leftArm, PART.rightArm],
  outerwear: [PART.leftArm, PART.rightArm],
  bottom: [PART.leftLeg, PART.rightLeg],
  dress: [PART.leftArm, PART.rightArm, PART.leftLeg, PART.rightLeg],
};
// The new garment as the AI drew it: never covered by the old photo, even where the old clothes were.
const NEW_GARMENT: Record<string, number[]> = {
  top: [PART.upperClothes, PART.scarf],
  outerwear: [PART.upperClothes, PART.scarf],
  bottom: [PART.pants, PART.skirt, PART.belt],
  dress: [PART.dress, PART.upperClothes, PART.skirt, PART.pants],
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
  const keep = KEEP_PARTS[category];
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
  if (!keep) return result.toDataURL('image/jpeg', 0.92);

  // One after the other: the parsing model runs one picture at a time.
  const before = await parseClothes(original);
  const after = await parseClothes(result);
  if (!before || !after) return result.toDataURL('image/jpeg', 0.92);

  // What to keep from the photo: the unchanged parts as photographed, minus wherever the new garment now is.
  const mask = createCanvas(width, height);
  const maskCtx = context2d(mask);
  maskCtx.drawImage(partMask(before, keep, width, height), 0, 0);
  const skin = createCanvas(width, height);
  const skinCtx = context2d(skin);
  skinCtx.drawImage(partMask(before, SKIN_PARTS[category], width, height), 0, 0);
  skinCtx.globalCompositeOperation = 'destination-in';
  skinCtx.drawImage(partMask(after, SKIN_PARTS[category], width, height), 0, 0);
  maskCtx.drawImage(skin, 0, 0);
  maskCtx.globalCompositeOperation = 'destination-out';
  maskCtx.drawImage(partMask(after, NEW_GARMENT[category], width, height), 0, 0);
  // Shrink it a little with a soft edge, so the borders come from the AI's picture (no halos or ghost edges).
  const edge = Math.max(2, Math.round(Math.max(width, height) * 0.004));
  const soft = createCanvas(width, height);
  const softCtx = context2d(soft);
  softCtx.filter = `blur(${edge}px)`;
  softCtx.drawImage(mask, 0, 0);
  const pixels = softCtx.getImageData(0, 0, width, height);
  for (let i = 3; i < pixels.data.length; i += 4) {
    // Only clearly-kept pixels stay; the blurred rim fades out quickly instead of half-mixing two pictures.
    pixels.data[i] = Math.max(0, Math.min(255, (pixels.data[i] - 140) * 2.2));
  }
  softCtx.putImageData(pixels, 0, 0);

  // The AI's picture everywhere, the original photo on top only where it must stay the same.
  const kept = createCanvas(width, height);
  const keptCtx = context2d(kept);
  keptCtx.drawImage(original, 0, 0);
  keptCtx.globalCompositeOperation = 'destination-in';
  keptCtx.drawImage(soft, 0, 0);
  const out = createCanvas(width, height);
  const outCtx = context2d(out);
  outCtx.drawImage(result, 0, 0);
  outCtx.drawImage(kept, 0, 0);
  return out.toDataURL('image/jpeg', 0.92);
}
