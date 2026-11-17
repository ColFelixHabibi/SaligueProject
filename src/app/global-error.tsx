'use client';

import { useEffect, useState } from 'react';
import { nextStep } from '@/lib/recover';
import { reportError } from '@/lib/report-error';

/**
 * Last safety net when the whole app fails to start (replaces the root layout, so it brings its own page). It
 * mends itself like any page (src/lib/recover.ts) and only then shows a calm reload screen. No translations here:
 * the dictionary lives inside the layout this replaces.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    reportError(error);
    const step = nextStep(error);
    if (step === 'retry') {
      const timer = setTimeout(reset, 300);
      return () => clearTimeout(timer);
    }
    if (step === 'reload') location.reload();
    else setShow(true);
  }, [error, reset]);
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, textAlign: 'center', padding: 24, background: '#fff' }}>
        <div>
          <div style={{ width: 64, height: 64, borderRadius: 999, background: '#fde7f1', color: '#e21376', fontWeight: 800, fontSize: 28, display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>S</div>
          {show && (
            <>
              <h1 style={{ fontSize: 20, margin: '0 0 20px' }}>Saligue needs a fresh start</h1>
              <button onClick={() => location.reload()} style={{ background: '#e21376', color: '#fff', border: 0, borderRadius: 999, padding: '12px 24px', fontWeight: 600, fontSize: 16 }}>Reload</button>
              <a href="/" style={{ display: 'block', marginTop: 16, color: '#e21376', fontWeight: 600 }}>Home</a>
            </>
          )}
        </div>
      </body>
    </html>
  );
}
