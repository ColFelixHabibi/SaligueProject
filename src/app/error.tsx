'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Home, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { nextStep } from '@/lib/recover';
import { reportError } from '@/lib/report-error';

/**
 * When a page breaks it mends itself first (src/lib/recover.ts): a quiet retry, then one reload. Only a page that
 * keeps breaking after both shows this calm screen — never a "Something went wrong" message.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const t = useT();
  const [show, setShow] = useState(false);
  useEffect(() => {
    reportError(error);
    const step = nextStep(error);
    if (step === 'retry') {
      const timer = setTimeout(reset, 300);
      return () => clearTimeout(timer);
    }
    if (step === 'reload') location.reload();
    else setShow(true);
  }, [error, reset]);
  if (!show) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" aria-busy="true">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-3xl font-extrabold text-primary">S</span>
      <h1 className="text-xl font-bold">{t('This page needs a fresh start')}</h1>
      <p className="max-w-xs text-sm text-muted-foreground">{t('Reload it, or carry on from another page.')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => location.reload()}><RefreshCw className="mr-2 h-4 w-4" /> {t('Reload')}</Button>
        <Button variant="outline" onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}><ArrowLeft className="mr-2 h-4 w-4" /> {t('Back')}</Button>
        <Button variant="ghost" asChild><Link href="/"><Home className="mr-2 h-4 w-4" /> {t('Home')}</Link></Button>
      </div>
    </div>
  );
}
