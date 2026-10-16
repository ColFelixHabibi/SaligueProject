// Realistic try-on ("Make it realistic") through Leffa (MIT, Meta 2025): redraws the person wearing the garment.
// Uses Saligue's own AI Studio when one is set up (ai-server/, e.g. on a GPU server); until then, the public
// Leffa demo on Hugging Face, which needs no account but allows only a few free runs a day.
//   TRYON_SPACE   another Hugging Face Space with the same API (default franciszzj/Leffa)
//   HF_TOKEN      optional free Hugging Face token: more runs per day
// When Leffa is busy or its free daily limit is used up, tops and jackets fall back to IDM-VTON
// (yisol/IDM-VTON, CC BY-NC-SA 4.0), which also redraws the person wearing the garment.
import { Client, handle_file } from '@gradio/client';

const SPACE = process.env.TRYON_SPACE || 'franciszzj/Leffa';
const FALLBACK_SPACE = process.env.TRYON_FALLBACK_SPACE || 'yisol/IDM-VTON';
const auth = () => (process.env.HF_TOKEN ? { hf_token: process.env.HF_TOKEN } : undefined);

const clients = new Map();
async function connect(space) {
  if (!clients.has(space)) {
    const client = Client.connect(space, auth());
    client.catch(() => clients.delete(space));
    clients.set(space, client);
  }
  return clients.get(space);
}

async function download(url) {
  const response = await fetch(url, process.env.HF_TOKEN ? { headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` } } : undefined);
  if (!response.ok) throw new Error(`Could not download the result (${response.status}).`);
  const type = response.headers.get('content-type') || 'image/png';
  return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
}

const isBusy = (message) => /quota|exceeded|GPU|rate|queue|busy|limit/i.test(message);

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

async function leffa(person, garment, category) {
  const [model, kind] = GARMENT[category] ?? GARMENT.top;
  const app = await connect(SPACE);
  const result = await app.predict('/leffa_predict_vt', {
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
  const url = result?.data?.[0]?.url;
  if (!url) throw new Error('Leffa returned no picture.');
  return download(url);
}

// IDM-VTON dresses the upper body only (tops and jackets).
async function idmVton(person, garment, description) {
  const app = await connect(FALLBACK_SPACE);
  const result = await app.predict('/tryon', {
    dict: { background: handle_file(toBlob(person)), layers: [], composite: null },
    garm_img: handle_file(toBlob(garment)),
    garment_des: description || 'garment',
    is_checked: true,
    is_checked_crop: false,
    denoise_steps: 30,
    seed: 42,
  });
  const url = result?.data?.[0]?.url;
  if (!url) throw new Error('IDM-VTON returned no picture.');
  return download(url);
}

/** Returns the person wearing the garment, as a JPEG/PNG data URL. */
export async function tryOn(person, garment, category, description = '') {
  toBlob(person);
  toBlob(garment);
  let first;
  try {
    return await leffa(person, garment, category);
  } catch (error) {
    first = error;
    clients.delete(SPACE);
  }
  if (category === 'top' || category === 'outerwear') {
    try {
      return await idmVton(person, garment, description);
    } catch (error) {
      clients.delete(FALLBACK_SPACE);
      console.error('Realistic try-on fallback failed:', error?.message ?? error);
    }
  }
  const message = String(first?.message ?? first);
  if (isBusy(message)) {
    throw Object.assign(new Error('The free realistic AI is busy or its daily limit is used up. Try again later.'), { status: 503 });
  }
  throw Object.assign(new Error('The realistic AI could not dress you this time. Try again in a moment.'), { status: 502, cause: first });
}
