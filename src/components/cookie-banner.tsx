'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cookie } from 'lucide-react';
import { Button } from '@/components/ui/button';

const KEY = 'saligue-cookie-choice';

/** Also as a cookie, so the server knows whether it may learn from this visitor's behaviour (For You). */
function setConsentCookie(choice: 'all' | 'essential') {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `saligue_consent=${choice}; Path=/; Max-Age=${365 * 86_400}; SameSite=Lax${secure}`;
}

/** Tells visitors which cookies Saligue uses (essential only) and remembers that they read it. */
export function CookieBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      setOpen(!saved);
      if (saved && !/saligue_consent=/.test(document.cookie)) setConsentCookie(saved.choice === 'essential' ? 'essential' : 'all');
    } catch {
      // Storage blocked: don't nag on every page.
    }
  }, []);
  const choose = (choice: 'accepted' | 'essential') => {
    setConsentCookie(choice === 'essential' ? 'essential' : 'all');
    try {
      localStorage.setItem(KEY, JSON.stringify({ choice, at: new Date().toISOString() }));
    } catch {
      // Ignore.
    }
    setOpen(false);
  };
  if (!open) return null;

  return (
    <div role="dialog" aria-live="polite" aria-label="Cookies" className="fixed inset-x-3 bottom-[calc(4.5rem+var(--sab))] z-[60] mx-auto max-w-xl rounded-2xl border bg-background p-4 shadow-2xl md:bottom-6">
      <div className="flex gap-3">
        <Cookie className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
        <div className="space-y-3">
          <p className="text-sm leading-relaxed">
            Saligue uses an <b>essential cookie</b> to keep you signed in. With <b>OK</b>, For You also learns from what you open, watch and try on to show you more of what you like. No advertising cookies, nothing sold.{' '}
            <Link href="/cookies" className="font-semibold text-primary underline">Cookie Policy</Link>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-9 px-5" onClick={() => choose('accepted')}>OK, personalise</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => choose('essential')}>Essential only</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
