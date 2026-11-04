'use client';

// Saving a picture (a try-on look, an item photo). On the web: a normal download. In the Android/iOS app the
// in-app browser can't download, so the picture is written to the phone and the share menu opens, where
// "Save to Gallery / Photos", WhatsApp and the rest are.

const isNative = () => (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;

async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Saves an image (data:, blob: or https: link) under `name`. Throws only if it really can't. */
export async function saveImage(url: string, name: string) {
  if (isNative()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const data = (await toDataUrl(url)).split(',')[1];
    const file = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
    try {
      await Share.share({ title: 'Saligue', files: [file.uri], dialogTitle: 'Save or share' });
    } catch (error) {
      if (!/cancel/i.test(String((error as Error)?.message))) throw error;
    }
    return;
  }
  // Web: links from another site can't be downloaded directly, so they go through a blob first.
  const href = url.startsWith('http') && !url.startsWith(window.location.origin) ? URL.createObjectURL(await (await fetch(url)).blob()) : url;
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (href !== url) setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * Download: an item's picture (or video) with the Saligue logo and the shop's name, made by the server.
 * In the phone app it goes straight into the gallery (Pictures/Saligue, Movies/Saligue); on older phones and
 * if that fails, through the share menu; on the web, as a normal download.
 * Returns where it went: 'gallery' | 'shared' | 'downloaded'.
 */
export async function downloadItem(productId: string, name: string, kind: 'image' | 'video') {
  const { apiUrl, getToken, ApiError } = await import('@/lib/api');
  const url = apiUrl(`/products/${productId}/download${kind === 'video' ? '?kind=video' : ''}`);
  const token = getToken();
  const mime = kind === 'video' ? 'video/mp4' : 'image/jpeg';
  const file = `saligue-${name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item'}.${kind === 'video' ? 'mp4' : 'jpg'}`;
  if (isNative()) {
    const { registerPlugin } = await import('@capacitor/core');
    const Gallery = registerPlugin<{ saveFromUrl(o: { url: string; name: string; mime: string; auth?: string }): Promise<{ uri: string }> }>('Gallery');
    const absolute = url.startsWith('http') ? url : new URL(url, window.location.href).toString();
    try {
      await Gallery.saveFromUrl({ url: absolute, name: file, mime, auth: token ?? undefined });
      return 'gallery' as const;
    } catch (error) {
      const code = String((error as Error)?.message ?? '');
      if (code.includes('too_many_downloads')) throw new ApiError(429, 'too_many_downloads', 'You downloaded a lot just now. Try again in an hour.');
      // Older Android (or the gallery refused): the share menu, where "Save" is.
    }
  }
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'same-origin' }).catch(() => null);
  if (!response) throw new ApiError(0, 'unavailable', 'No connection to Saligue. Check your network and try again.');
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.error?.code ?? 'server_error', data?.error?.message ?? 'This item can’t be downloaded right now.');
  }
  const blob = URL.createObjectURL(await response.blob());
  try {
    await saveImage(blob, file);
  } finally {
    setTimeout(() => URL.revokeObjectURL(blob), 30_000);
  }
  return isNative() ? ('shared' as const) : ('downloaded' as const);
}
