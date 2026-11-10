// Photos, videos and voice notes sent in chats. Private: kept in data/chat/ (not the public media folder) and
// opened only through links signed for the people in the conversation, valid for a few hours.
// Every file is re-made by the server (sharp / ffmpeg), so what is stored is always a clean JPEG, MP4 or M4A.
import { spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { DATA_DIR, db, json, parse } from './db.mjs';
import { derivedKey } from './secrets.mjs';

const CHAT_DIR = join(DATA_DIR, 'chat');
mkdirSync(CHAT_DIR, { recursive: true });

export const CHAT_LIMITS = {
  image: { bytes: 15 * 1024 * 1024, label: 'Photo' },
  video: { bytes: 150 * 1024 * 1024, seconds: 180, label: 'Video' },
  voice: { bytes: 15 * 1024 * 1024, seconds: 300, label: 'Voice note' },
};
const LINK_HOURS = 6;

// Links are signed with a key derived from the secret kept outside the database (secrets.mjs), so a copy of the
// database cannot be used to make working links. The older secret in app_config is used only on a server without
// that key; once the outside key is there, the old one is deleted (links made with it simply expire within hours).
let outside;
function secret() {
  if (outside === undefined) {
    outside = derivedKey('chat-files');
    if (outside) db.prepare("delete from app_config where key = 'chat_files'").run();
  }
  if (outside) return outside;
  let s = parse(db.prepare("select value from app_config where key = 'chat_files'").get()?.value)?.secret;
  if (!s) {
    s = randomBytes(32).toString('hex');
    db.prepare("insert into app_config (key, value) values ('chat_files', ?) on conflict (key) do update set value = excluded.value").run(json({ secret: s }));
  }
  return s;
}
const sign = (name, exp) => createHmac('sha256', secret()).update(`${name}.${exp}`).digest('base64url');

/** A link to a chat file that works for a few hours (made only for the people in the conversation). */
export function chatFileUrl(name) {
  if (!name) return null;
  const exp = Math.floor(Date.now() / 1000 / 3600) * 3600 + LINK_HOURS * 3600; // stable for an hour, so pictures stay cached
  return `/api/chat-files/${name}?e=${exp}&s=${sign(name, exp)}`;
}

const TYPES = { jpg: 'image/jpeg', mp4: 'video/mp4', m4a: 'audio/mp4' };

/** Serves a chat file if its link is valid (with ranges, so videos and voice notes can seek). */
export function serveChatFile(req, res, url) {
  const name = /^\/api\/chat-files\/([a-f0-9-]{36}(?:-poster)?\.(jpg|mp4|m4a))$/.exec(url.pathname)?.[1];
  const exp = Number(url.searchParams.get('e'));
  const given = Buffer.from(String(url.searchParams.get('s') ?? ''));
  const file = name && join(CHAT_DIR, name);
  const expected = name ? Buffer.from(sign(name, exp)) : Buffer.alloc(0);
  if (!name || !(exp * 1000 > Date.now()) || given.length !== expected.length || !timingSafeEqual(given, expected) || !existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const type = TYPES[name.split('.').pop()];
  const size = statSync(file).size;
  // No wildcard CORS: these files are private, and the app shows them with <img>, <video> and <audio>, which read
  // them across origins without asking. Without the header no page's script can copy the bytes somewhere else.
  // `no-referrer` keeps the signed link itself from travelling to whatever is opened from here.
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && type !== 'image/jpeg') {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  return createReadStream(file).pipe(res);
}

const run = (cmd, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(err.split('\n').filter(Boolean).slice(-1)[0] || `${cmd} failed`));
    });
    child.on('error', reject);
  });

const seconds = async (file) => Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], 30_000)) || 0;
const bad = (message) => Object.assign(new Error(message), { status: 400 });

// Videos are heavy to convert: one at a time.
let queue = Promise.resolve();
const oneAtATime = (job) => {
  const next = queue.then(job, job);
  queue = next.catch(() => {});
  return next;
};

/**
 * Turns an upload into a stored chat file. `upload` is a temporary file (removed here).
 * Returns { kind, file, poster?, width?, height?, duration? }.
 */
export async function storeChatFile(kind, upload) {
  const id = randomUUID();
  try {
    if (kind === 'image') {
      const out = await sharp(upload, { failOn: 'error' }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true })
        .catch(() => { throw bad('This photo could not be read. Try another one.'); });
      writeFileSync(join(CHAT_DIR, `${id}.jpg`), out.data);
      return { kind, file: `${id}.jpg`, width: out.info.width, height: out.info.height };
    }
    const length = await seconds(upload).catch(() => 0);
    if (!length) throw bad(kind === 'video' ? 'This video could not be read. Try another one.' : 'This voice note could not be read.');
    if (length > CHAT_LIMITS[kind].seconds + 1) throw bad(kind === 'video' ? 'Videos can be up to 3 minutes.' : 'Voice notes can be up to 5 minutes.');
    if (kind === 'voice') {
      await run('ffmpeg', ['-y', '-i', upload, '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'mp4', join(CHAT_DIR, `${id}.m4a`)], 120_000);
      return { kind, file: `${id}.m4a`, duration: Math.round(length) };
    }
    return await oneAtATime(async () => {
      const video = join(CHAT_DIR, `${id}.mp4`);
      await run('ffmpeg', ['-y', '-i', upload, '-vf', "scale='min(720,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'mp4', video], 10 * 60_000);
      await run('ffmpeg', ['-y', '-ss', String(Math.min(1, length / 2)), '-i', video, '-frames:v', '1', '-q:v', '5', join(CHAT_DIR, `${id}-poster.jpg`)], 60_000).catch(() => {});
      const meta = await sharp(join(CHAT_DIR, `${id}-poster.jpg`)).metadata().catch(() => ({}));
      return { kind, file: `${id}.mp4`, poster: existsSync(join(CHAT_DIR, `${id}-poster.jpg`)) ? `${id}-poster.jpg` : null, width: meta.width, height: meta.height, duration: Math.round(length) };
    });
  } finally {
    try { unlinkSync(upload); } catch { /* gone */ }
  }
}

/** Removes a message's files (unsent messages, deleted accounts). */
export function removeChatFiles(attachment) {
  const a = typeof attachment === 'string' ? parse(attachment) : attachment;
  for (const f of [a?.file, a?.poster]) {
    if (f && /^[a-f0-9-]{36}(-poster)?\.(jpg|mp4|m4a)$/.test(f)) try { unlinkSync(join(CHAT_DIR, f)); } catch { /* gone */ }
  }
}

/** What a message with this attachment says in the inbox and in emails. */
export const attachmentLabel = (a) => (a ? { image: '📷 Photo', video: '🎬 Video', voice: '🎤 Voice note' }[a.kind] ?? '' : '');
