
'use client';

import { friendlyError } from '@/lib/errors';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreditCard, Loader2, Lock, MapPin, ShieldCheck, ShoppingBag } from 'lucide-react';
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
import { PAYMENT_METHODS, checkoutMethods, formatPrice, payOnline, paymentDetailForm, placeOrders, usePaymentConfig } from '@/lib/orders';
import { PaymentDetailsForm } from '@/components/payment-details-form';
import type { DeliveryAddress, PaymentDetails, PaymentMethod } from '@/lib/types';

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
  const { user, authUid } = useAuth();
  const { cartItems, clearCart } = useCart();
  const [delivery, setDelivery] = useState<DeliveryAddress>({ fullName: '', phone: '', country: 'Rwanda', city: '', street: '' });
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  // What the buyer fills in to pay the shop by hand (MoMo, Airtel, PayPal, bank): the number or address the money
  // comes from, and the transaction ID once they have paid.
  const [payDetails, setPayDetails] = useState<PaymentDetails>({});
  const [email, setEmail] = useState('');
  const payConfig = usePaymentConfig();
  const soldOut = cartItems.filter((i) => i.stock != null && i.quantity > i.stock);
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
  // A way to pay by hand shows up only when every shop in the bag has added the details it needs (its MoMo,
  // Airtel, PayPal or bank details), so no shopper is sent to an account that does not exist.
  const methods = checkoutMethods(shops.map((items) => items[0].shop), !!payConfig?.enabled);
  // Nothing chosen yet means the first way offered: paying online when it is switched on, else MoMo and the rest.
  const chosen = PAYMENT_METHODS.find((m) => m.value === payment) ?? methods[0];

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    // Checkout needs an account, so orders, receipts and delivery updates reach the shopper.
    if (!user) {
      setLoginOpen(true);
      return;
    }
    if (!authUid) {
      toast({ variant: 'destructive', title: 'One moment', description: 'Still connecting. Please try again.' });
      return;
    }
    if (soldOut.length) {
      toast({ variant: 'destructive', title: 'Not enough in stock', description: `Lower the quantity of ${soldOut.map((i) => i.name).join(', ')} in your cart.` });
      return;
    }
    setPlacing(true);
    try {
      // Only the answers for the way that was finally chosen: another way's answers never travel with the order.
      const ids = await placeOrders(cartItems, delivery, chosen.value, chosen.form ? paymentDetailForm(chosen.form, payDetails) : undefined);
      try {
        localStorage.setItem(DELIVERY_KEY, JSON.stringify(delivery));
      } catch {
        // Ignore.
      }
      await clearCart();
      if (chosen.value === 'online') {
        toast({ title: 'Order reserved', description: 'Taking you to the secure payment page…' });
        try {
          await payOnline(ids, user?.email ? undefined : email);
          return;
        } catch (error) {
          toast({ variant: 'destructive', title: 'Payment page did not open', description: `${friendlyError(error)} Your order is saved: pay from My orders.` });
          router.push('/orders');
          return;
        }
      }
      toast({ title: 'Order placed!', description: shops.length > 1 ? `${shops.length} shops have received your order.` : 'The shop has received your order.' });
      router.push('/orders');
    } catch (error: any) {
      console.error('Placing order failed:', error);
      toast({ variant: 'destructive', title: 'Could not place order', description: friendlyError(error) });
    } finally {
      setPlacing(false);
    }
  };

  // Not signed in: one clear step before the form (the bag is kept and joins the account).
  if (!user && cartItems.length > 0) {
    return (
      <div className="container mx-auto max-w-md px-4 py-16 text-center">
        <Lock className="mx-auto mb-4 h-12 w-12 text-primary" />
        <h1 className="text-2xl font-extrabold">Log in to check out</h1>
        <p className="mt-2 text-muted-foreground">Your bag ({cartItems.length} {cartItems.length === 1 ? 'item' : 'items'}) is kept.</p>
        <div className="mt-6 grid gap-2">
          <Button size="lg" onClick={() => setRegisterOpen(true)}>Create account</Button>
          <Button size="lg" variant="outline" onClick={() => setLoginOpen(true)}>Log in</Button>
        </div>
        <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={() => { setLoginOpen(false); setTimeout(() => setRegisterOpen(true), 150); }} />
        <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={() => { setRegisterOpen(false); setTimeout(() => setLoginOpen(true), 150); }} />
      </div>
    );
  }

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
              <RadioGroup value={payment ?? chosen.value} onValueChange={(v) => setPayment(v as PaymentMethod)} className="space-y-3">
                {methods.map((m) => (
                  <Label key={m.value} htmlFor={`pay-${m.value}`} className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 has-[:checked]:border-primary">
                    <RadioGroupItem id={`pay-${m.value}`} value={m.value} className="mt-0.5" />
                    <span>
                      <span className="block font-semibold">{m.label}</span>
                      <span className="block text-sm font-normal text-muted-foreground">{m.description}</span>
                    </span>
                  </Label>
                ))}
                {payConfig && !payConfig.enabled && (
                  <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 opacity-60">
                    <CreditCard className="mt-0.5 h-4 w-4" />
                    <span>
                      <span className="block font-semibold">Card payment</span>
                      <span className="block text-sm text-muted-foreground">Coming soon.</span>
                    </span>
                  </div>
                )}
                {chosen.value === 'online' && (
                  <div className="space-y-3 rounded-lg bg-muted/60 p-4 text-sm">
                    <p className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4 text-emerald-600" /> You pay on Flutterwave&apos;s secure page. Saligue never sees your card.</p>
                    {payConfig && payConfig.currency !== 'USD' && (
                      <p className="text-muted-foreground">Charged in {payConfig.currency}: about <b className="text-foreground">{Math.ceil(total * payConfig.rate).toLocaleString()} {payConfig.currency}</b>.</p>
                    )}
                    {!user?.email && (
                      <div className="space-y-1.5">
                        <Label htmlFor="pay-email">Email for your receipt <span className="text-destructive">*</span></Label>
                        <Input id="pay-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                      </div>
                    )}
                  </div>
                )}
                {chosen.form && (
                  <div className="space-y-3 rounded-lg bg-muted/60 p-4">
                    <p className="text-sm font-medium">Your payment details</p>
                    <p className="text-xs text-muted-foreground">
                      The shop uses these to find your money, so it can confirm your order. Add the transaction ID now, or on the order once you have paid.
                    </p>
                    <PaymentDetailsForm form={chosen.form} value={payDetails} onChange={setPayDetails} idPrefix="checkout-pay" />
                  </div>
                )}
              </RadioGroup>
              {!methods.some((m) => m.value === 'paypal' || m.value === 'bank_transfer') && (
                <p className="mt-3 text-xs text-muted-foreground">
                  MTN MoMo, Airtel Money, PayPal and bank transfer (Ecobank and other banks, local or international)
                  appear here once the shop adds those details to its settings.
                </p>
              )}
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
                {placing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />} {chosen.value === 'online' ? `Pay ${formatPrice(total)} now` : 'Place order'}
              </Button>

            </CardFooter>
          </Card>
        </div>
      </form>
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={() => { setLoginOpen(false); setTimeout(() => setRegisterOpen(true), 150); }} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={() => { setRegisterOpen(false); setTimeout(() => setLoginOpen(true), 150); }} />
    </div>
  );
}
