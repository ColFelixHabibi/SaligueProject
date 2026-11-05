import type { Metadata } from 'next';
import Link from 'next/link';
import { TakedownForm } from '@/components/takedown-form';

export const metadata: Metadata = { title: 'Report content that is yours · Saligue' };

/** Where a rights holder asks us to remove an item: open to everyone, no account needed. */
export default function TakedownPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Saligue by INDECIANA</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">Report content that is yours</h1>
      <p className="mt-1 text-sm text-muted-foreground">Notice and takedown · Last updated 4 November 2026</p>
      <p className="mt-6 leading-relaxed">
        If an item on Saligue uses a photo you took, a design you made, your brand, or a photo of you, tell us
        here. Name the item and confirm the notice is accurate and in good faith, and that item is hidden from
        shoppers at once while INDECIANA checks it — you get an email with a reference, and the shop is told why.
      </p>
      <p className="mt-3 leading-relaxed text-foreground/85">
        You do not need a Saligue account. Send one notice per item. We decide within a few working days, and we
        write to you either way.
      </p>

      <div className="mt-8">
        <TakedownForm />
      </div>

      <p className="mt-10 border-t pt-6 text-sm text-muted-foreground">
        Read the full{' '}
        <Link href="/takedown-policy" className="text-primary hover:underline">
          Notice and Takedown Policy
        </Link>
        , the{' '}
        <Link href="/terms" className="text-primary hover:underline">
          Terms of Service
        </Link>{' '}
        and the{' '}
        <Link href="/privacy" className="text-primary hover:underline">
          Privacy Policy
        </Link>
        . Own the item and it was hidden by mistake? Answer in{' '}
        <Link href="/my-account/support" className="text-primary hover:underline">
          Help &amp; Support
        </Link>
        .
      </p>
    </div>
  );
}
