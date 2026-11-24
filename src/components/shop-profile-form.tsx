
'use client';

import { Textarea } from '@/components/ui/textarea';

import { friendlyError } from '@/lib/errors';

import { useEffect, useState } from 'react';
import { Loader2, MapPin, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { updateAccount } from '@/lib/auth-actions';
import { useProductStore } from '@/hooks/use-product-store';
import { isShopComplete, type Shop } from '@/lib/types';

const EMPTY: Shop = { name: '', phone: '', whatsapp: '', country: 'Rwanda', city: '', district: '', street: '', landmark: '', mapUrl: '', hours: '', bio: '' };

const FIELDS: { id: keyof Shop; label: string; placeholder: string; required?: boolean; wide?: boolean }[] = [
  { id: 'name', label: 'Shop name', placeholder: 'e.g. Kigali Style House', required: true, wide: true },
  { id: 'phone', label: 'Phone', placeholder: '+250 788 000 000', required: true },
  { id: 'whatsapp', label: 'WhatsApp (if different)', placeholder: '+250 788 000 000' },
  { id: 'country', label: 'Country', placeholder: 'Rwanda', required: true },
  { id: 'city', label: 'City / Town', placeholder: 'Kigali', required: true },
  { id: 'district', label: 'District / Sector', placeholder: 'Nyarugenge, Nyamirambo' },
  { id: 'street', label: 'Street and building', placeholder: 'KN 2 St, Building 12, 1st floor, shop 4', required: true, wide: true },
  { id: 'landmark', label: 'Nearby landmark', placeholder: 'Opposite the bus station', wide: true },
  { id: 'mapUrl', label: 'Google Maps link', placeholder: 'https://maps.google.com/…', wide: true },
  { id: 'hours', label: 'Opening hours', placeholder: 'Mon–Sat 8:00–20:00', wide: true },
];

/**
 * How the shop gets paid (src/lib/orders.ts): buyers send the money straight to these. Leaving one empty simply
 * means that way to pay is not offered to buyers, so a shop that only takes MTN MoMo fills in only that.
 */
const PAY_FIELDS: { id: keyof Shop; label: string; placeholder: string; wide?: boolean }[] = [
  { id: 'momoNumber', label: 'MTN MoMo number', placeholder: '+250 788 000 000' },
  { id: 'momoName', label: 'Name on the MoMo number', placeholder: 'The name it is registered to' },
  { id: 'airtelNumber', label: 'Airtel Money number', placeholder: '+250 730 000 000' },
  { id: 'airtelName', label: 'Name on the Airtel number', placeholder: 'The name it is registered to' },
  { id: 'paypalEmail', label: 'PayPal address', placeholder: 'you@example.com', wide: true },
  { id: 'bankName', label: 'Bank name', placeholder: 'Ecobank' },
  { id: 'bankAccountName', label: 'Name on the account', placeholder: 'Your shop or your own name' },
  { id: 'bankAccountNumber', label: 'Account number / IBAN', placeholder: 'For a transfer from abroad, the IBAN', wide: true },
  { id: 'bankSwift', label: 'SWIFT / BIC', placeholder: 'For transfers from other countries' },
];

function compact(shop: Shop): Shop {
  return Object.fromEntries(Object.entries(shop).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v)) as Shop;
}

/** The seller's shop name and full address, copied onto every item they list. */
export function ShopProfileForm() {
  const { toast } = useToast();
  const savedShop = useUserRoleStore((s) => s.shop);
  const [shop, setShop] = useState<Shop>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (savedShop) setShop({ ...EMPTY, ...savedShop });
  }, [savedShop]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = compact(shop);
    if (!isShopComplete(cleaned)) {
      toast({ variant: 'destructive', title: 'Missing details', description: 'Shop name, phone, country, city and street are required.' });
      return;
    }
    setSaving(true);
    try {
      // The server also updates the address on already-listed items.
      await updateAccount({ shop: cleaned });
      useUserRoleStore.setState({ shop: cleaned });
      const count = useProductStore.getState().products.filter((p) => p.shop?.name === cleaned.name).length;
      toast({ title: 'Shop saved', description: `Your address is shown on ${count} item${count === 1 ? '' : 's'}.` });
    } catch (error: any) {
      console.error('Failed to save shop:', error);
      toast({ variant: 'destructive', title: 'Could not save', description: friendlyError(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="shop">
      <form onSubmit={handleSave}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" /> Shop & full address</CardTitle>
          <CardDescription>Buyers see this on every item you sell, so they can find, call or visit your shop.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.id} className={f.wide ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
              <Label htmlFor={`shop-${f.id}`}>{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
              <Input
                id={`shop-${f.id}`}
                value={shop[f.id] ?? ''}
                onChange={(e) => setShop((prev) => ({ ...prev, [f.id]: e.target.value }))}
                placeholder={f.placeholder}
                required={f.required}
              />
            </div>
          ))}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="shop-bio">Shop description <span className="font-normal text-muted-foreground">(bio on your profile)</span></Label>
            <Textarea id="shop-bio" rows={3} maxLength={300} value={shop.bio ?? ''} onChange={(e) => setShop((prev) => ({ ...prev, bio: e.target.value }))} placeholder="What you sell, your style, delivery…" />
          </div>

          <div className="space-y-1 border-t pt-4 sm:col-span-2">
            <h3 className="flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4 text-primary" /> How you get paid</h3>
            <p className="text-sm text-muted-foreground">
              Buyers send the money straight to you by MTN MoMo, Airtel Money, PayPal or bank transfer (Ecobank and other
              banks, local or international), then add the transaction ID on their order and you confirm it. A way to pay
              appears at checkout only once its details are filled in, so leave empty what you do not accept.
            </p>
          </div>
          {PAY_FIELDS.map((f) => (
            <div key={f.id} className={f.wide ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
              <Label htmlFor={`shop-${f.id}`}>{f.label}</Label>
              <Input
                id={`shop-${f.id}`}
                value={shop[f.id] ?? ''}
                onChange={(e) => setShop((prev) => ({ ...prev, [f.id]: e.target.value }))}
                placeholder={f.placeholder}
                inputMode={f.id === 'paypalEmail' ? 'email' : 'text'}
              />
            </div>
          ))}
        </CardContent>
        <CardFooter className="border-t px-6 py-4">
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save shop
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
