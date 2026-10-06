
'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useWishlist } from '@/hooks/use-wishlist';
import ProductCard from '@/components/product-card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { app } from '@/lib/firebase';
import React, { useState, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Heart, ShoppingBag } from 'lucide-react';


export default function BuyerDashboardPage() {
  const { wishlistItems } = useWishlist();
  const [user, setUser] = useState<User | null>(null);
  
  useEffect(() => {
    const auth = getAuth(app);
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const getInitials = (name?: string | null) => {
    if (!name) return 'U';
    return name.split(' ').map((n) => n[0]).join('');
  };

  const recentWishlist = wishlistItems.slice(0, 4);

  return (
    <div className="flex flex-col gap-6">
       <Card>
          <CardHeader className="flex flex-row items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={user?.photoURL ?? undefined} alt="User avatar" />
                <AvatarFallback>{getInitials(user?.displayName)}</AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-2xl">Welcome, {user?.displayName || 'User'}!</CardTitle>
                <CardDescription>This is your personal dashboard.</CardDescription>
              </div>
          </CardHeader>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
         <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg">My Saligue</CardTitle>
            <Heart className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{wishlistItems.length} items</div>
            <p className="text-xs text-muted-foreground">Your favorite fashion finds.</p>
          </CardContent>
        </Card>
         <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg">Purchase History</CardTitle>
            <ShoppingBag className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">0 items</div>
            <p className="text-xs text-muted-foreground">You haven't purchased anything yet.</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
            <div className="flex items-center justify-between">
                <div>
                    <CardTitle>Recently Favorited</CardTitle>
                    <CardDescription>Your latest additions to My Saligue.</CardDescription>
                </div>
                {wishlistItems.length > 0 && (
                    <Button asChild variant="outline">
                        <Link href="/wishlist">View All</Link>
                    </Button>
                )}
            </div>
        </CardHeader>
        <CardContent>
            {recentWishlist.length > 0 ? (
                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {recentWishlist.map((product) => (
                        <ProductCard key={product.id} product={product} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-10 border-2 border-dashed rounded-lg">
                    <h3 className="text-lg font-semibold">Nothing here yet!</h3>
                    <p className="text-sm text-muted-foreground">Start exploring and add items to your wishlist.</p>
                     <Button asChild className="mt-4">
                        <Link href="/">Mirror My-Self</Link>
                    </Button>
                </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
