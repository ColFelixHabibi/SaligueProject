'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken } from './api';

// Records the live for the replay, on the host's phone: the stage as viewers see it (the host, and guests on
// camera in the same layout) with everyone's sound mixed, drawn onto a canvas so flipping a camera, a guest
// joining or leaving never breaks the recording. Sent to Saligue in 10-second pieces while live.

const API = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api`;
const TYPES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

/** One person on camera: their current camera and microphone tracks (host first). */
export type RecordSource = { video: MediaStreamTrack | null; audio: MediaStreamTrack | null };

// Where each person goes on a 720×1280 stage: one fills it, two are stacked, three or four make a 2×2 grid.
function cells(n: number, W: number, H: number) {
  if (n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
  if (n === 2) return [{ x: 0, y: 0, w: W, h: H / 2 }, { x: 0, y: H / 2, w: W, h: H / 2 }];
  return [0, 1, 2, 3].slice(0, n).map((i) => ({ x: (i % 2) * (W / 2), y: Math.floor(i / 2) * (H / 2), w: W / 2, h: H / 2 }));
}

export function useLiveRecorder(liveId: string | null, active: boolean, sources: () => RecordSource[]) {
  const [recording, setRecording] = useState(false);
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  useEffect(() => {
    if (!liveId || !active || typeof MediaRecorder === 'undefined') return;
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
    if (!type) return;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 720;
    canvas.height = 1280;
    const audio = new AudioContext();
    const out = audio.createMediaStreamDestination();
    // A <video> per camera and an audio input per microphone, kept while that track is in the live.
    const videos = new Map<string, HTMLVideoElement>();
    const mics = new Map<string, MediaStreamAudioSourceNode>();
    const sync = (now: RecordSource[]) => {
      const camIds = new Set(now.flatMap((s) => (s.video && s.video.readyState === 'live' ? [s.video.id] : [])));
      for (const [id, v] of videos) if (!camIds.has(id)) { v.srcObject = null; videos.delete(id); }
      for (const s of now) {
        if (s.video && s.video.readyState === 'live' && !videos.has(s.video.id)) {
          const v = document.createElement('video');
          v.muted = true;
          v.playsInline = true;
          v.srcObject = new MediaStream([s.video]);
          void v.play().catch(() => {});
          videos.set(s.video.id, v);
        }
      }
      const micIds = new Set(now.flatMap((s) => (s.audio && s.audio.readyState === 'live' ? [s.audio.id] : [])));
      for (const [id, m] of mics) if (!micIds.has(id)) { m.disconnect(); mics.delete(id); }
      for (const s of now) {
        if (s.audio && s.audio.readyState === 'live' && !mics.has(s.audio.id)) {
          const m = audio.createMediaStreamSource(new MediaStream([s.audio]));
          m.connect(out);
          mics.set(s.audio.id, m);
        }
      }
    };
    const draw = setInterval(() => {
      const now = sourcesRef.current().filter((s) => s.video || s.audio);
      sync(now);
      if (!ctx) return;
      const onCamera = now.filter((s) => s.video && videos.get(s.video.id)?.videoWidth);
      // Host alone: their own picture shape (720 px on the long side); with guests: the 9:16 stage.
      if (onCamera.length === 1) {
        const v = videos.get(onCamera[0].video!.id)!;
        const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        const cw = Math.round(v.videoWidth * scale / 2) * 2, ch = Math.round(v.videoHeight * scale / 2) * 2;
        if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
        ctx.drawImage(v, 0, 0, cw, ch);
        return;
      }
      if (!onCamera.length) return;
      if (canvas.width !== 720 || canvas.height !== 1280) { canvas.width = 720; canvas.height = 1280; }
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 720, 1280);
      cells(Math.min(4, onCamera.length), 720, 1280).forEach((c, i) => {
        const v = videos.get(onCamera[i].video!.id)!;
        // Each person fills their part of the stage (cropped at the edges, never stretched).
        const scale = Math.max(c.w / v.videoWidth, c.h / v.videoHeight);
        const sw = c.w / scale, sh = c.h / scale;
        ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, c.x + 1, c.y + 1, c.w - 2, c.h - 2);
      });
    }, 1000 / 24);
    const stream = new MediaStream([...canvas.captureStream(24).getVideoTracks(), ...out.stream.getAudioTracks()]);
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 96_000 });
    // Pieces go one after another; a failed piece is retried a few times.
    let seq = 0;
    let chain: Promise<unknown> = Promise.resolve();
    const send = (blob: Blob) => {
      const n = seq++;
      chain = chain.then(async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const token = getToken();
            const r = await fetch(`${API}/lives/${liveId}/recording?seq=${n}`, { method: 'PUT', body: blob, headers: { 'Content-Type': type.split(';')[0], ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
            if (r.ok || r.status === 409) return;
          } catch {
            // Network hiccup: try again.
          }
          await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
        }
      });
    };
    recorder.ondataavailable = (e) => e.data.size && send(e.data);
    recorder.start(10_000);
    setRecording(true);

    const finish = () => new Promise<void>((resolve) => {
      if (stopped) return resolve();
      stopped = true;
      recorder.onstop = () => {
        clearInterval(draw);
        videos.forEach((v) => { v.srcObject = null; });
        void audio.close();
        setRecording(false);
        resolve();
        // After the last piece: Saligue turns the pieces into the replay.
        void chain.then(() => api(`/lives/${liveId}/recording/done`, { body: {} }).catch(() => {}));
      };
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
    stopRef.current = finish;
    return () => {
      void finish();
    };
  }, [liveId, active]);

  /** Stops recording (the last pieces are still sent). */
  const stop = useCallback(() => stopRef.current?.() ?? Promise.resolve(), []);
  return { recording, stop };
}
