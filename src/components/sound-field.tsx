
'use client';

import { useEffect, useRef, useState } from 'react';
import { Film, Loader2, Music, Pause, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { CLIP_SECONDS, previewClip, readSoundFile, type SoundSource } from '@/lib/audio';
import { friendlyError } from '@/lib/errors';

export type ChosenSound = SoundSource & { start: number };

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Optional sound for an item: music, or the sound of a video from the phone. Plays in the feed. */
export function SoundField({ value, onChange }: { value: ChosenSound | null; onChange: (sound: ChosenSound | null) => void }) {
  const { toast } = useToast();
  const [reading, setReading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const musicInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const choose = async (file?: File) => {
    if (!file) return;
    stopRef.current?.();
    setPlaying(false);
    setReading(true);
    try {
      onChange({ ...(await readSoundFile(file)), start: 0 });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Sound not added', description: friendlyError(error) });
    } finally {
      setReading(false);
    }
  };

  const togglePreview = () => {
    if (!value) return;
    if (playing) {
      stopRef.current?.();
      setPlaying(false);
      return;
    }
    const stop = previewClip(value.buffer, value.start);
    stopRef.current = () => {
      stop();
      setPlaying(false);
    };
    setPlaying(true);
    setTimeout(() => stopRef.current?.(), CLIP_SECONDS * 1000);
  };

  return (
    <div className="space-y-3">
      <Label className="text-lg font-medium">Sound (optional)</Label>
      <p className="text-sm text-muted-foreground">Add music or the sound of a video. It plays when people see your item in the feed.</p>
      {!value ? (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={() => musicInput.current?.click()} disabled={reading}>
            {reading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Music className="mr-2 h-4 w-4" />} Add music
          </Button>
          <Button type="button" variant="outline" onClick={() => videoInput.current?.click()} disabled={reading}>
            <Film className="mr-2 h-4 w-4" /> Sound from a video
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <Button type="button" size="icon" variant="secondary" onClick={togglePreview} aria-label={playing ? 'Stop' : 'Play'}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">♪ {value.name}</p>
              <p className="text-xs text-muted-foreground">
                Plays {time(value.start)}–{time(Math.min(value.buffer.duration, value.start + CLIP_SECONDS))}
              </p>
            </div>
            <Button type="button" size="icon" variant="ghost" onClick={() => { stopRef.current?.(); onChange(null); }} aria-label="Remove sound">
              <X className="h-4 w-4" />
            </Button>
          </div>
          {value.buffer.duration > CLIP_SECONDS && (
            <Slider
              value={[value.start]}
              min={0}
              max={Math.floor(value.buffer.duration - CLIP_SECONDS)}
              step={1}
              onValueChange={([start]) => {
                stopRef.current?.();
                onChange({ ...value, start });
              }}
              aria-label="Where the sound starts"
            />
          )}
        </div>
      )}
      <input ref={musicInput} type="file" accept="audio/*" className="sr-only" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={videoInput} type="file" accept="video/*" className="sr-only" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
