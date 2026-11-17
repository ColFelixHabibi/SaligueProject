'use client';

import { cn } from '@/lib/utils';
import { useCallback, useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/components/auth/auth-provider';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { formatPrice } from '@/lib/orders';

type Tips = { share: number; total: number; tips: { id: string; from: string; amount: number; message: string; lessonId: string | null; paidAt: string }[] };

/**
 * Tips I received: who sent them and what they wrote. The money itself is in the Saligue balance (Wallet), which is
 * where it is withdrawn — so there is no second Mobile Money number or "waiting to be paid" here.
 */
export function TipsView({ className }: { className?: string }) {
  const t = useT();
  const { user } = useAuth();
  const [data, setData] = useState<Tips | null>(null);
  const load = useCallback(() => api<Tips>('/me/tips').then(setData).catch(() => {}), []);
  useEffect(() => { if (user) void load(); }, [user, load]);
  if (!data) return null;
  return (
    <Card className={cn('rounded-2xl', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Gift className="h-5 w-5 text-primary" /> {t('Tips received')}</CardTitle>
        <CardDescription>{formatPrice(data.total)} · {t('You keep this share of every tip:')} {Math.round(data.share * 100)}%</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {data.tips.length === 0 && <p className="text-sm text-muted-foreground">{t('No tips yet. Teach a lesson — viewers can tip you from it.')}</p>}
        {data.tips.map((tip) => (
          <div key={tip.id} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1"><b>{tip.from}</b>{tip.message && <span className="text-muted-foreground"> · “{tip.message}”</span>}</span>
            <b>{formatPrice(tip.amount)}</b>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
