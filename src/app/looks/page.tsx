'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { GraduationCap, Layers, Loader2, Pencil, Play, Plus, Share2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/components/auth/auth-provider';
import { ask } from '@/components/confirm-dialog';
import { shareLink } from '@/components/share-sheet';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { getLesson, type Lesson } from '@/lib/lessons';
import { productHref } from '@/lib/links';
import { createLook, deleteLook, getLook, renameLook, togglePiece, useMyLooks, type Look } from '@/lib/looks';
import { formatPrice } from '@/lib/orders';
import { absoluteUrl } from '@/lib/paths';

function Cover({ look }: { look: Look }) {
  return (
    <span className="grid aspect-square grid-cols-2 gap-0.5 overflow-hidden rounded-2xl bg-muted">
      {look.covers.length === 0 && <Layers className="col-span-2 row-span-2 m-auto h-10 w-10 text-muted-foreground" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {look.covers.slice(0, 4).map((c, i) => <img key={i} src={c} alt="" className="h-full w-full bg-white object-cover" />)}
    </span>
  );
}

/** All my looks as a grid of boards. */
function MyLooks() {
  const t = useT();
  const { toast } = useToast();
  const looks = useMyLooks();
  const [name, setName] = useState('');
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-3 py-4 min-[360px]:px-4 md:py-8">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Layers className="h-6 w-6 text-primary" /> {t('My looks')}</h1>
      <form className="flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) createLook(name.trim()).then(() => setName('')).catch((error) => toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) }));
      }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('New look, e.g. Wedding')} className="h-11" />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={!name.trim()} aria-label={t('Create look')}><Plus className="h-5 w-5" /></Button>
      </form>
      {looks === null ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /> : looks.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('Save items and lessons into looks: tap')} <Layers className="inline h-4 w-4" /></p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {looks.map((l) => (
            <Link key={l.id} href={`/looks?id=${l.id}`} className="space-y-1.5">
              <Cover look={l} />
              <p className="truncate font-semibold">{l.name}</p>
              <p className="-mt-1 text-xs text-muted-foreground">{l.count}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** One look (anyone with the link can see it; the owner can rename, remove pieces and delete it). */
function OneLook({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const { toast } = useToast();
  const { authUid } = useAuth();
  const { products } = useProductStore();
  const [look, setLook] = useState<Look | null | 'missing'>(null);
  const [lessons, setLessons] = useState<Record<string, Lesson>>({});
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    getLook(id).then(setLook).catch(() => setLook('missing'));
  }, [id]);
  useEffect(() => {
    if (!look || look === 'missing') return;
    for (const p of look.items.filter((i) => i.kind === 'lesson' && !lessons[i.id])) {
      getLesson(p.id).then((l) => setLessons((all) => ({ ...all, [l.id]: l }))).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look]);
  if (look === null) return <Loader2 className="mx-auto mt-16 h-8 w-8 animate-spin text-primary" />;
  if (look === 'missing') return <p className="py-16 text-center text-muted-foreground">{t('This look no longer exists.')}</p>;
  const mine = look.ownerId === authUid;
  const items = look.items.filter((i) => i.kind === 'product').map((i) => products.find((p) => p.id === i.id)).filter((p) => !!p);
  const taught = look.items.filter((i) => i.kind === 'lesson').map((i) => lessons[i.id]).filter(Boolean);
  const total = items.reduce((sum, p) => sum + Number(p.price), 0);
  const fail = (error: unknown) => toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
  const remove = (kind: 'product' | 'lesson', pieceId: string) => togglePiece(look.id, { kind, id: pieceId }).then(() => getLook(id).then(setLook)).catch(fail);
  const round = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-background hover:bg-muted';
  const x = 'absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white';

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-3 py-4 min-[360px]:px-4 md:py-8">
      <div className="flex items-start gap-2">
        {editing !== null ? (
          <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); renameLook(look.id, editing).then((l) => { setLook(l); setEditing(null); }).catch(fail); }}>
            <Input autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} maxLength={40} className="h-10" />
            <button type="button" className={round} onClick={() => setEditing(null)} aria-label="Close"><X className="h-5 w-5" /></button>
          </form>
        ) : (
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-extrabold">{look.name}</h1>
            <p className="text-sm text-muted-foreground">{look.ownerName} · {look.count}{total > 0 && ` · ${formatPrice(total)}`}</p>
          </div>
        )}
        {mine && editing === null && <button type="button" className={round} onClick={() => setEditing(look.name)} aria-label={t('Rename')} title={t('Rename')}><Pencil className="h-4 w-4" /></button>}
        <button type="button" className={round} aria-label={t('Share')} title={t('Share')} onClick={() => shareLink({ title: look.name, text: `${look.name} · a look on Saligue`, url: absoluteUrl(`/looks?id=${look.id}`) })}><Share2 className="h-4 w-4" /></button>
        {mine && (
          <button type="button" className={`${round} text-destructive`} aria-label={t('Delete')} title={t('Delete')}
            onClick={async () => { if (await ask({ title: `${t('Delete')} “${look.name}”?`, confirm: 'Delete', destructive: true })) deleteLook(look.id).then(() => router.push('/looks')).catch(fail); }}>
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((p) => (
            <div key={p.id} className="relative">
              <Link href={productHref(p)} className="block overflow-hidden rounded-2xl border bg-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.cutout || p.image} alt={p.name} className="aspect-square w-full bg-muted object-contain" />
                <p className="truncate px-2 pt-1.5 text-sm font-medium">{p.name}</p>
                <p className="px-2 pb-2 text-sm font-bold text-primary">{formatPrice(Number(p.price))}</p>
              </Link>
              {mine && <button type="button" className={x} onClick={() => remove('product', p.id)} aria-label={t('Remove')}><X className="h-4 w-4" /></button>}
            </div>
          ))}
        </div>
      )}
      {taught.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 font-semibold"><GraduationCap className="h-5 w-5 text-primary" /> {t('Lessons')}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {taught.map((l) => (
              <div key={l.id} className="relative">
                <Link href={`/learn?lesson=${l.id}`} className="relative block aspect-[9/16] overflow-hidden rounded-xl bg-black text-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {l.poster && <img src={l.poster} alt="" className="h-full w-full object-cover opacity-90" />}
                  <Play className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 fill-white" />
                  <p className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/80 p-1.5 text-xs font-semibold">{l.title}</p>
                </Link>
                {mine && <button type="button" className={x} onClick={() => remove('lesson', l.id)} aria-label={t('Remove')}><X className="h-4 w-4" /></button>}
              </div>
            ))}
          </div>
        </div>
      )}
      {look.count === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{t('Nothing here yet. Tap')} <Layers className="inline h-4 w-4" /> {t('on an item or lesson.')}</p>}
    </div>
  );
}

function LooksFromQuery() {
  const id = useSearchParams().get('id');
  const { user, isAuthLoading } = useAuth();
  const t = useT();
  if (id) return <OneLook id={id} />;
  if (isAuthLoading) return null;
  if (!user) return <p className="py-16 text-center text-muted-foreground">{t('Log in to make looks')}</p>;
  return <MyLooks />;
}

export default function LooksPage() {
  return (
    <Suspense>
      <LooksFromQuery />
    </Suspense>
  );
}
