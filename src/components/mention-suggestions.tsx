'use client';

import { useEffect, useMemo, useState } from 'react';
import { hashtagsIn } from '@/components/rich-text';
import { SellerAvatar } from '@/components/seller-avatar';
import { useProductStore } from '@/hooks/use-product-store';
import { api, mediaUrl } from '@/lib/api';

type Person = { id: string; name: string; username: string; avatar: string | null };

/**
 * While the last word typed starts with @, shows matching people above the box; with #, the tags already in use
 * (most used first), so the same thing gets the same tag and its page gathers it. Tapping one completes the word.
 * Works with any text input: give it the value and a setter.
 */
export function MentionSuggestions({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tagWord = /(?:^|\s)#([\p{L}\p{N}_]{1,40})$/u.exec(value)?.[1]?.toLowerCase() ?? null;
  const products = useProductStore((s) => s.products);
  const tags = useMemo(() => {
    if (!tagWord) return [];
    const counts = new Map<string, number>();
    for (const p of products) for (const tag of new Set(hashtagsIn(`${p.name} ${p.description ?? ''}`))) if (tag.startsWith(tagWord) && tag !== tagWord) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [tagWord, products]);
  const word = /(?:^|\s)@([\w.]{1,24})$/.exec(value)?.[1] ?? null;
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    if (!word) return setPeople([]);
    const t = setTimeout(() => api<Person[]>(`/usernames?q=${encodeURIComponent(word)}`).then((l) => setPeople(l.map((p) => ({ ...p, avatar: mediaUrl(p.avatar ?? undefined) ?? null })))).catch(() => setPeople([])), 200);
    return () => clearTimeout(t);
  }, [word]);
  if (tagWord && tags.length) {
    return (
      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="listbox" aria-label="Tags">
        {tags.map(([tag, n]) => (
          <button key={tag} type="button" role="option" aria-selected={false}
            onClick={() => onChange(value.replace(/#[\p{L}\p{N}_]*$/u, `#${tag} `))}
            className="flex shrink-0 items-center gap-1 rounded-full border bg-background px-3 py-1 text-xs hover:bg-muted">
            <span className="font-semibold">#{tag}</span> <span className="text-muted-foreground">{n}</span>
          </button>
        ))}
      </div>
    );
  }
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
