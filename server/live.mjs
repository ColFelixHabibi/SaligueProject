// Saligue Live: access to the LiveKit media server (self-hosted, see /etc/livekit.yaml).
//   LIVEKIT_URL         wss://… address of the LiveKit server, as browsers reach it
//   LIVEKIT_API_KEY     API key and secret from the LiveKit config
//   LIVEKIT_API_SECRET
// Video goes through LiveKit; chat, hearts, featured items and guests go through Saligue's own server.
import { createHmac } from 'node:crypto';

export function liveSettings() {
  const url = process.env.LIVEKIT_URL || null;
  const key = process.env.LIVEKIT_API_KEY || null;
  const secret = process.env.LIVEKIT_API_SECRET || null;
  return { url, key, secret, enabled: !!(url && key && secret) };
}

const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/**
 * A short-lived pass into one live's room. Hosts and accepted guests may send camera and microphone;
 * viewers only watch. Everyone may send data (not used for chat, which goes through Saligue's server).
 */
export function accessToken({ room, identity, name, canPublish, metadata = {}, hours = 6 }) {
  const { key, secret } = liveSettings();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: key,
    sub: identity,
    name,
    nbf: now - 10,
    exp: now + hours * 3600,
    metadata: JSON.stringify(metadata),
    video: { room, roomJoin: true, canSubscribe: true, canPublish, canPublishData: true, canUpdateOwnMetadata: false },
  };
  const unsigned = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

/** Ends a room on the LiveKit server right away (everyone is disconnected). */
export async function closeRoom(room) {
  const { url, key, secret } = liveSettings();
  if (!url) return;
  const now = Math.floor(Date.now() / 1000);
  const admin = { iss: key, sub: 'saligue-server', nbf: now - 10, exp: now + 60, video: { roomCreate: true, roomAdmin: true, room } };
  const unsigned = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(admin)}`;
  const token = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
  const api = url.replace(/^ws/, 'http');
  await fetch(`${api}/twirp/livekit.RoomService/DeleteRoom`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ room }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

/** Removes one person's camera rights (e.g. a guest the host removed) by disconnecting them; they rejoin as a viewer. */
export async function removeParticipant(room, identity) {
  const { url, key, secret } = liveSettings();
  if (!url) return;
  const now = Math.floor(Date.now() / 1000);
  const admin = { iss: key, sub: 'saligue-server', nbf: now - 10, exp: now + 60, video: { roomAdmin: true, room } };
  const unsigned = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(admin)}`;
  const token = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
  await fetch(`${url.replace(/^ws/, 'http')}/twirp/livekit.RoomService/RemoveParticipant`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, identity }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Server recording (LiveKit Egress, systemd saligue-egress): every live is recorded on the server as viewers
// see it, so a locked phone or a weak network never loses the replay. Files land in data/recordings
// (mounted as /out in the egress container).
// ---------------------------------------------------------------------------

function adminCall(service, method, body, grant) {
  const { url, key, secret } = liveSettings();
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: key, sub: 'saligue-server', nbf: now - 10, exp: now + 60, video: grant };
  const unsigned = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}`;
  const token = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
  // LiveKit's own API is reached on the server itself (LIVEKIT_API_URL), else through the public address.
  const api = process.env.LIVEKIT_API_URL || url.replace(/^ws/, 'http');
  return fetch(`${api}/twirp/livekit.${service}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.msg || `LiveKit ${method}: ${r.status}`);
    return data;
  });
}

/** Records one live's room, drawn by Saligue's own recording page (same layout as viewers see). Returns the egress id. */
export async function startRecording(room, { pageUrl, file }) {
  const info = await adminCall('Egress', 'StartRoomCompositeEgress', {
    room_name: room,
    layout: 'saligue',
    custom_base_url: pageUrl,
    file_outputs: [{ file_type: 'MP4', filepath: `/out/${file}` }],
    // Phone-shaped, 720p: small files that look sharp on phones.
    advanced: { width: 720, height: 1280, framerate: 30, video_bitrate: 2500, audio_bitrate: 128, audio_frequency: 48000 },
  }, { roomRecord: true });
  return info.egress_id ?? info.egressId;
}

/** Asks the recording to finish (the file is closed and saved within a few seconds). */
export const stopRecording = (egressId) => adminCall('Egress', 'StopEgress', { egress_id: egressId }, { roomRecord: true });

/** Where a recording stands: 'active', 'complete' (with the file), or 'failed'. */
export async function recordingStatus(egressId) {
  const { items = [] } = await adminCall('Egress', 'ListEgress', { egress_id: egressId }, { roomRecord: true });
  const info = items[0];
  if (!info) return { state: 'failed' };
  const status = String(info.status ?? '');
  const file = (info.file_results ?? info.fileResults ?? [])[0] ?? info.file ?? null;
  if (/COMPLETE|LIMIT_REACHED/.test(status)) return { state: 'complete', file: file?.filename ?? null, error: info.error };
  if (/FAILED|ABORTED/.test(status)) return { state: 'failed', error: info.error };
  return { state: 'active' };
}

/** True when the recording service answers (else the host's phone records, as before). */
export async function recorderReady() {
  try {
    const r = await fetch(`http://127.0.0.1:${process.env.EGRESS_HEALTH_PORT || 7890}`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}
