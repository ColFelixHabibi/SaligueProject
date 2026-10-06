'use client';

// Open models that run on the user's device. Downloaded once, then served from the browser cache.
export const MODELS = {
  // MODNet portrait matting (Apache-2.0): cuts a person out of a photo.
  person: 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model_quantized.onnx',
  // U-2-Netp salient object segmentation (Apache-2.0): cuts out clothes, shoes and accessories.
  item: 'https://huggingface.co/BritishWerewolf/U-2-Netp/resolve/main/onnx/model.onnx',
  // MediaPipe Pose Landmarker lite (Apache-2.0): body landmarks used to dress the person.
  pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  poseWasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
  // MobileCLIP-S0 (Apple, Transformers.js port): image/text embeddings for AI search.
  clip: 'Xenova/mobileclip_s0',
} as const;

const ORT_VERSION = '1.31.0-dev.20260914-8d85527a0';
const CACHE_NAME = 'saligue-models-v1';

export type Progress = (message: string) => void;

// Fetches a model file, keeping a copy in Cache Storage so later visits work offline and instantly.
export async function fetchModel(url: string, onProgress?: Progress): Promise<ArrayBuffer> {
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

type OrtModule = typeof import('onnxruntime-web');
let ortPromise: Promise<OrtModule> | null = null;

export function loadOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web').then((ort) => {
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
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
