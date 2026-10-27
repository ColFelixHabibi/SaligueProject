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
