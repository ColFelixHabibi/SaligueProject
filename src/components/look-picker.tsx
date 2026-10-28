'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Layers, Loader2, Plus } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';
import { friendlyError } from '@/lib/errors';
import { createLook, inLook, togglePiece, useMyLooks, type LookPiece } from '@/lib/looks';
import { cn } from '@/lib/utils';

let open: ((p: LookPiece) => void) | null = null;

/** Opens "Add to a look" for an item or lesson. Asks guests to log in. */
export function addToLook(piece: LookPiece) {
  open?.(piece);
}

/** Mounted once in the root layout. */
export function LookPickerHost() {
  const { user } = useAuth();
  const { toast } = useToast();
  const t = useT();
  const [piece, setPiece] = useState<LookPiece | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const looks = useMyLooks(!!user && !!piece);
  useEffect(() => {
    open = (p) => {
      if (!user) {
        toast({ title: t('Log in to make looks') });
        return;
      }
      setName('');
      setPiece(p);
    };
    return () => {
      open = null;
    };
  }, [user, toast, t]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={!!piece} onOpenChange={(v) => !v && setPiece(null)}>
      <SheetContent side="bottom" className="mx-auto flex max-h-[80dvh] max-w-lg flex-col rounded-t-3xl px-4 min-[360px]:px-6">
        <SheetHeader><SheetTitle className="flex items-center gap-2 text-left"><Layers className="h-5 w-5 text-primary" /> {t('Add to a look')}</SheetTitle></SheetHeader>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!piece || !name.trim()) return;
            void run('new', async () => {
              const look = await createLook(name.trim());
              await togglePiece(look.id, piece);
              setName('');
            });
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('New look, e.g. Wedding')} className="h-11" />
          <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={!name.trim() || !!busy} aria-label={t('Create look')}>
            {busy === 'new' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
          </Button>
        </form>
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
          {looks === null && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}
          {looks?.map((l) => {
            const has = !!piece && inLook(l, piece);
            return (
              <button key={l.id} type="button" disabled={!!busy} onClick={() => piece && run(l.id, () => togglePiece(l.id, piece))}
                className={cn('flex w-full items-center gap-3 rounded-2xl border p-2 text-left transition hover:bg-muted', has && 'border-primary bg-primary/5')} aria-pressed={has}>
                <span className="grid h-12 w-12 shrink-0 grid-cols-2 gap-px overflow-hidden rounded-xl bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {l.covers.slice(0, 4).map((c, i) => <img key={i} src={c} alt="" className="h-full w-full object-cover" />)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{l.name}</span>
                  <span className="text-xs text-muted-foreground">{l.count}</span>
                </span>
                <span className={cn('flex h-8 w-8 items-center justify-center rounded-full', has ? 'bg-primary text-primary-foreground' : 'border')}>
                  {busy === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : has ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </span>
              </button>
            );
          })}
          {looks?.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">{t('Name your first look above.')}</p>}
        </div>
        {!!looks?.length && <Link href="/looks" onClick={() => setPiece(null)} className="pb-1 text-center text-sm font-semibold text-primary">{t('All my looks')}</Link>}
      </SheetContent>
    </Sheet>
  );
}
