'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reportError } from '@/lib/report-error';

/** Shown instead of a blank "Application error" page when something on a page breaks. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportError(error), [error]);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-3xl font-extrabold text-primary">S</span>
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="max-w-xs text-sm text-muted-foreground">We’ve been told about it. Try again, or go back to the start.</p>
      <div className="flex gap-2">
        <Button onClick={reset}><RefreshCw className="mr-2 h-4 w-4" /> Try again</Button>
        <Button variant="outline" asChild><Link href="/">Home</Link></Button>
      </div>
    </div>
  );
}
