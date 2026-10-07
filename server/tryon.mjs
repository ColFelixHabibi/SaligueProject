// Realistic try-on ("Make it realistic") through Leffa (MIT, Meta 2025): redraws the person wearing the garment.
// Uses Saligue's own AI Studio when one is set up (ai-server/, e.g. on a GPU server); until then, the public
// Leffa demo on Hugging Face, which needs no account but allows only a few free runs a day.
//   TRYON_SPACE   another Hugging Face Space with the same API (default franciszzj/Leffa)
//   HF_TOKEN      optional free Hugging Face token: more runs per day
import { Client, handle_file } from '@gradio/client';

const SPACE = process.env.TRYON_SPACE || 'franciszzj/Leffa';

let client = null;
async function connect() {
  if (!client) {
    client = Client.connect(SPACE, process.env.HF_TOKEN ? { hf_token: process.env.HF_TOKEN } : undefined);
    client.catch(() => (client = null));
  }
  return client;
}

// Leffa has two models: VITON-HD (tops only, best quality) and DressCode (tops, trousers and dresses).
const GARMENT = {
  top: ['viton_hd', 'upper_body'],
  outerwear: ['viton_hd', 'upper_body'],
  bottom: ['dress_code', 'lower_body'],
  dress: ['dress_code', 'dresses'],
};
export const REALISTIC_CATEGORIES = Object.keys(GARMENT);

function toBlob(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl ?? ''));
  if (!match) throw Object.assign(new Error('Invalid image.'), { status: 400 });
  const bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
  return new Blob([bytes], { type: match[1] || 'image/jpeg' });
}

/** Returns the person wearing the garment, as a JPEG/PNG data URL. */
export async function tryOn(person, garment, category) {
  const [model, kind] = GARMENT[category] ?? GARMENT.top;
  const app = await connect();
  let result;
  try {
    result = await app.predict('/leffa_predict_vt', {
      src_image_path: handle_file(toBlob(person)),
      ref_image_path: handle_file(toBlob(garment)),
      ref_acceleration: false,
      step: 30,
      scale: 2.5,
      seed: 42,
      vt_model_type: model,
      vt_garment_type: kind,
      vt_repaint: false,
    });
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/quota|exceeded|GPU|rate/i.test(message)) {
      throw Object.assign(new Error('The free realistic AI is busy or its daily limit is used up. Try again later.'), { status: 503 });
    }
    client = null;
    throw Object.assign(new Error('The realistic AI could not dress you this time. Try again in a moment.'), { status: 502, cause: error });
  }
  const url = result?.data?.[0]?.url;
  if (!url) throw Object.assign(new Error('The realistic AI returned no picture.'), { status: 502 });
  const response = await fetch(url, process.env.HF_TOKEN ? { headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` } } : undefined);
  const type = response.headers.get('content-type') || 'image/png';
  return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
}
