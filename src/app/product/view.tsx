
'use client';

import { VerifiedBadge } from '@/components/verified-badge';

import { useT } from '@/lib/i18n';

import { ProfileAvatar, profileHref } from '@/components/profile-avatar';

import { ExpandableText } from '@/components/expandable-text';
import { FollowButton } from '@/components/follow-button';
import { noteInterest } from '@/lib/taste';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Layers, Play, ShoppingCart, Store, Shirt, Palette, Building, Info, Sparkles, Wand2, Zap, PackageCheck, PackageX, ShieldCheck, Truck } from 'lucide-react';
import ProductCard from '@/components/product-card';
import { useProductStore } from '@/hooks/use-product-store';
import { useCart } from '@/hooks/use-cart-store';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { ShopAddress } from '@/components/shop-address';
import { categoryLabel } from '@/lib/categories';
import { completeTheLook } from '@/lib/outfit';
import { useOutfitStore } from '@/hooks/use-outfit-store';
import { formatPrice } from '@/lib/orders';
import { productHref } from '@/lib/links';
import { ReportButton } from '@/components/social/report-button';
import { SoundChip } from '@/components/social/sound-chip';
import { MessageSellerButton } from '@/components/message-seller-button';
import { Reviews } from '@/components/reviews';
import { Stars } from '@/components/stars';
import { SellerAvatar } from '@/components/seller-avatar';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth/auth-provider';
import { useFeatures } from '@/lib/features';
import { addToLook } from '@/components/look-picker';
import { ProductQuestions } from '@/components/product-questions';

export default function ProductView({ id }: { id: string | null }) {
  const router = useRouter();
  const { products, isInitialized } = useProductStore();
  const { addToCart } = useCart();
  const [showVideo, setShowVideo] = useState(true);
  const { toast } = useToast();
  const t = useT();
  const { user } = useAuth();
  const on = useFeatures();
  
  const allProducts = [...products];
  const product = allProducts.find((p) => p.id === id);

  // Find related products (same category, different item, active)
  const relatedProducts = product
    ? allProducts.filter((p) => p.category === product.category && p.id !== product.id && p.status === 'active').slice(0, 4)
    : [];

  // "Complete the look": the best match in stock for each missing piece of the outfit.
  const lookItems = product && product.status === 'active'
    ? completeTheLook(allProducts, [product], 1).map((row) => row.items[0]).slice(0, 4)
    : [];
  const wearLook = () => {
    if (!product) return;
    const { restore, clear, wear } = useOutfitStore.getState();
    restore();
    clear();
    [product, ...lookItems].forEach((p) => wear(p));
    router.push('/mirror');
  };

  // Counts the visit for the seller's dashboard (once per day per shopper).
  useEffect(() => {
    if (!id) return;
    api(`/products/${id}/view`, { body: {} }).catch(() => {});
    noteInterest(id, 'view');
  }, [id]);

  // INDECIANA items are only shown on INDECIANA's own page.
  useEffect(() => {
    if (product?.official) router.replace(`/indeciana?item=${product.id}`);
  }, [product, router]);

  if (!isInitialized || product?.official) {
    return (
      <div className="container mx-auto py-8 px-4 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
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

  const soldOut = product.stock === 0;
  const handleAddToCart = async (thenCheckout = false) => {
    try {
      await addToCart(product);
      if (thenCheckout) {
        router.push('/checkout');
        return;
      }
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
        <div>
          <Card className="overflow-hidden">
            {product.video && showVideo ? (
              <video src={product.video} poster={product.videoPoster} controls autoPlay muted playsInline loop className="aspect-[3/4] w-full bg-black object-contain" />
            ) : (
              <Image
                src={product.image}
                alt={product.name}
                width={600}
                height={800}
                className="aspect-[3/4] w-full bg-muted object-contain"
                data-ai-hint={aiHint}
              />
            )}
            {product.video && (
              <div className="flex gap-2 border-t p-2">
                <button type="button" onClick={() => setShowVideo(true)} className={`flex h-14 w-14 items-center justify-center rounded-lg border-2 bg-black text-white ${showVideo ? 'border-primary' : 'border-transparent'}`} aria-label="Video"><Play className="h-6 w-6" /></button>
                <button type="button" onClick={() => setShowVideo(false)} className={`h-14 w-14 overflow-hidden rounded-lg border-2 bg-muted ${!showVideo ? 'border-primary' : 'border-transparent'}`} aria-label="Photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={product.image} alt="" className="h-full w-full object-cover" />
                </button>
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <Badge variant="outline">{categoryLabel(product.category)}{product.type ? ` · ${product.type}` : ''}</Badge>
                  <CardTitle className="text-3xl lg:text-4xl font-extrabold mt-2">{product.name}</CardTitle>
                </div>
                <div className="text-right">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <SellerAvatar src={product.sellerAvatar} name={product.shop?.name ?? product.seller} className="h-8 w-8" />
                        <span className="max-w-[9rem] truncate text-sm font-medium">{product.shop?.name ?? product.seller}</span>
                    </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {(product.ratingCount ?? 0) > 0 && (
                <a href="#reviews" className="mb-3 inline-flex items-center gap-2 text-sm hover:underline">
                  <Stars rating={product.rating ?? 0} />
                  <span className="font-semibold">{(product.rating ?? 0).toFixed(1)}</span>
                  <span className="text-muted-foreground">({product.ratingCount} {product.ratingCount === 1 ? 'review' : 'reviews'})</span>
                </a>
              )}
              <div className="flex items-center gap-2 mb-2">
                <p className="text-4xl font-bold text-primary">{formatPrice(Number(product.price))}</p>
                <SoundChip product={product} autoPlay className="ml-auto" />
                {user && on('looks') && (
                  <Button size="icon" variant="outline" className="h-10 w-10 shrink-0 rounded-full" onClick={() => addToLook({ kind: 'product', id: product.id })} aria-label={t('Add to a look')} title={t('Add to a look')}>
                    <Layers className="h-5 w-5" />
                  </Button>
                )}
              </div>
              <p className={`mb-4 flex items-center gap-1.5 text-sm font-semibold ${soldOut ? 'text-destructive' : product.stock != null && product.stock <= 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {soldOut ? <PackageX className="h-4 w-4" /> : <PackageCheck className="h-4 w-4" />}
                {soldOut ? 'Sold out' : product.stock != null && product.stock <= 3 ? `Only ${product.stock} left — order soon` : 'In stock'}
              </p>
              {product.description && <ExpandableText text={product.description} lines={3} className="text-sm text-muted-foreground" />}

              <Button size="lg" variant="secondary" className="mt-6 h-auto min-h-14 w-full whitespace-normal py-3 text-lg" asChild>
                <Link href={`/mirror?item=${product.id}`}>
                  <Wand2 className="mr-2 h-6 w-6" /> {t('Wear it')}
                </Link>
              </Button>

              <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                <Button size="lg" variant="outline" className="h-14 text-lg" onClick={() => handleAddToCart()} disabled={soldOut}>
                    <ShoppingCart className="mr-2 h-6 w-6" /> {t('Cart')}
                </Button>
                <Button size="lg" className="h-14 text-lg" onClick={() => handleAddToCart(true)} disabled={soldOut}>
                    <Zap className="mr-2 h-6 w-6" /> {t('Buy')}
                </Button>
                <MessageSellerButton product={product} size="icon" variant="secondary" className="h-14 w-14" label={`Message ${product.shop?.name ?? product.seller}`} />
              </div>
              <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5" title="Pay securely online or on delivery"><ShieldCheck className="h-4 w-4 text-primary" /> {t('Secure pay')}</span>
                <span className="flex items-center gap-1.5" title="Delivered by the shop, tracked in My orders"><Truck className="h-4 w-4 text-primary" /> {t('Tracked')}</span>
                <ReportButton product={product} iconOnly className="ml-auto" />
              </div>

            </CardContent>
          </Card>
          
          {product.shop && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-xl">
                  {product.sellerId && <ProfileAvatar id={product.sellerId} name={product.shop?.name ?? product.seller} src={product.sellerAvatar} />}
                  <Link href={product.sellerId ? profileHref(product.sellerId) : '#'} className="min-w-0 flex-1 hover:underline">{product.shop?.name ?? 'Shop'}{product.sellerVerified && <VerifiedBadge className="ml-1" />}<span className="block text-xs font-normal text-muted-foreground">View profile</span></Link>
                  <FollowButton sellerId={product.sellerId} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ShopAddress shop={product.shop} email={product.sellerEmail} hideName />
              </CardContent>
            </Card>
          )}

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
      
      {lookItems.length > 0 && (
        <Card className="mt-12">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl"><Wand2 className="h-6 w-6 text-primary" /> Complete the look</CardTitle>
            <CardDescription>Picked by AI from items in stock to go with this one.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {[product, ...lookItems].map((p, i) => (
                <div key={p.id} className="flex items-center gap-2">
                  {i > 0 && <span className="text-xl font-bold text-muted-foreground">+</span>}
                  <Link href={p.id === product.id ? '#' : productHref(p)} className="block w-24 rounded-lg border bg-muted p-1 sm:w-28">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.cutout || p.image} alt={p.name} className="aspect-square w-full object-contain" />
                    <p className="truncate px-1 text-xs font-medium">{p.name}</p>
                    <p className="px-1 text-xs font-bold text-primary">{formatPrice(Number(p.price))}</p>
                  </Link>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-sm text-muted-foreground sm:mr-auto">
                Whole look: <b className="text-foreground">{formatPrice([product, ...lookItems].reduce((sum, p) => sum + Number(p.price), 0))}</b>
              </span>
              <Button size="lg" onClick={wearLook}>
                <Wand2 className="mr-2 h-5 w-5" /> Wear the whole look
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {on('questions') && (
        <div id="questions" className="mt-12 scroll-mt-20">
          <ProductQuestions productId={product.id} sellerId={product.sellerId} />
        </div>
      )}

      <div id="reviews" className="scroll-mt-20">
        <Reviews productId={product.id} />
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
