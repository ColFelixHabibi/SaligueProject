'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Mail } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

// One way to share everywhere: the phone's own share menu in the Android/iOS app and in phone browsers, or
// Saligue's sheet (WhatsApp, Facebook, X, Telegram, email, copy) where there is none, e.g. on most computers.

type ShareData = { title: string; text?: string; url: string };
let open: ((d: ShareData) => void) | null = null;

const native = () => (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;

/** Shares a link. Resolves once the menu is shown (or closed); never throws. */
export async function shareLink(data: ShareData) {
  try {
    if (native()) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title: data.title, text: data.text ?? data.title, url: data.url, dialogTitle: 'Share' });
      return;
    }
    // Phones' browsers: the system menu. Computers mostly don't have a useful one, so they get Saligue's sheet.
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    if (touch && navigator.share) {
      await navigator.share({ title: data.title, text: data.text, url: data.url });
      return;
    }
  } catch (error) {
    // Closed without choosing: nothing to do.
    if ((error as { name?: string })?.name === 'AbortError' || /cancel/i.test(String((error as Error)?.message))) return;
  }
  open?.(data);
}

const APPS: { name: string; color: string; href: (d: ShareData) => string; letter: string }[] = [
  { name: 'WhatsApp', color: 'bg-[#25D366]', letter: 'W', href: (d) => `https://wa.me/?text=${encodeURIComponent(`${d.text ?? d.title} ${d.url}`)}` },
  { name: 'Facebook', color: 'bg-[#1877F2]', letter: 'f', href: (d) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(d.url)}` },
  { name: 'X', color: 'bg-black', letter: '𝕏', href: (d) => `https://x.com/intent/post?text=${encodeURIComponent(d.text ?? d.title)}&url=${encodeURIComponent(d.url)}` },
  { name: 'Telegram', color: 'bg-[#229ED9]', letter: 'T', href: (d) => `https://t.me/share/url?url=${encodeURIComponent(d.url)}&text=${encodeURIComponent(d.text ?? d.title)}` },
];

/** Mounted once in the root layout. */
export function ShareHost() {
  const [data, setData] = useState<ShareData | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    open = (d) => {
      setCopied(false);
      setData(d);
    };
    return () => {
      open = null;
    };
  }, []);
  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.url);
    } catch {
      // Older browsers: select the text so it can be copied by hand.
      const field = document.getElementById('share-url') as HTMLInputElement | null;
      field?.select();
      document.execCommand?.('copy');
    }
    setCopied(true);
  };
  const tile = 'flex flex-col items-center gap-1.5 rounded-2xl p-2 text-xs font-semibold transition hover:bg-muted';
  return (
    <Sheet open={!!data} onOpenChange={(v) => !v && setData(null)}>
      <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-3xl px-4 min-[360px]:px-6">
        <SheetHeader><SheetTitle>Share</SheetTitle></SheetHeader>
        {data && (
          <div className="mt-4 space-y-4">
            <p className="line-clamp-2 text-center text-sm text-muted-foreground">{data.title}</p>
            <div className="grid grid-cols-5 gap-1">
              {APPS.map((a) => (
                <a key={a.name} href={a.href(data)} target="_blank" rel="noreferrer" className={tile} onClick={() => setTimeout(() => setData(null), 300)}>
                  <span className={cn('flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white', a.color)}>{a.letter}</span>
                  {a.name}
                </a>
              ))}
              <a href={`mailto:?subject=${encodeURIComponent(data.title)}&body=${encodeURIComponent(`${data.text ?? data.title}\n${data.url}`)}`} className={tile}>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground"><Mail className="h-5 w-5" /></span>
                Email
              </a>
            </div>
            <div className="flex items-center gap-2 rounded-xl border p-1.5 pl-3">
              <input id="share-url" readOnly value={data.url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Link" />
              <button type="button" onClick={copy} className={cn('flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold', copied ? 'bg-emerald-600 text-white' : 'bg-primary text-primary-foreground')}>
                {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy link</>}
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
