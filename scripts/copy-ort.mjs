// Copies the AI engine (onnxruntime-web's WebAssembly files) into public/ort so the website serves it itself,
// instead of downloading it from a CDN on every first visit. Runs before `dev` and `build`.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FROM = 'node_modules/onnxruntime-web/dist';
const TO = 'public/ort';
mkdirSync(TO, { recursive: true });
// CPU builds (on-device dressing) and the JSEP build Transformers.js loads (AI search).
for (const name of readdirSync(FROM)) {
  if (/^ort-wasm-simd-threaded(\.jsep|\.asyncify)?\.(wasm|mjs)$/.test(name)) copyFileSync(join(FROM, name), join(TO, name));
}
