
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getOutfitRecommendation, type OutfitRecommendationOutput } from '@/ai/flows/outfit-recommendation';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useProductStore } from '@/hooks/use-product-store';
import ProductCard from '@/components/product-card';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { app } from '@/lib/firebase';
import { LoginDialog } from '@/components/auth/login-dialog';
import { RegisterDialog } from '@/components/auth/register-dialog';
import { Skeleton } from '@/components/ui/skeleton';

export default function RecommendationsPage() {
  const { toast } = useToast();
  const { products } = useProductStore();
  const [preferences, setPreferences] = useState('');
  const [result, setResult] = useState<OutfitRecommendationOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  
  useEffect(() => {
    const auth = getAuth(app);
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const openRegister = () => {
    setLoginOpen(false);
    setTimeout(() => setRegisterOpen(true), 150);
  };

  const openLogin = () => {
    setRegisterOpen(false);
    setTimeout(() => setLoginOpen(true), 150);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setLoginOpen(true);
      return;
    }
    if (!preferences.trim()) {
      toast({
        variant: 'destructive',
        title: 'Input Required',
        description: 'Please describe your style preferences.',
      });
      return;
    }
    if (products.length === 0) {
      toast({
        variant: 'destructive',
        title: 'No Products Available',
        description: 'There are no products in the store to make a recommendation from.',
      });
      return;
    }
    setIsLoading(true);
    setResult(null);
    try {
      const recommendation = await getOutfitRecommendation({
        userPreferences: preferences,
        products: products,
      });
      setResult(recommendation);
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to get recommendation. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const recommendedProducts = result?.outfit
    .map(recommendedItem => {
      return products.find(product => product.id === recommendedItem.id);
    })
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  return (
    <>
      <div className="container mx-auto max-w-4xl py-8 px-4 md:py-12">
        <div className="text-center mb-12">
          <Wand2 className="mx-auto h-16 w-16 mb-4 text-accent" />
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight font-headline text-primary">AI Personal Stylist</h1>
          <p className="mt-4 text-lg md:text-xl text-muted-foreground">
            Describe your style, and let our AI create the perfect outfit for you from our collection.
          </p>
        </div>

        <Card className="mb-8 shadow-lg">
          <form onSubmit={handleSubmit}>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="preferences" className="text-lg font-semibold">Your Style Preferences</Label>
                <Textarea
                  id="preferences"
                  placeholder="e.g., 'I like casual and comfortable clothes. My favorite colors are blue and grey. I'm looking for an outfit for a weekend brunch.'"
                  value={preferences}
                  onChange={(e) => setPreferences(e.target.value)}
                  className="min-h-[120px] text-base"
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={isLoading && !!user}>
                {isLoading && !!user ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-5 w-5" />
                )}
                Get My Outfit
              </Button>
            </CardContent>
          </form>
        </Card>

        {isLoading && !!user && (
          <Card>
              <CardHeader>
                  <CardTitle>Generating your outfit...</CardTitle>
                  <CardDescription>Our AI is crafting the perfect look for you.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                  <div className="space-y-2">
                      <Label>Reasoning</Label>
                      <div className="w-full h-16 bg-muted animate-pulse rounded-md"></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} className="space-y-2">
                              <div className="h-64 w-full bg-muted animate-pulse rounded-md"></div>
                              <div className="h-6 w-3/4 bg-muted animate-pulse rounded-md"></div>
                              <div className="h-4 w-1/2 bg-muted animate-pulse rounded-md"></div>
                          </div>
                      ))}
                  </div>
              </CardContent>
          </Card>
        )}

        {result && recommendedProducts && (
          <Card className="bg-gradient-to-br from-card to-secondary/50">
            <CardHeader>
              <CardTitle className="text-2xl text-primary flex items-center gap-2">
                <Sparkles /> Your AI-Generated Outfit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="font-semibold text-lg mb-2">Stylist's Reasoning</h3>
                <p className="text-muted-foreground leading-relaxed">{result.reasoning}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {recommendedProducts.map(product => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={openRegister} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={openLogin} />
    </>
  );
}
