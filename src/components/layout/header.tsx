
'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LayoutDashboard, Search, ShoppingCart } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Menu } from 'lucide-react';
import { LoginDialog } from '../auth/login-dialog';
import { RegisterDialog } from '../auth/register-dialog';
import React, { useState, useEffect } from 'react';
import { getAuth, onAuthStateChanged, User, signOut } from 'firebase/auth';
import { app } from '@/lib/firebase';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { useRouter } from 'next/navigation';
import { useCart } from '@/hooks/use-cart-store';
import { Badge } from '../ui/badge';


const Logo = () => (
  <div className="flex items-center gap-2">
    <div className="h-10 w-10 flex items-center justify-center bg-primary-foreground text-primary rounded-full font-bold text-xl">
      S
    </div>
    <span className="text-2xl font-bold text-primary-foreground">Saligue</span>
  </div>
);

export default function Header() {
  const { toast } = useToast();
  const router = useRouter();
  const { role, isInitialized } = useUserRoleStore();
  const { cartItems } = useCart();

  const navLinks = [
    { href: '/#mirror-my-self', label: 'Mirror My-Self' },
    { href: '/sell', label: 'Sell' },
    { href: '/recommendations', label: 'AI Stylist' },
    { href: '/try-on', label: 'Virtual Try-On' },
    { href: '/wishlist', label: 'My Saligue' },
  ];

  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const auth = getAuth(app);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, [auth]);

  const openRegister = () => {
    setLoginOpen(false);
    setTimeout(() => setRegisterOpen(true), 150);
  };

  const openLogin = () => {
    setRegisterOpen(false);
    setTimeout(() => setLoginOpen(true), 150);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast({
        title: 'Logged Out',
        description: 'You have been successfully logged out.',
      });
      window.location.href = '/';
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Logout Failed',
        description: error.message,
      });
    }
  };

  const getInitials = (name?: string | null) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('');
  };

  const dashboardPath = role === 'seller' ? '/dashboard' : '/my-account';

  return (
    <header className="sticky top-0 z-50 w-full border-b border-primary/20 bg-primary text-primary-foreground">
      <div className="flex h-20 items-center justify-between px-4">
        
        {/* Left Section: Logo */}
        <div className="flex items-center">
            <Link href="/" className="flex items-center gap-2">
              <Logo />
            </Link>
        </div>

        {/* Right Section: Nav Links and Actions */}
        <div className="hidden md:flex items-center gap-2">
          <nav className="flex items-center gap-4 text-sm font-medium">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className="transition-colors hover:text-primary-foreground/80">
                {link.label}
              </Link>
            ))}
          </nav>
            
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="hover:bg-primary-foreground/10" asChild>
                <Link href="/search">
                    <Search className="h-5 w-5" />
                    <span className="sr-only">Search</span>
                </Link>
            </Button>
            <Button variant="ghost" size="icon" className="relative hover:bg-primary-foreground/10" asChild>
                <Link href="/cart">
                {cartItems.length > 0 && <Badge variant="secondary" className="absolute -top-1 -right-1 h-4 w-4 justify-center p-0">{cartItems.length}</Badge>}
                <ShoppingCart className="h-5 w-5" />
                <span className="sr-only">Cart</span>
                </Link>
            </Button>

            {user ? (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full hover:bg-primary-foreground/10">
                    <Avatar className="h-10 w-10">
                    <AvatarImage src={user.photoURL ?? undefined} alt={user.displayName || ''} />
                    <AvatarFallback>{getInitials(user.displayName)}</AvatarFallback>
                    </Avatar>
                </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.displayName || 'User'}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <Link href={dashboardPath}>
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        <span>Dashboard</span>
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>Log out</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            ) : (
            <>
                <LoginDialog
                    open={loginOpen}
                    onOpenChange={setLoginOpen}
                    onSwitchToRegister={openRegister}
                    trigger={<Button variant="outline" className="bg-transparent border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary">Login</Button>}
                />
            </>
            )}
          </div>
        </div>


        {/* Mobile Navigation */}
        <div className="flex md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="hover:bg-primary-foreground/10">
                <Menu className="h-6 w-6" />
                <span className="sr-only">Toggle Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle className="sr-only">Mobile Menu</SheetTitle>
              </SheetHeader>
              <div className="p-4">
                <Link href="/" className="flex items-center gap-2 mb-8">
                  <Logo />
                </Link>
                <nav className="flex flex-col space-y-4">
                  {navLinks.map((link) => (
                    <Link key={link.href} href={link.href} className="text-lg transition-colors hover:text-primary">
                      {link.label}
                    </Link>
                  ))}
                  <Link href="/cart">
                    <Button variant="outline" className="w-full mt-4">
                      Cart ({cartItems.length})
                    </Button>
                  </Link>
                  {user ? (
                    <>
                      <Link href={dashboardPath}>
                        <Button className="w-full">Dashboard</Button>
                      </Link>
                      <Button variant="outline" className="w-full" onClick={handleLogout}>Log out</Button>
                    </>
                  ) : (
                    <div className="flex flex-col gap-2 mt-4">
                        <LoginDialog
                            open={loginOpen}
                            onOpenChange={setLoginOpen}
                            onSwitchToRegister={openRegister}
                            trigger={<Button className="w-full" variant="outline">Login</Button>}
                        />
                        <RegisterDialog
                            open={registerOpen}
                            onOpenChange={setRegisterOpen}
                            onSwitchToLogin={openLogin}
                            trigger={<Button className="w-full">Sign Up</Button>}
                        />
                    </div>
                  )}
                </nav>
              </div>
            </SheetContent>
          </Sheet>
        </div>
        
        {!user && (
          <>
            <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={openRegister} />
            <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={openLogin} />
          </>
        )}

      </div>
    </header>
  );
}
