'use client';

import { Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SellerAvatar } from '@/components/seller-avatar';
import { setBlocked, useBlockedList } from '@/lib/blocks';

/** Settings: the accounts I blocked, with Unblock. */
export function BlockedCard() {
  const list = useBlockedList();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Ban className="h-5 w-5 text-primary" /> Blocked accounts</CardTitle>
        <CardDescription>You don’t see their items, lessons or comments, and they can’t message you or comment on yours.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {list.length === 0 && <p className="text-sm text-muted-foreground">You haven’t blocked anyone.</p>}
        {list.map((p) => (
          <div key={p.id} className="flex items-center gap-3 rounded-xl border p-2">
            <SellerAvatar src={p.avatar} name={p.name} className="h-9 w-9" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
            <Button size="sm" variant="outline" onClick={() => setBlocked(p.id, false)}>Unblock</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
