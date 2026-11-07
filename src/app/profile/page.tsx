'use client';

import { shareLink } from '@/components/share-sheet';
import { VerifiedBadge } from '@/components/verified-badge';

import { useFeatures } from '@/lib/features';

import { useT } from '@/lib/i18n';

import { TipButton } from '@/components/tip-button';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Ban, BadgeCheck, Clock, Coins, MoreHorizontal, GraduationCap, Grid3x3, History, Loader2, Mail, MapPin, MessageCircle, Pencil, Phone, Pin, Play, Radio, Repeat2, Settings, Share2, Store, UserCheck, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ExpandableText } from '@/components/expandable-text';
import { AppealButton } from '@/components/appeal-button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { setBlocked, useBlockedIds } from '@/lib/blocks';
import { useFollow } from '@/components/follow-button';
import { startConversation } from '@/lib/messages';
import ProductCard from '@/components/product-card';
import { ProfileAvatar, profileHref } from '@/components/profile-avatar';
import { SellerAvatar } from '@/components/seller-avatar';
import { Stars } from '@/components/stars';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { api, mediaUrl } from '@/lib/api';
import { updateAccount } from '@/lib/auth-actions';
import { friendlyError } from '@/lib/errors';
import { topicOf, useLessons } from '@/lib/lessons';
import { withMedia, type Live } from '@/lib/lives';
import { ComingUp } from '@/components/live/coming-up';
import { absoluteUrl } from '@/lib/paths';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/orders';

import { ProfileHeader, compact, type Person, type Profile } from '@/components/profile-header';

/** A shop's or teacher's page: photo, bio, clients, and everything they sell and teach. */
function ProfileView({ id }: { id: string }) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'items' | 'videos' | 'lessons' | 'replays' | 'resaligued'>('items');
  // Lives the shop recorded: a playlist to watch again.
  const [replays, setReplays] = useState<Live[] | null>(null);
  // Items this person Resaligued (reposted), newest first.
  const [resaligued, setResaligued] = useState<string[] | null>(null);
  useEffect(() => {
    api<string[]>(`/profiles/${id}/resaligues`).then(setResaligued).catch(() => setResaligued([]));
  }, [id]);
  useEffect(() => {
    api<Live[]>(`/profiles/${id}/replays`).then((l) => setReplays(l.map(withMedia))).catch(() => setReplays([]));
  }, [id]);
  const [people, setPeople] = useState<{ title: string; list: Person[] | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const { products } = useProductStore();
  const lessons = useLessons({ author: id });
  const follow = useFollow(id);
  const blockedIds = useBlockedIds();
  const t = useT();
  const on = useFeatures();
  const isBlocked = blockedIds.has(id);

  const load = () =>
    api<Profile>(`/profiles/${id}`)
      .then((p) => setProfile({ ...p, avatar: mediaUrl(p.avatar ?? undefined) ?? null }))
      .catch((e) => setError(friendlyError(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, follow.following]);

  // Pinned items first (newest pin first), then the rest as listed.
  const items = useMemo(() => products.filter((p) => p.sellerId === id && p.status === 'active')
    .sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '')), [products, id]);
  const reposted = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return (resaligued ?? []).map((pid) => byId.get(pid)).filter((p): p is Product => !!p && p.status === 'active');
  }, [products, resaligued]);
  const videos = items.filter((p) => p.video);

  const openList = async (kind: 'clients' | 'following') => {
    setPeople({ title: kind === 'clients' ? 'Clients' : 'Network', list: null });
    try {
      const list = await api<Person[]>(`/profiles/${id}/${kind}`);
      setPeople({ title: kind === 'clients' ? 'Clients' : 'Network', list: list.map((p) => ({ ...p, avatar: mediaUrl(p.avatar ?? undefined) ?? null })) });
    } catch (e) {
      setPeople(null);
      toast({ variant: 'destructive', title: 'Could not load', description: friendlyError(e) });
    }
  };
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const message = async () => {
    setOpening(true);
    try {
      router.push(`/messages?c=${await startConversation({ userId: id })}`);
    } catch (e) {
      toast({ variant: 'destructive', title: t('Not done'), description: friendlyError(e) });
    } finally {
      setOpening(false);
    }
  };
  const share = async () => {
    await shareLink({ title: profile?.name ?? 'Saligue', text: `${profile?.name} on Saligue`, url: absoluteUrl(profileHref(id)) });
  };

  if (error) return <p className="p-10 text-center text-muted-foreground">{error}</p>;
  if (!profile) return <Skeleton className="mx-auto mt-6 h-[70vh] max-w-2xl rounded-2xl" />;

  const round = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-background transition hover:bg-muted';
  const tabs = [
    { value: 'items', icon: Grid3x3, label: 'Items', count: items.length, show: profile.isShop },
    { value: 'videos', icon: Play, label: 'Videos', count: videos.length, show: profile.isShop },
    { value: 'lessons', icon: GraduationCap, label: 'Lessons', count: lessons?.length ?? 0, show: true },
    { value: 'replays', icon: History, label: 'Replays', count: replays?.length ?? 0, show: profile.isShop && !!replays?.length },
    { value: 'resaligued', icon: Repeat2, label: 'Resaligued', count: reposted.length, show: reposted.length > 0 },
  ].filter((t) => t.show) as { value: typeof tab; icon: typeof Grid3x3; label: string; count: number }[];
  const current = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <ProfileHeader profile={profile} onStat={(k) => (k === 'items' ? setTab('items') : k === 'clients' || k === 'following' ? void openList(k) : undefined)}>
        {profile.mine ? (
          <>
            <Button size="icon" className="h-10 w-10 shrink-0 rounded-full" variant="secondary" onClick={() => setEditing(true)} aria-label={t('Edit bio')} title={t('Edit bio')}><Pencil className="h-4 w-4" /></Button>
            <Button asChild variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-full"><Link href={profile.isShop ? '/dashboard/settings' : '/my-account/settings'} aria-label="Settings"><Settings className="h-5 w-5" /></Link></Button>
          </>
        ) : (
          <Button size="icon" className="h-10 w-10 shrink-0 rounded-full" variant={follow.following ? 'outline' : 'default'} onClick={follow.toggle} aria-pressed={follow.following} aria-label={follow.following ? t('In your network') : t('Follow')} title={follow.following ? t('In your network') : t('Follow')}>
            {follow.following ? <UserCheck className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
          </Button>
        )}
        {/* Message: shops, and anyone in your Clients or Network (photos, videos, voice notes too). */}
        {profile.canMessage && on('messages') && (
          <Button size="icon" variant="secondary" className="h-10 w-10 shrink-0 rounded-full" disabled={opening} onClick={() => void message()} aria-label={t('Message')} title={t('Message')}>
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-5 w-5" />}
          </Button>
        )}
        {profile.shop && (profile.shop.whatsapp || profile.shop.phone) && (
          <a href={`https://wa.me/${(profile.shop.whatsapp || profile.shop.phone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className={round} aria-label="WhatsApp" title="WhatsApp">
            <MessageCircle className="h-5 w-5 text-[#25D366]" />
          </a>
        )}
        {!profile.mine && on('tips') && <TipButton toUserId={profile.id} toName={profile.name} className={round}><Coins className="h-5 w-5 text-amber-500" /></TipButton>}
        {profile.mine && <button type="button" onClick={share} className={round} aria-label="Share profile" title="Share"><Share2 className="h-5 w-5" /></button>}
        {!profile.mine && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={round} aria-label="More"><MoreHorizontal className="h-5 w-5" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* The shop's other ways to reach it, so the row of buttons fits small phones. */}
              {profile.shop?.phone && <DropdownMenuItem asChild><a href={`tel:${profile.shop.phone.replace(/\s/g, '')}`}><Phone className="mr-2 h-4 w-4" /> {profile.shop.phone}</a></DropdownMenuItem>}
              {profile.shop && (
                <DropdownMenuItem asChild>
                  <a href={profile.shop.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([profile.name, profile.shop.street, profile.shop.district, profile.shop.city, profile.shop.country].filter(Boolean).join(', '))}`} target="_blank" rel="noopener noreferrer">
                    <MapPin className="mr-2 h-4 w-4" /> {[profile.shop.street, profile.shop.city].filter(Boolean).join(', ')}
                  </a>
                </DropdownMenuItem>
              )}
              {profile.email && <DropdownMenuItem asChild><a href={`mailto:${profile.email}`}><Mail className="mr-2 h-4 w-4" /> {t('Email')}</a></DropdownMenuItem>}
              <DropdownMenuItem onClick={share}><Share2 className="mr-2 h-4 w-4" /> {t('Share')}</DropdownMenuItem>
              <DropdownMenuItem className={isBlocked ? '' : 'text-destructive'} onClick={() => setBlocked(id, !isBlocked).then(() => toast({ title: isBlocked ? `${profile.name} unblocked` : `${profile.name} blocked`, description: isBlocked ? undefined : 'You won’t see their items, lessons or comments.' })).catch((e) => toast({ variant: 'destructive', title: 'Not done', description: friendlyError(e) }))}>
                <Ban className="mr-2 h-4 w-4" /> {isBlocked ? t('Unblock') : t('Block')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </ProfileHeader>
      {isBlocked && <p className="mt-3 rounded-xl bg-muted p-3 text-sm text-muted-foreground">You blocked this account. Unblock it from ⋯ or Settings.</p>}

      {profile.isShop && !isBlocked && <ComingUp seller={profile.id} className="mt-5" />}

      <div className="mt-6 flex border-b">
        {tabs.map((t) => (
          <button key={t.value} type="button" onClick={() => setTab(t.value)} aria-pressed={current === t.value} aria-label={t.label} title={t.label}
            className={cn('flex flex-1 items-center justify-center gap-1.5 border-b-2 py-3 text-sm font-semibold', current === t.value ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground')}>
            <t.icon className="h-5 w-5" /> {t.count > 0 && t.count}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {current === 'items' && (items.length ? <div className="grid grid-cols-3 gap-0.5">{items.map((p) => <ItemTile key={p.id} product={p} />)}</div> : <Empty icon={Grid3x3} text="No items yet" />)}
        {current === 'resaligued' && <div className="grid grid-cols-3 gap-0.5">{reposted.map((p) => <ItemTile key={p.id} product={p} />)}</div>}
        {current === 'videos' && (videos.length ? <div className="grid grid-cols-3 gap-1">{videos.map((p) => <PosterTile key={p.id} href={`/product?id=${p.id}`} poster={p.videoPoster ?? p.image} label={p.name} />)}</div> : <Empty icon={Play} text="No videos yet" />)}
        {current === 'replays' && (
          <div className="grid grid-cols-3 gap-1">
            {(replays ?? []).map((l) => <PosterTile key={l.id} href={`/live/watch?id=${l.id}`} poster={l.replay?.poster ?? l.thumbnail ?? ''} label={l.title} />)}
          </div>
        )}
        {current === 'lessons' && (lessons === null ? <Skeleton className="h-40" /> : lessons.length ? (
          <div className="grid grid-cols-3 gap-1">
            {lessons.map((l) => {
              const Icon = topicOf(l.topic).icon;
              return (
                <div key={l.id}>
                  <PosterTile href={`/learn?lesson=${l.id}`} poster={l.poster ?? ''} label={l.hidden ? `Hidden after reports · ${l.title}` : l.title} badge={<Icon className="h-3.5 w-3.5" />} />
                  {l.hidden && <div className="mt-1"><AppealButton kind="lesson" targetId={l.id} title={l.title} /></div>}
                </div>
              );
            })}
          </div>
        ) : <Empty icon={GraduationCap} text={profile.mine ? 'Teach your first lesson' : 'No lessons yet'} href={profile.mine ? '/learn/new' : undefined} />)}
      </div>

      <Sheet open={!!people} onOpenChange={(v) => !v && setPeople(null)}>
        <SheetContent side="bottom" className="max-h-[75vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader><SheetTitle>{people?.title}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-1">
            {people?.list === null && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}
            {people?.list?.map((p) => (
              <Link key={p.id} href={p.isShop ? profileHref(p.id) : '#'} onClick={() => setPeople(null)} className={cn('flex items-center gap-3 rounded-xl p-2 hover:bg-muted', !p.isShop && 'pointer-events-none')}>
                <SellerAvatar src={p.avatar} name={p.name} className="h-10 w-10" />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}{p.verified && <VerifiedBadge className="ml-1" />}</span>
                {p.isShop && <Store className="h-4 w-4 text-muted-foreground" />}
              </Link>
            ))}
            {people?.list?.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No one yet.</p>}
          </div>
        </SheetContent>
      </Sheet>

      <BioDialog open={editing} onOpenChange={setEditing} profile={profile} onSaved={() => void load()} />
    </div>
  );
}

/** An item in the profile grid (like an Instagram shop): the photo, its price, and a mark for a video or sold out. */
function ItemTile({ product }: { product: Product }) {
  return (
    <Link href={`/product?id=${product.id}`} className="relative block aspect-[3/4] overflow-hidden bg-muted" title={product.name}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={product.videoPoster ?? product.image} alt={product.name} loading="lazy" className={cn('h-full w-full', product.photoType === 'worn' || product.videoPoster ? 'object-cover' : 'object-contain p-3')} />
      {product.pinnedAt && <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground"><Pin className="h-3 w-3" /> Pinned</span>}
      {product.video && <Play className="absolute right-1.5 top-1.5 h-4 w-4 fill-white text-white drop-shadow" />}
      {product.stock === 0 && <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs font-bold text-white">Sold out</span>}
      <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-white">{formatPrice(Number(product.price))}</span>
    </Link>
  );
}

function PosterTile({ href, poster, label, badge }: { href: string; poster: string; label: string; badge?: React.ReactNode }) {
  return (
    <Link href={href} className="relative block aspect-[9/16] overflow-hidden rounded-md bg-muted" title={label}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {poster && <img src={poster} alt={label} className="h-full w-full object-cover" />}
      <Play className="absolute left-1.5 top-1.5 h-4 w-4 fill-white text-white drop-shadow" />
      {badge && <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-1 text-white">{badge}</span>}
      <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/70 to-transparent p-1.5 pt-6 text-[11px] font-semibold text-white">{label}</span>
    </Link>
  );
}

function Empty({ icon: Icon, text, href }: { icon: typeof Play; text: string; href?: string }) {
  const body = <><Icon className="h-10 w-10" /><span className="text-sm font-medium">{text}</span></>;
  return href ? <Link href={href} className="flex flex-col items-center gap-2 py-12 text-primary">{body}</Link> : <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">{body}</div>;
}

/** Edit the bio: a shop's bio is its shop description; anyone else's is their own. */
function BioDialog({ open, onOpenChange, profile, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; profile: Profile; onSaved: () => void }) {
  const { toast } = useToast();
  const [bio, setBio] = useState(profile.bio);
  const [saving, setSaving] = useState(false);
  useEffect(() => setBio(profile.bio), [profile.bio, open]);
  const save = async () => {
    setSaving(true);
    try {
      if (profile.isShop) {
        const me = await api<{ user: { shop: Record<string, string> | null } }>('/auth/me');
        await updateAccount({ shop: { ...(me.user.shop ?? {}), bio } as never });
      } else await updateAccount({ bio });
      toast({ title: 'Bio saved' });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Not saved', description: friendlyError(e) });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-md">
        <DialogHeader><DialogTitle>{profile.isShop ? 'Shop description' : 'Bio'}</DialogTitle></DialogHeader>
        <Textarea rows={5} maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} placeholder={profile.isShop ? 'What you sell, your style, delivery…' : 'What you teach and your fashion story…'} />
        <p className="text-right text-xs text-muted-foreground">{bio.length}/300</p>
        <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save</Button>
      </DialogContent>
    </Dialog>
  );
}

function ProfilePage() {
  const params = useSearchParams();
  const username = params.get('u');
  // From an @mention (?u=username): find whose username it is.
  const [found, setFound] = useState<string | null | 'missing'>(null);
  useEffect(() => {
    if (username) api<{ id: string }>(`/usernames/${encodeURIComponent(username)}`).then((r) => setFound(r.id)).catch(() => setFound('missing'));
  }, [username]);
  const id = params.get('id') ?? (found !== 'missing' ? found : null);
  if (username && found === null && !params.get('id')) return <Skeleton className="mx-auto mt-6 h-[70vh] max-w-2xl rounded-2xl" />;
  if (!id) return <p className="p-10 text-center text-muted-foreground">This profile does not exist.</p>;
  return <ProfileView id={id} />;
}

export default function ProfileRoute() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto mt-6 h-[70vh] max-w-2xl rounded-2xl" />}>
      <ProfilePage />
    </Suspense>
  );
}
