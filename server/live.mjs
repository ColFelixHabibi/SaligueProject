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
