// Keeps Saligue fashion-only. The server itself looks at every listing photo with the same AI model the app
// uses for search (MobileCLIP), so a modified app can't skip the check, and checks the words used.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';
import { MEDIA_DIR } from './media.mjs';

const MODEL = 'Xenova/mobileclip_s0';

// What the photo is compared with. Fashion wins unless something else clearly looks more like it.
const FASHION = [
  'clothing', 'a t-shirt', 'a shirt', 'a blouse', 'a dress', 'a skirt', 'trousers', 'jeans', 'shorts', 'a jacket', 'a coat',
  'a suit', 'a sweater', 'a hoodie', 'traditional african fabric clothing', 'shoes', 'sneakers', 'boots', 'sandals', 'high heels',
  'a handbag', 'a backpack', 'a hat', 'a cap', 'sunglasses', 'glasses', 'a watch', 'jewelry', 'a necklace', 'earrings', 'a belt',
  'a scarf', 'a tie', 'socks', 'a person wearing clothes', 'a fashion model',
];
const OTHER = [
  'a mobile phone', 'a smartphone', 'a laptop computer', 'a television', 'a car', 'a motorcycle', 'a bicycle', 'food', 'a meal',
  'fruit and vegetables', 'furniture', 'a sofa', 'a bed', 'a house', 'a building', 'land', 'an animal', 'a dog', 'a cat', 'a cow',
  'a goat', 'a chicken', 'a kitchen appliance', 'a refrigerator', 'a toy', 'a book', 'a document', 'a drink bottle', 'electronics',
  'a phone charger', 'headphones', 'tools', 'a plant', 'medicine', 'money', 'a weapon', 'a screenshot of text',
];
// Share of the AI's belief that must go to fashion for a photo to be accepted.
const MIN_FASHION = 0.35;

let models = null;
function load() {
  if (!models) {
    models = (async () => {
      const [processor, vision, tokenizer, text] = await Promise.all([
        AutoProcessor.from_pretrained(MODEL),
        CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'fp32' }),
        AutoTokenizer.from_pretrained(MODEL),
        CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: 'q8' }),
      ]);
      const inputs = tokenizer([...FASHION, ...OTHER].map((l) => `a photo of ${l}`), { padding: 'max_length', truncation: true });
      const { text_embeds } = await text(inputs);
      return { processor, vision, labels: text_embeds.normalize().tolist() };
    })();
    models.catch((error) => {
      console.error('Fashion check unavailable:', error.message);
      models = null;
    });
  }
  return models;
}

/** Starts loading the model when the server starts, so the first listing isn't slow. */
export function warmUpFashionCheck() {
  load().catch(() => {});
}

function imageBytes(image) {
  if (image.startsWith('/media/')) return readFileSync(join(MEDIA_DIR, image.slice('/media/'.length)));
  const match = /^data:[^;,]+;base64,(.*)$/s.exec(image);
  if (match) return Buffer.from(match[1], 'base64');
  throw new Error('Unsupported image.');
}

/**
 * Looks at a product photo. Returns its AI fingerprint (used for search, so the stored one is the server's own)
 * and whether it shows a fashion item, with what it looks like most.
 */
export async function checkPhoto(image) {
  const { processor, vision, labels } = await load();
  // Square on white, like the app does, so nothing is cropped off.
  const { data, info } = await sharp(imageBytes(image))
    .flatten({ background: '#ffffff' })
    .resize(256, 256, { fit: 'contain', background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3);
  const { image_embeds } = await vision(await processor(raw));
  const embedding = Array.from(image_embeds.normalize().data).map((v) => Math.round(v * 1e5) / 1e5);

  const scores = labels.map((l) => 100 * l.reduce((sum, v, i) => sum + v * embedding[i], 0));
  const top = Math.max(...scores);
  const weights = scores.map((s) => Math.exp(s - top));
  const total = weights.reduce((a, b) => a + b, 0);
  const fashion = weights.slice(0, FASHION.length).reduce((a, b) => a + b, 0) / total;
  const best = scores.indexOf(top);
  const looksLike = best < FASHION.length ? FASHION[best] : OTHER[best - FASHION.length];
  return { embedding, fashion: fashion >= MIN_FASHION, confidence: Math.round(fashion * 100) / 100, looksLike };
}

// Words that clearly mean a listing isn't fashion (checked as whole words in the name and description).
const NOT_FASHION_WORDS = [
  'iphone', 'samsung galaxy', 'smartphone', 'laptop', 'macbook', 'computer', 'television', 'tv', 'playstation', 'xbox',
  'car', 'toyota', 'motorcycle', 'moto', 'bicycle', 'house', 'apartment', 'land', 'plot', 'for rent', 'rental',
  'fridge', 'refrigerator', 'sofa', 'mattress', 'furniture', 'cooker', 'gas cylinder', 'rice', 'beans', 'flour', 'sugar',
  'chicken', 'goat', 'cow', 'pig', 'puppy', 'cement', 'airtime', 'loan', 'crypto', 'bitcoin', 'medicine', 'drugs', 'gun',
];
const WORD_PATTERN = new RegExp(`\\b(${NOT_FASHION_WORDS.map((w) => w.replace(/\s+/g, '\\s+')).join('|')})\\b`, 'i');

/** The first non-fashion word found in the text, if any. */
export function notFashionWord(...texts) {
  return WORD_PATTERN.exec(texts.filter(Boolean).join(' '))?.[1]?.toLowerCase() ?? null;
}
