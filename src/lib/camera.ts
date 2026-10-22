'use client';

// Opening the camera (and microphone) reliably on phones, laptops and inside the Android/iOS apps.
// Tries the best settings first and simpler ones if the device refuses, and explains failures in plain words.

export class CameraError extends Error {
  constructor(public reason: 'insecure' | 'blocked' | 'missing' | 'busy' | 'other', message: string) {
    super(message);
  }
}

// Instagram, Facebook, WhatsApp, TikTok and similar apps open links in their own browser, which often can't use the camera.
export const inAppBrowser = () => typeof navigator !== 'undefined' && /FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger|TikTok|musical_ly|Snapchat/i.test(navigator.userAgent);

function explain(error: unknown): CameraError {
  const name = (error as { name?: string })?.name ?? '';
  if (name === 'NotSupportedError' || name === 'TypeError' || inAppBrowser()) {
    return new CameraError('other', inAppBrowser()
      ? 'This app’s built-in browser can’t use the camera. Tap ⋮ or the share button and choose “Open in Chrome” (or Safari), then try again.'
      : 'This browser can’t use the camera here. Open Saligue in Chrome or Safari and try again.');
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return new CameraError('blocked', 'The camera is blocked. Tap the lock or camera icon next to the address (or open your phone Settings → Saligue) and allow Camera and Microphone, then tap Try again.');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return new CameraError('missing', 'No camera was found on this device. Connect a camera or use your phone.');
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new CameraError('busy', 'Your camera is being used by another app (Zoom, WhatsApp, Camera…). Close it, then tap Try again.');
  }
  return new CameraError('other', `The camera could not start${(error as Error)?.message ? `: ${(error as Error).message}` : ''}. Tap Try again.`);
}

/**
 * Opens the camera facing the given way, with the microphone when `audio` is true.
 * If the microphone alone fails (none, or blocked), the camera still opens and `audio` comes back false.
 */
export async function openCamera(facing: 'user' | 'environment', audio: boolean, choice?: { deviceId?: string; zoom?: number }): Promise<{ stream: MediaStream; audio: boolean }> {
  if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('insecure', 'The camera only works on the secure address (https://). Open Saligue from its https:// link.');
  }
  const which: MediaTrackConstraints = choice?.deviceId ? { deviceId: { exact: choice.deviceId } } : { facingMode: facing };
  // The camera's own picture: no fixed shape, because asking for a tall 720×1280 picture makes most cameras
  // cut a narrow strip out of the sensor, which looks zoomed in. resizeMode 'none' stops Chrome cropping.
  const videoOptions: MediaTrackConstraints[] = [
    { ...which, width: { ideal: 1280 }, frameRate: { ideal: 30 }, resizeMode: 'none' } as MediaTrackConstraints,
    which,
    ...(choice?.deviceId ? [{ facingMode: facing }] : []),
    {},
  ];
  let lastError: unknown;
  for (const video of videoOptions) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: Object.keys(video).length ? video : true, audio });
      await startZoom(stream, choice?.zoom);
      return { stream, audio };
    } catch (error) {
      lastError = error;
      const name = (error as { name?: string })?.name;
      // Blocked or missing won't get better with other settings, except that a missing/blocked microphone
      // shouldn't stop the camera: try once more without it.
      if (audio && (name === 'NotFoundError' || name === 'NotAllowedError' || name === 'NotReadableError')) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: Object.keys(video).length ? video : true, audio: false });
          await startZoom(stream, choice?.zoom);
          return { stream, audio: false };
        } catch (videoOnly) {
          lastError = videoOnly;
        }
      }
      if (name === 'NotAllowedError' || name === 'SecurityError') break;
    }
  }
  throw explain(lastError);
}

type ZoomCaps = { min: number; max: number; step?: number };

/** The camera's zoom range, when the phone lets the browser control it (null on most computers). */
export function zoomRange(track: MediaStreamTrack | undefined | null): (ZoomCaps & { value: number }) | null {
  const caps = (track?.getCapabilities?.() as { zoom?: ZoomCaps } | undefined)?.zoom;
  if (!track || !caps || caps.max <= caps.min) return null;
  const value = (track.getSettings() as { zoom?: number }).zoom ?? caps.min;
  return { ...caps, value };
}

export async function setZoom(track: MediaStreamTrack, zoom: number) {
  await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] }).catch(() => {});
}

// Some phones open the camera zoomed in: start at the widest view, or the zoom the seller chose.
async function startZoom(stream: MediaStream, wanted?: number) {
  const track = stream.getVideoTracks()[0];
  const range = zoomRange(track);
  if (!range) return;
  const zoom = wanted != null ? Math.min(range.max, Math.max(range.min, wanted)) : range.min;
  if (zoom !== range.value) await setZoom(track, zoom);
}

/** The cameras on this device. Phones often list their wide-angle lens as its own camera. */
export async function listCameras(): Promise<{ deviceId: string; label: string }[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput' && d.deviceId)
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    return [];
  }
}

/** The camera the seller picked before going live (kept on this device). */
export type CameraChoice = { facing: 'user' | 'environment'; deviceId?: string; zoom?: number };
const CHOICE_KEY = 'saligue-live-camera';

export function loadCameraChoice(): CameraChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null');
    if (saved && (saved.facing === 'user' || saved.facing === 'environment')) return saved;
  } catch {
    // Nothing saved, or storage is blocked.
  }
  return { facing: 'user' };
}

export function saveCameraChoice(choice: CameraChoice) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Storage blocked: the choice just isn't remembered.
  }
}
