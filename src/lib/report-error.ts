'use client';

// Sends crashes to the Saligue server (server log), so problems on shoppers' phones can be found and fixed.
const sent = new Set<string>();

export function reportError(error: unknown, where?: string) {
  try {
    const e = error as { message?: string; stack?: string; digest?: string };
    const message = String(e?.message ?? error).slice(0, 500);
    if (sent.has(message) || sent.size > 20) return;
    sent.add(message);
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/client-errors`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, stack: String(e?.stack ?? '').slice(0, 2000), where: where ?? location.pathname, app: !!(window as any).Capacitor?.isNativePlatform?.() }),
    }).catch(() => {});
  } catch {
    // Never let reporting itself cause trouble.
  }
}

/** Also report errors that happen outside React (timers, promises). */
export function watchErrors() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'window'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
}
