'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { api } from '@/lib/api';

// Set by scripts/build-app.mjs: the version code of this Android app. Empty on the website.
const MINE = Number(process.env.NEXT_PUBLIC_APP_VERSION || 0);
const KEY = 'saligue-update-dismissed';

/** Inside the Android app: a banner when the server has a newer version, with a button to download it. */
export function AppUpdate() {
  const [latest, setLatest] = useState<{ versionCode: number; versionName: string; url: string } | null>(null);
  useEffect(() => {
    if (!MINE) return;
    api<typeof latest>('/app/version').then((v) => {
      let dismissed = 0;
      try {
        dismissed = Number(localStorage.getItem(KEY) || 0);
      } catch {
        // Storage blocked: always offer it.
      }
      if (v && v.versionCode > MINE && v.versionCode !== dismissed) setLatest(v);
    }).catch(() => {});
  }, []);
  if (!latest) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, String(latest.versionCode));
    } catch {
      // Storage blocked.
    }
    setLatest(null);
  };
  return (
    <div className="fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[70] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-foreground p-3 text-background shadow-xl">
      <Download className="h-5 w-5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 text-sm"><b>Saligue {latest.versionName}</b> is ready</span>
      <a href={latest.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground">Update</a>
      <button type="button" onClick={close} aria-label="Later" className="shrink-0 rounded-full p-1 opacity-70"><X className="h-4 w-4" /></button>
    </div>
  );
}

/** "Version 1.7": the newest app on the server (download page). */
export function AppVersion() {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => void api<{ versionName: string } | null>('/app/version').then((v) => setName(v?.versionName ?? null)).catch(() => {}), []);
  return <>{name ? `Version ${name}` : 'Latest version'}</>;
}
