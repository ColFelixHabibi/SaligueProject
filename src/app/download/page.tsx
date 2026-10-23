import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Get the Saligue app' };

const APK = '/download/saligue.apk';

/** Download page for the Android app, with the steps Android asks for when installing from outside the Play Store. */
export default function DownloadPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <div className="space-y-2 text-center">
        <Smartphone className="mx-auto h-12 w-12 text-primary" />
        <h1 className="text-3xl font-extrabold tracking-tight">Saligue for Android</h1>
        <p className="text-muted-foreground">Version 1.6 · about 33 MB · Android 7 or newer</p>
      </div>
      <Button size="lg" className="h-14 w-full text-lg" asChild>
        <a href={APK} download="Saligue.apk"><Download className="mr-2 h-5 w-5" /> Download the app</a>
      </Button>
      <ol className="space-y-3 rounded-2xl border bg-card p-5 text-sm leading-relaxed">
        <li><b>1. Open this page on your Android phone</b> (not a computer) and tap <b>Download the app</b>.</li>
        <li><b>2. Already have an older Saligue app?</b> Uninstall it first (hold its icon → Uninstall). Otherwise Android says “App not installed”.</li>
        <li><b>3. Open the downloaded file</b> (from the notification or Files → Downloads).</li>
        <li><b>4. Allow the install:</b> if Android asks, tap <b>Settings → Allow from this source</b>, then go back.</li>
        <li><b>5. If Play Protect warns</b> “Unknown app”, tap <b>More details → Install anyway</b>. Saligue is not on the Play Store yet, so Google doesn’t know it.</li>
        <li><b>6. Open Saligue</b> and allow the camera and microphone when you go live.</li>
      </ol>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        The app is signed by INDECIANA. On iPhone, use the website: open it in Safari and choose Share → Add to Home Screen.
      </p>
      <p className="text-center text-sm"><Link href="/" className="text-primary underline">Use Saligue in the browser instead</Link></p>
    </div>
  );
}
