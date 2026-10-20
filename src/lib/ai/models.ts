'use client';

import { BASE_PATH } from '@/lib/paths';

// The Android/iOS apps ship the model files inside the app (scripts/bundle-models.mjs, BUNDLED).
// The website serves the same files itself from /models (SELF_HOSTED, the default), so the Fitting Room never
// depends on another site's download servers; browsers cache them after the first visit.
// NEXT_PUBLIC_SELF_HOSTED_MODELS=0 loads them from their public hosts instead (e.g. a static host without the files).
export const BUNDLED = process.env.NEXT_PUBLIC_BUNDLED_MODELS === '1';
const SELF_HOSTED = BUNDLED || process.env.NEXT_PUBLIC_SELF_HOSTED_MODELS !== '0';
// The apps can load the models from the Saligue server instead of shipping them (NEXT_PUBLIC_MODELS_URL).
export const LOCAL_MODELS = process.env.NEXT_PUBLIC_MODELS_URL || `${BASE_PATH}/models`;

// The AI engine is served by the website itself (scripts/copy-ort.mjs), or shipped inside the apps.
export const ORT_WASM_PATH = BUNDLED ? `${LOCAL_MODELS}/ort/` : `${BASE_PATH}/ort/`;

// Open models that run on the user's device.
export const MODELS = {
  // MODNet portrait matting (Apache-2.0): cuts a person out of a photo.
  person: SELF_HOSTED ? `${LOCAL_MODELS}/modnet.onnx` : 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model_quantized.onnx',
  // U-2-Netp salient object segmentation (Apache-2.0): cuts out clothes, shoes and accessories.
  item: SELF_HOSTED ? `${LOCAL_MODELS}/u2netp.onnx` : 'https://huggingface.co/BritishWerewolf/U-2-Netp/resolve/main/onnx/model.onnx',
  // SegFormer-B2 clothes parsing (Transformers.js port): finds hair, face, arms, legs and the clothes being worn,
  // so new clothes replace the old ones instead of being pasted over them.
  clothes: SELF_HOSTED ? `${LOCAL_MODELS}/clothes.onnx` : 'https://huggingface.co/Xenova/segformer_b2_clothes/resolve/main/onnx/model_quantized.onnx',
  // MediaPipe Pose Landmarker lite (Apache-2.0): body landmarks used to dress the person.
  pose: SELF_HOSTED
    ? `${LOCAL_MODELS}/pose_landmarker_lite.task`
    : 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  poseWasm: SELF_HOSTED ? `${LOCAL_MODELS}/mediapipe` : 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
  // MobileCLIP-S0 (Apple, Transformers.js port): image/text embeddings for AI search.
  clip: 'Xenova/mobileclip_s0',
} as const;
export const CLIP_LOCAL = SELF_HOSTED;
const CACHE_NAME = 'saligue-models-v1';

export type Progress = (message: string) => void;

// Fetches a model file, keeping a copy in Cache Storage so later visits work offline and instantly.
export async function fetchModel(url: string, onProgress?: Progress): Promise<ArrayBuffer> {
  // Bundled files are already on the device.
  if (BUNDLED) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Missing bundled AI model (${response.status}).`);
    return response.arrayBuffer();
  }
  let cache: Cache | undefined;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    // Cache Storage unavailable (e.g. private mode); download every time.
  }

  onProgress?.('Downloading AI model (first time only)…');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download AI model (${response.status}).`);
  const buffer = await response.arrayBuffer();
  try {
    await cache?.put(url, new Response(buffer.slice(0)));
  } catch {
    // Quota exceeded; keep working without caching.
  }
  return buffer;
}

type OrtModule = typeof import('onnxruntime-web/wasm');
let ortPromise: Promise<OrtModule> | null = null;

export function loadOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    // The plain CPU build: half the download of the default (WebGPU-capable) one, which isn't used here.
    ortPromise = import('onnxruntime-web/wasm').then((ort) => {
      ort.env.wasm.wasmPaths = ORT_WASM_PATH;
      // Multi-threading needs cross-origin isolation, which static hosting can't provide.
      ort.env.wasm.numThreads = 1;
      return ort;
    });
  }
  return ortPromise;
}

const sessions = new Map<string, Promise<import('onnxruntime-web').InferenceSession>>();

export function loadSession(url: string, onProgress?: Progress) {
  let session = sessions.get(url);
  if (!session) {
    session = (async () => {
      const [ort, buffer] = await Promise.all([loadOrt(), fetchModel(url, onProgress)]);
      onProgress?.('Starting AI model…');
      return ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });
    })();
    session.catch(() => sessions.delete(url));
    sessions.set(url, session);
  }
  return session;
}
