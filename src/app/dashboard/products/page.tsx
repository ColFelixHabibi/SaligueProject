'use client';

import { AppealButton } from '@/components/appeal-button';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { Archive, Download, Edit, Eye, EyeOff, FileEdit, MoreHorizontal, PackagePlus, Search, Star, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAuth } from '@/components/auth/auth-provider';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { categoryLabel } from '@/lib/categories';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';
import { downloadCsv, useSellerStats } from '@/lib/seller';
import { productHref } from '@/lib/links';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

type Tab = 'all' | 'active' | 'draft' | 'archived' | 'low';
const TABS: { value: Tab; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'draft', label: 'Drafts' },
  { value: 'archived', label: 'Archived' }, { value: 'low', label: 'Low stock' },
];
const STATUS_STYLE: Record<Product['status'], string> = {
  active: 'border-emerald-500 text-emerald-600',
  draft: 'border-amber-500 text-amber-600',
  archived: 'border-muted-foreground text-muted-foreground',
};
const isLow = (p: Product) => p.stock != null && p.stock <= 3;

/** A number you can change right in the table; saves on Enter or when leaving the field. */
function InlineNumber({ value, onSave, prefix, placeholder, integer }: { value: number | null | undefined; onSave: (v: number | null) => Promise<void>; prefix?: string; placeholder?: string; integer?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const commit = async () => {
    if (draft === null) return;
    const next = draft.trim() === '' ? null : integer ? Math.floor(Number(draft)) : Number(draft);
    if (next === (value ?? null) || (next !== null && (!Number.isFinite(next) || next < 0))) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setDraft(null);
    }
  };
  return (
    <div className="relative w-24">
      {prefix && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>}
      <Input
        type="number"
        min="0"
        step={integer ? 1 : 0.01}
        value={draft ?? (value ?? '')}
        placeholder={placeholder}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        onClick={(e) => e.stopPropagation()}
        className={cn('h-8 text-sm', prefix && 'pl-5', draft !== null && 'border-primary')}
      />
    </div>
  );
}

function ProductsTable() {
  const params = useSearchParams();
  const { toast } = useToast();
  const { products: all, isInitialized } = useProductStore();
  const { authUid } = useAuth();
  const stats = useSellerStats(365);
  const products = useMemo(() => all.filter((p) => p.sellerId === authUid), [all, authUid]);
  const [tab, setTab] = useState<Tab>(params.get('filter') === 'low' ? 'low' : 'all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);

  const counts = useMemo(() => ({
    all: products.length,
    active: products.filter((p) => p.status === 'active').length,
    draft: products.filter((p) => p.status === 'draft').length,
    archived: products.filter((p) => p.status === 'archived').length,
    low: products.filter((p) => p.status === 'active' && isLow(p)).length,
  }), [products]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => (tab === 'all' ? true : tab === 'low' ? p.status === 'active' && isLow(p) : p.status === tab))
      .filter((p) => !q || [p.name, p.brand, p.type, p.color, categoryLabel(p.category)].join(' ').toLowerCase().includes(q));
  }, [products, tab, query]);

  const allChecked = shown.length > 0 && shown.every((p) => selected.has(p.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(shown.map((p) => p.id)));
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const patch = async (id: string, body: Partial<Product>) => {
    try {
      await api(`/products/${id}`, { method: 'PATCH', body });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not saved', description: friendlyError(error) });
      throw error;
    }
  };

  const bulk = async (ids: string[], action: 'active' | 'draft' | 'archived' | 'delete') => {
    try {
      const { changed } = await api<{ changed: number }>('/seller/products/bulk', { body: { ids, action } });
      setSelected(new Set());
      const verb = { active: 'published', draft: 'moved to drafts', archived: 'archived', delete: 'deleted' }[action];
      toast({ title: `${changed} ${changed === 1 ? 'item' : 'items'} ${verb}` });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not update', description: friendlyError(error) });
    }
  };

  const exportCsv = () =>
    downloadCsv('saligue-products.csv', [
      ['Name', 'Category', 'Type', 'Price', 'Stock', 'Status', 'Sold (12 months)', 'Revenue (12 months)', 'Views', 'Rating', 'Reviews', 'Listed'],
      ...shown.map((p) => {
        const s = stats?.perProduct[p.id];
        return [p.name, categoryLabel(p.category), p.type, p.price, p.stock ?? '', p.status, s?.units ?? 0, s?.revenue ?? 0, s?.views ?? 0, p.rating ?? '', p.ratingCount ?? 0, p.createdAt?.slice(0, 10)];
      }),
    ]);

  if (!isInitialized) return <Skeleton className="h-96 w-full rounded-2xl" />;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="hidden text-2xl font-bold tracking-tight md:block">Products</h2>
          <p className="text-sm text-muted-foreground">Add, edit, publish and remove your items. Change price and stock right in the table.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!shown.length}><Download className="mr-2 h-4 w-4" /> Export</Button>
          <Button asChild><Link href="/sell"><PackagePlus className="mr-2 h-4 w-4" /> Add item</Link></Button>
        </div>
      </div>

      <Card className="overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.value} type="button" onClick={() => { setTab(t.value); setSelected(new Set()); }}
                className={cn('flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition', tab === t.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                {t.label} <span className={cn('rounded-full px-1.5 text-xs', tab === t.value ? 'bg-white/25' : 'bg-muted')}>{counts[t.value]}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your items" className="h-9 pl-8" />
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-3 py-2 text-sm">
            <span className="font-semibold">{selected.size} selected</span>
            <Button size="sm" variant="outline" className="h-8" onClick={() => bulk([...selected], 'active')}><Upload className="mr-1.5 h-3.5 w-3.5" /> Publish</Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => bulk([...selected], 'draft')}><FileEdit className="mr-1.5 h-3.5 w-3.5" /> Draft</Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => bulk([...selected], 'archived')}><Archive className="mr-1.5 h-3.5 w-3.5" /> Archive</Button>
            <Button size="sm" variant="outline" className="h-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete([...selected])}><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete</Button>
            <Button size="sm" variant="ghost" className="ml-auto h-8" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}

        <CardContent className="overflow-x-auto p-0">
          {shown.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <p className="font-semibold text-foreground">{products.length ? 'No items here' : 'You have no items yet'}</p>
              {!products.length && <Button className="mt-4" asChild><Link href="/sell"><PackagePlus className="mr-2 h-4 w-4" /> List your first item</Link></Button>}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Select all" /></TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Sold</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Views</TableHead>
                  <TableHead className="hidden xl:table-cell">Rating</TableHead>
                  <TableHead className="hidden xl:table-cell">Listed</TableHead>
                  <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((p) => {
                  const s = stats?.perProduct[p.id];
                  return (
                    <TableRow key={p.id} data-state={selected.has(p.id) ? 'selected' : undefined} className={cn(p.status === 'archived' && 'opacity-60')}>
                      <TableCell><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} /></TableCell>
                      <TableCell>
                        <Link href={`/edit-product?id=${p.id}`} className="flex min-w-[12rem] items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.cutout || p.image} alt="" className="h-12 w-12 shrink-0 rounded-lg border bg-muted object-contain p-1" />
                          <span className="min-w-0">
                            <span className="block max-w-[14rem] truncate font-semibold hover:underline">{p.name}</span>
                            <span className="block text-xs text-muted-foreground">{p.type ?? categoryLabel(p.category)}{p.size ? ` · ${p.size}` : ''}</span>
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize', STATUS_STYLE[p.status])}>{p.status}</Badge>
                        {p.hidden && <><Badge variant="destructive" className="ml-1">Hidden after reports</Badge><span className="mt-1 block"><AppealButton kind="product" targetId={p.id} title={p.name} /></span></>}
                      </TableCell>
                      <TableCell><InlineNumber value={p.price} prefix="$" onSave={(v) => patch(p.id, { price: v ?? 0 })} /></TableCell>
                      <TableCell>
                        <InlineNumber value={p.stock} integer placeholder="∞" onSave={(v) => patch(p.id, { stock: v })} />
                        {p.stock === 0 && <span className="mt-0.5 block text-[11px] font-semibold text-destructive">Sold out</span>}
                        {p.stock != null && p.stock > 0 && p.stock <= 3 && <span className="mt-0.5 block text-[11px] font-semibold text-amber-600">Low</span>}
                      </TableCell>
                      <TableCell className="hidden text-right lg:table-cell">
                        <span className="font-semibold">{s?.units ?? 0}</span>
                        <span className="block text-xs text-muted-foreground">{formatPrice(s?.revenue ?? 0)}</span>
                      </TableCell>
                      <TableCell className="hidden text-right lg:table-cell">{s?.views ?? 0}</TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {p.ratingCount ? <span className="flex items-center gap-1 text-sm"><Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {p.rating?.toFixed(1)} <span className="text-muted-foreground">({p.ratingCount})</span></span> : <span className="text-xs text-muted-foreground">–</span>}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground xl:table-cell">{p.createdAt ? format(new Date(p.createdAt), 'd MMM yyyy') : ''}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label={`Actions for ${p.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild><Link href={`/edit-product?id=${p.id}`}><Edit className="mr-2 h-4 w-4" /> Edit</Link></DropdownMenuItem>
                            <DropdownMenuItem asChild><Link href={productHref(p)}><Eye className="mr-2 h-4 w-4" /> View as shopper</Link></DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {p.status !== 'active' && <DropdownMenuItem onSelect={() => bulk([p.id], 'active')}><Upload className="mr-2 h-4 w-4" /> Publish</DropdownMenuItem>}
                            {p.status === 'active' && <DropdownMenuItem onSelect={() => bulk([p.id], 'draft')}><EyeOff className="mr-2 h-4 w-4" /> Unpublish (draft)</DropdownMenuItem>}
                            {p.status !== 'archived' && <DropdownMenuItem onSelect={() => bulk([p.id], 'archived')}><Archive className="mr-2 h-4 w-4" /> Archive</DropdownMenuItem>}
                            <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmDelete([p.id])}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">Showing {shown.length} of {products.length} items</div>
      </Card>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.length === 1 ? 'this item' : `${confirmDelete?.length} items`}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone. Orders that already include it stay as they are. To hide an item for now, archive it instead.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => confirmDelete && bulk(confirmDelete, 'delete').then(() => setConfirmDelete(null))}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
      <ProductsTable />
    </Suspense>
  );
}
