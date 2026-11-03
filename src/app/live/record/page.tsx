'use client';

import { useEffect, useState } from 'react';
import { Participant, Room, RoomEvent, Track } from 'livekit-client';
import { LiveStage } from '@/components/live/live-parts';
import { api } from '@/lib/api';
import type { Live, Tile } from '@/lib/live';

/**
 * The page Saligue's server recorder (LiveKit Egress) opens and films for a live's replay: only the stage,
 * the host big and guests as the host chose (side or grid), 720×1280. Not meant for people.
 * The recorder gives ?url= and ?token=; the page says START_RECORDING once there is video and END_RECORDING
 * when the live is over.
 */
export default function RecordPage() {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('url');
    const token = params.get('token');
    if (!url || !token) return;
    const room = new Room({ adaptiveStream: false, dynacast: false });
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      console.log('START_RECORDING');
    };
    const meta = (p: Participant) => {
      try {
        return JSON.parse(p.metadata || '{}');
      } catch {
        return {};
      }
    };
    const update = () => {
      const onCamera = [...room.remoteParticipants.values()]
        .map((p): Tile => {
          const pubs = [...p.trackPublications.values()];
          return {
            identity: p.identity, name: p.name || 'Guest', role: meta(p).role ?? 'viewer', isLocal: false, speaking: p.isSpeaking,
            video: pubs.find((t) => t.kind === Track.Kind.Video && t.track)?.track ?? null,
            audio: pubs.find((t) => t.kind === Track.Kind.Audio && t.track)?.track ?? null,
          };
        })
        // Only the host and guests can send camera or sound, so whoever sends them is on camera.
        .filter((t) => t.role === 'host' || t.role === 'guest' || !!t.video || !!t.audio)
        .sort((a, b) => (a.role === 'host' ? -1 : b.role === 'host' ? 1 : 0));
      setTiles(onCamera);
      if (onCamera.some((t) => t.video)) start();
    };
    room.on(RoomEvent.ParticipantConnected, update)
      .on(RoomEvent.ParticipantDisconnected, update)
      .on(RoomEvent.TrackSubscribed, update)
      .on(RoomEvent.TrackUnsubscribed, update)
      .on(RoomEvent.TrackMuted, update)
      .on(RoomEvent.TrackUnmuted, update)
      .on(RoomEvent.ActiveSpeakersChanged, update)
      .on(RoomEvent.Disconnected, () => console.log('END_RECORDING'));
    void room.connect(url, token).then(update);
    // A host whose camera never comes (sound only) is still recorded.
    const fallback = setTimeout(start, 15_000);
    return () => {
      clearTimeout(fallback);
      void room.disconnect();
    };
  }, []);

  // The host may change the layout or the picture during the live; the room's name is the live's id.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('token')?.split('.')[1];
    let liveId: string | null = null;
    try {
      liveId = id ? JSON.parse(atob(id.replace(/-/g, '+').replace(/_/g, '/'))).video?.room ?? null : null;
    } catch {
      liveId = null;
    }
    if (!liveId) return;
    const load = () => api<{ live: Live }>(`/lives/${liveId}`).then((r) => {
      setLive(r.live);
      if (r.live.status === 'ended') console.log('END_RECORDING');
    }).catch(() => {});
    void load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div id="saligue-record" className="fixed inset-0 z-[2147483647] bg-black">
      {/* Only the stage is filmed: the rest of the site is hidden. */}
      <style>{'body *{visibility:hidden!important}#saligue-record,#saligue-record *{visibility:visible!important}'}</style>
      <LiveStage tiles={tiles} cover={live?.thumbnail} fill={live?.videoFit === 'fill'} layout={live?.layout} waiting="" />
    </div>
  );
}
