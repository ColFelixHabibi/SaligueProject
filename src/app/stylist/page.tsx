
'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import { PageIntro } from '@/components/layout/page-intro';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import ProductCard from '@/components/product-card';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { noteInterest } from '@/lib/taste';
import { useLang } from '@/lib/i18n';
import { useProductStore, ensureProduct } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// What the server answers (server/stylist.mjs): a reply, up to four real items with one line each, and a question
// that would make the next answer better. "plain" means the items came from the catalogue's own ranking, not the
// AI — the reply still works, the app just never pretends the AI said it.
type Pick = { id: string; why: string };
type Advice = { reply: string; picks: Pick[]; ask?: string; source: 'yours' | 'platform' | 'plain' | 'none' };

// Where a shopper is going, in their words. A person knows the occasion, not the category they want.
const OCCASIONS = ['Church', 'Work', 'Wedding', 'Party', 'School', 'Everyday'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

export default function StylistPage() {
  const { toast } = useToast();
  const lang = useLang();
  const { products } = useProductStore();
  const [message, setMessage] = useState('');
  const [size, setSize] = useState('');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [asked, setAsked] = useState('');
  // The stylist's own question, shown in the empty box so the shopper answers it instead of re-sending it.
  const [hint, setHint] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    const question = message.trim();
    if (question.length < 3 || busy) return;
    setBusy(true);
    try {
      const answer = await api<Advice>('/ai/stylist', {
        method: 'POST',
        body: { message: question, size, maxPrice: budget ? Number(budget) : null, lang },
        // The AI reads the whole catalogue's shortlist before it answers: give it room on a phone connection.
        timeoutMs: 45_000,
      });
      setAdvice(answer);
      setAsked(question);
      setMessage('');
      setHint('');
      // A shop that listed something a minute ago may not be on this phone yet.
      answer.picks.forEach((pick) => void ensureProduct(pick.id));
    } catch (error) {
      toast({ variant: 'destructive', title: 'The stylist could not answer', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  // Opening a piece the stylist chose is the only honest sign the advice was good: it counts as follow-through
  // for INDECIANA, and as interest for this shopper's own recommendations.
  const opened = (id: string) => {
    noteInterest(id, 'view');
    void api('/ai/stylist/feedback', { body: { productId: id } }).catch(() => {});
  };

  const picks = (advice?.picks ?? []).flatMap((pick) => {
    const product = products.find((p) => p.id === pick.id);
    return product ? [{ ...pick, product }] : [];
  });

  return (
    <div className="container mx-auto px-4 pb-6 pt-3 md:py-10">
      <PageIntro icon={Sparkles} title="AI Stylist" subtitle="Say where you are going. Every piece is real, in stock, and from a Saligue shop." className="mb-6" />

      <div className="space-y-4 md:space-y-6">
        <Card>
          <CardContent className="space-y-4 p-4">
            <form onSubmit={ask} className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="occasion" className="text-sm font-semibold">Where are you going?</label>
                <Textarea
                  id="occasion"
                  ref={box}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  maxLength={300}
                  placeholder={hint || 'A wedding in Kigali next month — smart, but not too formal'}
                  className="resize-none"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {OCCASIONS.map((occasion) => (
                  <Button
                    key={occasion}
                    type="button"
                    size="sm"
                    variant={message.toLowerCase().includes(occasion.toLowerCase()) ? 'default' : 'outline'}
                    aria-pressed={message.toLowerCase().includes(occasion.toLowerCase())}
                    onClick={() => setMessage((current) => (current.toLowerCase().includes(occasion.toLowerCase()) ? current : `${occasion} — ${current}`.trim()))}
                  >
                    {occasion}
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <span className="text-sm font-medium text-muted-foreground">Your size</span>
                  <div className="flex flex-wrap gap-1.5">
                    {SIZES.map((option) => (
                      <Button
                        key={option}
                        type="button"
                        size="sm"
                        variant={size === option ? 'default' : 'outline'}
                        aria-pressed={size === option}
                        className="h-8 w-9 px-0"
                        onClick={() => setSize((current) => (current === option ? '' : option))}
                      >
                        {option}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="budget" className="text-sm font-medium text-muted-foreground">Most you would spend ($)</label>
                  <Input id="budget" type="number" inputMode="decimal" min="1" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="40" className="w-28" />
                </div>
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={busy || message.trim().length < 3}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {advice ? 'Ask again' : 'Find my outfit'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {busy && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Choosing from what Saligue sells…
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[4/5] w-full rounded-2xl" />
              ))}
            </div>
          </div>
        )}

        {!busy && advice && (
          <Card className={cn(advice.picks.length === 0 && 'border-dashed')}>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1 space-y-1">
                  {asked && <p className="truncate text-xs text-muted-foreground">“{asked}”</p>}
                  <p className="text-base leading-relaxed">{advice.reply}</p>
                </div>
              </div>

              {picks.length > 0 && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {picks.map(({ id, why, product }) => (
                    <div key={id} onClickCapture={() => opened(id)} className="space-y-1.5">
                      <ProductCard product={product} variant="shop" />
                      {why && <p className="px-1 text-xs leading-snug text-muted-foreground">{why}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* The AI's own next question: tapped, it becomes the next question, so a shopper never has to think
                  of what to say next. */}
              {advice.ask && (
                <button
                  type="button"
                  onClick={() => {
                    // The AI asked the shopper something: keep their occasion and let them answer, never send the
                    // AI its own question back as if the shopper had asked it.
                    setHint(advice.ask ?? '');
                    setMessage(asked ? `${asked} — ` : '');
                    box.current?.focus();
                  }}
                  className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-left text-sm font-medium text-primary transition hover:bg-primary/10"
                >
                  {advice.ask}
                </button>
              )}

              {picks.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
                  <p className="text-xs text-muted-foreground">
                    {advice.source === 'plain'
                      ? 'Chosen from Saligue’s catalogue, best match first.'
                      : 'Every item is real, in stock, and priced by its own shop.'}
                  </p>
                  <Link href={`/mirror?items=${picks.map((p) => p.id).join(',')}`} className="ml-auto flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                    <Wand2 className="h-4 w-4" /> Try them on
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!busy && !advice && (
          <p className="px-1 text-sm text-muted-foreground">
            The stylist chooses only from items Saligue really sells, and keeps to your size and budget. Open a piece to see it on you.
          </p>
        )}
      </div>
    </div>
  );
}
