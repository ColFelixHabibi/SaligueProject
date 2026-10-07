'use client';

import { BUNDLED, LOCAL_MODELS, MODELS, ORT_WASM_PATH, type Progress } from './models';
import { squareOnBackground, type ImageSource } from './canvas';

type Transformers = typeof import('@huggingface/transformers');
let transformersPromise: Promise<Transformers> | null = null;

function loadTransformers() {
  if (!transformersPromise) {
    transformersPromise = import('@huggingface/transformers').then((t) => {
      if (BUNDLED) {
        t.env.allowLocalModels = true;
        t.env.allowRemoteModels = false;
        t.env.localModelPath = `${LOCAL_MODELS}/`;
      } else {
        t.env.allowLocalModels = false;
      }
      const wasm = t.env.backends.onnx.wasm;
      if (wasm) wasm.wasmPaths = ORT_WASM_PATH;
      return t;
    });
  }
  return transformersPromise;
}

let visionPromise: Promise<[any, any]> | null = null;
let textPromise: Promise<[any, any]> | null = null;

function loadVision(onProgress?: Progress) {
  if (!visionPromise) {
    onProgress?.('Loading AI search model (first time only)…');
    visionPromise = loadTransformers().then((t) =>
      Promise.all([
        t.AutoProcessor.from_pretrained(MODELS.clip),
        t.CLIPVisionModelWithProjection.from_pretrained(MODELS.clip, { dtype: 'fp32', device: 'wasm' }),
      ])
    );
    visionPromise.catch(() => (visionPromise = null));
  }
  return visionPromise;
}

function loadText(onProgress?: Progress) {
  if (!textPromise) {
    onProgress?.('Loading AI text search (first time only)…');
    textPromise = loadTransformers().then((t) =>
      Promise.all([
        t.AutoTokenizer.from_pretrained(MODELS.clip),
        t.CLIPTextModelWithProjection.from_pretrained(MODELS.clip, { dtype: 'q8', device: 'wasm' }),
      ])
    );
    textPromise.catch(() => (textPromise = null));
  }
  return textPromise;
}

/** 512-number fingerprint of an image's look (unit length), used for visual search. */
export async function embedImage(source: ImageSource, onProgress?: Progress): Promise<number[]> {
  const t = await loadTransformers();
  const [processor, model] = await loadVision(onProgress);
  onProgress?.('Analysing the style…');
  // Square, white background: the processor center-crops, which would otherwise cut items off.
  const square = squareOnBackground(source, 256);
  const image = await t.RawImage.fromCanvas(square);
  const inputs = await processor(image);
  const { image_embeds } = await model(inputs);
  return Array.from(image_embeds.normalize().data as Float32Array).map((v) => Math.round(v * 1e5) / 1e5);
}

/** Fingerprint of a text query in the same space as embedImage. */
export async function embedText(text: string, onProgress?: Progress): Promise<number[]> {
  const [tokenizer, model] = await loadText(onProgress);
  const inputs = tokenizer([`a photo of ${text}`], { padding: 'max_length', truncation: true });
  const { text_embeds } = await model(inputs);
  return Array.from(text_embeds.normalize().data as Float32Array);
}

export function cosine(a: number[], b: number[]): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

/** Starts downloading the search models in the background so the first search feels instant. */
export function warmUpSearch() {
  loadVision().catch(() => {});
  loadText().catch(() => {});
}
