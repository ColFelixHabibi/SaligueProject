'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BadgeCheck, Clock, GraduationCap, Grid3x3, Loader2, Mail, MapPin, MessageCircle, Pencil, Phone, Play, Radio, Settings, Share2, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ExpandableText } from '@/components/expandable-text';
import { useFollow } from '@/components/follow-button';
import { MessageSellerButton } from '@/components/message-seller-button';
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
import { absoluteUrl } from '@/lib/paths';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

type Person = { id: string; name: string; avatar: string | null; isShop: boolean; official: boolean };
type Profile = Person & {
  bio: string;
  shop: { city: string; country: string; hours: string | null; phone: string; whatsapp: string | null; street: string; district: string | null; landmark: string | null; mapUrl: string | null } | null;
  email: string | null;
  clients: number;
  following: number;
  items: number;
  lessons: number;
  sold: number;
  rating: number | null;
  ratingCount: number;
  liveId: string | null;
  isClient: boolean;
  mine: boolean;
};

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/** A shop's or teacher's page: photo, bio, clients, and everything they sell and teach. */
function ProfileView({ id }: { id: string }) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'items' | 'videos' | 'lessons'>('items');
  const [people, setPeople] = useState<{ title: string; list: Person[] | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const { products } = useProductStore();
  const lessons = useLessons({ author: id });
  const follow = useFollow(id);

  const load = () =>
    api<Profile>(`/profiles/${id}`)
      .then((p) => setProfile({ ...p, avatar: mediaUrl(p.avatar ?? undefined) ?? null }))
      .catch((e) => setError(friendlyError(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, follow.following]);

  const items = useMemo(() => products.filter((p) => p.sellerId === id && p.status === 'active'), [products, id]);
  const videos = items.filter((p) => p.video);

  const openList = async (kind: 'clients' | 'following') => {
    setPeople({ title: kind === 'clients' ? 'Clients' : 'Following', list: null });
    try {
      const list = await api<Person[]>(`/profiles/${id}/${kind}`);
      setPeople({ title: kind === 'clients' ? 'Clients' : 'Following', list: list.map((p) => ({ ...p, avatar: mediaUrl(p.avatar ?? undefined) ?? null })) });
    } catch (e) {
      setPeople(null);
      toast({ variant: 'destructive', title: 'Could not load', description: friendlyError(e) });
    }
  };
  const share = async () => {
    const url = absoluteUrl(profileHref(id));
    try {
      if (navigator.share) await navigator.share({ title: profile?.name, text: `${profile?.name} on Saligue`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast({ title: 'Link copied' });
      }
    } catch {
      // Cancelled.
    }
  };

  if (error) return <p className="p-10 text-center text-muted-foreground">{error}</p>;
  if (!profile) return <Skeleton className="mx-auto mt-6 h-[70vh] max-w-2xl rounded-2xl" />;

  const stats = [
    { label: 'Items', value: profile.items, onClick: () => setTab('items') },
    { label: 'Clients', value: profile.clients, onClick: () => openList('clients') },
    { label: 'Following', value: profile.following, onClick: () => openList('following') },
    ...(profile.isShop ? [{ label: 'Sold', value: profile.sold }] : [{ label: 'Lessons', value: profile.lessons, onClick: () => setTab('lessons') }]),
  ];
  const round = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-background transition hover:bg-muted';
  const tabs = [
    { value: 'items', icon: Grid3x3, label: 'Items', count: items.length, show: profile.isShop },
    { value: 'videos', icon: Play, label: 'Videos', count: videos.length, show: profile.isShop },
    { value: 'lessons', icon: GraduationCap, label: 'Lessons', count: lessons?.length ?? 0, show: true },
  ].filter((t) => t.show) as { value: typeof tab; icon: typeof Grid3x3; label: string; count: number }[];
  const current = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <div className="flex items-center gap-5">
        {profile.liveId ? (
          <Link href={`/live/watch?id=${profile.liveId}`} className="relative" aria-label={`${profile.name} is live: watch`}>
            <span className="block rounded-full bg-gradient-to-tr from-primary to-[#e30613] p-[3px]"><SellerAvatar src={profile.avatar} name={profile.name} className="h-24 w-24 ring-4 ring-background" /></span>
            <span className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-md bg-primary px-1.5 text-[10px] font-extrabold text-primary-foreground ring-2 ring-background"><Radio className="h-3 w-3" /> LIVE</span>
          </Link>
        ) : (
          <ProfileAvatar id={profile.id} name={profile.name} src={profile.avatar} size="lg" />
        )}
        <div className="grid flex-1 grid-cols-4 gap-1 text-center">
          {stats.map((s) => (
            <button key={s.label} type="button" onClick={s.onClick} disabled={!s.onClick} className="rounded-xl py-1 transition hover:bg-muted disabled:hover:bg-transparent">
              <p className="text-lg font-extrabold leading-tight">{compact(s.value)}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-1">
        <h1 className="flex items-center gap-1.5 text-xl font-extrabold">
          {profile.name}
          {profile.official && <BadgeCheck className="h-5 w-5 text-primary" />}
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {profile.isShop ? <span className="flex items-center gap-1"><Store className="h-4 w-4" /> Shop</span> : <span className="flex items-center gap-1"><GraduationCap className="h-4 w-4" /> Teacher</span>}
          {profile.shop && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" /> {profile.shop.city}</span>}
          {profile.rating != null && <span className="flex items-center gap-1"><Stars rating={profile.rating} size="h-3.5 w-3.5" /> {profile.rating} ({profile.ratingCount})</span>}
          {profile.shop?.hours && <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {profile.shop.hours}</span>}
        </p>
        {profile.bio ? <ExpandableText text={profile.bio} lines={3} className="pt-1 text-sm" /> : profile.mine && <p className="pt-1 text-sm text-muted-foreground">Add a bio so clients know what you sell or teach.</p>}
      </div>

      <div className="mt-4 flex items-center gap-2">
        {profile.mine ? (
          <>
            <Button className="h-11 flex-1 rounded-full" variant="secondary" onClick={() => setEditing(true)}><Pencil className="mr-2 h-4 w-4" /> Edit bio</Button>
            <Button asChild variant="outline" size="icon" className="h-11 w-11 rounded-full"><Link href={profile.isShop ? '/dashboard/settings' : '/my-account/settings'} aria-label="Settings"><Settings className="h-5 w-5" /></Link></Button>
          </>
        ) : (
          <Button className="h-11 flex-1 rounded-full" variant={follow.following ? 'outline' : 'default'} onClick={follow.toggle} aria-pressed={follow.following}>
            {follow.following ? 'Following' : 'Follow'}
          </Button>
        )}
        {profile.isShop && !profile.mine && (
          <MessageSellerButton product={{ id: '', sellerId: profile.id, name: profile.name, price: 0, image: '', category: '', seller: profile.name, status: 'active' } as unknown as Product}
            label={`Message ${profile.name}`} size="icon" variant="outline" className="h-11 w-11 rounded-full" />
        )}
        {profile.shop?.phone && <a href={`tel:${profile.shop.phone.replace(/\s/g, '')}`} className={round} aria-label="Call" title={profile.shop.phone}><Phone className="h-5 w-5" /></a>}
        {profile.shop && (profile.shop.whatsapp || profile.shop.phone) && (
          <a href={`https://wa.me/${(profile.shop.whatsapp || profile.shop.phone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className={round} aria-label="WhatsApp" title="WhatsApp">
            <MessageCircle className="h-5 w-5 text-[#25D366]" />
          </a>
        )}
        {profile.shop && (
          <a href={profile.shop.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([profile.name, profile.shop.street, profile.shop.district, profile.shop.city, profile.shop.country].filter(Boolean).join(', '))}`}
            target="_blank" rel="noopener noreferrer" className={round} aria-label="Map" title={[profile.shop.street, profile.shop.city].join(', ')}><MapPin className="h-5 w-5" /></a>
        )}
        {profile.email && !profile.mine && <a href={`mailto:${profile.email}`} className={cn(round, 'hidden sm:flex')} aria-label="Email" title={profile.email}><Mail className="h-5 w-5" /></a>}
        <button type="button" onClick={share} className={round} aria-label="Share profile" title="Share"><Share2 className="h-5 w-5" /></button>
      </div>

      <div className="mt-6 flex border-b">
        {tabs.map((t) => (
          <button key={t.value} type="button" onClick={() => setTab(t.value)} aria-pressed={current === t.value} aria-label={t.label} title={t.label}
            className={cn('flex flex-1 items-center justify-center gap-1.5 border-b-2 py-3 text-sm font-semibold', current === t.value ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground')}>
            <t.icon className="h-5 w-5" /> {t.count > 0 && t.count}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {current === 'items' && (items.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{items.map((p) => <ProductCard key={p.id} product={p} variant="shop" />)}</div> : <Empty icon={Grid3x3} text="No items yet" />)}
        {current === 'videos' && (videos.length ? <div className="grid grid-cols-3 gap-1">{videos.map((p) => <PosterTile key={p.id} href={`/product?id=${p.id}`} poster={p.videoPoster ?? p.image} label={p.name} />)}</div> : <Empty icon={Play} text="No videos yet" />)}
        {current === 'lessons' && (lessons === null ? <Skeleton className="h-40" /> : lessons.length ? (
          <div className="grid grid-cols-3 gap-1">
            {lessons.map((l) => {
              const Icon = topicOf(l.topic).icon;
              return <PosterTile key={l.id} href={`/learn?lesson=${l.id}`} poster={l.poster ?? ''} label={l.title} badge={<Icon className="h-3.5 w-3.5" />} />;
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
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
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
  const id = useSearchParams().get('id');
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
