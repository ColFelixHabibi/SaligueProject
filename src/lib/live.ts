'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type LocalTrack, type Participant, type RemoteTrack, createLocalTracks } from 'livekit-client';
import { api, onServerEvent } from './api';
import { withMedia, type Burst, type Live, type LiveComment, type LiveGuest } from './lives';

export { useLives, useElapsed, type Burst, type Live, type LiveComment, type LiveGuest } from './lives';

// Saligue Live (server: /api/lives…). Video through LiveKit; chat, hearts, pins and guests through Saligue's server.

/** One live: details, chat, hearts, guests and the host's pins, live. */
export function useLive(id: string | null, me: string | null) {
  const [live, setLive] = useState<Live | null>(null);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [guests, setGuests] = useState<LiveGuest[]>([]);
  const [myGuestStatus, setMyGuestStatus] = useState<'requested' | 'accepted' | 'declined' | null>(null);
  const [muted, setMuted] = useState(false);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [error, setError] = useState<string | null>(null);
  const burstId = useRef(0);

  const burst = useCallback((emoji: string, count = 1) => {
    const added = Array.from({ length: Math.min(count, 6) }, () => ({ id: ++burstId.current, emoji, x: 10 + Math.random() * 60 }));
    setBursts((b) => [...b.slice(-40), ...added]);
    setTimeout(() => setBursts((b) => b.filter((x) => !added.includes(x))), 2600);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api<{ live: Live; comments: LiveComment[]; guests: LiveGuest[]; myGuestStatus: typeof myGuestStatus; muted: boolean }>(`/lives/${id}`);
      setLive(withMedia(d.live));
      setComments(d.comments);
      setGuests(d.guests);
      setMyGuestStatus(d.myGuestStatus);
      setMuted(d.muted);
    } catch (e: any) {
      setError(e?.message ?? 'This live could not be opened.');
    }
  }, [id]);

  useEffect(() => {
    void load();
    if (!id) return;
    return onServerEvent('live', (d: any) => {
      if (d?.liveId !== id) return;
      if (d.type === 'comment') setComments((c) => (c.some((x) => x.id === d.comment.id) ? c : [...c.slice(-150), d.comment]));
      if (d.type === 'comment_removed') setComments((c) => c.filter((x) => x.id !== d.commentId));
      if (d.type === 'likes') {
        setLive((l) => (l ? { ...l, likeCount: d.likeCount } : l));
        if (d.from !== me) burst(d.emoji, d.count);
      }
      if (d.type === 'updated') setLive(withMedia(d.live));
      if (d.type === 'ended') setLive((l) => (l ? { ...l, status: 'ended' } : l));
      if (d.type === 'guests_changed' || d.type === 'guest_request' || d.type === 'guest_decision') void load();
    });
  }, [id, me, load, burst]);

  return { live, comments, guests, myGuestStatus, muted, bursts, burst, error, reload: load };
}

// Actions
export const goLive = (body: { title: string; description: string; productIds: string[] }) => api<Live>('/lives', { body });
export const endLive = (id: string) => api<Live>(`/lives/${id}/end`, { body: {} });
export const updateLive = (id: string, body: Partial<{ title: string; description: string; productIds: string[]; pinnedProductId: string | null; pinnedCommentId: string | null; viewers: number }>) =>
  api<Live>(`/lives/${id}`, { method: 'PATCH', body });
export const sendLiveComment = (id: string, text: string, kind: 'comment' | 'question' | 'join' = 'comment') => api<LiveComment>(`/lives/${id}/comments`, { body: { text, kind } });
export const removeLiveComment = (id: string, commentId: string) => api(`/lives/${id}/comments/${commentId}`, { method: 'DELETE' });
export const askToJoin = (id: string) => api<{ status: string }>(`/lives/${id}/guests`, { body: {} });
export const decideGuest = (id: string, uid: string, decision: 'accept' | 'decline' | 'remove') => api(`/lives/${id}/guests/${uid}`, { body: { decision } });
export const muteInLive = (id: string, uid: string) => api(`/lives/${id}/mute/${uid}`, { body: { muted: true } });

/** Sends hearts in small batches, so many quick taps make one request. */
export function useHearts(id: string | null, burst: (emoji: string, count?: number) => void) {
  const pending = useRef<Record<string, number>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(
    (emoji = '❤️') => {
      if (!id) return;
      burst(emoji);
      pending.current[emoji] = (pending.current[emoji] ?? 0) + 1;
      if (timer.current) return;
      timer.current = setTimeout(() => {
        const batch = pending.current;
        pending.current = {};
        timer.current = null;
        for (const [e, count] of Object.entries(batch)) api(`/lives/${id}/like`, { body: { count, emoji: e } }).catch(() => {});
      }, 700);
    },
    [id, burst]
  );
}

export type Tile = { identity: string; name: string; role: string; video: Track | null; audio: Track | null; isLocal: boolean; speaking: boolean };

/**
 * The video room. Hosts and accepted guests send their camera and microphone; viewers only watch.
 * Returns everyone on camera (host first), the number of people watching, and camera controls.
 */
export function useLiveRoom(liveId: string | null, enabled: boolean, publishWanted: boolean) {
  const [room, setRoom] = useState<Room | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [viewers, setViewers] = useState(0);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string>('viewer');
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const localTracks = useRef<LocalTrack[]>([]);

  const refresh = useCallback((r: Room) => {
    const meta = (p: Participant) => {
      try {
        return JSON.parse(p.metadata || '{}');
      } catch {
        return {};
      }
    };
    const toTile = (p: Participant, isLocal: boolean): Tile => {
      const pubs = [...p.trackPublications.values()];
      const video = pubs.find((t) => t.kind === Track.Kind.Video && t.track)?.track ?? null;
      const audio = pubs.find((t) => t.kind === Track.Kind.Audio && t.track)?.track ?? null;
      return { identity: p.identity, name: p.name || 'Guest', role: meta(p).role ?? 'viewer', video, audio, isLocal, speaking: p.isSpeaking };
    };
    const everyone = [toTile(r.localParticipant, true), ...[...r.remoteParticipants.values()].map((p) => toTile(p, false))];
    const onCamera = everyone.filter((t) => t.role === 'host' || t.role === 'guest').sort((a, b) => (a.role === 'host' ? -1 : b.role === 'host' ? 1 : 0));
    setTiles(onCamera);
    setViewers(everyone.length);
  }, []);

  useEffect(() => {
    if (!liveId || !enabled) return;
    let cancelled = false;
    const r = new Room({ adaptiveStream: true, dynacast: true });
    const update = () => !cancelled && refresh(r);
    r.on(RoomEvent.ParticipantConnected, update)
      .on(RoomEvent.ParticipantDisconnected, update)
      .on(RoomEvent.TrackSubscribed, update)
      .on(RoomEvent.TrackUnsubscribed, update)
      .on(RoomEvent.TrackMuted, update)
      .on(RoomEvent.TrackUnmuted, update)
      .on(RoomEvent.LocalTrackPublished, update)
      .on(RoomEvent.ActiveSpeakersChanged, update)
      .on(RoomEvent.ParticipantMetadataChanged, update)
      .on(RoomEvent.Disconnected, () => !cancelled && setStatus('error'));
    (async () => {
      setStatus('connecting');
      try {
        const pass = await api<{ url: string; token: string; role: string }>(`/lives/${liveId}/token`, { body: {} });
        if (cancelled) return;
        setRole(pass.role);
        await r.connect(pass.url, pass.token);
        if (cancelled) return r.disconnect();
        if (pass.role !== 'viewer' && publishWanted) {
          const tracks = await createLocalTracks({ audio: true, video: { facingMode: 'user', resolution: { width: 720, height: 1280, frameRate: 30 } } });
          localTracks.current = tracks;
          for (const t of tracks) await r.localParticipant.publishTrack(t, { simulcast: true });
        }
        setRoom(r);
        setStatus('connected');
        update();
      } catch (e: any) {
        if (cancelled) return;
        setStatus('error');
        setError(/Permission|NotAllowed/i.test(String(e?.message ?? e)) ? 'Allow camera and microphone in your browser to go live.' : e?.message ?? 'Could not connect to the live.');
      }
    })();
    return () => {
      cancelled = true;
      localTracks.current.forEach((t) => t.stop());
      localTracks.current = [];
      void r.disconnect();
      setRoom(null);
      setTiles([]);
    };
  }, [liveId, enabled, publishWanted, refresh]);

  const toggleCam = useCallback(async () => {
    if (!room) return;
    await room.localParticipant.setCameraEnabled(!camOn);
    setCamOn(!camOn);
    refresh(room);
  }, [room, camOn, refresh]);

  const toggleMic = useCallback(async () => {
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(!micOn);
    setMicOn(!micOn);
  }, [room, micOn]);

  // Front ↔ back camera on phones.
  const flipCamera = useCallback(async () => {
    const next = facing === 'user' ? 'environment' : 'user';
    const video = localTracks.current.find((t) => t.kind === Track.Kind.Video) as (LocalTrack & { restartTrack?: (o: object) => Promise<void> }) | undefined;
    await video?.restartTrack?.({ facingMode: next });
    setFacing(next);
  }, [facing]);

  return { room, tiles, viewers, status, error, role, camOn, micOn, toggleCam, toggleMic, flipCamera, facing };
}

/** Attaches a LiveKit track to a <video>/<audio> element. */
export function attach(track: Track | RemoteTrack | null, element: HTMLMediaElement | null) {
  if (!track || !element) return () => {};
  track.attach(element);
  return () => {
    track.detach(element);
  };
}

