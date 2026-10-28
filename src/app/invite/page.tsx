'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Coins, Copy, Share2, Store, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { shareLink } from '@/components/share-sheet';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { absoluteUrl } from '@/lib/paths';

type Referrals = { coinsPerShop: number; joined: number; shops: { name: string; rewarded: boolean; joinedAt: string }[]; earned: number };

/** "Bring a shop, get coins": your invite link, and the shops you brought. */
export default function InvitePage() {
  const t = useT();
  const { toast } = useToast();
  const { user, isAuthLoading } = useAuth();
  const [data, setData] = useState<Referrals | null>(null);
  useEffect(() => {
    if (user) api<Referrals>('/me/referrals').then(setData).catch(() => {});
  }, [user]);
  if (isAuthLoading) return null;
  if (!user) return <p className="py-16 text-center text-muted-foreground">{t('Log in to invite people.')}</p>;
  const link = `${absoluteUrl('/register/')}?ref=${user.uid}`;
  const coins = data?.coinsPerShop ?? 500;

  return (
    <div className="mx-auto max-w-xl space-y-4 px-3 py-4 min-[360px]:px-4 md:py-10">
      <div className="rounded-3xl bg-gradient-to-br from-primary to-secondary p-5 text-primary-foreground shadow-lg">
        <p className="flex items-center gap-2 text-sm font-semibold opacity-90"><UserPlus className="h-5 w-5" /> {t('Bring a shop')}</p>
        <p className="mt-1 text-2xl font-extrabold leading-tight">+{coins} {t('coins')} {t('for each shop you bring')}</p>
        <p className="mt-1 text-sm opacity-90">{t('When the shop makes its first sale on Saligue.')}</p>
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <Button variant="secondary" className="h-12 text-base" onClick={() => shareLink({ title: 'Saligue', text: t('Sell your clothes on Saligue: free to start, customers near you, Mobile Money.'), url: link })}>
            <Share2 className="mr-2 h-5 w-5" /> {t('Share invite')}
          </Button>
          <Button variant="secondary" size="icon" className="h-12 w-12" aria-label={t('Copy link')} title={t('Copy link')}
            onClick={() => navigator.clipboard.writeText(link).then(() => toast({ title: t('Link copied') })).catch(() => {})}>
            <Copy className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl border bg-card p-3"><UserPlus className="mx-auto h-5 w-5 text-primary" /><p className="text-xl font-extrabold">{data?.joined ?? 0}</p><p className="text-[11px] text-muted-foreground">{t('Joined')}</p></div>
        <div className="rounded-2xl border bg-card p-3"><Store className="mx-auto h-5 w-5 text-primary" /><p className="text-xl font-extrabold">{data?.shops.length ?? 0}</p><p className="text-[11px] text-muted-foreground">{t('Shops')}</p></div>
        <div className="rounded-2xl border bg-card p-3"><Coins className="mx-auto h-5 w-5 text-amber-500" /><p className="text-xl font-extrabold">{data?.earned ?? 0}</p><p className="text-[11px] text-muted-foreground">{t('Coins earned')}</p></div>
      </div>

      {!!data?.shops.length && (
        <div className="divide-y rounded-2xl border bg-card">
          {data.shops.map((s, i) => (
            <p key={i} className="flex items-center gap-3 p-3 text-sm">
              <Store className="h-5 w-5 text-primary" />
              <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
              {s.rewarded ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label={t('Rewarded')} /> : <Clock className="h-5 w-5 text-amber-600" aria-label={t('Waiting for first sale')} />}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
