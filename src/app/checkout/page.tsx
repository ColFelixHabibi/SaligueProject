
'use client';

import { friendlyError } from '@/lib/errors';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Lock, MapPin, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { LoginDialog } from '@/components/auth/login-dialog';
import { RegisterDialog } from '@/components/auth/register-dialog';
import { useAuth } from '@/components/auth/auth-provider';
import { useCart } from '@/hooks/use-cart-store';
import { useToast } from '@/hooks/use-toast';
import { PAYMENT_METHODS, formatPrice, placeOrders } from '@/lib/orders';
import { auth } from '@/lib/firebase';
import type { DeliveryAddress, PaymentMethod } from '@/lib/types';

const DELIVERY_KEY = 'saligue-delivery-address';

const FIELDS: { id: keyof DeliveryAddress; label: string; placeholder: string; required?: boolean; wide?: boolean }[] = [
  { id: 'fullName', label: 'Full name', placeholder: 'Your name', required: true },
  { id: 'phone', label: 'Phone', placeholder: '+250 788 000 000', required: true },
  { id: 'country', label: 'Country', placeholder: 'Rwanda', required: true },
  { id: 'city', label: 'City / Town', placeholder: 'Kigali', required: true },
  { id: 'district', label: 'District / Sector', placeholder: 'Gasabo, Kimironko', wide: true },
  { id: 'street', label: 'Street, house number', placeholder: 'KG 11 Ave, house 25', required: true, wide: true },
  { id: 'landmark', label: 'Nearby landmark', placeholder: 'Behind the market', wide: true },
];

export default function CheckoutPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { cartItems, clearCart } = useCart();
  const [delivery, setDelivery] = useState<DeliveryAddress>({ fullName: '', phone: '', country: 'Rwanda', city: '', street: '' });
  const [payment, setPayment] = useState<PaymentMethod>('mobile_money');
  const [placing, setPlacing] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  // Remember the last delivery address on this device.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DELIVERY_KEY) || 'null');
      if (saved) setDelivery((d) => ({ ...d, ...saved }));
    } catch {
      // Nothing saved.
    }
  }, []);
  useEffect(() => {
    if (user?.displayName) setDelivery((d) => (d.fullName ? d : { ...d, fullName: user.displayName! }));
  }, [user]);

  const shops = useMemo(() => {
    const groups = new Map<string, typeof cartItems>();
    cartItems.forEach((item) => {
      const key = item.sellerId ?? 'unknown';
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return [...groups.values()];
  }, [cartItems]);
  const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    // Guests can order too: they have a silent guest account, and their orders show under "My orders".
    if (!auth.currentUser) {
      toast({ variant: 'destructive', title: 'One moment', description: 'Still connecting. Please try again.' });
      return;
    }
    setPlacing(true);
    try {
      await placeOrders(cartItems, delivery, payment);
      try {
        localStorage.setItem(DELIVERY_KEY, JSON.stringify(delivery));
      } catch {
        // Ignore.
      }
      await clearCart();
      toast({ title: 'Order placed!', description: shops.length > 1 ? `${shops.length} shops have received your order.` : 'The shop has received your order.' });
      router.push('/orders');
    } catch (error: any) {
      console.error('Placing order failed:', error);
      toast({ variant: 'destructive', title: 'Could not place order', description: friendlyError(error) });
    } finally {
      setPlacing(false);
    }
  };

  if (cartItems.length === 0) {
    return (
      <div className="container mx-auto max-w-xl px-4 py-16 text-center">
        <ShoppingBag className="mx-auto mb-4 h-14 w-14 text-primary" />
        <h1 className="text-3xl font-bold">Your cart is empty</h1>
        <Button asChild className="mt-6"><Link href="/">Start Shopping</Link></Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 md:py-12">
      <h1 className="mb-8 text-center text-4xl font-extrabold tracking-tight">Checkout</h1>
      <form onSubmit={handlePlaceOrder} className="grid gap-8 md:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" /> Delivery address</CardTitle>
              <CardDescription>Where should the shop bring your order?</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.id} className={f.wide ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
                  <Label htmlFor={`delivery-${f.id}`}>{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
                  <Input
                    id={`delivery-${f.id}`}
                    value={delivery[f.id] ?? ''}
                    onChange={(e) => setDelivery((d) => ({ ...d, [f.id]: e.target.value }))}
                    placeholder={f.placeholder}
                    required={f.required}
                  />
                </div>
              ))}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="delivery-notes">Notes for the shop</Label>
                <Textarea
                  id="delivery-notes"
                  value={delivery.notes ?? ''}
                  onChange={(e) => setDelivery((d) => ({ ...d, notes: e.target.value }))}
                  placeholder="Size questions, best time to deliver…"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardContent>
              <RadioGroup value={payment} onValueChange={(v) => setPayment(v as PaymentMethod)} className="space-y-3">
                {PAYMENT_METHODS.map((m) => (
                  <Label key={m.value} htmlFor={`pay-${m.value}`} className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 has-[:checked]:border-primary">
                    <RadioGroupItem id={`pay-${m.value}`} value={m.value} className="mt-0.5" />
                    <span>
                      <span className="block font-semibold">{m.label}</span>
                      <span className="block text-sm font-normal text-muted-foreground">{m.description}</span>
                    </span>
                  </Label>
                ))}
                <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 opacity-60">
                  <Lock className="mt-0.5 h-4 w-4" />
                  <span>
                    <span className="block font-semibold">Card payment</span>
                    <span className="block text-sm text-muted-foreground">Coming soon.</span>
                  </span>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="md:sticky md:top-24">
            <CardHeader>
              <CardTitle>Order summary</CardTitle>
              {shops.length > 1 && <CardDescription>Items from {shops.length} shops — each shop gets its own order.</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-4">
              {shops.map((items) => (
                <div key={items[0].sellerId ?? items[0].id} className="space-y-2">
                  <p className="text-sm font-semibold text-primary">{items[0].shop?.name ?? items[0].seller}</p>
                  {items.map((item) => (
                    <div key={item.id} className="flex justify-between gap-2 text-sm">
                      <span className="truncate">{item.quantity} × {item.name}</span>
                      <span className="shrink-0">{formatPrice(item.price * item.quantity)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>{formatPrice(total)}</span>
              </div>
              <p className="text-xs text-muted-foreground">Delivery cost, if any, is agreed with the shop.</p>
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Button type="submit" size="lg" className="w-full" disabled={placing}>
                {placing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Place order
              </Button>
              {!user && (
                <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setLoginOpen(true)}>
                  Have an account? <span className="font-semibold text-primary">Log in</span> (optional)
                </button>
              )}
            </CardFooter>
          </Card>
        </div>
      </form>
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={() => { setLoginOpen(false); setTimeout(() => setRegisterOpen(true), 150); }} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={() => { setRegisterOpen(false); setTimeout(() => setLoginOpen(true), 150); }} />
    </div>
  );
}
