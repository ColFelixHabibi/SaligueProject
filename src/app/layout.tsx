
import { PageTranslator } from '@/components/page-translator';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import Header from '@/components/layout/header';
import Footer from '@/components/layout/footer';
import Sidebar from '@/components/layout/sidebar';
import { cn } from '@/lib/utils';
import { AuthProvider } from '@/components/auth/auth-provider';
import { PwaRegister } from '@/components/pwa-register';
import { CookieBanner } from '@/components/cookie-banner';
import { AppUpdate } from '@/components/app-update';
import { BackButton } from '@/components/back-button';
import { ConfirmHost } from '@/components/confirm-dialog';
import { ShareHost } from '@/components/share-sheet';
import { LookPickerHost } from '@/components/look-picker';
import { Welcome } from '@/components/welcome';
import { NativeLinks } from '@/components/native-links';
import { AppLinks } from '@/components/app-links';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
// The site's own address, so a shared card's picture is a link WhatsApp and Facebook can fetch instead of a
// page-relative path they ignore.
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_API_URL || 'https://78-47-151-100.sslip.io').replace(/\/+$/, '');

// The Android app (Capacitor) writes the system bar sizes onto <html> as soon as the page shows, before React
// starts, and React then wipes them. This copies them into their own stylesheet the moment they arrive (and
// again whenever they change), so the top bar and bottom bar always clear the phone's own bars.
// Self-repair for a browser stuck on the loading screen: if the app has not started 20 s after the page loaded
// (window.__saligueStarted, set by PwaRegister once React runs), the site's caches are emptied, its service worker
// removed, and the page reloaded, once per visit. Inline, because broken cached app code could not run it.
const UNSTICK = `(function(){try{if(window.Capacitor)return;setTimeout(function(){try{if(window.__saligueStarted||sessionStorage.getItem('saligue-unstuck'))return;sessionStorage.setItem('saligue-unstuck','1');var jobs=[];if(window.caches)jobs.push(caches.keys().then(function(k){return Promise.all(k.filter(function(n){return n.indexOf('saligue-app-')===0}).map(function(n){return caches.delete(n)}))}));if(navigator.serviceWorker)jobs.push(navigator.serviceWorker.getRegistrations().then(function(r){return Promise.all(r.map(function(x){return x.unregister()}))}));Promise.all(jobs).then(function(){location.reload()},function(){location.reload()})}catch(e){}},20000)}catch(e){}})();`;

const KEEP_SAFE_AREA = `(function(){try{var s=document.createElement('style');s.id='saligue-safe-area';document.head.appendChild(s);var r=document.documentElement;function copy(){var t=r.style.getPropertyValue('--safe-area-inset-top'),b=r.style.getPropertyValue('--safe-area-inset-bottom');if(t||b)s.textContent=':root{--cap-sat:'+(t||'0px')+';--cap-sab:'+(b||'0px')+'}'}new MutationObserver(copy).observe(r,{attributes:true,attributeFilter:['style']});copy()}catch(e){}})();`;

const DESCRIPTION = 'Drip? AI’s got you. See yourself wearing any item, then contact the owner.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: 'Saligue by INDECIANA',
  description: DESCRIPTION,
  manifest: `${basePath}/manifest.webmanifest`,
  // A link shared into WhatsApp, Facebook, X or Telegram shows a card. Item, look, #tag, live, shop and lesson links
  // get their own card with their own picture from the server (server/index.mjs sharePreview); this is the one
  // everything else falls back to, so a shared page never arrives as a bare link.
  openGraph: {
    type: 'website',
    siteName: 'Saligue',
    title: 'Saligue by INDECIANA',
    description: DESCRIPTION,
    images: [{ url: `${basePath}/icons/icon-512.png`, alt: 'Saligue by INDECIANA' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Saligue by INDECIANA',
    description: DESCRIPTION,
    images: [`${basePath}/icons/icon-512.png`],
  },
  icons: {
    icon: `${basePath}/icons/icon-192.png`,
    apple: `${basePath}/icons/apple-touch-icon.png`,
  },
  appleWebApp: {
    capable: true,
    title: 'Saligue',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#e21376',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: KEEP_SAFE_AREA }} />
        <script dangerouslySetInnerHTML={{ __html: UNSTICK }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={cn('font-body antialiased', 'min-h-screen bg-background text-foreground')}>
        {/* Outside AuthProvider: it tells the stuck-page watchdog the app started, even while sign-in is still loading. */}
        <PwaRegister />
        <AuthProvider>
          <div className="relative flex min-h-screen flex-col">
            <Header />
            <Sidebar />
            <main className="flex-1 pb-[calc(4rem+var(--sab))] md:pb-0 md:pl-[72px] lg:pl-60">{children}</main>
            <Footer />
          </div>
          <Toaster />
          <PageTranslator />
          <CookieBanner />
          <AppUpdate />
          <BackButton />
          <ConfirmHost />
          <ShareHost />
          <LookPickerHost />
          <Welcome />
          <NativeLinks />
          <AppLinks />
        </AuthProvider>
      </body>
    </html>
  );
}
