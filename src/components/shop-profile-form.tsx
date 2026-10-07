
'use client';

import { friendlyError } from '@/lib/errors';

import { useEffect, useState } from 'react';
import { collection, doc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { auth, db } from '@/lib/firebase';
import { isShopComplete, type Shop } from '@/lib/types';

const EMPTY: Shop = { name: '', phone: '', whatsapp: '', country: 'Rwanda', city: '', district: '', street: '', landmark: '', mapUrl: '', hours: '' };

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

// Firestore rejects undefined; store empty optional fields as absent.
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
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const cleaned = compact(shop);
    if (!isShopComplete(cleaned)) {
      toast({ variant: 'destructive', title: 'Missing details', description: 'Shop name, phone, country, city and street are required.' });
      return;
    }
    setSaving(true);
    try {
      await setDoc(doc(db, 'users', uid), { shop: cleaned }, { merge: true });
      // Keep the address on already-listed items up to date.
      const mine = await getDocs(query(collection(db, 'products'), where('sellerId', '==', uid)));
      const batch = writeBatch(db);
      mine.docs.forEach((d) => batch.update(d.ref, { shop: cleaned }));
      if (!mine.empty) await batch.commit();
      useUserRoleStore.setState({ shop: cleaned });
      toast({ title: 'Shop saved', description: `Your address is shown on ${mine.size} item${mine.size === 1 ? '' : 's'}.` });
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
