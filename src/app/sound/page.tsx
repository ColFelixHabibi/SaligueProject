'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Music2, Pause, Play, Plus } from 'lucide-react';
import ProductCard from '@/components/product-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ensureProduct, useProductStore } from '@/hooks/use-product-store';
import { getSound, type SharedSound } from '@/lib/audio';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';

/** One sound and every item that uses it, with "Use this sound" to put it on an item of your own. */
function SoundView({ soundKey }: { soundKey: string }) {
  const t = useT();
  const [sound, setSound] = useState<(SharedSound & { data: string; items: string[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const products = useProductStore((s) => s.products);

  useEffect(() => {
    getSound(soundKey)
      .then(async (s) => {
        // Items not loaded yet (a shared link) are fetched, a few at a time.
        await Promise.all(s.items.slice(0, 40).map((id) => ensureProduct(id)));
        setSound(s);
      })
      .catch((e) => setError(friendlyError(e)));
    return () => audio.current?.pause();
  }, [soundKey]);

  const items = useMemo(() => (sound ? sound.items.flatMap((id) => products.filter((p) => p.id === id)) : []), [sound, products]);
  const toggle = () => {
    if (!sound) return;
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    audio.current ??= new Audio(sound.data);
    audio.current.loop = true;
    void audio.current.play();
    setPlaying(true);
  };

  if (error) return <p className="p-10 text-center text-muted-foreground">{error}</p>;
  if (!sound) return <Skeleton className="m-4 h-64 rounded-2xl" />;
  return (
    <div className="container mx-auto space-y-5 px-3 py-4 min-[360px]:px-4 md:py-8">
      <div className="flex items-center gap-4">
        <button type="button" onClick={toggle} aria-label={playing ? 'Stop' : 'Play'}
          className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg">
          <Music2 className="h-9 w-9 opacity-40" />
          <span className="absolute inset-0 flex items-center justify-center">{playing ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8 fill-current" />}</span>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold">♪ {sound.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t('Original by')} {sound.byId ? <Link href={`/profile?id=${sound.byId}`} className="font-semibold text-foreground hover:underline">{sound.by}</Link> : sound.by}
          </p>
          <p className="text-sm text-muted-foreground">{sound.uses} {sound.uses === 1 ? t('item') : t('items')}</p>
        </div>
      </div>
      <Button asChild size="lg" className="h-12 w-full rounded-full sm:w-auto">
        <Link href={`/sell?sound=${encodeURIComponent(sound.key)}`}><Plus className="mr-2 h-5 w-5" /> {t('Use this sound')}</Link>
      </Button>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{items.map((p) => <ProductCard key={p.id} product={p} />)}</div>
    </div>
  );
}

function SoundFromQuery() {
  const key = useSearchParams().get('k') ?? '';
  return key ? <SoundView soundKey={key} /> : null;
}

export default function SoundPage() {
  return (
    <Suspense>
      <SoundFromQuery />
    </Suspense>
  );
}
