'use client';

import { useEffect, useRef, useState } from 'react';
import { Film, Library, Loader2, Music, Pause, Play, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { CLIP_SECONDS, getSound, listSounds, previewClip, readSoundFile, type SharedSound, type SoundSource } from '@/lib/audio';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';

/**
 * The sound chosen for an item: a part of the seller's own music or video (cut on the phone), or a sound already on
 * Saligue (used as it is, by its key).
 */
export type ChosenSound = (SoundSource & { kind?: 'file'; start: number }) | { kind: 'shared'; key: string; name: string; duration: number; by: string };
export const isShared = (s: ChosenSound | null): s is Extract<ChosenSound, { kind: 'shared' }> => s?.kind === 'shared';

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// One preview at a time, in the picker and in the field.
let playing: HTMLAudioElement | null = null;
const stopPlaying = () => {
  playing?.pause();
  playing = null;
};

/** Optional sound for an item: music or the sound of a video from the phone, or a sound others already use. */
export function SoundField({ value, onChange }: { value: ChosenSound | null; onChange: (sound: ChosenSound | null) => void }) {
  const { toast } = useToast();
  const t = useT();
  const [reading, setReading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [picking, setPicking] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const musicInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    stopRef.current?.();
    stopPlaying();
  }, []);

  const choose = async (file?: File) => {
    if (!file) return;
    stopRef.current?.();
    setIsPlaying(false);
    setReading(true);
    try {
      onChange({ ...(await readSoundFile(file)), kind: 'file', start: 0 });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Sound not added', description: friendlyError(error) });
    } finally {
      setReading(false);
    }
  };

  const togglePreview = async () => {
    if (!value) return;
    if (isPlaying) {
      stopRef.current?.();
      return;
    }
    if (isShared(value)) {
      const { data } = await getSound(value.key).catch(() => ({ data: '' }));
      if (!data) return;
      stopPlaying();
      const audio = new Audio(data);
      playing = audio;
      stopRef.current = () => {
        audio.pause();
        setIsPlaying(false);
      };
      audio.onended = () => setIsPlaying(false);
      void audio.play();
      setIsPlaying(true);
      return;
    }
    const stop = previewClip(value.buffer, value.start);
    stopRef.current = () => {
      stop();
      setIsPlaying(false);
    };
    setIsPlaying(true);
    setTimeout(() => stopRef.current?.(), CLIP_SECONDS * 1000);
  };

  return (
    <div className="space-y-3">
      <Label className="text-lg font-medium">{t('Sound (optional)')}</Label>
      <p className="text-sm text-muted-foreground">{t('Add music, the sound of a video, or a sound others use. It plays when people see your item in the feed.')}</p>
      {!value ? (
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
          <Button type="button" variant="outline" onClick={() => setPicking(true)}>
            <Library className="mr-2 h-4 w-4" /> {t('Saligue sounds')}
          </Button>
          <Button type="button" variant="outline" onClick={() => musicInput.current?.click()} disabled={reading}>
            {reading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Music className="mr-2 h-4 w-4" />} {t('My music')}
          </Button>
          <Button type="button" variant="outline" onClick={() => videoInput.current?.click()} disabled={reading}>
            <Film className="mr-2 h-4 w-4" /> {t('From a video')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <Button type="button" size="icon" variant="secondary" onClick={() => void togglePreview()} aria-label={isPlaying ? 'Stop' : 'Play'}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">♪ {value.name}</p>
              <p className="text-xs text-muted-foreground">
                {isShared(value)
                  ? `${t('Original by')} ${value.by} · ${time(value.duration)}`
                  : `Plays ${time(value.start)}–${time(Math.min(value.buffer.duration, value.start + CLIP_SECONDS))}`}
              </p>
            </div>
            <Button type="button" size="icon" variant="ghost" onClick={() => { stopRef.current?.(); onChange(null); }} aria-label="Remove sound">
              <X className="h-4 w-4" />
            </Button>
          </div>
          {!isShared(value) && value.buffer.duration > CLIP_SECONDS && (
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
      <SoundPicker open={picking} onOpenChange={setPicking} onPick={(s) => { onChange({ kind: 'shared', key: s.key, name: s.name, duration: s.duration, by: s.by }); setPicking(false); }} />
    </div>
  );
}

/** Sounds already on Saligue, most used first, each to listen to before using it. */
export function SoundPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (s: SharedSound) => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [list, setList] = useState<SharedSound[] | null>(null);
  const [listening, setListening] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      stopPlaying();
      setListening(null);
      return;
    }
    const timer = setTimeout(() => void listSounds(q).then(setList).catch(() => setList([])), 250);
    return () => clearTimeout(timer);
  }, [open, q]);
  const listen = async (s: SharedSound) => {
    if (listening === s.key) {
      stopPlaying();
      setListening(null);
      return;
    }
    setListening(s.key);
    const { data } = await getSound(s.key).catch(() => ({ data: '' }));
    if (!data) return setListening(null);
    stopPlaying();
    const audio = new Audio(data);
    playing = audio;
    audio.onended = () => setListening(null);
    void audio.play();
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto flex max-h-[85dvh] max-w-lg flex-col rounded-t-3xl">
        <SheetHeader><SheetTitle className="flex items-center gap-2 text-left"><Library className="h-5 w-5 text-primary" /> {t('Saligue sounds')}</SheetTitle></SheetHeader>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search sounds')} />
        </div>
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
          {list === null && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}
          {list?.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t('No sounds yet. Add your own music and others can use it.')}</p>}
          {list?.map((s) => (
            <div key={s.key} className="flex items-center gap-3 rounded-xl border p-2">
              <Button type="button" size="icon" variant="secondary" className="shrink-0 rounded-full" onClick={() => void listen(s)} aria-label={listening === s.key ? 'Stop' : 'Play'}>
                {listening === s.key ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">♪ {s.name}</p>
                <p className="truncate text-xs text-muted-foreground">{s.by} · {s.uses} {s.uses === 1 ? t('item') : t('items')} · {time(s.duration)}</p>
              </div>
              <Button type="button" size="sm" className="shrink-0 rounded-full" onClick={() => { stopPlaying(); onPick(s); }}>{t('Use')}</Button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
