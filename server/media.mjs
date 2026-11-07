// Product photos as files (data/media/), so the product list carries links instead of whole pictures.
// Files are named by their content, so the same picture is stored once and can be cached forever.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, db } from './db.mjs';

export const MEDIA_DIR = join(DATA_DIR, 'media');
mkdirSync(MEDIA_DIR, { recursive: true });

// The only names this folder holds: a picture, video or sound named by its own bytes (32 hex), or a live's
// replay, named after the live. Nothing with a slash or a ".." can ever pass, so a link can't point elsewhere.
const NAME = /^([a-f0-9]{32}|live-[\w-]{1,80})\.[a-z0-9]{1,8}$/;

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
const TYPES = { ...Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type])), mp4: 'video/mp4', m4a: 'audio/mp4', vtt: 'text/vtt; charset=utf-8' };

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

/** Serves /media/<file>: never changes, so browsers and phones keep it. Videos and voice notes support Range. */
export function serveMedia(res, pathname, req) {
  const name = pathname.slice('/media/'.length);
  const ext = name.split('.').pop();
  const file = join(MEDIA_DIR, name);
  if (!NAME.test(name) || !TYPES[ext] || !existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const size = statSync(file).size;
  // Videos and voice notes are asked for in pieces (seeking, and iPhones insist on it before playing a sound).
  const seekable = ext === 'mp4' || ext === 'm4a';
  const range = seekable && /^bytes=(\d*)-(\d*)$/.exec(req?.headers.range ?? '');
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
    ...(seekable ? { 'Accept-Ranges': 'bytes' } : {}),
    'Cache-Control': 'public, max-age=31536000, immutable',
    // Pictures are drawn on canvases in the Fitting Room, also from a website hosted elsewhere.
    'Access-Control-Allow-Origin': '*',
    // SVG pictures must not run scripts when opened directly.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
  createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// Reclaiming space: a file is removed only once nothing in the database points at it any more.
// A file is named by its own bytes, so the same photo used by an item and by a status is one file. Deleting a
// status must never take a picture that an item, a lesson or someone else's status still shows.
// ---------------------------------------------------------------------------

/** The file name inside a /media/ link, or null for anything else (a data URL, an outside address, junk). */
export function mediaName(link) {
  const name = String(link ?? '').startsWith('/media/') ? String(link).slice('/media/'.length) : '';
  return NAME.test(name) ? name : null;
}

/**
 * Every column in the database a link could sit in, read from the database's own definition: a status keeps its
 * photo in one column, a lesson keeps its captions inside JSON in another. Read once, then reused. Only blobs
 * are left out (a link is never bytes) — a column declared INTEGER can still hold text in SQLite, so the
 * declared type is not trusted to rule a reference out.
 */
let linkColumnsCache = null;
function linkColumns() {
  if (linkColumnsCache) return linkColumnsCache;
  const columns = [];
  for (const { name } of db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'").all()) {
    for (const column of db.prepare('select name, type from pragma_table_info(?)').all(name)) {
      if (!/blob/i.test(column.type)) columns.push({ table: name, column: column.name });
    }
  }
  linkColumnsCache = columns;
  return columns;
}

const LINK_IN = (table, column) => `select 1 as hit from "${table}" where instr("${column}", ?) > 0 limit 1`;

/** True while something in the database still points at this file. */
export function mediaInUse(name) {
  const link = `/media/${name}`;
  for (const { table, column } of linkColumns()) {
    if (db.prepare(LINK_IN(table, column)).get(link)) return true;
  }
  return false;
}

/**
 * Deletes the given /media/ files, each one only while nothing points at it any more. Call it after the row
 * that held the link is gone. Anything that isn't a /media/ link is ignored. Returns how many files went.
 */
export function releaseMedia(...links) {
  let removed = 0;
  for (const link of links.flat()) {
    const name = mediaName(link);
    if (!name || mediaInUse(name)) continue;
    try {
      unlinkSync(join(MEDIA_DIR, name));
      removed += 1;
    } catch {
      // Already gone: nothing to reclaim.
    }
  }
  return removed;
}

/** Every file the database points at, read once for a whole sweep (getting this wrong would delete real photos). */
function filesInUse() {
  const names = new Set();
  for (const { table, column } of linkColumns()) {
    for (const row of db.prepare(`select "${column}" as value from "${table}" where instr("${column}", '/media/') > 0`).all()) {
      for (const found of String(row.value ?? '').matchAll(/\/media\/([A-Za-z0-9_.-]{1,120})/g)) names.add(found[1]);
    }
  }
  return names;
}

/**
 * The sweep, run once a day and at start-up: files nothing points at are removed — a status deleted or gone by,
 * an item taken down, a profile photo changed, a lesson erased. Files younger than an hour are left alone: a
 * saved file can be a moment away from being written on its row. Returns how many files were removed.
 */
export function sweepMedia({ youngerThanMs = 3_600_000 } = {}) {
  const inUse = filesInUse();
  const cutoff = Date.now() - youngerThanMs;
  let removed = 0;
  for (const name of readdirSync(MEDIA_DIR)) {
    if (inUse.has(name)) continue;
    const file = join(MEDIA_DIR, name);
    try {
      const info = statSync(file);
      if (!info.isFile() || info.mtimeMs > cutoff) continue;
      unlinkSync(file);
      removed += 1;
    } catch {
      // Already gone, or not ours to remove.
    }
  }
  return removed;
}
