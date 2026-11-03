import type { Metadata } from 'next';
import Link from 'next/link';
import { EyeOff, Heart, Layers, Megaphone, Radio, Settings2, Sparkles, Store, Users } from 'lucide-react';

export const metadata: Metadata = { title: 'How For You works · Saligue' };

// Written from server/recommend.mjs: change this page when the ranking changes.
const SECTIONS = [
  {
    icon: Heart,
    title: 'What it learns from',
    points: [
      'What you like, save, put in your bag, buy and comment on.',
      'What you open, watch for a few seconds, watch to the end, try on, share or ask the shop about.',
      'What you swipe past quickly, and “Show less like this”, which hides that item and lowers similar ones.',
      'What you search for counts straight away, from your first search.',
      'Older signals fade: something from three weeks ago counts about half as much.',
    ],
  },
  {
    icon: Users,
    title: 'How it picks',
    points: [
      'Shoppers who liked what you like also liked…: learned from everyone’s choices together, updated every few minutes.',
      'Items that look like the ones you like (colour, cut, style), so new items with no history can still reach you.',
      'What is trending and new on Saligue, with a little variety each day and never more than two of the same kind in a row.',
      'Items you already bought, and items that are sold out, are left out or moved down.',
      'The more you use Saligue, the more it follows your taste. A new visitor sees mostly new and popular items.',
    ],
  },
  {
    icon: Sparkles,
    title: 'Fair chances, not only for big accounts',
    points: [
      'Every new post is shown to a small first audience (one place in six), whoever posted it and however many followers they have. How those people react decides how far it travels next.',
      'Shops that joined in the last 30 days get one place in five, so a new seller is seen from the first day.',
      'Follower numbers don’t decide what you see in For You. What people do with the post does.',
    ],
  },
  {
    icon: Store,
    title: 'INDECIANA and sponsored items',
    points: [
      'INDECIANA runs Saligue and has its own shop. Its items take one place in four in For You, marked with its name.',
      'Sponsored items are paid for by shops, reviewed against the Ads Policy, and always marked “Sponsored”.',
    ],
  },
];

const CONTROLS = [
  { icon: EyeOff, text: 'Tap ••• on any item: “Why am I seeing this?” tells you the reason, and “Show less like this” steers the feed.' },
  { icon: Layers, text: 'Following shows only shops and teachers you follow, newest first. No algorithm.' },
  { icon: Radio, text: 'Local shows shops in a city you choose. Learn shows fashion lessons.' },
  { icon: Settings2, text: 'Settings → For You: turn off “Personalise my feed”, or “Reset my recommendations” to clear what Saligue learned. Choose “Essential only” in the cookie banner and nothing about what you watch is recorded.' },
  { icon: Megaphone, text: 'Pull down at the top of the feed, or tap For You again, for a fresh mix.' },
];

/** How the For You feed decides what you see, in plain words, and how to steer it. */
export default function HowFeedWorksPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 pb-24">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Saligue by INDECIANA</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">How For You works</h1>
        <p className="mt-2 text-muted-foreground">No secrets: this is how Saligue decides which items you see, and how you stay in control.</p>
      </div>
      {SECTIONS.map((s) => (
        <section key={s.title} className="rounded-2xl border bg-card p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold"><s.icon className="h-5 w-5 text-primary" /> {s.title}</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            {s.points.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </section>
      ))}
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-bold">You are in control</h2>
        <ul className="mt-3 space-y-3 text-sm">
          {CONTROLS.map((c) => (
            <li key={c.text} className="flex gap-3"><c.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> <span>{c.text}</span></li>
          ))}
        </ul>
      </section>
      <p className="text-sm text-muted-foreground">
        What is recorded and for how long: <Link href="/privacy" className="text-primary underline">Privacy Policy</Link> · <Link href="/cookies" className="text-primary underline">Cookie Policy</Link>
      </p>
    </div>
  );
}
