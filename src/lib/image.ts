'use client';

import { encodeCanvas, fileToImage, trimTransparent } from './ai/canvas';
import { removeBackground } from './ai/segment';
import { embedImage } from './ai/embed';
import type { Progress } from './ai/models';

// Product documents hold their photos inline and Firestore caps a document at 1 MiB,
// so the photo, cut-out and embedding together must stay well under that.
const PHOTO_MAX_LENGTH = 450_000;
const CUTOUT_MAX_LENGTH = 350_000;

/** Resizes and re-encodes an uploaded photo as a JPEG data URL. */
export async function compressImage(file: File): Promise<string> {
  const img = await fileToImage(file);
  return encodeCanvas(img, { transparent: false, maxLength: PHOTO_MAX_LENGTH, maxEdge: 1000 });
}

export type PreparedItemPhoto = { image: string; cutout: string; embedding: number[] };

/**
 * Prepares a seller's item photo on the device: compresses it, removes the background
 * (pixels unchanged) and computes its AI search fingerprint.
 */
export async function prepareItemPhoto(file: File, onProgress?: Progress): Promise<PreparedItemPhoto> {
  const img = await fileToImage(file);
  const image = encodeCanvas(img, { transparent: false, maxLength: PHOTO_MAX_LENGTH, maxEdge: 1000 });
  const cutoutCanvas = trimTransparent(await removeBackground(img, 'item', onProgress));
  const cutout = encodeCanvas(cutoutCanvas, { transparent: true, maxLength: CUTOUT_MAX_LENGTH, maxEdge: 700 });
  const embedding = await embedImage(cutoutCanvas, onProgress);
  return { image, cutout, embedding };
}
