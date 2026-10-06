
'use client';

import Link from 'next/link';
import { Twitter, Instagram, Facebook, Home, Search, Wand2, Heart, Shirt, Footprints, User, Package } from 'lucide-react';

const Logo = () => (
  <div className="flex items-center gap-2">
    <div className="h-10 w-10 flex items-center justify-center bg-primary-foreground text-primary rounded-full font-bold text-xl">
      S
    </div>
    <span className="text-2xl font-bold text-primary-foreground">Saligue</span>
  </div>
);

export default function Footer() {
  const mobileNavLinks = [
    { href: '/', label: 'Home', icon: <Home className="h-6 w-6" /> },
    { href: '/search', label: 'Search', icon: <Search className="h-6 w-6" /> },
    { href: '/recommendations', label: 'AI Stylist', icon: <Wand2 className="h-6 w-6" /> },
    { href: '/wishlist', label: 'My Saligue', icon: <Heart className="h-6 w-6" /> },
  ];

  return (
    <>
      {/* Mobile Bottom Navigation */}
      <footer className="fixed bottom-0 left-0 right-0 z-50 bg-primary border-t border-primary/20 md:hidden">
        <div className="container flex justify-around items-center h-16 px-4">
          {mobileNavLinks.map((link) => (
            <Link key={link.href} href={link.href} aria-label={link.label} className="flex flex-col items-center justify-center text-primary-foreground/80 hover:text-primary-foreground transition-colors">
              {link.icon}
            </Link>
          ))}
        </div>
      </footer>

      {/* Spacer for mobile */}
      <div className="h-16 md:hidden" />

      {/* Desktop Footer */}
      <footer className="bg-primary text-primary-foreground border-t border-primary/20 hidden md:block overflow-hidden relative">
        <div className="py-12 px-4 md:px-6">
          <div className="flex items-center justify-between relative z-10">
            <Link href="/">
              <Logo />
            </Link>
             <div className="flex gap-4">
              <Link href="#" aria-label="Twitter" className="text-primary-foreground/80 hover:text-primary-foreground transition-colors"><Twitter className="h-5 w-5" /></Link>
              <Link href="#" aria-label="Instagram" className="text-primary-foreground/80 hover:text-primary-foreground transition-colors"><Instagram className="h-5 w-5" /></Link>
              <Link href="#" aria-label="Facebook" className="text-primary-foreground/80 hover:text-primary-foreground transition-colors"><Facebook className="h-5 w-5" /></Link>
            </div>
          </div>
          
          <div className="mt-8 pt-8 border-t border-primary-foreground/20 text-center relative z-10">
            <p className="text-sm text-primary-foreground/60">&copy; {new Date().getFullYear()} Saligue Inc. All rights reserved.</p>
          </div>
        </div>

        {/* Animated Icons */}
        <div className="absolute inset-0 z-0 opacity-10">
          <Shirt className="absolute top-1/4 left-[10%] h-16 w-16 text-primary-foreground animate-float1" />
          <Footprints className="absolute top-1/2 right-[15%] h-12 w-12 text-primary-foreground animate-float2" />
          <Package className="absolute bottom-1/4 left-[20%] h-14 w-14 text-primary-foreground animate-float3" />
          <Shirt className="absolute top-1/3 right-[30%] h-20 w-20 text-primary-foreground animate-float4" />
          <Footprints className="absolute bottom-1/2 left-[45%] h-10 w-10 text-primary-foreground animate-float5" />
          <User className="absolute top-3/4 right-[40%] h-16 w-16 text-primary-foreground animate-float6" />
        </div>
      </footer>
    </>
  );
}
