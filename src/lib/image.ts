'use client';

import { encodeCanvas, fileToImage } from './ai/canvas';
import { embedImage } from './ai/embed';
import type { Progress } from './ai/models';

// Sharp enough for zooming on phones, small enough for fast uploads (the server accepts up to 1.5 MB).
const PHOTO_MAX_LENGTH = 900_000;

/** Resizes and re-encodes an uploaded photo as a JPEG data URL. */
export async function compressImage(file: File): Promise<string> {
  const img = await fileToImage(file);
  return encodeCanvas(img, { transparent: false, maxLength: PHOTO_MAX_LENGTH, maxEdge: 1000 });
}

export type PreparedItemPhoto = { image: string; cutout?: string; embedding: number[] };

/**
 * Prepares a seller's item photo on the device: the photo is kept as taken (the item alone or someone wearing
 * it, background included), only resized, and its AI search fingerprint is computed.
 */
export async function prepareItemPhoto(file: File, onProgress?: Progress): Promise<PreparedItemPhoto> {
  const img = await fileToImage(file);
  const image = encodeCanvas(img, { transparent: false, maxLength: PHOTO_MAX_LENGTH, maxEdge: 1400 });
  const embedding = await embedImage(img, onProgress);
  return { image, embedding };
}
