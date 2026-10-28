'use client';

import { Fragment } from 'react';
import Link from 'next/link';

// #hashtags open the tag's page; @usernames open that person's profile.
const TOKEN = /(^|[^\p{L}\p{N}_@#&])([#@])([\p{L}\p{N}_]{2,40}(?:\.[\p{L}\p{N}_]+)*)/gu;

/** Text with #hashtags and @mentions as links. Everything else stays plain text. */
export function RichText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = (m.index ?? 0) + m[1].length;
    if (start > last) parts.push(text.slice(last, start));
    const [, , mark, word] = m;
    parts.push(
      <Link key={start} href={mark === '#' ? `/tag?t=${encodeURIComponent(word.toLowerCase())}` : `/profile?u=${encodeURIComponent(word.toLowerCase())}`}
        onClick={(e) => e.stopPropagation()} className="font-semibold text-primary hover:underline">
        {mark}{word}
      </Link>
    );
    last = start + 1 + word.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

/** The #hashtags in a text, lowercased. */
export const hashtagsIn = (text: string) => [...text.matchAll(TOKEN)].filter((m) => m[2] === '#').map((m) => m[3].toLowerCase());
