'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/report-error';

/** Last safety net when the whole app fails to start (replaces the root layout, so it brings its own page). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportError(error), [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, textAlign: 'center', padding: 24 }}>
        <div>
          <div style={{ width: 64, height: 64, borderRadius: 999, background: '#fde7f1', color: '#e21376', fontWeight: 800, fontSize: 28, display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>S</div>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ color: '#6f5f67', margin: '0 0 20px' }}>We’ve been told about it.</p>
          <button onClick={() => reset()} style={{ background: '#e21376', color: '#fff', border: 0, borderRadius: 999, padding: '12px 24px', fontWeight: 600, fontSize: 16 }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
