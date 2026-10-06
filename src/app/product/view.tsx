
'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DollarSign, MessageSquare, Store, Mail, Phone, ShoppingCart, Shirt, Palette, Building, Info, Sparkles, Wand2 } from 'lucide-react';
import ProductCard from '@/components/product-card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useProductStore } from '@/hooks/use-product-store';
import { useCart } from '@/hooks/use-cart-store';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { ContactButtons } from '@/components/contact-buttons';
import { categoryLabel } from '@/lib/categories';

export default function ProductView({ id }: { id: string | null }) {
  const { products, isInitialized } = useProductStore();
  const { addToCart } = useCart();
  const { toast } = useToast();
  
  const allProducts = [...products];
  const product = allProducts.find((p) => p.id === id);

  // Find related products (same category, different item, active)
  const relatedProducts = product
    ? allProducts.filter((p) => p.category === product.category && p.id !== product.id && p.status === 'active').slice(0, 4)
    : [];

  if (!isInitialized) {
    return (
      <div className="container mx-auto py-8 px-4 md:py-12">
        <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
          <Skeleton className="w-full aspect-[3/4]" />
          <div className="space-y-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!product || product.status === 'archived') {
    return (
      <div className="container mx-auto py-8 px-4 md:py-12 text-center">
        <h1 className="text-2xl font-bold">Product not found</h1>
        <p className="text-muted-foreground">This product may have been archived or does not exist.</p>
      </div>
    );
  }

  const handleAddToCart = async () => {
    try {
      await addToCart(product);
      toast({
        title: "Added to Cart",
        description: `${product.name} has been added to your cart.`,
      });
    } catch (error) {
      console.error('Failed to add to cart:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not add this item to your cart.' });
    }
  };

  const aiHint = product.name.toLowerCase().split(' ').slice(0, 2).join(' ');

  const productDetails = [
    { label: 'Size', value: product.size, icon: <Shirt className="h-5 w-5 text-primary" /> },
    { label: 'Color', value: product.color, icon: <Palette className="h-5 w-5 text-primary" /> },
    { label: 'Brand', value: product.brand, icon: <Building className="h-5 w-5 text-primary" /> },
    { label: 'Condition', value: product.condition, icon: <Info className="h-5 w-5 text-primary" /> },
  ].filter(detail => detail.value);

  return (
    <div className="container mx-auto py-8 px-4 md:py-12">
      <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
        <div>
          <Card className="overflow-hidden">
            <Image
              src={product.image}
              alt={product.name}
              width={600}
              height={800}
              className="object-cover w-full aspect-[3/4]"
              data-ai-hint={aiHint}
            />
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <Badge variant="outline">{categoryLabel(product.category)}</Badge>
                  <CardTitle className="text-3xl lg:text-4xl font-extrabold mt-2">{product.name}</CardTitle>
                </div>
                <div className="text-right">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Store className="h-5 w-5" />
                        <span>{product.seller}</span>
                    </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="h-7 w-7 text-primary" />
                <p className="text-4xl font-bold text-primary">${Number(product.price).toFixed(2)}</p>
              </div>
              <CardDescription>
                {product.description || `This is a high-quality ${product.name} from ${product.seller}. Perfect for any occasion and crafted with the finest materials.`}
              </CardDescription>

              <Button size="lg" variant="secondary" className="w-full text-lg h-14 mt-6" asChild>
                <Link href={`/mirror?item=${product.id}`}>
                  <Wand2 className="mr-2 h-6 w-6" /> Try it on — see yourself wearing it
                </Link>
              </Button>

              <div className="flex flex-col sm:flex-row gap-2 mt-2">
                <Button size="lg" className="w-full sm:w-1/2 text-lg h-14" onClick={handleAddToCart}>
                    <ShoppingCart className="mr-2 h-6 w-6" /> Add to Cart
                </Button>
                <Dialog>
                  <DialogTrigger asChild>
                      <Button size="lg" className="w-full sm:w-1/2 text-lg h-14">
                          <MessageSquare className="h-6 w-6" /> Contact Seller
                      </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-card w-[90vw] max-w-md">
                    <DialogHeader>
                      <DialogTitle className="text-2xl text-center">Seller Information</DialogTitle>
                      <DialogDescription className="text-center">
                        Contact the seller directly to purchase this item.
                      </DialogDescription>
                    </DialogHeader>
                    <Separator />
                    <div className="flex flex-col items-center gap-4 py-4">
                      <Avatar className="h-20 w-20">
                        <AvatarImage src={`https://i.pravatar.cc/150?u=${product.seller}`} alt={product.seller} />
                        <AvatarFallback>{product.seller.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <p className="text-xl font-bold">{product.seller}</p>
                    </div>
                    <div className="space-y-3">
                        <div className="flex items-center gap-4">
                          <Mail className="h-5 w-5 text-muted-foreground" />
                          <span className="font-medium break-all">{product.sellerEmail || 'Not provided'}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <Phone className="h-5 w-5 text-muted-foreground" />
                          <span className="font-medium">{product.contact || 'Not provided'}</span>
                        </div>
                        <ContactButtons contact={product.contact} email={product.sellerEmail} className="pt-2 justify-center" />
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

            </CardContent>
          </Card>
          
          {productDetails.length > 0 && (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-xl"><Sparkles className="h-5 w-5 text-accent"/> Product Details</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                        {productDetails.map((detail) => (
                            <div key={detail.label} className="flex items-center gap-3 bg-muted/50 p-3 rounded-lg">
                                {detail.icon}
                                <div>
                                    <p className="text-sm text-muted-foreground">{detail.label}</p>
                                    <p className="font-semibold">{detail.value}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
          )}

        </div>
      </div>
      
      {relatedProducts.length > 0 && (
        <div className="mt-16">
          <h2 className="text-3xl font-bold text-center mb-8">Related Products</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {relatedProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
