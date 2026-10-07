
'use client';

import Link from 'next/link';
import { Download, Navigation, ShoppingCart, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ContactButtons } from '@/components/contact-buttons';
import { useCart } from '@/hooks/use-cart-store';
import { useToast } from '@/hooks/use-toast';
import { categoryLabel } from '@/lib/categories';
import { friendlyError } from '@/lib/errors';
import { productHref } from '@/lib/links';
import { formatPrice } from '@/lib/orders';
import { shopAddressLines, type Product } from '@/lib/types';

/** The chosen look, with the item's shop on a map, directions and contacts. */
export function LocateSellerDialog({ product, image, onClose }: { product: Product; image: string; onClose: () => void }) {
  const { toast } = useToast();
  const { addToCart } = useCart();
  const shop = product.shop;
  const place = shop ? [shop.name, ...shopAddressLines(shop)].join(', ') : '';
  // Google Maps' public embed and directions links need no key.
  const mapSrc = shop ? `https://maps.google.com/maps?q=${encodeURIComponent(place)}&z=15&output=embed` : '';
  const directions = shop
    ? shop.mapUrl || `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place)}`
    : '';

  const add = async () => {
    try {
      await addToCart(product);
      toast({ title: 'Added to cart', description: product.name });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Try again', description: friendlyError(error) });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-3xl">
        <div className="grid md:grid-cols-2">
          <div className="relative bg-gradient-to-b from-muted to-background">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt={`You wearing ${product.name}`} className="mx-auto max-h-[55vh] w-full object-contain p-3 md:max-h-[80vh]" />
            <Button variant="outline" size="sm" className="absolute bottom-3 left-3" asChild>
              <a href={image} download={`saligue-${product.name.replace(/\W+/g, '-').toLowerCase()}.png`}>
                <Download className="mr-1.5 h-4 w-4" /> Save look
              </a>
            </Button>
          </div>

          <div className="space-y-4 p-5">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="text-2xl">{product.name}</DialogTitle>
              <DialogDescription>
                {categoryLabel(product.category)}
                {product.size ? ` · Size ${product.size}` : ''}
                {product.color ? ` · ${product.color}` : ''}
                {product.brand ? ` · ${product.brand}` : ''}
              </DialogDescription>
            </DialogHeader>
            <p className="text-3xl font-extrabold text-primary">{formatPrice(Number(product.price))}</p>

            <div className="grid grid-cols-2 gap-2">
              <Button onClick={add}>
                <ShoppingCart className="mr-2 h-4 w-4" /> Add to cart
              </Button>
              <Button variant="outline" asChild>
                <Link href={productHref(product)}>View item</Link>
              </Button>
            </div>

            <div className="space-y-3 border-t pt-4">
              <p className="flex items-center gap-2 font-semibold">
                <Store className="h-4 w-4 text-primary" /> {shop?.name ?? product.seller}
              </p>
              {shop ? (
                <>
                  <p className="text-sm text-muted-foreground">{shopAddressLines(shop).join(' · ')}</p>
                  {shop.hours && <p className="text-sm text-muted-foreground">Open: {shop.hours}</p>}
                  <iframe
                    title={`Map of ${shop.name}`}
                    src={mapSrc}
                    className="h-48 w-full rounded-lg border"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                  <Button className="w-full" variant="secondary" asChild>
                    <a href={directions} target="_blank" rel="noopener noreferrer">
                      <Navigation className="mr-2 h-4 w-4" /> Directions to the shop
                    </a>
                  </Button>
                  <ContactButtons contact={[shop.phone, shop.whatsapp].filter(Boolean).join(' ')} email={product.sellerEmail} />
                </>
              ) : (
                <ContactButtons contact={product.contact} email={product.sellerEmail} />
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
