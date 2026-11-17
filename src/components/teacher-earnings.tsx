'use client';

import { useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { formatPrice } from '@/lib/orders';

type Lesson = { lessonId: string; title: string | null; views: number; finished: number; likes: number; thanks: number; points: number; amount: number };
type Month = { period: string; pool: number; totalPoints: number; points: number; views: number; finished: number; likes: number; thanks: number; amount: number; lessons: Lesson[] };
type Data = { share: number; points: { view: number; finished: number; like: number; thanks: number }; thisMonth: Month; lastMonth: Month };

/**
 * Earnings: a teacher's part of the Learning ads pool (server/ads.mjs). Each month the teachers' share of what
 * Learning ads earned is split by how popular each teacher's lessons were — views, lessons watched to the end, likes
 * and thanks from other people — and lands in the Saligue balance when the month closes.
 */
export function TeacherEarnings() {
  const t = useT();
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => void api<Data>('/teacher/earnings').then(setData).catch(() => {}), []);
  if (!data) return null;
  // Nothing taught and nothing earned: the card stays out of a shop's way.
  if (!data.thisMonth.points && !data.lastMonth.points) return null;
  const p = data.points;
  const m = data.thisMonth;
  const share = m.totalPoints ? Math.round((m.points / m.totalPoints) * 1000) / 10 : 0;
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="h-5 w-5 text-amber-600" /> {t('Learning ads')}</CardTitle>
        <CardDescription>
          {Math.round(data.share * 100)}% {t('of Learning ads is shared among teachers each month, by how popular their lessons are.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-xl bg-amber-400/10 p-3"><p className="text-2xl font-bold">{formatPrice(m.amount)}</p><p className="text-xs text-muted-foreground">{t('This month so far')} · {share}% {t('of the pool')}</p></div>
          <div className="rounded-xl bg-muted p-3"><p className="text-2xl font-bold">{formatPrice(data.lastMonth.amount)}</p><p className="text-xs text-muted-foreground">{t('Last month')}</p></div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div><p className="text-lg font-bold">{m.views}</p><p className="text-muted-foreground">{t('views')} ×{p.view}</p></div>
          <div><p className="text-lg font-bold">{m.finished}</p><p className="text-muted-foreground">{t('watched to the end')} ×{p.finished}</p></div>
          <div><p className="text-lg font-bold">{m.likes}</p><p className="text-muted-foreground">{t('likes')} ×{p.like}</p></div>
          <div><p className="text-lg font-bold">{m.thanks}</p><p className="text-muted-foreground">{t('thanks')} ×{p.thanks}</p></div>
        </div>
        {m.lessons.slice(0, 5).map((l) => (
          <div key={l.lessonId} className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate">{l.title ?? t('A removed lesson')}</span>
            <span className="text-xs text-muted-foreground">{l.points} {t('points')}</span>
            <span className="w-16 text-right font-semibold">{formatPrice(l.amount)}</span>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">{t('Added to your balance when the month closes.')}</p>
      </CardContent>
    </Card>
  );
}
