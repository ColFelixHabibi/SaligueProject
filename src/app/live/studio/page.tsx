'use client';

import { absoluteUrl } from '@/lib/paths';
import { shareLink } from '@/components/share-sheet';
import { ExpandableText } from '@/components/expandable-text';
import { DIGITAL_ZOOM_MAX, listCameras, listMicrophones, loadCameraChoice, mirrorFor, onDevicesChange, openCamera, saveCameraChoice, setZoom, zoomRange, type CameraDevice, type MicDevice } from '@/lib/camera';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, Camera, Check, Eye, FlipHorizontal2, Heart, Maximize, Shield, ShieldOff, Minimize, Settings2, Loader2, Mic, MicOff, Package, Pin, PinOff, Plus, Radio, Reply, Share2, Smartphone, SwitchCamera, Trash2, UserCheck, UserMinus, Users, Video, VideoOff, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAuth } from '@/components/auth/auth-provider';
import { CoverPicker, GiftBanner, HeartGoal, Hearts, LiveChat, LiveInput, LiveStage, LiveTopBar, PinnedProduct, PollBubble, PollCard, snapFrame, useVideoShape } from '@/components/live/live-parts';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { decideGuest, endLive, goLive, inviteOnCamera, muteInLive, removeLiveComment, sendLiveComment, setLiveModerator, updateLive, useElapsed, useLive, useLiveRoom, useLives, type Live, type LiveComment, type LiveGuest, type Watcher } from '@/lib/live';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';
import { onServerEvent } from '@/lib/api';

/**
 * Where the picture comes from, as chips in a row that scrolls sideways: the phone's front and back camera, and
 * every other camera found — a digital camera by USB (webcam mode) or HDMI capture card, a webcam, a wide lens.
 */
function CameraSources({ cameras, facing, deviceId, onPick }: { cameras: CameraDevice[]; facing: 'user' | 'environment'; deviceId?: string; onPick: (facing: 'user' | 'environment', deviceId?: string) => void }) {
  const chip = (on: boolean) => cn('flex h-10 max-w-[220px] shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition', on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted');
  const extra = cameras.filter((c) => c.kind === 'external' || c.kind === 'other' || cameras.filter((x) => x.kind === c.kind).length > 1);
  return (
    <div className="space-y-1.5">
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button type="button" className={chip(!deviceId && facing === 'user')} onClick={() => onPick('user')}><Smartphone className="h-4 w-4 shrink-0" /> Front</button>
        <button type="button" className={chip(!deviceId && facing === 'environment')} onClick={() => onPick('environment')}><SwitchCamera className="h-4 w-4 shrink-0" /> Back</button>
        {extra.map((c) => (
          <button key={c.deviceId} type="button" title={c.label} className={chip(deviceId === c.deviceId)} onClick={() => onPick(c.kind === 'front' ? 'user' : 'environment', c.deviceId)}>
            {c.kind === 'external' ? <Camera className="h-4 w-4 shrink-0" /> : <Video className="h-4 w-4 shrink-0" />}
            <span className="truncate">{c.kind === 'external' ? `Digital · ${c.label}` : c.label}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <Camera className="mr-1 inline h-3.5 w-3.5" />Digital camera: plug it in by USB (webcam mode) or through an HDMI capture card. It appears here.
      </p>
    </div>
  );
}

/** Before going live: camera check, title, description and the items to show. */
function Setup() {
  const router = useRouter();
  const { toast } = useToast();
  const { authUid } = useAuth();
  const { products } = useProductStore();
  const lives = useLives();
  const mine = useMemo(() => products.filter((p) => p.sellerId === authUid && p.status === 'active'), [products, authUid]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [facing, setFacing] = useState<'user' | 'environment'>(() => (typeof window === 'undefined' ? 'user' : loadCameraChoice().facing));
  const [deviceId, setDeviceId] = useState<string | undefined>(() => (typeof window === 'undefined' ? undefined : loadCameraChoice().deviceId));
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [micId, setMicId] = useState<string | undefined>(() => (typeof window === 'undefined' ? undefined : loadCameraChoice().micId));
  const [cover, setCover] = useState<string | null>(null);
  const [fill, setFill] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [camTry, setCamTry] = useState(0);
  const [zoom, setZoomState] = useState<{ min: number; max: number; step?: number; value: number } | null>(null);
  // Cameras without their own zoom: digital zoom (the centre is cropped; viewers get the same picture once live).
  const [digital, setDigital] = useState(() => (typeof window === 'undefined' ? 1 : loadCameraChoice().digital ?? 1));
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const previewBackdrop = useRef<HTMLVideoElement>(null);
  const [starting, setStarting] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const previewWide = useVideoShape(video);
  const device = cameras.find((c) => c.deviceId === deviceId) ?? null;
  const external = device?.kind === 'external';
  const mirror = mirrorFor(facing, device);

  // A digital camera plugged in (or removed) while on this screen shows up at once.
  useEffect(() => onDevicesChange(() => {
    void listCameras().then(setCameras);
    void listMicrophones().then(setMics);
  }), []);

  // The blurred fill behind a wide camera picture shows the same camera.
  useEffect(() => {
    if (previewWide && previewBackdrop.current && video.current) previewBackdrop.current.srcObject = video.current.srcObject;
  }, [previewWide]);

  // Camera preview, so the seller sees how they look before going live.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setCamError(null);
    openCamera(facing, false, { deviceId, external })
      .then(({ stream: s }) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        trackRef.current = s.getVideoTracks()[0];
        setZoomState(zoomRange(trackRef.current));
        saveCameraChoice({ facing, deviceId, external, mirror, micId, zoom: zoomRange(trackRef.current)?.value, digital: zoomRange(trackRef.current) ? 1 : digital });
        // Camera and microphone names are only readable once they are allowed.
        void listCameras().then(setCameras);
        void listMicrophones().then(setMics);
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }

      })
      .catch((e) => !cancelled && setCamError(e?.message ?? 'The camera could not start.'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, deviceId, camTry]);

  const mineLive = lives?.lives.find((l) => l.sellerId === authUid);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setStarting(true);
    try {
      // No cover chosen: a frame from the camera, so the live never shows up as an empty card.
      const live = await goLive({ title, description, productIds: picked, thumbnail: cover ?? snapFrame(video.current, mirror) });
      if (fill) await updateLive(live.id, { videoFit: 'fill' }).catch(() => {});
      router.replace(`/live/studio?id=${live.id}`);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not go live', description: friendlyError(error) });
      setStarting(false);
    }
  };

  if (lives && !lives.enabled) {
    return <p className="p-10 text-center text-muted-foreground">Live is not switched on for this Saligue server yet.</p>;
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-3 py-4 pb-[calc(1rem+var(--sab))] pt-[calc(1rem+var(--sat))] min-[360px]:px-4 md:grid-cols-[minmax(0,360px)_1fr] md:gap-6 md:p-8">
      <div className="relative mx-auto aspect-[9/16] max-h-[70dvh] w-full max-w-[360px] overflow-hidden rounded-3xl bg-neutral-900 shadow-xl md:max-h-none">
        {previewWide && !fill && <video ref={previewBackdrop} autoPlay playsInline muted aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl" />}
        <video ref={video} autoPlay playsInline muted className={cn('relative h-full w-full', fill ? 'object-cover' : 'object-contain')}
          style={{ transform: `scale(${mirror ? -(zoom ? 1 : digital) : zoom ? 1 : digital}, ${zoom ? 1 : digital})` }} />
        {camError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/90">
            <VideoOff className="h-10 w-10" />
            <p>{camError}</p>
            <Button size="sm" variant="secondary" className="bg-white text-primary hover:bg-white/90" onClick={() => setCamTry((n) => n + 1)}>Try again</Button>
          </div>
        )}
        <span className="absolute left-3 top-3 flex items-center gap-1 rounded-md bg-black/50 px-2 py-1 text-xs font-bold text-white">Preview{external && <><Camera className="h-3.5 w-3.5" /> Digital camera</>}</span>
        <div className="absolute right-3 top-3 flex flex-col gap-2">
          <button type="button" onClick={() => { setDeviceId(undefined); setFacing((f) => (f === 'user' ? 'environment' : 'user')); }} className="rounded-full bg-black/50 p-2 text-white" aria-label="Switch camera" title="Switch camera">
            <SwitchCamera className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => setFill((f) => !f)} className="rounded-full bg-black/50 p-2 text-white" aria-label={fill ? 'Show the whole picture' : 'Fill the screen'} title={fill ? 'Whole picture' : 'Fill screen'}>
            {fill ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
        </div>
        {!zoom && !camError && (
          <div className="absolute inset-x-4 bottom-4 flex items-center gap-2 rounded-full bg-black/50 px-3 py-2 text-xs font-semibold text-white">
            <span className="w-9">{digital.toFixed(1)}×</span>
            <input type="range" aria-label="Zoom" className="w-full accent-primary" min={1} max={DIGITAL_ZOOM_MAX} step={0.1} value={digital}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDigital(v);
                saveCameraChoice({ facing, deviceId, external, mirror, micId, digital: v });
              }} />
          </div>
        )}
        {zoom && (
          <div className="absolute inset-x-4 bottom-4 flex items-center gap-2 rounded-full bg-black/50 px-3 py-2 text-xs font-semibold text-white">
            <span>{zoom.value.toFixed(1)}×</span>
            <input type="range" aria-label="Zoom" className="w-full accent-primary" min={zoom.min} max={zoom.max} step={zoom.step || 0.1} value={zoom.value}
              onChange={(e) => {
                const v = Number(e.target.value);
                setZoomState({ ...zoom, value: v });
                if (trackRef.current) void setZoom(trackRef.current, v);
                saveCameraChoice({ facing, deviceId, external, mirror, micId, zoom: v });
              }} />
          </div>
        )}
      </div>

      <form onSubmit={start} className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Saligue Live</p>
          <h1 className="text-2xl font-extrabold tracking-tight min-[360px]:text-3xl">Go live</h1>
          <p className="text-muted-foreground">Show your items on camera. Shoppers chat, send hearts, buy while you talk, and can join you on camera.</p>
        </div>
        {mineLive && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
            <span>You are already live: <b>{mineLive.title}</b></span>
            <Button size="sm" asChild><Link href={`/live/studio?id=${mineLive.id}`}>Back to it</Link></Button>
          </div>
        )}
        <div className="space-y-2">
          <Label className="font-semibold">Camera</Label>
          <CameraSources cameras={cameras} facing={facing} deviceId={deviceId} onPick={(f, id) => { setFacing(f); setDeviceId(id); }} />
          {mics.length > 1 && (
            <select aria-label="Microphone" value={micId ?? ''} onChange={(e) => { setMicId(e.target.value || undefined); saveCameraChoice({ ...loadCameraChoice(), micId: e.target.value || undefined }); }}
              className="h-10 w-full truncate rounded-xl border bg-background px-3 text-sm">
              <option value="">🎙 Usual microphone</option>
              {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>🎙 {m.label}</option>)}
            </select>
          )}
        </div>
        <div className="space-y-2">
          <Label className="font-semibold">Cover</Label>
          <CoverPicker value={cover} onChange={setCover} snap={() => snapFrame(video.current, mirror)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="live-title" className="font-semibold">Title <span className="text-destructive">*</span></Label>
          <Input id="live-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required placeholder="e.g. New kitenge dresses — try them on with me" className="h-12" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="live-desc" className="font-semibold">Description</Label>
          <Textarea id="live-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="What you'll show, sizes available, special prices, delivery…" className="min-h-24" />
        </div>
        <div className="space-y-2">
          <Label className="font-semibold">Items to show ({picked.length})</Label>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have no items on sale. <Link href="/sell" className="text-primary underline">Add one</Link> to sell during the live.</p>
          ) : (
            <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto min-[360px]:grid-cols-3 sm:grid-cols-4">
              {mine.map((p) => {
                const on = picked.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => setPicked((x) => (on ? x.filter((i) => i !== p.id) : [...x, p.id]))}
                    className={cn('relative rounded-xl border-2 bg-muted p-1 text-left transition', on ? 'border-primary' : 'border-transparent hover:border-primary/40')}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.cutout || p.image} alt="" className="aspect-square w-full object-contain" />
                    <span className="block truncate px-1 text-[11px] font-medium">{p.name}</span>
                    <span className="block px-1 text-[11px] font-bold text-primary">{formatPrice(Number(p.price))}</span>
                    {on && <Check className="absolute right-1 top-1 h-5 w-5 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <Button type="submit" size="lg" className="h-14 w-full text-lg" disabled={starting || !title.trim()}>
          {starting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Radio className="mr-2 h-5 w-5" />} Go live now
        </Button>
        <p className="text-center text-xs text-muted-foreground">Your browser asks to use the camera and microphone — tap Allow. Your past customers get a notification that you are live.</p>
      </form>
    </div>
  );
}

/** While live: the stream, chat and hearts, and the host's controls. */
function Studio({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { authUid } = useAuth();
  const { products } = useProductStore();
  const { live, comments, guests, bursts, error, blockedWords, setBlockedWords, gift } = useLive(id, authUid);
  const [replyTo, setReplyTo] = useState<LiveComment | null>(null);
  const { tiles, viewers, audience, status, error: roomError, camOn, micOn, toggleCam, toggleMic, flipCamera, restartCamera, facing, mirror, flipMirror, switchMic, retry, videoTrack, zoomInfo, setLiveZoom: applyZoom } = useLiveRoom(id, live?.status === 'live', true);
  const [liveZoom, setLiveZoom] = useState<{ min: number; max: number; step?: number; value: number; digital: boolean } | null>(null);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [micId, setMicId] = useState(() => (typeof window === 'undefined' ? '' : loadCameraChoice().micId ?? ''));
  const [cameraId, setCameraId] = useState('');
  const [goal, setGoal] = useState('');
  const [wordsDraft, setWordsDraft] = useState('');
  const elapsed = useElapsed(live?.startedAt);
  const [panel, setPanel] = useState<'products' | 'guests' | 'settings' | 'viewers' | 'poll' | null>(null);
  const [selected, setSelected] = useState<LiveComment | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [say, setSay] = useState('');

  // A viewer answered the invitation to come on camera.
  useEffect(() => onServerEvent('live', (d: { liveId?: string; type?: string; name?: string; accepted?: boolean }) => {
    if (d?.liveId === id && d.type === 'invite_answer') toast({ title: d.accepted ? `${d.name} is joining you on camera` : `${d.name} said no for now` });
  }), [id, toast]);

  // Remember the most viewers at once.
  useEffect(() => {
    if (live?.status === 'live' && viewers > (live.peakViewers ?? 0)) updateLive(id, { viewers }).catch(() => {});
  }, [viewers, live?.status, live?.peakViewers, id]);

  const featured = useMemo(() => (live?.productIds ?? []).map((pid) => products.find((p) => p.id === pid)).filter(Boolean) as typeof products, [live?.productIds, products]);
  const mine = useMemo(() => products.filter((p) => p.sellerId === authUid && p.status === 'active'), [products, authUid]);
  const pinned = products.find((p) => p.id === live?.pinnedProductId) ?? null;
  const pinnedComment = comments.find((c) => c.id === live?.pinnedCommentId) ?? null;
  const requests = guests.filter((g) => g.status === 'requested');
  const onCamera = guests.filter((g) => g.status === 'accepted');
  const roles = useMemo(() => {
    const r: Record<string, 'Host' | 'Mod'> = {};
    for (const m of live?.moderators ?? []) r[m.uid] = 'Mod';
    if (authUid) r[authUid] = 'Host';
    return r;
  }, [live?.moderators, authUid]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast({ title: done });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(e) });
    }
  };

  const share = async () => {
    await shareLink({ title: live?.title ?? 'Saligue Live', text: 'I’m live on Saligue: come and watch', url: absoluteUrl(`/live/watch?id=${id}`) });
  };

  if (error) return <p className="p-10 text-center text-muted-foreground">{error}</p>;
  if (!live) return <Skeleton className="mx-auto h-[80vh] max-w-md" />;
  if (live.status === 'ended') {
    return (
      <div className="mx-auto max-w-md space-y-4 p-10 text-center">
        <Radio className="mx-auto h-12 w-12 text-primary" />
        <h1 className="text-2xl font-extrabold">Your live has ended</h1>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-muted p-3"><p className="text-xl font-bold">{live.peakViewers}</p><p className="text-xs text-muted-foreground">Most viewers</p></div>
          <div className="rounded-xl bg-muted p-3"><p className="text-xl font-bold">{live.likeCount}</p><p className="text-xs text-muted-foreground">Hearts</p></div>
          <div className="rounded-xl bg-muted p-3"><p className="text-xl font-bold">{comments.filter((c) => c.kind !== 'join').length}</p><p className="text-xs text-muted-foreground">Comments</p></div>
        </div>
        <div className="flex justify-center gap-2">
          <Button asChild><Link href="/dashboard/orders">See orders</Link></Button>
          <Button variant="outline" onClick={() => router.replace('/live/studio')}>Go live again</Button>
        </div>
      </div>
    );
  }

  const button = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white min-[360px]:h-12 min-[360px]:w-12';
  const openSettings = () => {
    setLiveZoom(zoomInfo());
    setCameraId(videoTrack()?.getSettings().deviceId ?? '');
    setGoal(live.heartGoal ? String(live.heartGoal) : '');
    setWordsDraft(blockedWords.join(', '));
    void listCameras().then(setCameras);
    void listMicrophones().then(setMics);
    setPanel('settings');
  };
  // Small phones: the buttons scroll sideways instead of running off the screen.
  const controls = (
    <div className="-mx-3 flex snap-x items-center gap-2 overflow-x-auto px-3 [scrollbar-width:none] sm:justify-center [&::-webkit-scrollbar]:hidden">
      <button type="button" onClick={toggleMic} className={cn(button, micOn ? 'bg-black/45' : 'bg-destructive')} aria-label={micOn ? 'Mute' : 'Unmute'}>{micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}</button>
      <button type="button" onClick={toggleCam} className={cn(button, camOn ? 'bg-black/45' : 'bg-destructive')} aria-label={camOn ? 'Camera off' : 'Camera on'}>{camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}</button>
      <button type="button" onClick={flipCamera} className={cn(button, 'bg-black/45')} aria-label="Switch camera"><SwitchCamera className="h-5 w-5" /></button>
      <button type="button" onClick={() => setPanel('products')} className={cn(button, 'bg-black/45')} aria-label="Items"><Package className="h-5 w-5" /></button>
      <button type="button" onClick={() => setPanel('poll')} className={cn(button, live.poll?.open ? 'bg-primary' : 'bg-black/45')} aria-label="Poll"><BarChart3 className="h-5 w-5" /></button>
      <button type="button" onClick={() => setPanel('guests')} className={cn(button, 'relative bg-black/45')} aria-label="Guests">
        <Users className="h-5 w-5" />
        {requests.length > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold">{requests.length}</span>}
      </button>
      <button type="button" onClick={share} className={cn(button, 'bg-black/45')} aria-label="Share"><Share2 className="h-5 w-5" /></button>
      <button type="button" onClick={openSettings} className={cn(button, 'bg-black/45')} aria-label="Settings"><Settings2 className="h-5 w-5" /></button>
    </div>
  );

  const settingsPanel = (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-semibold">Who can comment</p>
        <div className="grid grid-cols-3 gap-2">
          {([['everyone', 'Everyone'], ['followers', 'Clients'], ['off', 'Off']] as const).map(([v, label]) => (
            <Button key={v} type="button" variant={live.chatMode === v ? 'default' : 'outline'} onClick={() => act(() => updateLive(id, { chatMode: v }))}>{label}</Button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Slow mode</p>
        <div className="grid grid-cols-4 gap-2">
          {[0, 10, 30, 60].map((sec) => (
            <Button key={sec} type="button" variant={live.slowSeconds === sec ? 'default' : 'outline'} onClick={() => act(() => updateLive(id, { slowSeconds: sec }))}>{sec ? `${sec}s` : 'Off'}</Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">How long each viewer waits between comments.</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Picture</p>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant={live.videoFit !== 'fill' ? 'default' : 'outline'} onClick={() => act(() => updateLive(id, { videoFit: 'fit' }))}><Minimize className="mr-2 h-4 w-4" /> Whole</Button>
          <Button type="button" variant={live.videoFit === 'fill' ? 'default' : 'outline'} onClick={() => act(() => updateLive(id, { videoFit: 'fill' }))}><Maximize className="mr-2 h-4 w-4" /> Fill</Button>
        </div>
        <p className="text-xs text-muted-foreground">Whole shows your full camera picture to everyone. Fill covers the screen and cuts the edges.</p>
      </div>
      {cameras.length > 1 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Camera</p>
          <div className="grid gap-2">
            {cameras.map((c) => (
              <Button key={c.deviceId} type="button" variant={cameraId === c.deviceId ? 'default' : 'outline'} className="min-w-0 justify-start"
                onClick={() => act(async () => {
                  const f = c.kind === 'front' ? 'user' : c.kind === 'back' || c.kind === 'external' ? 'environment' : facing;
                  await restartCamera({ facing: f, deviceId: c.deviceId, external: c.kind === 'external', mirror: mirrorFor(f, c) });
                  setCameraId(c.deviceId);
                  setLiveZoom(zoomInfo());
                })}>
                {c.kind === 'external' ? <Camera className="mr-2 h-4 w-4 shrink-0" /> : c.kind === 'front' ? <Smartphone className="mr-2 h-4 w-4 shrink-0" /> : <Video className="mr-2 h-4 w-4 shrink-0" />}
                <span className="truncate">{c.kind === 'external' ? `Digital camera · ${c.label}` : c.label}</span>
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Digital cameras connect by USB (webcam mode) or an HDMI capture card. On many phones one back camera is wide-angle: pick it to show more.</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">Mirror my picture</span>
        <Button type="button" size="sm" variant={mirror ? 'default' : 'outline'} onClick={flipMirror}><FlipHorizontal2 className="mr-1.5 h-4 w-4" /> {mirror ? 'On' : 'Off'}</Button>
      </div>
      <p className="-mt-4 text-xs text-muted-foreground">Only for you. Viewers always see the real picture, so writing reads the right way.</p>
      {mics.length > 1 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Microphone</p>
          <select aria-label="Microphone" value={micId} onChange={(e) => { setMicId(e.target.value); void act(() => switchMic(e.target.value)); }} className="h-10 w-full truncate rounded-xl border bg-background px-3 text-sm">
            <option value="">Usual microphone</option>
            {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label}</option>)}
          </select>
        </div>
      )}
      <div className="space-y-2">
        <p className="text-sm font-semibold">Cover</p>
        <CoverPicker value={live.thumbnail ?? null} onChange={(v) => act(() => updateLive(id, { thumbnail: v }), 'Cover changed')}
          snap={() => snapFrame(document.querySelector<HTMLVideoElement>('video[data-live-video="host"]'), false)} />
      </div>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void act(() => updateLive(id, { heartGoal: Number(goal) || 0 }), Number(goal) ? 'Goal set' : 'Goal removed'); }}>
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Heart className="h-4 w-4 text-primary" /> Heart goal</p>
        <div className="flex gap-2">
          <Input type="number" min={0} inputMode="numeric" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. 1000" className="min-w-0" />
          <Button type="submit" variant="outline">Save</Button>
        </div>
        <p className="text-xs text-muted-foreground">A bar shows everyone how close you are. Empty = no goal.</p>
      </form>
      <form className="space-y-2" onSubmit={(e) => {
        e.preventDefault();
        const words = wordsDraft.split(/[,\n]+/).map((w) => w.trim()).filter(Boolean);
        void act(() => updateLive(id, { blockedWords: words }).then(() => setBlockedWords(words)), 'Filter saved');
      }}>
        <p className="flex items-center gap-1.5 text-sm font-semibold"><ShieldOff className="h-4 w-4 text-primary" /> Hide comments with these words</p>
        <Textarea value={wordsDraft} onChange={(e) => setWordsDraft(e.target.value)} placeholder="Words separated by commas" className="min-h-16" />
        <Button type="submit" variant="outline" className="w-full">Save filter</Button>
        <p className="text-xs text-muted-foreground">The writer still sees their comment; nobody else does.</p>
      </form>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Zoom</p>
        {liveZoom ? (
          <div className="flex items-center gap-3">
            <span className="w-10 text-sm font-semibold">{liveZoom.value.toFixed(1)}×</span>
            <input type="range" aria-label="Zoom" className="w-full accent-primary" min={liveZoom.min} max={liveZoom.max} step={liveZoom.step || 0.1} value={liveZoom.value}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLiveZoom({ ...liveZoom, value: v });
                void applyZoom(v);
              }} />
          </div>
        ) : null}
        {liveZoom?.digital && <p className="text-xs text-muted-foreground">This camera has no zoom of its own, so Saligue zooms into the centre of the picture. Viewers see exactly this. For a wider view, use Whole picture or a wide-angle camera.</p>}
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex h-[100dvh] max-w-6xl gap-6 bg-black md:h-dvh md:bg-transparent md:p-6">
      <div className="relative h-full w-full overflow-hidden bg-black md:aspect-[9/16] md:w-auto md:rounded-3xl md:shadow-2xl">
        <LiveStage tiles={tiles} fill={live.videoFit === 'fill'} waiting={roomError ?? (status === 'connecting' ? 'Starting your camera…' : 'Reconnecting…')} />
        <LiveTopBar live={live} viewers={viewers} elapsed={elapsed} onViewers={() => setPanel('viewers')}>
          <button type="button" onClick={() => setConfirmEnd(true)} className="rounded-md bg-destructive px-2.5 py-1 text-xs font-bold text-white">End</button>
        </LiveTopBar>
        <HeartGoal likes={live.likeCount} goal={live.heartGoal} />
        {live.poll && <PollBubble poll={live.poll} onManage={() => setPanel('poll')} lower={!!live.heartGoal} />}
        <Hearts bursts={bursts} />
        <GiftBanner gift={gift} />
        {roomError && (
          <div className="absolute inset-x-3 top-1/3 z-20 space-y-3 rounded-2xl bg-background/95 p-4 text-center text-sm shadow-xl">
            <p>{roomError}</p>
            <Button onClick={retry}>Try again</Button>
          </div>
        )}
        {requests.length > 0 && (
          <button type="button" onClick={() => setPanel('guests')} className={cn('absolute left-3 z-10 flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-white shadow-lg', live.poll ? (live.heartGoal ? 'top-[calc(128px+var(--sat))]' : 'top-[calc(98px+var(--sat))]') : live.heartGoal ? 'top-[calc(92px+var(--sat))]' : 'top-[calc(4rem+var(--sat))]')}>
            <Users className="h-4 w-4" /> {requests[0].name}{requests.length > 1 ? ` +${requests.length - 1}` : ''} wants to join
          </button>
        )}
        <div className="absolute inset-x-0 bottom-0 z-10 space-y-2 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-3 pb-[calc(0.75rem+var(--sab))] pt-16">
          <LiveChat comments={comments} pinned={pinnedComment} roles={roles} onAction={(c) => c.kind !== 'join' && setSelected(c)} />
          {pinned && <PinnedProduct product={pinned} compact />}
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            if (!say.trim()) return;
            void act(() => sendLiveComment(id, say.trim(), 'comment', replyTo?.id)).then(() => { setSay(''); setReplyTo(null); });
          }}>
            <LiveInput value={say} onChange={setSay} placeholder={replyTo ? `Reply to ${replyTo.name}…` : 'Write to your viewers…'} />
            {replyTo && <button type="button" onClick={() => setReplyTo(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/40 text-white" aria-label="Cancel reply"><X className="h-5 w-5" /></button>}
          </form>
          {controls}
        </div>
      </div>

      {/* Computers: controls beside the stream. */}
      <aside className="hidden min-w-0 flex-1 flex-col gap-4 overflow-y-auto md:flex">
        <div className="rounded-2xl border bg-card p-5">
          <h1 className="text-xl font-extrabold">{live.title}</h1>
          {live.description && <ExpandableText text={live.description} lines={3} className="mt-1 text-sm text-muted-foreground" />}
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-muted p-2"><p className="text-lg font-bold">{viewers}</p><p className="text-xs text-muted-foreground">Watching</p></div>
            <div className="rounded-xl bg-muted p-2"><p className="text-lg font-bold">{live.likeCount}</p><p className="text-xs text-muted-foreground">Hearts</p></div>
            <div className="rounded-xl bg-muted p-2"><p className="text-lg font-bold">{elapsed}</p><p className="text-xs text-muted-foreground">Live for</p></div>
          </div>
        </div>
        <ProductsPanel id={id} featured={featured} mine={mine} pinnedId={live.pinnedProductId} />
        <div className="rounded-2xl border bg-card p-5"><h2 className="mb-3 flex items-center gap-2 font-bold"><BarChart3 className="h-4 w-4 text-primary" /> Poll</h2><PollPanel id={id} live={live} /></div>
        <GuestsPanel id={id} requests={requests} onCamera={onCamera} />
        <ViewersPanel id={id} live={live} audience={audience} guests={guests} />
        <div className="rounded-2xl border bg-card p-5"><h2 className="mb-4 font-bold">Live settings</h2>{settingsPanel}</div>
      </aside>

      <Sheet open={!!panel} onOpenChange={(v) => !v && setPanel(null)}>
        <SheetContent side="bottom" className={cn('max-h-[80vh] overflow-y-auto rounded-t-3xl px-4 min-[360px]:px-6', panel !== 'settings' && panel !== 'poll' && 'md:hidden')}>
          <SheetHeader><SheetTitle>{panel === 'products' ? 'Items in your live' : panel === 'settings' ? 'Live settings' : panel === 'poll' ? 'Poll' : panel === 'viewers' ? `Watching (${audience.length})` : 'Guests'}</SheetTitle></SheetHeader>
          <div className="mt-4">
            {panel === 'viewers' ? <ViewersPanel id={id} live={live} audience={audience} guests={guests} bare /> : panel === 'products' ? <ProductsPanel id={id} featured={featured} mine={mine} pinnedId={live.pinnedProductId} bare /> : panel === 'settings' ? settingsPanel : panel === 'poll' ? <PollPanel id={id} live={live} /> : <GuestsPanel id={id} requests={requests} onCamera={onCamera} bare />}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          {selected && (
            <div className="space-y-3">
              <p className="text-sm"><b>{selected.name}</b>: {selected.text}</p>
              <div className="grid gap-2">
                <Button onClick={() => { setReplyTo(selected); setSelected(null); }}><Reply className="mr-2 h-4 w-4" /> Reply</Button>
                <Button variant="outline" onClick={() => act(() => updateLive(id, { pinnedCommentId: live.pinnedCommentId === selected.id ? null : selected.id })).then(() => setSelected(null))}>
                  {live.pinnedCommentId === selected.id ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />} {live.pinnedCommentId === selected.id ? 'Unpin' : 'Pin for everyone'}
                </Button>
                <Button variant="outline" onClick={() => act(() => removeLiveComment(id, selected.id), 'Comment removed').then(() => setSelected(null))}><Trash2 className="mr-2 h-4 w-4" /> Remove comment</Button>
                {selected.uid !== authUid && (
                  <Button variant="outline" onClick={() => act(() => setLiveModerator(id, selected.uid, !roles[selected.uid]), roles[selected.uid] ? `${selected.name} is no longer a moderator` : `${selected.name} is now a moderator`).then(() => setSelected(null))}>
                    {roles[selected.uid] ? <ShieldOff className="mr-2 h-4 w-4" /> : <Shield className="mr-2 h-4 w-4" />} {roles[selected.uid] ? 'Remove moderator' : 'Make moderator'}
                  </Button>
                )}
                {selected.uid !== authUid && (
                  <Button variant="outline" className="text-destructive" onClick={() => act(() => muteInLive(id, selected.uid), `${selected.name} can no longer comment`).then(() => setSelected(null))}><VolumeX className="mr-2 h-4 w-4" /> Mute {selected.name}</Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End your live?</AlertDialogTitle>
            <AlertDialogDescription>Everyone watching will see that the live has ended. Orders placed during the live stay in your Orders.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => act(() => endLive(id))}>End live</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Ask viewers a question with 2–4 answers (like Instagram and TikTok live polls); results update as they vote. */
function PollPanel({ id, live }: { id: string; live: Live }) {
  const { toast } = useToast();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const save = (body: Parameters<typeof updateLive>[1], done: string) => updateLive(id, body).then(() => toast({ title: done })).catch((e) => toast({ variant: 'destructive', title: 'Not done', description: friendlyError(e) }));
  if (live.poll) {
    return (
      <div className="space-y-3">
        <PollCard poll={live.poll} className="border shadow-none" />
        <div className="grid grid-cols-2 gap-2">
          {live.poll.open
            ? <Button variant="outline" onClick={() => save({ pollOpen: false }, 'Poll closed')}>Close voting</Button>
            : <Button variant="outline" onClick={() => save({ pollOpen: true }, 'Poll open again')}>Open again</Button>}
          <Button variant="ghost" className="text-destructive" onClick={() => save({ poll: null }, 'Poll removed')}><Trash2 className="mr-1.5 h-4 w-4" /> Remove</Button>
        </div>
      </div>
    );
  }
  return (
    <form className="space-y-2" onSubmit={(e) => {
      e.preventDefault();
      void save({ poll: { question, options: options.filter((o) => o.trim()) } }, 'Poll started').then(() => { setQuestion(''); setOptions(['', '']); });
    }}>
      <Input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={120} required placeholder="Question, e.g. Which colour next?" />
      {options.map((o, i) => (
        <div key={i} className="flex gap-2">
          <Input value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} maxLength={40} required={i < 2} placeholder={`Answer ${i + 1}`} className="min-w-0" />
          {i >= 2 && <Button type="button" size="icon" variant="ghost" aria-label="Remove answer" onClick={() => setOptions(options.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>}
        </div>
      ))}
      <div className="flex gap-2">
        {options.length < 4 && <Button type="button" variant="outline" onClick={() => setOptions([...options, ''])}><Plus className="mr-1 h-4 w-4" /> Answer</Button>}
        <Button type="submit" className="flex-1"><BarChart3 className="mr-1.5 h-4 w-4" /> Start poll</Button>
      </div>
    </form>
  );
}

function ProductsPanel({ id, featured, mine, pinnedId, bare }: { id: string; featured: ReturnType<typeof useProductStore.getState>['products']; mine: ReturnType<typeof useProductStore.getState>['products']; pinnedId: string | null; bare?: boolean }) {
  const { toast } = useToast();
  const featuredIds = featured.map((p) => p.id);
  const save = (body: Parameters<typeof updateLive>[1]) => updateLive(id, body).catch((e) => toast({ variant: 'destructive', title: 'Not saved', description: friendlyError(e) }));
  return (
    <div className={cn(!bare && 'rounded-2xl border bg-card p-5')}>
      {!bare && <h2 className="mb-1 font-bold">Items in your live</h2>}
      <p className="mb-3 text-xs text-muted-foreground">Tap <b>Show now</b> to pin an item on every viewer’s screen with a Buy button.</p>
      <div className="space-y-2">
        {mine.map((p) => {
          const inLive = featuredIds.includes(p.id);
          const isPinned = pinnedId === p.id;
          return (
            <div key={p.id} className={cn('flex items-center gap-3 rounded-xl border p-2', isPinned && 'border-primary bg-primary/5')}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.cutout || p.image} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-muted object-contain p-1" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{p.name}</p>
                <p className="text-xs text-muted-foreground">{formatPrice(Number(p.price))}{p.stock != null ? ` · ${p.stock} in stock` : ''}</p>
              </div>
              {isPinned ? (
                <Button size="sm" variant="secondary" onClick={() => save({ pinnedProductId: null })}><PinOff className="mr-1 h-3.5 w-3.5" /> Hide</Button>
              ) : (
                <Button size="sm" onClick={() => save({ pinnedProductId: p.id, ...(inLive ? {} : { productIds: [...featuredIds, p.id] }) })}><Pin className="mr-1 h-3.5 w-3.5" /> Show now</Button>
              )}
              <button type="button" title={inLive ? 'Remove from this live' : 'Add to this live'} onClick={() => save({ productIds: inLive ? featuredIds.filter((x) => x !== p.id) : [...featuredIds, p.id] })}
                className={cn('rounded-full p-1.5', inLive ? 'text-primary' : 'text-muted-foreground')}>
                {inLive ? <Check className="h-4 w-4" /> : <X className="h-4 w-4 rotate-45" />}
              </button>
            </div>
          );
        })}
        {mine.length === 0 && <p className="text-sm text-muted-foreground">No items on sale yet.</p>}
      </div>
    </div>
  );
}

function GuestsPanel({ id, requests, onCamera, bare }: { id: string; requests: { uid: string; name: string }[]; onCamera: { uid: string; name: string }[]; bare?: boolean }) {
  const { toast } = useToast();
  const decide = (uid: string, decision: 'accept' | 'decline' | 'remove') => decideGuest(id, uid, decision).catch((e) => toast({ variant: 'destructive', title: 'Not done', description: friendlyError(e) }));
  return (
    <div className={cn(!bare && 'rounded-2xl border bg-card p-5')}>
      {!bare && <h2 className="mb-1 font-bold">Guests on camera</h2>}
      <p className="mb-3 text-xs text-muted-foreground">Viewers can ask to join you on camera (up to 3 at once).</p>
      {onCamera.map((g) => (
        <div key={g.uid} className="mb-2 flex items-center justify-between rounded-xl bg-primary/5 p-2 text-sm">
          <span className="flex items-center gap-2 font-medium"><UserCheck className="h-4 w-4 text-primary" /> {g.name}</span>
          <Button size="sm" variant="outline" onClick={() => decide(g.uid, 'remove')}><UserMinus className="mr-1 h-3.5 w-3.5" /> Remove</Button>
        </div>
      ))}
      {requests.map((g) => (
        <div key={g.uid} className="mb-2 flex items-center justify-between gap-2 rounded-xl border p-2 text-sm">
          <span className="min-w-0 truncate font-medium">{g.name} <span className="font-normal text-muted-foreground">wants to join</span></span>
          <span className="flex shrink-0 gap-1">
            <Button size="sm" onClick={() => decide(g.uid, 'accept')}>Accept</Button>
            <Button size="sm" variant="ghost" onClick={() => decide(g.uid, 'decline')}>Decline</Button>
          </span>
        </div>
      ))}
      {!requests.length && !onCamera.length && <p className="text-sm text-muted-foreground">No requests yet.</p>}
    </div>
  );
}

/** Who is watching right now; the host can make someone a moderator, invite them on camera (co-host) or mute them. */
function ViewersPanel({ id, live, audience, guests, bare }: { id: string; live: Live; audience: Watcher[]; guests: LiveGuest[]; bare?: boolean }) {
  const { toast } = useToast();
  const mods = new Set((live.moderators ?? []).map((m) => m.uid));
  const onCamera = new Set(guests.filter((g) => g.status === 'accepted').map((g) => g.uid));
  const act = (fn: () => Promise<unknown>, done: string) => fn().then(() => toast({ title: done })).catch((e) => toast({ variant: 'destructive', title: 'Not done', description: friendlyError(e) }));
  // Moderators who aren't watching right now still show, so they can be removed.
  const people = [...audience, ...(live.moderators ?? []).filter((m) => !audience.some((a) => a.uid === m.uid)).map((m) => ({ uid: m.uid, name: m.name, role: 'away', account: true }))];
  const icon = 'flex h-9 w-9 items-center justify-center rounded-full border transition hover:bg-muted disabled:opacity-40';
  return (
    <div className={cn(!bare && 'rounded-2xl border bg-card p-5')}>
      {!bare && <h2 className="mb-1 flex items-center gap-2 font-bold"><Eye className="h-4 w-4 text-primary" /> Watching ({audience.length})</h2>}
      <p className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Shield className="h-3.5 w-3.5" /> Moderator</span>
        <span className="flex items-center gap-1"><Video className="h-3.5 w-3.5" /> Co-host on camera</span>
        <span className="flex items-center gap-1"><VolumeX className="h-3.5 w-3.5" /> Mute</span>
      </p>
      <div className="space-y-1.5">
        {people.map((p) => {
          const mod = mods.has(p.uid);
          const cam = onCamera.has(p.uid) || p.role === 'guest';
          return (
            <div key={p.uid} className="flex items-center gap-2 rounded-xl border p-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">
                {p.name}
                {mod && <span className="ml-1.5 rounded bg-sky-500 px-1 py-px text-[10px] font-extrabold uppercase text-white">Mod</span>}
                {cam && <span className="ml-1.5 rounded bg-primary px-1 py-px text-[10px] font-extrabold uppercase text-white">On camera</span>}
                {p.role === 'away' && <span className="ml-1.5 text-xs text-muted-foreground">not watching</span>}
              </span>
              <button type="button" className={cn(icon, mod && 'border-sky-500 bg-sky-500 text-white hover:bg-sky-600')} disabled={!p.account}
                title={!p.account ? 'Needs a Saligue account' : mod ? 'Remove moderator' : 'Make moderator'} aria-label={mod ? `Remove ${p.name} as moderator` : `Make ${p.name} a moderator`}
                onClick={() => act(() => setLiveModerator(id, p.uid, !mod), mod ? `${p.name} is no longer a moderator` : `${p.name} is now a moderator`)}>
                {mod ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
              </button>
              {cam ? (
                <button type="button" className={cn(icon, 'border-primary text-primary')} title="Take off camera" aria-label={`Take ${p.name} off camera`}
                  onClick={() => act(() => decideGuest(id, p.uid, 'remove'), `${p.name} is off camera`)}><UserMinus className="h-4 w-4" /></button>
              ) : (
                <button type="button" className={icon} disabled={!p.account || p.role === 'away'} title={!p.account ? 'Needs a Saligue account' : 'Invite on camera (co-host)'} aria-label={`Invite ${p.name} on camera`}
                  onClick={() => act(() => inviteOnCamera(id, p.uid), `Invitation sent to ${p.name}`)}><Video className="h-4 w-4" /></button>
              )}
              <button type="button" className={cn(icon, 'text-destructive')} title="Mute" aria-label={`Mute ${p.name}`}
                onClick={() => act(() => muteInLive(id, p.uid), `${p.name} can no longer comment`)}><VolumeX className="h-4 w-4" /></button>
            </div>
          );
        })}
        {people.length === 0 && <p className="text-sm text-muted-foreground">No one is watching yet. Share your live to bring people in.</p>}
      </div>
    </div>
  );
}

function StudioPage() {
  const params = useSearchParams();
  const id = params.get('id');
  const router = useRouter();
  const { user, role, isAuthLoading } = useAuth();
  useEffect(() => {
    if (!isAuthLoading && (!user || role !== 'seller')) router.replace('/sell');
  }, [isAuthLoading, user, role, router]);
  if (isAuthLoading || !user || role !== 'seller') return <Skeleton className="mx-auto h-[80vh] max-w-md" />;
  return id ? <Studio id={id} /> : <Setup />;
}

export default function LiveStudio() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-[80vh] max-w-md" />}>
      <StudioPage />
    </Suspense>
  );
}

