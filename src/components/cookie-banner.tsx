'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cookie } from 'lucide-react';
import { Button } from '@/components/ui/button';

const KEY = 'saligue-cookie-choice';

/** Tells visitors which cookies Saligue uses (essential only) and remembers that they read it. */
export function CookieBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(!localStorage.getItem(KEY));
    } catch {
      // Storage blocked: don't nag on every page.
    }
  }, []);
  const choose = (choice: 'accepted' | 'essential') => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ choice, at: new Date().toISOString() }));
    } catch {
      // Ignore.
    }
    setOpen(false);
  };
  if (!open) return null;

  return (
    <div role="dialog" aria-live="polite" aria-label="Cookies" className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-xl rounded-2xl border bg-background p-4 shadow-2xl md:bottom-6">
      <div className="flex gap-3">
        <Cookie className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
        <div className="space-y-3">
          <p className="text-sm leading-relaxed">
            Saligue uses an <b>essential cookie</b> to keep you signed in and stores your bag and Fitting Room photo on this device. No advertising or tracking cookies.{' '}
            <Link href="/cookies" className="font-semibold text-primary underline">Cookie Policy</Link>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-9 px-5" onClick={() => choose('accepted')}>OK, got it</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => choose('essential')}>Essential only</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
