'use client';

import { useEffect } from 'react';

/**
 * Inside the Android/iOS app there are no browser tabs or windows: links meant to open elsewhere (WhatsApp,
 * maps, phone, email, other sites) are handed to the phone, which opens the right app or the browser.
 */
export function NativeLinks() {
  useEffect(() => {
    const native = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;
    if (!native) return;
    const external = (href: string) => /^(tel|mailto|sms|whatsapp|geo|intent):/i.test(href) || (/^https?:/i.test(href) && new URL(href).host !== window.location.host);
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a || e.defaultPrevented || a.hasAttribute('download')) return;
      const href = a.href;
      if (href && external(href)) {
        e.preventDefault();
        window.location.href = href;
      }
    };
    const open = window.open;
    window.open = ((url?: string | URL) => {
      if (url) window.location.href = String(url);
      return null;
    }) as typeof window.open;
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.open = open;
    };
  }, []);
  return null;
}
