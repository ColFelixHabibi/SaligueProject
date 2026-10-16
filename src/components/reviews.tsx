'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { BadgeCheck, Loader2, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { StarInput, Stars } from '@/components/stars';
import { useToast } from '@/hooks/use-toast';
import { api, onServerEvent } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import type { Review } from '@/lib/types';

type Data = { reviews: Review[]; mine: Review | null; canReview: boolean };

/** Ratings and reviews of an item. Only buyers whose order was delivered can write one ("Verified purchase"). */
export function Reviews({ productId }: { productId: string }) {
  const { toast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<Data>(`/products/${productId}/reviews`).then(setData).catch(() => setData({ reviews: [], mine: null, canReview: false }));
  }, [productId]);
  useEffect(() => {
    load();
    return onServerEvent('reviews', (d: { productId?: string }) => d?.productId === productId && load());
  }, [productId, load]);

  const startEdit = () => {
    setRating(data?.mine?.rating ?? 0);
    setText(data?.mine?.text ?? '');
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) {
      toast({ variant: 'destructive', title: 'Choose a rating', description: 'Tap 1 to 5 stars.' });
      return;
    }
    setSaving(true);
    try {
      await api(`/products/${productId}/reviews`, { body: { rating, text } });
      setEditing(false);
      toast({ title: 'Thank you for your review!' });
      load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Review not saved', description: friendlyError(error) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api(`/products/${productId}/reviews`, { method: 'DELETE' });
      load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not delete', description: friendlyError(error) });
    }
  };

  if (!data) return null;
  const count = data.reviews.length;
  const average = count ? data.reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
  const bars = [5, 4, 3, 2, 1].map((star) => ({ star, n: data.reviews.filter((r) => r.rating === star).length }));

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-2xl"><Star className="h-6 w-6 fill-amber-400 text-amber-400" /> Customer reviews</CardTitle>
        <CardDescription>Only shoppers who received this item can review it.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-8 md:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-4xl font-extrabold">{count ? average.toFixed(1) : '–'}</span>
            <div>
              <Stars rating={average} size="h-5 w-5" />
              <p className="text-sm text-muted-foreground">{count} {count === 1 ? 'review' : 'reviews'}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            {bars.map(({ star, n }) => (
              <div key={star} className="flex items-center gap-2 text-sm">
                <span className="w-10 shrink-0 text-muted-foreground">{star} star</span>
                <Progress value={count ? (n / count) * 100 : 0} className="h-2.5 [&>div]:bg-amber-400" />
                <span className="w-6 shrink-0 text-right text-muted-foreground">{n}</span>
              </div>
            ))}
          </div>
          {data.canReview && !editing && (
            <Button variant="outline" className="w-full" onClick={startEdit}>{data.mine ? 'Edit your review' : 'Write a review'}</Button>
          )}
        </div>

        <div className="space-y-5">
          {editing && (
            <form onSubmit={save} className="space-y-3 rounded-xl border p-4">
              <p className="font-semibold">How would you rate it?</p>
              <StarInput value={rating} onChange={setRating} />
              <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Fit, fabric, colour, delivery… what should other shoppers know?" className="min-h-24" />
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Post review</Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </form>
          )}
          {count === 0 && !editing && <p className="text-muted-foreground">No reviews yet.</p>}
          {data.reviews.map((r) => (
            <div key={r.id} className="space-y-1 border-b pb-4 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.name}</span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><BadgeCheck className="h-3.5 w-3.5" /> Verified purchase</span>
                <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}</span>
              </div>
              <Stars rating={r.rating} />
              {r.text && <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.text}</p>}
              {data.mine?.id === r.id && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={remove}><Trash2 className="mr-1 h-3.5 w-3.5" /> Delete</Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
