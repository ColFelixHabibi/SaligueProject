'use client';

import { useEffect, useState } from 'react';
import { Loader2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { BRAND_DEFAULTS, useBrand, type Brand } from '@/lib/brand';
import { friendlyError } from '@/lib/errors';

/**
 * Admin → Rules & policies: the About texts of Saligue (/about) and INDECIANA (/indeciana). Saligue is made by
 * INDECIANA. An empty field goes back to the default text.
 */
export function BrandAdmin() {
  const { toast } = useToast();
  const [brand, setBrand] = useBrand();
  const [form, setForm] = useState<Brand>(BRAND_DEFAULTS);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(brand), [brand]);
  const set = <W extends keyof Brand>(who: W, field: keyof Brand[W], value: string) => setForm((f) => ({ ...f, [who]: { ...f[who], [field]: value } }));
  const save = async () => {
    setBusy(true);
    try {
      setBrand(await api<Brand>('/admin/brand', { method: 'PUT', body: form }));
      toast({ title: 'About texts saved' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not saved', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };
  const field = (id: string, label: string, value: string, onChange: (v: string) => void, max: number, long = false) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {long
        ? <Textarea id={id} rows={4} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
        : <Input id={id} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PenLine className="h-5 w-5 text-primary" /> About Saligue and INDECIANA</CardTitle>
        <CardDescription>What people read on the About Saligue page and on INDECIANA&apos;s page. Saligue is made by INDECIANA. Leave a field empty to go back to the default.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <p className="font-semibold">Saligue <span className="font-normal text-muted-foreground">(/about)</span></p>
          {field('brand-sal-tagline', 'Line under the logo', form.saligue.tagline, (v) => set('saligue', 'tagline', v), 80)}
          {field('brand-sal-about', 'About Saligue', form.saligue.about, (v) => set('saligue', 'about', v), 1200, true)}
        </div>
        <div className="space-y-3">
          <p className="font-semibold">INDECIANA <span className="font-normal text-muted-foreground">(/indeciana)</span></p>
          {field('brand-ind-kicker', 'Line above the name', form.indeciana.kicker, (v) => set('indeciana', 'kicker', v), 60)}
          {field('brand-ind-badge', 'Badge under the name', form.indeciana.badge, (v) => set('indeciana', 'badge', v), 60)}
          {field('brand-ind-about', 'About INDECIANA', form.indeciana.about, (v) => set('indeciana', 'about', v), 1200, true)}
        </div>
        <Button className="md:col-span-2 md:w-fit" onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save</Button>
      </CardContent>
    </Card>
  );
}
