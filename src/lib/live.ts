'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalAudioTrack, LocalVideoTrack, Room, RoomEvent, Track, type LocalTrack, type Participant, type RemoteTrack } from 'livekit-client';
import { DIGITAL_ZOOM_MAX, digitalZoom, loadCameraChoice, openCamera, saveCameraChoice, setZoom, zoomRange, type CameraChoice } from './camera';
import { api, onServerEvent } from './api';
import { withMedia, type Burst, type Live, type LiveComment, type LiveGuest, type LivePoll } from './lives';

export { useLives, useElapsed, type Burst, type Live, type LiveComment, type LiveGuest, type LivePoll } from './lives';

// Saligue Live (server: /api/lives…). Video through LiveKit; chat, hearts, pins and guests through Saligue's server.

/** One live: details, chat, hearts, guests and the host's pins, live. */
export function useLive(id: string | null, me: string | null) {
  const [live, setLive] = useState<Live | null>(null);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [guests, setGuests] = useState<LiveGuest[]>([]);
  const [myGuestStatus, setMyGuestStatus] = useState<'requested' | 'accepted' | 'declined' | null>(null);
  const [muted, setMuted] = useState(false);
  // The host asked me to come on camera.
  const [invited, setInvited] = useState(false);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [error, setError] = useState<string | null>(null);
  // My answer in the current poll, and (host and moderators) the words filtered out of the chat.
  const [myVote, setMyVote] = useState<number | null>(null);
  const [blockedWords, setBlockedWords] = useState<string[]>([]);
  const burstId = useRef(0);

  const burst = useCallback((emoji: string, count = 1) => {
    const added = Array.from({ length: Math.min(count, 6) }, () => ({ id: ++burstId.current, emoji, x: 10 + Math.random() * 60 }));
    setBursts((b) => [...b.slice(-40), ...added]);
    setTimeout(() => setBursts((b) => b.filter((x) => !added.includes(x))), 2600);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api<{ live: Live; comments: LiveComment[]; guests: LiveGuest[]; myGuestStatus: typeof myGuestStatus; muted: boolean; invited?: boolean; myVote?: number | null; blockedWords?: string[] }>(`/lives/${id}`);
      setMyVote(d.myVote ?? null);
      if (d.blockedWords) setBlockedWords(d.blockedWords);
      setLive(withMedia(d.live));
      setComments(d.comments);
      setGuests(d.guests);
      setMyGuestStatus(d.myGuestStatus);
      setMuted(d.muted);
      setInvited(!!d.invited);
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
      if (d.type === 'updated') {
        setLive((old) => {
          // A new poll: my answer to the old one no longer counts.
          if (old?.poll?.id !== d.live.poll?.id) setMyVote(null);
          return withMedia(d.live);
        });
      }
      if (d.type === 'ended') setLive((l) => (l ? { ...l, status: 'ended' } : l));
      if (d.type === 'guest_invite') setInvited(true);
      if (['guests_changed', 'guest_request', 'guest_decision', 'invite_answer', 'moderator'].includes(d.type)) void load();
    });
  }, [id, me, load, burst]);

  return { live, comments, guests, myGuestStatus, muted, invited, setInvited, bursts, burst, error, reload: load, myVote, setMyVote, blockedWords, setBlockedWords };
}

// Actions
export const goLive = (body: { title: string; description: string; productIds: string[]; thumbnail?: string | null }) => api<Live>('/lives', { body });
export const endLive = (id: string) => api<Live>(`/lives/${id}/end`, { body: {} });
export const updateLive = (id: string, body: Partial<{ title: string; description: string; productIds: string[]; pinnedProductId: string | null; pinnedCommentId: string | null; viewers: number; chatMode: 'everyone' | 'followers' | 'off'; slowSeconds: number; videoFit: 'fit' | 'fill'; thumbnail: string | null; heartGoal: number; blockedWords: string[]; poll: { question: string; options: string[] } | null; pollOpen: boolean }>) =>
  api<Live>(`/lives/${id}`, { method: 'PATCH', body }).then(withMedia);
export const votePoll = (id: string, option: number) => api<{ myVote: number; poll: LivePoll }>(`/lives/${id}/poll`, { body: { option } });
export const sendLiveComment = (id: string, text: string, kind: 'comment' | 'question' | 'join' = 'comment') => api<LiveComment>(`/lives/${id}/comments`, { body: { text, kind } });
export const removeLiveComment = (id: string, commentId: string) => api(`/lives/${id}/comments/${commentId}`, { method: 'DELETE' });
export const askToJoin = (id: string) => api<{ status: string }>(`/lives/${id}/guests`, { body: {} });
export const decideGuest = (id: string, uid: string, decision: 'accept' | 'decline' | 'remove') => api(`/lives/${id}/guests/${uid}`, { body: { decision } });
export const muteInLive = (id: string, uid: string) => api(`/lives/${id}/mute/${uid}`, { body: { muted: true } });
export const setLiveModerator = (id: string, uid: string, moderator: boolean) => api<Live>(`/lives/${id}/moderators/${uid}`, { body: { moderator } });
/** Host: invite a viewer onto camera (co-host). The viewer answers with answerInvite. */
export const inviteOnCamera = (id: string, uid: string) => api(`/lives/${id}/guests/${uid}`, { body: { decision: 'invite' } });
export const answerInvite = (id: string, accept: boolean) => api<{ status: string }>(`/lives/${id}/guests`, { body: { accept } });

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

/** Someone in the live room (watching or on camera). `account`: has a Saligue account (can be moderator or co-host). */
export type Watcher = { uid: string; name: string; role: string; account: boolean };

export type Tile = { identity: string; name: string; role: string; video: Track | null; audio: Track | null; isLocal: boolean; speaking: boolean; mirror?: boolean };

/**
 * The video room. Hosts and accepted guests send their camera and microphone; viewers only watch.
 * Returns everyone on camera (host first), the number of people watching, and camera controls.
 */
export function useLiveRoom(liveId: string | null, enabled: boolean, publishWanted: boolean) {
  const [room, setRoom] = useState<Room | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [viewers, setViewers] = useState(0);
  const [audience, setAudience] = useState<Watcher[]>([]);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string>('viewer');
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  // Your own picture is shown mirrored only for a selfie camera (never for a digital or back camera).
  const [mirror, setMirrorState] = useState(true);
  const mirrorRef = useRef(true);
  const [attempt, setAttempt] = useState(0);
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
      return { identity: p.identity, name: p.name || 'Guest', role: meta(p).role ?? 'viewer', video, audio, isLocal, speaking: p.isSpeaking, mirror: isLocal && mirrorRef.current };
    };
    const everyone = [toTile(r.localParticipant, true), ...[...r.remoteParticipants.values()].map((p) => toTile(p, false))];
    // Until the camera is published, show it straight from the device.
    const preview = localTracks.current.find((t) => t.kind === Track.Kind.Video);
    if (preview && !everyone[0].video) everyone[0] = { ...everyone[0], video: preview, role: everyone[0].role === 'viewer' ? 'host' : everyone[0].role };
    const onCamera = everyone.filter((t) => t.role === 'host' || t.role === 'guest').sort((a, b) => (a.role === 'host' ? -1 : b.role === 'host' ? 1 : 0));
    setTiles(onCamera);
    setViewers(everyone.length);
    setAudience([...r.remoteParticipants.values()].map((p) => ({ uid: p.identity, name: p.name || 'Guest shopper', role: meta(p).role ?? 'viewer', account: meta(p).account !== false })));
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
      setError(null);
      // 1. The camera first, so the host sees themselves at once (and camera problems are told apart from network ones).
      if (publishWanted) {
        try {
          const choice = loadCameraChoice();
          setFacing(choice.facing);
          mirrorRef.current = choice.mirror ?? choice.facing === 'user';
          setMirrorState(mirrorRef.current);
          const { stream, audio } = await openCamera(choice.facing, true, choice);
          if (cancelled) return stream.getTracks().forEach((t) => t.stop());
          const tracks: LocalTrack[] = [new LocalVideoTrack(stream.getVideoTracks()[0], undefined, true)];
          if (audio && stream.getAudioTracks()[0]) tracks.push(new LocalAudioTrack(stream.getAudioTracks()[0], undefined, true));
          localTracks.current = tracks;
          rawVideo.current = stream.getVideoTracks()[0];
          setMicOn(audio);
          setTiles([{ identity: 'me', name: 'You', role: 'host', video: tracks[0], audio: null, isLocal: true, speaking: false, mirror: mirrorRef.current }]);
        } catch (e: any) {
          if (cancelled) return;
          setStatus('error');
          setError(e?.message ?? 'The camera could not start.');
          return;
        }
      }
      // 2. Then the live room.
      try {
        const pass = await api<{ url: string; token: string; role: string }>(`/lives/${liveId}/token`, { body: {} });
        if (cancelled) return;
        setRole(pass.role);
        await r.connect(pass.url, pass.token);
        if (cancelled) return r.disconnect();
        if (pass.role !== 'viewer') for (const t of localTracks.current) await r.localParticipant.publishTrack(t, { simulcast: true });
        // The digital zoom chosen in the preview (cameras without their own zoom).
        const wanted = loadCameraChoice().digital ?? 1;
        if (publishWanted && wanted > 1 && !zoomRange(rawVideo.current)) await applyDigital(wanted);
        setRoom(r);
        setStatus('connected');
        update();
      } catch (e: any) {
        if (cancelled) return;
        setStatus('error');
        setError(`Your camera works, but the live could not connect${e?.message ? ` (${e.message})` : ''}. Check your internet and tap Try again.`);
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
  }, [liveId, enabled, publishWanted, refresh, attempt]);

  // Camera and microphone switch on the device's own tracks, so they work before and after connecting.
  const toggleCam = useCallback(async () => {
    const video = localTracks.current.find((t) => t.kind === Track.Kind.Video);
    if (!video) return;
    if (camOn) await video.mute();
    else await video.unmute();
    setCamOn(!camOn);
    if (room) refresh(room);
  }, [room, camOn, refresh]);

  const toggleMic = useCallback(async () => {
    const audio = localTracks.current.find((t) => t.kind === Track.Kind.Audio);
    if (!audio) return;
    if (micOn) await audio.mute();
    else await audio.unmute();
    setMicOn(!micOn);
  }, [micOn]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Zoom: the camera's own when it has one, otherwise digital (crop of the centre, sent to viewers).
  const rawVideo = useRef<MediaStreamTrack | null>(null);
  const pipeline = useRef<ReturnType<typeof digitalZoom> | null>(null);
  const digitalValue = useRef(1);
  const videoLocal = () => localTracks.current.find((t) => t.kind === Track.Kind.Video) as (LocalTrack & { replaceTrack: (t: MediaStreamTrack, userProvided?: boolean) => Promise<unknown> }) | undefined;
  async function applyDigital(z: number) {
    const video = videoLocal();
    const raw = rawVideo.current;
    if (!video || !raw) return;
    digitalValue.current = z;
    if (z <= 1.01) {
      if (pipeline.current) {
        await video.replaceTrack(raw, true);
        pipeline.current.stop();
        pipeline.current = null;
      }
      return;
    }
    if (!pipeline.current) {
      pipeline.current = digitalZoom(raw);
      await video.replaceTrack(pipeline.current.track, true);
    }
    pipeline.current.setZoom(z);
  }
  useEffect(() => () => { pipeline.current?.stop(); pipeline.current = null; }, [liveId, attempt]);
  const zoomInfo = useCallback(() => {
    const hw = zoomRange(rawVideo.current);
    return hw ? { ...hw, digital: false } : { min: 1, max: DIGITAL_ZOOM_MAX, step: 0.1, value: digitalValue.current, digital: true };
  }, []);
  const setLiveZoom = useCallback(async (z: number) => {
    if (zoomRange(rawVideo.current) && rawVideo.current) await setZoom(rawVideo.current, z);
    else await applyDigital(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The camera itself (for zoom).
  const videoTrack = useCallback(() => rawVideo.current ?? (localTracks.current.find((t) => t.kind === Track.Kind.Video)?.mediaStreamTrack ?? null), []);

  // Front ↔ back camera on phones, or one chosen camera/lens; the full picture, not a cropped strip.
  const restartCamera = useCallback(async (next: CameraChoice) => {
    const video = localTracks.current.find((t) => t.kind === Track.Kind.Video) as (LocalTrack & { restartTrack?: (o: object) => Promise<void> }) | undefined;
    const which = next.deviceId ? { deviceId: { exact: next.deviceId } } : { facingMode: next.facing };
    // A new camera starts at its whole picture.
    pipeline.current?.stop();
    pipeline.current = null;
    digitalValue.current = 1;
    await video?.restartTrack?.({ ...which, width: { ideal: next.external ? 1920 : 1280 }, frameRate: { ideal: 30 }, resizeMode: 'none' });
    const track = video?.mediaStreamTrack;
    rawVideo.current = track ?? null;
    const range = zoomRange(track);
    if (track && range) await setZoom(track, range.min);
    setFacing(next.facing);
    mirrorRef.current = next.mirror ?? next.facing === 'user';
    setMirrorState(mirrorRef.current);
    saveCameraChoice({ ...loadCameraChoice(), facing: next.facing, deviceId: next.deviceId, external: next.external, mirror: mirrorRef.current, zoom: undefined, digital: 1 });
    if (room) refresh(room);
  }, [room, refresh]);
  const flipMirror = useCallback(() => {
    mirrorRef.current = !mirrorRef.current;
    setMirrorState(mirrorRef.current);
    saveCameraChoice({ ...loadCameraChoice(), mirror: mirrorRef.current });
    if (room) refresh(room);
    else setTiles((t) => t.map((x) => (x.isLocal ? { ...x, mirror: mirrorRef.current } : x)));
  }, [room, refresh]);
  // Another microphone (an external mic, or the digital camera's sound) replaces the one in use.
  const switchMic = useCallback(async (micId: string) => {
    const audio = localTracks.current.find((t) => t.kind === Track.Kind.Audio) as (LocalTrack & { restartTrack?: (o: object) => Promise<void> }) | undefined;
    await audio?.restartTrack?.(micId ? { deviceId: { exact: micId } } : {});
    saveCameraChoice({ ...loadCameraChoice(), micId: micId || undefined });
  }, []);
  const flipCamera = useCallback(() => restartCamera({ facing: facing === 'user' ? 'environment' : 'user' }), [facing, restartCamera]);

  return { room, tiles, viewers, audience, status, error, role, camOn, micOn, toggleCam, toggleMic, flipCamera, restartCamera, facing, mirror, flipMirror, switchMic, retry, videoTrack, zoomInfo, setLiveZoom };
}

/** Attaches a LiveKit track to a <video>/<audio> element. */
export function attach(track: Track | RemoteTrack | null, element: HTMLMediaElement | null) {
  if (!track || !element) return () => {};
  track.attach(element);
  return () => {
    track.detach(element);
  };
}

