
'use client';

import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { app } from '@/lib/firebase';
import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { useWishlist } from '@/hooks/use-wishlist';
import { useCart } from '@/hooks/use-cart-store';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '../ui/skeleton';

interface AuthContextType {
  user: User | null;
  role: 'seller' | 'buyer';
  isAuthLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: 'buyer',
  isAuthLoading: true,
});

const auth = getAuth(app);

function FullPageLoader() {
    return (
        <div className="flex min-h-screen w-full flex-col">
            <header className="sticky top-0 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6">
                <Skeleton className="h-8 w-32" />
                <div className="flex-1"></div>
                <Skeleton className="h-8 w-8 rounded-full" />
            </header>
            <main className="flex-1 p-8">
                <div className="flex flex-col space-y-3">
                    <Skeleton className="h-[125px] w-full rounded-xl" />
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-[250px]" />
                        <Skeleton className="h-4 w-[200px]" />
                    </div>
                </div>
            </main>
        </div>
    );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const { role, isInitialized: isRoleInitialized } = useUserRoleStore();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        const storageSuffix = currentUser ? currentUser.uid : 'anonymous';
        
        useUserRoleStore.persist.setOptions({ name: `user-role-storage-${storageSuffix}` });
        useWishlist.persist.setOptions({ name: `wishlist-storage-${storageSuffix}` });
        useCart.persist.setOptions({ name: `cart-storage-${storageSuffix}` });

        await Promise.all([
            useUserRoleStore.persist.rehydrate(),
            useWishlist.persist.rehydrate(),
            useCart.persist.rehydrate(),
        ]);
        
        if (currentUser) {
           const currentRole = useUserRoleStore.getState().role;
           const isNewUser = currentUser.metadata.creationTime === currentUser.metadata.lastSignInTime;

            if (isNewUser) {
                 toast({
                    title: 'Account Created!',
                    description: `Welcome! You are signed up as a ${currentRole}.`,
                });
            } else {
                toast({
                    title: 'Login Successful!',
                    description: `Welcome back, ${currentUser.displayName}! You are logged in as a ${currentRole}.`,
                });
            }
          
          const dashboardPath = currentRole === 'seller' ? '/dashboard' : '/my-account';
          router.replace(dashboardPath);
        }

        setUser(currentUser);
        setIsAuthLoading(false);
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalIsLoading = isAuthLoading || !isRoleInitialized;

  const value = {
    user,
    role,
    isAuthLoading: finalIsLoading,
  };
  
  if (finalIsLoading) {
    return <FullPageLoader />;
  }

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
