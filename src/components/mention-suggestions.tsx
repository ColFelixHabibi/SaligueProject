'use client';

import { useEffect, useState } from 'react';
import { SellerAvatar } from '@/components/seller-avatar';
import { api, mediaUrl } from '@/lib/api';

type Person = { id: string; name: string; username: string; avatar: string | null };

/**
 * While the last word typed starts with @, shows matching people above the box; tapping one completes it.
 * Works with any text input: give it the value and a setter.
 */
export function MentionSuggestions({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const word = /(?:^|\s)@([\w.]{1,24})$/.exec(value)?.[1] ?? null;
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    if (!word) return setPeople([]);
    const t = setTimeout(() => api<Person[]>(`/usernames?q=${encodeURIComponent(word)}`).then((l) => setPeople(l.map((p) => ({ ...p, avatar: mediaUrl(p.avatar ?? undefined) ?? null })))).catch(() => setPeople([])), 200);
    return () => clearTimeout(t);
  }, [word]);
  if (!word || !people.length) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="listbox" aria-label="People">
      {people.map((p) => (
        <button key={p.id} type="button" role="option" aria-selected={false}
          onClick={() => onChange(value.replace(/@[\w.]*$/, `@${p.username} `))}
          className="flex shrink-0 items-center gap-1.5 rounded-full border bg-background py-1 pl-1 pr-3 text-xs hover:bg-muted">
          <SellerAvatar src={p.avatar} name={p.name} className="h-6 w-6" />
          <span className="font-semibold">@{p.username}</span>
        </button>
      ))}
    </div>
  );
}
