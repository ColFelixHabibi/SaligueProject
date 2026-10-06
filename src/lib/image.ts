
// Product photos are stored inline in Firestore documents, which are capped at 1 MiB.
// Shrink and re-encode uploads so they fit comfortably under that limit.
const MAX_DIMENSION = 1000;
const MAX_DATA_URL_LENGTH = 700_000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read this image file.'));
    img.src = src;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function compressImage(file: File): Promise<string> {
  const img = await loadImage(await readAsDataUrl(file));

  let scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  let quality = 0.82;

  for (let attempt = 0; attempt < 8; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processing is not supported in this browser.');
    // JPEG has no transparency; paint a white background first.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl;

    if (quality > 0.55) quality -= 0.1;
    else scale *= 0.8;
  }
  throw new Error('This image is too large. Please choose a smaller photo.');
}
