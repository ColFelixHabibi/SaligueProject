'use client';

import { useEffect, useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Saligue's own "Are you sure?" box, instead of the browser's confirm()/prompt() pop-ups (which look foreign,
// show the website address, and are blocked in some app views).

type Ask = {
  title: string;
  description?: string;
  confirm?: string;
  destructive?: boolean;
  // Asks for a short text too (e.g. a reason); the promise then resolves to that text.
  input?: { label: string; value?: string };
};
type Pending = Ask & { resolve: (answer: string | boolean | null) => void };

let show: ((p: Pending) => void) | null = null;

/** Opens the dialog. Resolves to true (or the typed text) when confirmed, null when cancelled. */
export function ask(options: Ask): Promise<string | true | null> {
  return new Promise((resolve) => {
    if (!show) return resolve(null);
    show({ ...options, resolve: resolve as Pending['resolve'] });
  });
}

/** Mounted once in the root layout. */
export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    show = (p) => {
      setText(p.input?.value ?? '');
      setPending(p);
    };
    return () => {
      show = null;
    };
  }, []);
  const close = (answer: string | boolean | null) => {
    pending?.resolve(answer);
    setPending(null);
  };
  const binOnly = !!pending?.destructive && /^(delete|remove)$/i.test(pending.confirm ?? '');
  return (
    <AlertDialog open={!!pending} onOpenChange={(open) => !open && close(null)}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          {pending?.description && <AlertDialogDescription>{pending.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {pending?.input && (
          <label className="grid gap-1.5 text-sm font-medium">
            {pending.input.label}
            <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
          </label>
        )}
        {/* Icons instead of words: X to cancel, a bin to delete or remove. */}
        <AlertDialogFooter className="flex-row justify-end gap-3 space-x-0">
          <AlertDialogCancel className="mt-0 h-12 w-12 rounded-full p-0" aria-label="Cancel" title="Cancel"><X className="h-5 w-5" /></AlertDialogCancel>
          <AlertDialogAction disabled={!!pending?.input && !text.trim()} className={cn('h-12', binOnly ? 'w-12 rounded-full p-0' : 'rounded-full px-6', pending?.destructive && 'bg-destructive hover:bg-destructive/90')}
            aria-label={pending?.confirm ?? 'OK'} title={pending?.confirm ?? 'OK'}
            onClick={() => close(pending?.input ? text.trim() : true)}>
            {binOnly ? <Trash2 className="h-5 w-5" /> : pending?.confirm ?? 'OK'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
