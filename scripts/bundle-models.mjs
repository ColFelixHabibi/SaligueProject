// Copies the on-device AI models into public/models so the Android/iOS apps ship with them
// (no download on first use, works offline). The website loads the same files from their CDNs instead.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT = 'public/models';
const HF = 'https://huggingface.co';

const downloads = [
  [`${HF}/Xenova/modnet/resolve/main/onnx/model_quantized.onnx`, 'modnet.onnx'],
  [`${HF}/BritishWerewolf/U-2-Netp/resolve/main/onnx/model.onnx`, 'u2netp.onnx'],
  ['https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', 'pose_landmarker_lite.task'],
  ...['config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/vision_model.onnx', 'onnx/text_model_quantized.onnx'].map(
    (f) => [`${HF}/Xenova/mobileclip_s0/resolve/main/${f}`, `Xenova/mobileclip_s0/${f}`]
  ),
];

async function download(url, target) {
  const path = join(OUT, target);
  if (existsSync(path) && statSync(path).size > 0) return;
  mkdirSync(dirname(path), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} downloading ${url}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  console.log(`downloaded ${target}`);
}

function copyDir(from, to, filter = () => true) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (filter(name)) copyFileSync(join(from, name), join(to, name));
  }
}

for (const [url, target] of downloads) await download(url, target);

// WebAssembly runtimes for ONNX Runtime and MediaPipe.
copyDir('node_modules/onnxruntime-web/dist', join(OUT, 'ort'), (n) => /^ort-wasm.*\.(wasm|mjs)$/.test(n) && !n.includes('jspi'));
copyDir('node_modules/@mediapipe/tasks-vision/wasm', join(OUT, 'mediapipe'));
console.log('Models bundled in public/models');
