'use client';

// "Write with AI": the description of an item is written from the details the seller already typed, in the language
// the app is in. It spends this account's own DeepSeek key when it has one (Settings → Your AI key → server/ai-keys.mjs),
// Saligue's otherwise. The rules stay on the server (/api/ai/write), so the app can never make the AI invent a brand,
// a measurement or a return policy.
import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useLang } from '@/lib/i18n';
import { categoryLabel, isCategory } from '@/lib/categories';

/** What the seller has typed so far: the only facts the AI is allowed to describe. */
export type ItemFacts = {
  title?: string;
  category?: string;
  type?: string;
  brand?: string;
  size?: string;
  color?: string;
  condition?: string;
  note?: string;
};

/**
 * The small "Write with AI" button that sits beside the Description label on Sell and Edit.
 * `hasText` only changes the label (Write / Rewrite), so a seller always knows the text will be replaced.
 */
export function WriteWithAi({ facts, hasText, onWrite }: { facts: ItemFacts; hasText?: boolean; onWrite: (text: string) => void }) {
  const { toast } = useToast();
  const lang = useLang();
  const [busy, setBusy] = useState(false);

  const write = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const written = await api<{ text: string; source: 'yours' | 'platform' }>('/ai/write', {
        body: {
          ...facts,
          // The server words the description for people, so it gets "Tops", not the internal "tops".
          category: facts.category && isCategory(facts.category) ? categoryLabel(facts.category) : facts.category,
          lang,
        },
        // DeepSeek takes up to 30 s on the server before it gives up (server/ai-keys.mjs): the app waits a little longer.
        timeoutMs: 45_000,
      });
      onWrite(written.text);
      toast({
        title: hasText ? 'Description rewritten' : 'Description written',
        description: `${written.source === 'yours' ? 'Written with your own DeepSeek key' : 'Written with Saligue’s AI key'}. Read it, and change anything that is not exact.`,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'no_key') {
        toast({
          variant: 'destructive',
          title: 'No AI key yet',
          description: 'Add your DeepSeek key in Settings → Your AI key, then write it again.',
        });
      } else {
        toast({ variant: 'destructive', title: 'AI could not write it', description: friendlyError(error) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button type="button" variant="secondary" size="sm" onClick={write} disabled={busy} aria-live="polite">
      {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {busy ? 'Writing…' : hasText ? 'Rewrite with AI' : 'Write with AI'}
    </Button>
  );
}
