'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';

const RIGHTS = [
  { value: 'copyright', label: 'A photo, design or video I made' },
  { value: 'trademark', label: 'My brand name or logo' },
  { value: 'privacy', label: 'A photo of me (or of someone I speak for)' },
  { value: 'other', label: 'Something else that is mine' },
];

type Sent = { reference: string; hidden: boolean; item: string | null };

/**
 * The notice form behind /takedown. Anyone can send one, signed in or not, because the person whose photo
 * or brand was used often has no Saligue account. A notice that names one of our items and carries both
 * confirmations hides that item at once, while INDECIANA reviews it (see the Notice and Takedown Policy).
 */
export function TakedownForm() {
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [target, setTarget] = React.useState('');
  const [rights, setRights] = React.useState('copyright');
  const [details, setDetails] = React.useState('');
  const [goodFaith, setGoodFaith] = React.useState(false);
  const [accuracy, setAccuracy] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [sent, setSent] = React.useState<Sent | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !target.trim() || details.trim().length < 20) {
      toast({
        variant: 'destructive',
        title: 'Missing details',
        description: 'Please give your name, an email we can answer to, the link to the item, and a sentence or two about what is yours.',
      });
      return;
    }

    setIsSending(true);
    try {
      const result = await api<Sent>('/takedowns', {
        body: { name, email, target, rights, details, goodFaith, accuracy },
      });
      setSent(result);
      setName('');
      setEmail('');
      setTarget('');
      setDetails('');
      setGoodFaith(false);
      setAccuracy(false);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Notice not sent',
        description: friendlyError(error),
      });
    } finally {
      setIsSending(false);
    }
  };

  if (sent) {
    return (
      <Card className="border-emerald-500/40 bg-emerald-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Your notice is with INDECIANA
          </CardTitle>
          <CardDescription>
            Reference <span className="font-mono font-semibold text-foreground">{sent.reference}</span> — we have
            sent it to the address you gave.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          {sent.hidden ? (
            <p>
              <span className="font-semibold">{sent.item ?? 'The item'}</span> is hidden from shoppers while we
              check your notice, and the shop has been told why. We read it within a few working days and write
              to you either way.
            </p>
          ) : (
            <p>
              We read every notice within a few working days. Nothing is hidden until we have, because this
              notice did not name one of our items or was not confirmed as accurate and in good faith.
            </p>
          )}
          <p className="text-muted-foreground">
            If you have proof the work is yours — the original photo, a design file, a registration — reply to
            our email with it, and it goes straight to the person deciding.
          </p>
        </CardContent>
        <CardFooter className="border-t">
          <Button variant="outline" onClick={() => setSent(null)}>
            Send another notice
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Send a notice
          </CardTitle>
          <CardDescription>
            One item per notice. You do not need an account — the person whose photo or brand was used often
            has none.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="claimant-name">Your name</Label>
              <Input
                id="claimant-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name, or the business you act for"
                autoComplete="name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="claimant-email">Email we can answer to</Label>
              <Input
                id="claimant-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="claimant-target">Link to the item, or its number</Label>
            <Input
              id="claimant-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="https://<your site>/product?id=… or the item number"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="claimant-rights">What is yours</Label>
            <Select onValueChange={setRights} value={rights}>
              <SelectTrigger id="claimant-rights">
                <SelectValue placeholder="Choose one…" />
              </SelectTrigger>
              <SelectContent>
                {RIGHTS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="claimant-details">What is yours, and why</Label>
            <Textarea
              id="claimant-details"
              className="min-h-32"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="For example: the main photo on this item is a photo I took in my shop in June. It is the third picture. The shop has never had my agreement to use it."
            />
            <p className="text-xs text-muted-foreground">
              The more exact you are — which photo, which part of the design — the faster we can decide.
            </p>
          </div>

          <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <Checkbox
                checked={goodFaith}
                onCheckedChange={(v) => setGoodFaith(v === true)}
                className="mt-0.5"
              />
              <span>
                I make this notice in good faith, believing the item breaks my rights — not to remove a
                competitor’s honest listing.
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <Checkbox
                checked={accuracy}
                onCheckedChange={(v) => setAccuracy(v === true)}
                className="mt-0.5"
              />
              <span>
                The information in this notice is accurate, and I am the rights holder or speak for them. I
                understand a knowingly false notice can make me responsible for the loss it causes.
              </span>
            </label>
            <p className="text-xs text-muted-foreground">
              With both boxes ticked and one of our items named, the item is hidden at once while we check.
              Without them it is still read, but nothing is hidden first.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            How we decide, and what the shop can say back:{' '}
            <Link href="/takedown-policy" className="text-primary hover:underline">
              Notice and Takedown Policy
            </Link>
            .
          </p>
        </CardContent>
        <CardFooter className="border-t px-6 py-4">
          <Button type="submit" disabled={isSending}>
            {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send notice
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
