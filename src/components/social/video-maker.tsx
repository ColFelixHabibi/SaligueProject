
'use client';

import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Download, Film, Music, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { loadImage } from '@/lib/ai/canvas';
import { friendlyError } from '@/lib/errors';
import { cn } from '@/lib/utils';

const SECONDS = 30;
const WIDTH = 720;
const HEIGHT = 1280;

type Style = 'zoom' | 'pan' | 'beat';
const STYLES: { value: Style; label: string }[] = [
  { value: 'zoom', label: 'Slow zoom' },
  { value: 'pan', label: 'Gentle pan' },
  { value: 'beat', label: 'Move to the beat' },
];

function pickMimeType() {
  const options = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return options.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
}

// Blurred, darkened copy of the image filling the frame behind the sharp one.
function makeBackdrop(img: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;
  const scale = Math.max(WIDTH / img.naturalWidth, HEIGHT / img.naturalHeight) * 1.2;
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  ctx.filter = 'blur(40px) saturate(1.3)';
  ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return canvas;
}

interface VideoMakerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  title: string;
  subtitle?: string;
}

/** Turns a look into a 30-second vertical video with the user's own music (or the sound of a video). On-device. */
export function VideoMaker({ open, onOpenChange, imageUrl, title, subtitle }: VideoMakerProps) {
  const { toast } = useToast();
  const [sound, setSound] = useState<{ url: string; name: string; duration: number } | null>(null);
  const [start, setStart] = useState(0);
  const [style, setStyle] = useState<Style>('beat');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; ext: string } | null>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) {
      cancelRef.current?.();
      setProgress(null);
    }
  }, [open]);
  useEffect(() => () => {
    if (sound) URL.revokeObjectURL(sound.url);
  }, [sound]);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const chooseSound = (file?: File) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      setSound({ url, name: file.name, duration: probe.duration || 0 });
      setStart(0);
      setResult(null);
    };
    probe.onerror = () => toast({ variant: 'destructive', title: 'Could not read this file', description: 'Choose another song or video.' });
    probe.src = url;
  };

  const create = async () => {
    const mimeType = pickMimeType();
    if (!mimeType || !('captureStream' in HTMLCanvasElement.prototype)) {
      toast({ variant: 'destructive', title: 'Not supported', description: 'This browser cannot record video. Try Chrome or Safari.' });
      return;
    }
    setResult(null);
    setProgress(0);
    try {
      const img = await loadImage(imageUrl);
      const backdrop = makeBackdrop(img);
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext('2d')!;
      const tracks: MediaStreamTrack[] = [...canvas.captureStream(30).getVideoTracks()];

      // Sound: play the chosen file through an analyser (for the beat) into the recording.
      let media: HTMLVideoElement | null = null;
      let audioContext: AudioContext | null = null;
      let analyser: AnalyserNode | null = null;
      if (sound) {
        media = document.createElement('video');
        media.src = sound.url;
        media.playsInline = true;
        media.loop = true;
        await new Promise((resolve) => {
          media!.onloadedmetadata = resolve;
          media!.load();
        });
        media.currentTime = start;
        audioContext = new AudioContext();
        const source = audioContext.createMediaElementSource(media);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        const destination = audioContext.createMediaStreamDestination();
        source.connect(analyser);
        analyser.connect(destination);
        analyser.connect(audioContext.destination);
        tracks.push(...destination.stream.getAudioTracks());
      }

      const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

      const levels = new Uint8Array(analyser?.frequencyBinCount ?? 0);
      let smoothLevel = 0;
      let frame = 0;
      let stopped = false;
      const began = performance.now();

      const draw = () => {
        if (stopped) return;
        const t = (performance.now() - began) / 1000;
        if (analyser) {
          analyser.getByteFrequencyData(levels);
          const bass = levels.slice(0, 12).reduce((a, b) => a + b, 0) / (12 * 255);
          smoothLevel = smoothLevel * 0.7 + bass * 0.3;
        }
        ctx.drawImage(backdrop, 0, 0);

        // The look, kept whole, animated by the chosen style.
        const fit = Math.min((WIDTH * 0.9) / img.naturalWidth, (HEIGHT * 0.68) / img.naturalHeight);
        let scale = 1, dx = 0, rotate = 0;
        if (style === 'zoom') scale = 1 + 0.15 * (t / SECONDS);
        if (style === 'pan') { scale = 1.06; dx = Math.sin(t * 0.5) * 30; }
        if (style === 'beat') { scale = 1 + smoothLevel * 0.12; rotate = Math.sin(t * 1.2) * 0.015; }
        const w = img.naturalWidth * fit * scale, h = img.naturalHeight * fit * scale;
        ctx.save();
        ctx.translate(WIDTH / 2 + dx, HEIGHT * 0.42);
        ctx.rotate(rotate);
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 40;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();

        // Brand and caption.
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 40px Inter, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Saligue', 40, 80);
        ctx.font = '700 18px Inter, Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText('BY INDECIANA', 42, 108);
        const grad = ctx.createLinearGradient(0, HEIGHT - 320, 0, HEIGHT);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.75)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, HEIGHT - 320, WIDTH, 320);
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 48px Inter, Arial, sans-serif';
        ctx.fillText(title.slice(0, 26), 40, HEIGHT - 140);
        if (subtitle) {
          ctx.font = '600 32px Inter, Arial, sans-serif';
          ctx.fillStyle = '#ff5fa8';
          ctx.fillText(subtitle.slice(0, 40), 40, HEIGHT - 86);
        }

        // Fade in and out.
        const fade = Math.min(1, t / 0.6, (SECONDS - t) / 0.6);
        if (fade < 1) {
          ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, fade)})`;
          ctx.fillRect(0, 0, WIDTH, HEIGHT);
        }

        if (++frame % 10 === 0) setProgress(Math.min(100, (t / SECONDS) * 100));
        if (t >= SECONDS) {
          stopped = true;
          recorder.stop();
          return;
        }
        requestAnimationFrame(draw);
      };

      cancelRef.current = () => {
        stopped = true;
        if (recorder.state !== 'inactive') recorder.stop();
      };
      recorder.start(500);
      await media?.play();
      requestAnimationFrame(draw);
      await done;
      media?.pause();
      await audioContext?.close();
      tracks.forEach((track) => track.stop());
      cancelRef.current = null;

      if (frame === 0) return;
      const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
      setResult({ url: URL.createObjectURL(blob), blob, ext: mimeType.includes('mp4') ? 'mp4' : 'webm' });
    } catch (error) {
      console.error('Video creation failed:', error);
      toast({ variant: 'destructive', title: 'Could not make the video', description: friendlyError(error) });
    } finally {
      setProgress(null);
    }
  };

  const share = async () => {
    if (!result) return;
    const file = new File([result.blob], `saligue-${title.replace(/\W+/g, '-').toLowerCase()}.${result.ext}`, { type: result.blob.type });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
      else toast({ title: 'Use Save', description: 'Sharing videos directly is not supported here. Save it, then share from your gallery.' });
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') toast({ variant: 'destructive', title: 'Could not share', description: friendlyError(error) });
    }
  };

  const recording = progress !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Clapperboard className="h-5 w-5 text-primary" /> Make a 30-second video</DialogTitle>
          <DialogDescription>Add your own music, or the sound from any video on your phone.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <video src={result.url} controls playsInline className="mx-auto max-h-[60vh] rounded-lg bg-black" />
            <div className="grid grid-cols-2 gap-2">
              <Button asChild>
                <a href={result.url} download={`saligue-video.${result.ext}`}><Download className="mr-2 h-4 w-4" /> Save</a>
              </Button>
              <Button variant="outline" onClick={share}><Share2 className="mr-2 h-4 w-4" /> Share</Button>
            </div>
            <Button variant="ghost" className="w-full" onClick={() => setResult(null)}>Make another</Button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={title} className="mx-auto h-40 rounded-lg object-contain" />

            <div className="space-y-2">
              <Label>Sound</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={() => audioInput.current?.click()} disabled={recording}>
                  <Music className="mr-2 h-4 w-4" /> Music
                </Button>
                <Button type="button" variant="outline" onClick={() => videoInput.current?.click()} disabled={recording}>
                  <Film className="mr-2 h-4 w-4" /> From a video
                </Button>
              </div>
              <input ref={audioInput} type="file" accept="audio/*" className="sr-only" onChange={(e) => { chooseSound(e.target.files?.[0]); e.target.value = ''; }} />
              <input ref={videoInput} type="file" accept="video/*" className="sr-only" onChange={(e) => { chooseSound(e.target.files?.[0]); e.target.value = ''; }} />
              <p className="truncate text-sm text-muted-foreground">{sound ? `♪ ${sound.name}` : 'No sound chosen — the video will be silent.'}</p>
            </div>

            {sound && sound.duration > SECONDS && (
              <div className="space-y-2">
                <Label>Start the sound at {Math.floor(start / 60)}:{String(Math.floor(start % 60)).padStart(2, '0')}</Label>
                <Slider value={[start]} min={0} max={Math.max(0, Math.floor(sound.duration - 1))} step={1} onValueChange={([v]) => setStart(v)} disabled={recording} />
              </div>
            )}

            <div className="space-y-2">
              <Label>Animation</Label>
              <div className="flex flex-wrap gap-2">
                {STYLES.map((s) => (
                  <Button key={s.value} type="button" size="sm" variant={style === s.value ? 'default' : 'outline'} className={cn('rounded-full')} onClick={() => setStyle(s.value)} disabled={recording}>
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>

            {recording ? (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-center text-sm text-muted-foreground">Recording… {Math.round(((progress ?? 0) / 100) * SECONDS)}s / {SECONDS}s</p>
              </div>
            ) : (
              <Button className="w-full" size="lg" onClick={create}>
                <Clapperboard className="mr-2 h-5 w-5" /> Create video
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
