'use client';

import { Fragment, useState } from 'react';
import { CornerDownRight } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Threaded = { id: string; parentId?: string | null; createdAt?: string | null };

// Replies are indented a few steps; deeper replies stay at the last step (with the name they answer), so long
// conversations remain readable on a phone.
const MAX_INDENT = 3;

/**
 * Comments as threads: replies under the comment they answer, replies to replies under those, as deep as people
 * go. Long branches fold behind "View N replies".
 */
export function CommentThread<T extends Threaded>({ items, render, roots }: {
  items: T[];
  render: (item: T, depth: number, parent: T | null) => React.ReactNode;
  // The top comments in the order to show (default: those without a parent, as given).
  roots?: T[];
}) {
  const children = new Map<string, T[]>();
  const byId = new Map(items.map((c) => [c.id, c]));
  for (const c of items) {
    // A reply whose parent is gone (removed) is shown as a top comment.
    if (c.parentId && byId.has(c.parentId)) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
  }
  for (const list of children.values()) list.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const top = roots ?? items.filter((c) => !c.parentId || !byId.has(c.parentId));
  return <>{top.map((c) => <Branch key={c.id} item={c} depth={0} parent={null} kids={children} render={render} />)}</>;
}

function count<T extends Threaded>(id: string, kids: Map<string, T[]>): number {
  return (kids.get(id) ?? []).reduce((n, c) => n + 1 + count(c.id, kids), 0);
}

function Branch<T extends Threaded>({ item, depth, parent, kids, render }: { item: T; depth: number; parent: T | null; kids: Map<string, T[]>; render: (item: T, depth: number, parent: T | null) => React.ReactNode }) {
  const t = useT();
  const replies = kids.get(item.id) ?? [];
  // The first two levels are open; deeper branches open on a tap.
  const [open, setOpen] = useState(depth < 1);
  return (
    <div className={cn(depth > 0 && depth <= MAX_INDENT && 'ml-5 border-l pl-3')}>
      {render(item, depth, parent)}
      {replies.length > 0 && (open ? (
        <div className="mt-2 space-y-3">
          {replies.map((r) => <Fragment key={r.id}><Branch item={r} depth={depth + 1} parent={item} kids={kids} render={render} /></Fragment>)}
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="ml-9 mt-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <CornerDownRight className="h-3.5 w-3.5" /> {t('View replies')} ({count(item.id, kids)})
        </button>
      ))}
    </div>
  );
}
