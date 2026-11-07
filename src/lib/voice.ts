'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { inAppBrowser } from './camera';

// Recording a voice status on the phone, like a status app: one button, thirty seconds at most, and it stops
// by itself. MediaRecorder writes WebM on Android and MP4 on iPhones; the server turns either into one small
// M4A, so a status plays the same on every phone (server/video.mjs).

export const VOICE_MAX_SECONDS = 30;

/** Why the microphone would not open, so the screen can say it in the reader's own language. */
export type VoiceProblem = 'insecure' | 'blocked' | 'missing' | 'busy' | 'unsupported' | 'other';

export class VoiceError extends Error {
  constructor(public reason: VoiceProblem) {
    super(reason);
    this.name = 'VoiceError';
  }
}

/** What a finished recording is: the sound itself, how long it ran, and the form the server is sent. */
export type Recording = { data: string; seconds: number };

// Whatever this browser can write. Safari on an iPhone records MP4, Android and computers record WebM/Opus.
const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

const readable = (reason: VoiceProblem) =>
  reason === 'insecure'
    ? 'A voice status needs the secure address. Open Saligue from its https:// link.'
    : reason === 'blocked'
      ? 'The microphone is blocked. Allow it next to the address (or in your phone settings for Saligue), then try again.'
      : reason === 'missing'
        ? 'No microphone was found on this device.'
        : reason === 'busy'
          ? 'Your microphone is being used by another app. Close it, then try again.'
          : reason === 'unsupported'
            ? 'This browser cannot record a voice status. Open Saligue in Chrome or Safari.'
            : inAppBrowser()
              ? 'This app’s built-in browser can’t use the microphone. Open Saligue in Chrome or Safari, then try again.'
              : 'The microphone could not start. Tap Record and try again.';

function why(error: unknown): VoiceProblem {
  const name = (error as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'blocked';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'missing';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'other';
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new VoiceError('other'));
    reader.readAsDataURL(blob);
  });

/**
 * A voice status recorder: `start()` opens the microphone and counts, `stop()` finishes, `discard()` throws the
 * recording away. It stops itself at thirty seconds, and it lets the microphone go as soon as it is done, so no
 * red dot stays on in the corner of the phone.
 */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<Recording | null>(null);
  const [problem, setProblem] = useState<VoiceProblem | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const startedAt = useRef(0);
  const ticker = useRef<number | null>(null);
  // Set when a recording is thrown away, so what it leaves behind is not shown as a finished one.
  const cancelled = useRef(false);

  const release = useCallback(() => {
    if (ticker.current !== null) {
      window.clearInterval(ticker.current);
      ticker.current = null;
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
    setRecording(false);
  }, []);

  const stop = useCallback(() => {
    const device = recorder.current;
    if (!device || device.state === 'inactive') {
      release();
      return;
    }
    // onstop turns the pieces into the recording.
    device.stop();
    if (ticker.current !== null) {
      window.clearInterval(ticker.current);
      ticker.current = null;
    }
    stream.current?.getTracks().forEach((t) => t.stop());
  }, [release]);

  const start = useCallback(async () => {
    setProblem(null);
    setResult(null);
    setSeconds(0);
    cancelled.current = false;
    if (recording) return;
    if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setProblem('insecure');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setProblem('unsupported');
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
      const device = new MediaRecorder(media, type ? { mimeType: type, audioBitsPerSecond: 64_000 } : undefined);
      stream.current = media;
      recorder.current = device;
      chunks.current = [];
      device.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      device.onstop = async () => {
        const ran = Math.min(VOICE_MAX_SECONDS, (Date.now() - startedAt.current) / 1000);
        const blob = new Blob(chunks.current, { type: type || 'audio/webm' });
        chunks.current = [];
        release();
        if (cancelled.current) return;
        setSeconds(Math.round(ran));
        if (!blob.size) {
          setProblem('other');
          return;
        }
        try {
          setResult({ data: await toDataUrl(blob), seconds: Math.max(1, Math.round(ran)) });
        } catch {
          setProblem('other');
        }
      };
      startedAt.current = Date.now();
      device.start(250);
      setRecording(true);
      // Thirty seconds at most: it stops by itself while the person is still talking, like a status app.
      ticker.current = window.setInterval(() => {
        const ran = (Date.now() - startedAt.current) / 1000;
        setSeconds(Math.min(VOICE_MAX_SECONDS, Math.round(ran)));
        if (ran >= VOICE_MAX_SECONDS) stop();
      }, 200);
    } catch (error) {
      release();
      setProblem(why(error));
    }
  }, [recording, release, stop]);

  const discard = useCallback(() => {
    cancelled.current = true;
    const device = recorder.current;
    if (device && device.state !== 'inactive') device.stop();
    else release();
    setResult(null);
    setSeconds(0);
    setProblem(null);
  }, [release]);

  // Leaving the composer mid-recording lets the microphone go.
  useEffect(() => () => release(), [release]);

  return { recording, seconds, result, problem, problemText: problem ? readable(problem) : null, start, stop, discard };
}
