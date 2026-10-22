// Product photos as files (data/media/), so the product list carries links instead of whole pictures.
// Files are named by their content, so the same picture is stored once and can be cached forever.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, db } from './db.mjs';

export const MEDIA_DIR = join(DATA_DIR, 'media');
mkdirSync(MEDIA_DIR, { recursive: true });

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
const TYPES = { ...Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type])), mp4: 'video/mp4' };

/** Saves a picture sent as a data URL and returns its link (/media/…). Anything else is returned unchanged. */
export function storeImage(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return value;
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(value);
  const ext = match && EXTENSIONS[match[1]];
  if (!ext) return value;
  const bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`;
  const file = join(MEDIA_DIR, name);
  if (!existsSync(file)) writeFileSync(file, bytes);
  return `/media/${name}`;
}

/** Moves pictures still stored inside the database into files (older listings, demo items). */
export function moveImagesToFiles() {
  const rows = db.prepare("select id, image, cutout from products where image like 'data:%' or cutout like 'data:%'").all();
  for (const row of rows) {
    db.prepare('update products set image = ?, cutout = ? where id = ?').run(storeImage(row.image), storeImage(row.cutout), row.id);
  }
  return rows.length;
}

/** Serves /media/<file>: never changes, so browsers and phones keep it. Videos support Range (seeking, iPhone). */
export function serveMedia(res, pathname, req) {
  const name = pathname.slice('/media/'.length);
  const ext = name.split('.').pop();
  const file = join(MEDIA_DIR, name);
  if (!/^[a-f0-9]{32}\.[a-z0-9]+$/.test(name) || !TYPES[ext] || !existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const size = statSync(file).size;
  const range = ext === 'mp4' && /^bytes=(\d*)-(\d*)$/.exec(req?.headers.range ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': TYPES[ext], 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*',
    });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, {
    'Content-Type': TYPES[ext],
    'Content-Length': size,
    ...(ext === 'mp4' ? { 'Accept-Ranges': 'bytes' } : {}),
    'Cache-Control': 'public, max-age=31536000, immutable',
    // Pictures are drawn on canvases in the Fitting Room, also from a website hosted elsewhere.
    'Access-Control-Allow-Origin': '*',
    // SVG pictures must not run scripts when opened directly.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
  createReadStream(file).pipe(res);
}
