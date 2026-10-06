
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCart } from '@/hooks/use-cart-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Trash2, ShoppingCart } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function CartPage() {
  const { cartItems, removeFromCart, updateQuantity, clearCart } = useCart();
  const { toast } = useToast();

  const subtotal = cartItems.reduce((total, item) => total + item.price * item.quantity, 0);
  const taxes = subtotal * 0.08; // Example 8% tax
  const total = subtotal + taxes;

  const handleCheckout = () => {
    // In a real app, this would redirect to a payment gateway
    toast({
        title: "Checkout Initiated",
        description: "Redirecting to payment processor...",
    });
    clearCart();
  };

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4 md:py-12">
      <div className="text-center mb-12">
        <ShoppingCart className="mx-auto h-16 w-16 mb-4 text-primary" />
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">Your Cart</h1>
        <p className="mt-4 text-lg md:text-xl text-muted-foreground">
          Review your items and proceed to checkout.
        </p>
      </div>

      {cartItems.length > 0 ? (
        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Cart Items ({cartItems.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {cartItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-4 p-4">
                      <Image
                        src={item.image}
                        alt={item.name}
                        width={80}
                        height={100}
                        className="rounded-md object-cover"
                      />
                      <div className="flex-1">
                        <Link href={`/product/${item.id}`} className="font-semibold hover:underline">
                          {item.name}
                        </Link>
                        <p className="text-sm text-muted-foreground">{item.seller}</p>
                        <p className="text-lg font-bold text-primary mt-1">${Number(item.price).toFixed(2)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateQuantity(item.id, parseInt(e.target.value, 10))}
                          className="w-16 h-9 text-center"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => removeFromCart(item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Remove</span>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          <div>
            <Card>
              <CardHeader>
                <CardTitle>Order Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Taxes (8%)</span>
                  <span>${taxes.toFixed(2)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>${total.toFixed(2)}</span>
                </div>
              </CardContent>
              <CardFooter>
                <Button size="lg" className="w-full" onClick={handleCheckout}>
                  Proceed to Checkout
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      ) : (
        <div className="text-center py-16 border-2 border-dashed rounded-lg">
          <h2 className="text-2xl font-semibold text-muted-foreground">Your cart is empty</h2>
          <p className="mt-2 text-muted-foreground">Looks like you haven't added anything yet.</p>
          <Button asChild className="mt-4">
            <Link href="/">Start Shopping</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
