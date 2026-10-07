'use client';

import { supabase } from './supabase';

// An item's sound: up to 30 seconds taken from the seller's music or from the soundtrack of a video,
// encoded on the device as a small MP3 and stored next to the product (productAudio/{productId}).

export const CLIP_SECONDS = 30;
const SAMPLE_RATE = 22050;
const KBPS = 48;

export type SoundSource = { buffer: AudioBuffer; name: string };

/** Decodes a music file, or the sound of a video file. */
export async function readSoundFile(file: File): Promise<SoundSource> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    return { buffer, name: file.name.replace(/\.[^.]+$/, '') };
  } catch {
    throw new Error('Could not read the sound in this file. Try another song or video.');
  } finally {
    context.close().catch(() => {});
  }
}

/** Renders the chosen 30 seconds (mono, gentle fade in and out). */
async function renderClip(source: AudioBuffer, start: number) {
  const seconds = Math.min(CLIP_SECONDS, Math.max(1, source.duration - start));
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const node = offline.createBufferSource();
  node.buffer = source;
  const gain = offline.createGain();
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(1, 0.4);
  gain.gain.setValueAtTime(1, Math.max(0.4, seconds - 0.8));
  gain.gain.linearRampToValueAtTime(0, seconds);
  node.connect(gain).connect(offline.destination);
  node.start(0, start, seconds);
  return offline.startRendering();
}

/** Encodes the chosen part of the sound as an MP3 data URL. */
export async function makeClip(source: AudioBuffer, start: number): Promise<{ data: string; duration: number }> {
  const rendered = await renderClip(source, start);
  const samples = rendered.getChannelData(0);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;

  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const encoder = new Mp3Encoder(1, SAMPLE_RATE, KBPS);
  const parts: BlobPart[] = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const chunk = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
    if (chunk.length) parts.push(new Uint8Array(chunk));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));

  const blob = new Blob(parts, { type: 'audio/mpeg' });
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { data, duration: rendered.duration };
}

/** Plays the chosen part once so the seller can hear it. Returns a stop function. */
export function previewClip(source: AudioBuffer, start: number) {
  const context = new AudioContext();
  const node = context.createBufferSource();
  node.buffer = source;
  node.connect(context.destination);
  node.start(0, start, CLIP_SECONDS);
  const stop = () => {
    try {
      node.stop();
    } catch {
      // Already stopped.
    }
    context.close().catch(() => {});
  };
  node.onended = stop;
  return stop;
}

export async function saveProductSound(productId: string, sellerId: string, name: string, clip: { data: string; duration: number }) {
  const { error } = await supabase.from('product_audio').upsert({ product_id: productId, seller_id: sellerId, data: clip.data, name: name.slice(0, 80), duration: clip.duration });
  if (error) throw error;
}

const loaded = new Map<string, Promise<string | null>>();

/** The sound of a product as a playable URL (cached), or null if it has none. */
export function loadProductSound(productId: string) {
  let sound = loaded.get(productId);
  if (!sound) {
    const query = supabase.from('product_audio').select('data').eq('product_id', productId).maybeSingle();
    const fetched: Promise<string | null> = Promise.resolve(query)
      .then(({ data, error }) => (error ? null : ((data?.data as string | undefined) ?? null)))
      .catch(() => null);
    sound = fetched;
    loaded.set(productId, fetched);
  }
  return sound;
}
