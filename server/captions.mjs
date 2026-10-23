// Lesson captions, made on Saligue's own server (no outside service): whisper.cpp turns the lesson's speech into
// timed captions (WebVTT). English, French and Kiswahili are understood; French and Kiswahili lessons also get
// English subtitles (Whisper translates into English). Kinyarwanda isn't supported by Whisper, so those teachers
// type their captions (PUT /api/lessons/:id/captions). One lesson at a time, at low priority, so the site stays fast.
//
//   WHISPER_BIN    path to whisper-cli   (default /opt/whisper.cpp/build/bin/whisper-cli)
//   WHISPER_MODEL  path to a ggml model  (default /opt/whisper.cpp/models/ggml-small.bin)
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, DATA_DIR } from './db.mjs';
import { MEDIA_DIR } from './media.mjs';

const BIN = process.env.WHISPER_BIN || '/opt/whisper.cpp/build/bin/whisper-cli';
const MODEL = process.env.WHISPER_MODEL || '/opt/whisper.cpp/models/ggml-small.bin';
export const AUTO_LANGUAGES = ['en', 'fr', 'sw'];
export const captionsAvailable = () => existsSync(BIN) && existsSync(MODEL);

const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('nice', ['-n', '15', cmd, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(err.split('\n').filter(Boolean).slice(-1)[0] || `${cmd} failed`)); });
    child.on('error', reject);
  });
}

/** Saves caption text as a media file and returns its /media/ link. */
export function storeVtt(vtt) {
  const name = `${createHash('sha256').update(vtt).digest('hex').slice(0, 32)}.vtt`;
  const file = join(MEDIA_DIR, name);
  if (!existsSync(file)) writeFileSync(file, vtt);
  return `/media/${name}`;
}

const queue = [];
let busy = false;

/** Asks for captions for a lesson (after its video is ready). */
export function enqueueCaptions(lessonId) {
  if (!captionsAvailable() || queue.includes(lessonId)) return;
  queue.push(lessonId);
  db.prepare("update lessons set captions_status = 'pending' where id = ? and (captions_status is null or captions_status != 'done')").run(lessonId);
  void work();
}

async function work() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const id = queue.shift();
    try {
      await makeCaptions(id);
    } catch (error) {
      console.error('Captions failed:', String(error?.message ?? error).slice(0, 200));
      db.prepare("update lessons set captions_status = 'failed' where id = ?").run(id);
    }
  }
  busy = false;
}

async function makeCaptions(id) {
  const lesson = db.prepare('select id, video, language, captions from lessons where id = ?').get(id);
  if (!lesson?.video) return;
  if (!AUTO_LANGUAGES.includes(lesson.language)) {
    db.prepare("update lessons set captions_status = 'none' where id = ?").run(id);
    return;
  }
  const video = join(MEDIA_DIR, lesson.video.replace('/media/', ''));
  const base = join(DATA_DIR, 'uploads', `captions-${id}`);
  const started = Date.now();
  try {
    await run('ffmpeg', ['-y', '-i', video, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', `${base}.wav`], 120_000);
    const tracks = [];
    await run(BIN, ['-m', MODEL, '-f', `${base}.wav`, '-l', lesson.language, '-t', '3', '-np', '-ovtt', '-of', base], 15 * 60_000);
    tracks.push({ lang: lesson.language, url: storeVtt(readFileSync(`${base}.vtt`, 'utf8')), auto: true });
    if (lesson.language !== 'en') {
      await run(BIN, ['-m', MODEL, '-f', `${base}.wav`, '-l', lesson.language, '-tr', '-t', '3', '-np', '-ovtt', '-of', `${base}-en`], 15 * 60_000);
      tracks.push({ lang: 'en', url: storeVtt(readFileSync(`${base}-en.vtt`, 'utf8')), auto: true, translated: true });
    }
    // Captions the teacher typed or corrected are kept.
    const manual = (parse(lesson.captions) ?? []).filter((c) => !c.auto);
    const merged = [...manual, ...tracks.filter((t) => !manual.some((m) => m.lang === t.lang))];
    db.prepare("update lessons set captions = ?, captions_status = 'done' where id = ?").run(JSON.stringify(merged), id);
    console.log(`Captions for lesson ${id}: ${tracks.map((t) => t.lang).join(' + ')} in ${Math.round((Date.now() - started) / 1000)} s`);
  } finally {
    for (const f of [`${base}.wav`, `${base}.vtt`, `${base}-en.vtt`]) { try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ } }
  }
}

/** Lessons that never got captions (made before this existed, or the server restarted mid-way). */
export function captionMissing() {
  if (!captionsAvailable()) return;
  for (const { id } of db.prepare("select id from lessons where video is not null and hidden = 0 and (captions_status is null or captions_status = 'pending')").all()) enqueueCaptions(id);
}

/** Text the teacher typed, timed evenly over the video, as WebVTT (one line per caption). */
export function textToVtt(text, durationSeconds) {
  const lines = String(text).split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 400);
  if (!lines.length) return null;
  const total = Math.max(lines.length, Number(durationSeconds) || lines.length * 3);
  const words = lines.map((l) => l.split(/\s+/).length);
  const sum = words.reduce((a, b) => a + b, 0);
  const stamp = (s) => new Date(Math.round(s * 1000)).toISOString().slice(11, 23);
  let at = 0;
  const cues = lines.map((l, i) => {
    const length = (total * words[i]) / sum;
    const cue = `${stamp(at)} --> ${stamp(at + length)}\n${l.replace(/-->/g, '→')}`;
    at += length;
    return cue;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/** Cues edited by the teacher (timings kept, text changed) back into WebVTT. */
export function cuesToVtt(cues) {
  const ok = (Array.isArray(cues) ? cues : []).slice(0, 1000).filter((c) => /^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(c?.start) && /^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(c?.end) && String(c?.text ?? '').trim());
  if (!ok.length) return null;
  return `WEBVTT\n\n${ok.map((c) => `${c.start} --> ${c.end}\n${String(c.text).trim().slice(0, 300).replace(/-->/g, '→')}`).join('\n\n')}\n`;
}
