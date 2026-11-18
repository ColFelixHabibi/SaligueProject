'use client';

import { useEffect } from 'react';
import { useProductStore } from '@/hooks/use-product-store';

// The opening screen (the logo while Saligue opens, like the big apps). It is drawn by CSS from layout.tsx (SPLASH),
// so it shows the moment the page does, before any code runs. This takes it away once the app is ready: never
// before MIN_MS (the logo is seen, not flashed), never after MAX_MS (a slow network never keeps anyone waiting
// longer). Once per opening: moving between pages, or a reload in the same session, does not show it again.
const MIN_MS = 2500;
const MAX_MS = 5000;

export function SplashGate() {
  const ready = useProductStore((s) => s.isInitialized);
  useEffect(() => {
    const w = window as { __splashAt?: number; __hideSplash?: () => void };
    if (!w.__splashAt || !w.__hideSplash) return;
    const elapsed = Date.now() - w.__splashAt;
    const timer = setTimeout(() => {
      w.__hideSplash?.();
      try {
        sessionStorage.setItem('saligue-opened', '1');
      } catch {
        // Storage blocked: it may show again on the next full load, which is harmless.
      }
    }, Math.max(0, (ready ? MIN_MS : MAX_MS) - elapsed));
    return () => clearTimeout(timer);
  }, [ready]);
  return null;
}
