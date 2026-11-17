'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** An old address that moved: goes to the new one at once (links in older notifications keep working). */
export function GoTo({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
