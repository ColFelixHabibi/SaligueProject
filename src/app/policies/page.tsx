import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck, ChevronRight, Coins, Cookie, FileText, Lock, Megaphone } from 'lucide-react';

export const metadata: Metadata = { title: 'Policies · Saligue' };

const POLICIES = [
  { href: '/terms', title: 'Terms of Service', text: 'The rules for using Saligue.', icon: FileText },
  { href: '/privacy', title: 'Privacy Policy', text: 'What we collect and the choices you have.', icon: Lock },
  { href: '/cookies', title: 'Cookie Policy', text: 'What is stored on your device and why.', icon: Cookie },
  { href: '/monetization-policy', title: 'Monetization Policy', text: 'How creators earn: requirements, points, tips, payouts.', icon: Coins },
  { href: '/ads-policy', title: 'Ads Policy', text: 'Sponsored items: prices, review and rules.', icon: Megaphone },
  { href: '/verification-policy', title: 'Verification Policy', text: 'The optional blue check and how documents are protected.', icon: BadgeCheck },
];

/** Every Saligue policy in one place, open to everyone (no account needed). */
export default function PoliciesPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Saligue by INDECIANA</p>
      <h1 className="text-3xl font-extrabold tracking-tight">Policies</h1>
      <div className="divide-y rounded-2xl border bg-card">
        {POLICIES.map((p) => (
          <Link key={p.href} href={p.href} className="flex items-center gap-3 p-4 hover:bg-muted/60">
            <p.icon className="h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1"><span className="block font-semibold">{p.title}</span><span className="block text-sm text-muted-foreground">{p.text}</span></span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}
