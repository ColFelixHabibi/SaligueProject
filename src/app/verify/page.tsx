'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Camera, CheckCircle2, Clock, CreditCard, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { VerifiedBadge } from '@/components/verified-badge';
import { useAuth } from '@/components/auth/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

type Status = {
  verified: boolean;
  identityChecked?: boolean;
  verifiedUntil?: string | null;
  renewal?: { id: string; reference: string; amount: number } | null;
  verifiedType: string | null;
  price: number;
  onlinePayment: boolean;
  momoNumber: string | null;
  momoName: string;
  request: { id: string; type: string; status: 'pending_payment' | 'in_review' | 'approved' | 'rejected' | 'cancelled'; amount: number; reference: string; note: string | null } | null;
};

const TYPES = [
  { value: 'id', label: 'ID card', icon: ShieldCheck },
  { value: 'passport', label: 'Passport', icon: ShieldCheck },
  { value: 'business', label: 'Business / shop', icon: Building2 },
] as const;
const PHOTOS: Record<string, { key: string; label: string }[]> = {
  id: [{ key: 'front', label: 'Front of the ID card' }, { key: 'back', label: 'Back of the ID card' }, { key: 'selfie', label: 'You holding the ID card next to your face' }],
  passport: [{ key: 'front', label: 'Passport photo page' }, { key: 'selfie', label: 'You holding the passport next to your face' }],
  business: [{ key: 'certificate', label: 'Business registration certificate (e.g. RDB)' }, { key: 'front', label: 'Owner’s ID card or passport' }, { key: 'selfie', label: 'Owner holding the ID next to their face' }],
};

/** Shrinks a photo on the phone (sharp enough to read, small enough to send). */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This file is not a photo we can read. Try a JPG or PNG.'));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Get the verification badge: an ID card, passport or business registration checked by Saligue. */
export default function VerifyPage() {
  const { toast } = useToast();
  const { user, isAuthLoading } = useAuth();
  const [s, setS] = useState<Status | null>(null);
  const [type, setType] = useState<'id' | 'passport' | 'business'>('id');
  const [form, setForm] = useState({ legalName: '', docNumber: '', country: 'Rwanda', businessName: '' });
  const [files, setFiles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<{ reference: string; amount: number; momoNumber: string | null; momoName: string } | null>(null);
  const load = useCallback(() => api<Status>('/verification').then(setS).catch(() => {}), []);
  useEffect(() => { if (user) void load(); }, [user, load]);

  if (!isAuthLoading && !user) return <p className="p-10 text-center text-muted-foreground">Log in to get verified. <Link href="/login" className="text-primary underline">Log in</Link></p>;
  if (!s) return <Skeleton className="mx-auto mt-6 h-96 max-w-xl rounded-2xl" />;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (PHOTOS[type].some((p) => !files[p.key])) return toast({ variant: 'destructive', title: 'Add every photo' });
    setBusy(true);
    try {
      const r = await api<{ status: string; link?: string; manual?: boolean; reference: string; amount: number; momoNumber: string | null; momoName: string }>('/verification', { body: { type, ...form, files } });
      if (r.link) window.location.href = r.link;
      else if (r.manual) setManual(r);
      else toast({ title: 'Sent for review' });
      await load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not sent', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  const renew = async () => {
    setBusy(true);
    try {
      const r = await api<{ link?: string; manual?: boolean; reference: string; amount: number; momoNumber: string | null; momoName: string }>('/verification/renew', { body: {} });
      if (r.link) window.location.href = r.link;
      else setManual(r);
      await load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };
  const req = s.request;
  return (
    <div className="mx-auto max-w-xl space-y-5 p-4 pb-24 md:p-8">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold"><VerifiedBadge className="h-7 w-7" /> Get verified</h1>
      <p className="text-muted-foreground">Optional: you can sell, go live, teach and earn without it. The blue check shows buyers and clients that Saligue checked who you are, for more trust. It costs <b className="text-foreground">{formatPrice(s.price)} per month</b>. Your documents are checked once; renew each month to keep the ✓.</p>

      {(s.renewal || manual?.reference.startsWith('VRN')) ? (
        <div className="space-y-3 rounded-2xl border p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold"><CreditCard className="h-5 w-5 text-primary" /> Pay to renew for 30 days</p>
          <p>Send <b>{formatPrice(manual?.amount ?? s.renewal!.amount)}</b> by Mobile Money to <b>{manual?.momoNumber ?? s.momoNumber ?? 'Saligue'}</b> ({manual?.momoName ?? s.momoName}) with this reference:</p>
          <p className="select-all rounded-xl bg-muted p-3 text-center text-xl font-extrabold tracking-widest">{manual?.reference ?? s.renewal!.reference}</p>
        </div>
      ) : s.identityChecked ? (
        <div className={cn('space-y-3 rounded-2xl p-4', s.verified ? 'bg-sky-50 text-sky-900' : 'bg-amber-50 text-amber-900')}>
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-6 w-6" /> {s.verified ? `Verified until ${s.verifiedUntil ? new Date(s.verifiedUntil).toLocaleDateString() : ''}` : 'Your badge has ended. Your documents are still checked.'}</p>
          <Button onClick={renew} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {s.verified ? 'Renew now' : 'Renew'} · {formatPrice(s.price)} for 30 days</Button>
        </div>
      ) : req?.status === 'in_review' ? (
        <div className="flex items-center gap-3 rounded-2xl bg-amber-50 p-4 text-amber-900"><Clock className="h-6 w-6 shrink-0" /> Saligue is checking your documents. You’ll get a notification.</div>
      ) : (manual || req?.status === 'pending_payment') ? (
        <div className="space-y-3 rounded-2xl border p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold"><CreditCard className="h-5 w-5 text-primary" /> Pay to send your request</p>
          <p>Send <b>{formatPrice(manual?.amount ?? req!.amount)}</b> by Mobile Money to <b>{manual?.momoNumber ?? s.momoNumber ?? 'Saligue'}</b> ({manual?.momoName ?? s.momoName}) with this reference:</p>
          <p className="select-all rounded-xl bg-muted p-3 text-center text-xl font-extrabold tracking-widest">{manual?.reference ?? req!.reference}</p>
          <p className="text-muted-foreground">Saligue confirms the payment, then checks your documents.</p>
        </div>
      ) : null}

      {!s.identityChecked && req?.status !== 'in_review' && !(manual || req?.status === 'pending_payment') && (
        <form onSubmit={send} className="space-y-5">
          {req?.status === 'rejected' && <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">Last request not approved{req.note ? `: ${req.note}` : '.'} Send new photos — no new payment within 30 days.</p>}
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map((t) => (
              <button key={t.value} type="button" onClick={() => setType(t.value)} aria-pressed={type === t.value}
                className={cn('flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-semibold', type === t.value ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>
                <t.icon className="h-6 w-6" /> {t.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {type === 'business' && <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="v-biz">Registered business name</Label><Input id="v-biz" required value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} /></div>}
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="v-name">{type === 'business' ? 'Owner’s full name' : 'Full name'} (as on the document)</Label><Input id="v-name" required value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="v-num">{type === 'business' ? 'Registration number' : 'Document number'}</Label><Input id="v-num" required value={form.docNumber} onChange={(e) => setForm({ ...form, docNumber: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="v-country">Country</Label><Input id="v-country" required value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
          </div>
          <div className="space-y-2">
            {PHOTOS[type].map((p) => (
              <label key={p.key} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm', files[p.key] && 'border-emerald-500 bg-emerald-50')}>
                {files[p.key] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={files[p.key]} alt="" className="h-12 w-16 rounded object-cover" />
                ) : <Camera className="h-6 w-6 text-primary" />}
                <span className="flex-1">{p.label}</span>
                <input type="file" accept="image/*" className="sr-only" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try { setFiles((x) => ({ ...x, [p.key]: '' })); const data = await shrink(f); setFiles((x) => ({ ...x, [p.key]: data })); } catch (error) { toast({ variant: 'destructive', title: 'Photo not added', description: friendlyError(error) }); }
                }} />
              </label>
            ))}
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground"><Lock className="mt-0.5 h-4 w-4 shrink-0" /> Only Saligue admins see your documents. They are deleted as soon as the check is done; Saligue keeps only the result and the last 4 characters of the number. <Link href="/verification-policy" className="text-primary underline">Verification Policy</Link></p>
          <Button type="submit" className="h-12 w-full" disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send and pay {formatPrice(s.price)} (first month)</Button>
        </form>
      )}
    </div>
  );
}
