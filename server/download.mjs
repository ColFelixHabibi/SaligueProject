// Download: anyone can save an item's picture or video to their phone, with the Saligue logo and the shop's
// name on it (like TikTok's watermark), so every saved or re-posted copy leads back to Saligue.
// Made once per item and kept in data/watermarked/ until the item's picture or video changes.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { DATA_DIR } from './db.mjs';
import { MEDIA_DIR } from './media.mjs';

const OUT_DIR = join(DATA_DIR, 'watermarked');
mkdirSync(OUT_DIR, { recursive: true });
const LOGO = join(import.meta.dirname, '..', 'public', 'icons', 'icon-512.png');
const KEEP_DAYS = 30;

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

/** The mark: the S logo, "Saligue" and the shop's name in white, on a soft dark pill so it reads on any picture. */
async function mark(width, shop) {
  const logo = Math.max(36, Math.round(width * 0.075));
  const big = Math.round(logo * 0.5);
  const small = Math.round(logo * 0.34);
  const name = shop ? `@${shop}`.slice(0, 40) : 'saligue';
  const r = Math.round(logo * 0.22);
  const icon = await sharp(LOGO).resize(logo, logo)
    .composite([{ input: Buffer.from(`<svg width="${logo}" height="${logo}"><rect width="${logo}" height="${logo}" rx="${r}" ry="${r}"/></svg>`), blend: 'dest-in' }])
    .png().toBuffer();
  // The words, measured by drawing them (fonts differ in width).
  const wide = logo * 14;
  const words = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${wide}" height="${logo}">
    <g font-family="Liberation Sans, DejaVu Sans, Arial, sans-serif" fill="#fff">
      <text x="0" y="${Math.round(logo * 0.45)}" font-size="${big}" font-weight="700">Saligue</text>
      <text x="0" y="${Math.round(logo * 0.88)}" font-size="${small}" font-weight="400">${escapeXml(name)}</text>
    </g></svg>`)).png().toBuffer();
  const { info } = await sharp(words).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  const textWidth = Math.min(wide, info.width + Math.abs(info.trimOffsetLeft ?? 0));
  const pad = Math.round(logo * 0.16);
  const gap = Math.round(logo * 0.26);
  const w = pad + logo + gap + textWidth + Math.round(pad * 1.6);
  const h = logo + pad * 2;
  const pill = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${Math.round(h * 0.3)}" fill="#000" fill-opacity="0.42"/></svg>`);
  const cropped = await sharp(words).extract({ left: 0, top: 0, width: textWidth, height: logo }).toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: pill, left: 0, top: 0 }, { input: icon, left: pad, top: pad }, { input: cropped, left: pad + logo + gap, top: pad }])
    .png().toBuffer();
}

/** The local file behind a /media/ link, or null. */
const mediaFile = (link) => {
  const name = /^\/media\/([a-f0-9]{32}\.[a-z0-9]+)$/.exec(String(link ?? ''))?.[1];
  return name && existsSync(join(MEDIA_DIR, name)) ? join(MEDIA_DIR, name) : null;
};

function imageBytes(link) {
  const file = mediaFile(link);
  if (file) return file;
  const data = /^data:image\/[\w+.-]+;base64,(.*)$/s.exec(String(link ?? ''))?.[1];
  if (data) return Buffer.from(data, 'base64');
  // Never fetched from other addresses: the server must not be made to load links someone typed in.
  throw new Error('no picture');
}

const run = (args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(err.split('\n').filter(Boolean).slice(-1)[0] || 'ffmpeg failed'));
    });
    child.on('error', reject);
  });

// One video at a time: making them is heavy, and the server also serves shoppers.
let queue = Promise.resolve();
const oneAtATime = (job) => {
  const next = queue.then(job, job);
  queue = next.catch(() => {});
  return next;
};

/**
 * The watermarked copy of an item: { file, type, name }. `want` is 'video' (when the item has one) or 'image'.
 * Throws when the item's picture can't be read.
 */
export async function watermarked(product, shopName, want = 'image') {
  const video = want === 'video' ? mediaFile(product.video) : null;
  const source = video ?? (product.video_poster && want === 'video' ? product.video_poster : product.image);
  const key = createHash('sha256').update(`${source}|${shopName}|v2`).digest('hex').slice(0, 16);
  const safe = String(product.name ?? 'item').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
  const ext = video ? 'mp4' : 'jpg';
  const out = join(OUT_DIR, `${product.id}-${key}.${ext}`);
  const result = { file: out, type: video ? 'video/mp4' : 'image/jpeg', name: `saligue-${safe}.${ext}` };
  if (existsSync(out)) return result;

  const tmp = `${out}.${process.pid}.tmp.${ext}`;
  if (video) {
    await oneAtATime(async () => {
      if (existsSync(out)) return;
      const meta = join(OUT_DIR, `${key}-mark.png`);
      // The videos are 720p (video.mjs): the mark is made for that width, ffmpeg scales it if the video differs.
      writeFileSync(meta, await mark(720, shopName));
      try {
        await run(['-y', '-i', video, '-i', meta, '-filter_complex',
          '[1:v][0:v]scale2ref=w=iw*0.42:h=ow/mdar[m][v];[v][m]overlay=x=W*0.04:y=H-h-H*0.04',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-c:a', 'copy', '-movflags', '+faststart', '-f', 'mp4', tmp], 5 * 60_000);
        renameSync(tmp, out);
      } finally {
        for (const f of [meta, tmp]) try { unlinkSync(f); } catch { /* gone */ }
      }
    });
    return result;
  }

  const base = sharp(imageBytes(source), { density: 200 }).rotate().resize({ width: 1440, height: 1800, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' });
  const pic = await base.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  const m = await mark(pic.info.width, shopName);
  const mm = await sharp(m).metadata();
  // Small pictures: the mark is shrunk to fit.
  const fit = mm.width > pic.info.width * 0.9 ? await sharp(m).resize({ width: Math.round(pic.info.width * 0.9) }).toBuffer() : m;
  const fm = await sharp(fit).metadata();
  const margin = Math.round(pic.info.width * 0.035);
  const bytes = await sharp(pic.data)
    .composite([{ input: fit, left: margin, top: Math.max(0, pic.info.height - fm.height - margin) }])
    .jpeg({ quality: 88 }).toBuffer();
  writeFileSync(tmp, bytes);
  renameSync(tmp, out);
  return result;
}

/** Removes copies not downloaded for KEEP_DAYS (they are made again when asked). */
export function sweepWatermarked() {
  const old = Date.now() - KEEP_DAYS * 86_400_000;
  for (const f of readdirSync(OUT_DIR)) {
    try {
      const p = join(OUT_DIR, f);
      if (statSync(p).atimeMs < old && statSync(p).mtimeMs < old) unlinkSync(p);
    } catch { /* gone */ }
  }
}
