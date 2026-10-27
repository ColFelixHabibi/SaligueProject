// Item videos: a seller adds a short video (up to 1 min 30 s) to an item. Any phone format is accepted
// (MP4, MOV from iPhones, WebM…); ffmpeg turns it into a small 720p MP4 that plays on every phone and browser,
// plus a cover picture. Files are kept in data/media/ next to the photos.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { MEDIA_DIR } from './media.mjs';
import { DATA_DIR } from './db.mjs';

// Uploads wait on the same disk as the media (not /tmp, which may be memory and another disk).
const UPLOAD_DIR = join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const MAX_VIDEO_SECONDS = 90;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const run = (cmd, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(err.split('\n').filter(Boolean).slice(-2).join(' ') || `${cmd} failed`));
    });
    child.on('error', reject);
  });

/** Saves the request body to a temporary file, refusing uploads larger than 200 MB (or `maxBytes`). */
export function receiveUpload(req, maxBytes = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const file = join(UPLOAD_DIR, `upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const out = createWriteStream(file);
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        out.destroy();
        try { unlinkSync(file); } catch { /* already gone */ }
        reject(Object.assign(new Error(`This video is too large (more than ${Math.round(maxBytes / 1048576)} MB). Record it again in a lower quality.`), { status: 413 }));
      }
    });
    req.pipe(out);
    out.on('finish', () => resolve(file));
    out.on('error', reject);
    req.on('error', reject);
  });
}

/** Length of a video in seconds (null if it isn't a video). */
async function duration(file) {
  try {
    const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], 30_000);
    const seconds = Number(out.trim());
    return Number.isFinite(seconds) ? seconds : null;
  } catch {
    return null;
  }
}

/**
 * Turns an uploaded file into the item's video. Returns { video, poster, duration } as /media/ links.
 * Refuses files that aren't videos or are longer than 1 min 30 s.
 */
export async function processVideo(upload, maxSeconds = MAX_VIDEO_SECONDS) {
  const tmpOut = `${upload}.mp4`;
  const tmpPoster = `${upload}.jpg`;
  try {
    const seconds = await duration(upload);
    if (seconds === null) throw Object.assign(new Error('This file is not a video we can read.'), { status: 400 });
    if (seconds > maxSeconds + 1) throw Object.assign(new Error(`The video is longer than ${Math.floor(maxSeconds / 60)} min ${maxSeconds % 60 ? `${maxSeconds % 60} s` : ''}. Cut it and try again.`.replace(' .', '.')), { status: 400 });
    // 720p at most, portrait or landscape; H.264 + AAC; starts playing before it's fully downloaded.
    await run('ffmpeg', [
      '-y', '-i', upload, '-t', String(maxSeconds),
      '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-profile:v', 'main',
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', tmpOut,
    ], 25 * 60_000);
    await run('ffmpeg', ['-y', '-ss', String(Math.min(1, seconds / 2)), '-i', tmpOut, '-frames:v', '1', '-q:v', '4', tmpPoster], 60_000);
    const keep = (from, ext) => {
      const name = `${createHash('sha256').update(readFileSync(from)).digest('hex').slice(0, 32)}.${ext}`;
      const target = join(MEDIA_DIR, name);
      if (!existsSync(target)) {
        try {
          renameSync(from, target);
        } catch {
          // Different disks: copy instead of moving.
          copyFileSync(from, target);
        }
      }
      return `/media/${name}`;
    };
    return { video: keep(tmpOut, 'mp4'), poster: keep(tmpPoster, 'jpg'), duration: Math.round(Math.min(seconds, maxSeconds)) };
  } finally {
    for (const f of [upload, tmpOut, tmpPoster]) {
      try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
  }
}

/** Size of a stored media file (for Range requests). */
export const mediaSize = (file) => statSync(file).size;
