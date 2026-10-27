
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
import { ConfirmHost } from '@/components/confirm-dialog';
import { ShareHost } from '@/components/share-sheet';
import { NativeLinks } from '@/components/native-links';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

// The Android app (Capacitor) writes the system bar sizes onto <html> as soon as the page shows, before React
// starts, and React then wipes them. This copies them into their own stylesheet the moment they arrive (and
// again whenever they change), so the top bar and bottom bar always clear the phone's own bars.
const KEEP_SAFE_AREA = `(function(){try{var s=document.createElement('style');s.id='saligue-safe-area';document.head.appendChild(s);var r=document.documentElement;function copy(){var t=r.style.getPropertyValue('--safe-area-inset-top'),b=r.style.getPropertyValue('--safe-area-inset-bottom');if(t||b)s.textContent=':root{--cap-sat:'+(t||'0px')+';--cap-sab:'+(b||'0px')+'}'}new MutationObserver(copy).observe(r,{attributes:true,attributeFilter:['style']});copy()}catch(e){}})();`;

export const metadata: Metadata = {
  title: 'Saligue by INDECIANA',
  description: 'Drip? AI’s got you. See yourself wearing any item, then contact the owner.',
  manifest: `${basePath}/manifest.webmanifest`,
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={cn('font-body antialiased', 'min-h-screen bg-background text-foreground')}>
        <AuthProvider>
          <div className="relative flex min-h-screen flex-col">
            <Header />
            <Sidebar />
            <main className="flex-1 pb-[calc(4rem+var(--sab))] md:pb-0 md:pl-[72px] lg:pl-60">{children}</main>
            <Footer />
          </div>
          <Toaster />
          <PageTranslator />
          <PwaRegister />
          <CookieBanner />
          <AppUpdate />
          <ConfirmHost />
          <ShareHost />
          <NativeLinks />
        </AuthProvider>
      </body>
    </html>
  );
}
