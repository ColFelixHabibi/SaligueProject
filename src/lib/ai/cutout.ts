'use client';

import type { Product } from '@/lib/types';
import { context2d, createCanvas, loadImage, trimTransparent } from './canvas';
import { removeBackground } from './segment';

// Dressing is CPU heavy; run one at a time so the page stays responsive.
let queue: Promise<unknown> = Promise.resolve();
export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

const itemCutouts = new Map<string, Promise<HTMLCanvasElement>>();

function toCanvas(img: HTMLImageElement) {
  const canvas = createCanvas(img.naturalWidth, img.naturalHeight);
  context2d(canvas).drawImage(img, 0, 0);
  return canvas;
}

/** The item without background: stored by the seller, or computed here for older listings. */
export function itemCutout(product: Product) {
  let cutout = itemCutouts.get(product.id);
  if (!cutout) {
    cutout = product.cutout
      ? loadImage(product.cutout).then(toCanvas)
      : loadImage(product.image).then(async (img) => trimTransparent(await removeBackground(img, 'item')));
    cutout.catch(() => itemCutouts.delete(product.id));
    itemCutouts.set(product.id, cutout);
  }
  return cutout;
}
