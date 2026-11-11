'use client';

import { create } from 'zustand';
import type { Product, ProductInput } from '@/lib/types';
import { api, mediaUrl, onServerEvent } from '@/lib/api';

interface ProductState {
  products: Product[];
  isInitialized: boolean;
  // Every page of the catalogue has arrived.
  complete: boolean;
  error: string | null;
  addProduct: (item: ProductInput) => Promise<string>;
  updateProduct: (id: string, updatedProduct: ProductInput) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  archiveProduct: (id: string) => Promise<void>;
}

// The AI fingerprints come apart from the catalogue (small, cached by the browser until items change) and are
// added to the items when they arrive: "looks like", search and outfits use them; the feed shows before.
let fingerprints = new Map<string, number[]>();
let fingerprintsLoading: Promise<void> | null = null;
function withFingerprints(products: Product[]) {
  return fingerprints.size ? products.map((p) => (fingerprints.has(p.id) ? { ...p, embedding: fingerprints.get(p.id) } : p)) : products;
}
function loadFingerprints() {
  fingerprintsLoading ??= api<Record<string, string>>('/products/fingerprints', { timeoutMs: 45_000 })
    .then((all) => {
      fingerprints = new Map(Object.entries(all).map(([id, b64]) => [id, Array.from(new Int8Array(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer))]));
      useProductStore.setState((s) => ({ products: withFingerprints(s.products) }));
    })
    .catch(() => {})
    .finally(() => { fingerprintsLoading = null; });
  return fingerprintsLoading;
}

const withMediaUrls = (p: Product): Product => ({ ...p, image: mediaUrl(p.image), cutout: mediaUrl(p.cutout), sellerAvatar: mediaUrl(p.sellerAvatar), video: mediaUrl(p.video), videoPoster: mediaUrl(p.videoPoster) });

// The catalogue in pages of 250 (newest first): the first page shows at once, the rest arrive in the background.
const PAGE = 250;
// Saving an item sends its photo inside the body (up to 900 000 characters, src/lib/image.ts), which takes far longer
// over a phone connection than a usual call: it is given room instead of being cut off half-way.
const SAVE_MS = 90_000;
let loadRun = 0;
async function reload() {
  const run = ++loadRun;
  let all: Product[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let page: Product[];
    try {
      page = (await api<Product[]>(`/products?limit=${PAGE}&offset=${offset}`, { timeoutMs: 45_000 })).map(withMediaUrls);
    } catch (error) {
      // A newer reload started (an item changed): this one stops.
      if (run !== loadRun) return;
      // The first page is the catalogue itself: without it there is nothing to show, so the caller reports it.
      // A later page failing (a connection dropped half-way, one hiccup) keeps everything already on screen rather
      // than replacing a working feed with an error.
      if (!offset) throw error;
      useProductStore.setState({ complete: true });
      return;
    }
    // A newer reload started (an item changed): this one stops.
    if (run !== loadRun) return;
    all = offset ? [...all, ...page] : page;
    useProductStore.setState({ products: withFingerprints(all), isInitialized: true, error: null, complete: page.length < PAGE });
    if (!offset) void loadFingerprints();
    if (page.length < PAGE) return;
  }
}

/** A load that failed: the error is only shown when nothing arrived, so it can never cover a catalogue that is
 *  already on screen ("Check your connection" over a feed that was working). */
function failed(error: unknown) {
  const loaded = useProductStore.getState().products.length > 0;
  const message = (error as Error)?.message || 'The items could not be loaded.';
  useProductStore.setState({ isInitialized: true, error: loaded ? null : message });
}

/** One item that may not be loaded yet (a shared link): fetched alone and added to the catalogue. */
export async function ensureProduct(id: string) {
  if (useProductStore.getState().products.some((p) => p.id === id)) return;
  try {
    const p = withMediaUrls(await api<Product>(`/products/${id}`));
    useProductStore.setState((s) => (s.products.some((x) => x.id === id) ? s : { products: withFingerprints([...s.products, p]) }));
  } catch {
    // Gone: the page says so.
  }
}

export const useProductStore = create<ProductState>()(() => ({
  products: [],
  isInitialized: false,
  complete: false,
  error: null,
  addProduct: async (item) => {
    const { id } = await api<{ id: string }>('/products', { body: item, timeoutMs: SAVE_MS });
    await reload();
    return id;
  },
  updateProduct: async (id, updatedProduct) => {
    // seller, official and likeCount are managed by the server.
    const { sellerId: _sellerId, official: _official, likeCount: _likeCount, shop: _shop, sellerAvatar: _avatar, rating: _rating, ratingCount: _ratingCount, video: _video, videoPoster: _poster, videoDuration: _duration, sold: _sold, sample: _sample, deal: _deal, ...fields } = updatedProduct;
    // The fingerprint from the catalogue is a rounded copy: only a new photo's fingerprint is sent.
    if (fields.embedding && fields.embedding === useProductStore.getState().products.find((p) => p.id === id)?.embedding) delete fields.embedding;
    await api(`/products/${id}`, { method: 'PATCH', body: fields, timeoutMs: SAVE_MS });
    await reload();
  },
  deleteProduct: async (id) => {
    await api(`/products/${id}`, { method: 'DELETE' });
    await reload();
  },
  archiveProduct: async (id) => {
    await api(`/products/${id}`, { method: 'PATCH', body: { status: 'archived' } });
    await reload();
  },
}));

/** Loads the catalog and keeps it up to date while the app is open. */
export function subscribeToProducts() {
  const load = () =>
    reload().catch((error) => {
      console.error('Failed to load products:', error);
      failed(error);
    });
  void load();
  return onServerEvent('products', () => void load());
}

export function retryProducts() {
  useProductStore.setState({ isInitialized: false, error: null });
  void reload().catch(failed);
}
