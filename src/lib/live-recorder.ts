'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken } from './api';

// Records the host's live for the replay, on the host's own phone: what viewers see and hear from the host,
// drawn onto a canvas (so flipping the camera or changing the mic never breaks the recording), sent to Saligue
// in 10-second pieces while live. Guests on camera are not recorded.

const API = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api`;
const TYPES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

export function useLiveRecorder(liveId: string | null, active: boolean, tracks: () => MediaStreamTrack[]) {
  const [recording, setRecording] = useState(false);
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  useEffect(() => {
    if (!liveId || !active || typeof MediaRecorder === 'undefined') return;
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
    if (!type) return;
    let stopped = false;
    // The picture: the current camera track drawn onto a canvas, 720 px on the long side at most.
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 720;
    canvas.height = 1280;
    // The sound: the current mic, through an audio graph that can be re-plugged.
    const audio = new AudioContext();
    const out = audio.createMediaStreamDestination();
    let mic: MediaStreamAudioSourceNode | null = null;
    let camId = '', micId = '';
    const follow = () => {
      const now = tracksRef.current();
      const cam = now.find((t) => t.kind === 'video');
      const m = now.find((t) => t.kind === 'audio');
      if (cam && cam.id !== camId) {
        camId = cam.id;
        video.srcObject = new MediaStream([cam]);
        void video.play().catch(() => {});
      }
      if (m && m.id !== micId) {
        micId = m.id;
        mic?.disconnect();
        mic = audio.createMediaStreamSource(new MediaStream([m]));
        mic.connect(out);
      }
    };
    follow();
    const draw = setInterval(() => {
      follow();
      const w = video.videoWidth, h = video.videoHeight;
      if (!ctx || !w || !h) return;
      const scale = Math.min(1, 720 / Math.max(w, h));
      const cw = Math.round(w * scale / 2) * 2, ch = Math.round(h * scale / 2) * 2;
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      ctx.drawImage(video, 0, 0, cw, ch);
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
